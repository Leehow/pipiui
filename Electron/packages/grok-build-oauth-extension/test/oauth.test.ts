import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { resolveOAuthConfig, PROD_ISSUER, PROD_CLIENT_ID, defaultScopes } from "../agent/oauth/config.js";
import { requestDeviceCode, pollDeviceToken, refreshAccessToken, OAuthError } from "../agent/oauth/device.js";
import { redactMessage, redactObject } from "../agent/oauth/redact.js";
import { importFromGlobalGrok } from "../agent/oauth/import.js";
import { GrokCredentialBroker } from "../agent/oauth/broker.js";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Helpers
function fakeClock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    nowMs: () => now,
    sleep: async (ms: number, signal?: AbortSignal) => {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      sleeps.push(ms);
      now += ms;
    },
    advance: (ms: number) => { now += ms; },
    sleeps,
    setNow: (v: number) => { now = v; },
  };
}

describe("oauth config", () => {
  const orig = { ...process.env };
  afterEach(() => {
    // restore
    for (const k of Object.keys(process.env)) if (!(k in orig)) delete process.env[k as never];
    for (const [k, v] of Object.entries(orig)) process.env[k] = v as string;
    delete process.env.PIPIUI_EXT_SETTINGS_GROK_BUILD_OAUTH;
  });

  it("defaults to prod issuer/client/scopes", () => {
    delete process.env.GROK_OAUTH2_ISSUER;
    delete process.env.GROK_OAUTH2_CLIENT_ID;
    delete process.env.GROK_OAUTH2_SCOPES;
    const cfg = resolveOAuthConfig();
    expect(cfg.issuer).toBe(PROD_ISSUER);
    expect(cfg.clientId).toBe(PROD_CLIENT_ID);
    expect(cfg.scopes).toEqual(defaultScopes());
    expect(cfg.referrer).toBe("grok-build");
    expect(cfg.earlyRefreshSec).toBe(60);
  });

  it("env overrides settings and defaults, scopes comma/space tolerant", () => {
    process.env.GROK_OAUTH2_ISSUER = "https://issuer.test/";
    process.env.GROK_OAUTH2_CLIENT_ID = "client-env";
    process.env.GROK_OAUTH2_SCOPES = "a,b, c";
    process.env.PIPIUI_EXT_SETTINGS_GROK_BUILD_OAUTH = JSON.stringify({
      "ext.grok-build-oauth.issuer": "https://should-not-win",
      "ext.grok-build-oauth.clientId": "nope",
      "ext.grok-build-oauth.scopes": "x y",
      "ext.grok-build-oauth.earlyRefreshSec": 100,
    });
    const cfg = resolveOAuthConfig();
    expect(cfg.issuer).toBe("https://issuer.test");
    expect(cfg.clientId).toBe("client-env");
    expect(cfg.scopes).toEqual(["a", "b", "c"]);
    // early from settings when env not overriding issuer? Actually early comes from settings even when env overrides issuer
    expect(cfg.earlyRefreshSec).toBe(100);
  });

  it("settings scopes space-separated fallback when env missing", () => {
    delete process.env.GROK_OAUTH2_SCOPES;
    process.env.PIPIUI_EXT_SETTINGS_GROK_BUILD_OAUTH = JSON.stringify({
      "ext.grok-build-oauth.scopes": "openid profile email",
    });
    const cfg = resolveOAuthConfig();
    expect(cfg.scopes).toEqual(["openid", "profile", "email"]);
  });

  it("overrides param wins over env", () => {
    process.env.GROK_OAUTH2_ISSUER = "https://env.test";
    const cfg = resolveOAuthConfig({ issuer: "https://override.test" });
    expect(cfg.issuer).toBe("https://override.test");
  });
});

