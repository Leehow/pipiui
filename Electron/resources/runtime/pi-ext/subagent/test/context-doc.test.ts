import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	CONTEXT_DOC_TEMPLATE,
	contextDocPath,
	listSections,
	normalizeSectionName,
	upsertSection,
	writeContextSection,
} from "../context-doc.ts";

function tempRoot(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pipiui-context-"));
}

test("a new section is created, then replaced in place by set", () => {
	const withOne = upsertSection(CONTEXT_DOC_TEMPLATE, "Shared architecture", "Use the host bridge.", "set");
	assert.match(withOne, /## Shared architecture\n\nUse the host bridge\./);

	const revised = upsertSection(withOne, "Shared architecture", "Use the IPC channel instead.", "set");
	assert.match(revised, /Use the IPC channel instead\./);
	// The point of `set`: the superseded decision is gone, not sitting above the new one.
	assert.doesNotMatch(revised, /Use the host bridge\./);
	assert.deepEqual(listSections(revised), ["Shared architecture"]);
});

test("append extends a section without disturbing its neighbours", () => {
	let doc = upsertSection(CONTEXT_DOC_TEMPLATE, "Conventions", "Name workers by slice.", "set");
	doc = upsertSection(doc, "Risks", "Merge order matters.", "set");
	doc = upsertSection(doc, "Conventions", "Verify with npm test.", "append");

	assert.match(doc, /Name workers by slice\./);
	assert.match(doc, /Verify with npm test\./);
	assert.match(doc, /Merge order matters\./);
	assert.deepEqual(listSections(doc), ["Conventions", "Risks"]);
	// Appending to an earlier section must not reorder or duplicate the later one.
	assert.equal(doc.match(/## Risks/g)?.length, 1);
});

test("section names that would break the document are rejected", () => {
	assert.equal(normalizeSectionName("  Shared   architecture "), "Shared architecture");
	assert.equal(normalizeSectionName(""), undefined);
	assert.equal(normalizeSectionName("## injected"), undefined);
	// A multi-line name is flattened rather than refused: the result cannot break a heading.
	assert.equal(normalizeSectionName("two\nlines"), "two lines");
	assert.equal(normalizeSectionName("x".repeat(81)), undefined);
});

test("writeContextSection creates the document and reports its sections back", async () => {
	const root = tempRoot();
	const first = await writeContextSection({
		mainCwd: root,
		sessionKey: "s1",
		section: "Shared architecture",
		body: "One queue, one writer.",
		mode: "set",
	});

	assert.equal(first.ok, true);
	assert.equal(first.file, contextDocPath(root, "s1"));
	assert.deepEqual(first.sections, ["Shared architecture"]);

	const second = await writeContextSection({
		mainCwd: root,
		sessionKey: "s1",
		section: "Conventions",
		body: "Workers read, never write.",
		mode: "set",
	});
	assert.deepEqual(second.sections, ["Shared architecture", "Conventions"]);

	const written = fs.readFileSync(first.file as string, "utf-8");
	assert.match(written, /One queue, one writer\./);
	assert.match(written, /Workers read, never write\./);
});

test("a missing root or an empty body writes nothing", async () => {
	const root = tempRoot();
	const noRoot = await writeContextSection({ mainCwd: undefined, sessionKey: "s", section: "A", body: "b", mode: "set" });
	assert.equal(noRoot.ok, false);

	const emptyBody = await writeContextSection({ mainCwd: root, sessionKey: "s", section: "A", body: "   ", mode: "set" });
	assert.equal(emptyBody.ok, false);
	assert.equal(fs.existsSync(path.join(root, ".pi", "context")), false);
});

test("the document sits beside the ledger, keyed by session", () => {
	assert.equal(contextDocPath("/repo", "abc"), path.join("/repo", ".pi", "context", "context-abc.md"));
	assert.equal(contextDocPath("/repo", undefined), path.join("/repo", ".pi", "context", "context-terminal.md"));
});
