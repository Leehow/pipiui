import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXTENSION_HOST_API_VERSION, parseExtensionManifestJson } from "../src/extension-manifest.js";
import { readProjectExtensionEnabled, writeProjectExtensionEnabled } from "../src/extension-registry.js";
import {
  applyExtensionUpdate,
  checkExtensionUpdate,
  ExtensionUpdateError,
  extensionUpdateStoreRoot,
  nativeArchitectures,
  readExtensionReceipt,
  readExtensionSlot,
  resolveActiveExtensionObject,
  satisfiesExtensionHostApiRange,
  type ExtensionUpdateFetch,
  type ExtensionUpdateFetchResponse,
} from "../src/extension-update-engine.js";

// ── fixture helpers ──────────────────────────────────────────────────────────

const ID = "sample-extension";
const SOURCE = { type: "githubReleases", owner: "acme", repo: "extensions" } as const;
const RELEASES_URL = "https://api.github.com/repos/acme/extensions/releases";
const BASE = "https://github.com/acme/extensions/releases/download";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const { privateKey: otherPrivateKey } = generateKeyPairSync("ed25519");

const signB64 = (bytes: Buffer, key = privateKey): string => sign(null, bytes, key).toString("base64");
const sha256Hex = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

function manifestJson(version: string, hostApi: string | null = ">=1.0.0 <2.0.0", id: string = ID): Record<string, unknown> {
  return {
    id,
    name: "Sample Extension",
    version,
    capabilities: [],
    ...(hostApi ? { hostApi } : {}),
    update: { channel: "stable", signature: "ed25519" },
  };
}

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

function interruptedResponse(expectedBytes: number): ExtensionUpdateFetchResponse {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: (name: string) => (name.toLowerCase() === "content-length" ? String(expectedBytes) : null) },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.error(new Error("connection reset"));
      },
    }),
  };
}

function assetNameFor(version: string): string {
  return `${ID}-${version}.tar.gz`;
}

/** URL→response router over the fixed endpoints only (releases API + release asset hosts). */
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

/** Writes a package tree (manifest + payload) to disk and returns its directory. */
async function makePackageDir(version: string, options?: { hostApi?: string | null; id?: string; nativeExecutable?: string }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "extupdate-pkg-"));
  const hostApi = options?.hostApi !== undefined ? options.hostApi : ">=1.0.0 <2.0.0";
  await writeFile(join(root, "pipiui-extension.json"), `${JSON.stringify(manifestJson(version, hostApi, options?.id), null, 2)}\n`, "utf8");
  if (options?.nativeExecutable) {
    await mkdir(join(root, join(options.nativeExecutable, "..")), { recursive: true });
    await writeFile(join(root, options.nativeExecutable), machoBinary("arm64"));
  }
  return root;
}

/** Minimal Mach-O header (magic + cpu subtype) — enough for nativeArchitectures. */
function machoBinary(arch: "arm64" | "x64"): Buffer {
  const buf = Buffer.alloc(64);
  buf.writeUInt32LE(0xfeedfacf, 0);
  buf.writeUInt32LE(arch === "arm64" ? 0x0100000c : 0x01000007, 4);
  return buf;
}

function unpackerFromPackageDir(packageDir: string) {
  return async (_archivePath: string, stagingDir: string): Promise<void> => {
    await cp(packageDir, stagingDir, { recursive: true });
  };
}

/** Materializes a valid package tree for the version encoded in the archive name. */
function syntheticUnpacker() {
  return async (_archivePath: string, stagingDir: string, archiveName: string): Promise<void> => {
    const version = /(\d+\.\d+\.\d+)/.exec(archiveName)![1];
    await writeFile(join(stagingDir, "pipiui-extension.json"), JSON.stringify(manifestJson(version)), "utf8");
  };
}

function updateOptions(storeRoot: string, routes: Record<string, () => ExtensionUpdateFetchResponse>, extra: Record<string, unknown> = {}) {
  return {
    storeRoot,
    signingPublicKey: publicKey,
    fetchImpl: fetchFromRoutes(routes),
    unpackArchive: syntheticUnpacker(),
    ...extra,
  };
}