describe("requestDeviceCode", () => {
  it("sends form client_id/scope/referrer and headers, validates responses", async () => {
    let captured: { body: string; headers: Record<string, string> } | undefined;
    const fakeFetch: typeof fetch = async (url, opts) => {
      const body = (opts as RequestInit).body as string;
      const headers = (opts as RequestInit).headers as Record<string, string>;
      captured = { body, headers };
      return new Response(JSON.stringify({
        device_code: "dc-123",
        user_code: "ABCD-1234",
        verification_uri: "https://accounts.x.ai/device",
        verification_uri_complete: "https://accounts.x.ai/device?user_code=ABCD-1234",
        expires_in: 600,
        interval: 5,
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const code = await requestDeviceCode({
      issuer: "https://auth.x.ai",
      clientId: PROD_CLIENT_ID,
      scopes: ["openid", "profile"],
      referrer: "grok-build",
      surface: "cli",
      fetchImpl: fakeFetch as never,
    });
    expect(code.device_code).toBe("dc-123");
    expect(code.user_code).toBe("ABCD-1234");
    expect(code.verification_uri).toBe("https://accounts.x.ai/device");
    expect(captured?.body).toContain(`client_id=${encodeURIComponent(PROD_CLIENT_ID)}`);
    expect(captured?.body).toContain("scope=openid%20profile".replace("%20", "+") || "scope=");
    // URLSearchParams encodes space as +; accept either
    expect(captured?.body.includes("openid") && captured?.body.includes("profile")).toBe(true);
    expect(captured?.body).toContain("referrer=grok-build");
    expect(captured?.headers["x-grok-client-version"]).toBeTruthy();
    expect(captured?.headers["x-grok-client-surface"]).toBe("cli");
  });

  it("rejects invalid user_code and non-https verification_uri", async () => {
    const badUserCodeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({
        device_code: "dc", user_code: "bad code!", verification_uri: "https://accounts.x.ai/device", expires_in: 600,
      }), { status: 200 });
    await expect(requestDeviceCode({
      issuer: "https://auth.x.ai", clientId: "c", scopes: ["openid"], referrer: "grok-build", fetchImpl: badUserCodeFetch as never,
    })).rejects.toThrow(/user_code/);

    const badUriFetch: typeof fetch = async () =>
      new Response(JSON.stringify({
        device_code: "dc", user_code: "ABCD-1234", verification_uri: "http://evil.com/device", expires_in: 600,
      }), { status: 200 });
    await expect(requestDeviceCode({
      issuer: "https://auth.x.ai", clientId: "c", scopes: ["openid"], referrer: "grok-build", fetchImpl: badUriFetch as never,
    })).rejects.toThrow(/verification URI/);
  });

  it("aborts when signal aborted before request", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(requestDeviceCode({
      issuer: "https://auth.x.ai", clientId: "c", scopes: ["openid"], referrer: "grok-build", signal: ac.signal,
    })).rejects.toThrow(/Abort/);
  });

  it("allows http localhost verification_uri", async () => {
    const fetchOk: typeof fetch = async () =>
      new Response(JSON.stringify({
        device_code: "dc", user_code: "ABCD-1234", verification_uri: "http://localhost:22255/device", expires_in: 600,
      }), { status: 200 });
    const code = await requestDeviceCode({
      issuer: "http://localhost:22255", clientId: "c", scopes: ["openid"], referrer: "grok-build", fetchImpl: fetchOk as never,
    });
    expect(code.verification_uri).toBe("http://localhost:22255/device");
  });
});

describe("pollDeviceToken", () => {
  it("handles pending then success with fake clock, slow_down grows interval ×1.5 (capped)", async () => {
    const deviceCode = { device_code: "dc-123", user_code: "ABCD-1234", verification_uri: "https://accounts.x.ai/device", expires_in: 600, interval: 2 };
    let call = 0;
    const fakeFetch: typeof fetch = async () => {
      call++;
      if (call === 1) return new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 });
      if (call === 2) return new Response(JSON.stringify({ error: "slow_down" }), { status: 400 });
      return new Response(JSON.stringify({ access_token: "at-1", refresh_token: "rt-1", expires_in: 900 }), { status: 200 });
    };
    const clock = fakeClock();
    const tokens = await pollDeviceToken({
      issuer: "https://auth.x.ai", clientId: "c", deviceCode, fetchImpl: fakeFetch as never, clock,
    });
    expect(tokens.access_token).toBe("at-1");
    expect(tokens.refresh_token).toBe("rt-1");
    // sleeps: first interval 2000, again 2000, after slow_down 2000*1.5=3000 (spec §D4)
    expect(clock.sleeps.length).toBe(3);
    expect(clock.sleeps[0]).toBe(2000);
    expect(clock.sleeps[1]).toBe(2000);
    expect(clock.sleeps[2]).toBe(3000);
  });

  it("honors a short server expires_in as the total deadline (no forced 10-minute floor)", async () => {
    const deviceCode = { device_code: "dc-short", user_code: "ABCD-1234", verification_uri: "https://accounts.x.ai/device", expires_in: 2, interval: 1 };
    const pendingFetch: typeof fetch = async () => new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 });
    await expect(pollDeviceToken({
      issuer: "https://auth.x.ai", clientId: "c", deviceCode, fetchImpl: pendingFetch as never, clock: fakeClock(),
    })).rejects.toMatchObject({ code: "expired_token" });
  });

  it("maps access_denied and expired_token to terminal errors", async () => {
    const dc = { device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://accounts.x.ai/device", expires_in: 600, interval: 1 };
    const deniedFetch: typeof fetch = async () => new Response(JSON.stringify({ error: "access_denied" }), { status: 400 });
    await expect(pollDeviceToken({ issuer: "https://auth.x.ai", clientId: "c", deviceCode: dc, fetchImpl: deniedFetch as never, clock: fakeClock() })).rejects.toMatchObject({ code: "access_denied" });

    const expiredFetch: typeof fetch = async () => new Response(JSON.stringify({ error: "expired_token" }), { status: 400 });
    await expect(pollDeviceToken({ issuer: "https://auth.x.ai", clientId: "c", deviceCode: dc, fetchImpl: expiredFetch as never, clock: fakeClock() })).rejects.toMatchObject({ code: "expired_token" });
  });

  it("respects abort signal during poll", async () => {
    const dc = { device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://accounts.x.ai/device", expires_in: 600, interval: 1 };
    const ac = new AbortController();
    const fakeFetch: typeof fetch = async () => {
      ac.abort();
      return new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 });
    };
    const clock = fakeClock();
    // Make sleep check abort
    const origSleep = clock.sleep;
    clock.sleep = async (ms, signal) => {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");
      return origSleep(ms, signal ?? ac.signal);
    };
    await expect(pollDeviceToken({
      issuer: "https://auth.x.ai", clientId: "c", deviceCode: dc, fetchImpl: fakeFetch as never, signal: ac.signal, clock,
    })).rejects.toThrow(/Abort/);
  });

  it("expires after deadline", async () => {
    const dc = { device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://accounts.x.ai/device", expires_in: 2, interval: 1 };
    const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 });
    // Clock starts at 0, deadline is max(600,2)=600s. Advance clock beyond deadline before poll checks.
    const clock = fakeClock();
    // Make first sleep advance past deadline
    const origSleep = clock.sleep;
    clock.sleep = async (ms, signal) => {
      await origSleep(ms, signal);
      clock.setNow(700_000); // 700s >600s
    };
    await expect(pollDeviceToken({
      issuer: "https://auth.x.ai", clientId: "c", deviceCode: dc, fetchImpl: fakeFetch as never, clock,
    })).rejects.toMatchObject({ code: "expired_token" });
  });
});

