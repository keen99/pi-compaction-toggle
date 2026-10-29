#!/usr/bin/env node
// Deep pinned-pi smoke for compaction-toggle. Proves state is PI-NATIVE
// (pi.appendEntry into the session file) and PER-SESSION:
//   1. fresh session: real LLM turn (canned-SSE mock) + /compact-toggle on
//      -> BLOCKED; session file contains the compaction-toggle custom entry;
//      NO global state store exists anywhere
//   2. reboot the SAME session id: status = BLOCKED (restored from entries
//      by session_start replay)
//   3. a DIFFERENT fresh session: status = allowed (nothing bleeds across)
// Hook cancel logic is trivial and unit-covered.
//
// Note: pi only flushes the session file after a real turn — command-only
// prompts never hit disk. That's why step 1 drives a mock turn first.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const base = mkdtempSync(join(tmpdir(), 'pi-ctoggle-deep-'));
const t0 = Date.now();
const agentDir = join(base, 'agent');
mkdirSync(agentDir, { recursive: true });
writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'mocktest', defaultModel: 'mock-model' }, null, '\t') + '\n');
const MARKER = join(agentDir, 'compaction-toggle-loaded.json');

// Canned openai-completions SSE server: role delta -> content delta -> stop.
const chunk = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const server = createServer((req, res) => {
	res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
	res.write(chunk({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }));
	res.write(chunk({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] }));
	res.write(chunk({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
	res.write('data: [DONE]\n\n');
	res.end();
});
server.listen(0, '127.0.0.1');
await new Promise((resolve) => server.on('listening', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --session-id doesn't exist on older pi (0.75.x): "Unknown option". Detect
// once; unsupported eras get a degraded smoke (in-process toggle + status +
// no-global-store) instead of a guaranteed-red matrix entry.
const bin = process.env.PI_TEST_BIN ?? join(dirname(process.execPath), 'pi');
const supportsSessionId = (() => {
	const h = spawnSync(bin, ['--help'], { encoding: 'utf8' });
	return `${h.stdout ?? ''}${h.stderr ?? ''}`.includes('--session-id');
})();

// pi nests project subdirs under --session-dir; find the newest session file.
function newestJsonl(dir) {
	let best = null;
	const walk = (d) => {
		for (const f of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, f.name);
			if (f.isDirectory()) walk(p);
			else if (f.name.endsWith('.jsonl')) {
				if (!best || statSync(p).mtimeMs > statSync(best).mtimeMs) best = p;
			}
		}
	};
	try { walk(dir); } catch { /* none */ }
	return best;
}

// Boots pi in `dir` bound to `sessionId`, sends prompts sequentially (each
// settled when output stops growing). Detached spawn + bounded graceful
// close so a stuck grandchild can't turn this into node exit 13.
async function withPi(dir, sessionId, prompts) {
	const args = ['--mode', 'rpc', '--no-extensions', '-e', join(root, 'index.ts'), '-e', join(root, 'test', 'mock-provider.ts'), '--session-dir', dir];
	if (sessionId) args.push('--session-id', sessionId);
	const child = spawn(
		bin,
		args,
		{ env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, COMPACTION_TOGGLE_DEBUG: '1', MOCK_BASE_URL: baseUrl, MOCK_API_KEY: 'k' }, cwd: root, stdio: ['pipe', 'pipe', 'pipe'], detached: true },
	);
	let out = '';
	child.stdout.on('data', (d) => { out += d; });
	child.stderr.on('data', (d) => { out += d; });
	// pi RPC buffers stdin until ready — send the probe immediately.
	child.stdin.write(JSON.stringify({ type: 'get_commands', id: 'g0' }) + '\n');

	const start = Date.now();
	let marker = 0;
	while (out.length === 0) {
		if (Date.now() - start > 20_000) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } throw new Error(`boot timeout; output: ${out.slice(-400)}`); }
		await sleep(200);
	}
	marker = out.length;
	for (const [i, msg] of prompts.entries()) {
		child.stdin.write(JSON.stringify({ type: 'prompt', id: `p${i}`, message: msg }) + '\n');
		let stable = marker;
		let stableCount = 0;
		while (stableCount < 3) {
			if (Date.now() - start > 60_000) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } throw new Error(`prompt timeout (${msg}); output: ${out.slice(-400)}`); }
			await sleep(250);
			if (out.length === stable) stableCount++;
			else { stable = out.length; stableCount = 0; }
		}
		marker = out.length;
	}
	await new Promise((resolve) => {
		child.stdin.end();
		child.kill('SIGTERM');
		const killer = setTimeout(() => {
			try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
			resolve();
		}, 5000);
		child.once('close', () => { clearTimeout(killer); resolve(); });
	});
	return { out, sessionFile: newestJsonl(dir) };
}

