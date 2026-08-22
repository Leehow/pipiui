/**
 * Round-3 reviewer fixes — provider refresh contract.
 *
 * 1. Critical self-lock: pi-ai's `resolveStoredOAuth` calls the provider's
 *    `refreshToken` INSIDE `credentials.modify()`, i.e. while pi already holds
 *    the auth-store lock. These tests reproduce that exact call shape — first
 *    against the REAL pi AuthStorage (when installed), then against the raw
 *    unified file lock (always) — and prove the refresh completes quickly,
 *    performs exactly one network call, and never re-acquires the store lock.
 * 2. Tier preservation: a refresh response without `id_token` keeps the
 *    existing tier/tier_raw/tier_source; a fresh claim wins.
 * 3. Purity: the provider callback never writes auth.json itself — pi (or the
 *    broker, on its own locked path) owns persistence.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createGrokBuildProvider } from "../agent/provider.js";
import { refreshCredentialUnlocked } from "../agent/oauth/refresh.js";
import { GrokCredentialBroker } from "../agent/oauth/broker.js";
import { acquireAuthStoreLocks } from "../agent/oauth/lock.js";

function makeCred(overrides: Partial<Record<string, unknown>> = {}) {
  const now = Date.now();
  return {
    type: "oauth" as const,
    access: "at-old",
    refresh: "rt-old",
    expires: now + 30_000, // inside pi's 5-minute early-refresh window
    issuer: "https://auth.x.ai",
    client_id: "b1a00492-073a-47ea-816f-4c329264a828",
    scopes: ["openid", "profile"],
    token_type: "Bearer",
    obtained_at: now - 60_000,
    tier: "supergrok",
    tier_raw: "1",
    tier_source: "jwt",
    ...overrides,
  };
}

function b64(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

function idTokenWithTier(claim: unknown): string {
  return `x.${b64({ iss: "https://accounts.x.ai", tier: claim })}.y`;
}

/** The pi-ai adapter wrapper (provider-composer.js adaptOAuth.refresh). */
function adaptRefresh(provider: ReturnType<typeof createGrokBuildProvider>) {
  return async (credential: unknown, signal?: AbortSignal) => ({
    ...(await provider.oauth.refreshToken(credential, signal)),
    type: "oauth" as const,
  });
}

type PiStore = {
  read(provider: string): Promise<unknown>;
  modify(provider: string, fn: (current: unknown) => Promise<unknown>): Promise<unknown>;
  delete(provider: string): Promise<void>;
};

async function loadPiAuthStorage(): Promise<((authPath: string) => PiStore) | undefined> {
  try {
    // The pi package's exports map has no CJS/"require" condition, so
    // require.resolve on the bare specifier fails; walk up to the installed
    // package directly instead (test dir -> ... -> Electron/node_modules).
    const { existsSync } = await import("node:fs");
    const { pathToFileURL } = await import("node:url");
    let here = dirname(fileURLToPath(import.meta.url));
    while (true) {
      const candidate = join(here, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "auth-storage.js");
      if (existsSync(candidate)) {
        const mod = (await import(pathToFileURL(candidate).href)) as {
          AuthStorage: { create(authPath?: string): PiStore };
        };
        return (authPath: string) => mod.AuthStorage.create(authPath);
      }
      const parent = dirname(here);
      if (parent === here) return undefined;
      here = parent;
    }
  } catch {
    return undefined;
  }
}

