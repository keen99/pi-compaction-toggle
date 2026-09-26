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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const STATE_DIR = join(homedir(), ".pi", "agent", "pi-compaction-toggle");
const STATE_FILE = join(STATE_DIR, "state.json");

function loadBlocked(): boolean {
	try {
		const raw = JSON.parse(readFileSync(STATE_FILE, "utf8"));
		return raw.blocked === true;
	} catch {
		return false;
	}
}

function saveBlocked(blocked: boolean): void {
	try {
		mkdirSync(dirname(STATE_FILE), { recursive: true });
		writeFileSync(STATE_FILE, JSON.stringify({ blocked }, null, "\t") + "\n");
	} catch {
		/* best-effort; in-memory state still applies this session */
	}
}

export default function (pi: ExtensionAPI) {
	let blocked = loadBlocked();

	pi.registerCommand("compact-toggle", {
		description: "Toggle compaction blocking (live, no restart). Args: on|off|status",
		handler: (args, ctx) => {
			const arg = (args ?? "").trim().toLowerCase();
			if (arg === "on" || arg === "block") {
				blocked = true;
			} else if (arg === "off" || arg === "unblock") {
				blocked = false;
			} else if (arg === "status" || arg === "") {
				ctx.ui.notify(
					`compaction: ${blocked ? "BLOCKED (toggle on to allow)" : "allowed"}`,
					"info",
				);
				return;
			} else {
				blocked = !blocked;
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
