import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPiHostBackend } from "../src/index.js";
import { readProjectProductActivation } from "../src/profile-store.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";
import { extensionUpdateStoreRoot, readExtensionSlot } from "../src/extension-update-engine.js";

const runtimeSource = new URL("../../../resources/runtime", import.meta.url).pathname;
let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

describe("Product Profile host interface", () => {
  it("keeps default-mode legacy Conversations writable without applying isolated Profile gates", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-profile-default-compat-"));
    const project = join(root, "workspace");
    const sessions = join(root, "sessions", "workspace");
    await mkdir(project, { recursive: true });
    await mkdir(sessions, { recursive: true });
    await writeFile(join(sessions, "legacy.jsonl"), `${JSON.stringify({
      type: "session",
      version: 3,
      id: "legacy-session",
      timestamp: "2026-08-10T00:00:00.000Z",
      cwd: project,
    })}\n`);
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      canonicalProjectPaths: async () => undefined,
      piPath: process.execPath,
      spawn: (_bin, _args, options) =>
        spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as never,
    });

    await expect(backend.handle("sendPrompt", ["legacy-session", "hello"])).resolves.toMatchObject({ outcome: "direct" });
    await backend.close();
  });

  it("installs a local Product Pack into the shared store and activates its project Profile", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-product-pack-"));
    const project = join(root, "campaign");
    const pack = join(root, "campaign-pack");
    await mkdir(project, { recursive: true });
    await mkdir(join(pack, "extensions", "campaign-kit"), { recursive: true });
    await writeFile(join(pack, "pipiui-product-pack.json"), JSON.stringify({
      schemaVersion: 1,
      id: "campaign-starter",
      name: "Campaign Starter",
      profile: "profile/pipiui-profile.json",
      extensions: [{ id: "campaign-kit", path: "extensions/campaign-kit" }],
    }));
    await mkdir(join(pack, "profile"), { recursive: true });
    await writeFile(join(pack, "profile", "pipiui-profile.json"), JSON.stringify({
      schemaVersion: 1,
      id: "campaign",
      name: "Campaign",
      extensions: { required: [{ id: "campaign-kit", version: "^1.0.0" }], recommended: [] },
      layout: { primarySidebar: "campaign.navigator" },
    }));
    await writeFile(join(pack, "extensions", "campaign-kit", "pipiui-extension.json"), JSON.stringify({
      id: "campaign-kit",
      name: "Campaign Kit",
      version: "1.0.0",
      hostApi: "^1.0.0",
      capabilities: [],
    }));

    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      runtimeRoot: join(root, "runtime"),
      runtimeAssets: { sourceRoot: runtimeSource },
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
    });
    const added = await backend.handle("addProject", [project]) as { id: string };

    expect(await backend.handle("installLocalProductPack" as never, [added.id, pack])).toMatchObject({
      profile: "campaign",
    });
    expect(await backend.handle("getProductProfile" as never, [added.id])).toMatchObject({ profile: "campaign" });
    expect((await backend.handle("listExtensions" as never, [added.id]) as Array<{ id: string; source: string; state: string }>)
      .find(item => item.id === "campaign-kit"))
      .toMatchObject({ source: "app", state: "enabled" });
    expect(await readExtensionSlot(extensionUpdateStoreRoot(join(root, "agent")), "campaign-kit", "active"))
      .toMatchObject({ version: "1.0.0" });
    expect(existsSync(join(projectPiAgentDir(project), "product-packs", "campaign-starter", "receipt.json"))).toBe(true);
    await backend.close();
  });

  it("rolls back Product Pack slots and project files when its Profile cannot activate", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-product-pack-rollback-"));
    const project = join(root, "campaign");
    const pack = join(root, "campaign-pack");
    await mkdir(project, { recursive: true });
    await mkdir(join(pack, "extensions", "campaign-kit"), { recursive: true });
    await writeFile(join(pack, "pipiui-product-pack.json"), JSON.stringify({
      schemaVersion: 1,
      id: "broken-campaign-starter",
      name: "Broken Campaign Starter",
      profile: "profile/pipiui-profile.json",
      extensions: [{ id: "campaign-kit", path: "extensions/campaign-kit" }],
    }));
    await mkdir(join(pack, "profile"), { recursive: true });
    await writeFile(join(pack, "profile", "pipiui-profile.json"), JSON.stringify({
      schemaVersion: 1,
      id: "broken-campaign",
      name: "Broken Campaign",
      extensions: { required: [{ id: "missing-kit", version: "^1.0.0" }], recommended: [] },
      layout: {},
    }));
    await writeFile(join(pack, "extensions", "campaign-kit", "pipiui-extension.json"), JSON.stringify({
      id: "campaign-kit",
      name: "Campaign Kit",
      version: "1.0.0",
      hostApi: "^1.0.0",
      capabilities: [],
    }));

    const agentDir = join(root, "agent");
    const backend = createPiHostBackend({
      agentDir,
      runtimeRoot: join(root, "runtime"),
      runtimeAssets: { sourceRoot: runtimeSource },
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
    });
    const added = await backend.handle("addProject", [project]) as { id: string };

    await expect(backend.handle("installLocalProductPack" as never, [added.id, pack]))
      .rejects.toThrow(/Product Profile broken-campaign cannot activate: missing-kit missing/);
    expect(await backend.handle("getProductProfile" as never, [added.id])).toMatchObject({ profile: "base" });
    expect((await backend.handle("listExtensions" as never, [added.id]) as Array<{ id: string }>)
      .some(item => item.id === "campaign-kit")).toBe(false);
    expect(await readExtensionSlot(extensionUpdateStoreRoot(agentDir), "campaign-kit", "active")).toBeUndefined();
    expect(existsSync(join(projectPiAgentDir(project), "profiles", "broken-campaign"))).toBe(false);
    expect(existsSync(join(projectPiAgentDir(project), "product-packs", "broken-campaign-starter", "receipt.json"))).toBe(false);
    await backend.close();
  });

  it("lists profiles and persists the selected project profile", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-profile-host-"));
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      runtimeAssets: { sourceRoot: runtimeSource },
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
    });
    const added = await backend.handle("addProject", [project]) as { id: string };

    expect(await backend.handle("listProductProfiles" as never, [])).toEqual([
      expect.objectContaining({ id: "base", name: "基础版" }),
      expect.objectContaining({ id: "coding", name: "Coding 优化版" }),
    ]);
    expect(await backend.handle("getProductProfile" as never, [added.id])).toMatchObject({
      profile: "base",
      overrides: {},
    });
    expect(await backend.handle("setProductProfile" as never, [added.id, "base"])).toMatchObject({
      profile: "base",
      overrides: {},
    });
    const baseExtensions = await backend.handle("listExtensions" as never, [added.id]) as Array<{ id: string; state: string; category?: string }>;
    expect(baseExtensions.find(item => item.id === "skill-loader-extension")).toMatchObject({ state: "enabled", category: "foundation" });
    expect(baseExtensions.filter(item => item.id.startsWith("coding-") && item.state === "enabled")).toEqual([]);
    expect(baseExtensions.find(item => item.id === "git-capability")?.state).not.toBe("enabled");
    expect(await backend.handle("setProductProfile" as never, [added.id, "coding"])).toMatchObject({
      profile: "coding",
    });
    const codingExtensions = await backend.handle("listExtensions" as never, [added.id]) as Array<{ id: string; state: string }>;
    for (const id of [
      "coding-runtime",
      "coding-workbench",
      "coding-orchestration",
      "skill-loader-extension",
      "code-retrieval",
      "document-workbench",
      "webview-browser-extension",
      "agent-orchestration",
      "git-capability",
    ]) {
      expect(codingExtensions.find(item => item.id === id)?.state).toBe("enabled");
    }
    await backend.handle("setProductProfile" as never, [added.id, "base"]);
    expect(await readProjectProductActivation(projectPiAgentDir(project), { defaultProfileId: "coding" })).toMatchObject({
      profile: "base",
    });
    await backend.close();
  });

  it("creates and edits a project-local custom extension pack while it is inactive", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-custom-profile-host-"));
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      runtimeRoot: join(root, "runtime"),
      runtimeAssets: { sourceRoot: runtimeSource },
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
    });
    const added = await backend.handle("addProject", [project]) as { id: string };

    expect(await backend.handle("createProductProfile" as never, [added.id, "Lab Tools"])).toMatchObject({
      id: "lab-tools",
      name: "Lab Tools",
      source: "project",
      customizable: true,
      requiredExtensionIds: ["skill-loader-extension"],
      recommendedExtensionIds: [],
    });
    expect(await backend.handle("updateProductProfileExtensions" as never, [added.id, "lab-tools", ["web-access-extension"]]))
      .toMatchObject({ recommendedExtensionIds: ["web-access-extension"] });
    expect(await backend.handle("setProductProfile" as never, [added.id, "lab-tools"]))
      .toMatchObject({ profile: "lab-tools" });
    const customExtensions = await backend.handle("listExtensions" as never, [added.id]) as Array<{ id: string; state: string }>;
    expect(customExtensions.find(item => item.id === "skill-loader-extension")?.state).toBe("enabled");
    expect(customExtensions.find(item => item.id === "web-access-extension")?.state).toBe("enabled");
    await expect(backend.handle("updateProductProfileExtensions" as never, [added.id, "lab-tools", []]))
      .rejects.toThrow(/先关闭当前扩展包/);
    await backend.handle("setProductProfile" as never, [added.id, "base"]);
    expect(await backend.handle("updateProductProfileExtensions" as never, [added.id, "lab-tools", []]))
      .toMatchObject({ recommendedExtensionIds: [] });
    await backend.close();
  });

  it("exports a project extension pack to ZIP and loads it into another project", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-zip-host-"));
    const sourceProject = join(root, "source-project");
    const targetProject = join(root, "target-project");
    const archive = join(root, "lab-tools.pipiui-pack.zip");
    await mkdir(sourceProject, { recursive: true });
    await mkdir(targetProject, { recursive: true });
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      runtimeRoot: join(root, "runtime"),
      runtimeAssets: { sourceRoot: runtimeSource },
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
    });
    const source = await backend.handle("addProject", [sourceProject]) as { id: string };
    const target = await backend.handle("addProject", [targetProject]) as { id: string };
    const created = await backend.handle("createProductProfile" as never, [source.id, "Lab Tools"]) as { id: string };

    expect(await backend.handle("exportProductPackArchive" as never, [source.id, created.id, archive])).toMatchObject({
      archivePath: archive,
      profileId: created.id,
      extensionCount: 1,
    });
    expect((await stat(archive)).size).toBeGreaterThan(0);
    expect(await backend.handle("installProductPackArchive" as never, [target.id, archive])).toMatchObject({
      profile: created.id,
    });
    expect(await backend.handle("getProductProfile" as never, [target.id])).toMatchObject({ profile: created.id });
    expect((await backend.handle("listProductProfiles" as never, [target.id]) as Array<{ id: string }>)
      .some(profile => profile.id === created.id)).toBe(true);
    await backend.close();
  });

  it("starts a new base-Profile Conversation with skills but without Coding runtime mounts", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-profile-empty-spawn-"));
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    const captured: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      runtimeAssets: { sourceRoot: runtimeSource },
      profileMode: "isolated",
      resourceMode: "explicit",
      canonicalProjectPaths: async () => undefined,
      piPath: process.execPath,
      spawn: (_bin, args, options) => {
        captured.push({ args: [...args], env: { ...options.env } });
        return spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as never;
      },
    });
    const added = await backend.handle("addProject", [project]) as { id: string };
    await backend.handle("setProductProfile" as never, [added.id, "base"]);
    const session = await backend.handle("newSession", [added.id, "Base conversation"]) as { id: string };
    await backend.handle("sendPrompt", [session.id, "hello"]);

    expect(captured).toHaveLength(1);
    const joined = captured[0]!.args.join("\n");
    expect(joined).not.toMatch(/coding-tools|pi-philosophy|subagent|pi-goal|pipiui-git|terminal/i);
    expect(joined).toContain("skill-loader-extension/agent/index.ts");
    expect(captured[0]!.env.PIPIUI_CODING_TOOLS_EXT).toBeUndefined();
    expect(captured[0]!.env.PIPIUI_SUBAGENT_EXT).toBeUndefined();
    expect(captured[0]!.env.PIPIUI_WORKTREE_FINALIZER).toBeUndefined();
    expect(await backend.handle("getSession", [added.id, session.id])).toMatchObject({
      productProfile: { id: "base", fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
    });
    await backend.handle("setProductProfile" as never, [added.id, "coding"]);
    await expect(backend.handle("sendPrompt", [session.id, "must stay read-only"]))
      .rejects.toThrow(/uses Product Profile base.*current project uses coding/i);
    await backend.close();
  });

  it("discovers a project-local non-Coding Profile without changing another project", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-project-profile-"));
    const project = join(root, "campaign");
    await mkdir(project, { recursive: true });
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      runtimeRoot: join(root, "runtime"),
      runtimeAssets: { sourceRoot: runtimeSource },
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
    });
    const added = await backend.handle("addProject", [project]) as { id: string };
    const sourceProfileDir = join(root, "campaign-profile-source");
    await mkdir(sourceProfileDir, { recursive: true });
    await writeFile(join(sourceProfileDir, "pipiui-profile.json"), JSON.stringify({
      schemaVersion: 1,
      id: "campaign-fixture",
      name: "Campaign Fixture",
      extensions: { required: [], recommended: [] },
      layout: { primarySidebar: "campaign.navigator" },
    }));

    expect(await backend.handle("installLocalProductProfile" as never, [added.id, sourceProfileDir])).toMatchObject({
      profile: "campaign-fixture",
    });
    const profiles = await backend.handle("listProductProfiles" as never, [added.id]) as Array<{ id: string; source?: string }>;
    expect(profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "campaign-fixture", source: "project" }),
    ]));
    expect(JSON.parse(await readFile(join(projectPiAgentDir(project), "profiles", "campaign-fixture", "pipiui-profile.json"), "utf8"))).toMatchObject({ id: "campaign-fixture" });
    await backend.close();
  });

  it("assembles the Coding Profile from registry-owned runtime packages instead of legacy duplicate paths", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-profile-coding-spawn-"));
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    const captured: string[][] = [];
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      runtimeAssets: { sourceRoot: runtimeSource },
      profileMode: "isolated",
      resourceMode: "explicit",
      canonicalProjectPaths: async () => undefined,
      piPath: process.execPath,
      spawn: (_bin, args, options) => {
        captured.push([...args]);
        return spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as never;
      },
    });
    const added = await backend.handle("addProject", [project]) as { id: string };
    await backend.handle("setProductProfile" as never, [added.id, "coding"]);
    const session = await backend.handle("newSession", [added.id, "Coding conversation"]) as { id: string; productProfile?: { id: string } };
    expect(session.productProfile?.id).toBe("coding");
    await backend.handle("sendPrompt", [session.id, "hello"]);
    const args = captured[0]!.join("\n");
    for (const id of [
      "coding-runtime",
      "coding-method",
      "agent-orchestration",
      "git-capability",
      "plan-extension",
      "goal-extension",
      "terminal-extension",
      "document-workbench",
      "skill-loader-extension",
    ]) expect(args).toContain(`/extensions/${id}/agent/index.ts`);
    expect(args).not.toMatch(/extensions\/pipiui-(?:coding-tools|git|reload|plan-runtime|electron-terminal|office-doc-shot-gate|firecrawl-anydoc|open-documents)\.ts/);
    await backend.close();
  });

  it("activates git-capability through agent-orchestration dependency closure", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-profile-git-closure-"));
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    const captured: string[][] = [];
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      runtimeAssets: { sourceRoot: runtimeSource },
      profileMode: "isolated",
      resourceMode: "explicit",
      canonicalProjectPaths: async () => undefined,
      piPath: process.execPath,
      spawn: (_bin, args, options) => {
        captured.push([...args]);
        return spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as never;
      },
    });
    const added = await backend.handle("addProject", [project]) as { id: string };

    expect(await backend.handle("createProductProfile" as never, [added.id, "Lab Tools"])).toMatchObject({
      id: "lab-tools",
      recommendedExtensionIds: [],
    });
    expect(await backend.handle("updateProductProfileExtensions" as never, [added.id, "lab-tools", ["agent-orchestration"]]))
      .toMatchObject({ recommendedExtensionIds: ["agent-orchestration"] });
    expect(await backend.handle("setProductProfile" as never, [added.id, "lab-tools"]))
      .toMatchObject({ profile: "lab-tools" });

    const listed = await backend.handle("listExtensions" as never, [added.id]) as Array<{ id: string; state: string }>;
    expect(listed.find(item => item.id === "agent-orchestration")?.state).toBe("enabled");
    expect(listed.find(item => item.id === "git-capability")?.state).toBe("enabled");
    expect(listed.find(item => item.id === "coding-runtime")?.state).not.toBe("enabled");

    const profiles = await backend.handle("listProductProfiles" as never, [added.id]) as Array<{
      id: string;
      requiredExtensionIds?: string[];
      recommendedExtensionIds?: string[];
    }>;
    const lab = profiles.find(item => item.id === "lab-tools");
    expect(lab?.requiredExtensionIds).toEqual(expect.arrayContaining(["skill-loader-extension", "git-capability"]));
    expect(lab?.recommendedExtensionIds).toEqual(expect.arrayContaining(["agent-orchestration"]));

    const session = await backend.handle("newSession", [added.id, "Closure conversation"]) as { id: string };
    await backend.handle("sendPrompt", [session.id, "hello"]);
    const args = captured[0]!.join("\n");
    expect(args).toContain("/extensions/agent-orchestration/agent/index.ts");
    expect(args).toContain("/extensions/git-capability/agent/index.ts");
    expect(args).not.toContain("/extensions/coding-runtime/agent/index.ts");

    await backend.handle("setExtensionEnabled" as never, ["git-capability", false, "project", added.id]);
    const afterDisable = await backend.handle("listExtensions" as never, [added.id]) as Array<{ id: string; state: string }>;
    expect(afterDisable.find(item => item.id === "git-capability")?.state).not.toBe("enabled");
    expect(afterDisable.find(item => item.id === "agent-orchestration")?.state).not.toBe("enabled");
    const conflicted = (await backend.handle("listProductProfiles" as never, [added.id]) as Array<{
      id: string;
      state: string;
      requiredExtensionIds?: string[];
    }>).find(item => item.id === "lab-tools");
    expect(conflicted?.state).toBe("error");
    expect(conflicted?.requiredExtensionIds ?? []).not.toContain("git-capability");

    await backend.close();
  });
});
