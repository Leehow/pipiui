import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { createPiHostBackend } from "../src/index.js";
import {
  applyExtensionAgentContributions,
  captureExtensionToolOwnership,
  discoverBundledAgentsFromDirectory,
  dispatchToolPatch,
  parseExtensionAgentContributionSnapshot,
  resetExtensionToolOwnership,
} from "../../../resources/runtime/pi-ext/subagent/agents.ts";
import { resolveSubagentToolSelection } from "../../../resources/runtime/pi-ext/subagent/desktop-tool-policy.mjs";
import {
  AGENT_CONTRIBUTIONS_ENV,
  assemblePiSpawn,
  MOUNTED_EXTENSIONS_ENV,
  REGISTERED_EXTENSION_PATHS_ENV,
  serializeAgentContributions,
} from "../src/spawn-assembly.js";

const ownedToolFixture = fileURLToPath(
  new URL("../../../resources/runtime/pi-ext/subagent/test/fixtures/owned-tool-extension.ts", import.meta.url),
);

const bundled = discoverBundledAgentsFromDirectory(
  join(process.cwd(), "resources/runtime/pi-ext/agents"),
);

let root = "";
afterEach(async () => {
  resetExtensionToolOwnership();
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

describe("backend serialize → runtime parse snapshot contract", () => {
  it("round-trips serializeAgentContributions into parseExtensionAgentContributionSnapshot and discovery", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-contrib-roundtrip-"));
    const extRoot = join(root, "ext-research");
    const agentDir = join(extRoot, "agents", "ext-researcher");
    await mkdir(agentDir, { recursive: true });
    const agentPath = join(agentDir, "AGENT.md");
    await writeFile(
      agentPath,
      `---
schema: 1
name: ext-researcher
description: Extension researcher
mode: read-only
capabilities:
  filesystem: read-only
  shell: false
  web: false
  mcp: false
  desktop: none
  delegation: false
worktree: none
deliverable: report
tools: read, grep, ls
---
You are ext-researcher.
`,
    );
    const packages = [
      {
        id: "ext-research",
        enabled: true,
        extensionPath: join(extRoot, "agent.js"),
        agentContribution: {
          id: "ext-research",
          origin: "project" as const,
          root: extRoot,
          agents: [agentPath],
          patches: [{ target: "explore", addTools: ["ls"] }],
        },
      },
    ];
    const json = serializeAgentContributions(packages);
    expect(json).toBeDefined();
    expect(JSON.parse(json!)).toMatchObject({ version: 1, extensions: [{ id: "ext-research" }] });
    expect(Array.isArray(JSON.parse(json!))).toBe(false);

    const parsed = parseExtensionAgentContributionSnapshot(json!);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.extensions).toHaveLength(1);
    expect(parsed.extensions[0]).toMatchObject({
      id: "ext-research",
      origin: "project",
      root: extRoot,
      agents: [agentPath],
    });

    const merged = applyExtensionAgentContributions(bundled, parsed);
    expect(merged.agents.some((agent) => agent.name === "ext-researcher")).toBe(true);
    expect(merged.agents.filter((agent) => agent.name === "explore")).toHaveLength(1);

    const { env } = assemblePiSpawn({
      cwd: root,
      paths: { updateCenter: "/runtime/update.ts", runtimeInfo: "/runtime/info.ts" },
      registeredExtensions: packages,
    });
    expect(env[AGENT_CONTRIBUTIONS_ENV]).toBe(json);
    const fromEnv = parseExtensionAgentContributionSnapshot(env[AGENT_CONTRIBUTIONS_ENV]!);
    expect(fromEnv.extensions.map((item) => item.id)).toEqual(["ext-research"]);
    expect(applyExtensionAgentContributions(bundled, fromEnv).agents.map((agent) => agent.name))
      .toEqual(expect.arrayContaining(["ext-researcher", "explore"]));
  });
});

