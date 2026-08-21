import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TIER_RESTRICTED_UPSELL } from "../agent/images/errors.js";
import { GrokCredentialBroker } from "../agent/oauth/broker.js";

// 1x1 transparent PNG
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type AnyTool = {
  name: string;
  execute: (
    id: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ) => Promise<{ content: Array<{ type: string; text?: string }>; details: Record<string, unknown> }>;
};

/** Minimal mock ExtensionAPI capturing tool registrations. */
function mockPi() {
  const tools = new Map<string, AnyTool>();
  const providers = new Map<string, unknown>();
  const commands = new Map<string, unknown>();
  const api = {
    registerTool: (t: AnyTool) => { tools.set(t.name, t); },
    registerProvider: (id: string, p: unknown) => { providers.set(id, p); },
    registerCommand: (name: string, o: unknown) => { commands.set(name, o); },
  };
  return { api, tools, providers, commands };
}

function okImageResponse(): Response {
  return new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }] }), { status: 200 });
}

const ENV_KEYS = [
  "PI_CODING_AGENT_DIR",
  "PIPIUI_EXT_SETTINGS_GROK_BUILD_OAUTH",
  "XAI_API_KEY",
  "XAI_API_BASE_URL",
  "GROK_TIER",
  "GROK_SESSION_ID",
  "GROK_IMAGINE_MODEL",
  "PIPIUI_GROK_RELAY",
];