function updateRequest(version?: string) {
  return {
    extensionId: ID,
    source: SOURCE,
    ...(version ? { targetVersion: version } : {}),
    currentVersion: version && version !== "0.1.0" ? "0.1.0" : undefined,
    platform: "darwin",
    arch: "arm64",
  };
}

async function storeState(storeRoot: string) {
  const list = async (path: string): Promise<string[]> => {
    try {
      return (await readdir(path)).sort();
    } catch {
      return [];
    }
  };
  return {
    objects: await list(join(storeRoot, "objects")),
    receipts: await list(join(storeRoot, "extensions", ID, "receipts")),
    active: await readExtensionSlot(storeRoot, ID, "active"),
    previous: await readExtensionSlot(storeRoot, ID, "previous"),
    tmp: await list(join(storeRoot, "tmp")),
    locks: await list(join(storeRoot, "locks")),
  };
}

async function makeSeed(): Promise<string> {
  const seedRoot = await mkdtemp(join(tmpdir(), "extupdate-seed-"));
  const seedDir = join(seedRoot, ID);
  await mkdir(seedDir, { recursive: true });
  await writeFile(join(seedDir, "pipiui-extension.json"), `${JSON.stringify(manifestJson("0.1.0"))}\n`, "utf8");
  return seedRoot;
}

const hasTar = spawnSync("tar", ["--version"]).status === 0;

// ── discovery ────────────────────────────────────────────────────────────────

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

// ── the transaction ─────────────────────────────────────────────────────────

describe("extension update engine — transaction happy path", () => {
  it("installs into the content-addressed store, writes a persistent receipt, switches active", async () => {
    const storeRoot = await makeStore();
    const routes = makeRoutes(["0.2.0"]);
    const result = await applyExtensionUpdate(updateRequest("0.2.0"), updateOptions(storeRoot, routes));

    expect(result.skipped).toBeFalsy();
    expect(result.contentHash).toBe(sha256Hex(artifactBytesFor("0.2.0")));
    expect(existsSync(result.objectDir)).toBe(true);
    // The stored object is the unpacked package with a valid contract manifest.
    const stored = parseExtensionManifestJson(await readFile(join(result.objectDir, "pipiui-extension.json"), "utf8"));
    expect(stored.ok).toBe(true);
    if (stored.ok) {
      expect(stored.manifest.id).toBe(ID);
      expect(stored.manifest.version).toBe("0.2.0");
      expect(stored.manifest.hostApi).toBe(">=1.0.0 <2.0.0");
    }

    // Receipt persists and carries the full verification record.
    const receipt = await readExtensionReceipt(storeRoot, ID, result.contentHash);
    expect(receipt).toBeDefined();
    expect(receipt!.extensionId).toBe(ID);
    expect(receipt!.version).toBe("0.2.0");
    expect(receipt!.sha256).toBe(sha256Hex(artifactBytesFor("0.2.0")));
    expect(receipt!.channel).toBe("stable");
    expect(receipt!.signature).toBe("ed25519");
    expect(receipt!.hostApi).toBe(">=1.0.0 <2.0.0");

    // Active slot switched; no previous on the first install; scratch cleaned.
    const state = await storeState(storeRoot);
    expect(state.active?.contentHash).toBe(result.contentHash);
    expect(state.previous).toBeUndefined();
    expect(state.objects).toEqual([result.contentHash]);
    expect(state.receipts).toEqual([`${result.contentHash}.json`]);
    expect(state.tmp).toEqual([]);
    expect(state.locks).toEqual([]);

    const resolved = await resolveActiveExtensionObject({ storeRoot, extensionId: ID });
    expect(resolved).toEqual({ objectDir: result.objectDir, slot: "active" });
    await rm(storeRoot, { recursive: true, force: true });
  });

  it("a second update keeps the previous slot and every receipt", async () => {
    const storeRoot = await makeStore();
    const routes = makeRoutes(["0.2.0", "0.3.0"]);
    const first = await applyExtensionUpdate(updateRequest("0.2.0"), updateOptions(storeRoot, routes));
    const second = await applyExtensionUpdate(
      { extensionId: ID, source: SOURCE, targetVersion: "0.3.0", currentVersion: "0.2.0", platform: "darwin", arch: "arm64" },
      updateOptions(storeRoot, routes),
    );

    expect(second.previousContentHash).toBe(first.contentHash);
    const state = await storeState(storeRoot);
    expect(state.active?.contentHash).toBe(second.contentHash);
    expect(state.previous?.contentHash).toBe(first.contentHash);
    // Both receipts persist: the store remembers every installed artifact.
    expect(state.receipts).toEqual([`${first.contentHash}.json`, `${second.contentHash}.json`].sort());
    expect(state.objects).toEqual([first.contentHash, second.contentHash].sort());
    const firstReceipt = await readExtensionReceipt(storeRoot, ID, first.contentHash);
    expect(firstReceipt?.version).toBe("0.2.0");
    await rm(storeRoot, { recursive: true, force: true });
  });

  it("skips when the target already matches current", async () => {
    const storeRoot = await makeStore();
    const routes = makeRoutes(["0.2.0"]);
    const result = await applyExtensionUpdate(
      { extensionId: ID, source: SOURCE, targetVersion: "0.2.0", currentVersion: "0.2.0", platform: "darwin", arch: "arm64" },
      updateOptions(storeRoot, routes),
    );
    expect(result.skipped).toBe(true);
    expect(await storeState(storeRoot)).toMatchObject({ objects: [], receipts: [], active: undefined });
    await rm(storeRoot, { recursive: true, force: true });
  });
});

