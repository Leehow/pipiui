import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CUT_IN_HOLD_MS, cutInHoldActive, releaseCutInHold } from "../cut-in-hold.ts";

function fixture(t: test.TestContext) {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-cutin-hold-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const file = join(directory, "hold.json");
	return { file, put: (marker: unknown) => writeFileSync(file, JSON.stringify(marker)) };
}

test("host pending user input outlives a long Boss turn and only its owner clears it", (t) => {
	const { file, put } = fixture(t);
	put({ at: 1_000, pendingUserInput: true, ownerPid: 123 });
	assert.equal(cutInHoldActive(file, 1_000 + 10 * CUT_IN_HOLD_MS, pid => pid === 123), true);
	releaseCutInHold(file);
	assert.equal(existsSync(file), true, "first user input must not release the remaining FIFO items");
	assert.equal(cutInHoldActive(file, 500_000, () => false), false, "a dead host cannot wedge delivery");
	rmSync(file);
	assert.equal(cutInHoldActive(file, 500_000, () => true), false);
});

test("legacy cut-in markers keep bounded expiry and user-input release", (t) => {
	const { file, put } = fixture(t);
	put({ at: 1_000 });
	assert.equal(cutInHoldActive(file, 1_001), true);
	assert.equal(cutInHoldActive(file, 1_000 + CUT_IN_HOLD_MS), false);
	assert.equal(cutInHoldActive(file, 999), false);
	releaseCutInHold(file);
	assert.equal(existsSync(file), false);
});

test("malformed, missing and invalid-owner markers never hold delivery", (t) => {
	const { file, put } = fixture(t);
	assert.equal(cutInHoldActive(null), false);
	assert.equal(cutInHoldActive(file), false);
	for (const marker of [null, {}, { pendingUserInput: true }, { pendingUserInput: true, ownerPid: -1 }, { pendingUserInput: true, ownerPid: "123" }]) {
		put(marker);
		assert.equal(cutInHoldActive(file, 1_001, () => true), false);
	}
	writeFileSync(file, "{");
	assert.equal(cutInHoldActive(file), false);
});
