import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPiHostBackend } from "../src/index.js";
import { validateExtensionManifest } from "../src/extension-manifest.js";
import { EXTERNAL_SESSION_SCAN_EXTENSION_ID, VISION_ROUTING_EXTENSION_ID, WEB_SEARCH_KEYS_EXTENSION_ID } from "../src/host-feature-extensions.js";
import { encodeClaudeProjectDir } from "../src/external-sessions.js";
import { DEFAULT_SEARCH_ROUTING } from "../src/web-search-defaults.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const PACKAGE_DIR_BY_ID: Record<string, string> = {
  [VISION_ROUTING_EXTENSION_ID]: "vision-routing-extension",
  [WEB_SEARCH_KEYS_EXTENSION_ID]: "web-search-keys-extension",
  [EXTERNAL_SESSION_SCAN_EXTENSION_ID]: "external-session-scan-extension",
};

function readPackageManifest(id: string): unknown {
  return JSON.parse(readFileSync(join(packageRoot, PACKAGE_DIR_BY_ID[id], "pipiui-extension.json"), "utf8"));
}

describe("host-feature builtin extensions", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  async function isolatedBackend(
    ids: string[],
    options: {
      externalHome?: string;
      profileMode?: "default" | "isolated";
      /** Live-session harness: intercept Pi spawns and route them at fake-pi. */
      spawn?: Parameters<typeof createPiHostBackend>[0]["spawn"];
    } = {},
  ) {
    root = await mkdtemp(join(tmpdir(), "pipi-host-feature-"));
    const agent = join(root, "agent");
    const sessions = join(root, "sessions");
    const runtime = join(root, "runtime");
    const project = join(root, "project");
    await mkdir(agent, { recursive: true });
    await mkdir(project, { recursive: true });
    for (const id of ids) {
      const dest = join(runtime, "extensions", id);
      await mkdir(dest, { recursive: true });
      await writeFile(join(dest, "pipiui-extension.json"), `${JSON.stringify(readPackageManifest(id), null, 2)}\n`);
    }
    const backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: sessions,
      runtimeRoot: runtime,
      profileMode: options.profileMode ?? "isolated",
      canonicalProjectPaths: async () => undefined,
      ...(options.externalHome
        ? { externalSessionRoots: { home: options.externalHome }, env: { ...process.env, HOME: options.externalHome } }
        : {}),
      ...(options.spawn ? { spawn: options.spawn, piPath: process.execPath } : {}),
    });
    const added = await backend.handle("addProject", [project]) as { id: string; path: string };
    return { backend, agent, project, projectId: added.id };
  }

  it("validates all three package manifests as project-scoped settings builtins", () => {
    for (const id of [VISION_ROUTING_EXTENSION_ID, WEB_SEARCH_KEYS_EXTENSION_ID, EXTERNAL_SESSION_SCAN_EXTENSION_ID]) {
      const result = validateExtensionManifest(readPackageManifest(id));
      expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(true);
      if (!result.ok) continue;
      expect(result.manifest.id).toBe(id);
      expect(result.manifest.settings?.scope).toBe("project");
      expect(result.manifest.capabilities).toEqual(["settings.read", "settings.write"]);
      expect(result.manifest.ui?.settingsSections?.[0]?.entry).toBe("app/dist/settings-pane.js");
    }
  });

  it("lists all three as enabled builtins by default", async () => {
    const { backend, projectId } = await isolatedBackend([VISION_ROUTING_EXTENSION_ID, WEB_SEARCH_KEYS_EXTENSION_ID, EXTERNAL_SESSION_SCAN_EXTENSION_ID]);
    const listed = await backend.handle("listExtensions", [projectId]) as Array<{ id: string; state: string; source: string }>;
    for (const id of [VISION_ROUTING_EXTENSION_ID, WEB_SEARCH_KEYS_EXTENSION_ID, EXTERNAL_SESSION_SCAN_EXTENSION_ID]) {
      const item = listed.find((entry) => entry.id === id);
      expect(item).toMatchObject({ id, state: "enabled", source: "builtin" });
    }
    await backend.close();
  });

  it("web-search keys round-trip through the host as presence only and stop echoing when disabled", async () => {
    const { backend, project, projectId } = await isolatedBackend([WEB_SEARCH_KEYS_EXTENSION_ID]);
    const configured = await backend.handle("setWebSearchKeys", [projectId, { braveApiKey: "sk-live-secret" }]) as string[];
    expect(configured).toEqual(["braveApiKey"]);
    const presence = await backend.handle("getWebSearchKeys", [projectId]) as Record<string, boolean>;
    expect(presence).toEqual({ braveApiKey: true });
    expect(JSON.stringify(presence)).not.toContain("sk-live-secret");
    const onDisk = JSON.parse(await readFile(join(projectPiAgentDir(project), "web-search.json"), "utf8")) as {
      braveApiKey: string;
      searchRouting?: { providers: string[] };
    };
    expect(onDisk.braveApiKey).toBe("sk-live-secret");
    expect(onDisk.searchRouting?.providers[0]).toBe("brave");

    await backend.handle("setExtensionEnabled", [WEB_SEARCH_KEYS_EXTENSION_ID, false, "project", projectId]);
    expect(await backend.handle("getWebSearchKeys", [projectId])).toEqual({});
    const disabledDisk = JSON.parse(await readFile(join(projectPiAgentDir(project), "web-search.json"), "utf8")) as {
      braveApiKey: string;
      searchRouting?: { providers: string[] };
    };
    expect(disabledDisk.braveApiKey).toBe("sk-live-secret");
    expect(disabledDisk.searchRouting?.providers).toEqual([...DEFAULT_SEARCH_ROUTING.providers]);

    await backend.handle("setExtensionEnabled", [WEB_SEARCH_KEYS_EXTENSION_ID, true, "project", projectId]);
    expect(await backend.handle("getWebSearchKeys", [projectId])).toEqual({ braveApiKey: true });
    const enabledDisk = JSON.parse(await readFile(join(projectPiAgentDir(project), "web-search.json"), "utf8")) as {
      searchRouting?: { providers: string[] };
    };
    expect(enabledDisk.searchRouting?.providers[0]).toBe("brave");
    await backend.close();
  });

  it("keeps vision settings in pipiui-settings.json when the extension is disabled", async () => {
    const { backend, agent, projectId } = await isolatedBackend([VISION_ROUTING_EXTENSION_ID]);
    expect(await backend.handle("setVisionEnabled", [true])).toBe(true);
    expect(await backend.handle("setVisionModel", ["anthropic/claude-sonnet-4"])).toBe("anthropic/claude-sonnet-4");
    await backend.handle("setExtensionEnabled", [VISION_ROUTING_EXTENSION_ID, false, "project", projectId]);
    expect(await backend.handle("getVisionEnabled", [])).toBe(true);
    expect(await backend.handle("getVisionModel", [])).toBe("anthropic/claude-sonnet-4");
    const settings = JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8")) as {
      visionEnabled?: boolean;
      visionModel?: string;
    };
    expect(settings.visionEnabled).toBe(true);
    expect(settings.visionModel).toBe("anthropic/claude-sonnet-4");
    const listed = await backend.handle("listExtensions", [projectId]) as Array<{ id: string; state: string }>;
    expect(listed.find((entry) => entry.id === VISION_ROUTING_EXTENSION_ID)?.state).toBe("disabled");
    await backend.close();
  });

  it("gates the backend vision describe path on the vision-routing extension: disabled sends original images, enabled describes as before", async () => {
    const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const rpcs: Array<Record<string, any>> = [];
    const spawnFakePi: Parameters<typeof createPiHostBackend>[0]["spawn"] = (_bin, args, opts) => {
      const child = spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], opts) as any;
      const write = child.stdin.write.bind(child.stdin);
      child.stdin.write = (data: any, ...rest: any[]) => {
        for (const line of String(data).split("\n")) {
          if (!line.trim()) continue;
          try { rpcs.push(JSON.parse(line)); } catch { /* ignore */ }
        }
        return write(data, ...rest);
      };
      return child;
    };
    const { backend, project, projectId } = await isolatedBackend([VISION_ROUTING_EXTENSION_ID], { profileMode: "default", spawn: spawnFakePi });
    // Seed a session rooted at the registered project (same shape vision-describe tests use).
    const sessionsProject = join(root, "sessions", "project");
    await mkdir(sessionsProject, { recursive: true });
    await writeFile(join(sessionsProject, "s1.jsonl"), `${JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-08-10T00:00:00.000Z", cwd: project })}\n`);

    await backend.handle("setVisionModel", ["anthropic/claude-sonnet-4"]);
    await backend.handle("setVisionEnabled", [true]);
    await backend.handle("setModel", ["s1", "deepseek", "deepseek-chat"]);
    const describePrompts = () => rpcs.filter((rpc) => rpc.id === "describe-prompt");
    const mainPrompts = () => rpcs.filter((rpc) => rpc.type === "prompt" && rpc.id !== "describe-prompt" && rpc.id !== "title-prompt");

    // Enabled (default) → the describe path runs exactly as before: the vision
    // model describes the attachment and the main prompt carries text, no images.
    await backend.handle("sendPrompt", ["s1", "what does this show", [{ dataBase64: PNG_1x1, mimeType: "image/png", name: "shot.png" }]]);
    expect(describePrompts()).toHaveLength(1);
    expect(describePrompts()[0].images).toEqual([{ type: "image", data: PNG_1x1, mimeType: "image/png" }]);
    expect(mainPrompts().at(-1)).not.toHaveProperty("images");

    // Disabled at project scope → describe path inert: no side-channel RPCs and
    // the original image is sent with the main prompt (visionEnabled=false semantics).
    const describedBefore = describePrompts().length;
    await backend.handle("setExtensionEnabled", [VISION_ROUTING_EXTENSION_ID, false, "project", projectId]);
    await backend.handle("sendPrompt", ["s1", "what does this show", [{ dataBase64: PNG_1x1, mimeType: "image/png", name: "shot2.png" }]]);
    expect(describePrompts()).toHaveLength(describedBefore);
    const main = mainPrompts().at(-1) as Record<string, any>;
    expect(main.images).toEqual([{ type: "image", data: PNG_1x1, mimeType: "image/png" }]);
    await backend.close();
  });

  it("stops listing external sessions when the scan extension is disabled and restores them when re-enabled", async () => {
    const home = join(root, "external-home");
    const { backend, project, projectId } = await isolatedBackend([EXTERNAL_SESSION_SCAN_EXTENSION_ID], { externalHome: home });
    const claudeDir = join(home, ".claude", "projects", encodeClaudeProjectDir(project));
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, "claude-keep.jsonl"), `${JSON.stringify({
      type: "user",
      cwd: project,
      sessionId: "claude-keep",
      uuid: "cu1",
      timestamp: "2026-08-01T00:00:00.000Z",
      message: { role: "user", content: "keep claude" },
    })}\n`, "utf8");

    expect(await backend.handle("getScanExternalSessions", [])).toBe(true);
    const listed = await backend.handle("listExternalSessions", [projectId]) as Array<{ id: string }>;
    expect(listed.some((item) => item.id === "ext:claude:claude-keep")).toBe(true);

    await backend.handle("setExtensionEnabled", [EXTERNAL_SESSION_SCAN_EXTENSION_ID, false, "project", projectId]);
    expect(await backend.handle("listExternalSessions", [projectId])).toEqual([]);
    // The storage contract is untouched: the setting stays on, only the
    // project-scoped extension gate hides the sessions.
    expect(await backend.handle("getScanExternalSessions", [])).toBe(true);

    await backend.handle("setExtensionEnabled", [EXTERNAL_SESSION_SCAN_EXTENSION_ID, true, "project", projectId]);
    const relisted = await backend.handle("listExternalSessions", [projectId]) as Array<{ id: string }>;
    expect(relisted.some((item) => item.id === "ext:claude:claude-keep")).toBe(true);
    await backend.close();
  });
});
