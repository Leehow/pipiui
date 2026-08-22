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
