import test from "node:test";
import assert from "node:assert/strict";
import {
	compactFileChangeFromArgs,
	compactFileChangeFromPartial,
	stringifyCompactFileChange,
} from "../file-change-bridge.ts";

test("write args produce added-only compact stats", () => {
	const stats = compactFileChangeFromArgs("write", { path: "a.ts", content: "abcd" });
	assert.deepEqual(stats, { path: "a.ts", payloadChars: 4, addedChars: 4, removedChars: 0 });
	assert.equal(JSON.parse(stringifyCompactFileChange(stats!)).payloadChars, 4);
});

test("edit args sum edits and legacy fields", () => {
	const edits = compactFileChangeFromArgs("edit", {
		path: "b.ts",
		edits: [{ oldText: "aa", newText: "bbbb" }],
	});
	assert.deepEqual(edits, { path: "b.ts", payloadChars: 4, addedChars: 4, removedChars: 2 });
	const legacy = compactFileChangeFromArgs("edit", { path: "c.ts", oldText: "x", newText: "yyy" });
	assert.equal(legacy?.addedChars, 3);
	assert.equal(legacy?.removedChars, 1);
});

test("partial write JSON grows payloadChars", () => {
	const a = compactFileChangeFromPartial("write", '{"path":"w.ts","content":"abcd');
	const b = compactFileChangeFromPartial("write", '{"path":"w.ts","content":"abcdefghij');
	assert.equal(a?.payloadChars, 4);
	assert.equal(b?.payloadChars, 10);
	assert.equal(compactFileChangeFromPartial("bash", '{"command":"ls"}'), null);
});
