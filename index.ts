/**
 * pi-compaction-toggle — live kill switch for auto-compaction.
 *
 * pi reads compaction.enabled from settings.json only at startup; there is
 * no built-in runtime toggle (ESC only cancels a compaction already running
 * while you watch). This extension blocks compaction via the
 * session_before_compact event hook, toggleable without restarting pi.
 *
 * Note: the event fires for manual /compact too (no auto/manual
 * discriminator), so while blocked, run /compact-toggle to unblock before
 * compacting manually.
 *
 * Usage:
 *   /compact-toggle          — flip block state
 *   /compact-toggle on|off   — set explicitly
 *   /compact-toggle status   — show state (default when no arg)
 *
 * State persists to ~/.pi/agent/pi-compaction-toggle/state.json and
 * survives reloads/restarts.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** State dir per call: PI_CODING_AGENT_DIR wins so tests/alt installs never
 *  touch the real ~/.pi/agent. */
function stateDir(): string {
	return join(
		process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
		"pi-compaction-toggle",
	);
}
function stateFile(): string {
	return join(stateDir(), "state.json");
}

export function loadBlocked(): boolean {
	try {
		const raw = JSON.parse(readFileSync(stateFile(), "utf8"));
		return raw.blocked === true;
	} catch {
		return false;
	}
}

export function saveBlocked(blocked: boolean): void {
	try {
		mkdirSync(dirname(stateFile()), { recursive: true });
		writeFileSync(stateFile(), JSON.stringify({ blocked }, null, "\t") + "\n");
	} catch {
		/* best-effort; in-memory state still applies this session */
	}
}

/** Pure arg parsing for /compact-toggle. Returns the next blocked state, or
 *  undefined when the arg is a status query. Unknown args flip. */
export function nextBlocked(current: boolean, rawArgs: string | undefined): { blocked: boolean; statusOnly: boolean } {
	const arg = (rawArgs ?? "").trim().toLowerCase();
	if (arg === "on" || arg === "block") return { blocked: true, statusOnly: false };
	if (arg === "off" || arg === "unblock") return { blocked: false, statusOnly: false };
	if (arg === "status" || arg === "") return { blocked: current, statusOnly: true };
	return { blocked: !current, statusOnly: false };
}

function debugMarker(data: Record<string, unknown>): void {
	if (process.env.COMPACTION_TOGGLE_DEBUG !== "1") return;
	try {
		const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
		mkdirSync(agentDir, { recursive: true });
		appendFileSync(join(agentDir, "compaction-toggle-loaded.json"), JSON.stringify(data) + "\n");
	} catch {
		/* best-effort */
	}
}

export default function (pi: ExtensionAPI) {
	let blocked = loadBlocked();
	debugMarker({ loaded: true, blocked });

	pi.registerCommand("compact-toggle", {
		description: "Toggle compaction blocking (live, no restart). Args: on|off|status",
		handler: (args, ctx) => {
			const next = nextBlocked(blocked, args);
			blocked = next.blocked;
			if (next.statusOnly) {
				ctx.ui.notify(
					`compaction: ${blocked ? "BLOCKED (toggle on to allow)" : "allowed"}`,
					"info",
				);
				return;
			}
			saveBlocked(blocked);
			ctx.ui.notify(
				blocked
					? "compaction BLOCKED — auto-compact will not run. /compact-toggle off to re-enable"
					: "compaction allowed",
				blocked ? "warning" : "info",
			);
		},
	});

	pi.on("session_before_compact", (_event, ctx) => {
		if (!blocked) return undefined;
		ctx?.ui?.notify?.(
			"compaction blocked by /compact-toggle — context not compacted",
			"warning",
		);
		return { cancel: true };
	});
}
