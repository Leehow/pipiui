import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceSubagentDirectory = join(repositoryRoot, "Sources/PipiUI/PiExt/subagent");
const piPackageRoot = join(
  homedir(),
  ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent",
);
const piNodeModules = join(piPackageRoot, "node_modules");

async function linkRuntimePackages(directory) {
  const scoped = join(directory, "node_modules/@earendil-works");
  await mkdir(scoped, { recursive: true });
  await Promise.all([
    symlink(piPackageRoot, join(scoped, "pi-coding-agent"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-agent-core"), join(scoped, "pi-agent-core"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-ai"), join(scoped, "pi-ai"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-tui"), join(scoped, "pi-tui"), "dir"),
    symlink(join(piNodeModules, "typebox"), join(directory, "node_modules/typebox"), "dir"),
  ]);
}

async function writePackage(root, name, frontmatter, body = "Return a concise result.") {
  const packageDirectory = join(root, name);
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(join(packageDirectory, "AGENT.md"), `---\n${frontmatter}\n---\n${body}\n`, "utf8");
}

const writerFrontmatter = `schema: 1
name: writer
description: Narrow writer
model: provider/writer
mode: worker
capabilities:
  filesystem: workspace-write
  shell: true
  web: true
  mcp:
    tools:
      - mcp_safe_query
  desktop: requestable
  delegation: true
worktree: isolated
deliverable: implementation
tools:
  - read
  - write
  - web_fetch
  - mcp_safe_query
  - subagent`;

async function prepareFixture(directory) {
  const home = join(directory, "home");
  const userAgents = join(home, ".pi/agent/agents");
  const project = join(directory, "project");
  const projectAgents = join(project, ".pi/agents");
  const bundledAgents = join(directory, "bundled/agents");
  const outside = join(directory, "outside");

  await Promise.all([
    mkdir(userAgents, { recursive: true }),
    mkdir(projectAgents, { recursive: true }),
    mkdir(bundledAgents, { recursive: true }),
    mkdir(outside, { recursive: true }),
  ]);
  await writeFile(
    join(userAgents, "legacy-reader.md"),
    "---\nname: legacy-reader\ndescription: Flat compatibility role\ntools: read, bash\nread-only: true\ndeliverable: report\n---\nReturn a report.\n",
    "utf8",
  );
  await writePackage(userAgents, "writer", writerFrontmatter);
  await writePackage(userAgents, "broken", "schema: 1\nname: broken\ndescription: Missing capability map\nmode: worker\nworktree: none\ndeliverable: implementation");
  await writeFile(join(userAgents, "duplicate.md"), "---\nname: duplicate\ndescription: legacy duplicate\ntools: read\n---\nreport\n", "utf8");
  await writePackage(userAgents, "duplicate", writerFrontmatter.replaceAll("writer", "duplicate"));
  await writePackage(projectAgents, "project-role", writerFrontmatter.replaceAll("writer", "project-role"));
  await writePackage(bundledAgents, "bundled-role", writerFrontmatter.replaceAll("writer", "bundled-role"));
  await writeFile(join(userAgents, "shadowed.md"), "---\nname: shadowed\ndescription: user shadow\ntools: read\n---\nreport\n", "utf8");
  await writePackage(projectAgents, "shadowed", writerFrontmatter.replaceAll("writer", "shadowed"));
  await writePackage(bundledAgents, "shadowed", writerFrontmatter.replaceAll("writer", "shadowed"));
  await symlink(outside, join(userAgents, "linked"), "dir");

  return { home, userAgents, project, projectAgents, bundledAgents, outside };
}

async function runHarness(directory, fixture) {
  await cp(sourceSubagentDirectory, join(directory, "subagent"), { recursive: true });
  await linkRuntimePackages(directory);
  const harness = join(directory, "harness.mts");
  await writeFile(
    harness,
    `import { statSync } from "node:fs";
import { join } from "node:path";
import install from "./subagent/index.ts";

const tools = new Map<string, any>();
install({
  registerTool(tool: any) { tools.set(tool.name, tool); },
  registerCommand() {},
  on() {},
  async sendUserMessage() {},
} as any);
const manage = tools.get("subagent_manage");
const subagent = tools.get("subagent");
if (!manage || !subagent) throw new Error("expected both management and dispatch tools");
const ctx = { cwd: process.env.PIPIUI_MAIN_CWD!, hasUI: false };
const signal = new AbortController().signal;
let sequence = 0;
async function call(params: any) {
  return manage.execute("manage-" + (++sequence), params, signal, undefined, ctx);
}
const output: Record<string, any> = {};
output.registered = { manage: manage.name, dispatch: subagent.name, manageDescription: manage.description };
output.list = await call({ action: "list", scope: "both" });
output.inspect = await call({ action: "inspect", scope: "user", name: "writer" });
output.inspectNotFound = await call({ action: "inspect", scope: "both", name: "missing-role" });
output.legacyValidation = await call({ action: "validate", scope: "user", path: "legacy-reader.md" });
output.invalidValidation = await call({
  action: "validate", scope: "user", name: "invalid", draft: "---\\nschema: 1\\nname: invalid\\ndescription: invalid\\nmode: worker\\nworktree: none\\ndeliverable: implementation\\n---\\nbody\\n",
});
output.scaffold = await call({
  action: "scaffold", scope: "user", name: "generated", description: "Generated least privilege role",
});
output.invalidScaffoldNames = {};
for (const name of ["Uppercase", "has/slash", ".."])
  output.invalidScaffoldNames[name] = await call({ action: "scaffold", scope: "user", name, description: "Invalid name" });
output.narrowedScaffold = await call({
  action: "scaffold", scope: "user", name: "narrowed", description: "Narrowed worker",
  mode: "worker", worktree: "isolated",
  capabilities: { filesystem: "workspace-write", shell: true, web: true, mcpTools: ["mcp_safe_query"], delegation: true },
  tools: ["read", "web_fetch", "mcp_safe_query"],
});
const generatedDraft = output.scaffold.details.data.content;
output.install = await call({ action: "install", scope: "user", name: "generated", draft: generatedDraft });
output.installedMode = statSync(join(process.env.HOME, ".pi/agent/agents/generated/AGENT.md")).mode & 0o777;
output.noOverwrite = await call({ action: "install", scope: "user", name: "generated", draft: generatedDraft });
output.overwrite = await call({
  action: "install", scope: "user", name: "generated", overwrite: true,
  draft: generatedDraft.replace("Generated least privilege role", "Replaced least privilege role"),
});
output.projectScaffold = await call({
  action: "scaffold", scope: "project", name: "project-created", description: "Project package",
});
output.projectInstall = await call({
  action: "install", scope: "project", name: "project-created", draft: output.projectScaffold.details.data.content,
});
output.traversal = await call({ action: "install", scope: "user", name: "../escape", draft: generatedDraft });
output.pathTraversal = await call({ action: "validate", scope: "user", path: "../outside/AGENT.md" });
output.symlinkEscape = await call({
  action: "install", scope: "user", name: "linked",
  draft: generatedDraft.replaceAll("generated", "linked"),
});
output.bundledWrite = await call({ action: "install", scope: "bundled", name: "nope", draft: generatedDraft });
process.stdout.write(JSON.stringify(output));
`,
    "utf8",
  );
  const { stdout } = await execFileAsync(process.execPath, ["--experimental-strip-types", harness], {
    cwd: directory,
    env: {
      ...process.env,
      HOME: fixture.home,
      PIPIUI_MAIN_CWD: fixture.project,
      PIPIUI_AGENTS_DIR: fixture.bundledAgents,
      PIPIUI_AGENT_DEPTH: "0",
      PIPIUI_AGENT_MAX_DEPTH: "2",
      PIPIUI_BRIDGE_PORT: "",
      PIPIUI_SESSION_KEY: "",
      PIPIUI_SUBAGENT_EXT: "",
      PIPIUI_SEARCH_SCOPE_EXT: "",
      PIPIUI_MCP_EXT: "",
      PIPIUI_COMPUTER_EXT: "",
      PIPIUI_COMPUTER_CAPABILITY: "",
    },
    timeout: 20_000,
    maxBuffer: 5 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

test("subagent_manage uses the real extension/parser for list, inspect, validate, scaffold, and safe install", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-subagent-manage-"));
  try {
    const fixture = await prepareFixture(directory);
    const result = await runHarness(directory, fixture);

    assert.equal(result.registered.manage, "subagent_manage");
    assert.equal(result.registered.dispatch, "subagent", "management registration must not replace dispatch");
    assert.match(result.registered.manageDescription, /never dispatches or starts an agent/i);

    const list = result.list.details;
    assert.equal(list.version, 1);
    assert.equal(list.success, true);
    assert.equal(list.action, "list");
    assert.ok(list.data.agents.some((agent) => agent.name === "legacy-reader" && agent.format === "legacy"));
    assert.ok(list.data.agents.some((agent) => agent.name === "project-role" && agent.origin === "project"));
    assert.ok(list.data.agents.some((agent) => agent.name === "bundled-role" && agent.origin === "bundled"));
    assert.ok(list.diagnostics.some((entry) => entry.code === "duplicate-name"));
    assert.ok(list.diagnostics.some((entry) => entry.code === "missing-field"));
    assert.ok(list.diagnostics.some((entry) => entry.code === "shadowed-name"));
    assert.equal(list.data.agents.find((agent) => agent.name === "shadowed")?.origin, "bundled");

    const inspected = result.inspect.details;
    assert.equal(inspected.success, true);
    const writer = inspected.data.agent;
    assert.equal(writer.origin, "user");
    assert.equal(writer.format, "package");
    assert.equal(writer.mode, "worker");
    assert.equal(writer.worktree, "isolated");
    assert.equal(writer.deliverable, "implementation");
    assert.deepEqual(writer.explicitTools, ["read", "write", "web_fetch", "mcp_safe_query", "subagent"]);
    assert.deepEqual(writer.permissionSummary.effectiveTools, writer.explicitTools);
    assert.ok(writer.permissionSummary.capabilityTools.includes("edit"));
    assert.ok(writer.permissionSummary.runtimeConstraints.some((line) => /disabled-tools/.test(line)));
    assert.ok(writer.permissionSummary.runtimeConstraints.some((line) => /per-task desktop grant/.test(line)));

    const inspectNotFound = result.inspectNotFound.details;
    assert.equal(inspectNotFound.success, false);
    assert.ok(inspectNotFound.diagnostics.some((entry) => entry.code === "not-found"));

    assert.equal(result.legacyValidation.details.success, true);
    assert.equal(result.legacyValidation.details.data.format, "legacy");
    assert.equal(result.legacyValidation.details.data.agent.format, "legacy");
    assert.equal(result.invalidValidation.details.success, false);
    assert.ok(result.invalidValidation.details.diagnostics.some((entry) => entry.code === "missing-field"));

    const scaffold = result.scaffold.details;
    assert.equal(scaffold.success, true);
    assert.match(scaffold.data.content, /^---\nschema: 1\nname: generated/m);
    assert.equal(scaffold.data.agent.capabilities.filesystem, "none");
    assert.equal(scaffold.data.agent.capabilities.desktop, "none");
    assert.deepEqual(scaffold.data.agent.tools, []);
    for (const [name, response] of Object.entries(result.invalidScaffoldNames)) {
      assert.equal(response.details.success, false, `${name} must not scaffold`);
      assert.ok(response.details.diagnostics.some((entry) => entry.code === "scaffold-failed"));
    }

    const narrowed = result.narrowedScaffold.details;
    assert.equal(narrowed.success, true);
    assert.match(narrowed.data.content, /filesystem: workspace-write/);
    assert.match(narrowed.data.content, /shell: true/);
    assert.match(narrowed.data.content, /web: true/);
    assert.match(narrowed.data.content, /- "read"\n  - "web_fetch"\n  - "mcp_safe_query"/);
    assert.deepEqual(narrowed.data.agent.explicitTools, ["read", "web_fetch", "mcp_safe_query"]);
    assert.deepEqual(narrowed.data.agent.permissionSummary.effectiveTools, ["read", "web_fetch", "mcp_safe_query"]);
    assert.deepEqual(
      narrowed.data.agent.permissionSummary.effectiveTools,
      narrowed.data.agent.permissionSummary.capabilityTools.filter((tool) =>
        narrowed.data.agent.explicitTools.includes(tool),
      ),
      "explicit tools must be a capability-derived intersection",
    );

    assert.equal(result.install.details.success, true);
    assert.equal(result.installedMode, 0o600, "the committed inode must retain staging's private mode");
    assert.match(result.install.details.data.targetPath, /\.pi\/agent\/agents\/generated\/AGENT\.md$/);
    assert.equal(result.noOverwrite.details.success, false);
    assert.ok(result.noOverwrite.details.diagnostics.some((entry) => entry.code === "already-exists"));
    assert.equal(result.overwrite.details.success, true);
    assert.equal(result.projectInstall.details.success, true);
    assert.match(result.projectInstall.details.data.targetPath, /project\/\.pi\/agents\/project-created\/AGENT\.md$/);

    assert.equal(result.traversal.details.success, false);
    assert.match(result.traversal.details.diagnostics[0].message, /traversal|separators/i);
    assert.equal(result.pathTraversal.details.success, false);
    assert.match(result.pathTraversal.details.diagnostics[0].message, /traversal/i);
    assert.equal(result.symlinkEscape.details.success, false);
    assert.match(result.symlinkEscape.details.diagnostics[0].message, /symlink/i);
    assert.equal(result.bundledWrite.details.success, false);
    assert.match(result.bundledWrite.details.diagnostics[0].message, /bundled.*read-only|only user or project/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
