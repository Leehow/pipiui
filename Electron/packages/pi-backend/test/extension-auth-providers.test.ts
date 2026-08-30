import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  contributedProviderModulePath,
  loadContributedAuthProvider,
  registerContributedAuthProviders,
} from "../src/extension-auth-providers.js";

const grokDist = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../grok-build-oauth-extension/agent/dist/provider.js",
);

describe("generic extension auth provider registration", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  async function writeFakeProvider(id = "acme-chat") {
    root = await mkdtemp(join(tmpdir(), "ext-auth-reg-"));
    const dir = join(root, id);
    await mkdir(join(dir, "agent", "dist"), { recursive: true });
    await writeFile(
      join(dir, "agent", "dist", "provider.js"),
      `export const AUTH_PROVIDER_ID = ${JSON.stringify(id)};
export function createAuthProvider() {
  return { name: "Acme", api: "openai-completions", baseUrl: "https://api.example.com/v1", models: [{ id: "acme-fast", name: "Fast" }] };
}
`,
    );
    return dir;
  }

  it("resolves the conventional provider module and loads createAuthProvider", async () => {
    const dir = await writeFakeProvider();
    expect(contributedProviderModulePath(dir)).toBe(join(dir, "agent", "dist", "provider.js"));
    const loaded = await loadContributedAuthProvider(dir);
    expect(loaded).toEqual({
      id: "acme-chat",
      config: {
        name: "Acme",
        api: "openai-completions",
        baseUrl: "https://api.example.com/v1",
        models: [{ id: "acme-fast", name: "Fast" }],
      },
    });
  });

  it("registers a contributed provider once and skips packages without a factory", async () => {
    const dir = await writeFakeProvider();
    const empty = join(root, "empty");
    await mkdir(empty, { recursive: true });
    const registered: string[] = [];
    const known = new Set<string>();
    const runtime = {
      registerProvider: (id: string) => {
        registered.push(id);
        known.add(id);
      },
      getProvider: (id: string) => (known.has(id) ? { id } : undefined),
    };
    await registerContributedAuthProviders({
      runtime,
      claims: [
        {
          extensionId: "acme",
          enabled: true,
          contribution: { provider: { id: "acme-chat", name: "Acme", models: [] } },
        },
        {
          extensionId: "empty",
          enabled: true,
          contribution: { provider: { id: "empty", name: "Empty", models: [] } },
        },
      ],
      directoryOf: (id) => (id === "acme" ? dir : id === "empty" ? empty : undefined),
    });
    expect(registered).toEqual(["acme-chat"]);
    await registerContributedAuthProviders({
      runtime,
      claims: [
        {
          extensionId: "acme",
          enabled: false,
          contribution: { provider: { id: "acme-chat", name: "Acme", models: [] } },
        },
      ],
      directoryOf: () => dir,
    });
    expect(registered).toEqual(["acme-chat"]);
  });

  it("does not write models.json while registering", async () => {
    const dir = await writeFakeProvider();
    const modelsPath = join(root, "models.json");
    await writeFile(modelsPath, "{\"providers\":{}}\n");
    await registerContributedAuthProviders({
      runtime: { registerProvider: () => undefined },
      claims: [
        {
          extensionId: "acme",
          enabled: true,
          contribution: { provider: { id: "acme-chat", name: "Acme", models: [] } },
        },
      ],
      directoryOf: () => dir,
    });
    expect(await readFile(modelsPath, "utf8")).toBe("{\"providers\":{}}\n");
  });

  it("ignores Grok-named factory aliases and only loads createAuthProvider", async () => {
    root = await mkdtemp(join(tmpdir(), "ext-auth-legacy-"));
    const dir = join(root, "legacy-grok");
    await mkdir(join(dir, "agent", "dist"), { recursive: true });
    await writeFile(
      join(dir, "agent", "dist", "provider.js"),
      `export const GROK_BUILD_PROVIDER_ID = "grok-build";
export function createGrokBuildProvider() {
  return { name: "Legacy", api: "openai-completions", models: [] };
}
`,
    );
    expect(await loadContributedAuthProvider(dir)).toBeUndefined();
  });

  it("loads the built Grok provider factory when dist is present", async () => {
    if (!existsSync(grokDist)) return;
    const grokPkg = join(dirname(fileURLToPath(import.meta.url)), "../../grok-build-oauth-extension");
    const loaded = await loadContributedAuthProvider(grokPkg);
    expect(loaded?.id).toBe("grok-build");
    expect(loaded?.config).toMatchObject({
      name: "Grok Build",
      api: "openai-responses",
      baseUrl: "https://api.x.ai/v1",
    });
    const models = (loaded?.config as { models: Array<{ id: string }> }).models.map((model) => model.id);
    expect(models).toEqual(["grok-4.6", "grok-4-fast", "grok-code-fast-1"]);
    const getApiKey = (loaded?.config as { oauth: { getApiKey: (c: unknown) => string } }).oauth.getApiKey;
    expect(getApiKey({ access: "at-secret", refresh: "rt-secret" })).toBe("at-secret");
    expect(() => getApiKey({ refresh: "rt-secret" })).toThrow(/未登录/);
  });
});
