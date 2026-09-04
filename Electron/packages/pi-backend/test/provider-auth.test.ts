import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend, SUBAGENT_MODEL_CATALOG_SNAPSHOT_VERSION } from "../src/index.js";
import { ProviderAuthBackend } from "../src/provider-auth.js";
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
    // The panel reads the cached listing instantly while a background refresh re-checks
    // the runtime; a broken registry must NOT blank the panel on its own.
    expect((await backend.handle("authProviders", []) as any[]).map(provider => provider.id)).toEqual(["deepseek"]);
    // Once the cache is invalidated (auth mutation path), the failure surfaces loudly.
    (backend as unknown as { auth: { invalidateProvidersCache(): void } }).auth.invalidateProvidersCache();
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

  it("custom provider RPC returns only after catalog publication settles — disk pair aligned on return without follow-up calls", async () => {
    root = await tempAgent();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const backend = createPiHostBackend({ agentDir: root, authRuntime: fakeAuthRuntime() });
    await backend.handle("addOpenAICompatibleProvider", [{
      name: "Settle Prov",
      baseUrl: "https://settle.example/v1",
      apiKey: "sk-settle",
      modelId: "m1",
    }]);
    // NO polling / no second RPC: when the call above returned, the subagent model display
    // cache must already be settled and include the new provider. (v3 is a presentation
    // cache; AUTHORITY acceptance was committed in memory before this line.)
    const file = join(root, "pipiui-subagent-model-catalog-runtime.json");
    const snap = JSON.parse(await readFile(file, "utf8"));
    expect(snap.version).toBe(SUBAGENT_MODEL_CATALOG_SNAPSHOT_VERSION);
    expect(snap.available).not.toBe(false);
    expect(snap.models.map((m: { id: string }) => m.id)).toContain("settle-prov/m1");
    await vi.waitFor(async () => {
      const raw = await readFile(`${file}.epoch`, "utf8").catch(() => null);
      expect(raw).toBeNull(); // retired v2 sidecar is never written again
    }, { timeout: 2000 });
  });

  it("custom provider RPC waits behind a busy modelsWrite job and still settles without deadlock", async () => {
    root = await tempAgent();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const backend = createPiHostBackend({ agentDir: root, authRuntime: fakeAuthRuntime() }) as any;
    const order: string[] = [];
    let releaseBlocker!: () => void;
    const blocker = new Promise<void>((resolve) => { releaseBlocker = resolve; });
    void backend.modelsWrite.enqueue(async () => {
      order.push("blocker-start");
      await blocker;
      order.push("blocker-end");
    }).catch(() => undefined);
    const rpc = (backend.handle("addOpenAICompatibleProvider", [{
      name: "Queued Prov",
      baseUrl: "https://queued.example/v1",
      apiKey: "sk-q",
      modelId: "qm1",
    }]) as Promise<{ providerId: string }>).then(
      (v) => { order.push("rpc-resolved"); return v; },
      (e) => { order.push("rpc-rejected"); throw e; },
    );
    // Let the RPC reach the queue; it must be WAITING, not completed out of order.
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(["blocker-start"]);
    releaseBlocker();
    const saved = await rpc;
    expect(saved.providerId).toBe("queued-prov");
    // FIFO completion AND settled catalog visible immediately after resolution.
    expect(order).toEqual(["blocker-start", "blocker-end", "rpc-resolved"]);
    const snap = JSON.parse(await readFile(join(root, "pipiui-subagent-model-catalog-runtime.json"), "utf8"));
    expect(snap.models.map((m: { id: string }) => m.id)).toContain("queued-prov/qm1");
  });

  it("custom provider RPC propagates persistence failure loudly and leaves the catalog untouched", async () => {
    root = await tempAgent();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await writeFile(join(root, "models.json"), "{corrupt-json", "utf8");
    const backend = createPiHostBackend({ agentDir: root, authRuntime: fakeAuthRuntime() });
    // Prime one healthy publication so "unchanged" is observable against a real baseline.
    // The backend tolerates unparsable models.json (treated as empty) for catalog reads;
    // materialize directly so the settle happens inside this test's control, not via a
    // fire-and-forget converge hook.
    await backend.handle("listModels", []);
    await (backend as unknown as { materializeSubagentModelCatalog(): Promise<void> }).materializeSubagentModelCatalog();
    const file = join(root, "pipiui-subagent-model-catalog-runtime.json");
    const failingCall = () => backend.handle("addOpenAICompatibleProvider", [{
      name: "Broken",
      baseUrl: "https://broken.example/v1",
      apiKey: "sk-b",
      modelId: "bm1",
    }]);
    await expect(failingCall()).rejects.toThrow(/models\.json/);
    const beforeSnap = await readFile(file, "utf8");
    await expect(failingCall()).rejects.toThrow(/models\.json/);
    expect(await readFile(file, "utf8")).toBe(beforeSnap);
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

  it("removing credentials deletes the models.json provider definition; the referenced .env key itself is untouched", async () => {
    root = await tempAgent();
    await writeFile(join(root, "models.json"), JSON.stringify({ providers: { openai: { apiKey: "$OPENAI_KEY", models: [{ id: "o1", name: "O1", reasoning: true }] } } }));
    await writeFile(join(root, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "o1" }));
    const runtime = fakeAuthRuntime();
    const backend = createPiHostBackend({ agentDir: root, authRuntime: runtime, env: { OPENAI_KEY: "ok" } });
    // Before deletion the env-resolved provider definition is a first-class catalog entry.
    expect((await backend.handle("listModels", []) as any[]).map(model => `${model.provider}/${model.id}`)).toContain("openai/o1");
    const state = await backend.handle("removeProviderCredentials", ["openai"]) as any;
    expect(runtime.logouts).toEqual(["openai"]);
    // New semantics: the definition (including its $ENV apiKey reference) is removed from
    // models.json; the environment / .env file itself is never written by the host.
    const disk = JSON.parse(await readFile(join(root, "models.json"), "utf8"));
    expect(disk.providers.openai).toBeUndefined();
    expect((await backend.handle("listModels", []) as any[]).map(model => `${model.provider}/${model.id}`)).not.toContain("openai/o1");
    expect(state).toMatchObject({ model: { provider: "unknown", id: "unknown" } });
  });

  it("deleting an inline-key custom provider (jellytoken) removes its models.json definition and logs out", async () => {
    root = await tempAgent();
    await writeFile(join(root, "models.json"), JSON.stringify({
      providers: {
        jellytoken: {
          api: "openai-completions",
          baseUrl: "https://jelly.example/v1",
          apiKey: "sk-inline",
          models: [{ id: "m1", name: "m1", reasoning: true }],
        },
      },
    }));
    await writeFile(join(root, "settings.json"), JSON.stringify({ defaultProvider: "jellytoken", defaultModel: "m1" }));
    await writeFile(join(root, "auth.json"), JSON.stringify({ jellytoken: { type: "api_key", key: "sk-inline" } }));
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const runtime = fakeAuthRuntime(["jellytoken"]);
    const backend = createPiHostBackend({ agentDir: root, authRuntime: runtime });
    // The inline-key mirror provider is usable before deletion (the reported bug: logout
    // alone left it usable because pi never touches models.json).
    expect((await backend.handle("listModels", []) as any[]).map(model => `${model.provider}/${model.id}`)).toContain("jellytoken/m1");
    const state = await backend.handle("removeProviderCredentials", ["jellytoken"]) as any;
    // (a) auth.json credentials were logged out via the pi runtime.
    expect(runtime.logouts).toEqual(["jellytoken"]);
    // (b) models.json was rewritten without the jellytoken definition (verified on disk).
    const disk = JSON.parse(await readFile(join(root, "models.json"), "utf8"));
    expect(disk.providers.jellytoken).toBeUndefined();
    // (c) the model is gone from the catalog.
    expect((await backend.handle("listModels", []) as any[]).map(model => `${model.provider}/${model.id}`)).not.toContain("jellytoken/m1");
    // (d) the active model fell back away from jellytoken.
    expect(state).toMatchObject({ model: { provider: "unknown", id: "unknown" } });
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

  it("login completes only AFTER the catalog refresh promise settles; refresh failure is an explicit failed terminal, never an unhandled rejection", async () => {
    const marks: string[] = [];
    let doResolve!: () => void;
    let doReject!: (e: Error) => void;
    let gate: Promise<void> = new Promise<void>((res) => { doResolve = res; });
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => { unhandled.push(e); };
    process.on("unhandledRejection", onUnhandled);
    const makeBackend = () => new ProviderAuthBackend({
      runtime: {
        getProviders: async () => [],
        getAvailable: async () => [],
        login: async (_p: unknown, _t: unknown, interaction: AuthInteractionLike) => {
          // Realistic api_key handshake: the prompt blocks until the answer arrives.
          await interaction.prompt({ type: "secret", message: "API key" });
          marks.push("login-resolved");
        },
        logout: async () => undefined,
      },
      authPath: join(root, "auth.json"),
      onLoginCompleted: async () => {
        marks.push("refresh-start");
        await gate;
        marks.push("refresh-end");
      },
    });
    try {
      // Success path: completed strictly after refresh-end.
      const be = makeBackend();
      const loginId = be.beginLogin("deepseek", "api_key");
      expect(await be.continueLogin(loginId)).toMatchObject({ kind: "prompt" });
      const finalAnswered = be.continueLogin(loginId, "sk-ordering");
      await new Promise((r) => setTimeout(r, 10));
      expect(marks).toEqual(["login-resolved", "refresh-start"]);
      let completedSeen = false;
      void finalAnswered.then(() => { completedSeen = true; });
      await new Promise((r) => setTimeout(r, 5));
      expect(completedSeen).toBe(false);
      doResolve();
      const event = await finalAnswered;
      expect(event).toEqual({ kind: "completed", providerId: "deepseek" });
      expect(marks).toEqual(["login-resolved", "refresh-start", "refresh-end"]);

      // Failure path: the refresh rejection becomes the login's terminal failure.
      marks.length = 0;
      gate = new Promise<void>((_res, rej) => { doReject = rej as (e: Error) => void; });
      const be2 = makeBackend();
      const loginId2 = be2.beginLogin("deepseek", "api_key");
      await be2.continueLogin(loginId2);
      const failingFinal = be2.continueLogin(loginId2, "sk-ordering-2");
      await new Promise((r) => setTimeout(r, 10));
      doReject(new Error("catalog blew up"));
      const failedEvent = await failingFinal;
      expect(failedEvent.kind).toBe("failed");
      expect(String((failedEvent as { error?: string }).error)).toMatch(/模型目录刷新失败/);
      expect(marks).toEqual(["login-resolved", "refresh-start"]);
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("production wiring: completed login observes a settled, aligned catalog pair immediately", async () => {
    root = await tempAgent();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const runtime = fakeAuthRuntime();
    const backend = createPiHostBackend({ agentDir: root, authRuntime: runtime });
    const { loginId } = await backend.handle("beginProviderLogin", ["deepseek", "api_key"]) as any;
    await backend.handle("continueProviderLogin", [loginId]);
    const completed = await backend.handle("continueProviderLogin", [loginId, "sk-wiring"]) as any;
    expect(completed).toEqual({ kind: "completed", providerId: "deepseek" });
    // When 'completed' was observable, the settled display cache already listed the newly
    // authenticated provider (v3 presentation cache; authority committed in memory first).
    const file = join(root, "pipiui-subagent-model-catalog-runtime.json");
    const snap = JSON.parse(await readFile(file, "utf8"));
    expect(snap.version).toBe(SUBAGENT_MODEL_CATALOG_SNAPSHOT_VERSION);
    expect(snap.available).not.toBe(false);
    expect(snap.models.map((m: { id: string }) => m.id)).toContain("deepseek/d1");
  });
});

describe("provider catalog cache", () => {
  let root = "";
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  it("prefetch warms the cache and later reads never re-query the runtime", async () => {
    root = await tempAgent();
    const runtime = fakeAuthRuntime();
    let getProvidersCalls = 0;
    const countingRuntime: AuthRuntimeLike = {
      ...runtime,
      getProviders: async () => {
        getProvidersCalls += 1;
        return runtime.getProviders();
      },
    };
    const backend = new ProviderAuthBackend({ runtime: countingRuntime, authPath: join(root, "auth.json") });
    backend.prefetchProviders();
    const first = await backend.listProvidersCached();
    expect(first.map(provider => provider.id)).toContain("anthropic");
    expect(getProvidersCalls).toBe(1);
    const second = await backend.listProvidersCached();
    expect(second).toEqual(first);
    expect(getProvidersCalls).toBe(1);
  });

  it("invalidateProvidersCache re-warms in the background and reflects new credential state", async () => {
    root = await tempAgent();
    let credentialed = false;
    const runtime: AuthRuntimeLike = {
      getProviders: async () => [{ id: "deepseek", name: "DeepSeek", auth: { apiKey: { login: {} } } }],
      getAvailable: async () => (credentialed ? [{ provider: "deepseek", id: "d1" }] : []),
      login: async () => undefined,
      logout: async () => undefined,
    };
    const backend = new ProviderAuthBackend({ runtime, authPath: join(root, "auth.json") });
    expect((await backend.listProvidersCached())[0]?.authenticated).toBe(false);
    credentialed = true;
    backend.invalidateProvidersCache();
    const fresh = await backend.listProvidersCached();
    expect(fresh[0]?.authenticated).toBe(true);
  });

  it("serves a stale entry immediately while refreshing it in the background", async () => {
    vi.useFakeTimers();
    root = await tempAgent();
    let credentialed = false;
    const runtime: AuthRuntimeLike = {
      getProviders: async () => [{ id: "deepseek", name: "DeepSeek", auth: { apiKey: { login: {} } } }],
      getAvailable: async () => (credentialed ? [{ provider: "deepseek", id: "d1" }] : []),
      login: async () => undefined,
      logout: async () => undefined,
    };
    const backend = new ProviderAuthBackend({ runtime, authPath: join(root, "auth.json") });
    const loaded = await backend.listProvidersCached();
    expect(loaded[0]?.authenticated).toBe(false);
    credentialed = true;
    vi.setSystemTime(Date.now() + 61_000); // older than the 60s TTL
    const stale = await backend.listProvidersCached();
    expect(stale[0]?.authenticated).toBe(false); // stale value served without blocking
    // The kicked background refresh settles asynchronously (fs roundtrip); reads after
    // it lands observe the fresh credential state.
    await vi.waitFor(async () => {
      const refreshed = await backend.listProvidersCached();
      expect(refreshed[0]?.authenticated).toBe(true);
    }, { timeout: 2000 });
  });
});

describe("openai-compatible model catalog + connectivity RPCs", () => {
  let root = "";
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  it("listOpenAICompatibleModels returns sorted model ids with probed context windows", async () => {
    root = await tempAgent();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://proxy.example/v1/models");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-live" });
      return new Response(JSON.stringify({ data: [
        { id: "zeta" },
        { id: "alpha", context_length: 8192 },
        { name: "beta", max_model_len: 4096 },
      ] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const backend = createPiHostBackend({ agentDir: root, authRuntime: fakeAuthRuntime() });
    const result = await backend.handle("listOpenAICompatibleModels", [{
      baseUrl: "https://proxy.example/v1/",
      apiKey: "sk-live",
    }]) as { models: { id: string; contextWindow?: number }[] };
    expect(result.models).toEqual([
      { id: "alpha", contextWindow: 8192 },
      { id: "beta", contextWindow: 4096 },
      { id: "zeta" },
    ]);
  });

  it("listOpenAICompatibleModels surfaces HTTP failures with the status", async () => {
    root = await tempAgent();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 401 })));
    const backend = createPiHostBackend({ agentDir: root, authRuntime: fakeAuthRuntime() });
    await expect(backend.handle("listOpenAICompatibleModels", [{
      baseUrl: "https://proxy.example/v1",
      apiKey: "sk",
    }])).rejects.toThrow("HTTP 401");
  });

  it("testOpenAICompatibleModel measures first-token latency and throughput from an SSE stream", async () => {
    root = await tempAgent();
    const sse = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "OK" } }] })}`,
      "",
      `data: ${JSON.stringify({ choices: [{ delta: { content: "!" } }] })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://proxy.example/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ model: "m1", stream: true });
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    }));
    const backend = createPiHostBackend({ agentDir: root, authRuntime: fakeAuthRuntime() });
    const result = await backend.handle("testOpenAICompatibleModel", [{
      baseUrl: "https://proxy.example/v1",
      apiKey: "sk",
      modelId: "m1",
    }]) as { ok: boolean; tokens: number; preview: string; firstTokenMs: number; totalMs: number; tokensPerSecond: number };
    expect(result.ok).toBe(true);
    expect(result.tokens).toBe(2);
    expect(result.preview).toBe("OK!");
    expect(result.firstTokenMs).toBeGreaterThanOrEqual(0);
    expect(result.totalMs).toBeGreaterThanOrEqual(result.firstTokenMs);
    expect(result.tokensPerSecond).toBeGreaterThan(0);
  });

  it("testOpenAICompatibleModel falls back to non-stream JSON responses using usage tokens", async () => {
    root = await tempAgent();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: "hi" } }], usage: { completion_tokens: 7 } }),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
    const backend = createPiHostBackend({ agentDir: root, authRuntime: fakeAuthRuntime() });
    const result = await backend.handle("testOpenAICompatibleModel", [{
      baseUrl: "https://proxy.example/v1",
      apiKey: "sk",
      modelId: "m1",
    }]) as { ok: boolean; tokens: number; firstTokenMs: number };
    expect(result.ok).toBe(true);
    expect(result.tokens).toBe(7);
    expect(result.firstTokenMs).toBeGreaterThanOrEqual(0);
  });

  it("testOpenAICompatibleModel propagates HTTP errors with the status", async () => {
    root = await tempAgent();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota exceeded", { status: 429 })));
    const backend = createPiHostBackend({ agentDir: root, authRuntime: fakeAuthRuntime() });
    await expect(backend.handle("testOpenAICompatibleModel", [{
      baseUrl: "https://proxy.example/v1",
      apiKey: "sk",
      modelId: "m1",
    }])).rejects.toThrow(/HTTP 429/);
  });
});
