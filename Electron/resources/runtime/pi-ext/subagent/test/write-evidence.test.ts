import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import { workerWriteFingerprint, writeSetFingerprint } from "../write-evidence.ts";

const noStat = () => null;
const statAll = (sizes: Record<string, { mtimeMs: number; size: number }>) =>
	(absolutePath: string) => sizes[path.basename(absolutePath)] ?? null;

test("a clean tree and a dirty tree never share a fingerprint", () => {
	assert.equal(writeSetFingerprint([], "/repo", noStat), "clean");
	assert.notEqual(writeSetFingerprint(["src/a.ts"], "/repo", noStat), "clean");
});

test("the same tree state yields the same fingerprint whatever order Git reports it in", () => {
	const stat = statAll({ "a.ts": { mtimeMs: 10, size: 1 }, "b.ts": { mtimeMs: 20, size: 2 } });
	assert.equal(
		writeSetFingerprint(["src/a.ts", "src/b.ts"], "/repo", stat),
		writeSetFingerprint(["src/b.ts", "src/a.ts"], "/repo", stat),
	);
});

test("rewriting one file changes the fingerprint even though the path set does not", () => {
	// The reason paths alone are not enough: a worker looping edit/verify/edit on a single file
	// leaves `git status` output byte-identical while doing real work every turn.
	const before = writeSetFingerprint(["src/a.ts"], "/repo", statAll({ "a.ts": { mtimeMs: 10, size: 100 } }));
	const after = writeSetFingerprint(["src/a.ts"], "/repo", statAll({ "a.ts": { mtimeMs: 20, size: 140 } }));
	assert.notEqual(before, after);
});

test("an unreadable path is still a stable, distinct observation", () => {
	const gone = writeSetFingerprint(["src/a.ts"], "/repo", noStat);
	assert.equal(gone, writeSetFingerprint(["src/a.ts"], "/repo", noStat));
	assert.notEqual(gone, writeSetFingerprint(["src/a.ts"], "/repo", statAll({ "a.ts": { mtimeMs: 1, size: 1 } })));
});

test("a stat that throws cannot take the worker down with it", () => {
	const thrower = () => { throw new Error("EACCES"); };
	assert.doesNotThrow(() => writeSetFingerprint(["src/a.ts"], "/repo", thrower));
});

test("huge dirty sets skip the per-file stat and fingerprint the path list", () => {
	const many = Array.from({ length: 600 }, (_, i) => `src/file-${i}.ts`);
	let statCalls = 0;
	const counting = () => { statCalls += 1; return null; };
	const fingerprint = writeSetFingerprint(many, "/repo", counting);
	assert.equal(statCalls, 0, "600 stats per stall check buy nothing over the path list");
	assert.match(fingerprint, /^paths:600:/);
	assert.notEqual(fingerprint, writeSetFingerprint(many.slice(0, 599), "/repo", counting));
});

test("every way Git can fail to answer yields undefined, never a wrong verdict", () => {
	const ok = () => ({ ok: true, stdout: "" });
	assert.equal(workerWriteFingerprint(undefined, ok, noStat), undefined);
	assert.equal(workerWriteFingerprint("   ", ok, noStat), undefined);
	assert.equal(workerWriteFingerprint("/repo", () => ({ ok: false, stdout: "" }), noStat), undefined);
	assert.equal(workerWriteFingerprint("/repo", () => { throw new Error("no git"); }, noStat), undefined);
	assert.equal(workerWriteFingerprint("/repo", ok, noStat), "clean", "a repo that answers gets an answer");
});

test("porcelain output reaches the fingerprint through the parser Git actually feeds", () => {
	const stdout = " M src/a.ts\0?? src/b.ts\0";
	const fingerprint = workerWriteFingerprint("/repo", () => ({ ok: true, stdout }), noStat);
	assert.equal(fingerprint, writeSetFingerprint(["src/a.ts", "src/b.ts"], "/repo", noStat));
});
