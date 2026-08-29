import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXTENSION_HOST_API_VERSION } from "../src/extension-manifest.js";
import {
  applyExtensionUpdate,
  checkExtensionUpdate,
  ExtensionUpdateError,
  nativeArchitectures,
  satisfiesExtensionHostApiRange,
  type ExtensionUpdateFetch,
  type ExtensionUpdateFetchResponse,
} from "../src/extension-update-engine.js";

const ID = "sample-extension";
const SOURCE = { type: "githubReleases", owner: "acme", repo: "extensions" } as const;
const RELEASES_URL = "https://api.github.com/repos/acme/extensions/releases";
const BASE = "https://github.com/acme/extensions/releases/download";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

const signB64 = (bytes: Buffer, key = privateKey): string => sign(null, bytes, key).toString("base64");
const sha256Hex = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

function artifactBytesFor(version: string): Buffer {
  return Buffer.from(`artifact-payload-${version}-${"x".repeat(96)}`);
}

function jsonResponse(payload: unknown): ExtensionUpdateFetchResponse {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8");
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    json: async () => payload,
    arrayBuffer: async () => encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength),
  };
}

function bytesResponse(bytes: Buffer): ExtensionUpdateFetchResponse {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: (name: string) => (name.toLowerCase() === "content-length" ? String(bytes.length) : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function assetNameFor(version: string): string {
  return `${ID}-${version}.tar.gz`;
}

function makeRoutes(versions: string[]): Record<string, () => ExtensionUpdateFetchResponse> {
  const routes: Record<string, () => ExtensionUpdateFetchResponse> = {};
  const releases = versions.map(version => ({
    tag_name: `v${version}`,
    draft: false,
    assets: [
      { name: `${ID}-assets.json`, browser_download_url: `${BASE}/v${version}/${ID}-assets.json` },
      { name: assetNameFor(version), browser_download_url: `${BASE}/v${version}/${assetNameFor(version)}` },
    ],
  }));
  routes[RELEASES_URL] = () => jsonResponse(releases);
  for (const version of versions) {
    const bytes = artifactBytesFor(version);
    const index = {
      version,
      baseUrl: `${BASE}/v${version}`,
      assets: {
        "darwin-arm64": {
          asset: assetNameFor(version),
          bytes: bytes.length,
          sha256: sha256Hex(bytes),
          signature: signB64(bytes),
        },
      },
    };
    routes[`${BASE}/v${version}/${ID}-assets.json`] = () => jsonResponse(index);
    routes[`${BASE}/v${version}/${assetNameFor(version)}`] = () => bytesResponse(bytes);
  }
  return routes;
}

function fetchFromRoutes(routes: Record<string, () => ExtensionUpdateFetchResponse>): ExtensionUpdateFetch {
  return async url => {
    const handler = routes[url.split("?")[0]];
    if (!handler) return { ok: false, status: 404, statusText: "Not Found", headers: { get: () => null } };
    return handler();
  };
}

async function makeStore(): Promise<string> {
  return mkdtemp(join(tmpdir(), "extupdate-store-"));
}

function machoBinary(arch: "arm64" | "x64"): Buffer {
  const buf = Buffer.alloc(64);
  buf.writeUInt32LE(0xfeedfacf, 0);
  buf.writeUInt32LE(arch === "arm64" ? 0x0100000c : 0x01000007, 4);
  return buf;
}

function updateOptions(storeRoot: string, routes: Record<string, () => ExtensionUpdateFetchResponse>) {
  return {
    storeRoot,
    signingPublicKey: publicKey,
    fetchImpl: fetchFromRoutes(routes),
  };
}

function updateRequest(version?: string) {
  return {
    extensionId: ID,
    source: SOURCE,
    ...(version ? { targetVersion: version } : {}),
    currentVersion: version && version !== "0.1.0" ? "0.1.0" : undefined,
    platform: "darwin" as const,
    arch: "arm64" as const,
  };
}

describe("extension update engine — discovery (更新中心 评估更新 reuse)", () => {
  it("reports updateAvailable when the release channel is newer", async () => {
    const check = await checkExtensionUpdate({
      extensionId: ID,
      source: SOURCE,
      currentVersion: "0.1.0",
      fetchImpl: fetchFromRoutes(makeRoutes(["0.2.0"])),
    });
    expect(check.status).toBe("updateAvailable");
    expect(check.latestVersion).toBe("0.2.0");
  });

  it("reports upToDate when current equals latest", async () => {
    const check = await checkExtensionUpdate({
      extensionId: ID,
      source: SOURCE,
      currentVersion: "0.2.0",
      fetchImpl: fetchFromRoutes(makeRoutes(["0.2.0"])),
    });
    expect(check.status).toBe("upToDate");
  });
});

describe("extension update engine — applyExtensionUpdate permanently disabled", () => {
  it("rejects regardless of signing key or source and does not touch the store", async () => {
    const storeRoot = await makeStore();
    const routes = makeRoutes(["0.2.0"]);
    const withKey = updateOptions(storeRoot, routes);
    await expect(applyExtensionUpdate(updateRequest("0.2.0"), withKey)).rejects.toMatchObject({
      name: "ExtensionUpdateError",
      code: "updates_disabled",
      message: "更新功能已关闭",
    });
    await expect(
      applyExtensionUpdate(updateRequest("0.2.0"), { storeRoot, fetchImpl: fetchFromRoutes(routes) }),
    ).rejects.toBeInstanceOf(ExtensionUpdateError);
    await expect(
      applyExtensionUpdate(
        { extensionId: ID, source: { type: "npm", packageName: "sample-ext" }, targetVersion: "0.2.0" },
        withKey,
      ),
    ).rejects.toMatchObject({ code: "updates_disabled" });
    expect(await readdir(storeRoot).catch(() => [])).toEqual([]);
    await rm(storeRoot, { recursive: true, force: true });
  });
});

describe("extension update engine — hostApi compatibility gate (contract-scaffold contract)", () => {
  it("satisfiesExtensionHostApiRange enforces the frozen comparator grammar", () => {
    expect(satisfiesExtensionHostApiRange(">=1.0.0 <2.0.0", "1.0.0")).toBe(true);
    expect(satisfiesExtensionHostApiRange(">=1.0.0 <2.0.0", EXTENSION_HOST_API_VERSION)).toBe(true);
    expect(satisfiesExtensionHostApiRange(">=2.0.0", "1.0.0")).toBe(false);
    expect(satisfiesExtensionHostApiRange("^1.0.0", "1.9.9")).toBe(true);
    expect(satisfiesExtensionHostApiRange("^1.0.0", "2.0.0")).toBe(false);
    expect(satisfiesExtensionHostApiRange("^0.1.0", "0.1.9")).toBe(true);
    expect(satisfiesExtensionHostApiRange("^0.1.0", "0.2.0")).toBe(false);
    expect(satisfiesExtensionHostApiRange("^0.1.0", "0.1.0")).toBe(true);
    expect(satisfiesExtensionHostApiRange("~1.2.0", "1.2.9")).toBe(true);
    expect(satisfiesExtensionHostApiRange("~1.2.0", "1.3.0")).toBe(false);
    expect(satisfiesExtensionHostApiRange("1.0.0", "1.0.0")).toBe(true);
    expect(satisfiesExtensionHostApiRange("1.0.0", "1.0.1")).toBe(false);
  });
});

describe("extension update engine — native architecture gate", () => {
  it("sniffs Mach-O cpu type from the header", () => {
    expect(nativeArchitectures(machoBinary("arm64"), "darwin")).toEqual(["arm64"]);
    expect(nativeArchitectures(machoBinary("x64"), "darwin")).toEqual(["x64"]);
  });
});