// ── failure injection: every path rolls the store back ───────────────────────

describe("extension update engine — failure injection rollback", () => {
  it("download interruption leaves the store untouched and cleans its scratch", async () => {
    const storeRoot = await makeStore();
    const routes = makeRoutes(["0.2.0", "0.3.0"]);
    const good = await applyExtensionUpdate(updateRequest("0.2.0"), updateOptions(storeRoot, routes));
    const before = await storeState(storeRoot);
    expect(before.active?.contentHash).toBe(good.contentHash);

    // The 0.3.0 artifact stream errors mid-flight.
    routes[`${BASE}/v0.3.0/${assetNameFor("0.3.0")}`] = () => interruptedResponse(artifactBytesFor("0.3.0").length);
    await expect(
      applyExtensionUpdate(
        { extensionId: ID, source: SOURCE, targetVersion: "0.3.0", currentVersion: "0.2.0", platform: "darwin", arch: "arm64" },
        updateOptions(storeRoot, routes),
      ),
    ).rejects.toThrow(/connection reset/);

    const after = await storeState(storeRoot);
    expect(after.active?.contentHash).toBe(good.contentHash);
    expect(after.previous).toBeUndefined();
    expect(after.objects).toEqual(before.objects);
    expect(after.receipts).toEqual(before.receipts);
    expect(after.tmp).toEqual([]);
    expect(after.locks).toEqual([]);
    await rm(storeRoot, { recursive: true, force: true });
  });

  it("hash mismatch is rejected before unpack and before any slot change", async () => {
    const storeRoot = await makeStore();
    const routes = makeRoutes(["0.2.0", "0.3.0"]);
    const good = await applyExtensionUpdate(updateRequest("0.2.0"), updateOptions(storeRoot, routes));
    const before = await storeState(storeRoot);

    routes[`${BASE}/v0.3.0/${ID}-assets.json`] = () =>
      jsonResponse({
        version: "0.3.0",
        baseUrl: `${BASE}/v0.3.0`,
        assets: {
          "darwin-arm64": {
            asset: assetNameFor("0.3.0"),
            bytes: artifactBytesFor("0.3.0").length,
            sha256: sha256Hex(Buffer.from("not-the-real-artifact")),
            signature: signB64(artifactBytesFor("0.3.0")),
          },
        },
      });

    await expect(
      applyExtensionUpdate(
        { extensionId: ID, source: SOURCE, targetVersion: "0.3.0", currentVersion: "0.2.0", platform: "darwin", arch: "arm64" },
        updateOptions(storeRoot, routes),
      ),
    ).rejects.toBeInstanceOf(ExtensionUpdateError);
    await expect(
      applyExtensionUpdate(
        { extensionId: ID, source: SOURCE, targetVersion: "0.3.0", currentVersion: "0.2.0", platform: "darwin", arch: "arm64" },
        updateOptions(storeRoot, routes),
      ),
    ).rejects.toMatchObject({ code: "hash_mismatch" });

    const after = await storeState(storeRoot);
    expect(after.active?.contentHash).toBe(good.contentHash);
    expect(after.objects).toEqual(before.objects);
    expect(after.receipts).toEqual(before.receipts);
    expect(after.tmp).toEqual([]);
    await rm(storeRoot, { recursive: true, force: true });
  });

  it("foreign-key signature is rejected and nothing changes", async () => {
    const storeRoot = await makeStore();
    const routes = makeRoutes(["0.3.0"]);
    const bytes = artifactBytesFor("0.3.0");
    routes[`${BASE}/v0.3.0/${ID}-assets.json`] = () =>
      jsonResponse({
        version: "0.3.0",
        baseUrl: `${BASE}/v0.3.0`,
        assets: {
          "darwin-arm64": {
            asset: assetNameFor("0.3.0"),
            bytes: bytes.length,
            sha256: sha256Hex(bytes),
            signature: signB64(bytes, otherPrivateKey),
          },
        },
      });

    await expect(
      applyExtensionUpdate(updateRequest("0.3.0"), updateOptions(storeRoot, routes)),
    ).rejects.toMatchObject({ code: "signature_invalid" });

    const state = await storeState(storeRoot);
    expect(state.objects).toEqual([]);
    expect(state.receipts).toEqual([]);
    expect(state.active).toBeUndefined();
    expect(state.tmp).toEqual([]);
    await rm(storeRoot, { recursive: true, force: true });
  });

  it("a missing signing key refuses the unsigned path (official signed packages only)", async () => {
    const storeRoot = await makeStore();
    const routes = makeRoutes(["0.3.0"]);
    await expect(
      applyExtensionUpdate(updateRequest("0.3.0"), { storeRoot, fetchImpl: fetchFromRoutes(routes) }),
    ).rejects.toMatchObject({ code: "signature_invalid" });
    const state = await storeState(storeRoot);
    expect(state.objects).toEqual([]);
    expect(state.active).toBeUndefined();
    await rm(storeRoot, { recursive: true, force: true });
  });

  it("unpack failure rolls back and the store stays usable for a retry", async () => {
    const storeRoot = await makeStore();
    const routes = makeRoutes(["0.2.0", "0.3.0"]);
    const good = await applyExtensionUpdate(updateRequest("0.2.0"), updateOptions(storeRoot, routes));
    const before = await storeState(storeRoot);

    await expect(
      applyExtensionUpdate(
        { extensionId: ID, source: SOURCE, targetVersion: "0.3.0", currentVersion: "0.2.0", platform: "darwin", arch: "arm64" },
        updateOptions(storeRoot, routes, { unpackArchive: () => { throw new Error("corrupt archive"); } }),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("corrupt archive") });

    const after = await storeState(storeRoot);
    expect(after.active?.contentHash).toBe(good.contentHash);
    expect(after.objects).toEqual(before.objects);
    expect(after.receipts).toEqual(before.receipts);
    expect(after.tmp).toEqual([]);

    // The store is still usable: a good transaction succeeds afterwards.
    const retry = await applyExtensionUpdate(
      { extensionId: ID, source: SOURCE, targetVersion: "0.3.0", currentVersion: "0.2.0", platform: "darwin", arch: "arm64" },
      updateOptions(storeRoot, routes),
    );
    expect(retry.contentHash).toBe(sha256Hex(artifactBytesFor("0.3.0")));
    expect((await storeState(storeRoot)).active?.contentHash).toBe(retry.contentHash);
    await rm(storeRoot, { recursive: true, force: true });
  });

  it("activation failure rolls the active slot back to the previous version", async () => {
    const storeRoot = await makeStore();
    const routes = makeRoutes(["0.2.0", "0.3.0"]);
    const first = await applyExtensionUpdate(updateRequest("0.2.0"), updateOptions(storeRoot, routes));
    const previousBefore = await readExtensionSlot(storeRoot, ID, "previous");
    expect(previousBefore).toBeUndefined();

    await expect(
      applyExtensionUpdate(
        { extensionId: ID, source: SOURCE, targetVersion: "0.3.0", currentVersion: "0.2.0", platform: "darwin", arch: "arm64" },
        updateOptions(storeRoot, routes, { activateHook: () => { throw new Error("session handover refused"); } }),
      ),
    ).rejects.toMatchObject({ code: "activation_failed" });

    // Active restored to 0.2.0; previous restored to its pre-transaction (absent) shape.
    const state = await storeState(storeRoot);
    expect(state.active?.contentHash).toBe(first.contentHash);
    expect(state.previous).toBeUndefined();
    // The failed version's receipt persists: the artifact was installed, just not activated.
    expect(state.receipts).toHaveLength(2);
    expect(state.objects).toHaveLength(2);
    const resolved = await resolveActiveExtensionObject({ storeRoot, extensionId: ID });
    expect(resolved).toEqual({ objectDir: first.objectDir, slot: "active" });
    await rm(storeRoot, { recursive: true, force: true });
  });

  it("first-install activation failure falls back to the App built-in seed", async () => {
    const storeRoot = await makeStore();
    const seedRoot = await makeSeed();
    const routes = makeRoutes(["0.2.0"]);
    await expect(
      applyExtensionUpdate(
        updateRequest("0.2.0"),
        updateOptions(storeRoot, routes, { seedRoot, activateHook: () => { throw new Error("activation boom"); } }),
      ),
    ).rejects.toMatchObject({ code: "activation_failed" });

    const state = await storeState(storeRoot);
    expect(state.active).toBeUndefined();
    expect(state.previous).toBeUndefined();

    // No slot → resolver falls back previous→(none)→seed.
    const resolved = await resolveActiveExtensionObject({ storeRoot, extensionId: ID, seedRoot });
    expect(resolved?.slot).toBe("seed");
    expect(resolved?.objectDir).toBe(join(seedRoot, ID));
    // And without a configured seed there is nothing to resolve.
    expect(await resolveActiveExtensionObject({ storeRoot, extensionId: ID })).toBeUndefined();
    await rm(storeRoot, { recursive: true, force: true });
    await rm(seedRoot, { recursive: true, force: true });
  });
});