describe("refreshAccessToken", () => {
  it("returns new tokens and handles rotation (missing refresh retains old)", async () => {
    const fetchOk: typeof fetch = async (_url, opts) => {
      const body = (opts as RequestInit).body as string;
      expect(body).toContain("grant_type=refresh_token");
      expect(body).toContain("refresh_token=rt-old");
      return new Response(JSON.stringify({ access_token: "at-new", expires_in: 3600 }), { status: 200 });
    };
    const tokens = await refreshAccessToken({ issuer: "https://auth.x.ai", clientId: "c", refreshToken: "rt-old", fetchImpl: fetchOk as never });
    expect(tokens.access_token).toBe("at-new");
    expect(tokens.refresh_token).toBeUndefined();
  });

  it("maps invalid_grant to invalid_grant code and redacts token in message", async () => {
    const fetchBad: typeof fetch = async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "bad refresh_token rt-secret-123" }), { status: 400 });
    await expect(refreshAccessToken({ issuer: "https://auth.x.ai", clientId: "c", refreshToken: "rt-secret-123", fetchImpl: fetchBad as never }))
      .rejects.toMatchObject({ code: "invalid_grant" });
    try {
      await refreshAccessToken({ issuer: "https://auth.x.ai", clientId: "c", refreshToken: "rt-secret-123", fetchImpl: fetchBad as never });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain("rt-secret-123");
      expect(msg).toContain("[redacted]");
    }
  });

  it("aborts when signal aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(refreshAccessToken({ issuer: "https://auth.x.ai", clientId: "c", refreshToken: "rt", signal: ac.signal })).rejects.toThrow(/Abort/);
  });
});

describe("redaction", () => {
  it("redacts tokens from messages and objects", () => {
    const msg = redactMessage("token rt-secret-123 leaked and at-xyz", ["rt-secret-123", "at-xyz"]);
    expect(msg).not.toContain("rt-secret-123");
    expect(msg).not.toContain("at-xyz");
    expect(msg).toContain("[redacted]");

    const obj = redactObject({ access_token: "secret", nested: { refresh_token: "r2", ok: "keep" } }, ["secret", "r2"]);
    expect((obj as Record<string, unknown>).access_token).toBe("[redacted]");
    expect(((obj as Record<string, unknown>).nested as Record<string, unknown>).refresh_token).toBe("[redacted]");
    expect(((obj as Record<string, unknown>).nested as Record<string, unknown>).ok).toBe("keep");
  });
});

