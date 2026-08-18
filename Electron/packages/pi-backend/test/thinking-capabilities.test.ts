import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createPiHostBackend } from "../src/index.js";

describe("model thinking capability contract", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  });

  it("materializes mapped levels and preserves the standard fallback for the real xai/grok-4.6 catalog shape", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-thinking-capability-"));
    const agentDir = join(root, "agent");
    await mkdir(agentDir, { recursive: true });
    const backend = createPiHostBackend({
      agentDir,
      authRuntime: {
        getProviders: async () => [],
        getAvailable: async () => [
          {
            provider: "mapped",
            id: "mapped-reasoner",
            name: "Mapped Reasoner",
            reasoning: true,
            api: "openai-responses",
            thinkingLevelMap: {
              off: null,
              minimal: null,
              low: "low",
              medium: "medium",
              high: "high",
              xhigh: null,
              max: null,
            },
          },
          {
            provider: "xai",
            id: "grok-4.6",
            name: "Grok 4.6",
            reasoning: true,
            thinkingLevelMap: {
              off: null,
              minimal: "minimal",
              low: "low",
              medium: "medium",
              high: "high",
              xhigh: "xhigh",
              max: null,
            },
            api: "openai-completions",
            compat: {
              supportsStore: false,
              supportsDeveloperRole: false,
              supportsReasoningEffort: true,
            },
            input: ["text", "image"],
          },
          {
            provider: "unknown",
            id: "unknown-capability",
            name: "Unknown Capability",
          },
        ],
        login: async () => undefined,
        logout: async () => undefined,
      },
    });

    const models = await backend.handle("listModels", []) as any[];
    expect(models.find(model => model.provider === "mapped")).toMatchObject({
      reasoning: true,
      thinkingConfigurable: true,
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: null,
        max: null,
      },
    });
    expect(models.find(model => model.provider === "xai")).toMatchObject({
      reasoning: true,
      thinkingConfigurable: true,
      thinkingLevelMap: {
        off: null,
        minimal: "minimal",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: null,
      },
    });
    expect(models.find(model => model.provider === "unknown")).not.toHaveProperty("reasoning");

    expect(await backend.handle("setModel", ["mapped", "mapped-reasoner"])).toMatchObject({
      availableThinkingLevels: ["low", "medium", "high"],
    });
    expect(await backend.handle("setModel", ["xai", "grok-4.6"])).toMatchObject({
      availableThinkingLevels: ["minimal", "low", "medium", "high", "xhigh"],
    });
    expect(await backend.handle("setModel", ["unknown", "unknown-capability"])).toMatchObject({
      availableThinkingLevels: ["off", "minimal", "low", "medium", "high"],
    });
    await backend.close();
  });

  it("keeps sourced effort capabilities and persisted low when live Pi reports its generic fallback", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-thinking-grok46-"));
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    const sessionDir = join(root, "sessions", "project");
    await mkdir(agentDir, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      defaultProvider: "xai",
      defaultModel: "grok-4.6",
      defaultThinkingLevel: "off",
    }));
    await writeFile(join(agentDir, "models.json"), JSON.stringify({
      providers: {
        xai: {
          apiKey: "$XAI_TEST_KEY",
          modelOverrides: { "grok-4.6": { reasoning: true } },
        },
      },
    }));
    await writeFile(
      join(sessionDir, "session.jsonl"),
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "grok-session",
          timestamp: "2026-08-13T00:30:28.961Z",
          cwd,
        }),
        JSON.stringify({
          type: "thinking_level_change",
          id: "thinking-low",
          parentId: null,
          timestamp: "2026-08-13T00:30:30.000Z",
          thinkingLevel: "low",
        }),
      ].join("\n") + "\n",
    );
    let releaseCatalog!: () => void;
    const catalogGate = new Promise<void>(resolve => { releaseCatalog = resolve; });
    const catalogModel = {
      provider: "xai",
      id: "grok-4.6",
      name: "Grok 4.6",
      api: "openai-completions",
      reasoning: true,
      thinkingLevelMap: {
        off: null,
        minimal: "minimal",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: null,
      },
      compat: { supportsReasoningEffort: true },
      input: ["text", "image"],
    };
    const backend = createPiHostBackend({
      agentDir,
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      canonicalProjectPaths: async () => undefined,
      piPath: "node",
      env: { XAI_TEST_KEY: "present" },
      spawn: (_bin, _args, options) => spawn(
        "/usr/local/bin/node",
        [new URL("./fake-pi-grok46.mjs", import.meta.url).pathname],
        { ...options, env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" } },
      ) as any,
      authRuntime: {
        getProviders: async () => [],
        getAvailable: async () => {
          await catalogGate;
          return [catalogModel];
        },
        login: async () => undefined,
        logout: async () => undefined,
      },
    });

    const { getSupportedThinkingLevels } = await import("@earendil-works/pi-ai/compat");
    expect(getSupportedThinkingLevels({
      provider: "xai",
      id: "grok-4.6",
      name: "Grok 4.6",
      api: "openai-completions",
      reasoning: true,
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
      },
      input: ["text", "image"],
    } as any)).toEqual(["off", "minimal", "low", "medium", "high"]);

    // Reproduce canonical startup: session resume completes from raw/generic Pi
    // state before the slower auth-aware catalog returns its explicit override.
    await (backend as any).ensure("grok-session");
    releaseCatalog();
    expect(await backend.handle("getModelState", ["grok-session"])).toMatchObject({
      model: {
        provider: "xai",
        id: "grok-4.6",
        reasoning: true,
        thinkingConfigurable: true,
        thinkingLevelMap: {
          off: null,
          minimal: "minimal",
          low: "low",
          medium: "medium",
          high: "high",
          xhigh: "xhigh",
          max: null,
        },
      },
      thinkingLevel: "low",
      availableThinkingLevels: ["minimal", "low", "medium", "high", "xhigh"],
    });
    expect(await backend.handle("setThinkingLevel", ["grok-session", "medium"])).toMatchObject({
      thinkingLevel: "medium",
      availableThinkingLevels: ["minimal", "low", "medium", "high", "xhigh"],
    });
    expect(await backend.handle("setThinkingLevel", ["grok-session", "high"])).toMatchObject({
      thinkingLevel: "high",
      availableThinkingLevels: ["minimal", "low", "medium", "high", "xhigh"],
    });
    await backend.close();
  });

  it("reasserts an exact provider/id selection when live Pi drifts to a same-id sibling", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-thinking-provider-drift-"));
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    const sessionDir = join(root, "sessions", "project");
    await mkdir(agentDir, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      defaultProvider: "xai",
      defaultModel: "grok-4.6",
      defaultThinkingLevel: "low",
    }));
    await writeFile(join(sessionDir, "session.jsonl"), [
      JSON.stringify({ type: "session", version: 3, id: "provider-session", timestamp: "2026-08-13T01:15:37.333Z", cwd }),
      JSON.stringify({ type: "model_change", id: "model-xai", parentId: null, timestamp: "2026-08-13T01:15:38.367Z", provider: "xai", modelId: "grok-4.6" }),
      JSON.stringify({ type: "thinking_level_change", id: "thinking-low", parentId: "model-xai", timestamp: "2026-08-13T01:15:38.368Z", thinkingLevel: "low" }),
    ].join("\n") + "\n");
    const xai = {
      provider: "xai", id: "grok-4.6", name: "Grok 4.6", reasoning: true,
      thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null },
    };
    const opencode = {
      provider: "opencode", id: "grok-4.6", name: "Grok 4.6", reasoning: true,
      thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null },
    };
    const backend = createPiHostBackend({
      agentDir,
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      canonicalProjectPaths: async () => undefined,
      piPath: "node",
      spawn: (_bin, _args, options) => spawn(
        "/usr/local/bin/node",
        [new URL("./fake-pi-provider-drift.mjs", import.meta.url).pathname],
        { ...options, env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" } },
      ) as any,
      authRuntime: {
        getProviders: async () => [],
        getAvailable: async () => [xai, opencode],
        login: async () => undefined,
        logout: async () => undefined,
      },
    });

    expect(await backend.handle("getModelState", ["provider-session"])).toMatchObject({
      model: { provider: "xai", id: "grok-4.6" },
      thinkingLevel: "low",
      availableThinkingLevels: ["minimal", "low", "medium", "high", "xhigh"],
    });
    expect(await backend.handle("setModel", ["provider-session", "xai", "grok-4.6"])).toMatchObject({
      model: { provider: "xai", id: "grok-4.6" },
      availableThinkingLevels: ["minimal", "low", "medium", "high", "xhigh"],
    });
    await backend.close();
  });

  it("clamps a stale high off a sparse openai-codex thinkingLevelMap", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-thinking-codex-"));
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    const sessionDir = join(root, "sessions", "project");
    await mkdir(agentDir, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.6-luna",
      defaultThinkingLevel: "high",
    }));
    await writeFile(join(agentDir, "models.json"), JSON.stringify({
      providers: {
        "openai-codex": {
          apiKey: "$CODEX_TEST_KEY",
          modelOverrides: { "gpt-5.6-luna": { reasoning: true } },
        },
      },
    }));
    await writeFile(
      join(sessionDir, "session.jsonl"),
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "codex-session",
          timestamp: "2026-08-13T02:00:00.000Z",
          cwd,
        }),
        JSON.stringify({
          type: "model_change",
          id: "model-codex",
          parentId: null,
          timestamp: "2026-08-13T02:00:01.000Z",
          provider: "openai-codex",
          modelId: "gpt-5.6-luna",
        }),
        JSON.stringify({
          type: "thinking_level_change",
          id: "thinking-high",
          parentId: "model-codex",
          timestamp: "2026-08-13T02:00:01.001Z",
          thinkingLevel: "high",
        }),
      ].join("\n") + "\n",
    );
    let releaseCatalog!: () => void;
    const catalogGate = new Promise<void>(resolve => { releaseCatalog = resolve; });
    const catalogModel = {
      provider: "openai-codex",
      id: "gpt-5.6-luna",
      name: "GPT-5.6 Luna",
      reasoning: true,
      thinkingLevelMap: { minimal: "low", xhigh: "xhigh", max: "max" },
    };
    const backend = createPiHostBackend({
      agentDir,
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      canonicalProjectPaths: async () => undefined,
      piPath: "node",
      env: { CODEX_TEST_KEY: "present" },
      spawn: (_bin, _args, options) => spawn(
        "/usr/local/bin/node",
        [new URL("./fake-pi-codex.mjs", import.meta.url).pathname],
        { ...options, env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" } },
      ) as any,
      authRuntime: {
        getProviders: async () => [],
        getAvailable: async () => {
          await catalogGate;
          return [catalogModel];
        },
        login: async () => undefined,
        logout: async () => undefined,
      },
    });

    await (backend as any).ensure("codex-session");
    releaseCatalog();
    const state = await backend.handle("getModelState", ["codex-session"]) as any;
    expect(state.availableThinkingLevels).toEqual(["off", "minimal", "xhigh", "max"]);
    expect(state.availableThinkingLevels).not.toContain("high");
    expect(state.availableThinkingLevels).not.toContain("medium");
    expect(state.thinkingLevel).toBe("off");
    expect(await backend.handle("setModel", ["codex-session", "openai-codex", "gpt-5.6-luna"])).toMatchObject({
      thinkingLevel: "off",
      availableThinkingLevels: ["off", "minimal", "xhigh", "max"],
    });
    await expect(backend.handle("setThinkingLevel", ["codex-session", "high"])).rejects.toThrow(/unavailable/);
    await backend.close();
  });
});
