import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBlocked, saveBlocked, nextBlocked } from "../index.js";

let tmp = "";
function useTempState(): string {
	tmp = mkdtempSync(join(tmpdir(), "pi-ctoggle-"));
	process.env.PI_CODING_AGENT_DIR = tmp;
	return tmp;
}
function cleanup() {
	delete process.env.PI_CODING_AGENT_DIR;
	rmSync(tmp, { recursive: true, force: true });
}

// ---------- loadBlocked / saveBlocked ----------
test("loadBlocked: no state file -> false", () => {
	useTempState();
	assert.equal(loadBlocked(), false);
	cleanup();
});
test("saveBlocked + loadBlocked roundtrip true", () => {
	useTempState();
	saveBlocked(true);
	assert.equal(loadBlocked(), true);
	const raw = JSON.parse(readFileSync(join(tmp, "pi-compaction-toggle", "state.json"), "utf8"));
	assert.equal(raw.blocked, true);
	cleanup();
});
test("saveBlocked + loadBlocked roundtrip false after true", () => {
	useTempState();
	saveBlocked(true);
	saveBlocked(false);
	assert.equal(loadBlocked(), false);
	cleanup();
});
test("loadBlocked: corrupt state file -> false", () => {
	useTempState();
	mkdirSync(join(tmp, "pi-compaction-toggle"), { recursive: true });
	writeFileSync(join(tmp, "pi-compaction-toggle", "state.json"), "{not json");
	assert.equal(loadBlocked(), false);
	cleanup();
});
test("loadBlocked: blocked: non-true value -> false", () => {
	useTempState();
	mkdirSync(join(tmp, "pi-compaction-toggle"), { recursive: true });
	writeFileSync(join(tmp, "pi-compaction-toggle", "state.json"), JSON.stringify({ blocked: "yes" }));
	assert.equal(loadBlocked(), false);
	cleanup();
});

// ---------- nextBlocked arg matrix ----------
test("nextBlocked: on/block -> blocked true", () => {
	assert.deepEqual(nextBlocked(false, "on"), { blocked: true, statusOnly: false });
	assert.deepEqual(nextBlocked(false, "block"), { blocked: true, statusOnly: false });
	assert.deepEqual(nextBlocked(false, "  ON  "), { blocked: true, statusOnly: false });
});
test("nextBlocked: off/unblock -> blocked false", () => {
	assert.deepEqual(nextBlocked(true, "off"), { blocked: false, statusOnly: false });
	assert.deepEqual(nextBlocked(true, "unblock"), { blocked: false, statusOnly: false });
});
test("nextBlocked: status/empty -> no change, statusOnly", () => {
	assert.deepEqual(nextBlocked(true, "status"), { blocked: true, statusOnly: true });
	assert.deepEqual(nextBlocked(false, ""), { blocked: false, statusOnly: true });
	assert.deepEqual(nextBlocked(true, undefined), { blocked: true, statusOnly: true });
});
test("nextBlocked: unknown arg flips", () => {
	assert.deepEqual(nextBlocked(true, "wat"), { blocked: false, statusOnly: false });
	assert.deepEqual(nextBlocked(false, "wat"), { blocked: true, statusOnly: false });
});
