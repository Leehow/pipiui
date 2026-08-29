import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createIpcHost,
  type HostRequest,
  type HostResponse,
  type IpcRendererLike,
  type PipiHostAPI,
} from "@pipi/host-api";
import { createPiHostBackend } from "../src/index.js";
import { buildAgentCatalog, redactAbsolutePaths } from "../src/agent-catalog.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";
import { AGENT_CONTRIBUTIONS_HOST_MAX_BYTES } from "../src/spawn-assembly.js";

const PROMPT_MARKER = "SECRET_PROMPT_BODY_MUST_NOT_ENTER_CATALOG";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

function authRuntime() {
  return {
    getProviders: async () => [],
    getAvailable: async () => [{ provider: "xai", id: "grok-4.5" }],
    login: async () => undefined,
    logout: async () => undefined,
  };
}

async function tempRoot(prefix: string): Promise<string> {
  root = await mkdtemp(join(tmpdir(), prefix));
  return root;
}

function hostFor(backend: ReturnType<typeof createPiHostBackend>): PipiHostAPI {
  const ipc: IpcRendererLike = {
    invoke: async (_channel, request: HostRequest): Promise<HostResponse> => {
      try {
        const result = await backend.handle(request.method, request.params ?? []);
        return { protocolVersion: request.protocolVersion, id: request.id, type: "response", ok: true, result };
      } catch (error) {
        return {
          protocolVersion: request.protocolVersion,
          id: request.id,
          type: "response",
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    on: () => {},
    removeListener: () => {},
  };
  return createIpcHost(ipc);
}

async function writeAgentPackage(
  dest: string,
  name: string,
  options: { description?: string; body?: string } = {},
): Promise<string> {
  const dir = join(dest, name);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "AGENT.md");
  await writeFile(
    path,
    `---
schema: 1
name: ${name}
description: ${options.description ?? `contributed ${name}`}
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
${options.body ?? `You are ${name}. ${PROMPT_MARKER}`}
`,
  );
  return path;
}

async function writeExtension(
  dest: string,
  spec: {
    id: string;
    agents?: Array<{ name: string; description?: string; body?: string }>;
    patches?: Array<{
      target: string;
      appendPrompt?: { rel: string; body?: string };
      replacePrompt?: { rel: string; body?: string };
      addTools?: string[];
      removeTools?: string[];
    }>;
  },
): Promise<void> {
  await mkdir(dest, { recursive: true });
  const agent: Record<string, unknown> = {};
  if (spec.agents?.length) {
    agent.agents = [];
    for (const item of spec.agents) {
      const rel = `agents/${item.name}/AGENT.md`;
      (agent.agents as string[]).push(rel);
      await writeAgentPackage(join(dest, "agents"), item.name, item);
    }
  }
  if (spec.patches?.length) {
    agent.agentPatches = [];
    for (const patch of spec.patches) {
      const declared: Record<string, unknown> = { target: patch.target };
      if (patch.appendPrompt) {
        declared.appendPrompt = patch.appendPrompt.rel;
        const path = join(dest, patch.appendPrompt.rel);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, patch.appendPrompt.body ?? `append ${PROMPT_MARKER}\n`);
      }
      if (patch.replacePrompt) {
        declared.replacePrompt = patch.replacePrompt.rel;
        const path = join(dest, patch.replacePrompt.rel);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, patch.replacePrompt.body ?? `replace ${PROMPT_MARKER}\n`);
      }
      if (patch.addTools) declared.addTools = patch.addTools;
      if (patch.removeTools) declared.removeTools = patch.removeTools;
      (agent.agentPatches as Record<string, unknown>[]).push(declared);
    }
  }
  await writeFile(
    join(dest, "pipiui-extension.json"),
    `${JSON.stringify({
      id: spec.id,
      name: spec.id,
      version: "1.0.0",
      capabilities: [],
      agent,
    }, null, 2)}\n`,
  );
}