async function loadOwnedToolFixture() {
  const mod = await import(ownedToolFixture) as {
    default: (pi: { registerTool: (tool: { name: string }) => void }) => void;
  };
  const tools: Array<{ name: string }> = [];
  mod.default({ registerTool: (tool) => tools.push({ name: tool.name }) });
  return tools;
}

async function writeNarrowRole(dir: string): Promise<string> {
  const agentDir = join(dir, "agents", "narrow-role");
  await mkdir(agentDir, { recursive: true });
  const agentPath = join(agentDir, "AGENT.md");
  await writeFile(
    agentPath,
    `---
schema: 1
name: narrow-role
description: Narrow contributed role
mode: read-only
capabilities:
  filesystem: read-only
  shell: false
  web: false
  mcp: false
  desktop: none
  delegation: false
worktree: none
deliverable: report
tools: read, grep
---
You are narrow-role.
`,
  );
  return agentPath;
}

function workerNames(agentName: string, packages: NonNullable<Parameters<typeof assemblePiSpawn>[0]["registeredExtensions"]>) {
  const { args, env } = assemblePiSpawn({
    cwd: root,
    paths: { updateCenter: "/runtime/update.ts", runtimeInfo: "/runtime/info.ts" },
    registeredExtensions: packages,
  });
  const snapshotJson = env[AGENT_CONTRIBUTIONS_ENV];
  if (snapshotJson) expect(snapshotJson).not.toContain("providedTools");
  const snapshot = snapshotJson
    ? parseExtensionAgentContributionSnapshot(snapshotJson)
    : { extensions: [], diagnostics: [] };
  const merged = applyExtensionAgentContributions(bundled, snapshot);
  const agent = merged.agents.find((entry) => entry.name === agentName);
  expect(agent).toBeTruthy();
  const mounted = (env[MOUNTED_EXTENSIONS_ENV] ?? "").split(",").filter(Boolean);
  const patched = dispatchToolPatch(agent!, mounted);
  const selection = resolveSubagentToolSelection({
    declaredTools: patched.declaredTools,
    disabledTools: [],
    hasDesktopCapability: false,
    allowRecursiveDelegation: false,
    availableExtensionTools: [],
  });
  return { args, env, selection, agent: agent! };
}

