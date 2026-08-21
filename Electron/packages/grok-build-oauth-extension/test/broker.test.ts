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
    const old = new Date(Date.now() - 40_000);
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
