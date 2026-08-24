import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import {
	activeToolForContentIndex,
	boundActivitySummary,
	latestActiveTool,
	removeActiveTool,
	summarizeActiveToolArgs,
	upsertActiveTool,
	type ActiveTool,
} from "../active-tools.ts";

function tool(partial: Partial<ActiveTool> & Pick<ActiveTool, "name" | "startedAt">): ActiveTool {
	return {
		summary: partial.summary ?? boundActivitySummary(partial.name),
		...partial,
	};
}

test("overlapping bash git diff and read keep the remaining tool after the first end", () => {
	let tools: ActiveTool[] = [];
	tools = upsertActiveTool(tools, tool({
		toolCallId: "tc-diff",
		name: "bash",
		startedAt: 10,
		summary: boundActivitySummary("bash", "git diff HEAD -- a.ts"),
	}));
	tools = upsertActiveTool(tools, tool({
		toolCallId: "tc-read",
		name: "read",
		startedAt: 20,
		summary: boundActivitySummary("read", "b.ts"),
	}));
	assert.equal(latestActiveTool(tools)?.toolCallId, "tc-read");

	tools = removeActiveTool(tools, { toolCallId: "tc-diff", name: "bash" });
	const remaining = latestActiveTool(tools);
	assert.equal(tools.length, 1);
	assert.equal(remaining?.toolCallId, "tc-read");
	assert.match(remaining?.summary ?? "", /read b\.ts/);
	assert.doesNotMatch(remaining?.summary ?? "", /git diff/);

	tools = removeActiveTool(tools, { toolCallId: "tc-read", name: "read" });
	assert.equal(tools.length, 0);
	assert.equal(latestActiveTool(tools), undefined);
});

test("ending without an id does not wipe a still-running identified tool", () => {
	let tools: ActiveTool[] = [];
	tools = upsertActiveTool(tools, tool({ toolCallId: "tc-diff", name: "bash", startedAt: 1, summary: "bash git diff" }));
	tools = upsertActiveTool(tools, tool({ name: "read", startedAt: 2, summary: "read x.ts" }));
	tools = removeActiveTool(tools, { name: "read" });
	assert.equal(tools.length, 1);
	assert.equal(tools[0].toolCallId, "tc-diff");
});

test("a later id upgrades a same-name start placeholder instead of stacking", () => {
	let tools: ActiveTool[] = [];
	tools = upsertActiveTool(tools, tool({ name: "bash", startedAt: 5, summary: "bash" }));
	tools = upsertActiveTool(tools, tool({
		toolCallId: "tc-diff",
		name: "bash",
		startedAt: 9,
		summary: "bash git diff HEAD",
	}));
	assert.equal(tools.length, 1);
	assert.equal(tools[0].toolCallId, "tc-diff");
	assert.equal(tools[0].startedAt, 5);
});

