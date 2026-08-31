import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  captureExtensionToolOwnership,
  resetExtensionToolOwnership,
} from "../../../resources/runtime/pi-ext/subagent/agents.ts";
import { buildSubagentToolProjection } from "../../../resources/runtime/extensions/subagent-debug-projection.ts";

let root = "";
const ENV_KEYS = [
  "PIPIUI_AGENT_MAX_DEPTH",
  "PIPIUI_MOUNTED_EXTENSIONS",
  "PIPIUI_EXT_REGISTERED_PATHS",
  "PIPIUI_EXT_AGENT_CONTRIBUTIONS",
  "PIPIUI_SUBAGENT_EXT",
  "PIPIUI_CODING_TOOLS_EXT",
  "PIPIUI_SKILLLOADER_EXT",
  "PIPIUI_MEMORY_BROKER_MODE",
] as const;
const previousEnv = new Map<string, string | undefined>();

afterEach(async () => {
  resetExtensionToolOwnership();
  for (const key of ENV_KEYS) {
    const value = previousEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  previousEnv.clear();
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

function setEnv(key: typeof ENV_KEYS[number], value: string) {
  if (!previousEnv.has(key)) previousEnv.set(key, process.env[key]);
  process.env[key] = value;
}

describe("Subagent Debug dispatch projection", () => {
  it("includes ownership-verified custom addTools and expands legacy unrestricted policy from the worker registry", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-subagent-debug-projection-"));
    const project = join(root, "project");
    const agentsDir = join(project, ".pi", "agents");
    const customDir = join(agentsDir, "custom-worker");
    const extensionRoot = join(root, "ext-ghost");
    const extensionPath = join(extensionRoot, "index.ts");
    await mkdir(customDir, { recursive: true });
    await mkdir(extensionRoot, { recursive: true });
    await writeFile(join(customDir, "AGENT.md"), `---
schema: 1
name: custom-worker
description: Custom worker
mode: worker
capabilities:
  filesystem: read-only
  shell: false
  web: false
  mcp: false
  desktop: none
  delegation: false
worktree: none
deliverable: report
tools: read
---
Custom worker.
`);
    await writeFile(join(agentsDir, "legacy.md"), `---
name: legacy
description: Legacy unrestricted worker
---
Legacy worker.
`);
    await writeFile(extensionPath, "export default function () {}\n");

    for (const key of ENV_KEYS) previousEnv.set(key, process.env[key]);
    setEnv("PIPIUI_AGENT_MAX_DEPTH", "2");
    setEnv("PIPIUI_MOUNTED_EXTENSIONS", "ext-ghost");
    setEnv("PIPIUI_EXT_REGISTERED_PATHS", extensionPath.split(delimiter).join(delimiter));
    setEnv("PIPIUI_EXT_AGENT_CONTRIBUTIONS", JSON.stringify({
      version: 1,
      extensions: [{
        id: "ext-ghost",
        origin: "project",
        root: extensionRoot,
        agents: [],
        patches: [{ target: "custom-worker", addTools: ["ghost_tool"] }],
        providedTools: [],
      }],
    }));
    setEnv("PIPIUI_SUBAGENT_EXT", join(process.cwd(), "resources/runtime/pi-ext/subagent"));
    setEnv("PIPIUI_CODING_TOOLS_EXT", join(process.cwd(), "resources/runtime/extensions/pipiui-coding-tools.ts"));
    setEnv("PIPIUI_SKILLLOADER_EXT", join(process.cwd(), "resources/runtime/extensions/pipiui-skillloader.ts"));
    setEnv("PIPIUI_MEMORY_BROKER_MODE", "main");

    captureExtensionToolOwnership({
      winners: [{ name: "ghost_tool", sourceInfo: { path: extensionPath } }],
      mounts: [{ id: "ext-ghost", path: extensionPath }],
    });

    const builtin = (name: string) => ({ name, sourceInfo: { source: "builtin" } });
    const pi = {
      getAllTools: () => [
        ...["read", "bash", "edit", "write", "grep", "find", "ls"].map(builtin),
        { name: "ghost_tool", sourceInfo: { source: "ext-ghost", path: extensionPath } },
        { name: "skill_search", sourceInfo: { path: process.env.PIPIUI_SKILLLOADER_EXT } },
        { name: "skill_load", sourceInfo: { path: process.env.PIPIUI_SKILLLOADER_EXT } },
        { name: "session_recall", sourceInfo: { path: join(process.env.PIPIUI_SUBAGENT_EXT!, "index.ts") } },
        { name: "memory_query", sourceInfo: { source: "memory-extension" } },
        { name: "memory_status", sourceInfo: { source: "memory-extension" } },
      ],
    };

    const projection = buildSubagentToolProjection(pi as never, project);
    expect(projection.find(agent => agent.name === "custom-worker")).toMatchObject({
      toolPolicy: "allowlist",
      tools: expect.arrayContaining(["read", "ghost_tool", "skill_search", "skill_load", "session_recall"]),
    });
    expect(projection.find(agent => agent.name === "legacy")).toMatchObject({
      toolPolicy: "unrestricted",
      tools: expect.arrayContaining(["read", "bash", "edit", "write", "grep", "find", "ls", "ghost_tool"]),
    });
  });
});
