import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	convertPiSubagentDefinition,
	parsePiSubagentFile,
	parsePiSubagentList,
	renderPackageDraft,
} from "../agent-import.ts";
import { validateAgentDefinition, type AgentDiagnostic } from "../agents.ts";
import { executeManage } from "../agent-management.ts";

const samplesDir = fileURLToPath(new URL("../../agent-samples/pi-subagents", import.meta.url));
const bundledAgentsDir = fileURLToPath(new URL("../../agents", import.meta.url));

function sample(name: string): string {
	return readFileSync(join(samplesDir, `${name}.md`), "utf8");
}

function errors(diagnostics: AgentDiagnostic[]): AgentDiagnostic[] {
	return diagnostics.filter((entry) => entry.severity === "error");
}

/** Every draft must survive the exact runtime parser as a project package. */
function validateDraft(name: string, draft: string) {
	return validateAgentDefinition({
		filePath: `/virtual/.pi/agents/${name}/AGENT.md`,
		content: draft,
		source: "project",
		origin: "project",
		format: "package",
		directoryName: name,
	});
}

test("frontmatter grammar: quoted scalars, block lists, folded and literal blocks", () => {
	const parsed = parsePiSubagentFile([
		"---",
		"name: demo",
		'description: "Quoted: with colon"',
		"tools:",
		"  - read",
		"  - grep, find",
		"summary: >",
		"  first line",
		"  second line",
		"",
		"  new paragraph",
		"notes: |",
		"  keep",
		"    indent",
		"# a comment line is ignored",
		"---",
		"",
		"Body text.",
	].join("\n"));
	assert.equal(parsed.hasFrontmatter, true);
	assert.equal(parsed.fields.get("description"), "Quoted: with colon");
	assert.deepEqual(parsePiSubagentList(parsed.fields.get("tools")), ["read", "grep", "find"]);
	assert.equal(parsed.fields.get("summary"), "first line second line\nnew paragraph");
	assert.equal(parsed.fields.get("notes"), "keep\n  indent");
	assert.equal(parsed.fields.has("#"), false);
	assert.equal(parsed.body, "Body text.");
});

test("a file without a frontmatter block is rejected, never guessed", () => {
	const result = convertPiSubagentDefinition("Just prose.", { source: "x.md" });
	assert.equal(result.ok, false);
	assert.deepEqual(errors(result.diagnostics).map((entry) => entry.code), ["missing-frontmatter"]);
});

