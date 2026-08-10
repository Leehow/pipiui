import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import {
  resolveSubagentToolSelection,
  shouldMountMcpExtension,
} from "../../Sources/PipiUI/PiExt/subagent/desktop-tool-policy.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceSubagentDirectory = join(repositoryRoot, "Sources/PipiUI/PiExt/subagent");
const piPackageRoot = join(
  homedir(),
  ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent",
);

async function loadAgentRuntime(directory) {
  const runtime = join(directory, "runtime/subagent");
  const scoped = join(directory, "runtime/node_modules/@earendil-works");
  await mkdir(runtime, { recursive: true });
  await mkdir(scoped, { recursive: true });
  await Promise.all([
    cp(join(sourceSubagentDirectory, "agents.ts"), join(runtime, "agents.ts")),
    cp(join(sourceSubagentDirectory, "runtime-policy.ts"), join(runtime, "runtime-policy.ts")),
    symlink(piPackageRoot, join(scoped, "pi-coding-agent"), "dir"),
  ]);
  return import(`${pathToFileURL(join(runtime, "agents.ts")).href}?test=${Date.now()}`)
    .then(async (agents) => ({
      ...agents,
      policy: await import(`${pathToFileURL(join(runtime, "runtime-policy.ts")).href}?test=${Date.now()}`),
    }));
}

async function writeLegacy(root, name, frontmatter, body = "Return a report.") {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, `${name}.md`), `---\n${frontmatter}\n---\n${body}\n`, "utf8");
}

async function writePackage(root, directoryName, frontmatter, body = "Return a report.") {
  const directory = join(root, directoryName);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "AGENT.md"), `---\n${frontmatter}\n---\n${body}\n`, "utf8");
}

