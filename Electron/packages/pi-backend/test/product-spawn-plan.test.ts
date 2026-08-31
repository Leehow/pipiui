import { describe, expect, it } from "vitest";

import { DEFAULT_FEATURES } from "../src/features.js";
import { resolveProductSpawnPlan } from "../src/product-spawn-plan.js";
import { assemblePiSpawn } from "../src/spawn-assembly.js";

describe("Product Profile Pi spawn plan", () => {
  it("keeps the base Profile usable with its Skill Loader but without Coding mounts", () => {
    const resolved = resolveProductSpawnPlan({
      profileId: "base",
      features: DEFAULT_FEATURES,
      paths: {
        secretVault: "/runtime/secret-vault.ts",
        updateCenter: "/runtime/update-center.ts",
        runtimeInfo: "/runtime/runtime-info.ts",
        skillLoader: "/runtime/skill-loader.ts",
        builtInSkills: "/runtime/skills",
        philosophy: "/runtime/philosophy.ts",
        codingTools: "/runtime/coding-tools.ts",
        git: "/runtime/git.ts",
        subagentDir: "/runtime/subagent",
        planRuntime: "/runtime/plan.ts",
        goalRuntime: "/runtime/goal.ts",
        terminal: "/runtime/terminal.ts",
      },
      activeExtensionIds: ["skill-loader-extension"],
      registeredExtensions: [
        { id: "skill-loader-extension", enabled: true, extensionPath: "/runtime/skill-loader.ts" },
        { id: "code-retrieval", enabled: true, extensionPath: "/runtime/code-retrieval.js" },
      ],
    });
    const spawn = assemblePiSpawn({
      cwd: "/workspace",
      resourceMode: "explicit",
      bridgePort: 1234,
      sessionCapability: "session-capability",
      ...resolved,
    });

    expect(resolved.features).toEqual({ skillLoader: true });
    expect(resolved.paths).toEqual({
      secretVault: "/runtime/secret-vault.ts",
      updateCenter: "/runtime/update-center.ts",
      runtimeInfo: "/runtime/runtime-info.ts",
      skillLoader: "/runtime/skill-loader.ts",
      builtInSkills: "/runtime/skills",
    });
    expect(resolved.registeredExtensions).toEqual([
      { id: "skill-loader-extension", enabled: true, extensionPath: "/runtime/skill-loader.ts" },
      { id: "code-retrieval", enabled: false, extensionPath: "/runtime/code-retrieval.js" },
    ]);
    expect(spawn.args).toEqual(expect.arrayContaining([
      "--no-extensions",
      "--no-skills",
      "-e",
      "/runtime/secret-vault.ts",
      "/runtime/update-center.ts",
      "/runtime/runtime-info.ts",
      "/runtime/skill-loader.ts",
    ]));
    expect(spawn.args).not.toEqual(expect.arrayContaining([
      "/runtime/philosophy.ts",
      "/runtime/coding-tools.ts",
      "/runtime/git.ts",
      "/runtime/subagent",
      "/runtime/plan.ts",
      "/runtime/goal.ts",
      "/runtime/terminal.ts",
      "/runtime/code-retrieval.js",
    ]));
    expect(spawn.env.PIPIUI_CODING_TOOLS_EXT).toBeUndefined();
    expect(spawn.env.PIPIUI_SUBAGENT_EXT).toBeUndefined();
    expect(spawn.env.PIPIUI_WORKTREE_FINALIZER).toBeUndefined();
    expect(spawn.env.PIPIUI_SKILLLOADER_EXT).toBe("/runtime/skill-loader.ts");
    expect(spawn.env.PIPIUI_BUILT_IN_SKILL_ROOT).toBe("/runtime/skills");
  });

  it("derives a non-Coding spawn only from that Profile's active extensions", () => {
    const resolved = resolveProductSpawnPlan({
      profileId: "trpg",
      features: DEFAULT_FEATURES,
      paths: {
        secretVault: "/runtime/secret-vault.ts",
        codingTools: "/runtime/coding-tools.ts",
        git: "/runtime/git.ts",
        subagentDir: "/runtime/subagent",
        webview: "/runtime/browser.ts",
        browserSearch: "/runtime/browser-search.ts",
        browserMemory: "/runtime/browser-memory.ts",
      },
      activeExtensionIds: ["webview-browser-extension"],
      registeredExtensions: [
        { id: "coding-runtime", enabled: true, extensionPath: "/runtime/coding.js" },
        { id: "webview-browser-extension", enabled: true, extensionPath: "/runtime/webview.js" },
      ],
    });

    expect(resolved.features).toEqual({ browserSearch: true, browserMemory: true, browser: true });
    expect(resolved.paths).toEqual({
      secretVault: "/runtime/secret-vault.ts",
      webview: "/runtime/browser.ts",
      browserSearch: "/runtime/browser-search.ts",
      browserMemory: "/runtime/browser-memory.ts",
    });
    expect(resolved.registeredExtensions).toEqual([
      { id: "coding-runtime", enabled: false, extensionPath: "/runtime/coding.js" },
      { id: "webview-browser-extension", enabled: true, extensionPath: "/runtime/webview.js" },
    ]);
  });
});
