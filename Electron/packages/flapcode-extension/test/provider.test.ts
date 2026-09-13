import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import agent from "../agent/index.js";
import { stripUnsupportedFlapcodeParams } from "../agent/client.js";
import {
  API_KEY_ENV,
  normalizeBaseUrl,
  resolveFlapcodeApiKey,
  resolveFlapcodeConfig,
  SETTINGS_BASE_URL,
} from "../agent/config.js";
import { discoverFlapcodeBaseUrl, FLAPCODE_CONFIG_URL } from "../agent/discovery.js";
import {
  AUTH_PROVIDER_ID,
  createAuthProvider,
  createFlapcodeProvider,
  FLAPCODE_BASE_URL,
  FLAPCODE_DEFAULT_MODEL_ID,
  FLAPCODE_PROVIDER_ID,
  flapcodeManifestModels,
} from "../agent/provider.js";

const SETTINGS_ENV = "PIPIUI_EXT_SETTINGS_FLAPCODE";
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanEnv(): void {
  delete process.env[API_KEY_ENV];
  delete process.env[SETTINGS_ENV];
}

function mockFetch(payload: unknown, ok = true): typeof fetch {
  return (async () => ({
    ok,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

describe("flapcode extension entry", () => {
  afterEach(cleanEnv);

  it("registers the flapcode provider via the shared factory", () => {
    const providers = new Map<string, unknown>();
    const pi = {
      registerProvider: (id: string, config: unknown) => {
        providers.set(id, config);
      },
      on: () => undefined,
    };
    agent(pi as never);
    expect([...providers.keys()]).toEqual(["flapcode"]);
    const registered = providers.get(FLAPCODE_PROVIDER_ID) as ReturnType<typeof createFlapcodeProvider>;
    expect(AUTH_PROVIDER_ID).toBe("flapcode");
    expect(registered.name).toBe("Flapcode");
    expect(registered.api).toBe("openai-responses");
    expect(registered.baseUrl).toBe(FLAPCODE_BASE_URL);
    expect(registered.authHeader).toBe(true);
    expect(registered.models.map((model) => model.id)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-luna",
      "gpt-5.6-terra",
      "gpt-6-astra",
      "gpt-5.5",
    ]);
    // The default model from Flapcode's own docs ships first.
    expect(registered.models[0]?.id).toBe(FLAPCODE_DEFAULT_MODEL_ID);
  });

  it("pins a random UUID session-id header per provider instance (relay rejects its absence)", () => {
    // Live probing: without the hyphenated `session-id` header the relay 400s
    // ("Missing or invalid session-id header"); pi's own `session_id` /
    // `x-session-id` affinity headers are NOT accepted.
    const a = createFlapcodeProvider();
    const b = createFlapcodeProvider();
    expect(a.headers["session-id"]).toMatch(SESSION_ID_RE);
    expect(b.headers["session-id"]).toMatch(SESSION_ID_RE);
    expect(a.headers["session-id"]).not.toBe(b.headers["session-id"]);
    expect(Object.keys(a.headers)).toEqual(["session-id"]);
    const pinned = createFlapcodeProvider({ sessionId: "sess-fixed" });
    expect(pinned.headers["session-id"]).toBe("sess-fixed");
  });

  it("exposes createAuthProvider as the generic host loader export", () => {
    expect(createAuthProvider).toBe(createFlapcodeProvider);
    expect(AUTH_PROVIDER_ID).toBe(FLAPCODE_PROVIDER_ID);
  });

  it("resolves the API key from the vault-injected env var", () => {
    process.env[API_KEY_ENV] = "sk-flapcode-test";
    expect(resolveFlapcodeApiKey()).toBe("sk-flapcode-test");
    const provider = createFlapcodeProvider();
    expect(provider.apiKey).toBe("sk-flapcode-test");
  });

  it("omits apiKey when no key is configured", () => {
    expect(resolveFlapcodeApiKey()).toBeUndefined();
    expect(createFlapcodeProvider().apiKey).toBeUndefined();
  });

  it("honours the ext.flapcode.baseUrl settings override", () => {
    process.env[SETTINGS_ENV] = JSON.stringify({ [SETTINGS_BASE_URL]: "https://relay.example.com/v1/" });
    expect(resolveFlapcodeConfig().baseUrl).toBe("https://relay.example.com/v1");
    expect(createFlapcodeProvider().baseUrl).toBe("https://relay.example.com/v1");
  });

  it("rejects non-HTTPS and malformed base URLs", () => {
    expect(() => normalizeBaseUrl("http://insecure.example.com")).toThrow(/HTTPS/);
    expect(() => normalizeBaseUrl("not a url")).toThrow(/非法/);
    expect(() => normalizeBaseUrl("   ")).toThrow(/不能为空/);
  });

  it("keeps the manifest catalog aligned with flapcodeManifestModels", () => {
    const manifest = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "pipiui-extension.json"), "utf8"),
    ) as { auth: { provider: { id: string; name: string; api: string; models: unknown } } };
    expect(manifest.auth.provider.id).toBe("flapcode");
    expect(manifest.auth.provider.name).toBe("Flapcode");
    expect(manifest.auth.provider.api).toBe("openai-responses");
    // Deep equality, not just ids: the manifest is what the host overlays when
    // the Pi runtime catalog is empty, so a drifted price or context window
    // there is a wrong number shown to the user, not a cosmetic mismatch.
    expect(manifest.auth.provider.models).toEqual(JSON.parse(JSON.stringify(flapcodeManifestModels())));
  });

  it("declares the API key as a namespaced secret setting, never plain settings", () => {
    const manifest = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "pipiui-extension.json"), "utf8"),
    ) as {
      app: {
        settings: {
          scope: string;
          schema: { properties: Record<string, { type?: string; format?: string; default?: string }> };
        };
      };
    };
    const properties = manifest.app.settings.schema.properties;
    expect(manifest.app.settings.scope).toBe("app");
    // format:secret routes the value to the extension secret vault; it must
    // never become a plain settings-JSON field (see extension-settings.ts).
    expect(properties["ext.flapcode.apiKey"]?.format).toBe("secret");
    expect(properties["ext.flapcode.apiKey"]?.type).toBe("string");
    expect(properties["ext.flapcode.baseUrl"]?.format).toBeUndefined();
    expect(properties["ext.flapcode.baseUrl"]?.default).toBe(FLAPCODE_BASE_URL);
    for (const key of Object.keys(properties)) {
      expect(key.startsWith("ext.flapcode.")).toBe(true);
    }
  });
});