describe("M4 tool wiring — image_gen / image_edit via extension entry", () => {
  let dir = "";
  let savedEnv: Record<string, string | undefined> = {};
  let origFetch: typeof fetch;
  let fetchCalls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "grok-tools-m4-"));
    savedEnv = {};
    for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
    process.env.PI_CODING_AGENT_DIR = dir;
    process.env.PIPIUI_BRIDGE_PORT = ""; // emit is best-effort no-op
    origFetch = globalThis.fetch;
    fetchCalls = [];
  });

  afterEach(async () => {
    globalThis.fetch = origFetch;
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    delete process.env.PIPIUI_BRIDGE_PORT;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  async function loadExtension() {
    const mod = await import("../agent/index.js");
    const pi = mockPi();
    (mod.default as unknown as (pi: unknown) => void)(pi.api);
    return pi;
  }

  function setFetch(responder: (url: string, call: number) => Response) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(String(init?.body ?? "{}")); } catch {}
      fetchCalls.push({ url, headers, body });
      return responder(url, fetchCalls.length);
    }) as typeof fetch;
  }

  async function writeOAuthCred(access = "at-oauth") {
    await import("node:fs/promises").then((m) =>
      m.writeFile(
        join(dir, "auth.json"),
        JSON.stringify({
          "grok-build": {
            type: "oauth",
            access,
            refresh: "rt-oauth",
            expires: Date.now() + 3600_000,
            issuer: "https://auth.x.ai",
            client_id: "b1a00492-073a-47ea-816f-4c329264a828",
            scopes: ["openid"],
            token_type: "Bearer",
            obtained_at: Date.now(),
          },
        }),
      ),
    );
  }

  it("OAuth path: image_gen writes file under isolation dir and returns typed path", async () => {
    await writeOAuthCred();
    setFetch(() => okImageResponse());
    const pi = await loadExtension();
    const tool = pi.tools.get("image_gen")!;
    const res = await tool.execute("call-1", { prompt: "a red panda", aspect_ratio: "3:2" });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("https://api.x.ai/v1/images/generations");
    expect(fetchCalls[0].headers.authorization).toBe("Bearer at-oauth");
    expect(fetchCalls[0].headers["x-grok-session-id"]).toBeTruthy();
    expect(fetchCalls[0].body.aspect_ratio).toBe("3:2");

    const path = res.details.path as string;
    expect(path).toBe(join(dir, "attachments", "images", "1.jpg"));
    expect(res.details.backend).toBe("grok-build");
    expect(res.details.mime).toBe("image/png");
    expect(res.content[0].text).toContain(path);
    const bytes = await readFile(path);
    expect(bytes.equals(Buffer.from(TINY_PNG_B64, "base64"))).toBe(true);
    // session id persisted for reuse
    const sessionId = (await readFile(join(dir, "grok-build-session-id"), "utf8")).trim();
    expect(fetchCalls[0].headers["x-grok-session-id"]).toBe(sessionId);
  });

  it("XAI_API_KEY is NOT used with compatFallback off; with compat on it shares the same client/payload and is never tier-gated", async () => {
    process.env.XAI_API_KEY = "xai-key-123";
    process.env.GROK_TIER = "Free"; // gate applies to OAuth callers only
    setFetch(() => okImageResponse());
    const pi = await loadExtension();
    // compatFallback=false (default) — the API key must never be used (MUST-FIX #4).
    await expect(pi.tools.get("image_gen")!.execute("c", { prompt: "p" }))
      .rejects.toMatchObject({ code: "auth_expired" });
    expect(fetchCalls).toHaveLength(0);

    // compatFallback=true — deprecated API-key fallback shares the client/payload.
    process.env.PIPIUI_EXT_SETTINGS_GROK_BUILD_OAUTH = JSON.stringify({
      "ext.grok-build-oauth.compatFallback": true,
    });
    const pi2 = await loadExtension();
    const res = await pi2.tools.get("image_gen")!.execute("c", { prompt: "p" });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].headers.authorization).toBe("Bearer xai-key-123");
    expect((res.details.path as string).endsWith("1.jpg")).toBe(true);
    expect(res.details.deprecated).toBe(true);
  });

  it("OAuth + restricted tier short-circuits with advisory upsell, no HTTP", async () => {
    await writeOAuthCred();
    process.env.GROK_TIER = "Free";
    setFetch(() => okImageResponse());
    const pi = await loadExtension();
    const res = await pi.tools.get("image_gen")!.execute("c", { prompt: "p" });
    expect(fetchCalls).toHaveLength(0);
    expect(res.content[0].text).toBe(TIER_RESTRICTED_UPSELL);
    expect(res.details.code).toBe("tier_restricted");
  });

  it("not logged in and no API key → actionable error mentioning /login grok-build", async () => {
    setFetch(() => okImageResponse());
    const pi = await loadExtension();
    await expect(pi.tools.get("image_gen")!.execute("c", { prompt: "p" }))
      .rejects.toThrow(/\/login grok-build/);
    expect(fetchCalls).toHaveLength(0);
  });

  it("compatFallback=true (and only then) falls back to deprecated loopback relay", async () => {
    process.env.PIPIUI_EXT_SETTINGS_GROK_BUILD_OAUTH = JSON.stringify({
      "ext.grok-build-oauth.compatFallback": true,
    });
    process.env.PIPIUI_GROK_RELAY = "http://127.0.0.1:19999/v1";
    setFetch((url) => {
      if (url.startsWith("http://127.0.0.1:19999/v1/images/generations")) return okImageResponse();
      throw new Error(`unexpected ${url}`);
    });
    const pi = await loadExtension();
    const res = await pi.tools.get("image_gen")!.execute("c", { prompt: "p" });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("http://127.0.0.1:19999/v1/images/generations");
    expect(res.details.backend).toBe("grok-build-relay");
    expect(res.details.deprecated).toBe(true);
    expect((res.details.path as string).startsWith(join(dir, "attachments", "images"))).toBe(true);
  });

  it("401 on OAuth path triggers single forced refresh + retry (broker shared API)", async () => {
    await writeOAuthCred("at-expired");
    setFetch((url, call) => {
      if (url.includes("/oauth2/token")) {
        return new Response(
          JSON.stringify({ access_token: "at-fresh", refresh_token: "rt-fresh", expires_in: 3600 }),
          { status: 200 },
        );
      }
      if (call === 1) return new Response(`{"error":"unauthorized"}`, { status: 401 });
      return okImageResponse();
    });
    const pi = await loadExtension();
    const res = await pi.tools.get("image_gen")!.execute("c", { prompt: "p" });
    // 1st gen (401) + refresh + 2nd gen (200)
    expect(fetchCalls.filter((c) => c.url.includes("/images/generations"))).toHaveLength(2);
    expect(fetchCalls[0].headers.authorization).toBe("Bearer at-expired");
    expect(fetchCalls[2].headers.authorization).toBe("Bearer at-fresh");
    expect((res.details.path as string).endsWith("1.jpg")).toBe(true);
    const auth = JSON.parse(await readFile(join(dir, "auth.json"), "utf8"));
    expect(auth["grok-build"].access).toBe("at-fresh");
  });

  it("persistent 401 after refresh → auth_expired re-login message, no loop", async () => {
    await writeOAuthCred("at-bad");
    setFetch((url) => {
      if (url.includes("/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "at-bad2", expires_in: 3600 }), { status: 200 });
      }
      return new Response(`{"error":"unauthorized"}`, { status: 401 });
    });
    const pi = await loadExtension();
    await expect(pi.tools.get("image_gen")!.execute("c", { prompt: "p" }))
      .rejects.toThrow(/\/login grok-build/);
    expect(fetchCalls.filter((c) => c.url.includes("/images/generations"))).toHaveLength(2);
  });

  it("abort: aborted signal prevents HTTP and file writes", async () => {
    await writeOAuthCred();
    setFetch(() => okImageResponse());
    const pi = await loadExtension();
    const ac = new AbortController();
    ac.abort();
    await expect(pi.tools.get("image_gen")!.execute("c", { prompt: "p" }, ac.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(fetchCalls).toHaveLength(0);
    const imgDir = join(dir, "attachments", "images");
    await expect(readdir(imgDir).catch(() => [])).resolves.toEqual([]);
  });

  it("image_edit wiring: resolves file refs, single-ref payload shape, saves output", async () => {
    await writeOAuthCred();
    setFetch(() => okImageResponse());
    const pi = await loadExtension();

    // reference file inside the allowed roots (agent-home attachments)
    const ref = join(dir, "attachments", "ref.png");
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "attachments"), { recursive: true });
    await writeFile(ref, Buffer.from(TINY_PNG_B64, "base64"));

    const res = await pi.tools.get("image_edit")!.execute("c", {
      prompt: "make it snowy",
      image: [ref],
    });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("https://api.x.ai/v1/images/edits");
    expect(fetchCalls[0].body.image).toEqual({ url: `data:image/png;base64,${TINY_PNG_B64}` });
    expect(fetchCalls[0].body).not.toHaveProperty("aspect_ratio");
    expect((res.details.path as string).endsWith("1.jpg")).toBe(true);
  });

  it("image_edit path traversal rejected before any HTTP", async () => {
    await writeOAuthCred();
    setFetch(() => okImageResponse());
    const pi = await loadExtension();
    await expect(
      pi.tools.get("image_edit")!.execute("c", { prompt: "p", image: ["../../etc/passwd"] }),
    ).rejects.toMatchObject({ code: "invalid_params" });
    expect(fetchCalls).toHaveLength(0);
  });

  it("output paths never escape the isolation root across repeated calls", async () => {
    await writeOAuthCred();
    setFetch(() => okImageResponse());
    const pi = await loadExtension();
    const root = join(dir, "attachments", "images");
    for (let i = 1; i <= 3; i++) {
      const res = await pi.tools.get("image_gen")!.execute(`c${i}`, { prompt: `p${i}` });
      const p = res.details.path as string;
      expect(p).toBe(join(root, `${i}.jpg`));
    }
    const entries = await readdir(root);
    expect(entries.sort()).toEqual(["1.jpg", "2.jpg", "3.jpg"]);
  });
});