describe("backend mount → runtime registerTool ownership → worker --tools", () => {
  it("adds owned_tool only when the same enabled extension registered it", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-owned-tool-chain-"));
    const tools = await loadOwnedToolFixture();
    expect(tools.map((tool) => tool.name)).toEqual(["owned_tool"]);
    const agentPath = await writeNarrowRole(root);
    const packages = [{
      id: "ext.owner",
      enabled: true,
      extensionPath: ownedToolFixture,
      agentContribution: {
        id: "ext.owner",
        origin: "project" as const,
        root,
        agents: [agentPath],
        patches: [{ target: "narrow-role", addTools: ["owned_tool"] }],
      },
    }];
    const { env } = assemblePiSpawn({
      cwd: root,
      paths: { updateCenter: "/runtime/update.ts", runtimeInfo: "/runtime/info.ts" },
      registeredExtensions: packages,
    });
    expect(env[MOUNTED_EXTENSIONS_ENV]).toBe("ext.owner");
    expect(env[REGISTERED_EXTENSION_PATHS_ENV]).toBe(ownedToolFixture);
    captureExtensionToolOwnership({
      extensions: [{ path: ownedToolFixture, tools }],
      mounts: [{ id: "ext.owner", path: ownedToolFixture }],
    });
    const { selection } = workerNames("narrow-role", packages);
    expect(selection.flag).toBe("--tools");
    expect(selection.names).toContain("owned_tool");
  });

  it("rejects the same name registered by a different mounted extension", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-owned-tool-other-"));
    const tools = await loadOwnedToolFixture();
    const agentPath = await writeNarrowRole(root);
    const otherPath = join(root, "other-ext.ts");
    captureExtensionToolOwnership({
      extensions: [{ path: otherPath, tools }],
      mounts: [
        { id: "ext.owner", path: ownedToolFixture },
        { id: "ext.other", path: otherPath },
      ],
    });
    const { selection } = workerNames("narrow-role", [
      {
        id: "ext.owner",
        enabled: true,
        extensionPath: ownedToolFixture,
        agentContribution: {
          id: "ext.owner",
          origin: "project",
          root,
          agents: [agentPath],
          patches: [{ target: "narrow-role", addTools: ["owned_tool"] }],
        },
      },
      {
        id: "ext.other",
        enabled: true,
        extensionPath: otherPath,
      },
    ]);
    expect(selection.names).not.toContain("owned_tool");
  });

  it("rejects unmounted and disabled extensions", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-owned-tool-disabled-"));
    const tools = await loadOwnedToolFixture();
    const agentPath = await writeNarrowRole(root);
    const disabledSpawn = assemblePiSpawn({
      cwd: root,
      paths: { updateCenter: "/runtime/update.ts", runtimeInfo: "/runtime/info.ts" },
      registeredExtensions: [{
        id: "ext.owner",
        enabled: false,
        extensionPath: ownedToolFixture,
        agentContribution: {
          id: "ext.owner",
          origin: "project",
          root,
          agents: [agentPath],
          patches: [{ target: "narrow-role", addTools: ["owned_tool"] }],
        },
      }],
    });
    expect(disabledSpawn.env[MOUNTED_EXTENSIONS_ENV]).toBeUndefined();
    expect(disabledSpawn.env[AGENT_CONTRIBUTIONS_ENV]).toBeUndefined();
    expect(disabledSpawn.args.includes(ownedToolFixture)).toBe(false);

    captureExtensionToolOwnership({
      extensions: [{ path: ownedToolFixture, tools }],
      mounts: [{ id: "ext.owner", path: ownedToolFixture }],
    });
    const unmounted = applyExtensionAgentContributions(bundled, parseExtensionAgentContributionSnapshot(JSON.stringify({
      version: 1,
      extensions: [{
        id: "ext.owner",
        origin: "project",
        root,
        agents: [agentPath],
        patches: [{ target: "narrow-role", addTools: ["owned_tool"] }],
      }],
    })));
    const role = unmounted.agents.find((entry) => entry.name === "narrow-role")!;
    const patched = dispatchToolPatch(role, []);
    expect(resolveSubagentToolSelection({
      declaredTools: patched.declaredTools,
      disabledTools: [],
      hasDesktopCapability: false,
      allowRecursiveDelegation: false,
      availableExtensionTools: [],
    }).names).not.toContain("owned_tool");
  });

  it("rejects bash/browser/computer/open_application/secretary_commit/memory/delegation", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-owned-tool-reserved-"));
    const tools = await loadOwnedToolFixture();
    const agentPath = await writeNarrowRole(root);
    captureExtensionToolOwnership({
      extensions: [{
        path: ownedToolFixture,
        tools: [
          ...tools,
          { name: "bash" },
          { name: "browser" },
          { name: "computer" },
          { name: "open_application" },
          { name: "secretary_commit" },
          { name: "memory_query" },
          { name: "subagent" },
        ],
      }],
      mounts: [{ id: "ext.owner", path: ownedToolFixture }],
    });
    const { selection, agent } = workerNames("narrow-role", [{
      id: "ext.owner",
      enabled: true,
      extensionPath: ownedToolFixture,
      agentContribution: {
        id: "ext.owner",
        origin: "project",
        root,
        agents: [agentPath],
        patches: [{
          target: "narrow-role",
          addTools: [
            "bash",
            "browser",
            "computer",
            "open_application",
            "secretary_commit",
            "memory_query",
            "subagent",
          ],
        }],
      },
    }]);
    expect(agent.extensionToolRequests).toBeUndefined();
    expect(selection.names).not.toContain("bash");
    expect(selection.names).not.toContain("browser");
    expect(selection.names).not.toContain("computer");
    expect(selection.names).not.toContain("open_application");
    expect(selection.names).not.toContain("secretary_commit");
    expect(selection.names).not.toContain("memory_query");
    expect(selection.names).not.toContain("subagent");
  });
});