describe("provider.refreshToken — no self-lock under the outer Pi credential-store lock", () => {
  let dir = "";
  let authPath = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ""; });
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "grok-provider-"));
    authPath = join(dir, "auth.json");
  });

  it("completes inside pi's credentials.modify() against the REAL pi AuthStorage (one fetch, tier kept, pi persists)", async () => {
    const createPiStore = await loadPiAuthStorage();
    const pi = createPiStore?.(authPath);
    if (!pi) return; // pi runtime not installed in this environment

    let fetchCalls = 0;
    const provider = createGrokBuildProvider({
      fetchImpl: (async () => {
        fetchCalls++;
        // Refresh response WITHOUT id_token — legal per OAuth; tier must survive.
        return new Response(
          JSON.stringify({ access_token: "at-new", refresh_token: "rt-new", expires_in: 3600 }),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
    });
    const refresh = adaptRefresh(provider);

    await pi.modify("anthropic", async () => ({ type: "api_key", key: "sk-keep" }));
    await pi.modify("grok-build", async () => makeCred() as unknown);

    // ── mirror of pi-ai resolveStoredOAuth (auth/resolve.js) ────────────────
    const DEFAULT_OAUTH_MINIMUM_VALIDITY_MS = 5 * 60 * 1000;
    const DEFAULT_OAUTH_REFRESH_TIMEOUT_MS = 15_000;
    const expiresSoon = (credential: { expires: number }) =>
      Date.now() + DEFAULT_OAUTH_MINIMUM_VALIDITY_MS >= credential.expires;
    const stored = (await pi.read("grok-build")) as { expires: number } | undefined;
    expect(stored).toBeTruthy();
    let post: Record<string, unknown> | undefined;
    if (stored && expiresSoon(stored)) {
      post = (await pi.modify("grok-build", async (current) => {
        const cur = current as { type?: string; expires?: number } | undefined;
        if (cur?.type !== "oauth") return undefined; // logged out meanwhile
        if (cur.expires !== undefined && !expiresSoon(cur)) return undefined; // refreshed meanwhile
        const refreshSignal = AbortSignal.any([AbortSignal.timeout(DEFAULT_OAUTH_REFRESH_TIMEOUT_MS)]);
        return await refresh(current, refreshSignal);
      })) as Record<string, unknown> | undefined;
    }
    // ── end mirror ──────────────────────────────────────────────────────────

    // OLD behavior: forceRefresh re-acquired <auth.json>.lock here and hung
    // until the 15s abort (and beyond — the acquire loop ignored the signal).
    expect(post).toBeTruthy();
    expect(post!.type).toBe("oauth");
    expect(post!.access).toBe("at-new");
    expect(post!.refresh).toBe("rt-new");
    expect(post!.tier).toBe("supergrok"); // preserved: response had no id_token
    expect(post!.tier_source).toBe("jwt");
    expect(fetchCalls).toBe(1);

    // pi (the modify caller) persisted the returned credential; the other
    // provider's entry survived the locked RMW.
    const data = JSON.parse(await readFile(authPath, "utf8")) as Record<string, Record<string, unknown>>;
    expect(data.anthropic?.key).toBe("sk-keep");
    expect(data["grok-build"]?.access).toBe("at-new");
    expect(data["grok-build"]?.tier).toBe("supergrok");
  });

  it("raw unified file lock held (non-reentrant, like pi's): refresh completes without acquiring a second lock", async () => {
    // acquireAuthStoreLocks speaks proper-lockfile's wire format — the SAME
    // lock pi's FileAuthStorageBackend takes — WITHOUT entering the file
    // adapter's AsyncLocalStorage reentrancy context, so a nested acquisition
    // by the provider would really block (this is the deadlock shape).
    let fetchCalls = 0;
    const provider = createGrokBuildProvider({
      fetchImpl: (async () => {
        fetchCalls++;
        return new Response(JSON.stringify({ access_token: "at-raw", refresh_token: "rt-raw", expires_in: 3600 }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const before = JSON.stringify({ "grok-build": makeCred(), anthropic: { type: "api_key", key: "sk-keep" } }, null, 2);
    await writeFile(authPath, `${before}\n`);

    const { resolveCredentialTarget } = await import("../agent/oauth/lock.js");
    const target = await resolveCredentialTarget(authPath);
    const locks = await acquireAuthStoreLocks(target);
    let bytesDuring: string | undefined;
    try {
      const next = await Promise.race([
        provider.oauth.refreshToken(makeCred(), undefined),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("self-lock: refresh did not complete while the outer store lock was held")), 8_000)),
      ]);
      expect(next.access).toBe("at-raw");
      bytesDuring = await readFile(authPath, "utf8");
    } finally {
      await locks.release().catch(() => {});
    }
    expect(fetchCalls).toBe(1);
    // Purity: the provider never wrote the store — bytes are untouched.
    expect(bytesDuring).toBe(`${before}\n`);
  });

  it("provider.refreshToken is pure: never reads or writes auth.json on its own", async () => {
    const provider = createGrokBuildProvider({
      fetchImpl: (async () => new Response(JSON.stringify({ access_token: "at-pure", refresh_token: "rt-pure", expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch,
    });
    const before = `${JSON.stringify({ "grok-build": makeCred() }, null, 2)}\n`;
    await writeFile(authPath, before);
    const next = await provider.oauth.refreshToken(makeCred());
    expect(next.access).toBe("at-pure");
    expect(await readFile(authPath, "utf8")).toBe(before);
  });

  it("honors the caller's abort signal (pi's 15s refresh timeout cancels the network call)", async () => {
    const provider = createGrokBuildProvider({
      fetchImpl: (async (_url: unknown, opts?: unknown) => {
        await new Promise((res, rej) => {
          const t = setTimeout(() => res(null), 2_000);
          (opts as RequestInit).signal?.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("Aborted", "AbortError")); }, { once: true });
        });
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });
    const ac = new AbortController();
    const p = provider.oauth.refreshToken(makeCred(), ac.signal);
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toThrow(/abort/i);
  });
});

describe("tier metadata across refresh (round-3 Warning: no id_token must not lose tier)", () => {
  let dir = "";
  let authPath = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ""; });
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "grok-tier-"));
    authPath = join(dir, "auth.json");
  });

  it("refreshCredentialUnlocked: response without id_token keeps tier/tier_raw/tier_source", async () => {
    const next = await refreshCredentialUnlocked(
      makeCred(),
      undefined,
      {
        fetchImpl: (async () => new Response(JSON.stringify({ access_token: "at-keep", expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch,
      },
    );
    expect(next.tier).toBe("supergrok");
    expect(next.tier_raw).toBe("1");
    expect(next.tier_source).toBe("jwt");
  });

  it("refreshCredentialUnlocked: a fresh id_token claim updates the tier", async () => {
    const next = await refreshCredentialUnlocked(
      makeCred({ tier: "supergrok", tier_raw: "1", tier_source: "jwt" }),
      undefined,
      {
        fetchImpl: (async () => new Response(JSON.stringify({ access_token: "at-chg", id_token: idTokenWithTier(0), expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch,
      },
    );
    expect(next.tier).toBe("free");
    expect(next.tier_raw).toBe("0");
    expect(next.tier_source).toBe("jwt");
  });

  it("refreshCredentialUnlocked: an unmapped numeric claim becomes raw-only (unknown, fail-open)", async () => {
    const next = await refreshCredentialUnlocked(
      makeCred({ tier: "supergrok", tier_raw: "1", tier_source: "jwt" }),
      undefined,
      {
        fetchImpl: (async () => new Response(JSON.stringify({ access_token: "at-raw7", id_token: idTokenWithTier(7), expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch,
      },
    );
    expect(next.tier).toBeUndefined();
    expect(next.tier_raw).toBe("7");
    expect(next.tier_source).toBe("jwt");
  });

  it("refreshCredentialUnlocked: no previous tier and no claim stays tier-less", async () => {
    const next = await refreshCredentialUnlocked(
      makeCred({ tier: undefined, tier_raw: undefined, tier_source: undefined }),
      undefined,
      {
        fetchImpl: (async () => new Response(JSON.stringify({ access_token: "at-none", expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch,
      },
    );
    expect(next.tier).toBeUndefined();
    expect(next.tier_raw).toBeUndefined();
    expect(next.tier_source).toBeUndefined();
  });

  it("broker path end-to-end: lock+RMW refresh preserves tier without id_token, updates it with a new claim", async () => {
    let idToken: string | undefined = undefined;
    const broker = new GrokCredentialBroker({
      authPath,
      fetchImpl: (async () => new Response(JSON.stringify({ access_token: "at-br", refresh_token: "rt-br", expires_in: 3600, ...(idToken ? { id_token: idToken } : {}) }), { status: 200 })) as unknown as typeof fetch,
    });
    await broker._writeForTest(makeCred() as never);
    const first = await broker.forceRefresh();
    expect(first.access).toBe("at-br");
    expect(first.tier).toBe("supergrok");
    const storedAfterFirst = JSON.parse(await readFile(authPath, "utf8")) as Record<string, Record<string, unknown>>;
    expect(storedAfterFirst["grok-build"]?.tier).toBe("supergrok");
    expect(storedAfterFirst["grok-build"]?.tier_source).toBe("jwt");

    idToken = idTokenWithTier(2);
    const second = await broker.forceRefresh();
    expect(second.access).toBe("at-br");
    expect(second.tier).toBe("x_basic");
    expect(second.tier_raw).toBe("2");
  });
});