test("activity summaries never include prompts, raw args, or unknown-tool JSON", () => {
	assert.equal(summarizeActiveToolArgs("generate_image", { prompt: "SECRET PROMPT" }), undefined);
	assert.equal(summarizeActiveToolArgs("image_gen", { prompt: "SECRET PROMPT" }), undefined);
	assert.equal(
		summarizeActiveToolArgs("mystery", { token: "sk-secret", body: "file contents" }),
		undefined,
	);
	assert.equal(
		summarizeActiveToolArgs("bash", { command: "git diff HEAD -- Electron/packages/pi-backend/src/index.ts" }),
		"git diff HEAD -- Electron/packages/pi-backend/src/index.ts",
	);
	assert.equal(summarizeActiveToolArgs("write", { contents: "SECRET FILE", path: "/tmp/a.ts" }), "/tmp/a.ts");
	assert.equal(summarizeActiveToolArgs("skill_search", { query: "office document" }), "office document");
	assert.equal(summarizeActiveToolArgs("skill_load", { name: "tdd" }), "tdd");
	assert.doesNotMatch(
		boundActivitySummary("generate_image", summarizeActiveToolArgs("generate_image", { prompt: "SECRET" }) ?? ""),
		/SECRET|prompt|\{/,
	);
});

test("ending the latest tool falls back to the earlier still-running tool", () => {
	let tools: ActiveTool[] = [];
	tools = upsertActiveTool(tools, tool({
		toolCallId: "tc-diff",
		name: "bash",
		startedAt: 10,
		summary: boundActivitySummary("bash", "git diff HEAD -- a.ts"),
	}));
	tools = upsertActiveTool(tools, tool({
		toolCallId: "tc-read",
		name: "read",
		startedAt: 20,
		summary: boundActivitySummary("read", "b.ts"),
	}));
	assert.equal(latestActiveTool(tools)?.toolCallId, "tc-read");

	tools = removeActiveTool(tools, { toolCallId: "tc-read", name: "read" });
	const remaining = latestActiveTool(tools);
	assert.equal(tools.length, 1);
	assert.equal(remaining?.toolCallId, "tc-diff");
	assert.match(remaining?.summary ?? "", /git diff/);
});

test("an unmatched nameless end does not clear the only identified tool", () => {
	let tools: ActiveTool[] = [];
	tools = upsertActiveTool(tools, tool({
		toolCallId: "tc-diff",
		name: "bash",
		startedAt: 1,
		summary: "bash git diff",
	}));
	assert.equal(removeActiveTool(tools, { name: "read" }).length, 1);
	assert.equal(removeActiveTool(tools, { name: "read" })[0]?.toolCallId, "tc-diff");
	assert.equal(removeActiveTool(tools, {}).length, 1);
	assert.equal(removeActiveTool(tools, {})[0]?.toolCallId, "tc-diff");
	assert.equal(removeActiveTool(tools, { name: "bash" }).length, 1);
});

test("write delta keyed by contentIndex does not rewrite a later bash tool", () => {
	const applyWriteDelta = (order: "write-first" | "bash-first") => {
		let tools: ActiveTool[] = [];
		const ids = new Map<number, string>();
		const startWrite = () => {
			ids.set(0, "tc-write");
			tools = upsertActiveTool(tools, tool({
				toolCallId: "tc-write",
				name: "write",
				startedAt: order === "write-first" ? 10 : 20,
				summary: boundActivitySummary("write"),
			}));
		};
		const startBash = () => {
			ids.set(1, "tc-bash");
			tools = upsertActiveTool(tools, tool({
				toolCallId: "tc-bash",
				name: "bash",
				startedAt: order === "write-first" ? 20 : 10,
				summary: boundActivitySummary("bash", "git status"),
			}));
		};
		if (order === "write-first") {
			startWrite();
			startBash();
		} else {
			startBash();
			startWrite();
		}
		assert.equal(activeToolForContentIndex(tools, ids, 0, "write")?.toolCallId, "tc-write");
		if (order === "write-first") assert.equal(latestActiveTool(tools)?.toolCallId, "tc-bash");
		const target = activeToolForContentIndex(tools, ids, 0, "write");
		const mappedId = ids.get(0);
		tools = upsertActiveTool(tools, tool({
			...(mappedId ? { toolCallId: mappedId } : {}),
			name: "write",
			startedAt: target?.startedAt ?? 99,
			summary: boundActivitySummary("write", "/tmp/a.ts"),
		}));
		const bash = tools.find((item) => item.toolCallId === "tc-bash");
		const write = tools.find((item) => item.toolCallId === "tc-write");
		assert.equal(tools.length, 2);
		assert.match(bash?.summary ?? "", /git status/);
		assert.doesNotMatch(bash?.summary ?? "", /a\.ts/);
		assert.match(write?.summary ?? "", /a\.ts/);
	};
	applyWriteDelta("write-first");
	applyWriteDelta("bash-first");
});

test("activity events do not attach diagnostics and deltas do not use latest tool id", () => {
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	const projectFn = source.match(/const projectActiveTool = \(emit: boolean\) => \{[\s\S]*?\n\tconst beginActiveTool/);
	assert.ok(projectFn);
	assert.doesNotMatch(projectFn[0], /attachDiagnostics/);
	assert.doesNotMatch(projectFn[0], /diagnostics/);
	const delta = source.match(/ctype === "toolcall_delta"[\s\S]*?ctype === "toolcall_end"/);
	assert.ok(delta);
	assert.doesNotMatch(delta[0], /currentActiveTool/);
	assert.match(delta[0], /toolCallIdsByContentIndex/);
	assert.match(source, /toolCallIdsByContentIndex\.clear\(\)/);
});