const standardWriter = `schema: 1
name: writer
description: Narrow writable worker
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

function roots(directory) {
  return {
    userDir: join(directory, "user/agents"),
    projectAgentsDir: join(directory, "project/.pi/agents"),
    pipiuiAgentsDir: join(directory, "bundled/agents"),
  };
}

test("standard package parser compiles v1 capabilities and preserves legacy flat behavior", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-agent-package-"));
  try {
    const runtime = await loadAgentRuntime(directory);
    const r = roots(directory);
    await writePackage(r.userDir, "writer", standardWriter, "Implement only the requested change.");
    await writeLegacy(
      r.userDir,
      "legacy-reader",
      "name: legacy-reader\ndescription: Existing flat agent\ntools: read, bash, web_fetch\nread-only: true\ndeliverable: report",
    );

    const result = runtime.discoverAgentsFromRoots(r, "user");
    assert.equal(result.diagnostics.length, 0, runtime.formatAgentDiagnostics(result.diagnostics));

    const writer = result.agents.find((agent) => agent.name === "writer");
    assert.ok(writer);
    assert.equal(writer.schema, 1);
    assert.equal(writer.origin, "user");
    assert.equal(writer.mode, "worker");
    assert.equal(writer.worktree, "isolated");
    assert.equal(writer.deliverable, "implementation");
    assert.deepEqual(writer.tools, ["read", "write", "web_fetch", "mcp_safe_query", "subagent"]);
    assert.deepEqual(writer.capabilities, {
      filesystem: "workspace-write",
      shell: true,
      web: true,
      mcpTools: ["mcp_safe_query"],
      desktop: "requestable",
      delegation: true,
      legacy: false,
    });
    assert.deepEqual(writer.traits, {
      readOnly: false,
      delegates: true,
      blockSkillReads: false,
      reportsInFull: false,
    });

    const legacy = result.agents.find((agent) => agent.name === "legacy-reader");
    assert.ok(legacy);
    assert.equal(legacy.schema, "legacy");
    assert.deepEqual(legacy.tools, ["read", "bash", "web_fetch"]);
    assert.equal(legacy.capabilities.legacy, true);
    assert.equal(legacy.capabilities.desktop, "requestable", "flat legacy definitions retain desktop request compatibility");
    assert.equal(legacy.capabilities.delegation, true);
    assert.equal(legacy.traits.readOnly, true);
    assert.equal(legacy.traits.reportsInFull, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("scope precedence remains user < project < bundled, while project-only stays confirmable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-agent-precedence-"));
  try {
    const runtime = await loadAgentRuntime(directory);
    const r = roots(directory);
    await writeLegacy(r.userDir, "same", "name: same\ndescription: user version\ntools: read");
    await writePackage(
      r.projectAgentsDir,
      "same",
      standardWriter.replaceAll("writer", "same").replace("Narrow writable worker", "project version"),
    );
    await writePackage(
      r.pipiuiAgentsDir,
      "same",
      standardWriter.replaceAll("writer", "same").replace("Narrow writable worker", "bundled version"),
    );

    const both = runtime.discoverAgentsFromRoots(r, "both");
    const bothSame = both.agents.find((agent) => agent.name === "same");
    assert.equal(bothSame?.description, "bundled version");
    assert.equal(bothSame?.source, "user", "bundled roles keep historical user-scope semantics");
    assert.equal(bothSame?.origin, "bundled");

    const project = runtime.discoverAgentsFromRoots(r, "project");
    const projectSame = project.agents.find((agent) => agent.name === "same");
    assert.equal(projectSame?.description, "project version");
    assert.equal(projectSame?.source, "project", "existing project confirmation filter still selects this role");
    assert.equal(projectSame?.origin, "project");

    const user = runtime.discoverAgentsFromRoots(r, "user");
    assert.equal(user.agents.find((agent) => agent.name === "same")?.origin, "bundled");
    assert.ok(both.diagnostics.some((entry) => entry.code === "shadowed-name"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid schema/fields/duplicates fail closed with readable diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-agent-invalid-"));
  try {
    const runtime = await loadAgentRuntime(directory);
    const r = roots(directory);
    await writePackage(r.userDir, "bad-schema", standardWriter.replace("schema: 1", "schema: 2").replaceAll("writer", "bad-schema"));
    await writePackage(r.userDir, "unknown-cap", standardWriter.replaceAll("writer", "unknown-cap").replace("  web: true", "  web: true\n  browser: true"));
    await writePackage(r.userDir, "bad-mcp", standardWriter.replaceAll("writer", "bad-mcp").replace("  mcp:\n    tools:\n      - mcp_safe_query", "  mcp: true"));
    await writePackage(r.userDir, "browser-role", standardWriter.replaceAll("writer", "browser-role").replace("  - web_fetch", "  - browser"));
    await writeLegacy(r.userDir, "dupe", "name: dupe\ndescription: legacy duplicate\ntools: read");
    await writePackage(r.userDir, "dupe", standardWriter.replaceAll("writer", "dupe"));

    const result = runtime.discoverAgentsFromRoots(r, "user");
    for (const name of ["bad-schema", "unknown-cap", "bad-mcp", "browser-role", "dupe"]) {
      assert.equal(result.agents.some((agent) => agent.name === name), false, `${name} must not receive a fallback grant`);
    }
    const text = runtime.formatAgentDiagnostics(result.diagnostics);
    assert.match(text, /schema: 1/);
    assert.match(text, /Unknown capability `browser`/);
    assert.match(text, /all-server grants are not supported/);
    assert.match(text, /not available to dispatched workers/);
    assert.match(text, /Duplicate agent name `dupe`/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("explicit tools only intersect capabilities, global denylist still wins, and MCP stays exact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-agent-intersection-"));
  try {
    const runtime = await loadAgentRuntime(directory);
    const r = roots(directory);
    await writePackage(r.userDir, "writer", standardWriter);
    const agent = runtime.discoverAgentsFromRoots(r, "user").agents[0];
    const selection = resolveSubagentToolSelection({
      declaredTools: agent.tools,
      disabledTools: ["write", "web_fetch", "mcp_safe_query"],
      hasDesktopCapability: false,
      allowRecursiveDelegation: agent.capabilities.delegation,
      availableExtensionTools: ["web_fetch"],
    });
    assert.deepEqual(new Set(selection.names), new Set(["read", "subagent"]));
    assert.equal(shouldMountMcpExtension(selection), false, "disabled exact MCP name cannot mount a broad MCP route");

    const allowed = resolveSubagentToolSelection({
      declaredTools: agent.tools,
      disabledTools: [],
      hasDesktopCapability: false,
      allowRecursiveDelegation: true,
      availableExtensionTools: ["web_fetch"],
    });
    assert.ok(allowed.names.includes("mcp_safe_query"));
    assert.equal(shouldMountMcpExtension(allowed), true);

    const noDelegation = resolveSubagentToolSelection({
      declaredTools: agent.tools,
      disabledTools: [],
      hasDesktopCapability: false,
      allowRecursiveDelegation: false,
      availableExtensionTools: ["web_fetch"],
    });
    assert.equal(noDelegation.names.includes("subagent"), false, "runtime depth/trust denial outranks frontmatter");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bundled create-subagent skill uses standard SKILL.md frontmatter and a parser-valid v1 template", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-create-subagent-skill-"));
  try {
    const runtime = await loadAgentRuntime(directory);
    const r = roots(directory);
    const skillDirectory = join(repositoryRoot, "Sources/PipiUI/Resources/BuiltInSkills/create-subagent");
    const skill = await readFile(join(skillDirectory, "SKILL.md"), "utf8");
    const template = await readFile(join(skillDirectory, "AGENT.template.md"), "utf8");

    assert.match(skill, /^---\nname: create-subagent\ndescription: .+\n---/);
    assert.match(skill, /subagent_manage/);
    assert.match(skill, /action:"scaffold"/);
    assert.match(skill, /action:"validate"/);
    assert.match(skill, /action:"install"/);
    assert.match(skill, /Before any install/);
    assert.match(skill, /desktop: requestable/);
    assert.match(skill, /Never put[\s\S]*`browser` in `tools`/);
    assert.match(skill, /Never use `true`, `\*`, a server-wide grant/);

    const packageDirectory = join(r.userDir, "template-agent");
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(
      join(packageDirectory, "AGENT.md"),
      template.replace("name: example-subagent", "name: template-agent"),
      "utf8",
    );
    const result = runtime.discoverAgentsFromRoots(r, "user");
    assert.equal(result.diagnostics.length, 0, runtime.formatAgentDiagnostics(result.diagnostics));
    const agent = result.agents.find((entry) => entry.name === "template-agent");
    assert.ok(agent);
    assert.equal(agent.schema, 1);
    assert.equal(agent.mode, "read-only");
    assert.equal(agent.worktree, "none");
    assert.equal(agent.deliverable, "report");
    assert.deepEqual(agent.capabilities, {
      filesystem: "none",
      shell: false,
      web: false,
      mcpTools: [],
      desktop: "none",
      delegation: false,
      legacy: false,
    });
    assert.deepEqual(agent.tools, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("desktop remains requestable-only and custom secretary frontmatter cannot spoof bundled trust", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-agent-trust-"));
  try {
    const runtime = await loadAgentRuntime(directory);
    const r = roots(directory);
    await writePackage(r.projectAgentsDir, "secretary", `schema: 1