function fail(msg) {
	console.error('FAIL', msg);
	try { server.close(); } catch { /* ignore */ }
	try { rmSync(base, { recursive: true, force: true }); } catch { /* best-effort */ }
	process.exit(1);
}
function assert2(cond, msg) { if (!cond) throw new Error(msg); }

try {
	// ---- 1. fresh session: real turn + on -> BLOCKED, entry in session file, no global store
	const dirA = join(agentDir, 'sess-a');
	mkdirSync(dirA, { recursive: true });
	const step1 = await withPi(dirA, supportsSessionId ? 'ctogglesmoke-a' : null, ['say ok', '/compact-toggle on']);
	assert2(/BLOCKED for this session/.test(step1.out), `step1: expected BLOCKED notify, out tail: ${step1.out.slice(-400)}`);
	assert2(existsSync(MARKER), 'step1: extension never loaded (no debug marker)');
	assert2(!existsSync(join(agentDir, 'pi-compaction-toggle')), 'step1: GLOBAL state store exists — must be pi-session state only');

	if (supportsSessionId) {
		assert2(step1.sessionFile && existsSync(step1.sessionFile), 'step1: no session file written even after real turn');
		const raw = readFileSync(step1.sessionFile, 'utf8');
		assert2(raw.includes('"customType":"compaction-toggle"'), 'step1: no compaction-toggle custom entry in session file');
		const entryLine = raw.split('\n').find((l) => l.includes('"customType":"compaction-toggle"'));
		assert2(/"blocked":\s*true/.test(entryLine ?? ''), `step1: entry present but blocked=true missing: ${entryLine?.slice(0, 200)}`);

		// ---- 2. same session id reboot: restored BLOCKED from session entries
		const step2 = await withPi(dirA, 'ctogglesmoke-a', ['/compact-toggle status']);
		assert2(/BLOCKED/.test(step2.out.split('say ok').at(-1) ?? ''), `step2: state not restored from session entries; out tail: ${step2.out.slice(-400)}`);
	}

	// ---- 3. different fresh session/process: nothing bleeds across
	const dirB = join(agentDir, 'sess-b');
	mkdirSync(dirB, { recursive: true });
	const step3 = await withPi(dirB, supportsSessionId ? 'ctogglesmoke-b' : null, ['/compact-toggle status']);
	assert2(/allowed/.test(step3.out.split('/compact-toggle status').at(-1) ?? ''), `step3: foreign session state bled in; out tail: ${step3.out.slice(-400)}`);
	for (const step of [step1, step3]) {
		assert2(!/"type":"extension_error"/.test(step.out), `extension_error seen: ${step.out.slice(-600)}`);
	}
	const scope = supportsSessionId ? 'session A blocked + entry in session file + restored on resume' : 'per-process toggle (pre --session-id pi era)';
	console.log(`Deep smoke PASS: pi-native per-session state proven — ${scope}, session B independent, zero global store (${((Date.now() - t0) / 1000) | 0}s).`);
	server.close();
	rmSync(base, { recursive: true, force: true });
	process.exit(0);
} catch (e) {
	fail(e.message);
}
