import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";
import { validateExtensionManifest } from "../src/extension-manifest.js";
import {
  authStatusContainsSecrets,
  detectContributionCollisions,
  extensionAuthStatus,
  filterCatalogByContributions,
  mergeContributedModelCapabilities,
  parseExtensionAuthContribution,
  reservedProviderClaimError,
  resolveContributedCatalog,
  type ContributionClaim,
} from "../src/extension-provider-contract.js";
import type { AuthInteractionLike, AuthRuntimeLike } from "../src/provider-auth.js";

const acmeContribution = {
  auth: {
    provider: {
      id: "acme-chat",
      name: "Acme Chat",
      api: "openai-completions",
      oauth: true,
      models: [
        {
          id: "acme-fast",
          name: "Acme Fast",
          api: "openai-completions",
          input: ["text"],
          reasoning: false,
        },
      ],
    },
  },
};

function fakeAuthRuntime(
  initialCredentialed: string[] = [],
  options: { runtimeModels?: boolean } = {},
): AuthRuntimeLike & { logouts: string[] } {
  const credentialed = new Set(initialCredentialed);
  const logouts: string[] = [];
  const includeRuntimeModels = options.runtimeModels !== false;
  const providers = [
    { id: "acme-chat", name: "Acme Chat", auth: { oauth: { loginLabel: "Login Acme" } } },
    { id: "anthropic", name: "Anthropic", auth: { apiKey: { login: {} } } },
  ];
  const catalog = [
    { provider: "acme-chat", id: "acme-fast", name: "Acme Fast", reasoning: false, input: ["text"] },
    { provider: "anthropic", id: "a1", name: "A1", reasoning: true },
  ];
  return {
    logouts,
    getProviders: async () => providers,
    getAvailable: async () =>
      includeRuntimeModels
        ? catalog.filter((model) => credentialed.has(model.provider))
        : catalog.filter((model) => model.provider !== "acme-chat" && credentialed.has(model.provider)),
    login: async (providerId, _authType, interaction: AuthInteractionLike) => {
      interaction.notify({ type: "auth_url", url: "https://auth.example.com/start", instructions: "open" });
      await interaction.prompt({ type: "manual_code", message: "code" });
      credentialed.add(providerId);
      return { type: "oauth" };
    },
    logout: async (providerId) => {
      credentialed.delete(providerId);
      logouts.push(providerId);
    },
  };
}

async function writeExtension(dir: string, id: string, body: unknown): Promise<void> {
  const dest = join(dir, id);
  await mkdir(dest, { recursive: true });
  await writeFile(join(dest, "pipiui-extension.json"), `${JSON.stringify(body, null, 2)}\n`);
}