name: secretary
description: project impersonator
mode: worker
capabilities:
  filesystem: workspace-write
  shell: true
  web: false
  mcp: false
  desktop: requestable
  delegation: true
worktree: none
deliverable: implementation
tools: read, write, subagent`);
    await writePackage(r.pipiuiAgentsDir, "secretary", `schema: 1
name: secretary
description: bundled closeout
mode: worker
capabilities:
  filesystem: workspace-write
  shell: true
  web: false
  mcp: false
  desktop: none
  delegation: false
worktree: none
deliverable: verdict
tools: read, write, secretary_commit`);

    const projectAgent = runtime.discoverAgentsFromRoots(r, "project").agents[0];
    const projectPolicy = runtime.policy.runtimeRolePolicyForAgent(projectAgent);
    assert.deepEqual(projectPolicy, {
      role: "worker",
      worktree: "direct",
      allowRecursiveDelegation: true,
    });

    const bundledAgent = runtime.discoverAgentsFromRoots(r, "user").agents[0];
    const bundledPolicy = runtime.policy.runtimeRolePolicyForAgent(bundledAgent);
    assert.deepEqual(bundledPolicy, {
      role: "closeout-secretary",
      worktree: "main-session",
      allowRecursiveDelegation: false,
    });

    const noGrant = resolveSubagentToolSelection({
      declaredTools: [],
      disabledTools: [],
      hasDesktopCapability: false,
      allowRecursiveDelegation: false,
    });
    assert.deepEqual(noGrant, { flag: "--no-tools", names: [] });
    const granted = resolveSubagentToolSelection({
      declaredTools: [],
      disabledTools: [],
      hasDesktopCapability: true,
      allowRecursiveDelegation: false,
    });
    assert.deepEqual(new Set(granted.names), new Set(["computer", "open_application"]));

    await writePackage(r.userDir, "fake-commit", `schema: 1
name: fake-commit
description: tries trusted tool
mode: worker
capabilities:
  filesystem: workspace-write
  shell: true
  web: false
  mcp: false
  desktop: none
  delegation: false
worktree: none
deliverable: implementation
tools: secretary_commit`);
    const fakeResult = runtime.discoverAgentsFromRoots(r, "user");
    assert.equal(fakeResult.agents.some((agent) => agent.name === "fake-commit"), false);
    assert.match(runtime.formatAgentDiagnostics(fakeResult.diagnostics), /reserved for the bundled `secretary` runtime origin/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
