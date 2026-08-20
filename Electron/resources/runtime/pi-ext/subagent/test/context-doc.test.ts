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
	detectRepeatedBrief,
	formatRepeatedBriefNudge,
	REPEAT_MIN_RATIO,
	REPEAT_MIN_SHARED_CHARS,
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

const SHARED = [
	"Architecture: the host bridge owns session identity; workers never mint a session id themselves.",
	"Conventions: name every worker after its vertical slice, and verify with `npm test -w @pipiui/ui`.",
	"Do not touch Electron/resources/runtime/pi-ext/subagent/index.ts in this wave; it is owned by another slice.",
	"All edits land in packages/ui and must keep the existing data-testid attributes intact.",
].join("\n");

test("a second brief repeating the shared half is detected, and named against the first", () => {
	const match = detectRepeatedBrief(`${SHARED}\nGoal: fix the quota pill width regression at render time.`, [
		{ agentId: "sidebar-icons", brief: `${SHARED}\nGoal: give external rows their own source icon.` },
	]);

	assert.ok(match, "identical pasted briefing across two briefs is the case context_doc exists for");
	assert.equal(match?.againstAgentId, "sidebar-icons");
	assert.ok((match?.sharedChars ?? 0) >= REPEAT_MIN_SHARED_CHARS);
	assert.ok((match?.ratio ?? 0) >= REPEAT_MIN_RATIO);
});

test("independently written briefs about the same subsystem are not flagged", () => {
	// Same vocabulary, no pasted lines: this is not repetition worth a document.
	const match = detectRepeatedBrief(
		"Goal: the sidebar session row should show a source icon for external sessions. Verify with npm test.",
		[{ agentId: "other", brief: "Goal: the sidebar drag handler should reorder pinned sessions. Verify with npm test." }],
	);
	assert.equal(match, undefined);
});

test("short repeated lines cannot manufacture a match", () => {
	const boilerplate = Array.from({ length: 40 }, (_, i) => `- step ${i}`).join("\n");
	assert.equal(detectRepeatedBrief(boilerplate, [{ agentId: "a", brief: boilerplate }]), undefined);
});

test("a small overlap inside two large briefs stays below the ratio bar", () => {
	const oneSharedLine = "Do not touch Electron/resources/runtime/pi-ext/subagent/index.ts in this wave; it is owned by another slice."
	const bulk = (seed: string) => Array.from({ length: 30 }, (_, i) => `${seed} line ${i} with enough characters to count as significant`).join("\n");
	const match = detectRepeatedBrief(`${bulk("alpha")}\n${oneSharedLine}`, [
		{ agentId: "a", brief: `${bulk("beta")}\n${oneSharedLine}` },
	]);
	assert.equal(match, undefined, "one shared line in two long briefs is not a shared briefing");
});

test("the first brief of a turn has nothing to repeat", () => {
	assert.equal(detectRepeatedBrief(SHARED, []), undefined);
	assert.equal(detectRepeatedBrief("", [{ agentId: "a", brief: SHARED }]), undefined);
});

test("the strongest match wins when several earlier briefs overlap", () => {
	const extra = "\nShared verification: run `npm run build -w @pipiui/ui` and paste the exit code into the report."
	const match = detectRepeatedBrief(`${SHARED}${extra}\nGoal: third slice.`, [
		{ agentId: "weak", brief: `${SHARED}\nGoal: first slice.` },
		{ agentId: "strong", brief: `${SHARED}${extra}\nGoal: second slice.` },
	]);
	assert.equal(match?.againstAgentId, "strong");
});

test("the nudge names the repeat, the tool, and the file, and keeps briefs responsible for their own half", () => {
	const text = formatRepeatedBriefNudge(
		{ againstAgentId: "sidebar-icons", sharedChars: 620, ratio: 0.42 },
		"/repo/.pi/context/context-s1.md",
	);
	assert.match(text, /^\[shared-context\]/);
	assert.match(text, /~42% of `sidebar-icons`/);
	assert.match(text, /620 chars/);
	assert.match(text, /context_doc\(\{section, body\}\)/);
	assert.match(text, /\/repo\/\.pi\/context\/context-s1\.md/);
	assert.match(text, /goal, scope and acceptance still belong in the brief itself/);
});