describe("extension auth contribution validation", () => {
  it("accepts a Pi-shaped provider/model contribution", () => {
    const parsed = parseExtensionAuthContribution(acmeContribution.auth);
    expect(parsed).toEqual({
      ok: true,
      contribution: {
        provider: {
          id: "acme-chat",
          name: "Acme Chat",
          api: "openai-completions",
          oauth: true,
          models: [
            {
              id: "acme-fast",
              name: "Acme Fast",
              api: "openai-completions",
              input: ["text"],
              reasoning: false,
            },
          ],
        },
      },
    });
    const manifest = validateExtensionManifest({
      id: "acme",
      name: "Acme",
      version: "1.0.0",
      capabilities: [],
      ...acmeContribution,
    });
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;
    expect(manifest.manifest.auth?.provider.id).toBe("acme-chat");
  });

  it("rejects invalid provider ids, missing names, and duplicate model ids", () => {
    expect(parseExtensionAuthContribution({ provider: { id: "Acme", name: "Acme" } })).toMatchObject({
      ok: false,
    });
    expect(parseExtensionAuthContribution({ provider: { id: "acme" } })).toMatchObject({ ok: false });
    const dup = parseExtensionAuthContribution({
      provider: {
        id: "acme-chat",
        name: "Acme",
        models: [
          { id: "fast", name: "Fast" },
          { id: "fast", name: "Fast 2" },
        ],
      },
    });
    expect(dup?.ok).toBe(false);
    if (dup?.ok) return;
    expect(dup?.errors.join("; ")).toMatch(/duplicate model id/);
  });

  it("normalizes nativeSearch capabilities and rejects unknown tools", () => {
    const parsed = parseExtensionAuthContribution({
      provider: {
        id: "acme-chat",
        name: "Acme",
        models: [{
          id: "fast",
          name: "Fast",
          capabilities: {
            nativeSearch: {
              tools: ["web_search", "x_search"],
              domains: { allow: ["docs.example"] },
            },
            other: { ok: true },
          },
        }],
      },
    });
    expect(parsed).toMatchObject({
      ok: true,
      contribution: {
        provider: {
          models: [{
            id: "fast",
            capabilities: {
              other: { ok: true },
              nativeSearch: {
                tools: ["web_search", "x_search"],
                domains: { allow: ["docs.example"] },
              },
            },
          }],
        },
      },
    });
    const shorthand = parseExtensionAuthContribution({
      provider: {
        id: "acme-chat",
        name: "Acme",
        models: [{ id: "fast", name: "Fast", capabilities: { nativeSearch: ["x_search"] } }],
      },
    });
    expect(shorthand).toMatchObject({
      ok: true,
      contribution: { provider: { models: [{ capabilities: { nativeSearch: { tools: ["x_search"] } } }] } },
    });
    const bad = parseExtensionAuthContribution({
      provider: {
        id: "acme-chat",
        name: "Acme",
        models: [{ id: "fast", name: "Fast", capabilities: { nativeSearch: ["live_search"] } }],
      },
    });
    expect(bad?.ok).toBe(false);
    if (bad?.ok) return;
    expect(bad?.errors.join("; ")).toMatch(/web_search or x_search/);
  });

  it("normalizes hostedTools and request-feature capabilities", () => {
    const parsed = parseExtensionAuthContribution({
      provider: {
        id: "acme-chat",
        name: "Acme",
        models: [{
          id: "fast",
          name: "Fast",
          capabilities: {
            hostedTools: ["web_search", "code_interpreter"],
            structuredOutputs: true,
            inputFiles: { upload: true },
          },
        }],
      },
    });
    expect(parsed).toMatchObject({
      ok: true,
      contribution: {
        provider: {
          models: [{
            capabilities: {
              hostedTools: { tools: ["web_search", "code_interpreter"] },
              structuredOutputs: true,
              inputFiles: { upload: true },
            },
          }],
        },
      },
    });
    const bad = parseExtensionAuthContribution({
      provider: {
        id: "acme-chat",
        name: "Acme",
        models: [{ id: "fast", name: "Fast", capabilities: { hostedTools: ["file_search"] } }],
      },
    });
    expect(bad?.ok).toBe(false);
  });

  it("rejects colliding enabled provider claims and reserved host ids", () => {
    const claims: ContributionClaim[] = [
      {
        extensionId: "one",
        enabled: true,
        contribution: { provider: { id: "acme-chat", name: "One", models: [{ id: "fast", name: "Fast" }] } },
      },
      {
        extensionId: "two",
        enabled: true,
        contribution: { provider: { id: "acme-chat", name: "Two", models: [{ id: "pro", name: "Pro" }] } },
      },
    ];
    const collisions = detectContributionCollisions(claims);
    expect(collisions.map((item) => item.extensionId).sort()).toEqual(["one", "two"]);
    expect(reservedProviderClaimError("openai", new Set(["openai"]))).toMatch(/reserved/);
  });

  it("keeps contributed models only while enabled and authenticated", () => {
    const claims: ContributionClaim[] = [
      {
        extensionId: "acme",
        enabled: true,
        contribution: {
          provider: {
            id: "acme-chat",
            name: "Acme",
            models: [{ id: "declared", name: "Declared" }],
          },
        },
      },
    ];
    const existing = [
      { provider: "acme-chat", id: "acme-fast" },
      { provider: "anthropic", id: "a1" },
    ];
    const loggedIn = filterCatalogByContributions(existing, {
      claims,
      authenticatedProviders: new Set(["acme-chat"]),
    });
    expect(loggedIn.map((model) => `${model.provider}/${model.id}`)).toEqual([
      "acme-chat/acme-fast",
      "anthropic/a1",
    ]);
    const loggedOut = filterCatalogByContributions(existing, {
      claims,
      authenticatedProviders: new Set(),
    });
    expect(loggedOut.map((model) => `${model.provider}/${model.id}`)).toEqual(["anthropic/a1"]);

    const overlay = resolveContributedCatalog({
      claims,
      authenticatedProviders: new Set(["acme-chat"]),
      existing: loggedIn,
    });
    expect(overlay.models).toEqual([
      { provider: "acme-chat", id: "declared", name: "Declared" },
    ]);
  });

  it("preserves nativeSearch through overlay and merges it onto existing catalog rows", () => {
    const claims: ContributionClaim[] = [
      {
        extensionId: "acme",
        enabled: true,
        contribution: {
          provider: {
            id: "acme-chat",
            name: "Acme",
            models: [
              {
                id: "acme-fast",
                name: "Acme Fast",
                capabilities: { nativeSearch: { tools: ["web_search", "x_search"] } },
              },
              {
                id: "declared",
                name: "Declared",
                capabilities: {
                  nativeSearch: { tools: ["web_search"], domains: { deny: ["tracker.example"] } },
                },
              },
            ],
          },
        },
      },
    ];
    const overlay = resolveContributedCatalog({
      claims,
      authenticatedProviders: new Set(["acme-chat"]),
      existing: [{ provider: "acme-chat", id: "acme-fast" }],
    });
    expect(overlay.models).toEqual([{
      provider: "acme-chat",
      id: "declared",
      name: "Declared",
      capabilities: {
        nativeSearch: { tools: ["web_search"], domains: { deny: ["tracker.example"] } },
      },
    }]);
    const merged = mergeContributedModelCapabilities(
      [{ provider: "acme-chat", id: "acme-fast", name: "Runtime Fast" }],
      { claims, authenticatedProviders: new Set(["acme-chat"]) },
    );
    expect(merged[0]).toMatchObject({
      provider: "acme-chat",
      id: "acme-fast",
      name: "Runtime Fast",
      capabilities: { nativeSearch: { tools: ["web_search", "x_search"] } },
    });
  });

  it("does not let a disabled duplicate claim hide an enabled owner", () => {
    const claims: ContributionClaim[] = [
      {
        extensionId: "acme",
        enabled: true,
        contribution: { provider: { id: "acme-chat", name: "Acme", models: [{ id: "fast", name: "Fast" }] } },
      },
      {
        extensionId: "shadow",
        enabled: false,
        contribution: { provider: { id: "acme-chat", name: "Shadow", models: [{ id: "other", name: "Other" }] } },
      },
    ];
    const kept = filterCatalogByContributions(
      [{ provider: "acme-chat", id: "fast" }, { provider: "anthropic", id: "a1" }],
      { claims, authenticatedProviders: new Set(["acme-chat"]) },
    );
    expect(kept.map((model) => `${model.provider}/${model.id}`)).toEqual([
      "acme-chat/fast",
      "anthropic/a1",
    ]);
  });

  it("builds secret-free status", () => {
    const status = extensionAuthStatus({
      extensionId: "acme",
      providerId: "acme-chat",
      enabled: true,
      loggedIn: true,
      expiresAtMs: 1,
    });
    expect(status).toEqual({
      extensionId: "acme",
      providerId: "acme-chat",
      loggedIn: true,
      usable: true,
      expiresAtMs: 1,
    });
    expect(authStatusContainsSecrets(status)).toBe(false);
    expect(authStatusContainsSecrets({ ...status, accessToken: "tok" })).toBe(true);
  });

  it("passes richer model fields through parse and resolveContributedCatalog", () => {
    const parsed = parseExtensionAuthContribution({
      provider: {
        id: "acme-chat",
        name: "Acme",
        models: [
          {
            id: "vision",
            name: "Vision",
            api: "openai-responses",
            input: ["text", "image"],
            reasoning: true,
            contextWindow: 1_000_000,
            maxTokens: 384_000,
            cost: { input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0 },
            thinkingLevelMap: { high: "high", max: "max" },
            compat: { thinkingFormat: "deepseek" },
          },
        ],
      },
    });
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed || !parsed.ok) return;
    expect(parsed.contribution.provider.models[0]).toMatchObject({
      contextWindow: 1_000_000,
      maxTokens: 384_000,
      cost: { input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0 },
      thinkingLevelMap: { high: "high", max: "max" },
      compat: { thinkingFormat: "deepseek" },
    });
    const overlay = resolveContributedCatalog({
      claims: [{ extensionId: "acme", enabled: true, contribution: parsed.contribution }],
      authenticatedProviders: new Set(["acme-chat"]),
      existing: [],
    });
    expect(overlay.models).toEqual([
      {
        provider: "acme-chat",
        id: "vision",
        name: "Vision",
        api: "openai-responses",
        input: ["text", "image"],
        reasoning: true,
        contextWindow: 1_000_000,
        maxTokens: 384_000,
        cost: { input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0 },
        thinkingLevelMap: { high: "high", max: "max" },
        compat: { thinkingFormat: "deepseek" },
      },
    ]);
  });

  it("rejects invalid richer model fields", () => {
    const parsed = parseExtensionAuthContribution({
      provider: {
        id: "acme-chat",
        name: "Acme",
        models: [
          {
            id: "fast",
            name: "Fast",
            contextWindow: 0,
            maxTokens: -1,
            cost: { input: 1 },
            thinkingLevelMap: "high",
            compat: [],
          },
        ],
      },
    });
    expect(parsed?.ok).toBe(false);
    if (parsed?.ok) return;
    expect(parsed?.errors.join("; ")).toMatch(/contextWindow/);
    expect(parsed?.errors.join("; ")).toMatch(/maxTokens/);
    expect(parsed?.errors.join("; ")).toMatch(/cost/);
    expect(parsed?.errors.join("; ")).toMatch(/thinkingLevelMap/);
    expect(parsed?.errors.join("; ")).toMatch(/compat/);
  });

  it("skips contributed models whose provider\/id already exists", () => {
    const overlay = resolveContributedCatalog({
      claims: [
        {
          extensionId: "deepseek",
          enabled: true,
          contribution: {
            provider: {
              id: "deepseek",
              name: "DeepSeek",
              models: [
                { id: "deepseek-v4-flash", name: "Hijack Flash" },
                { id: "deepseek-v4-flash-vision-exp", name: "Vision" },
              ],
            },
          },
        },
      ],
      authenticatedProviders: new Set(["deepseek"]),
      existing: [{ provider: "deepseek", id: "deepseek-v4-flash" }],
    });
    expect(overlay.models).toEqual([
      { provider: "deepseek", id: "deepseek-v4-flash-vision-exp", name: "Vision" },
    ]);
  });
});

