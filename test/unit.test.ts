import { test } from "node:test";
import assert from "node:assert/strict";
import { nextBlocked } from "../index.js";

// State persistence/isolation is pi-native now (pi.appendEntry into the
// session file — see index.ts). There is no extension-owned store left to
// unit test: per-session behavior is structural, proven end-to-end in
// test/rpc-smoke.mjs. What remains pure is argument parsing.

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
