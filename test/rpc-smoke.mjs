#!/usr/bin/env node
// Deep pinned-pi smoke for compaction-toggle. Boots real pi in RPC mode with
// a pre-seeded state.json (blocked=true) and asserts the debug marker proves
// the extension loaded AND read the persisted blocked state on the real
// process. Hook logic (cancel:true) is trivial and unit-covered.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'pi-ctoggle-deep-'));
const agentDir = join(dir, 'agent');
const stateDir = join(agentDir, 'pi-compaction-toggle');
mkdirSync(join(agentDir, 'sessions', 'tmp'), { recursive: true });
mkdirSync(stateDir, { recursive: true });
writeFileSync(join(stateDir, 'state.json'), JSON.stringify({ blocked: true }, null, '\t') + '\n');
const MARKER = join(agentDir, 'compaction-toggle-loaded.json');

const child = spawn(
	process.env.PI_TEST_BIN ?? join(dirname(process.execPath), 'pi'),
	['--mode', 'rpc', '--no-extensions', '-e', join(root, 'index.ts'), '--session-dir', join(agentDir, 'sessions', 'tmp')],
	{ env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, COMPACTION_TOGGLE_DEBUG: '1' }, cwd: dir },
);
let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });

const t0 = Date.now();
const hard = setTimeout(() => child.kill('SIGKILL'), 30_000);
const poll = setInterval(() => {
	if (existsSync(MARKER)) {
		clearInterval(poll);
		finish();
	} else if (Date.now() - t0 > 20_000) {
		clearInterval(poll);
		console.error('FAIL timed out — no load marker. stderr tail:', out.slice(-600));
		child.kill('SIGTERM');
		clearTimeout(hard);
		rmSync(dir, { recursive: true, force: true });
		process.exit(1);
	}
}, 200);

function finish() {
	child.kill('SIGTERM');
	child.on('exit', () => {
		clearTimeout(hard);
		try {
			const lines = readFileSync(MARKER, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
			const loaded = lines.find((l) => l.loaded === true);
			if (!loaded) throw new Error('no loaded marker line');
			if (loaded.blocked !== true) throw new Error(`extension did not read persisted blocked state: ${JSON.stringify(loaded)}`);
			console.log(`Deep smoke PASS: loaded, persisted blocked=true honored by real pi (${(Date.now() - t0) / 1000 | 0}s).`);
			process.exit(0);
		} catch (e) {
			console.error('FAIL', e.message);
			process.exit(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
}
