import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statSync } from "node:fs";
import { GrokCredentialBroker } from "../agent/oauth/broker.js";
import { redactMessage } from "../agent/oauth/redact.js";

function makeCred(overrides: Partial<Record<string, unknown>> = {}) {
  const now = Date.now();
  return {
    type: "oauth" as const,
    access: "at-old",
    refresh: "rt-old",
    expires: now + 3600_000,
    issuer: "https://auth.x.ai",
    client_id: "b1a00492-073a-47ea-816f-4c329264a828",
    scopes: ["openid", "profile"],
    token_type: "Bearer",
    obtained_at: now - 1000,
    ...overrides,
  };
}

describe("GrokCredentialBroker — early refresh, rotation, no-refresh, invalid_grant, network preserve", () => {
  let dir = "";
  let authPath = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ""; });
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "grok-broker-"));
    authPath = join(dir, "auth.json");
  });

  it("earlyRefresh: expiring within window triggers refresh, fresh does not", async () => {
    let fetchCalls = 0;
    const fakeFetch = async () => {
      fetchCalls++;
      return new Response(JSON.stringify({ access_token: "at-new", refresh_token: "rt-new", expires_in: 3600 }), { status: 200 });
    };
    const broker = new GrokCredentialBroker({ authPath, earlyRefreshSec: 60, fetchImpl: fakeFetch as unknown as typeof fetch });
    const expiring = makeCred({ expires: Date.now() + 30_000 });
    await broker._writeForTest(expiring as never);
    const token = await broker.getAccessToken();
    expect(token).toBe("at-new");
    expect(fetchCalls).toBe(1);

    fetchCalls = 0;
    const fakeFetch2 = async () => {
      fetchCalls++;
      return new Response(JSON.stringify({ access_token: "at-new2" }), { status: 200 });
    };
    const broker2 = new GrokCredentialBroker({ authPath, earlyRefreshSec: 60, fetchImpl: fakeFetch2 as unknown as typeof fetch });
    const token2 = await broker2.getAccessToken();
    expect(token2).toBe("at-new");
    expect(fetchCalls).toBe(0);
  });

  it("refresh rotation: new refresh replaces old, missing refresh retains old", async () => {
    const fakeFetch1 = async () => new Response(JSON.stringify({ access_token: "at-rot", refresh_token: "rt-rot", expires_in: 3600 }), { status: 200 });
    const broker = new GrokCredentialBroker({ authPath, fetchImpl: fakeFetch1 as unknown as typeof fetch });
    await broker._writeForTest(makeCred({ refresh: "rt-old" }) as never);
    await broker._writeForTest(makeCred({ refresh: "rt-old", expires: Date.now() + 10_000 }) as never);
    const refreshed = await broker.forceRefresh();
    expect(refreshed.refresh).toBe("rt-rot");
    expect(refreshed.access).toBe("at-rot");

    const fakeFetch2 = async () => new Response(JSON.stringify({ access_token: "at-norot", expires_in: 3600 }), { status: 200 });
    const broker2 = new GrokCredentialBroker({ authPath, fetchImpl: fakeFetch2 as unknown as typeof fetch });
    await broker2._writeForTest(makeCred({ refresh: "rt-keep", expires: Date.now() + 10_000 }) as never);
    const refreshed2 = await broker2.forceRefresh();
    expect(refreshed2.refresh).toBe("rt-keep");
    expect(refreshed2.access).toBe("at-norot");
  });

  it("no refresh token requires re-login (auth_expired), invalid_grant clears file", async () => {
    const fakeNoFetch = async () => { throw new Error("should not fetch"); };
    const brokerNoRefresh = new GrokCredentialBroker({ authPath, fetchImpl: fakeNoFetch as unknown as typeof fetch });
    await brokerNoRefresh._writeForTest(makeCred({ refresh: "", expires: Date.now() + 10_000 }) as never);
    await expect(brokerNoRefresh.forceRefresh()).rejects.toMatchObject({ code: "auth_expired" });

    const fakeInvalid = async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "bad refresh" }), { status: 400 });
    const brokerInvalid = new GrokCredentialBroker({ authPath, fetchImpl: fakeInvalid as unknown as typeof fetch });
    await brokerInvalid._writeForTest(makeCred({ refresh: "rt-bad", expires: Date.now() + 10_000 }) as never);
    await expect(brokerInvalid.forceRefresh()).rejects.toMatchObject({ code: "auth_expired" });
    const after = await brokerInvalid._readForTest();
    expect(after).toBeUndefined();
  });

  it("network/5xx preserves old credential and does not overwrite", async () => {
    let fetchCalls = 0;
    const fake500 = async () => { fetchCalls++; return new Response("server error", { status: 500 }); };
    const broker = new GrokCredentialBroker({ authPath, fetchImpl: fake500 as unknown as typeof fetch });
    const original = makeCred({ access: "at-preserve", refresh: "rt-preserve", expires: Date.now() + 10_000 });
    await broker._writeForTest(original as never);
    await expect(broker.forceRefresh()).rejects.toMatchObject({ code: expect.stringMatching(/refresh_failed|token_failed/) });
    const after = await broker._readForTest();
    expect(after?.access).toBe("at-preserve");
    expect(after?.refresh).toBe("rt-preserve");
    expect(fetchCalls).toBe(1);
  });
});