describe("session lifecycle owns the contribution sidecar", () => {
  it("deleteSession removes the sidecar beside the session file and never touches neighbors", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-contrib-lifecycle-"));
    const agentDir = join(root, "agent");
    const sessionsRoot = join(root, "sessions");
    const project = join(root, "proj");
    const projectDir = join(sessionsRoot, encodeURIComponent(project));
    await mkdir(projectDir, { recursive: true });
    const sessionId = "11111111-2222-3333-4444-555555555555";
    const sessionPath = join(projectDir, `2026-01-01T00-00-00-000Z_${sessionId}.jsonl`);
    const sidecarBody = JSON.stringify({
      version: 1,
      extensions: [{ id: "ext.owner", origin: "project", root, agents: [], patches: [] }],
    });
    await writeFile(sessionPath, `${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-01-01T00:00:00.000Z", cwd: project })}\n`);
    await writeFile(
      join(projectDir, `2026-01-01T00-00-00-000Z_${sessionId}.ext-agent-contributions.json`),
      sidecarBody,
      { mode: 0o600 },
    );
    // Crash leftover from the same system and a neighbor sidecar that belongs to another session.
    await writeFile(
      join(projectDir, `.2026-01-01T00-00-00-000Z_${sessionId}.ext-agent-contributions.json.999999.deadbeef.tmp`),
      "garbage",
      { mode: 0o600 },
    );
    const neighbor = join(projectDir, "other.ext-agent-contributions.json");
    await writeFile(neighbor, sidecarBody, { mode: 0o600 });

    const backend = createPiHostBackend({
      agentDir,
      sessionsRoot,
      canonicalProjectPaths: async () => undefined,
      env: { ...process.env },
    });
    try {
      await backend.handle("setProjectPaths", [[project]]);
      const projects = await backend.handle("listProjects", []) as { id: string; path: string }[];
      const projectId = projects.find((entry) => entry.path === project)?.id ?? projects[0]!.id;
      const sessions = await backend.handle("listSessions", [projectId]) as { id: string }[];
      expect(sessions.some((entry) => entry.id === sessionId)).toBe(true);
      await backend.handle("deleteSession", [sessionId]);
      expect(existsSync(sessionPath)).toBe(false);
      expect(existsSync(join(projectDir, `2026-01-01T00-00-00-000Z_${sessionId}.ext-agent-contributions.json`))).toBe(false);
      expect(existsSync(join(projectDir, `.2026-01-01T00-00-00-000Z_${sessionId}.ext-agent-contributions.json.999999.deadbeef.tmp`))).toBe(false);
      expect(existsSync(neighbor)).toBe(true);
    } finally {
      await backend.close();
    }
  });

  it("moveSession removes the owned sidecar and temps after a cwd change, never neighbors", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-contrib-move-"));
    const agentDir = join(root, "agent");
    const sessionsRoot = join(root, "sessions");
    const sourceProject = join(root, "src-proj");
    const targetProject = join(root, "dst-proj");
    const projectDir = join(sessionsRoot, encodeURIComponent(sourceProject));
    await mkdir(projectDir, { recursive: true });
    await mkdir(targetProject, { recursive: true });
    const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const sessionPath = join(projectDir, `2026-01-01T00-00-00-000Z_${sessionId}.jsonl`);
    const sidecar = join(projectDir, `2026-01-01T00-00-00-000Z_${sessionId}.ext-agent-contributions.json`);
    const temp = join(projectDir, `.2026-01-01T00-00-00-000Z_${sessionId}.ext-agent-contributions.json.999999.deadbeef.tmp`);
    const neighbor = join(projectDir, "other.ext-agent-contributions.json");
    const decoy = join(projectDir, "notes.json");
    const sidecarBody = JSON.stringify({
      version: 1,
      extensions: [{ id: "ext.old-project", origin: "project", root, agents: [], patches: [] }],
    });
    await writeFile(sessionPath, `${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-01-01T00:00:00.000Z", cwd: sourceProject })}\n`);
    await writeFile(sidecar, sidecarBody, { mode: 0o600 });
    await writeFile(temp, "garbage", { mode: 0o600 });
    await writeFile(neighbor, sidecarBody, { mode: 0o600 });
    await writeFile(decoy, "{\"hello\":\"world\"}", { mode: 0o600 });

    const backend = createPiHostBackend({
      agentDir,
      sessionsRoot,
      canonicalProjectPaths: async () => undefined,
      env: { ...process.env },
    });
    try {
      await backend.handle("setProjectPaths", [[sourceProject, targetProject]]);
      const projects = await backend.handle("listProjects", []) as { id: string; path: string }[];
      const targetId = projects.find((entry) => entry.path === targetProject)?.id;
      expect(targetId).toBeDefined();
      const moved = await backend.handle("moveSession", [sessionId, targetId]) as { id: string; projectId: string };
      expect(moved).toMatchObject({ id: sessionId, projectId: targetId });
      expect(existsSync(sessionPath)).toBe(true);
      expect(existsSync(sidecar)).toBe(false);
      expect(existsSync(temp)).toBe(false);
      expect(existsSync(neighbor)).toBe(true);
      expect(existsSync(decoy)).toBe(true);
    } finally {
      await backend.close();
    }
  });

  it("failed or no-op moveSession does not delete the owned sidecar", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-contrib-move-fail-"));
    const agentDir = join(root, "agent");
    const sessionsRoot = join(root, "sessions");
    const sourceProject = join(root, "src-proj");
    const targetProject = join(root, "dst-proj");
    const projectDir = join(sessionsRoot, encodeURIComponent(sourceProject));
    await mkdir(projectDir, { recursive: true });
    await mkdir(targetProject, { recursive: true });
    const sessionId = "ffffffff-1111-2222-3333-444444444444";
    const sessionPath = join(projectDir, `2026-01-01T00-00-00-000Z_${sessionId}.jsonl`);
    const sidecar = join(projectDir, `2026-01-01T00-00-00-000Z_${sessionId}.ext-agent-contributions.json`);
    const neighbor = join(projectDir, "other.ext-agent-contributions.json");
    const sidecarBody = JSON.stringify({
      version: 1,
      extensions: [{ id: "ext.keep", origin: "project", root, agents: [], patches: [] }],
    });
    await writeFile(sessionPath, `${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-01-01T00:00:00.000Z", cwd: sourceProject })}\n`);
    await writeFile(sidecar, sidecarBody, { mode: 0o600 });
    await writeFile(neighbor, sidecarBody, { mode: 0o600 });

    const backend = createPiHostBackend({
      agentDir,
      sessionsRoot,
      canonicalProjectPaths: async () => undefined,
      env: { ...process.env },
    });
    try {
      await backend.handle("setProjectPaths", [[sourceProject, targetProject]]);
      const projects = await backend.handle("listProjects", []) as { id: string; path: string }[];
      const sourceId = projects.find((entry) => entry.path === sourceProject)?.id;
      expect(sourceId).toBeDefined();
      await expect(backend.handle("moveSession", [sessionId, "missing-project"])).rejects.toThrow("unknown project");
      expect(existsSync(sidecar)).toBe(true);
      expect(existsSync(neighbor)).toBe(true);
      const same = await backend.handle("moveSession", [sessionId, sourceId]) as { id: string };
      expect(same.id).toBe(sessionId);
      expect(existsSync(sidecar)).toBe(true);
      expect(existsSync(neighbor)).toBe(true);
      expect(existsSync(sessionPath)).toBe(true);
    } finally {
      await backend.close();
    }
  });
});
