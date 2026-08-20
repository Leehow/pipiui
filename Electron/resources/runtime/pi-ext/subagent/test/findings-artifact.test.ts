import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	FINDINGS_MAX_CHARS,
	findingsFileName,
	findingsPath,
	formatFindingsLine,
	writeFindingsArtifact,
} from "../findings-artifact.ts";
import { formatSubagentDoneMessage, type DoneMessageResult } from "../done-message.ts";

function tempRoot(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pipiui-findings-"));
}

test("a report lands at .pi/findings/<agentId>.md with brief and evidence intact", () => {
	const root = tempRoot();
	const result = writeFindingsArtifact({
		mainCwd: root,
		agentId: "quota-pill",
		agentName: "explore",
		runId: "run-1",
		title: "quota pill recon",
		task: "Find where the quota pill renders.",
		text: "## TLDR\nIt renders in Sidebar.tsx.\n\n## Files Retrieved\n1. `src/Sidebar.tsx:120-160`",
	});

	assert.equal(result.ok, true);
	assert.equal(result.file, path.join(root, ".pi", "findings", "quota-pill.md"));
	const written = fs.readFileSync(result.file as string, "utf-8");
	assert.match(written, /# quota pill recon/);
	assert.match(written, /agentId `quota-pill`/);
	assert.match(written, /Find where the quota pill renders\./);
	assert.match(written, /src\/Sidebar\.tsx:120-160/);
});

test("re-dispatching the same agentId replaces its report rather than accumulating runs", () => {
	const root = tempRoot();
	const base = { mainCwd: root, agentId: "auth-refactor", agentName: "explore" };
	writeFindingsArtifact({ ...base, text: "first pass" });
	const second = writeFindingsArtifact({ ...base, text: "second pass" });

	const written = fs.readFileSync(second.file as string, "utf-8");
	assert.match(written, /second pass/);
	assert.doesNotMatch(written, /first pass/);
	assert.deepEqual(fs.readdirSync(path.join(root, ".pi", "findings")), ["auth-refactor.md"]);
});

test("an agent id cannot escape the findings directory", () => {
	assert.equal(findingsFileName("../../etc/passwd"), "etc-passwd.md");
	assert.equal(findingsFileName("  "), undefined);
	assert.equal(findingsFileName("..."), undefined);

	const root = tempRoot();
	const escaped = writeFindingsArtifact({
		mainCwd: root,
		agentId: "../../escape",
		agentName: "explore",
		text: "should stay inside",
	});
	assert.equal(escaped.ok, true);
	assert.equal(path.dirname(escaped.file as string), path.join(root, ".pi", "findings"));
});

test("nothing is written without a root, an id, or real output", () => {
	const root = tempRoot();
	assert.equal(writeFindingsArtifact({ mainCwd: undefined, agentId: "a", agentName: "explore", text: "x" }).ok, false);
	assert.equal(writeFindingsArtifact({ mainCwd: root, agentId: undefined, agentName: "explore", text: "x" }).ok, false);
	assert.equal(writeFindingsArtifact({ mainCwd: root, agentId: "a", agentName: "explore", text: "   " }).ok, false);
	assert.equal(fs.existsSync(path.join(root, ".pi", "findings")), false);
});

test("an oversized report is capped rather than written whole", () => {
	const root = tempRoot();
	const result = writeFindingsArtifact({
		mainCwd: root,
		agentId: "big",
		agentName: "explore",
		text: "x".repeat(FINDINGS_MAX_CHARS + 500),
	});
	const written = fs.readFileSync(result.file as string, "utf-8");
	assert.match(written, /\[Report truncated: 500 chars omitted\.\]/);
});

test("a brief containing fenced code does not break out of its quote block", () => {
	const root = tempRoot();
	const result = writeFindingsArtifact({
		mainCwd: root,
		agentId: "fenced",
		agentName: "explore",
		task: "Fix this:\n```ts\nconst x = 1;\n```\nthen verify.",
		text: "## TLDR\ndone",
	});

	const written = fs.readFileSync(result.file as string, "utf-8");
	// The wrapper must outrun the longest backtick run inside the brief, or the quoted brief
	// ends early and its tail renders as the report.
	assert.match(written, /````\nFix this:/);
	assert.match(written, /then verify\.\n````/);
	assert.match(written, /```ts\nconst x = 1;/);
});

test("findingsPath agrees with the writer so a brief can name the file before it exists", () => {
	assert.equal(findingsPath("/repo", "quota-pill"), path.join("/repo", ".pi", "findings", "quota-pill.md"));
	assert.equal(findingsPath("/repo", "   "), undefined);
});

function minimalResult(overrides: Partial<DoneMessageResult> = {}): DoneMessageResult {
	return {
		agent: "explore",
		task: "look around",
		title: "scan workspace",
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { cost: 0, turns: 1 },
		agentId: "agent-done",
		...overrides,
	};
}

test("the done message carries the handoff path only when one was written", () => {
	const withFile = formatSubagentDoneMessage(minimalResult(), {
		findingsFile: "/repo/.pi/findings/quota-pill.md",
	});
	assert.match(withFile, /Findings: \/repo\/\.pi\/findings\/quota-pill\.md/);
	assert.match(withFile, /Do NOT read it yourself/);

	assert.doesNotMatch(formatSubagentDoneMessage(minimalResult()), /^Findings:/m);
});

test("the handoff line tells the boss to forward the path, not to read it", () => {
	const line = formatFindingsLine("/repo/.pi/findings/x.md");
	assert.match(line, /next worker's brief/);
	assert.match(line, /do not re-explore/);
});
