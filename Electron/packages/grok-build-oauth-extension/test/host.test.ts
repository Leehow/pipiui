import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGrokBuildHostLibrary, HOST_LIBRARY_VERSION } from "../agent/host.js";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join as joinPath } from "node:path";
import { fileURLToPath } from "node:url";

// 1x1 transparent PNG
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const pkgRoot = joinPath(dirname(fileURLToPath(import.meta.url)), "..");

describe("host library entry (reviewer MUST-FIX #9) — same build artifact, bytes+metadata", () => {
  let dir = "";
  const ENV_KEYS = ["PI_COC_AGENT_DIR", "PI_CODING_AGENT_DIR", "PIPIUI_EXT_SETTINGS_GROK_BUILD_OAUTH", "XAI_API_KEY", "XAI_API_BASE_URL", "GROK_TIER", "GROK_SESSION_ID"];
  let saved: Record<string, string | undefined> = {};
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "grok-host-"));
    saved = {};
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.PI_COC_AGENT_DIR = dir;
  });
  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("exports a version and generates bytes + metadata via the same client/broker", async () => {
    expect(HOST_LIBRARY_VERSION).toBe("1.0.0");
    const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
    const lib = createGrokBuildHostLibrary({
      authPath: join(dir, "auth.json"),
      imagesRoot: join(dir, "images"),
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }] }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    // Seed an OAuth credential so the canonical path is used.
    const now = Date.now();
    await writeFile(join(dir, "auth.json"), JSON.stringify({
      "grok-build": {
        type: "oauth", access: "at-host", refresh: "rt-host", expires: now + 3600_000,
        issuer: "https://auth.x.ai", client_id: "b1a00492-073a-47ea-816f-4c329264a828",
        scopes: ["openid"], token_type: "Bearer", obtained_at: now - 1000,
      },
    }, null, 2));

    const status = await lib.status();
    expect(status).toMatchObject({ loggedIn: true, usable: true, hasRefresh: true });

    const result = await lib.generateImage({ prompt: "a tiny png" });
    expect(Buffer.from(result.b64, "base64").toString("base64")).toBe(TINY_PNG_B64);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.mime).toBe("image/png");
    expect(result.path.startsWith(join(dir, "images"))).toBe(true);
    expect(result.model).toBe("grok-imagine-image-quality");
    expect(result.backend).toBe("grok-build");
    expect(calls[0].url).toBe("https://api.x.ai/v1/images/generations");
    expect(calls[0].headers.authorization).toBe("Bearer at-host");
    expect(calls[0].body).toMatchObject({ model: "grok-imagine-image-quality", prompt: "a tiny png", n: 1, response_format: "b64_json" });
  });

  it("editImage resolves reference images through the same contained resolution", async () => {
    const lib = createGrokBuildHostLibrary({
      authPath: join(dir, "auth.json"),
      imagesRoot: join(dir, "images"),
      fetchImpl: (async () =>
        new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }] }), { status: 200 })) as unknown as typeof fetch,
    });
    const now = Date.now();
    await writeFile(join(dir, "auth.json"), JSON.stringify({
      "grok-build": {
        type: "oauth", access: "at-host", refresh: "rt-host", expires: now + 3600_000,
        issuer: "https://auth.x.ai", client_id: "b1a00492-073a-47ea-816f-4c329264a828",
        scopes: ["openid"], token_type: "Bearer", obtained_at: now - 1000,
      },
    }, null, 2));
    const result = await lib.editImage({ prompt: "remix", images: [`data:image/png;base64,${TINY_PNG_B64}`] });
    expect(result.bytes.byteLength).toBeGreaterThan(0);
  });

  it("obeys the same compat rules: no XAI_API_KEY fallback when compatFallback is off", async () => {
    process.env.XAI_API_KEY = "sk-fallback";
    const lib = createGrokBuildHostLibrary({
      authPath: join(dir, "auth.json"),
      imagesRoot: join(dir, "images"),
      fetchImpl: (async () => { throw new Error("must not be called"); }) as unknown as typeof fetch,
    });
    await expect(lib.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "auth_expired" });
  });

  it("applies the advisory tier gate to OAuth callers (explicit empty tier)", async () => {
    process.env.GROK_TIER = ""; // explicit free tier -> gated
    const now = Date.now();
    await writeFile(join(dir, "auth.json"), JSON.stringify({
      "grok-build": {
        type: "oauth", access: "at-host", refresh: "rt-host", expires: now + 3600_000,
        issuer: "https://auth.x.ai", client_id: "b1a00492-073a-47ea-816f-4c329264a828",
        scopes: ["openid"], token_type: "Bearer", obtained_at: now - 1000,
      },
    }, null, 2));
    const lib = createGrokBuildHostLibrary({
      authPath: join(dir, "auth.json"),
      imagesRoot: join(dir, "images"),
      fetchImpl: (async () => { throw new Error("must not be called"); }) as unknown as typeof fetch,
    });
    await expect(lib.generateImage({ prompt: "x" })).rejects.toMatchObject({ code: "tier_restricted" });
  });
});

describe("host receipt + manifest declaration", () => {
  it("manifest declares host.entry and the bundled receipt pins its sha256", () => {
    const manifest = JSON.parse(readFileSync(joinPath(pkgRoot, "pipiui-extension.json"), "utf8")) as {
      host?: { entry?: string };
    };
    expect(manifest.host?.entry).toBe("agent/dist/host.js");
    expect(existsSync(joinPath(pkgRoot, "agent", "dist", "host.js"))).toBe(true);

    const bundledRoot = joinPath(pkgRoot, "..", "..", "resources", "runtime", "extensions", "grok-build-oauth");
    const receiptPath = joinPath(bundledRoot, "pipiui-host-receipt.json");
    expect(existsSync(receiptPath)).toBe(true);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as {
      extensionId: string; hostEntry: string; sha256: string; bytes: number;
    };
    expect(receipt.extensionId).toBe("grok-build-oauth");
    expect(receipt.hostEntry).toBe(manifest.host?.entry);
    const hostFile = readFileSync(joinPath(bundledRoot, receipt.hostEntry));
    expect(receipt.bytes).toBe(hostFile.byteLength);
    expect(receipt.sha256).toBe(createHash("sha256").update(hostFile).digest("hex"));
  });
});
