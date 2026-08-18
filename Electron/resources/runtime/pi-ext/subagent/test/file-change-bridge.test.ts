import test from "node:test";
import assert from "node:assert/strict";
import {
	compactFileChangeFromArgs,
	compactFileChangeFromPartial,
	stringifyCompactFileChange,
} from "../file-change-bridge.ts";

test("write args produce added-only compact stats", () => {
	const stats = compactFileChangeFromArgs("write", { path: "a.ts", content: "abcd" });
	assert.deepEqual(stats, {
		path: "a.ts",
		payloadChars: 4,
		addedChars: 4,
		removedChars: 0,
		addedLines: 1,
		removedLines: 0,
	});
	assert.equal(JSON.parse(stringifyCompactFileChange(stats!)).payloadChars, 4);
	assert.equal(JSON.parse(stringifyCompactFileChange(stats!)).addedLines, 1);
});

test("edit args sum edits and legacy fields", () => {
	const edits = compactFileChangeFromArgs("edit", {
		path: "b.ts",
		edits: [{ oldText: "aa", newText: "bbbb" }],
	});
	assert.deepEqual(edits, {
		path: "b.ts",
		payloadChars: 4,
		addedChars: 4,
		removedChars: 2,
		addedLines: 1,
		removedLines: 1,
	});
	const legacy = compactFileChangeFromArgs("edit", { path: "c.ts", oldText: "x", newText: "yyy" });
	assert.equal(legacy?.addedChars, 3);
	assert.equal(legacy?.removedChars, 1);
	assert.equal(legacy?.addedLines, 1);
	assert.equal(legacy?.removedLines, 1);
});

test("write/edit line counts match Swift logicalLines / LCS hunks", () => {
	const writeNl = compactFileChangeFromArgs("write", { path: "w.ts", content: "a\nb\nc\n" });
	assert.equal(writeNl?.addedLines, 3);
	assert.equal(writeNl?.removedLines, 0);
	const oneLine = compactFileChangeFromArgs("edit", {
		path: "e.ts",
		edits: [{ oldText: "old line", newText: "new line" }],
	});
	assert.equal(oneLine?.addedLines, 1);
	assert.equal(oneLine?.removedLines, 1);
	const identical = compactFileChangeFromArgs("edit", {
		path: "e.ts",
		oldText: "same\n",
		newText: "same\n",
	});
	assert.equal(identical?.addedLines, 0);
	assert.equal(identical?.removedLines, 0);
});

test("partial write JSON grows payloadChars", () => {
	const a = compactFileChangeFromPartial("write", '{"path":"w.ts","content":"abcd');
	const b = compactFileChangeFromPartial("write", '{"path":"w.ts","content":"abcdefghij');
	assert.equal(a?.payloadChars, 4);
	assert.equal(b?.payloadChars, 10);
	assert.equal(compactFileChangeFromPartial("bash", '{"command":"ls"}'), null);
});
