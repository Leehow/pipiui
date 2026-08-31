import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const electronRoot = fileURLToPath(new URL("../../..", import.meta.url));
const repoRoot = join(electronRoot, "..");
const readElectron = (relative: string): string => readFileSync(join(electronRoot, relative), "utf8");

describe("git-capability ownership boundary", () => {
  it("does not activate Git through the legacy Coding workbench projection", () => {
    const runtime = readElectron("packages/ui/src/workbench/workbench-runtime.ts");
    expect(runtime).not.toContain("'git-capability'");
  });

  it("keeps structured Git and worktree implementations under git-capability", () => {
    const codingRuntime = readElectron("resources/runtime/extensions/coding-runtime/agent/index.ts");
    const spawnAssembly = readElectron("packages/pi-backend/src/spawn-assembly.ts");
    const placementShim = readElectron("resources/runtime/pi-ext/subagent/worktree.ts");
    const orchestration = readElectron("resources/runtime/pi-ext/subagent/index.ts");
    const hostAdapterShim = readElectron("resources/runtime/pi-ext/subagent-host/worktree/adapter.ts");
    const providerEntry = readElectron("resources/runtime/extensions/git-capability/agent/index.ts");

    expect(codingRuntime).not.toContain("gitTools");
    expect(spawnAssembly).not.toContain("pipiui-git.ts");
    expect(placementShim).not.toMatch(/spawnSync|node:child_process|worktree add/);
    expect(orchestration).not.toContain("gitSpawnSync");
    expect(orchestration).toContain("requestGitStatusPorcelainV1");
    expect(hostAdapterShim).toContain("git-capability/host/worktree/adapter.ts");
    expect(hostAdapterShim).not.toContain("spawn(");
    expect(providerEntry).toContain("registerGitWorktreePlacementProviderV1");
    expect(providerEntry).toContain("registerGitWorktreeServiceProviderV1");
  });

  it("ships the branch control only as a manifest-controlled Git extension entry", () => {
    const manifest = JSON.parse(readElectron("resources/runtime/extensions/git-capability/pipiui-extension.json")) as {
      agent?: { extension?: string };
      app?: { ui?: { headerActions?: Array<{ id?: string; entry?: string }> } };
    };
    const rootPackage = JSON.parse(readElectron("package.json")) as { scripts?: Record<string, string> };
    const buildScript = readElectron("scripts/build-git-capability.mjs");

    expect(manifest.agent?.extension).toBe("agent/index.ts");
    expect(manifest.app?.ui?.headerActions).toContainEqual({
      id: "git.branch",
      entry: "app/dist/branch-menu.js",
      order: 20,
    });
    expect(rootPackage.scripts?.["build:git-capability"]).toContain("build-git-capability.mjs");
    expect(buildScript).toContain("branch-menu.js");
    expect(buildScript).toContain("bare React imports");
    expect(existsSync(join(electronRoot, "packages/ui/src/GitBranchMenu.tsx"))).toBe(false);
    expect(existsSync(join(electronRoot, "packages/ui/src/git-branch.css"))).toBe(false);
  });

  it("documents Git as the provider and orchestration as a requester", () => {
    const spec = readFileSync(
      join(repoRoot, "docs/superpowers/specs/2026-08-31-pipiui-workbench-profiles-v2-design.md"),
      "utf8",
    );
    expect(spec).toContain("worktree placement+finalizer+recovery | `git-capability`");
    expect(spec).toContain("必须声明对 `git-capability` 的依赖并请求 provider");
  });
});
