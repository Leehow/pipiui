import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ImagesClient,
  ASPECT_RATIOS,
  DEFAULT_BASE_URL,
  decodeBase64Strict,
  normalizeBaseUrl,
  resolveImageReference,
  sniffImageMime,
  MAX_REFERENCE_BYTES,
} from "../agent/images/client.js";
import { ImagesError, TIER_RESTRICTED_UPSELL } from "../agent/images/errors.js";
import { isRestrictedTier } from "../agent/images/tier.js";
import { SessionImageWriter } from "../agent/images/storage.js";
import { GrokCredentialBroker } from "../agent/oauth/broker.js";

// 1x1 transparent PNG
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const TINY_PNG = Buffer.from(TINY_PNG_B64, "base64");

function okImageResponse(): Response {
  return new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }] }), { status: 200 });
}

type RecordedRequest = { url: string; init: RequestInit; body: Record<string, unknown> };

function recordingFetch(responder: (url: string, init: RequestInit, call: number) => Response | Promise<Response>) {
  const calls: RecordedRequest[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const bodyText = typeof init?.body === "string" ? init.body : "";
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(bodyText); } catch {}
    calls.push({ url, init: init ?? {}, body: parsed });
    return responder(url, init ?? {}, calls.length);
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

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

describe("M4 images — request contract (official Grok Build alignment)", () => {
  it("POST {base}/images/generations with official payload + headers", async () => {
    const { impl, calls } = recordingFetch(() => okImageResponse());
    const client = new ImagesClient({ sessionId: "sess-123", fetchImpl: impl });
    await client.generate({ prompt: "a cat", bearer: "k-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.x.ai/v1/images/generations");
    expect(calls[0].body).toEqual({
      model: "grok-imagine-image-quality",
      prompt: "a cat",
      n: 1,
      aspect_ratio: "auto",
      resolution: "1k",
      response_format: "b64_json",
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer k-1");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-grok-session-id"]).toBe("sess-123");
  });

  it("normalizes trailing slashes, honors base override, HTTPS-only bearer policy", () => {
    expect(normalizeBaseUrl("https://api.x.ai/v1/")).toBe("https://api.x.ai/v1");
    // Bearer credentials never go to plain HTTP (reviewer MUST-FIX #8)...
    expect(() => normalizeBaseUrl("http://127.0.0.1:9/v1///")).toThrowError(ImagesError);
    expect(() => normalizeBaseUrl("http://evil.example/v1")).toThrowError(ImagesError);
    // ...except explicit loopback compat relay opt-in.
    expect(normalizeBaseUrl("http://127.0.0.1:9/v1///", { allowHttpLoopback: true })).toBe("http://127.0.0.1:9/v1");
    expect(() => normalizeBaseUrl("http://evil.example/v1", { allowHttpLoopback: true })).toThrowError(ImagesError);
    expect(() => normalizeBaseUrl("not a url")).toThrowError(ImagesError);
    expect(() => normalizeBaseUrl("ftp://x.ai")).toThrowError(ImagesError);
  });

  it("uses configured base url for generations", async () => {
    const { impl, calls } = recordingFetch(() => okImageResponse());
    const client = new ImagesClient({ baseUrl: "https://example.test/v9/", fetchImpl: impl });
    await client.generate({ prompt: "p", bearer: "k" });
    expect(calls[0].url).toBe("https://example.test/v9/images/generations");
  });

  it("aspect_ratio whitelist: invalid rejected client-side without HTTP", async () => {
    let fetched = 0;
    const impl = (async () => { fetched++; return okImageResponse(); }) as unknown as typeof fetch;
    const client = new ImagesClient({ fetchImpl: impl });
    await expect(client.generate({ prompt: "p", aspectRatio: "2:7", bearer: "k" }))
      .rejects.toMatchObject({ code: "invalid_params" });
    await expect(client.generate({ prompt: "", bearer: "k" }))
      .rejects.toMatchObject({ code: "invalid_params" });
    expect(fetched).toBe(0);
    // every whitelisted ratio passes validation
    for (const ar of ASPECT_RATIOS) {
      const { impl: ok } = recordingFetch(() => okImageResponse());
      const c = new ImagesClient({ fetchImpl: ok });
      await expect(c.generate({ prompt: "p", aspectRatio: ar, bearer: "k" })).resolves.toBeTruthy();
    }
  });

  it("strict base64 decode: empty/malformed rejected, nothing written", () => {
    expect(() => decodeBase64Strict("")).toThrowError(ImagesError);
    expect(() => decodeBase64Strict("!!!not-base64!!!")).toThrowError(ImagesError);
    expect(() => decodeBase64Strict("abc")).toThrowError(ImagesError); // len % 4 != 0
    expect(decodeBase64Strict(TINY_PNG_B64).equals(TINY_PNG)).toBe(true);
  });

  it("rejects responses without b64_json / unparseable bodies", async () => {
    const cases: Array<[Response, string]> = [
      [new Response(JSON.stringify({ data: [{ b64_json: "" }] }), { status: 200 }), "invalid_response"],
      [new Response(JSON.stringify({ data: [] }), { status: 200 }), "invalid_response"],
      [new Response(JSON.stringify({}), { status: 200 }), "invalid_response"],
      [new Response("<html>nope</html>", { status: 200 }), "invalid_response"],
    ];
    for (const [res, code] of cases) {
      const { impl } = recordingFetch(() => res.clone());
      const client = new ImagesClient({ fetchImpl: impl });
      await expect(client.generate({ prompt: "p", bearer: "k" })).rejects.toMatchObject({ code });
    }
  });

  it("classifies non-2xx: 403 tier_restricted, 429 rate_limited, 5xx upstream_error, 400 http_failure", async () => {
    const cases: Array<[number, string]> = [
      [403, "tier_restricted"],
      [429, "rate_limited"],
      [500, "upstream_error"],
      [503, "upstream_error"],
      [400, "http_failure"],
    ];
    for (const [status, code] of cases) {
      const { impl } = recordingFetch(() => new Response(`{"error":"boom ${status}"}`, { status }));
      const client = new ImagesClient({ fetchImpl: impl });
      await expect(client.generate({ prompt: "p", bearer: "secret-key-123" }))
        .rejects.toMatchObject({ code, status });
    }
  });

  it("truncates error bodies and redacts the bearer from messages", async () => {
    const longBody = `token=secret-key-123 ${"x".repeat(500)}`;
    const { impl } = recordingFetch(() => new Response(longBody, { status: 500 }));
    const client = new ImagesClient({ fetchImpl: impl });
    try {
      await client.generate({ prompt: "p", bearer: "secret-key-123" });
      expect.unreachable("should throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain("secret-key-123");
      expect(msg).toContain("[redacted]");
      expect([...msg].length).toBeLessThan(400);
    }
  });

  it("abort: pre-aborted signal throws AbortError, no HTTP call", async () => {
    let fetched = 0;
    const impl = (async () => { fetched++; return okImageResponse(); }) as unknown as typeof fetch;
    const client = new ImagesClient({ fetchImpl: impl });
    const ac = new AbortController();
    ac.abort();
    await expect(client.generate({ prompt: "p", bearer: "k", signal: ac.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(fetched).toBe(0);
  });

  it("mime sniffing: png/jpeg/webp/gif + default", () => {
    expect(sniffImageMime(TINY_PNG)).toBe("image/png");
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageMime(Buffer.from("RIFF____WEBP", "ascii"))).toBe("image/webp");
    expect(sniffImageMime(Buffer.from("GIF89a", "ascii"))).toBe("image/gif");
    expect(sniffImageMime(Buffer.from([1, 2, 3, 4]))).toBe("image/jpeg");
  });
});

describe("M4 images — tier gate (advisory, fail-open, API-key never gated)", () => {
  it("restricted names gate; unknown/paid/absent fail open", () => {
    expect(isRestrictedTier("")).toBe(true);
    expect(isRestrictedTier("  ")).toBe(true);
    expect(isRestrictedTier("Free")).toBe(true);
    expect(isRestrictedTier("X Basic")).toBe(true);
    expect(isRestrictedTier("x_basic")).toBe(true);
    expect(isRestrictedTier("SuperGrok")).toBe(false);
    expect(isRestrictedTier("SuperGrok Heavy")).toBe(false);
    expect(isRestrictedTier("X Premium")).toBe(false);
    expect(isRestrictedTier("some_new_plan")).toBe(false);
    expect(isRestrictedTier(undefined)).toBe(false);
  });

  it("upsell prose is user-facing and carries the official referrer", () => {
    expect(TIER_RESTRICTED_UPSELL).toContain("SuperGrok");
    expect(TIER_RESTRICTED_UPSELL).toContain("supergrok?referrer=grok-build");
  });
});

describe("M4 images — storage (isolation dir, atomic numbered writes)", () => {
  let dir = "";
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "grok-img-store-")); });
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ""; });

  it("writes <n>.jpg incrementing, 0700 dir / 0600 file, path inside root", async () => {
    const root = join(dir, "attachments", "images");
    const writer = new SessionImageWriter(root);
    const a = await writer.save(TINY_PNG);
    const b = await writer.save(TINY_PNG);
    expect(a.path).toBe(join(root, "1.jpg"));
    expect(b.path).toBe(join(root, "2.jpg"));
    expect(a.mime).toBe("image/png");
    expect(a.path.startsWith(root)).toBe(true);
    const dirMode = (await stat(root)).mode & 0o777;
    const fileMode = (await stat(a.path)).mode & 0o777;
    expect(dirMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
    const bytes = await readFile(a.path);
    expect(bytes.equals(TINY_PNG)).toBe(true);
    // no leftover tmp files
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(root);
    expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
  });

  it("resumes counter from existing files (official semantics)", async () => {
    const root = join(dir, "images");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "7.jpg"), TINY_PNG);
    const writer = new SessionImageWriter(root);
    const next = await writer.save(TINY_PNG);
    expect(next.path).toBe(join(root, "8.jpg"));
  });

  it("rejects empty bytes (no half writes)", async () => {
    const writer = new SessionImageWriter(join(dir, "images"));
    await expect(writer.save(new Uint8Array())).rejects.toThrow();
  });

  it("abort before save writes nothing", async () => {
    const root = join(dir, "images");
    const writer = new SessionImageWriter(root);
    const ac = new AbortController();
    ac.abort();
    await expect(writer.save(TINY_PNG, { signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
    await expect(writer._exists(join(root, "1.jpg"))).resolves.toBe(false);
  });
});

describe("M4 images — image_edit contract (official compatible path/params)", () => {
  it("single ref → image object, no aspect_ratio sent", async () => {
    const { impl, calls } = recordingFetch(() => okImageResponse());
    const client = new ImagesClient({ sessionId: "s", fetchImpl: impl });
    await client.edit({ prompt: "anime style", images: [`data:image/png;base64,${TINY_PNG_B64}`], bearer: "k" });
    expect(calls[0].url).toBe("https://api.x.ai/v1/images/edits");
    expect(calls[0].body).toEqual({
      model: "grok-imagine-image-quality",
      prompt: "anime style",
      n: 1,
      resolution: "1k",
      response_format: "b64_json",
      image: { url: `data:image/png;base64,${TINY_PNG_B64}` },
    });
    expect(calls[0].body).not.toHaveProperty("aspect_ratio");
  });

  it("multiple refs → images array + explicit aspect_ratio", async () => {
    const { impl, calls } = recordingFetch(() => okImageResponse());
    const client = new ImagesClient({ fetchImpl: impl });
    const u = `data:image/png;base64,${TINY_PNG_B64}`;
    await client.edit({ prompt: "blend", images: [u, u], aspectRatio: "16:9", bearer: "k" });
    expect(calls[0].body.images).toEqual([{ url: u }, { url: u }]);
    expect(calls[0].body.aspect_ratio).toBe("16:9");
    expect(calls[0].body).not.toHaveProperty("image");
  });

  it("empty refs rejected client-side", async () => {
    const client = new ImagesClient({});
    await expect(client.edit({ prompt: "p", images: [], bearer: "k" }))
      .rejects.toMatchObject({ code: "invalid_params" });
  });

  it("resolveImageReference: data URLs pass; filesystem refs confined to allowed roots", async () => {
    const dir = await mkdtemp(join(tmpdir(), "grok-refs-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "grok-refs-out-"));
    try {
      const good = await resolveImageReference(`data:image/png;base64,${TINY_PNG_B64}`);
      expect(good.startsWith("data:image/png;base64,")).toBe(true);
      await expect(resolveImageReference("data:image/jpeg")).rejects.toMatchObject({ code: "invalid_params" });

      // In-root file (inside the allowed root = the temp dir passed as cwd root).
      const p = join(dir, "ref.png");
      await writeFile(p, TINY_PNG);
      const fromFile = await resolveImageReference(p, { allowedRoots: [dir] });
      expect(fromFile).toBe(`data:image/png;base64,${TINY_PNG_B64}`);

      await expect(resolveImageReference(join(dir, "..", "secret.png"), { allowedRoots: [dir] }))
        .rejects.toMatchObject({ code: "invalid_params" });
      await expect(resolveImageReference(join(dir, "missing.png"), { allowedRoots: [dir] }))
        .rejects.toMatchObject({ code: "invalid_params" });

      const big = join(dir, "big.png");
      await writeFile(big, Buffer.concat([TINY_PNG, Buffer.alloc(MAX_REFERENCE_BYTES)]));
      await expect(resolveImageReference(big, { allowedRoots: [dir] })).rejects.toMatchObject({ code: "invalid_params" });

      const notImage = join(dir, "x.gif");
      await writeFile(notImage, Buffer.from("GIF89a...."));
      await expect(resolveImageReference(notImage, { allowedRoots: [dir] })).rejects.toMatchObject({ code: "invalid_params" });

      // Arbitrary absolute path outside the allowed roots is refused (MUST-FIX #7).
      await expect(resolveImageReference(join(outsideDir, "escape.png"), { allowedRoots: [dir] }))
        .rejects.toMatchObject({ code: "invalid_params" });
      const outsideFile = join(outsideDir, "escape.png");
      await writeFile(outsideFile, TINY_PNG);
      await expect(resolveImageReference(outsideFile, { allowedRoots: [dir] }))
        .rejects.toMatchObject({ code: "invalid_params" });

      // Symlink escape: a link inside the root pointing outside is refused.
      const { symlinkSync } = await import("node:fs");
      const link = join(dir, "link.png");
      symlinkSync(outsideFile, link);
      await expect(resolveImageReference(link, { allowedRoots: [dir] }))
        .rejects.toMatchObject({ code: "invalid_params" });

      // cwd-relative paths still work when inside the default root (cwd).
      const rel = await resolveImageReference("ref.png", { cwd: dir, allowedRoots: [dir] });
      expect(rel).toBe(`data:image/png;base64,${TINY_PNG_B64}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});

describe("M4 images — broker integration: 401 single forced-refresh retry", () => {
  let dir = "";
  let authPath = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "grok-img-401-"));
    authPath = join(dir, "auth.json");
  });
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ""; });

  it("401 → single refresh → retry with new bearer succeeds", async () => {
    const broker = new GrokCredentialBroker({
      authPath,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/oauth2/token")) {
          return new Response(JSON.stringify({ access_token: "at-new", refresh_token: "rt-new", expires_in: 3600 }), { status: 200 });
        }
        throw new Error(`unexpected url ${url}`);
      }) as unknown as typeof fetch,
    });
    await broker._writeForTest(makeCred() as never);

    const seenBearers: string[] = [];
    const { impl, calls } = recordingFetch((_url, init, call) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      seenBearers.push(headers.authorization ?? "");
      if (call === 1) return new Response(`{"error":"unauthorized"}`, { status: 401 });
      return okImageResponse();
    });
    const client = new ImagesClient({ fetchImpl: impl });

    const saved = await broker.with401Retry(async (token) => {
      const result = await client.generate({ prompt: "p", bearer: token });
      return new SessionImageWriter(join(dir, "images")).save(result.bytes);
    });

    expect(seenBearers).toEqual(["Bearer at-old", "Bearer at-new"]);
    expect(calls).toHaveLength(2);
    expect(saved.path.endsWith("1.jpg")).toBe(true);
    // rotated credential persisted
    const auth = JSON.parse(await readFile(authPath, "utf8"));
    expect(auth["grok-build"].access).toBe("at-new");
    expect(auth["grok-build"].refresh).toBe("rt-new");
  });

  it("second 401 → auth_expired, no infinite retry", async () => {
    const broker = new GrokCredentialBroker({
      authPath,
      fetchImpl: (async () => new Response(JSON.stringify({ access_token: "at-new", expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch,
    });
    await broker._writeForTest(makeCred() as never);

    let calls = 0;
    const impl = (async () => { calls++; return new Response(`{"error":"unauthorized"}`, { status: 401 }); }) as unknown as typeof fetch;
    const client = new ImagesClient({ fetchImpl: impl });

    await expect(
      broker.with401Retry(async (token) => client.generate({ prompt: "p", bearer: token })),
    ).rejects.toMatchObject({ code: "auth_expired" });
    expect(calls).toBe(2); // original + single retry, never more
  });

  it("non-401 errors are not retried and do not trigger refresh", async () => {
    let refreshes = 0;
    const broker = new GrokCredentialBroker({
      authPath,
      fetchImpl: (async () => { refreshes++; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch,
    });
    await broker._writeForTest(makeCred() as never);
    let calls = 0;
    const impl = (async () => { calls++; return new Response("quota", { status: 429 }); }) as unknown as typeof fetch;
    const client = new ImagesClient({ fetchImpl: impl });
    await expect(
      broker.with401Retry(async (token) => client.generate({ prompt: "p", bearer: token })),
    ).rejects.toMatchObject({ code: "rate_limited", status: 429 });
    expect(calls).toBe(1);
    expect(refreshes).toBe(0);
  });
});