describe("explicit import (no silent read)", () => {
  let tmp = "";
  afterEach(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

  it("requires confirm and does not read without it", async () => {
    tmp = await mkdtemp(join(tmpdir(), "grok-import-"));
    const homeGrok = join(tmp, ".grok");
    await mkdir(homeGrok, { recursive: true });
    await writeFile(join(homeGrok, "auth.json"), JSON.stringify({ key: "tok", expires_at: Date.now() + 3_600_000 }), "utf8");
    const broker = new GrokCredentialBroker({ authPath: join(tmp, "auth.json") });
    const res = await importFromGlobalGrok({ confirm: false, broker, homedirOverride: tmp });
    expect(res.imported).toBe(false);
    expect(res.reason).toMatch(/确认|confirm/);
  });

  it("reads only when confirm true and finds token", async () => {
    tmp = await mkdtemp(join(tmpdir(), "grok-import2-"));
    const homeGrok = join(tmp, ".grok");
    await mkdir(homeGrok, { recursive: true });
    await writeFile(join(homeGrok, "auth.json"), JSON.stringify({ key: "tok123", expires_at: Date.now() + 3_600_000, oidc_issuer: "https://auth.x.ai", client_id: "b1a00492-073a-47ea-816f-4c329264a828" }), "utf8");
    const broker = new GrokCredentialBroker({ authPath: join(tmp, "auth.json") });
    const res = await importFromGlobalGrok({ confirm: true, broker, homedirOverride: tmp });
    expect(res.imported).toBe(true);
  });

  it("returns not imported when file missing", async () => {
    tmp = await mkdtemp(join(tmpdir(), "grok-import3-"));
    const broker = new GrokCredentialBroker({ authPath: join(tmp, "auth.json") });
    const res = await importFromGlobalGrok({ confirm: true, broker, homedirOverride: tmp });
    expect(res.imported).toBe(false);
  });
});

describe("fake OAuth server integration (device+token contract)", () => {
  let server: Server;
  let issuer: string;
  let tokenSeq: Array<{ status: number; body: unknown }> = [];
  let deviceHits: Array<{ body: string; headers: Record<string, string> }> = [];

  function start(): Promise<string> {
    tokenSeq = [];
    deviceHits = [];
    return new Promise((resolve) => {
      server = createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          if (req.url === "/oauth2/device/code" && req.method === "POST") {
            const h: Record<string, string> = {};
            for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") h[k.toLowerCase()] = v;
            deviceHits.push({ body, headers: h });
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({
              device_code: "dev-code-1",
              user_code: "ABCD-1234",
              verification_uri: "https://accounts.x.ai/device",
              verification_uri_complete: "https://accounts.x.ai/device?user_code=ABCD-1234",
              expires_in: 600,
              interval: 1,
            }));
            return;
          }
          if (req.url === "/oauth2/token" && req.method === "POST") {
            const next = tokenSeq.shift() ?? { status: 400, body: { error: "authorization_pending" } };
            res.writeHead(next.status, { "content-type": "application/json" });
            res.end(JSON.stringify(next.body));
            return;
          }
          res.writeHead(404); res.end();
        });
      });
      server.listen(0, () => {
        const addr = server.address() as { port: number };
        issuer = `http://127.0.0.1:${addr.port}`;
        resolve(issuer);
      });
    });
  }

  afterEach(() => { server?.close(); });

  it("device code contract: posts form with referrer and polls until success", async () => {
    const iss = await start();
    tokenSeq = [
      { status: 400, body: { error: "authorization_pending" } },
      { status: 200, body: { access_token: "at-ok", refresh_token: "rt-ok", expires_in: 900 } },
    ];
    const code = await requestDeviceCode({ issuer: iss, clientId: "test", scopes: ["openid", "profile"], referrer: "grok-build", surface: "cli" });
    expect(code.device_code).toBe("dev-code-1");
    expect(deviceHits[0].body).toContain("referrer=grok-build");
    expect(deviceHits[0].body).toContain("client_id=test");
    expect(deviceHits[0].headers["x-grok-client-surface"]).toBe("cli");

    const clock = fakeClock();
    const tokens = await pollDeviceToken({ issuer: iss, clientId: "test", deviceCode: code, clock });
    expect(tokens.access_token).toBe("at-ok");
  });
});