describe("extension provider contribution host lifecycle", () => {
  let root = "";
  let backend: ReturnType<typeof createPiHostBackend> | undefined;
  afterEach(async () => {
    await backend?.close?.();
    backend = undefined;
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  async function setup(
    credentialed: string[] = ["acme-chat"],
    options: { runtimeModels?: boolean } = {},
  ) {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-provider-"));
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    if (credentialed.includes("acme-chat")) {
      await writeFile(
        join(agent, "auth.json"),
        JSON.stringify({
          "acme-chat": { type: "oauth", access: "tok-secret", refresh: "ref-secret", expires: 9_999_999_999 },
        }),
      );
    }
    await writeFile(
      join(agent, "models.json"),
      JSON.stringify({ providers: { anthropic: { apiKey: "k", models: [{ id: "a1", name: "A1", reasoning: true }] } } }),
    );
    await writeExtension(join(agent, "extensions"), "acme", {
      id: "acme",
      name: "Acme",
      version: "1.0.0",
      capabilities: [],
      ...acmeContribution,
    });
    const runtime = fakeAuthRuntime(credentialed, options);
    backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      authRuntime: runtime,
    });
    return { agent, backend, runtime };
  }

  it("adds contributed models only after enable + login, and removes them on logout", async () => {
    const { agent, backend: host, runtime } = await setup([]);
    const catalogEvents: Array<{ type: string; reason: string }> = [];
    host.subscribe((event) => {
      if (event.channel === "models") catalogEvents.push(event.event);
    });

    expect((await host.handle("listModels", []) as { provider: string; id: string }[])
      .map((model) => `${model.provider}/${model.id}`)).toEqual(["anthropic/a1"]);

    await host.handle("setExtensionEnabled" as never, ["acme", true, "app"]);
    expect((await host.handle("listModels", []) as { provider: string; id: string }[])
      .map((model) => `${model.provider}/${model.id}`)).toEqual(["anthropic/a1"]);
    expect(catalogEvents.some((event) => event.reason === "extension")).toBe(true);

    const { loginId } = await host.handle("beginExtensionLogin" as never, ["acme", "oauth"]) as { loginId: string };
    expect(await host.handle("continueProviderLogin", [loginId])).toMatchObject({ kind: "auth_url" });
    expect(await host.handle("continueProviderLogin", [loginId])).toMatchObject({ kind: "prompt" });
    const completed = await host.handle("continueProviderLogin", [loginId, "ok"]);
    expect(completed).toEqual({ kind: "completed", providerId: "acme-chat" });
    const authDeadline = Date.now() + 2000;
    while (!catalogEvents.some((event) => event.reason === "auth") && Date.now() < authDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const loggedIn = await host.handle("listModels", []) as { provider: string; id: string }[];
    expect(loggedIn.map((model) => `${model.provider}/${model.id}`)).toContain("acme-chat/acme-fast");
    expect(catalogEvents.some((event) => event.reason === "auth")).toBe(true);

    await writeFile(
      join(agent, "auth.json"),
      JSON.stringify({
        "acme-chat": { type: "oauth", access: "tok-secret", refresh: "ref-secret", expires: 9_999_999_999 },
      }),
    );
    const status = await host.handle("getExtensionAuthStatus" as never, ["acme"]) as Record<string, unknown>;
    expect(status).toMatchObject({
      extensionId: "acme",
      providerId: "acme-chat",
      loggedIn: true,
      usable: true,
    });
    expect(authStatusContainsSecrets(status)).toBe(false);
    expect(JSON.stringify(status)).not.toContain("tok-secret");
    expect(JSON.stringify(status)).not.toContain("ref-secret");
    await writeFile(join(agent, "auth.json"), "{}\n");

    const state = await host.handle("logoutExtension" as never, ["acme"]) as { model: { provider: string; id: string } };
    expect(runtime.logouts).toEqual(["acme-chat"]);
    expect((await host.handle("listModels", []) as { provider: string; id: string }[])
      .map((model) => `${model.provider}/${model.id}`)).toEqual(["anthropic/a1"]);
    expect(state.model).toMatchObject({ provider: "anthropic", id: "a1" });

    const disk = JSON.parse(await readFile(join(agent, "models.json"), "utf8"));
    expect(disk.providers["acme-chat"]).toBeUndefined();
  });

  it("adds declared models after auth when the Pi provider catalog is empty", async () => {
    const { backend: host } = await setup(["acme-chat"], { runtimeModels: false });
    await host.handle("setExtensionEnabled" as never, ["acme", true, "app"]);
    expect((await host.handle("listModels", []) as { provider: string; id: string }[])
      .map((model) => `${model.provider}/${model.id}`)).toEqual([
      "anthropic/a1",
      "acme-chat/acme-fast",
    ]);
  });

  it("hides contributed models when the extension is disabled even if still authenticated", async () => {
    const { backend: host } = await setup(["acme-chat"]);
    await host.handle("setExtensionEnabled" as never, ["acme", true, "app"]);
    expect((await host.handle("listModels", []) as { provider: string; id: string }[])
      .map((model) => `${model.provider}/${model.id}`)).toContain("acme-chat/acme-fast");

    await host.handle("setExtensionEnabled" as never, ["acme", false, "app"]);
    expect((await host.handle("listModels", []) as { provider: string; id: string }[])
      .map((model) => `${model.provider}/${model.id}`)).toEqual(["anthropic/a1"]);
  });

  it("rejects colliding and reserved provider contributions at enable time", async () => {
    const { agent, backend: host } = await setup(["acme-chat"]);
    await writeExtension(join(agent, "extensions"), "acme-two", {
      id: "acme-two",
      name: "Acme Two",
      version: "1.0.0",
      capabilities: [],
      auth: { provider: { id: "acme-chat", name: "Other", models: [{ id: "other", name: "Other" }] } },
    });
    await writeExtension(join(agent, "extensions"), "hijack", {
      id: "hijack",
      name: "Hijack",
      version: "1.0.0",
      capabilities: [],
      auth: { provider: { id: "openai", name: "OpenAI", models: [{ id: "gpt", name: "GPT" }] } },
    });
    const listed = await host.handle("listExtensions" as never, []) as Array<{ id: string }>;
    expect(listed.map((item) => item.id)).toEqual(expect.arrayContaining(["acme", "acme-two", "hijack"]));

    await host.handle("setExtensionEnabled" as never, ["acme", true, "app"]);
    await expect(host.handle("setExtensionEnabled" as never, ["acme-two", true, "app"]))
      .rejects.toThrow(/already contributed/);
    await expect(host.handle("setExtensionEnabled" as never, ["hijack", true, "app"]))
      .rejects.toThrow(/reserved/);
  });

  it("keeps official deepseek Flash+Pro next to independent deepseek-extended Flash+Vision", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-deepseek-split-"));
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    await writeFile(
      join(agent, "models.json"),
      JSON.stringify({
        providers: {
          deepseek: {
            apiKey: "official-key",
            models: [
              { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", reasoning: true },
              { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: true },
            ],
          },
        },
      }),
    );
    await writeFile(
      join(agent, "auth.json"),
      JSON.stringify({
        "deepseek-extended": { type: "api_key", key: "ext-key" },
        deepseek: { type: "api_key", key: "official-key" },
      }),
    );
    await writeExtension(join(agent, "extensions"), "deepseek", {
      id: "deepseek",
      name: "DeepSeek Extended",
      version: "0.1.0",
      capabilities: [],
      auth: {
        provider: {
          id: "deepseek-extended",
          name: "DeepSeek Extended",
          api: "openai-responses",
          oauth: false,
          models: [
            { id: "deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision", api: "openai-responses" },
            { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", api: "openai-responses" },
          ],
        },
      },
    });
    const credentialed = new Set(["deepseek", "deepseek-extended"]);
    backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      authRuntime: {
        getProviders: async () => [
          { id: "deepseek", name: "DeepSeek", auth: { apiKey: { login: {} } } },
          { id: "deepseek-extended", name: "DeepSeek Extended", auth: { apiKey: { login: {} } } },
        ],
        getAvailable: async () => [
          { provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", reasoning: true },
          { provider: "deepseek", id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: true },
        ].filter((model) => credentialed.has(model.provider)),
        login: async (providerId) => {
          credentialed.add(providerId);
          return { type: "api_key" };
        },
        logout: async (providerId) => {
          credentialed.delete(providerId);
        },
      },
    });
    await backend.handle("setExtensionEnabled" as never, ["deepseek", true, "app"]);
    const refs = (await backend.handle("listModels", []) as { provider: string; id: string }[])
      .map((model) => `${model.provider}/${model.id}`);
    expect(refs.filter((ref) => ref.startsWith("deepseek/"))).toEqual([
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-pro",
    ]);
    expect(refs.filter((ref) => ref.startsWith("deepseek-extended/"))).toEqual([
      "deepseek-extended/deepseek-v4-flash-vision-exp",
      "deepseek-extended/deepseek-v4-flash",
    ]);
    expect(refs).not.toContain("deepseek/deepseek-v4-flash-vision-exp");
    expect(refs).not.toContain("deepseek-extended/deepseek-v4-pro");
  });

  it("does not additively merge a reserved deepseek claim into the official catalog", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-deepseek-reserved-"));
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    await writeFile(
      join(agent, "models.json"),
      JSON.stringify({
        providers: {
          deepseek: {
            apiKey: "official-key",
            models: [
              { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", reasoning: true },
              { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: true },
            ],
          },
        },
      }),
    );
    await writeFile(
      join(agent, "pipiui-settings.json"),
      JSON.stringify({ extensions: { "deepseek-hijack": { enabled: true } } }),
    );
    await writeFile(
      join(agent, "auth.json"),
      JSON.stringify({ deepseek: { type: "api_key", key: "official-key" } }),
    );
    await writeExtension(join(agent, "extensions"), "deepseek-hijack", {
      id: "deepseek-hijack",
      name: "DeepSeek Hijack",
      version: "0.1.0",
      capabilities: [],
      auth: {
        provider: {
          id: "deepseek",
          name: "DeepSeek",
          models: [
            { id: "deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision" },
            { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash hijacked" },
          ],
        },
      },
    });
    backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      authRuntime: {
        getProviders: async () => [{ id: "deepseek", name: "DeepSeek", auth: { apiKey: { login: {} } } }],
        getAvailable: async () => [
          { provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", reasoning: true },
          { provider: "deepseek", id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: true },
        ],
        login: async () => ({ type: "api_key" }),
        logout: async () => undefined,
      },
    });
    await expect(backend.handle("setExtensionEnabled" as never, ["deepseek-hijack", true, "app"]))
      .rejects.toThrow(/reserved/);
    const refs = (await backend.handle("listModels", []) as { provider: string; id: string; name: string }[])
      .filter((model) => model.provider === "deepseek");
    expect(refs.map((model) => model.id)).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
    expect(refs.find((model) => model.id === "deepseek-v4-flash")?.name).toBe("DeepSeek V4 Flash");
    expect(refs.some((model) => model.id === "deepseek-v4-flash-vision-exp")).toBe(false);
  });

  it("puts an invalid auth contribution into error and does not add models", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-provider-bad-"));
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    await writeExtension(join(agent, "extensions"), "bad", {
      id: "bad",
      name: "Bad",
      version: "1.0.0",
      capabilities: [],
      auth: { provider: { id: "Not Valid", name: "Bad" } },
    });
    backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      authRuntime: fakeAuthRuntime(),
    });
    const listed = await backend.handle("listExtensions" as never, []) as Array<{ id: string; state: string; error?: string }>;
    const bad = listed.find((item) => item.id === "bad");
    expect(bad?.state).toBe("error");
    expect(bad?.error).toMatch(/auth\.provider\.id/);
    expect((await backend.handle("listModels", []) as { provider: string }[]).some((model) => model.provider === "Not Valid")).toBe(false);
  });
});

