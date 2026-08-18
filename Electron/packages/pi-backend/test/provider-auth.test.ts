import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";
import type { AuthEventLike, AuthInteractionLike, AuthPromptLike, AuthRuntimeLike } from "../src/provider-auth.js";

/** In-memory pi auth runtime with scripted login flows. Credential values never logged. */
function fakeAuthRuntime(initialCredentialed: string[] = []): AuthRuntimeLike & { capturedKeys: string[]; logouts: string[] } {
  const capturedKeys: string[] = [];
  const logouts: string[] = [];
  const credentialed = new Set(initialCredentialed);
  const providers = [
    { id: "anthropic", name: "Anthropic", auth: { oauth: { loginLabel: "Login Anthropic" }, apiKey: { login: {} } } },
    { id: "deepseek", name: "DeepSeek", auth: { apiKey: { login: {} } } },
    { id: "plain", name: "NoAuth", auth: undefined }
  ];
  const catalog = [
    { provider: "anthropic", id: "a1", name: "A1", reasoning: true, input: ["text", "image"] },
    { provider: "anthropic", id: "a2", name: "A2", reasoning: false },
    { provider: "deepseek", id: "d1", name: "D1", reasoning: true },
    { provider: "openai", id: "o1", name: "O1", reasoning: true }
  ];
  return {
    capturedKeys,
    logouts,
    getProviders: async () => providers,
    getAvailable: async () => catalog.filter(m => credentialed.has(m.provider)),
    login: async (providerId: string, authType: "api_key" | "oauth", interaction: AuthInteractionLike) => {
      if (authType === "oauth") {
        interaction.notify({ type: "auth_url", url: "https://auth.example.com/start", instructions: "open the link" });
        await interaction.prompt({ type: "manual_code", message: "enter device code" });
        credentialed.add(providerId);
        return { type: "oauth" };
      }
      const key = await interaction.prompt({ type: "secret", message: "API key" });
      capturedKeys.push(key);
      credentialed.add(providerId);
      return { type: "api_key", key };
    },
    logout: async (providerId: string) => { credentialed.delete(providerId); logouts.push(providerId) }
  };
}

async function tempAgent(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pipi-auth-"));
  const agent = join(root, "agent");
  await mkdir(agent, { recursive: true });
  return agent;
}

