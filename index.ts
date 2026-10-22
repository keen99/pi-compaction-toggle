/**
 * pi-compaction-toggle — live kill switch for auto-compaction.
 *
 * pi reads compaction.enabled from settings.json only at startup; there is
 * no built-in runtime toggle (ESC only cancels a compaction already running
 * while you watch). This extension blocks compaction via the
 * session_before_compact event hook, toggleable without restarting pi.
 *
 * State is PER-SESSION by construction: it lives in the session file itself
 * via pi.appendEntry (same pattern as pi-model-lock / pi-git-safe-write).
 * One session flipping its toggle can NEVER affect another — there is no
 * shared/global store at all. Restored on session_start by replaying the
 * session's own entries (last one wins), so it survives /reload and restart
 * of the same session, and resets naturally on /new and /fork.
 *
 * Note: the event fires for manual /compact too (no auto/manual
 * discriminator), so while blocked, run /compact-toggle off before
 * compacting manually.
 *
 * Usage:
 *   /compact-toggle          — flip block state (this session)
 *   /compact-toggle on|off   — set explicitly (this session)
 *   /compact-toggle status   — show state (default when no arg)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ENTRY_KEY = "compaction-toggle";

/** Pure arg parsing for /compact-toggle. Returns the next blocked state, or
 *  a statusOnly flag when the arg is a status query. Unknown args flip. */
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
	// In-memory mirror of the session's own state. Source of truth = the
	// session file's custom entries; this flips only from restore or toggle.
	let blocked = false;
	debugMarker({ loaded: true });

	pi.on("session_start", async (_event, ctx) => {
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "custom" || entry.customType !== ENTRY_KEY) continue;
			blocked = (entry.data as { blocked?: boolean })?.blocked === true;
		}
		debugMarker({ restored: true, blocked });
	});

	pi.registerCommand("compact-toggle", {
		description: "Toggle compaction blocking for THIS session (live, no restart). Args: on|off|status",
		handler: (args, ctx) => {
			const next = nextBlocked(blocked, args);
			if (next.statusOnly) {
				ctx.ui.notify(
					`compaction (this session): ${next.blocked ? "BLOCKED (toggle off to allow)" : "allowed"}`,
					"info",
				);
				return;
			}
			blocked = next.blocked;
			pi.appendEntry(ENTRY_KEY, { blocked: next.blocked });
			ctx.ui.notify(
				next.blocked
					? "compaction BLOCKED for this session — auto-compact will not run. /compact-toggle off to re-enable"
					: "compaction allowed for this session",
				next.blocked ? "warning" : "info",
			);
		},
	});

	pi.on("session_before_compact", (_event, ctx) => {
		if (!blocked) return undefined;
		ctx?.ui?.notify?.(
			"compaction blocked by /compact-toggle (this session) — context not compacted",
			"warning",
		);
		return { cancel: true };
	});
}