describe("flapcode wire sanitizer", () => {
  afterEach(cleanEnv);

  it("strips relay-unsupported params pi always sends", () => {
    // Live probing: the relay 400s "Unsupported parameter: max_output_tokens"
    // and "Unsupported parameter: prompt_cache_retention".
    const payload = {
      model: "gpt-5.6-sol",
      input: [],
      stream: true,
      store: false,
      max_output_tokens: 128000,
      prompt_cache_retention: "24h",
      prompt_cache_options: { mode: "explicit" },
      reasoning: { effort: "medium" },
      prompt_cache_key: "abc",
    };
    expect(stripUnsupportedFlapcodeParams(payload)).toEqual({
      model: "gpt-5.6-sol",
      input: [],
      stream: true,
      store: false,
      reasoning: { effort: "medium" },
      prompt_cache_key: "abc",
    });
  });

  it("returns undefined when there is nothing to strip", () => {
    expect(stripUnsupportedFlapcodeParams({ model: "gpt-5.6-sol", store: false })).toBeUndefined();
    expect(stripUnsupportedFlapcodeParams(undefined)).toBeUndefined();
    expect(stripUnsupportedFlapcodeParams("nope")).toBeUndefined();
  });

  it("rewrites flapcode requests through the hook and ignores other providers", () => {
    const hooks: Array<{ event: string; handler: (...args: unknown[]) => unknown }> = [];
    agent({
      registerProvider: () => undefined,
      on: (event: string, handler: (...args: unknown[]) => unknown) => {
        hooks.push({ event, handler });
      },
    } as never);
    const hook = hooks.find((item) => item.event === "before_provider_request");
    expect(hook).toBeTruthy();
    const other = hook!.handler(
      { payload: { max_output_tokens: 1 } },
      { model: { provider: "openai" } },
    );
    expect(other).toBeUndefined();
    const rewritten = hook!.handler(
      { payload: { max_output_tokens: 128000, prompt_cache_retention: "24h", store: false } },
      { model: { provider: "flapcode" } },
    );
    expect(rewritten).toEqual({ store: false });
  });
});

describe("flapcode gateway discovery", () => {
  afterEach(cleanEnv);

  it("returns the account base_url from the Flapcode account API", async () => {
    const seen: Array<{ url: unknown; auth: unknown }> = [];
    const fetchImpl = (async (url: unknown, init: { headers?: Record<string, string> }) => {
      seen.push({ url, auth: init?.headers?.Authorization });
      return { ok: true, json: async () => ({ base_url: "https://codex.takemoon.com/v1", model: "gpt-5.6-sol" }) };
    }) as unknown as typeof fetch;
    const found = await discoverFlapcodeBaseUrl("sk-flapcode-key", fetchImpl);
    expect(found).toBe("https://codex.takemoon.com/v1");
    expect(seen[0]?.url).toBe(FLAPCODE_CONFIG_URL);
    expect(seen[0]?.auth).toBe("Bearer sk-flapcode-key");
  });

  it("normalizes trailing slashes and rejects non-HTTPS discovered URLs", async () => {
    await expect(
      discoverFlapcodeBaseUrl("k", mockFetch({ base_url: "https://relay.example.com/v1///" })),
    ).resolves.toBe("https://relay.example.com/v1");
    await expect(discoverFlapcodeBaseUrl("k", mockFetch({ base_url: "http://insecure.example.com" }))).resolves.toBeUndefined();
  });

  it("returns undefined on HTTP errors, bad payloads and network failure", async () => {
    await expect(discoverFlapcodeBaseUrl("k", mockFetch({}, false))).resolves.toBeUndefined();
    await expect(discoverFlapcodeBaseUrl("k", mockFetch({}))).resolves.toBeUndefined();
    await expect(discoverFlapcodeBaseUrl("k", mockFetch({ base_url: 42 }))).resolves.toBeUndefined();
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(discoverFlapcodeBaseUrl("k", failing)).resolves.toBeUndefined();
  });
});