describe("provider auth via pi ModelRuntime bridge", () => {
  let root = "";
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  });

  it("lists auth-capable providers with credential metadata from auth.json (never key values)", async () => {
    root = await tempAgent();
    await writeFile(join(root, "auth.json"), JSON.stringify({ anthropic: { type: "oauth", access: "tok" } }));
    const backend = createPiHostBackend({ agentDir: root, authRuntime: fakeAuthRuntime(["anthropic"]) });
    const providers: any[] = await backend.handle("authProviders", []);
    expect(providers.map(p => p.id)).toEqual(["anthropic", "deepseek"]); // plain provider filtered out
    expect(providers.find(p => p.id === "anthropic")).toMatchObject({ authTypes: ["oauth", "api_key"], authenticated: true, authType: "oauth", loginLabel: "Login Anthropic" });
    expect(providers.find(p => p.id === "deepseek")).toMatchObject({ authTypes: ["api_key"], authenticated: false });
    expect(JSON.stringify(providers)).not.toContain("tok");
  });

  it("rejects a broken registry but keeps readable providers when one entry is malformed", async () => {
    root = await tempAgent();
    const runtime = fakeAuthRuntime();
    runtime.getProviders = async () => [
      { id: "broken", get name() { throw new Error("bad provider metadata") }, auth: { apiKey: { login: {} } } } as any,
      { id: "deepseek", name: "DeepSeek", auth: { apiKey: { login: {} } } },
    ];
    const backend = createPiHostBackend({ agentDir: root, authRuntime: runtime });
    expect((await backend.handle("authProviders", []) as any[]).map(provider => provider.id)).toEqual(["deepseek"]);
    runtime.getProviders = async () => { throw new Error("registry offline") };
    await expect(backend.handle("authProviders", [])).rejects.toThrow("无法读取 pi provider 目录：registry offline");
  });

  it("merges authenticated runtime models with configured custom/api-key models", async () => {
    root = await tempAgent();
    await writeFile(join(root, "models.json"), JSON.stringify({ providers: { openai: { apiKey: "$OPENAI_KEY", models: [{ id: "o1", name: "Configured O1", reasoning: true }] } } }));
    await writeFile(join(root, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "o1" }));
    const quotaStore = { snapshot: vi.fn(async () => { throw new Error("listModels must not fetch quota") }) };
    const backend = createPiHostBackend({ agentDir: root, authRuntime: fakeAuthRuntime(["anthropic"]), env: { OPENAI_KEY: "ok" }, quotaStore: quotaStore as any });
    const models = await backend.handle("listModels", []) as any[];
    expect(models.map(model => `${model.provider}/${model.id}`)).toEqual(["openai/o1", "anthropic/a1", "anthropic/a2"]);
    expect(quotaStore.snapshot).not.toHaveBeenCalled();
    expect(await backend.handle("setModel", ["anthropic", "a1"])).toMatchObject({ model: { provider: "anthropic", id: "a1" } });
  });

  it("runs an api-key login through prompt events and never leaks the key into events", async () => {
    root = await tempAgent();
    const runtime = fakeAuthRuntime();
    const backend = createPiHostBackend({ agentDir: root, authRuntime: runtime });
    const { loginId } = await backend.handle("beginProviderLogin", ["deepseek", "api_key"]) as any;
    const prompt = await backend.handle("continueProviderLogin", [loginId]);
    expect(prompt).toMatchObject({ kind: "prompt", promptType: "secret" });
    const secret = "sk-super-secret";
    const completed = await backend.handle("continueProviderLogin", [loginId, secret]);
    expect(completed).toEqual({ kind: "completed", providerId: "deepseek" });
    // The key reaches the storage boundary (the runtime) but never the wire events.
    expect(runtime.capturedKeys).toEqual([secret]);
    expect(JSON.stringify([prompt, completed])).not.toContain(secret);
  });

  it("streams an oauth device/browser flow (auth_url) and supports cancellation", async () => {
    root = await tempAgent();
    const runtime = fakeAuthRuntime();
    const backend = createPiHostBackend({ agentDir: root, authRuntime: runtime });
    const { loginId } = await backend.handle("beginProviderLogin", ["anthropic", "oauth"]) as any;
    const authUrl = await backend.handle("continueProviderLogin", [loginId]);
    expect(authUrl).toMatchObject({ kind: "auth_url", url: "https://auth.example.com/start", code: "open the link" });
    // cancel aborts the pending manual-code prompt
    await backend.handle("cancelProviderLogin", [loginId]);
    const after = await backend.handle("continueProviderLogin", [loginId]);
    expect(after.kind).toBe("cancelled");
    expect(runtime.logouts).toEqual([]);
  });

  it("removes provider credentials via pi logout, refreshes models, and keeps env-configured providers", async () => {
    root = await tempAgent();
    await writeFile(join(root, "models.json"), JSON.stringify({ providers: { openai: { apiKey: "$OPENAI_KEY", models: [{ id: "o1", name: "O1", reasoning: true }] } } }));
    await writeFile(join(root, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "o1" }));
    await writeFile(join(root, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "sk-x" } }));
    const runtime = fakeAuthRuntime(["anthropic"]);
    const backend = createPiHostBackend({ agentDir: root, authRuntime: runtime, env: { OPENAI_KEY: "ok" } });
    // anthropic was only credentialed via auth.json; openai via the resolved env key.
    expect((await backend.handle("listModels", []) as any[]).map(model => `${model.provider}/${model.id}`)).toEqual(["openai/o1", "anthropic/a1", "anthropic/a2"]);
    const state = await backend.handle("removeProviderCredentials", ["anthropic"]) as any;
    expect(runtime.logouts).toEqual(["anthropic"]);
    expect((await backend.handle("listModels", [])).map((m: any) => m.id)).not.toContain("a1");
    expect(state).toMatchObject({ model: { provider: "openai", id: "o1" } });
  });

  it("persists an OpenAI-compatible custom provider into models.json and lists its model", async () => {
    root = await tempAgent();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const backend = createPiHostBackend({ agentDir: root, authRuntime: fakeAuthRuntime() });
    const saved = await backend.handle("addOpenAICompatibleProvider", [{
      name: "My Proxy",
      baseUrl: "https://proxy.example/v1",
      apiKey: "sk-literal",
      modelId: "gpt-4o-mini",
    }]) as { providerId: string };
    expect(saved.providerId).toBe("my-proxy");
    const disk = JSON.parse(await readFile(join(root, "models.json"), "utf8"));
    expect(disk.providers["my-proxy"]).toMatchObject({
      api: "openai-completions",
      baseUrl: "https://proxy.example/v1",
      apiKey: "sk-literal",
      models: [{ id: "gpt-4o-mini", name: "gpt-4o-mini", reasoning: true }],
    });
    const models = await backend.handle("listModels", []) as { provider: string; id: string }[];
    expect(models.map(model => `${model.provider}/${model.id}`)).toContain("my-proxy/gpt-4o-mini");
  });

  it("persists probed context_length as contextWindow", async () => {
    root = await tempAgent();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://proxy.example/v1/models");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-literal" });
      return {
        ok: true,
        json: async () => ({ data: [{ id: "qwen3.7-plus", context_length: 131072 }] }),
      };
    }));
    const backend = createPiHostBackend({ agentDir: root, authRuntime: fakeAuthRuntime() });
    await backend.handle("addOpenAICompatibleProvider", [{
      name: "Jelly",
      baseUrl: "https://proxy.example/v1/",
      apiKey: "sk-literal",
      modelId: "qwen3.7-plus",
    }]);
    const disk = JSON.parse(await readFile(join(root, "models.json"), "utf8"));
    expect(disk.providers.jelly.models[0]).toMatchObject({
      id: "qwen3.7-plus",
      contextWindow: 131072,
    });
  });

  it("still adds a compat provider when the catalog probe fails", async () => {
    root = await tempAgent();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    const backend = createPiHostBackend({ agentDir: root, authRuntime: fakeAuthRuntime() });
    await backend.handle("addOpenAICompatibleProvider", [{
      name: "Jelly",
      baseUrl: "https://proxy.example/v1",
      apiKey: "sk-literal",
      modelId: "qwen3.7-plus",
    }]);
    const disk = JSON.parse(await readFile(join(root, "models.json"), "utf8"));
    expect(disk.providers.jelly.models[0]).toEqual({ id: "qwen3.7-plus", name: "qwen3.7-plus", reasoning: true });
    expect(disk.providers.jelly.models[0].contextWindow).toBeUndefined();
  });

  it("lets an explicit contextWindow win over the catalog probe", async () => {
    root = await tempAgent();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: "qwen3.7-plus", context_length: 8192 }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const backend = createPiHostBackend({ agentDir: root, authRuntime: fakeAuthRuntime() });
    await backend.handle("addOpenAICompatibleProvider", [{
      name: "Jelly",
      baseUrl: "https://proxy.example/v1",
      apiKey: "sk-literal",
      modelId: "qwen3.7-plus",
      contextWindow: 131072,
    }]);
    expect(fetchMock).not.toHaveBeenCalled();
    const disk = JSON.parse(await readFile(join(root, "models.json"), "utf8"));
    expect(disk.providers.jelly.models[0].contextWindow).toBe(131072);
  });

  it("keeps an env-configured model available when its provider credentials are removed", async () => {
    root = await tempAgent();
    await writeFile(join(root, "models.json"), JSON.stringify({ providers: { openai: { apiKey: "$OPENAI_KEY", models: [{ id: "o1", name: "O1", reasoning: true }] } } }));
    await writeFile(join(root, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "o1" }));
    const runtime = fakeAuthRuntime();
    const backend = createPiHostBackend({ agentDir: root, authRuntime: runtime, env: { OPENAI_KEY: "ok" } });
    // Pi logout only removes auth.json credentials; an explicit env API key remains usable.
    const state = await backend.handle("removeProviderCredentials", ["openai"]) as any;
    expect(runtime.logouts).toEqual(["openai"]);
    expect(state).toMatchObject({ model: { provider: "openai", id: "o1" } });
    expect((await backend.handle("getModelState", []))).toMatchObject({ model: { provider: "openai", id: "o1" } });
  });

  it("backfills missing contextWindow on existing openai-completions providers after catalog load", async () => {
    root = await tempAgent();
    await writeFile(join(root, "models.json"), JSON.stringify({
      providers: {
        jellytoken: {
          api: "openai-completions",
          baseUrl: "https://proxy.example/v1/",
          apiKey: "sk-literal",
          models: [{ id: "qwen3.7-plus", name: "qwen3.7-plus", reasoning: true }],
        },
      },
    }));
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: "qwen3.7-plus", context_length: 262144 }] }),
    })));
    const backend = createPiHostBackend({ agentDir: root, authRuntime: fakeAuthRuntime() }) as any;
    await backend.handle("listModels", []);
    await backend.compatContextBackfill;
    const disk = JSON.parse(await readFile(join(root, "models.json"), "utf8"));
    expect(disk.providers.jellytoken.models[0].contextWindow).toBe(262144);
  });

  it("leaves models.json untouched when the backfill probe fails and still loads the catalog", async () => {
    root = await tempAgent();
    const original = {
      providers: {
        jellytoken: {
          api: "openai-completions",
          baseUrl: "https://proxy.example/v1",
          apiKey: "sk-literal",
          models: [{ id: "qwen3.7-plus", name: "qwen3.7-plus", reasoning: true }],
        },
      },
    };
    await writeFile(join(root, "models.json"), JSON.stringify(original));
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const backend = createPiHostBackend({ agentDir: root, authRuntime: fakeAuthRuntime() }) as any;
    const models = await backend.handle("listModels", []) as { provider: string; id: string }[];
    await backend.compatContextBackfill;
    expect(models.map(m => `${m.provider}/${m.id}`)).toContain("jellytoken/qwen3.7-plus");
    expect(JSON.parse(await readFile(join(root, "models.json"), "utf8"))).toEqual(original);
  });

  it("probes each baseUrl only once per backend lifetime", async () => {
    root = await tempAgent();
    await writeFile(join(root, "models.json"), JSON.stringify({
      providers: {
        jellytoken: {
          api: "openai-completions",
          baseUrl: "https://proxy.example/v1",
          apiKey: "sk-literal",
          models: [
            { id: "qwen-a", name: "qwen-a", reasoning: true },
            { id: "qwen-b", name: "qwen-b", reasoning: true },
          ],
        },
      },
    }));
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [
        { id: "qwen-a", context_length: 100000 },
        { id: "qwen-b", context_length: 200000 },
      ] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const backend = createPiHostBackend({ agentDir: root, authRuntime: fakeAuthRuntime() }) as any;
    await backend.handle("listModels", []);
    await backend.compatContextBackfill;
    await backend.handle("listModels", []);
    await backend.refreshModelCatalog();
    await backend.compatContextBackfill;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never overwrites an existing contextWindow during backfill", async () => {
    root = await tempAgent();
    await writeFile(join(root, "models.json"), JSON.stringify({
      providers: {
        jellytoken: {
          api: "openai-completions",
          baseUrl: "https://proxy.example/v1",
          apiKey: "sk-literal",
          models: [
            { id: "keep", name: "keep", reasoning: true, contextWindow: 64000 },
            { id: "fill", name: "fill", reasoning: true },
          ],
        },
      },
    }));
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [
        { id: "keep", context_length: 8 },
        { id: "fill", context_length: 131072 },
      ] }),
    })));
    const backend = createPiHostBackend({ agentDir: root, authRuntime: fakeAuthRuntime() }) as any;
    await backend.handle("listModels", []);
    await backend.compatContextBackfill;
    const disk = JSON.parse(await readFile(join(root, "models.json"), "utf8"));
    expect(disk.providers.jellytoken.models.find((m: any) => m.id === "keep").contextWindow).toBe(64000);
    expect(disk.providers.jellytoken.models.find((m: any) => m.id === "fill").contextWindow).toBe(131072);
  });
});