// ── contract consumption: manifest id / version / hostApi gate ───────────────

describe("extension update engine — hostApi compatibility gate (contract-scaffold contract)", () => {
  it("rejects a package whose hostApi range excludes the running host", async () => {
    const storeRoot = await makeStore();
    const routes = makeRoutes(["0.2.0"]);
    const pkg = await makePackageDir("0.2.0", { hostApi: ">=2.0.0" });
    await expect(
      applyExtensionUpdate(updateRequest("0.2.0"), updateOptions(storeRoot, routes, { unpackArchive: unpackerFromPackageDir(pkg) })),
    ).rejects.toMatchObject({ code: "host_api_incompatible" });
    const state = await storeState(storeRoot);
    expect(state.objects).toEqual([]);
    expect(state.active).toBeUndefined();
    await rm(storeRoot, { recursive: true, force: true });
    await rm(pkg, { recursive: true, force: true });
  });

  it("rejects a package manifest without a hostApi range", async () => {
    const storeRoot = await makeStore();
    const routes = makeRoutes(["0.2.0"]);
    const pkg = await makePackageDir("0.2.0", { hostApi: null });
    await expect(
      applyExtensionUpdate(updateRequest("0.2.0"), updateOptions(storeRoot, routes, { unpackArchive: unpackerFromPackageDir(pkg) })),
    ).rejects.toMatchObject({ code: "host_api_incompatible" });
    await rm(storeRoot, { recursive: true, force: true });
    await rm(pkg, { recursive: true, force: true });
  });

  it("rejects a package whose manifest id does not match the request", async () => {
    const storeRoot = await makeStore();
    const routes = makeRoutes(["0.2.0"]);
    const pkg = await makePackageDir("0.2.0", { id: "other-extension" });
    await expect(
      applyExtensionUpdate(updateRequest("0.2.0"), updateOptions(storeRoot, routes, { unpackArchive: unpackerFromPackageDir(pkg) })),
    ).rejects.toMatchObject({ code: "id_mismatch" });
    await rm(storeRoot, { recursive: true, force: true });
    await rm(pkg, { recursive: true, force: true });
  });

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

// ── native architecture gate ─────────────────────────────────────────────────

describe("extension update engine — native architecture gate", () => {
  it("sniffs the declared native binary and refuses a wrong-arch slice", async () => {
    const storeRoot = await makeStore();
    const routes = makeRoutes(["0.2.0"]);
    const pkg = await makePackageDir("0.2.0", { nativeExecutable: "bin/tool" });
    const bytes = artifactBytesFor("0.2.0");
    routes[`${BASE}/v0.2.0/${ID}-assets.json`] = () =>
      jsonResponse({
        version: "0.2.0",
        baseUrl: `${BASE}/v0.2.0`,
        assets: {
          "darwin-x64": {
            asset: assetNameFor("0.2.0"),
            bytes: bytes.length,
            sha256: sha256Hex(bytes),
            signature: signB64(bytes),
            nativeExecutable: "bin/tool",
          },
          "darwin-arm64": {
            asset: assetNameFor("0.2.0"),
            bytes: bytes.length,
            sha256: sha256Hex(bytes),
            signature: signB64(bytes),
            nativeExecutable: "bin/tool",
          },
        },
      });

    // Binary is arm64; the darwin-x64 entry is selected → refused.
    await expect(
      applyExtensionUpdate(
        { extensionId: ID, source: SOURCE, targetVersion: "0.2.0", platform: "darwin", arch: "x64" },
        updateOptions(storeRoot, routes, { unpackArchive: unpackerFromPackageDir(pkg) }),
      ),
    ).rejects.toMatchObject({ code: "arch_mismatch" });

    // Matching arch slice installs.
    const result = await applyExtensionUpdate(
      { extensionId: ID, source: SOURCE, targetVersion: "0.2.0", platform: "darwin", arch: "arm64" },
      updateOptions(storeRoot, routes, { unpackArchive: unpackerFromPackageDir(pkg) }),
    );
    expect(result.contentHash).toBe(sha256Hex(bytes));
    expect(nativeArchitectures(machoBinary("arm64"), "darwin")).toEqual(["arm64"]);
    await rm(storeRoot, { recursive: true, force: true });
    await rm(pkg, { recursive: true, force: true });
  });
});

// ── non-github sources are refused before any state change ───────────────────

describe("extension update engine — source union gate", () => {
  it("refuses npm/pypi artifact transactions before touching the store", async () => {
    const storeRoot = await makeStore();
    await expect(
      applyExtensionUpdate(
        { extensionId: ID, source: { type: "npm", packageName: "sample-ext" }, targetVersion: "0.2.0", platform: "darwin", arch: "arm64" },
        updateOptions(storeRoot, makeRoutes(["0.2.0"])),
      ),
    ).rejects.toMatchObject({ code: "unsupported_source" });
    expect(await readdir(storeRoot).catch(() => [])).toEqual([]);
    await rm(storeRoot, { recursive: true, force: true });
  });
});

// ── shared copy, per-project enablement ─────────────────────────────────────

describe("extension update engine — App-profile shared store, per-project enablement", () => {
  it("two projects resolve the same code copy while their enable states stay independent", async () => {
    const storeRoot = await makeStore();
    const routes = makeRoutes(["0.2.0"]);
    const install = await applyExtensionUpdate(updateRequest("0.2.0"), updateOptions(storeRoot, routes));

    const projectA = await mkdtemp(join(tmpdir(), "extupdate-project-a-"));
    const projectB = await mkdtemp(join(tmpdir(), "extupdate-project-b-"));
    const agentA = join(projectA, ".pi", "agent");
    const agentB = join(projectB, ".pi", "agent");
    await writeProjectExtensionEnabled(agentA, ID, true);
    await writeProjectExtensionEnabled(agentB, ID, false);

    // Both projects resolve the identical content-addressed object — one shared copy.
    const resolvedA = await resolveActiveExtensionObject({ storeRoot, extensionId: ID });
    const resolvedB = await resolveActiveExtensionObject({ storeRoot, extensionId: ID });
    expect(resolvedA).toEqual({ objectDir: install.objectDir, slot: "active" });
    expect(resolvedB).toEqual(resolvedA);

    // …while enablement remains a strictly per-project overlay.
    expect(await readProjectExtensionEnabled(agentA)).toEqual({ [ID]: true });
    expect(await readProjectExtensionEnabled(agentB)).toEqual({ [ID]: false });

    // Exactly one physical code copy exists in the store.
    expect((await storeState(storeRoot)).objects).toEqual([install.contentHash]);
    // And a project-derived store root would never equal the shared App-profile store root.
    expect(extensionUpdateStoreRoot(agentA)).not.toBe(storeRoot);

    await rm(storeRoot, { recursive: true, force: true });
    await rm(projectA, { recursive: true, force: true });
    await rm(projectB, { recursive: true, force: true });
  });
});

// ── default unpacker (system tar) end-to-end ─────────────────────────────────

describe("extension update engine — default unpacker", () => {
  it.runIf(hasTar)("unpacks a real tar.gz artifact end-to-end", async () => {
    const storeRoot = await makeStore();
    const pkg = await makePackageDir("0.2.0");
    const workDir = await mkdtemp(join(tmpdir(), "extupdate-tar-"));
    const tarPath = join(workDir, assetNameFor("0.2.0"));
    const tar = spawnSync("tar", ["-czf", tarPath, "-C", pkg, "."]);
    expect(tar.status).toBe(0);
    const tarBytes = await readFile(tarPath);

    const routes: Record<string, () => ExtensionUpdateFetchResponse> = {};
    routes[RELEASES_URL] = () =>
      jsonResponse([
        {
          tag_name: "v0.2.0",
          draft: false,
          assets: [
            { name: `${ID}-assets.json`, browser_download_url: `${BASE}/v0.2.0/${ID}-assets.json` },
            { name: assetNameFor("0.2.0"), browser_download_url: `${BASE}/v0.2.0/${assetNameFor("0.2.0")}` },
          ],
        },
      ]);
    routes[`${BASE}/v0.2.0/${ID}-assets.json`] = () =>
      jsonResponse({
        version: "0.2.0",
        baseUrl: `${BASE}/v0.2.0`,
        assets: {
          "darwin-arm64": {
            asset: assetNameFor("0.2.0"),
            bytes: tarBytes.length,
            sha256: sha256Hex(tarBytes),
            signature: signB64(tarBytes),
          },
        },
      });
    routes[`${BASE}/v0.2.0/${assetNameFor("0.2.0")}`] = () => bytesResponse(tarBytes);

    const result = await applyExtensionUpdate(updateRequest("0.2.0"), updateOptions(storeRoot, routes));
    expect(result.contentHash).toBe(sha256Hex(tarBytes));
    const stored = parseExtensionManifestJson(await readFile(join(result.objectDir, "pipiui-extension.json"), "utf8"));
    expect(stored.ok).toBe(true);
    await rm(storeRoot, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
    await rm(pkg, { recursive: true, force: true });
  });
});