describe("reserved official provider claims stay host-owned", () => {
  let root = "";
  let backend: ReturnType<typeof createPiHostBackend> | undefined;
  afterEach(async () => {
    await backend?.close?.();
    backend = undefined;
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  const visionContribution = {
    id: "deepseek-v4-flash-vision-exp",
    name: "DeepSeek V4 Flash Vision",
    api: "openai-responses",
    input: ["text", "image"],
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    cost: { input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0 },
    thinkingLevelMap: { high: "high", max: "max" },
    compat: { thinkingFormat: "deepseek" },
  };

  async function setupReserved(options: { authenticated?: boolean; enabled?: boolean } = {}) {
    const authenticated = options.authenticated !== false;
    const enabled = options.enabled !== false;
    root = await mkdtemp(join(tmpdir(), "pipi-ext-reserved-"));
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    if (authenticated) {
      await writeFile(
        join(agent, "auth.json"),
        JSON.stringify({ deepseek: { type: "api_key", key: "sk-test" } }),
      );
    }
    await writeFile(
      join(agent, "models.json"),
      JSON.stringify({
        providers: {
          anthropic: { apiKey: "k", models: [{ id: "a1", name: "A1", reasoning: true }] },
          deepseek: {
            apiKey: "k",
            models: [
              { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", reasoning: true },
              { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: true },
            ],
          },
        },
      }),
    );
    if (enabled) {
      await writeFile(
        join(agent, "pipiui-settings.json"),
        JSON.stringify({ extensions: { "deepseek-vision": { enabled: true } } }),
      );
    }
    await writeExtension(join(agent, "extensions"), "deepseek-vision", {
      id: "deepseek-vision",
      name: "DeepSeek Vision",
      version: "1.0.0",
      capabilities: [],
      auth: {
        provider: {
          id: "deepseek",
          name: "DeepSeek",
          api: "openai-responses",
          models: [
            visionContribution,
            {
              id: "deepseek-v4-flash",
              name: "Hijacked Flash",
              api: "openai-responses",
              input: ["text"],
              reasoning: true,
            },
          ],
        },
      },
    });
    const credentialed = new Set(authenticated ? ["deepseek", "anthropic"] : ["anthropic"]);
    const catalog = [
      { provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", reasoning: true, input: ["text"] },
      { provider: "deepseek", id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: true, input: ["text"] },
      { provider: "anthropic", id: "a1", name: "A1", reasoning: true },
    ];
    backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      authRuntime: {
        getProviders: async () => [
          { id: "deepseek", name: "DeepSeek", auth: { apiKey: { login: {} } } },
          { id: "anthropic", name: "Anthropic", auth: { apiKey: { login: {} } } },
        ],
        getAvailable: async () => catalog.filter((model) => credentialed.has(model.provider)),
        login: async () => ({ type: "api_key" }),
        logout: async () => undefined,
      },
    });
    return { agent, backend };
  }

  function keys(models: Array<{ provider: string; id: string; name?: string }>): string[] {
    return models.map((model) => `${model.provider}/${model.id}`);
  }

  it("does not let a reserved claim filter or replace built-in models", async () => {
    const { backend: host } = await setupReserved({ authenticated: false, enabled: true });
    const listed = await host.handle("listModels", []) as Array<{ provider: string; id: string; name: string }>;
    expect(keys(listed)).toEqual(expect.arrayContaining([
      "anthropic/a1",
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-pro",
    ]));
    expect(keys(listed)).not.toContain("deepseek/deepseek-v4-flash-vision-exp");
    expect(listed.find((model) => model.id === "deepseek-v4-flash")?.name).toBe("DeepSeek V4 Flash");
  });

  it("does not additively merge a reserved-provider model when enabled and authenticated", async () => {
    const { backend: host } = await setupReserved({ authenticated: true, enabled: true });
    const listed = await host.handle("listModels", []) as Array<{
      provider: string;
      id: string;
      name: string;
    }>;
    expect(keys(listed)).toEqual(expect.arrayContaining([
      "anthropic/a1",
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-pro",
    ]));
    expect(keys(listed)).not.toContain("deepseek/deepseek-v4-flash-vision-exp");
    expect(listed.filter((model) => model.id === "deepseek-v4-flash")).toHaveLength(1);
    expect(listed.find((model) => model.id === "deepseek-v4-flash")?.name).toBe("DeepSeek V4 Flash");
  });

  it("does not add a reserved-provider model when the extension is disabled", async () => {
    const { backend: host } = await setupReserved({ authenticated: true, enabled: false });
    const listed = await host.handle("listModels", []) as Array<{ provider: string; id: string }>;
    expect(keys(listed)).toEqual(expect.arrayContaining([
      "anthropic/a1",
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-pro",
    ]));
    expect(keys(listed)).not.toContain("deepseek/deepseek-v4-flash-vision-exp");
  });
});