test("every vendored sample converts and validates as a project package", () => {
	const files = readdirSync(samplesDir).filter((entry) => entry.endsWith(".md")).sort();
	assert.deepEqual(files, ["delegate.md", "oracle.md", "researcher.md", "reviewer.md", "scout.md", "worker.md"]);
	for (const file of files) {
		const name = file.replace(/\.md$/, "");
		const result = convertPiSubagentDefinition(sample(name), { source: `sample:${name}` });
		assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.diagnostics)}`);
		// A new upstream field must land in the drop table, not in the unknown bucket.
		assert.deepEqual(
			result.diagnostics.filter((entry) => entry.code === "unknown-upstream-field"),
			[],
			`${name} carries an upstream field the converter does not know`,
		);
		const validation = validateDraft(name, result.draft!);
		assert.deepEqual(errors(validation.diagnostics), [], `${name}: ${JSON.stringify(validation.diagnostics)}`);
		assert.ok(validation.agent, name);
		assert.equal(validation.agent!.name, name);
	}
});

test("scout: write tool makes it a workspace-write worker; contact_supervisor is reported as runtime-issued", () => {
	const result = convertPiSubagentDefinition(sample("scout"), { source: "sample:scout" });
	assert.equal(result.ok, true);
	const mapping = result.mapping!;
	assert.equal(mapping.mode, "worker");
	assert.equal(mapping.worktree, "isolated");
	assert.equal(mapping.deliverable, "implementation");
	assert.deepEqual(mapping.capabilities, { filesystem: "workspace-write", shell: true, web: false, mcpTools: [], delegation: false });
	assert.deepEqual(mapping.tools, ["bash", "find", "grep", "ls", "read", "write"]);
	assert.equal(mapping.thinking, "low");
	assert.deepEqual(result.droppedTools, [
		{ tool: "contact_supervisor", reason: "PipiUI issues `ask_boss` to every dispatched worker; it is not granted by frontmatter." },
	]);
	const droppedFields = result.droppedFields.map((entry) => entry.field).sort();
	assert.deepEqual(droppedFields, ["defaultProgress", "inheritProjectContext", "inheritSkills", "output", "systemPromptMode"]);
	// Prompt body is carried verbatim.
	assert.ok(result.draft!.includes("You are a scouting subagent running inside pi."));
});

test("reviewer: read-only tools give a read-only report role; deliverable can be overridden, never guessed", () => {
	const plain = convertPiSubagentDefinition(sample("reviewer"), { source: "sample:reviewer" });
	assert.equal(plain.mapping!.mode, "read-only");
	assert.equal(plain.mapping!.worktree, "none");
	assert.equal(plain.mapping!.deliverable, "report");
	assert.deepEqual(plain.mapping!.tools, ["find", "grep", "ls", "read"]);
	const verdict = convertPiSubagentDefinition(sample("reviewer"), { source: "sample:reviewer", deliverable: "verdict" });
	assert.equal(verdict.mapping!.deliverable, "verdict");
	assert.ok(verdict.draft!.includes("deliverable: verdict"));
});

test("researcher: web tools map to the web capability and the narrow allowlist survives validation", () => {
	const result = convertPiSubagentDefinition(sample("researcher"), { source: "sample:researcher" });
	assert.equal(result.ok, true);
	assert.deepEqual(result.mapping!.capabilities, { filesystem: "workspace-write", shell: false, web: true, mcpTools: [], delegation: false });
	assert.deepEqual(result.mapping!.tools, ["fetch_content", "get_search_content", "read", "source_check", "web_search", "write"]);
	const validation = validateDraft("researcher", result.draft!);
	assert.deepEqual(errors(validation.diagnostics), []);
	const tools = validation.agent!.tools ?? [];
	assert.ok(tools.includes("web_search"));
	assert.ok(tools.includes("write"));
	assert.equal(tools.includes("edit"), false, "upstream did not allow edit; the narrowing must hold");
	assert.equal(tools.includes("bash"), false);
});

test("oracle: bash without edit/write stays read-only with shell", () => {
	const result = convertPiSubagentDefinition(sample("oracle"), { source: "sample:oracle" });
	assert.deepEqual(result.mapping!.capabilities, { filesystem: "read-only", shell: true, web: false, mcpTools: [], delegation: false });
	assert.equal(result.mapping!.mode, "read-only");
	assert.ok(result.droppedFields.some((entry) => entry.field === "defaultContext" && entry.reason.includes("fork: true")));
	assert.ok(result.droppedFields.some((entry) => entry.field === "aliases"));
});

test("mode can be forced read-only, which removes write tools and says so", () => {
	const result = convertPiSubagentDefinition(sample("scout"), { source: "sample:scout", mode: "read-only" });
	assert.equal(result.mapping!.mode, "read-only");
	assert.equal(result.mapping!.worktree, "none");
	assert.equal(result.mapping!.capabilities.filesystem, "read-only");
	assert.deepEqual(result.mapping!.tools, ["bash", "find", "grep", "ls", "read"]);
	assert.ok(result.droppedTools.some((entry) => entry.tool === "write" && entry.reason === "mode was forced to read-only."));
	assert.deepEqual(errors(validateDraft("scout", result.draft!).diagnostics), []);
});

test("omitted tools mean pi's builtin set; excludeTools narrows it", () => {
	const content = ["---", "name: plain", "description: d", "excludeTools: bash, edit", "---", "Do it."].join("\n");
	const result = convertPiSubagentDefinition(content, { source: "plain.md" });
	assert.equal(result.ok, true);
	assert.deepEqual(result.mapping!.tools, ["find", "grep", "ls", "read", "write"]);
	assert.equal(result.mapping!.capabilities.shell, false);
	assert.equal(result.mapping!.capabilities.filesystem, "workspace-write");
	assert.ok(result.droppedFields.some((entry) => entry.field === "tools" && entry.value === "(omitted)"));
	assert.ok(result.droppedFields.some((entry) => entry.field === "excludeTools" && entry.reason.startsWith("applied")));
});

test("delegation: `subagent` or allowNestedSubagents grants the whole PipiUI delegation set", () => {
	const viaTool = convertPiSubagentDefinition(["---", "name: lead", "description: d", "tools: read, subagent", "---", "Lead."].join("\n"), { source: "lead.md" });
	assert.equal(viaTool.mapping!.capabilities.delegation, true);
	assert.deepEqual(viaTool.mapping!.tools, ["read", "subagent", "subagent_chain", "subagent_abort", "subagent_resolve", "subagent_status"]);
	assert.deepEqual(errors(validateDraft("lead", viaTool.draft!).diagnostics), []);
	const viaFlag = convertPiSubagentDefinition(["---", "name: lead", "description: d", "tools: read", "allowNestedSubagents: true", "---", "Lead."].join("\n"), { source: "lead.md" });
	assert.equal(viaFlag.mapping!.capabilities.delegation, true);
});

test("mcp:<server>/<tool> becomes mcp_<server>_<tool>; malformed references are dropped", () => {
	const content = ["---", "name: mcpuser", "description: d", "tools: read, mcp:github/list_issues, mcp:bad ref", "---", "Use MCP."].join("\n");
	const result = convertPiSubagentDefinition(content, { source: "m.md" });
	assert.deepEqual(result.mapping!.capabilities.mcpTools, ["mcp_github_list_issues"]);
	assert.ok(result.mapping!.tools.includes("mcp_github_list_issues"));
	assert.ok(result.droppedTools.some((entry) => entry.tool === "mcp:bad ref"));
	assert.deepEqual(errors(validateDraft("mcpuser", result.draft!).diagnostics), []);
});

test("model is kept only when provider-qualified; thinking:false is dropped", () => {
	const kept = convertPiSubagentDefinition(["---", "name: m1", "description: d", "model: xai/grok-4.5:high", "thinking: high", "---", "x"].join("\n"), { source: "m1.md" });
	assert.equal(kept.mapping!.model, "xai/grok-4.5:high");
	assert.equal(kept.mapping!.thinking, "high");
	assert.ok(kept.draft!.includes('model: "xai/grok-4.5:high"'));
	const dropped = convertPiSubagentDefinition(["---", "name: m2", "description: d", "model: claude-sonnet-4-5", "thinking: false", "---", "x"].join("\n"), { source: "m2.md" });
	assert.equal(dropped.mapping!.model, undefined);
	assert.ok(dropped.droppedFields.some((entry) => entry.field === "model" && entry.value === "claude-sonnet-4-5"));
	assert.ok(dropped.droppedFields.some((entry) => entry.field === "thinking"));
	assert.deepEqual(errors(validateDraft("m1", kept.draft!).diagnostics), []);
});

test("external runners are refused with unsupported-runner, before anything else is mapped", () => {
	const content = [
		"---",
		"name: codex-exec",
		"description: Read-only Codex run",
		"runner:",
		"  type: external-cli",
		"  adapter: codex-exec",
		"  command: codex",
		"async: true",
		"---",
		"Analyze.",
	].join("\n");
	const result = convertPiSubagentDefinition(content, { source: "codex-exec.md" });
	assert.equal(result.ok, false);
	assert.deepEqual(errors(result.diagnostics).map((entry) => entry.code), ["unsupported-runner"]);
	assert.equal(result.draft, undefined);
	const native = convertPiSubagentDefinition(content.replace("external-cli", "pi").replace("  adapter: codex-exec\n  command: codex\n", ""), { source: "n.md" });
	assert.equal(native.ok, true);
	assert.ok(native.droppedFields.some((entry) => entry.field === "runner"));
});

test("missing name/description/body fail closed; `as` renames and invalid names are refused", () => {
	const noDescription = convertPiSubagentDefinition(["---", "name: x", "---", "body"].join("\n"), { source: "x.md" });
	assert.deepEqual(errors(noDescription.diagnostics).map((entry) => entry.code), ["missing-field"]);
	const noBody = convertPiSubagentDefinition(["---", "name: x", "description: d", "---", ""].join("\n"), { source: "x.md" });
	assert.deepEqual(errors(noBody.diagnostics).map((entry) => entry.code), ["missing-prompt"]);
	const renamed = convertPiSubagentDefinition(sample("reviewer"), { source: "sample:reviewer", name: "upstream-reviewer" });
	assert.equal(renamed.name, "upstream-reviewer");
	assert.equal(renamed.provenance.upstreamName, "reviewer");
	assert.ok(renamed.draft!.includes("name: upstream-reviewer"));
	const bad = convertPiSubagentDefinition(["---", "name: Bad_Name", "description: d", "---", "b"].join("\n"), { source: "b.md" });
	assert.deepEqual(errors(bad.diagnostics).map((entry) => entry.code), ["invalid-name"]);
});

test("unknown upstream fields are dropped with a warning instead of vanishing", () => {
	const result = convertPiSubagentDefinition(["---", "name: n", "description: d", "brandNewField: 1", "---", "b"].join("\n"), { source: "n.md" });
	assert.equal(result.ok, true);
	assert.deepEqual(result.diagnostics.map((entry) => entry.code), ["unknown-upstream-field"]);
	assert.ok(result.droppedFields.some((entry) => entry.field === "brandNewField"));
});

test("renderPackageDraft is the shared serializer and round-trips through the parser", () => {
	const draft = renderPackageDraft({
		name: "roundtrip",
		description: "A \"quoted\" description: with colon",
		mode: "worker",
		capabilities: { filesystem: "workspace-write", shell: true, web: false, mcpTools: [], delegation: false },
		worktree: "isolated",
		deliverable: "implementation",
		tools: ["read", "edit"],
		prompt: "Prompt body.",
	});
	const validation = validateDraft("roundtrip", draft);
	assert.deepEqual(errors(validation.diagnostics), []);
	assert.equal(validation.agent!.description, "A \"quoted\" description: with colon");
	assert.deepEqual(validation.agent!.explicitTools, ["read", "edit"]);
});

// --- management action (real files, temp roots) -------------------------------

function tempProject(): string {
	return mkdtempSync(join(tmpdir(), "pipiui-agent-import-"));
}

function withEnv<T>(overrides: Record<string, string | undefined>, run: () => T): T {
	const previous = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(overrides)) {
		previous.set(key, process.env[key]);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		return run();
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test("import action: sample → project package with IMPORT.json provenance; dryRun writes nothing", () => {
	const cwd = tempProject();
	const userDir = join(cwd, "user-home");
	withEnv({ PI_CODING_AGENT_DIR: userDir, PIPIUI_AGENTS_DIR: bundledAgentsDir }, () => {
		const preview = executeManage({ action: "import", sample: "oracle", scope: "project", dryRun: true }, cwd);
		assert.equal(preview.success, true, JSON.stringify(preview.diagnostics));
		assert.equal(existsSync(join(cwd, ".pi", "agents", "oracle")), false);
		const imported = preview.data.imported as Array<Record<string, unknown>>;
		assert.equal(imported.length, 1);
		assert.equal(imported[0].name, "oracle");
		assert.equal(typeof imported[0].draft, "string");

		const installed = executeManage({ action: "import", sample: "oracle", scope: "project" }, cwd);
		assert.equal(installed.success, true, JSON.stringify(installed.diagnostics));
		const target = join(cwd, ".pi", "agents", "oracle", "AGENT.md");
		assert.equal(existsSync(target), true);
		const provenance = JSON.parse(readFileSync(join(cwd, ".pi", "agents", "oracle", "IMPORT.json"), "utf8"));
		assert.equal(provenance.version, 1);
		assert.equal(provenance.format, "pi-subagents");
		assert.equal(provenance.source, "sample:oracle");
		assert.equal(typeof provenance.sha256, "string");
		assert.ok(Array.isArray(provenance.droppedFields));
		// The installed package is now discoverable through inspect.
		const inspected = executeManage({ action: "inspect", name: "oracle", scope: "project" }, cwd);
		assert.equal(inspected.success, true, JSON.stringify(inspected.diagnostics));
		// Second install without overwrite is refused by the shared install path.
		const again = executeManage({ action: "import", sample: "oracle", scope: "project" }, cwd);
		assert.equal(again.success, false);
		assert.ok(again.diagnostics.some((entry) => entry.code === "already-exists"));
	});
});

test("import action: bundled name collision is refused and `as` resolves it", () => {
	const cwd = tempProject();
	withEnv({ PI_CODING_AGENT_DIR: join(cwd, "user-home"), PIPIUI_AGENTS_DIR: bundledAgentsDir }, () => {
		const collision = executeManage({ action: "import", sample: "reviewer", scope: "project" }, cwd);
		assert.equal(collision.success, false);
		assert.ok(collision.diagnostics.some((entry) => entry.code === "name-conflict-bundled"), JSON.stringify(collision.diagnostics));
		const renamed = executeManage({ action: "import", sample: "reviewer", scope: "project", as: "upstream-reviewer" }, cwd);
		assert.equal(renamed.success, true, JSON.stringify(renamed.diagnostics));
		assert.equal(existsSync(join(cwd, ".pi", "agents", "upstream-reviewer", "AGENT.md")), true);
	});
});

test("import action: a directory source imports every native file, skips external runners, and reports both", () => {
	const cwd = tempProject();
	const sourceDir = join(cwd, "incoming");
	mkdirSync(sourceDir, { recursive: true });
	writeFileSync(join(sourceDir, "scout.md"), sample("scout"));
	writeFileSync(join(sourceDir, "codex-exec.md"), ["---", "name: codex-exec", "description: d", "runner:", "  type: external-cli", "  adapter: codex-exec", "  command: codex", "---", "x"].join("\n"));
	writeFileSync(join(sourceDir, "review.chain.md"), "chain file");
	writeFileSync(join(sourceDir, "notes.txt"), "not an agent");
	withEnv({ PI_CODING_AGENT_DIR: join(cwd, "user-home"), PIPIUI_AGENTS_DIR: bundledAgentsDir }, () => {
		const result = executeManage({ action: "import", source: "incoming", scope: "project" }, cwd);
		assert.equal(result.success, true, JSON.stringify(result.diagnostics));
		const imported = result.data.imported as Array<Record<string, unknown>>;
		const skipped = result.data.skipped as Array<Record<string, unknown>>;
		assert.deepEqual(imported.map((entry) => entry.name), ["scout"]);
		assert.equal(skipped.length, 1);
		assert.ok(String(skipped[0].source).endsWith("codex-exec.md"));
		assert.equal(existsSync(join(cwd, ".pi", "agents", "scout", "AGENT.md")), true);
		const withAs = executeManage({ action: "import", source: "incoming", scope: "project", as: "x" }, cwd);
		assert.equal(withAs.success, false);
		assert.ok(withAs.diagnostics.some((entry) => entry.code === "invalid-as"));
	});
});

test("import action: unknown sample lists the available ones; missing source is an error", () => {
	const cwd = tempProject();
	withEnv({ PI_CODING_AGENT_DIR: join(cwd, "user-home") }, () => {
		const unknown = executeManage({ action: "import", sample: "nope", scope: "project" }, cwd);
		assert.equal(unknown.success, false);
		const message = unknown.diagnostics.map((entry) => entry.message).join("\n");
		assert.ok(message.includes("oracle") && message.includes("scout"), message);
		const missing = executeManage({ action: "import", source: "does-not-exist.md", scope: "project" }, cwd);
		assert.equal(missing.success, false);
		assert.ok(missing.diagnostics.some((entry) => entry.code === "source-not-found"));
		const neither = executeManage({ action: "import", scope: "project" }, cwd);
		assert.equal(neither.success, false);
		assert.ok(neither.diagnostics.some((entry) => entry.code === "missing-source"));
	});
});