describe("dynamic agent catalog", () => {
  it("exposes bundled roles through host API, including canonical metadata and compatibility fields", async () => {
    await tempRoot("pipi-agent-catalog-builtin-");
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      canonicalProjectPaths: async () => undefined,
      authRuntime: authRuntime(),
    });
    const host = hostFor(backend);
    const catalog = await host.listAgentDefinitions?.();
    expect(catalog).toBeDefined();
    const names = (catalog ?? []).map((agent) => agent.name);
    expect(names).toEqual(expect.arrayContaining([
      "explore",
      "general-purpose",
      "reviewer",
      "secretary",
      "operator",
    ]));
    expect(names).not.toContain("computer-use");
    expect(names).not.toContain("computer-use-leader");
    expect(names).not.toContain("computer-verifier");
    expect(names).not.toContain("computer-terminal");
    expect(catalog?.every((agent) => typeof agent.name === "string" && typeof agent.description === "string")).toBe(true);
    const secretary = catalog?.find((agent) => agent.name === "secretary");
    const operator = catalog?.find((agent) => agent.name === "operator");
    expect(catalog?.some((agent) => (agent.canonicalRole as string | undefined) === "computer")).toBe(false);
    expect(secretary).toMatchObject({ origin: "bundled", canonical: true, canonicalRole: "secretary" });
    expect(operator).toMatchObject({ origin: "bundled", canonical: true, canonicalRole: "operator" });
    expect(JSON.stringify(catalog)).not.toContain("systemPrompt");
    expect(JSON.stringify(catalog)).not.toContain(PROMPT_MARKER);
    await backend.close();
  });

  it("includes enabled extension agents, drops them when disabled, and keeps model settings", async () => {
    await tempRoot("pipi-agent-catalog-ext-");
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    await writeExtension(join(projectPiAgentDir(project), "extensions", "ext-research"), {
      id: "ext-research",
      agents: [{ name: "ext-researcher", description: "Extension researcher" }],
      patches: [{ target: "no-such-agent", addTools: ["read"] }],
    });
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      authRuntime: authRuntime(),
    });
    const host = hostFor(backend);
    const added = await host.addProject(project);
    await host.listExtensions?.(added.id);
    await host.setExtensionEnabled?.("ext-research", true, "project", added.id);

    const listed = await host.listExtensions?.(added.id) ?? [];
    expect(listed.find((item) => item.id === "ext-research")).toMatchObject({ state: "enabled" });
    const enabled = await host.listAgentDefinitions?.(added.id) ?? [];
    const researcher = enabled.find((agent) => agent.name === "ext-researcher");
    expect(researcher).toMatchObject({
      name: "ext-researcher",
      description: "Extension researcher",
      extensionId: "ext-research",
      available: true,
      mode: "read-only",
    });
    expect(JSON.stringify(enabled)).not.toContain(PROMPT_MARKER);
    const missing = (enabled[0]?.catalogDiagnostics ?? []).concat(
      enabled.flatMap((agent) => agent.diagnostics ?? []),
    );
    expect(missing.some((entry) => entry.code === "contribution-target-missing" && entry.extensionId === "ext-research")).toBe(true);

    await host.setSubagentModel?.("ext-researcher", [{ model: "xai/grok-4.5" }]);
    expect(await host.getSubagentModels?.()).toMatchObject({
      "ext-researcher": [{ model: "xai/grok-4.5" }],
    });

    await host.setExtensionEnabled?.("ext-research", false, "project", added.id);
    const disabled = await host.listAgentDefinitions?.(added.id) ?? [];
    expect(disabled.map((agent) => agent.name)).not.toContain("ext-researcher");
    expect(await host.getSubagentModels?.()).toMatchObject({
      "ext-researcher": [{ model: "xai/grok-4.5" }],
    });
    await backend.close();
  });

  it("surfaces same-name contribution diagnostics without replacing the bundled agent", async () => {
    await tempRoot("pipi-agent-catalog-conflict-");
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    await writeExtension(join(projectPiAgentDir(project), "extensions", "ext-collide"), {
      id: "ext-collide",
      agents: [{ name: "explore", description: "injected explore", body: `injected ${PROMPT_MARKER}` }],
    });
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      authRuntime: authRuntime(),
    });
    const host = hostFor(backend);
    const added = await host.addProject(project);
    await host.listExtensions?.(added.id);
    await host.setExtensionEnabled?.("ext-collide", true, "project", added.id);
    const catalog = await host.listAgentDefinitions?.(added.id) ?? [];
    const explore = catalog.filter((agent) => agent.name === "explore");
    expect(explore).toHaveLength(1);
    expect(explore[0]).toMatchObject({ origin: "bundled", description: expect.stringMatching(/research agent/i) });
    expect(JSON.stringify(catalog)).not.toContain(PROMPT_MARKER);
    expect(JSON.stringify(catalog)).not.toContain("injected explore");
    const conflictCodes = [
      ...(catalog[0]?.catalogDiagnostics ?? []),
      ...(explore[0]?.diagnostics ?? []),
    ].map((entry) => entry.code);
    expect(conflictCodes).toContain("contribution-name-conflict");
    expect([
      ...(catalog[0]?.catalogDiagnostics ?? []),
      ...(explore[0]?.diagnostics ?? []),
    ].some((entry) => entry.code === "contribution-name-conflict" && entry.extensionId === "ext-collide")).toBe(true);
    await backend.close();
  });

  it("returns read-only patch provenance without prompt bodies or paths", async () => {
    await tempRoot("pipi-agent-catalog-patch-");
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    await writeExtension(join(projectPiAgentDir(project), "extensions", "ext-research"), {
      id: "ext-research",
      agents: [{ name: "ext-researcher", description: "Extension researcher" }],
      patches: [{
        target: "explore",
        appendPrompt: { rel: "prompts/explore-extra.md", body: `append ${PROMPT_MARKER}\n` },
        addTools: ["code_search"],
      }],
    });
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      authRuntime: authRuntime(),
    });
    const host = hostFor(backend);
    const added = await host.addProject(project);
    await host.listExtensions?.(added.id);
    await host.setExtensionEnabled?.("ext-research", true, "project", added.id);
    const catalog = await host.listAgentDefinitions?.(added.id) ?? [];
    const explore = catalog.find((agent) => agent.name === "explore");
    expect(explore?.patches).toEqual([{
      extensionId: "ext-research",
      origin: "project",
      operations: ["appendPrompt", "addTools"],
      addTools: ["code_search"],
    }]);
    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toContain(PROMPT_MARKER);
    expect(serialized).not.toContain("explore-extra.md");
    expect(JSON.stringify(explore?.patches)).not.toMatch(/appendPrompt\":\"\//);
    await backend.close();
  });

  it("surfaces escaped contribution paths as diagnostics without erroring the extension", async () => {
    await tempRoot("pipi-agent-catalog-escape-");
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    const dest = join(projectPiAgentDir(project), "extensions", "escaped");
    await writeExtension(dest, {
      id: "escaped",
      agents: [{ name: "ok", description: "escaped agent" }],
    });
    const outside = join(root, "outside", "AGENT.md");
    await mkdir(dirname(outside), { recursive: true });
    await writeFile(outside, `---\nschema: 1\n---\n# outside ${PROMPT_MARKER}\n`);
    await rm(join(dest, "agents", "ok", "AGENT.md"));
    await symlink(outside, join(dest, "agents", "ok", "AGENT.md"));
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      authRuntime: authRuntime(),
    });
    const host = hostFor(backend);
    const added = await host.addProject(project);
    await host.listExtensions?.(added.id);
    await host.setExtensionEnabled?.("escaped", true, "project", added.id);
    const listed = await host.listExtensions?.(added.id) ?? [];
    expect(listed.find((item) => item.id === "escaped")).toMatchObject({ state: "enabled" });
    const catalog = await host.listAgentDefinitions?.(added.id) ?? [];
    const diagnostics = (catalog[0]?.catalogDiagnostics ?? []).concat(catalog.flatMap((agent) => agent.diagnostics ?? []));
    expect(diagnostics.some((entry) => entry.code === "contribution-path-escape" && entry.extensionId === "escaped")).toBe(true);
    expect(catalog.map((agent) => agent.name)).not.toContain("ok");
    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toContain(PROMPT_MARKER);
    expect(serialized).not.toContain(outside);
    await backend.close();
  });

  it("surfaces snapshot oversize diagnostics and omits patch provenance", async () => {
    await tempRoot("pipi-agent-catalog-oversize-");
    const token = "n".repeat(220);
    const huge = {
      id: "huge",
      origin: "project" as const,
      root: "/repo/.pi/agent/extensions/huge",
      agents: ["/repo/.pi/agent/extensions/huge/agents/huge/AGENT.md"],
      patches: Array.from({ length: 32 }, (_, patchIndex) => ({
        target: "explore",
        addTools: Array.from({ length: 32 }, (_, toolIndex) => `${token}_${patchIndex}_${toolIndex}`),
      })),
    };
    const catalog = await buildAgentCatalog({
      runtimeRoot: join(root, "runtime"),
      userDir: join(root, "agent", "agents"),
      packages: [{
        id: "huge",
        enabled: true,
        extensionPath: "/pkg/huge/agent.js",
        skillRoots: ["/pkg/huge/skills"],
        agentContribution: huge,
      }],
    });
    expect(catalog.diagnostics.some((entry) => (
      entry.code === "contribution-snapshot-oversize"
      && entry.message.includes(String(AGENT_CONTRIBUTIONS_HOST_MAX_BYTES))
    ))).toBe(true);
    expect(catalog.agents.find((agent) => agent.name === "explore")?.patches).toBeUndefined();
    expect(JSON.stringify(catalog.agents.map((agent) => agent.patches))).not.toContain(token);
  });

  it("returns bundled catalog plus diagnostics when the project is unknown rather than crashing", async () => {
    await tempRoot("pipi-agent-catalog-missing-project-");
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      canonicalProjectPaths: async () => undefined,
      authRuntime: authRuntime(),
    });
    const listed = await backend.handle("listAgentDefinitions", ["missing-project"]) as Array<{ name: string; catalogDiagnostics?: Array<{ code: string }> }>;
    expect(listed.map((agent) => agent.name)).toEqual(expect.arrayContaining(["explore", "secretary"]));
    expect(listed[0]?.catalogDiagnostics?.some((entry) => entry.code === "catalog-project-unavailable")).toBe(true);
    await backend.close();
  });

  it("helper discovery does not copy a hardcoded five-role registry", async () => {
    await tempRoot("pipi-agent-catalog-helper-");
    const catalog = await buildAgentCatalog({
      runtimeRoot: join(root, "runtime"),
      userDir: join(root, "agent", "agents"),
    });
    expect(catalog.agents.map((agent) => agent.name)).toEqual(expect.arrayContaining([
      "explore",
      "general-purpose",
      "reviewer",
      "secretary",
      "operator",
    ]));
    expect(catalog.agents.map((agent) => agent.name)).not.toContain("computer-use");
    expect(JSON.stringify(catalog.agents)).not.toContain("systemPrompt");
  });

  it("does not treat rejected canonical replacePrompt or reserved addTools as applied patches", async () => {
    await tempRoot("pipi-agent-catalog-fake-success-");
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    await writeExtension(join(projectPiAgentDir(project), "extensions", "ext-fake"), {
      id: "ext-fake",
      patches: [{
        target: "secretary",
        replacePrompt: { rel: "prompts/nope.md", body: `replace ${PROMPT_MARKER}\n` },
        addTools: ["computer", "browser", "secretary_commit"],
      }],
    });
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      authRuntime: authRuntime(),
    });
    const host = hostFor(backend);
    const added = await host.addProject(project);
    await host.listExtensions?.(added.id);
    await host.setExtensionEnabled?.("ext-fake", true, "project", added.id);
    const catalog = await host.listAgentDefinitions?.(added.id) ?? [];
    const secretary = catalog.find((agent) => agent.name === "secretary");
    expect(secretary?.patches).toBeUndefined();
    const diagnostics = (catalog[0]?.catalogDiagnostics ?? []).concat(catalog.flatMap((agent) => agent.diagnostics ?? []));
    expect(diagnostics.some((entry) => entry.code === "contribution-replace-forbidden" && entry.extensionId === "ext-fake")).toBe(true);
    expect(diagnostics.some((entry) => entry.code === "contribution-reserved-tool" && entry.extensionId === "ext-fake")).toBe(true);
    expect(JSON.stringify(catalog)).not.toContain(PROMPT_MARKER);
    expect(JSON.stringify(catalog)).not.toContain("nope.md");
    await backend.close();
  });

  it("shows unverified custom addTools as requested, never applied", async () => {
    await tempRoot("pipi-agent-catalog-ghost-");
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    await writeExtension(join(projectPiAgentDir(project), "extensions", "ext-ghost"), {
      id: "ext-ghost",
      patches: [{
        target: "explore",
        addTools: ["ghost_tool"],
      }],
    });
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      authRuntime: authRuntime(),
    });
    const host = hostFor(backend);
    const added = await host.addProject(project);
    await host.listExtensions?.(added.id);
    await host.setExtensionEnabled?.("ext-ghost", true, "project", added.id);
    const catalog = await host.listAgentDefinitions?.(added.id) ?? [];
    const explore = catalog.find((agent) => agent.name === "explore");
    expect(explore?.patches).toEqual([{
      extensionId: "ext-ghost",
      origin: "project",
      operations: ["addTools"],
      addTools: ["ghost_tool"],
      status: "requested",
    }]);
    const diagnostics = (catalog[0]?.catalogDiagnostics ?? []).concat(catalog.flatMap((agent) => agent.diagnostics ?? []));
    expect(diagnostics.some((entry) => entry.message.includes("ghost_tool") && entry.code.includes("unregistered"))).toBe(false);
    expect(JSON.stringify(explore?.patches)).not.toContain(PROMPT_MARKER);
    await backend.close();
  });

  it("records only accepted operations for a partially applied patch", async () => {
    await tempRoot("pipi-agent-catalog-partial-");
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    await writeExtension(join(projectPiAgentDir(project), "extensions", "ext-partial"), {
      id: "ext-partial",
      patches: [{
        target: "explore",
        appendPrompt: { rel: "prompts/ok.md", body: `append ${PROMPT_MARKER}\n` },
        addTools: ["code_search", "computer", "write"],
        removeTools: ["arxiv_fetch"],
      }],
    });
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      authRuntime: authRuntime(),
    });
    const host = hostFor(backend);
    const added = await host.addProject(project);
    await host.listExtensions?.(added.id);
    await host.setExtensionEnabled?.("ext-partial", true, "project", added.id);
    const catalog = await host.listAgentDefinitions?.(added.id) ?? [];
    const explore = catalog.find((agent) => agent.name === "explore");
    expect(explore?.patches).toEqual([{
      extensionId: "ext-partial",
      origin: "project",
      operations: ["appendPrompt", "addTools", "removeTools"],
      addTools: ["code_search"],
      removeTools: ["arxiv_fetch"],
    }]);
    const diagnostics = (catalog[0]?.catalogDiagnostics ?? []).concat(catalog.flatMap((agent) => agent.diagnostics ?? []));
    expect(diagnostics.some((entry) => entry.code === "contribution-reserved-tool")).toBe(true);
    expect(diagnostics.some((entry) => entry.code === "contribution-add-tool-denied")).toBe(true);
    expect(JSON.stringify(explore?.patches)).not.toContain("computer");
    expect(JSON.stringify(catalog)).not.toContain(PROMPT_MARKER);
    await backend.close();
  });

  it("redacts absolute paths from catalog diagnostic messages", async () => {
    expect(redactAbsolutePaths("Prompt escaped: /tmp/ext/prompts/x.md")).toBe("Prompt escaped: <path>");
    expect(redactAbsolutePaths("open '/Users/haoli/secret/AGENT.md'")).toBe("open '<path>'");
    expect(redactAbsolutePaths("C:\\Users\\x\\AGENT.md leaked")).toBe("<path> leaked");
    expect(redactAbsolutePaths("overrides definition at /Users/a/Top Secret/AGENT.md; kept")).toBe(
      "overrides definition at <path>; kept",
    );
    expect(redactAbsolutePaths("Extension `ext-research` patch target `no-such-agent`")).toBe(
      "Extension `ext-research` patch target `no-such-agent`",
    );

    await tempRoot("pipi-agent-catalog-redact-");
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    await writeExtension(join(projectPiAgentDir(project), "extensions", "ext-collide"), {
      id: "ext-collide",
      agents: [{ name: "explore", description: "injected explore", body: `injected ${PROMPT_MARKER}` }],
    });
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      authRuntime: authRuntime(),
    });
    const host = hostFor(backend);
    const added = await host.addProject(project);
    await host.listExtensions?.(added.id);
    await host.setExtensionEnabled?.("ext-collide", true, "project", added.id);
    const catalog = await host.listAgentDefinitions?.(added.id) ?? [];
    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain(projectPiAgentDir(project));
    expect(serialized).not.toContain(PROMPT_MARKER);
    const diagnostics = (catalog[0]?.catalogDiagnostics ?? []).concat(catalog.flatMap((agent) => agent.diagnostics ?? []));
    expect(diagnostics.some((entry) => entry.code === "contribution-name-conflict")).toBe(true);
    expect(diagnostics.every((entry) => !entry.message.includes("/") || !entry.message.includes(root))).toBe(true);
    await backend.close();
  });

  it("does not put spaced absolute paths into shadowed-name messages", async () => {
    await tempRoot("pipi-agent-catalog-space-");
    const secret = join(root, "Top Secret", "agents");
    await writeAgentPackage(secret, "explore", { description: "user explore", body: "user explore body" });
    const catalog = await buildAgentCatalog({
      runtimeRoot: join(root, "runtime"),
      userDir: secret,
    });
    const diagnostics = catalog.diagnostics.concat(
      catalog.agents.flatMap((agent) => (agent.diagnostics ?? []).concat(agent.catalogDiagnostics ?? [])),
    );
    const shadowed = diagnostics.filter((entry) => entry.code === "shadowed-name");
    expect(shadowed.length).toBeGreaterThan(0);
    for (const entry of shadowed) {
      expect(entry.message).not.toContain("Top Secret");
      expect(entry.message).not.toContain("AGENT.md");
      expect(entry.message).not.toContain(secret);
      expect(entry.message.includes("/")).toBe(false);
    }
    expect(JSON.stringify(catalog.diagnostics)).not.toContain("Top Secret");
  });

  it("ignores extraResources agents.ts and keeps the bundled parser", async () => {
    await tempRoot("pipi-agent-catalog-cache-");
    const first = await buildAgentCatalog({
      runtimeRoot: join(root, "missing-runtime"),
      userDir: join(root, "agent", "agents"),
    });
    expect(first.agents.map((agent) => agent.name)).toEqual(expect.arrayContaining(["explore", "secretary"]));
    expect(first.diagnostics.some((entry) => entry.code === "from-packaged-root")).toBe(false);

    const packaged = join(root, "packaged-runtime");
    await mkdir(join(packaged, "pi-ext", "subagent"), { recursive: true });
    await writeFile(
      join(packaged, "pi-ext", "subagent", "agents.ts"),
      "throw new Error('extraResources agents.ts must not be imported by catalog');\nexport function applyExtensionAgentContributions() { throw new Error('from-packaged-root'); }\n",
    );
    const second = await buildAgentCatalog({
      runtimeRoot: packaged,
      userDir: join(root, "agent", "agents"),
    });
    expect(second.agents.map((agent) => agent.name)).toEqual(expect.arrayContaining(["explore", "secretary"]));
    expect(second.diagnostics.some((entry) => entry.code === "from-packaged-root")).toBe(false);
  });
});