describe("Broker — in-process dedup, cross-process lock, crash recovery, atomic + 0600, redaction, 401 retry", () => {
  let dir = "";
  let authPath = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ""; });
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "grok-broker2-")); authPath = join(dir, "auth.json"); });

  it("in-process promise dedup: N concurrent forceRefresh only 1 network request", async () => {
    let calls = 0;
    const fakeFetch = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 30));
      return new Response(JSON.stringify({ access_token: "at-dedup", refresh_token: "rt-dedup", expires_in: 3600 }), { status: 200 });
    };
    const broker = new GrokCredentialBroker({ authPath, fetchImpl: fakeFetch as unknown as typeof fetch });
    await broker._writeForTest(makeCred({ refresh: "rt-old", expires: Date.now() + 10_000 }) as never);
    const results = await Promise.all([broker.forceRefresh(), broker.forceRefresh(), broker.forceRefresh(), broker.forceRefresh(), broker.forceRefresh()]);
    expect(calls).toBe(1);
    for (const r of results) expect(r.access).toBe("at-dedup");
    calls = 0;
    const fakeFetch2 = async () => { calls++; return new Response(JSON.stringify({ access_token: "at2" }), { status: 200 }); };
    const brokerFresh = new GrokCredentialBroker({ authPath, fetchImpl: fakeFetch2 as unknown as typeof fetch });
    await brokerFresh.getAccessToken();
    expect(calls).toBe(0);
  });

  it("cross-process lock simulation: two brokers contend, second reuses first's refresh via re-read + freshness guard", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 80));
      return new Response(JSON.stringify({ access_token: `at-${calls}`, refresh_token: `rt-${calls}`, expires_in: 3600 }), { status: 200 });
    };
    const brokerA = new GrokCredentialBroker({ authPath, fetchImpl: fakeFetch });
    const brokerB = new GrokCredentialBroker({ authPath, fetchImpl: fakeFetch });
    await brokerA._writeForTest(makeCred({ refresh: "rt-old", expires: Date.now() + 10_000 }) as never);
    const [a, b] = await Promise.all([brokerA.forceRefresh(), brokerB.forceRefresh()]);
    expect(calls).toBe(1);
    expect(a.access).toBe(b.access);
    expect(a.refresh).toBe(b.refresh);
  });

  it("crash recovery: stale lock is broken and refresh still succeeds", async () => {
    await writeFile(authPath, JSON.stringify({ "grok-build": makeCred({ refresh: "rt-old", expires: Date.now() + 10_000 }) }));
    const lockPath = `${authPath}.lock`;
    const { mkdir } = await import("node:fs/promises");
    await mkdir(lockPath).catch(() => {});
    const { utimes } = await import("node:fs/promises");
    const old = new Date(Date.now() - 120_000);
    await utimes(lockPath, old, old).catch(() => {});
    const fakeFetch = async () => new Response(JSON.stringify({ access_token: "at-recovered", expires_in: 3600 }), { status: 200 });
    const broker = new GrokCredentialBroker({ authPath, fetchImpl: fakeFetch as unknown as typeof fetch });
    const result = await broker.forceRefresh();
    expect(result.access).toBe("at-recovered");
  });

  it("0600 atomic write: auth.json is 0600, parent dir 0700, concurrent writes not corrupt", async () => {
    const fakeFetch = async () => new Response(JSON.stringify({ access_token: "at-0600", expires_in: 3600 }), { status: 200 });
    const broker = new GrokCredentialBroker({ authPath, fetchImpl: fakeFetch as unknown as typeof fetch });
    await broker._writeForTest(makeCred({ access: "at-init", refresh: "rt", expires: Date.now() + 100_000 }) as never);
    const st = statSync(authPath);
    const mode = st.mode & 0o777;
    expect(mode).toBe(0o600);
    const dirSt = statSync(dir);
    expect(dirSt.mode & 0o777).toBe(0o700);

    const fakeA = async () => { await new Promise((r)=> setTimeout(r, 20)); return new Response(JSON.stringify({ access_token: "at-a", expires_in: 3600 }), {status:200}); };
    const fakeB = async () => { await new Promise((r)=> setTimeout(r, 20)); return new Response(JSON.stringify({ access_token: "at-b", expires_in: 3600 }), {status:200}); };
    const brokerA = new GrokCredentialBroker({ authPath, fetchImpl: fakeA as unknown as typeof fetch });
    const brokerB = new GrokCredentialBroker({ authPath, fetchImpl: fakeB as unknown as typeof fetch });
    await brokerA._writeForTest(makeCred({ access: "at-old", refresh: "rt-old", expires: Date.now()+10_000 }) as never);
    await Promise.all([brokerA.forceRefresh().catch(()=>{}), brokerB.forceRefresh().catch(()=>{})]);
    const text = await readFile(authPath, "utf8");
    expect(() => JSON.parse(text)).not.toThrow();
    const parsed = JSON.parse(text);
    expect(parsed["grok-build"]).toBeTruthy();
    expect(typeof parsed["grok-build"].access).toBe("string");
    const st2 = statSync(authPath);
    expect(st2.mode & 0o777).toBe(0o600);
  });

  it("secret redaction: error messages never contain refresh or access tokens", async () => {
    const secretRefresh = "rt-super-secret-12345";
    const secretAccess = "at-super-secret-xyz";
    const fakeInvalid = async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: `token ${secretRefresh} invalid` }), { status: 400 });
    const broker = new GrokCredentialBroker({ authPath, fetchImpl: fakeInvalid as unknown as typeof fetch });
    await broker._writeForTest(makeCred({ access: secretAccess, refresh: secretRefresh, expires: Date.now()+10_000 }) as never);
    let caught: Error | undefined;
    try { await broker.forceRefresh(); } catch (e) { caught = e as Error; }
    expect(caught).toBeTruthy();
    expect(caught!.message).not.toContain(secretRefresh);
    expect(caught!.message).not.toContain(secretAccess);
    expect(caught!.message).toContain("[redacted]" );
    const redacted = redactMessage(`leaked ${secretRefresh} and ${secretAccess}`, [secretRefresh, secretAccess]);
    expect(redacted).not.toContain(secretRefresh);
    expect(redacted).toContain("[redacted]");
  });

  it("401 single retry: succeeds after one forced refresh, second 401 throws auth_expired", async () => {
    let refreshCalls = 0;
    const fakeFetch = async () => {
      refreshCalls++;
      return new Response(JSON.stringify({ access_token: `at-refreshed-${refreshCalls}`, expires_in: 3600 }), { status: 200 });
    };
    const broker = new GrokCredentialBroker({ authPath, fetchImpl: fakeFetch as unknown as typeof fetch });
    await broker._writeForTest(makeCred({ access: "at-old", refresh: "rt-old", expires: Date.now()+100_000 }) as never);

    let opCalls = 0;
    const op = async (token: string) => {
      opCalls++;
      if (opCalls === 1) {
        const err = new Error("401 Unauthorized") as Error & { status?: number };
        (err as { status: number }).status = 401;
        throw err;
      }
      return `ok-with-${token}`;
    };
    const result = await broker.with401Retry(op);
    expect(result).toMatch(/ok-with-at-refreshed-1/);
    expect(refreshCalls).toBe(1);
    expect(opCalls).toBe(2);

    let opCalls2 = 0;
    const op2 = async (_token: string) => {
      opCalls2++;
      const err = new Error("401 Unauthorized") as Error & { status?: number };
      (err as { status: number }).status = 401;
      throw err;
    };
    await broker._writeForTest(makeCred({ access: "at-old2", refresh: "rt-old2", expires: Date.now()+100_000 }) as never);
    const fakeFetch2 = async () => new Response(JSON.stringify({ access_token: "at-second-refresh", expires_in: 3600 }), { status: 200 });
    const broker2 = new GrokCredentialBroker({ authPath, fetchImpl: fakeFetch2 as unknown as typeof fetch });
    await expect(broker2.with401Retry(op2)).rejects.toMatchObject({ code: "auth_expired" });
    expect(opCalls2).toBe(2);
  });

  it("abort signal cancels refresh and does not write half state", async () => {
    const fakeSlow = async (_url: unknown, opts?: unknown) => {
      await new Promise((res, rej) => {
        const t = setTimeout(() => res(null), 200);
        (opts as RequestInit).signal?.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("Aborted","AbortError")); }, { once: true });
      });
      return new Response(JSON.stringify({ access_token: "at-aborted" }), { status: 200 });
    };
    const broker = new GrokCredentialBroker({ authPath, fetchImpl: fakeSlow as unknown as typeof fetch });
    await broker._writeForTest(makeCred({ access: "at-orig", refresh: "rt-orig", expires: Date.now()+10_000 }) as never);
    const ac = new AbortController();
    const p = broker.forceRefresh(ac.signal);
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toThrow(/Abort/);
    const after = await broker._readForTest();
    expect(after?.access).toBe("at-orig");
  });

  it("provider and image tools share same broker API (getAccessToken)", async () => {
    const fakeFetch = async () => new Response(JSON.stringify({ access_token: "at-shared", expires_in: 3600 }), { status: 200 });
    const broker = new GrokCredentialBroker({ authPath, fetchImpl: fakeFetch as unknown as typeof fetch });
    await broker._writeForTest(makeCred({ access: "at-shared-old", refresh: "rt-shared", expires: Date.now()+100_000 }) as never);
    const providerToken = await broker.getAccessToken();
    const imageToken = await broker.getAccessToken();
    expect(providerToken).toBe(imageToken);
    expect(providerToken).toBe("at-shared-old");

    await broker._writeForTest(makeCred({ access: "at-exp", refresh: "rt-shared", expires: Date.now()+10_000 }) as never);
    let calls = 0;
    const fakeFetch2 = async () => { calls++; return new Response(JSON.stringify({ access_token: "at-refreshed-shared", expires_in: 3600 }), { status: 200 }); };
    const broker2 = new GrokCredentialBroker({ authPath, fetchImpl: fakeFetch2 as unknown as typeof fetch });
    const [t1, t2] = await Promise.all([broker2.getAccessToken(), broker2.getAccessToken()]);
    expect(t1).toBe(t2);
    expect(calls).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-2 reviewer Critical #1 — the broker must share Pi ModelRuntime's lock.
// These tests race the broker against the REAL pi credential store
// (AuthStorage + FileAuthStorageBackend — exactly what ModelRuntime.create
// constructs internally), imported by file URL from the installed runtime.
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from "node:module";
import { realpathSync, symlinkSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createCredentialStoreAdapterFromStore } from "../agent/oauth/store-adapter.js";

const nodeRequire = createRequire(import.meta.url);

type PiStore = {
  read(provider: string): Promise<unknown>;
  modify(provider: string, fn: (current: unknown) => Promise<unknown>): Promise<unknown>;
  delete(provider: string): Promise<void>;
};

async function loadPiAuthStorage(): Promise<((authPath: string) => PiStore) | undefined> {
  try {
    const indexJs = nodeRequire.resolve("@earendil-works/pi-coding-agent");
    const { pathToFileURL } = await import("node:url");
    const mod = (await import(pathToFileURL(join(dirname(indexJs), "core", "auth-storage.js")).href)) as {
      AuthStorage: { create(authPath?: string): PiStore };
    };
    return (authPath: string) => mod.AuthStorage.create(authPath);
  } catch {
    return undefined;
  }
}

describe("Broker × Pi credential store — one lock, no lost fields (round-2 Critical #1)", () => {
  let dir = "";
  let authPath = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ""; });
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "grok-broker-pi-"));
    authPath = join(dir, "auth.json");
  });

  it("concurrent Pi login/logout/other-provider writes + broker refresh never lose fields", async () => {
    const createPiStore = await loadPiAuthStorage();
    const pi = createPiStore?.(authPath);
    if (!pi) return; // pi runtime not installed in this environment

    const broker = new GrokCredentialBroker({
      authPath,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ access_token: `at-${Date.now()}`, refresh_token: `rt-${Date.now()}`, expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch,
    });
    await broker._writeForTest(makeCred({ refresh: "rt-0", expires: Date.now() + 10_000 }) as never);

    // 15 rounds of interleaved ModelRuntime-style activity:
    // - login another provider (modify)
    // - logout another provider (delete)
    // - rotate a third provider's key
    // - broker refresh of grok-build
    for (let round = 1; round <= 15; round++) {
      await Promise.all([
        pi.modify("anthropic", async () => ({ type: "api_key", key: `sk-ant-${round}` })),
        round % 3 === 0
          ? pi.delete("deepseek").then(() => pi.modify("deepseek", async () => ({ type: "api_key", key: `sk-ds-${round}` })))
          : Promise.resolve(),
        pi.modify("openai", async (cur) => ({ ...(cur as object), type: "api_key", key: `sk-oai-${round}` })),
        broker.forceRefresh().catch(() => {}),
      ]);
    }

    const data = JSON.parse(await readFile(authPath, "utf8")) as Record<string, { key?: string; access?: string }>;
    expect(data.anthropic?.key).toBe("sk-ant-15");
    expect(data.deepseek?.key).toBe("sk-ds-15");
    expect(data.openai?.key).toBe("sk-oai-15");
    expect(typeof data["grok-build"]?.access).toBe("string");
    expect(data["grok-build"]?.access).toMatch(/^at-/);
  });

  it("Pi logout of grok-build racing a broker refresh leaves a consistent file (either logged out or refreshed)", async () => {
    const createPiStore = await loadPiAuthStorage();
    const pi = createPiStore?.(authPath);
    if (!pi) return;

    for (let round = 1; round <= 8; round++) {
      const broker = new GrokCredentialBroker({
        authPath,
        fetchImpl: (async () =>
          new Response(JSON.stringify({ access_token: `at-r${round}`, refresh_token: `rt-r${round}`, expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch,
      });
      await broker._writeForTest(makeCred({ refresh: `rt-${round}`, expires: Date.now() + 10_000 }) as never);
      await pi.modify("anthropic", async () => ({ type: "api_key", key: `sk-${round}` }));
      // Race: ModelRuntime logout (delete grok-build) vs broker refresh.
      await Promise.allSettled([pi.delete("grok-build"), broker.forceRefresh()]);
      const data = JSON.parse(await readFile(authPath, "utf8")) as Record<string, unknown>;
      // Whatever won, the OTHER provider must have survived every single round.
      expect((data.anthropic as { key: string }).key).toBe(`sk-${round}`);
      // And the grok-build entry is either absent (logout won) or a full oauth entry.
      const grok = data["grok-build"] as { type?: string; access?: string } | undefined;
      if (grok) expect(grok.type).toBe("oauth");
    }
  });

  it("broker refresh (network inside the lock) excludes a concurrent Pi write — no torn interleave", async () => {
    const createPiStore = await loadPiAuthStorage();
    const pi = createPiStore?.(authPath);
    if (!pi) return;

    const broker = new GrokCredentialBroker({
      authPath,
      fetchImpl: (async () => {
        // Slow "network" while the shared lock is held.
        await new Promise((r) => setTimeout(r, 120));
        return new Response(JSON.stringify({ access_token: "at-slow", refresh_token: "rt-slow", expires_in: 3600 }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    await broker._writeForTest(makeCred({ refresh: "rt-old", expires: Date.now() + 10_000 }) as never);
    await pi.modify("anthropic", async () => ({ type: "api_key", key: "sk-before" }));

    const refreshP = broker.forceRefresh();
    // Pi write started while the broker holds the lock across the "network" call.
    const piWriteP = new Promise<number>((resolve) => {
      setTimeout(() => resolve(Date.now()), 60);
    }).then(async (start) => {
      await pi.modify("anthropic", async () => ({ type: "api_key", key: "sk-during" }));
      return Date.now() - start;
    });
    const [refreshed] = await Promise.all([refreshP, piWriteP]);
    expect(refreshed.access).toBe("at-slow");
    const data = JSON.parse(await readFile(authPath, "utf8")) as Record<string, unknown>;
    expect((data.anthropic as { key: string }).key).toBe("sk-during");
    expect((data["grok-build"] as { access: string }).access).toBe("at-slow");
  });

  it("project symlink shape: session pi store (locks the symlink path) + broker share one real lock", async () => {
    const createPiStore = await loadPiAuthStorage();
    const piSession = createPiStore?.(authPath);
    if (!piSession) return;

    const canonicalDir = join(dir, "app-profile");
    mkdirSync(canonicalDir, { recursive: true });
    const canonical = join(canonicalDir, "auth.json");
    writeFileSync(canonical, "{}\n", { mode: 0o600 });
    const projectAgentDir = join(dir, "projectA", ".pi", "agent");
    mkdirSync(projectAgentDir, { recursive: true });
    const projectAuth = join(projectAgentDir, "auth.json");
    symlinkSync(canonical, projectAuth);

    // A session's ModelRuntime is constructed with the PROJECT authPath (pi
    // resolves PI_CODING_AGENT_DIR/auth.json and locks realpath:false — i.e.
    // the symlink path's own .lock). The broker is given the same path.
    const pi = createPiStore!(projectAuth);
    const broker = new GrokCredentialBroker({
      authPath: projectAuth,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ access_token: `at-${Date.now()}`, refresh_token: `rt-${Date.now()}`, expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch,
    });
    await broker._writeForTest(makeCred({ refresh: "rt-0", expires: Date.now() + 10_000 }) as never);

    for (let round = 1; round <= 8; round++) {
      await Promise.all([
        pi.modify("anthropic", async () => ({ type: "api_key", key: `sk-${round}` })),
        broker.forceRefresh().catch(() => {}),
      ]);
    }
    const data = JSON.parse(await readFile(realpathSync(canonical), "utf8")) as Record<string, unknown>;
    expect((data.anthropic as { key: string }).key).toBe("sk-8");
    expect(typeof (data["grok-build"] as { access: string }).access).toBe("string");
    // The project symlink was never replaced by the broker's atomic writes.
    const { lstatSync } = await import("node:fs");
    expect(lstatSync(projectAuth).isSymbolicLink()).toBe(true);
  });

  it("host-injected pi CredentialStore adapter: broker mutates only through it; invalid_grant never clears a rotated credential", async () => {
    const createPiStore = await loadPiAuthStorage();
    const pi = createPiStore?.(authPath);
    if (!pi) return;

    const adapter = createCredentialStoreAdapterFromStore(pi);
    const broker = new GrokCredentialBroker({
      authPath,
      credentialStore: adapter,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ access_token: `at-${Date.now()}`, refresh_token: `rt-${Date.now()}`, expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch,
    });
    await broker._writeForTest(makeCred({ refresh: "rt-0", expires: Date.now() + 10_000 }) as never);
    await pi.modify("anthropic", async () => ({ type: "api_key", key: "sk-keep" }));

    const refreshed = await broker.forceRefresh();
    expect(refreshed.access).toMatch(/^at-/);
    const afterRefresh = JSON.parse(await readFile(authPath, "utf8")) as Record<string, unknown>;
    expect((afterRefresh.anthropic as { key: string }).key).toBe("sk-keep");
    expect((afterRefresh["grok-build"] as { refresh: string }).refresh).toBe(refreshed.refresh);

    // Rotation race: the stored refresh token was already rotated by someone
    // else; an invalid_grant for the OLD token must NOT clear the new one.
    const staleBroker = new GrokCredentialBroker({
      authPath,
      credentialStore: createCredentialStoreAdapterFromStore(pi),
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: "invalid_grant", error_description: "bad token" }), { status: 400 })) as unknown as typeof fetch,
    });
    await expect(staleBroker.forceRefresh()).rejects.toMatchObject({ code: "auth_expired" });
    const afterRace = JSON.parse(await readFile(authPath, "utf8")) as Record<string, unknown>;
    // The currently-valid credential survived the stale invalid_grant.
    expect(afterRace["grok-build"]).toBeTruthy();
    expect(typeof (afterRace["grok-build"] as { access: string }).access).toBe("string");
  });

  it("file adapter: invalid_grant for a rotated-away refresh token keeps the rotated credential (rotation race)", async () => {
    // Deterministic interleave (no timer races): the rotation lands while the
    // refresh HTTP call is in flight — i.e. between the broker's unlocked read
    // (sees rt-old) and its locked re-read inside withExclusive (must see
    // rt-new). Driving the write from inside fetchImpl pins that order on
    // every machine, however loaded.
    const rotated = makeCred({ access: "at-new", refresh: "rt-new", expires: Date.now() + 3600_000, obtained_at: Date.now() }) as never;
    let rotations = 0;
    const broker = new GrokCredentialBroker({
      authPath,
      fetchImpl: (async () => {
        if (rotations++ === 0) {
          // "Another process" rotates the credential under the refresh call.
          await writeFile(authPath, JSON.stringify({ "grok-build": rotated }, null, 2));
        }
        return new Response(JSON.stringify({ error: "invalid_grant", error_description: "bad token" }), { status: 400 });
      }) as unknown as typeof fetch,
    });
    // The broker believes the older credential (rt-old) when it starts.
    const stale = makeCred({ access: "at-old", refresh: "rt-old", expires: Date.now() + 10_000, obtained_at: Date.now() - 5_000 }) as never;
    await broker._writeForTest(stale);
    // The broker must surface the rotated credential (not throw, not loop):
    // a refresh failure for a token that is no longer stored means another
    // process already fixed the store.
    const res = await broker.forceRefresh();
    expect(res.refresh).toBe("rt-new");
    const after = JSON.parse(await readFile(authPath, "utf8")) as Record<string, unknown>;
    // The rotated credential was NOT cleared by the stale invalid_grant.
    expect((after["grok-build"] as { refresh: string }).refresh).toBe("rt-new");
    expect((after["grok-build"] as { access: string }).access).toBe("at-new");
  });
});
