import { spawnSync } from "node:child_process";
import { createHash, verify as cryptoVerify } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  cp,
  readdir,
  realpath,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { Readable } from "node:stream";
import {
  EXTENSION_HOST_API_VERSION,
  EXTENSION_ID_RE,
  EXTENSION_MANIFEST_FILENAME,
  parseExtensionManifestJson,
} from "./extension-manifest.js";
import type { ExtensionUpdateComponentSource } from "./extension-update-components.js";

/**
 * Component-agnostic extension update transaction (shared-architecture wave).
 *
 * This is the updateComponents mechanism abstracted over components: version
 * discovery reuses the Update Center "评估更新" entry semantics, and the
 * download → verify → unpack → hostApi-check → receipt → atomic slot-switch
 * chain ports the proven OfficeCLI protocols (lock directory + owner file +
 * heartbeat, bounded-redirect allowlisted download, SHA-256/bytes/arch checks,
 * staged atomic replace with failure rollback) from
 * `Electron/scripts/fetch-officecli-binary.mjs` and `fetch-cua-driver.mjs`.
 * Do not diverge those algorithms lightly — the scripts carry the packaging
 * invariants and their own tests.
 *
 * Storage lives under one caller-provided App-profile root (the Electron host
 * passes `<userData>/pi-agent/extension-store`; never a global ~/.pi path and
 * never a per-project path — code copies are shared, enablement stays
 * per-project). Layout:
 *
 *   <storeRoot>/objects/<sha256>/                  immutable unpacked package trees
 *   <storeRoot>/extensions/<id>/receipts/<hash>.json  persistent install receipts
 *   <storeRoot>/extensions/<id>/active.json        active slot pointer
 *   <storeRoot>/extensions/<id>/previous.json      previous slot pointer (kept)
 *   <storeRoot>/locks/<id>.lock/                   transaction lock directory
 *   <storeRoot>/tmp/                               per-transaction scratch
 *
 * First version ships official signed packages only: ed25519 signatures over
 * the artifact bytes, verified against the host-pinned public key. Unsigned or
 * foreign-key artifacts are refused before any state changes.
 */

/** Store directory name inside the App-profile pi-agent home. */
export const EXTENSION_UPDATE_STORE_DIRNAME = "extension-store";

/** App-profile shared store root for a pi-agent home (Electron host joins its profile dir). */
export function extensionUpdateStoreRoot(agentDir: string): string {
  return join(agentDir, EXTENSION_UPDATE_STORE_DIRNAME);
}

const MANIFEST_COPY_FILENAME = "pipiui-extension.json";
const ACTIVE_SLOT_FILENAME = "active.json";
const PREVIOUS_SLOT_FILENAME = "previous.json";
const RECEIPTS_DIRNAME = "receipts";
const OBJECTS_DIRNAME = "objects";
const LOCKS_DIRNAME = "locks";
const TMP_DIRNAME = "tmp";

/** Bounded download window (same conservative budget as the OfficeCLI fetcher). */
export const EXTENSION_UPDATE_DOWNLOAD_TIMEOUT_MS = 180_000;
export const EXTENSION_UPDATE_LOCK_HEARTBEAT_MS = 5_000;
export const EXTENSION_UPDATE_LOCK_STALE_MS = EXTENSION_UPDATE_DOWNLOAD_TIMEOUT_MS + 60_000;
export const EXTENSION_UPDATE_LOCK_INIT_GRACE_MS = 2_000;
export const EXTENSION_UPDATE_MAX_REDIRECTS = 5;
/** Hard cap for the per-release asset index document (small JSON, never a package). */
export const EXTENSION_UPDATE_INDEX_MAX_BYTES = 1_048_576;
export const EXTENSION_UPDATE_OWNER_FILE_RE = /^[0-9a-f]{32}\.owner$/;

const ALLOWED_DOWNLOAD_HOSTS: readonly string[] = Object.freeze([
  "pipi.aichattrpg.com",
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "api.github.com",
]);

/** Fixed discovery endpoints — the same closed union the Update Center checks. */
const GITHUB_RELEASES_API = (owner: string, repo: string): string =>
  `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=100`;

export type ExtensionUpdateErrorCode =
  | "invalid_input"
  | "unsupported_source"
  | "source_unreachable"
  | "asset_index_invalid"
  | "download_failed"
  | "size_mismatch"
  | "hash_mismatch"
  | "signature_invalid"
  | "arch_mismatch"
  | "unpack_failed"
  | "manifest_invalid"
  | "id_mismatch"
  | "host_api_incompatible"
  | "activation_failed"
  | "lock_timeout";

export class ExtensionUpdateError extends Error {
  readonly code: ExtensionUpdateErrorCode;
  constructor(code: ExtensionUpdateErrorCode, message: string) {
    super(message);
    this.name = "ExtensionUpdateError";
    this.code = code;
  }
}

/** Structural fetch surface — real `globalThis.fetch` satisfies it; tests inject fakes. */
export type ExtensionUpdateFetchResponse = {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null | undefined };
  json?(): Promise<unknown>;
  arrayBuffer?(): Promise<ArrayBuffer>;
  body?: unknown;
};
export type ExtensionUpdateFetch = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string>; redirect?: string },
) => Promise<ExtensionUpdateFetchResponse>;

type Semver = { core: [number, number, number]; prerelease: Array<number | string> };

/** Ported from update-center.ts parseSemver — identical SemVer precedence. */
export function parseUpdateSemver(raw: string): Semver | undefined {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(raw);
  if (!match) return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".").map(part => /^\d+$/.test(part) ? Number(part) : part) ?? [],
  };
}

function comparePrecedence(a: Semver, b: Semver): number {
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i += 1) {
    const av = a.prerelease[i];
    const bv = b.prerelease[i];
    if (av === undefined || bv === undefined) return av === bv ? 0 : av === undefined ? -1 : 1;
    if (av === bv) continue;
    if (typeof av === "number" && typeof bv === "number") return av - bv;
    if (typeof av === "number") return -1;
    if (typeof bv === "number") return 1;
    return av.localeCompare(bv);
  }
  return 0;
}

/** Positive when `left` is newer (undefined when either side is not SemVer). */
export function compareUpdateSemver(left: string, right: string): number | undefined {
  const a = parseUpdateSemver(left);
  const b = parseUpdateSemver(right);
  if (!a || !b) return undefined;
  return comparePrecedence(a, b);
}

/** Non-draft tags that are exactly `v<semver>` or `<semver>`, highest wins (update-center port). */
export function latestGithubReleaseVersion(payload: unknown): string | undefined {
  if (!Array.isArray(payload)) return undefined;
  const candidates = payload.flatMap(release => {
    if (!release || typeof release !== "object" || (release as { draft?: unknown }).draft === true) return [];
    const tag = (release as { tag_name?: unknown }).tag_name;
    if (typeof tag !== "string") return [];
    const match = /^v?(.+)$/.exec(tag);
    return match && parseUpdateSemver(match[1]) ? [match[1]] : [];
  });
  return candidates.sort((a, b) => compareUpdateSemver(b, a) ?? 0)[0];
}

function releaseForVersion(payload: unknown, version: string): { tag: string; assets: ReleaseAsset[] } | undefined {
  if (!Array.isArray(payload)) return undefined;
  for (const release of payload) {
    if (!release || typeof release !== "object" || (release as { draft?: unknown }).draft === true) continue;
    const tag = (release as { tag_name?: unknown }).tag_name;
    if (typeof tag !== "string") continue;
    if (/^v?(.+)$/.exec(tag)?.[1] !== version) continue;
    const rawAssets = (release as { assets?: unknown }).assets;
    if (!Array.isArray(rawAssets)) return { tag, assets: [] };
    const assets: ReleaseAsset[] = [];
    for (const asset of rawAssets) {
      if (!asset || typeof asset !== "object") continue;
      const name = (asset as { name?: unknown }).name;
      const url = (asset as { browser_download_url?: unknown }).browser_download_url;
      if (typeof name !== "string" || typeof url !== "string") continue;
      assets.push({ name, url });
    }
    return { tag, assets };
  }
  return undefined;
}

type ReleaseAsset = { name: string; url: string };

/** One `<platform>-<arch>` entry of the pinned asset index (officecli-assets.json shape). */
export type ExtensionUpdateAssetEntry = {
  asset: string;
  bytes: number;
  sha256: string;
  /** base64 ed25519 signature over the raw artifact bytes (required: official signed only). */
  signature?: string;
  /** Package-relative native binary to architecture-sniff after unpack (optional). */
  nativeExecutable?: string;
};

/** Pinned artifact index published as `<extensionId>-assets.json` on the release. */
export type ExtensionUpdateAssetIndex = {
  version: string;
  baseUrl: string;
  assets: Record<string, ExtensionUpdateAssetEntry>;
};

export function parseAssetIndex(value: unknown, targetVersion: string): ExtensionUpdateAssetIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExtensionUpdateError("asset_index_invalid", "extension asset index must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== targetVersion) {
    throw new ExtensionUpdateError(
      "asset_index_invalid",
      `extension asset index is for version ${String(record.version)}, expected ${targetVersion}`,
    );
  }
  if (typeof record.baseUrl !== "string" || record.baseUrl.includes("/latest")) {
    throw new ExtensionUpdateError("asset_index_invalid", "extension asset index baseUrl must be an immutable release URL");
  }
  if (!record.assets || typeof record.assets !== "object" || Array.isArray(record.assets)) {
    throw new ExtensionUpdateError("asset_index_invalid", "extension asset index must declare an assets map");
  }
  const assets: Record<string, ExtensionUpdateAssetEntry> = {};
  for (const [key, raw] of Object.entries(record.assets as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") {
      throw new ExtensionUpdateError("asset_index_invalid", `asset index entry ${key} must be an object`);
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry.asset !== "string" || !entry.asset) {
      throw new ExtensionUpdateError("asset_index_invalid", `asset index entry ${key} must declare an asset name`);
    }
    if (!Number.isInteger(entry.bytes) || (entry.bytes as number) <= 0) {
      throw new ExtensionUpdateError("asset_index_invalid", `asset index entry ${key} must declare integer bytes`);
    }
    if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new ExtensionUpdateError("asset_index_invalid", `asset index entry ${key} must declare a sha256 digest`);
    }
    const resolved: ExtensionUpdateAssetEntry = {
      asset: entry.asset,
      bytes: entry.bytes as number,
      sha256: entry.sha256,
    };
    if (entry.signature !== undefined) {
      if (typeof entry.signature !== "string" || !entry.signature) {
        throw new ExtensionUpdateError("asset_index_invalid", `asset index entry ${key} signature must be a base64 string`);
      }
      resolved.signature = entry.signature;
    }
    if (entry.nativeExecutable !== undefined) {
      if (typeof entry.nativeExecutable !== "string" || entry.nativeExecutable.startsWith("/") || entry.nativeExecutable.includes("..")) {
        throw new ExtensionUpdateError("asset_index_invalid", `asset index entry ${key} nativeExecutable must be a package-relative path`);
      }
      resolved.nativeExecutable = entry.nativeExecutable;
    }
    assets[key] = resolved;
  }
  return { version: targetVersion, baseUrl: record.baseUrl, assets };
}

/**
 * Semver range satisfaction over the frozen comparator grammar accepted by
 * `isValidExtensionHostApiRange` (space/comma separated `>=`, `>`, `<=`, `<`,
 * `=`, `^`, `~`, or bare exact — no `||`, no wildcards).
 */
export function satisfiesExtensionHostApiRange(range: string, version: string): boolean {
  const trimmed = range.trim();
  if (!trimmed) return false;
  const target = parseUpdateSemver(version);
  if (!target) return false;
  const COMPARATOR_RE = /^(>=|<=|>|<|=|\^|~)?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
  return trimmed.split(/[\s,]+/).every(part => {
    const match = COMPARATOR_RE.exec(part);
    if (!match) return false;
    const comparator = match[1] ?? "=";
    const bound = parseUpdateSemver(`${match[2]}.${match[3]}.${match[4]}${match[5] ? `-${match[5]}` : ""}`);
    if (!bound) return false;
    const ord = comparePrecedence(target, bound);
    switch (comparator) {
      case ">=": return ord >= 0;
      case ">": return ord > 0;
      case "<=": return ord <= 0;
      case "<": return ord < 0;
      case "=": return ord === 0;
      case "^": {
        // >= bound, < next major/minor boundary (caret semantics for 0.x included).
        if (ord < 0) return false;
        const [x, y] = bound.core;
        const upper: Semver = x > 0
          ? { core: [x + 1, 0, 0], prerelease: [] }
          : y > 0
            ? { core: [0, y + 1, 0], prerelease: [] }
            : { core: [0, 0, bound.core[2] + 1], prerelease: [] };
        return comparePrecedence(target, upper) < 0;
      }
      case "~": {
        if (ord < 0) return false;
        const upper: Semver = { core: [bound.core[0], bound.core[1] + 1, 0], prerelease: [] };
        return comparePrecedence(target, upper) < 0;
      }
      default: return false;
    }
  });
}

// ── Ported OfficeCLI fetcher protocols (lock / download / replace / arch) ──

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

export function createOwnerToken(): string {
  return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "x")
    + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "x")
    + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "x")
    + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "x");
}

function encodeOwner({ pid, token, startedAt, heartbeatMs }: { pid: number; token: string; startedAt: number; heartbeatMs: number }): string {
  return `${JSON.stringify({ pid, token, startedAt, heartbeatMs })}\n`;
}

export function parseOwnerBody(text: string): { pid: number; token: string; startedAt: number; heartbeatMs: number } | null {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (!Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
    if (typeof parsed.token !== "string" || !EXTENSION_UPDATE_OWNER_FILE_RE.test(`${parsed.token}.owner`)) return null;
    if (!Number.isFinite(parsed.startedAt) || !Number.isFinite(parsed.heartbeatMs)) return null;
    return { pid: parsed.pid, token: parsed.token, startedAt: parsed.startedAt, heartbeatMs: parsed.heartbeatMs };
  } catch {
    return null;
  }
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function assertAllowedUpdateUrl(urlString: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new ExtensionUpdateError("download_failed", `extension update URL is invalid: ${urlString}`);
  }
  if (parsed.protocol !== "https:") {
    throw new ExtensionUpdateError("download_failed", `extension update rejected protocol drift: ${urlString}`);
  }
  if (parsed.username || parsed.password) {
    throw new ExtensionUpdateError("download_failed", `extension update rejected credentials in URL: ${parsed.hostname}`);
  }
  if (parsed.port && parsed.port !== "443") {
    throw new ExtensionUpdateError("download_failed", `extension update rejected non-443 port: ${urlString}`);
  }
  if (!ALLOWED_DOWNLOAD_HOSTS.includes(parsed.hostname)) {
    throw new ExtensionUpdateError("download_failed", `extension update rejected host drift: ${parsed.hostname}`);
  }
  return parsed;
}

async function fetchWithBoundedRedirects(
  url: string,
  { fetchImpl, signal, maxRedirects }: { fetchImpl: ExtensionUpdateFetch; signal: AbortSignal; maxRedirects: number },
): Promise<{ response: ExtensionUpdateFetchResponse; url: string }> {
  let current = url;
  const seen = new Set<string>();
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    assertAllowedUpdateUrl(current);
    if (seen.has(current)) throw new ExtensionUpdateError("download_failed", `extension update redirect loop at ${current}`);
    seen.add(current);
    const response = await fetchImpl(current, { signal, redirect: "manual" });
    const status = response.status;
    if (status >= 300 && status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new ExtensionUpdateError("download_failed", `extension update redirect ${status} missing Location from ${current}`);
      let next: string;
      try {
        next = new URL(location, current).href;
      } catch {
        throw new ExtensionUpdateError("download_failed", `extension update redirect is not a URL: ${location}`);
      }
      current = next;
      continue;
    }
    if (status !== 200) {
      throw new ExtensionUpdateError("source_unreachable", `extension update request failed: ${status} ${response.statusText || ""}`.trim());
    }
    return { response, url: current };
  }
  throw new ExtensionUpdateError("download_failed", `extension update exceeded ${maxRedirects} redirects`);
}

async function writeBodyToFile(
  response: ExtensionUpdateFetchResponse,
  destination: string,
  expectedBytes: number,
  mode: "pin" | "cap" = "pin",
): Promise<void> {
  let written = 0;
  const cleanup = async (): Promise<void> => { await rm(destination, { force: true }); };
  const tooLarge = (): ExtensionUpdateError =>
    new ExtensionUpdateError("size_mismatch", `extension artifact stream exceeded expected ${expectedBytes} bytes (got at least ${written})`);
  try {
    const webBody = response.body as import("node:stream/web").ReadableStream | undefined;
    if (webBody && typeof Readable.fromWeb === "function") {
      const input = Readable.fromWeb(webBody);
      const output = createWriteStream(destination);
      try {
        for await (const chunk of input) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBufferLike);
          written += buf.length;
          if (written > expectedBytes) {
            input.destroy();
            output.destroy();
            await cleanup();
            throw tooLarge();
          }
          if (!output.write(buf)) {
            await new Promise<void>((resolve, reject) => {
              output.once("drain", resolve);
              output.once("error", reject);
            });
          }
        }
        await new Promise<void>((resolve, reject) => output.end((err: Error | null) => (err ? reject(err) : resolve())));
      } catch (error) {
        output.destroy();
        throw error;
      }
    } else if (response.arrayBuffer) {
      const bytes = Buffer.from(await response.arrayBuffer());
      written = bytes.length;
      if (written > expectedBytes) {
        await cleanup();
        throw tooLarge();
      }
      await writeFile(destination, bytes);
    } else {
      throw new ExtensionUpdateError("download_failed", "extension update response carries no readable body");
    }
  } catch (error) {
    await cleanup();
    throw error;
  }
  if (mode === "cap" ? written > expectedBytes : written !== expectedBytes) {
    await cleanup();
    throw new ExtensionUpdateError("size_mismatch", `extension artifact size mismatch: expected ${expectedBytes}, got ${written}`);
  }
}

async function downloadToFile(
  url: string,
  destination: string,
  { fetchImpl, timeoutMs, expectedBytes, maxRedirects, label }: {
    fetchImpl: ExtensionUpdateFetch;
    timeoutMs: number;
    expectedBytes?: number;
    maxRedirects: number;
    label: string;
  },
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { response } = await fetchWithBoundedRedirects(url, { fetchImpl, signal: controller.signal, maxRedirects });
    if (expectedBytes !== undefined) {
      const length = response.headers.get("content-length");
      if (length !== null && length !== undefined && length !== "") {
        if (Number(length) !== expectedBytes) {
          throw new ExtensionUpdateError("size_mismatch", `${label} Content-Length mismatch: expected ${expectedBytes}, got ${length}`);
        }
      }
      await writeBodyToFile(response, destination, expectedBytes);
    } else {
      // Small bounded documents (asset index): cap instead of pin.
      await writeBodyToFile(response, destination, EXTENSION_UPDATE_INDEX_MAX_BYTES, "cap");
    }
  } catch (error) {
    await rm(destination, { force: true });
    if ((error as Error)?.name === "AbortError") {
      throw new ExtensionUpdateError("download_failed", `${label} download timed out after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Ported `replaceDir`: rename-aside backup, rename staging in, restore on failure. */
export async function replaceDirAtomic(staging: string, destination: string): Promise<void> {
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const backup = join(parent, `.previous-${basename(destination)}-${process.pid}-${Date.now()}`);
  let previous = false;
  try {
    try {
      await rename(destination, backup);
      previous = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
    try {
      await rename(staging, destination);
    } catch (error) {
      if (previous) await rename(backup, destination);
      throw error;
    }
    if (previous) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    try {
      if (previous) {
        const destStat = await stat(destination).catch(() => undefined);
        if (!destStat && (await stat(backup).catch(() => undefined))) await rename(backup, destination);
      }
    } catch {
      /* keep original error */
    }
    throw error;
  }
}

/** Ported `nativeArchitectures`: Mach-O / ELF / PE machine sniffing. */
export function nativeArchitectures(bytes: Buffer, platform: string): string[] {
  if (platform === "darwin" && bytes.length >= 8) {
    const cpuName = (value: number): string | undefined => (value === 0x01000007 ? "x64" : value === 0x0100000c ? "arm64" : undefined);
    if (bytes.readUInt32LE(0) === 0xfeedfacf) return [cpuName(bytes.readUInt32LE(4))].filter((v): v is string => Boolean(v));
    const magic = bytes.readUInt32BE(0);
    if ((magic === 0xcafebabe || magic === 0xcafebabf) && bytes.length >= 8) {
      const count = bytes.readUInt32BE(4);
      const stride = magic === 0xcafebabf ? 32 : 20;
      const values: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const offset = 8 + index * stride;
        if (offset + 4 > bytes.length) break;
        const name = cpuName(bytes.readUInt32BE(offset));
        if (name) values.push(name);
      }
      return values;
    }
  }
  if (platform === "linux" && bytes.length >= 20 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    const little = bytes[5] === 1;
    const machine = little ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18);
    return machine === 62 ? ["x64"] : machine === 183 ? ["arm64"] : [];
  }
  if (platform === "win32" && bytes.length >= 64 && bytes.subarray(0, 2).toString("ascii") === "MZ") {
    const peOffset = bytes.readUInt32LE(0x3c);
    if (peOffset + 6 <= bytes.length && bytes.subarray(peOffset, peOffset + 4).toString("binary") === "PE\0\0") {
      const machine = bytes.readUInt16LE(peOffset + 4);
      return machine === 0x8664 ? ["x64"] : machine === 0xaa64 ? ["arm64"] : [];
    }
  }
  return [];
}

/** Ported `extractArchive` (fetch-cua-driver): system tar/unzip, no runtime deps. */
export function defaultUnpackArchive(archivePath: string, stagingDir: string, archiveName: string): void {
  if (archiveName.endsWith(".zip")) {
    if (process.platform === "win32") {
      const extract = spawnSync("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${archivePath.replaceAll("'", "''")}' -DestinationPath '${stagingDir.replaceAll("'", "''")}' -Force`], { encoding: "utf8" });
      if (extract.status !== 0) throw new ExtensionUpdateError("unpack_failed", `failed to extract ${archiveName}`);
      return;
    }
    const unzip = spawnSync("unzip", ["-o", "-q", archivePath, "-d", stagingDir], { encoding: "utf8" });
    if (unzip.status === 0) return;
    const ditto = spawnSync("ditto", ["-x", "-k", archivePath, stagingDir], { encoding: "utf8" });
    if (ditto.status === 0) return;
    throw new ExtensionUpdateError("unpack_failed", `failed to extract ${archiveName}: need unzip or ditto on this host`);
  }
  if (!archiveName.endsWith(".tgz") && !archiveName.endsWith(".tar.gz")) {
    throw new ExtensionUpdateError("unpack_failed", `unsupported extension artifact format: ${archiveName}`);
  }
  const extract = spawnSync("tar", ["-xzf", archivePath, "-C", stagingDir], { encoding: "utf8" });
  if (extract.status !== 0) {
    throw new ExtensionUpdateError("unpack_failed", `failed to extract ${archiveName}: ${(extract.stderr || "").trim()}`);
  }
}

async function staleLockRecovery(lockDir: string, options: { now: () => number; pidAlive: (pid: number) => boolean; staleMs: number; initGraceMs: number }): Promise<void> {
  let entries: Array<{ name: string; isFile: boolean }> = [];
  try {
    entries = (await readdir(lockDir, { withFileTypes: true })).map(entry => ({ name: entry.name, isFile: entry.isFile() }));
  } catch {
    return;
  }
  if (entries.length === 0) {
    try {
      const st = await stat(lockDir);
      if (options.now() - st.mtimeMs >= options.initGraceMs) await rmdir(lockDir);
    } catch {
      /* raced with another recoverer */
    }
    return;
  }
  if (entries.length !== 1 || !entries[0].isFile || !EXTENSION_UPDATE_OWNER_FILE_RE.test(entries[0].name)) return;
  let owner: ReturnType<typeof parseOwnerBody>;
  try {
    owner = parseOwnerBody(await readFile(join(lockDir, entries[0].name), "utf8"));
  } catch {
    return;
  }
  if (!owner || owner.token !== entries[0].name.slice(0, -".owner".length)) return;
  if (options.pidAlive(owner.pid)) return;
  if (options.now() - owner.heartbeatMs < options.staleMs) return;
  try {
    await rm(join(lockDir, entries[0].name), { force: true });
    await rmdir(lockDir);
  } catch {
    /* another recoverer won the race */
  }
}

/** Ported `withLock`: atomic mkdir acquisition, single owner file, open-handle heartbeats. */
export async function withUpdateLock<T>(
  lockDir: string,
  options: {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    lockTimeoutMs?: number;
    heartbeatMs?: number;
    initGraceMs?: number;
    pidAlive?: (pid: number) => boolean;
    pid?: number;
    token?: string;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const lockTimeoutMs = options.lockTimeoutMs ?? EXTENSION_UPDATE_LOCK_STALE_MS;
  const heartbeatMs = options.heartbeatMs ?? EXTENSION_UPDATE_LOCK_HEARTBEAT_MS;
  const initGraceMs = options.initGraceMs ?? EXTENSION_UPDATE_LOCK_INIT_GRACE_MS;
  const pidAlive = options.pidAlive || isProcessAlive;
  const token = options.token && EXTENSION_UPDATE_OWNER_FILE_RE.test(`${options.token}.owner`) ? options.token : createOwnerToken();
  const pid = options.pid ?? process.pid;
  await mkdir(dirname(lockDir), { recursive: true });
  const ownerFile = join(lockDir, `${token}.owner`);
  const start = now();
  for (;;) {
    try {
      await mkdir(lockDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
      await staleLockRecovery(lockDir, { now, pidAlive, staleMs: lockTimeoutMs, initGraceMs });
      if (now() - start > lockTimeoutMs) {
        throw new ExtensionUpdateError("lock_timeout", `extension update lock timed out: ${lockDir}`);
      }
      await sleep(25);
      continue;
    }
    const startedAt = now();
    let owner: import("node:fs/promises").FileHandle | undefined;
    try {
      owner = await open(ownerFile, "wx");
      const first = Buffer.from(encodeOwner({ pid, token, startedAt, heartbeatMs: now() }));
      await owner.writeFile(first);
      await owner.truncate(first.length);
      const entries = await readdir(lockDir);
      if (entries.length !== 1 || entries[0] !== `${token}.owner`) throw new Error("lock directory changed under us");
    } catch (error) {
      await owner?.close().catch(() => undefined);
      await rm(ownerFile, { force: true }).catch(() => undefined);
      await rmdir(lockDir).catch(() => undefined);
      if (now() - start > lockTimeoutMs) {
        throw new ExtensionUpdateError("lock_timeout", `extension update lock init failed: ${(error as Error)?.message || error}`);
      }
      await sleep(25);
      continue;
    }
    let stopped = false;
    let currentSleep: { promise: Promise<void>; cancel: () => void } = { promise: Promise.resolve(), cancel: () => {} };
    const heart = (async (): Promise<void> => {
      while (!stopped) {
        let wake: () => void = () => {};
        const promise = new Promise<void>(resolve => { wake = resolve; });
        const timer = setTimeout(wake, heartbeatMs);
        currentSleep = { promise, cancel: () => { clearTimeout(timer); wake(); } };
        await promise;
        if (stopped) break;
        const buf = Buffer.from(encodeOwner({ pid, token, startedAt, heartbeatMs: now() }));
        try {
          await owner!.write(buf, 0, buf.length, 0);
          await owner!.truncate(buf.length);
        } catch {
          break;
        }
      }
    })();
    try {
      return await fn();
    } finally {
      stopped = true;
      currentSleep.cancel();
      await heart.catch(() => undefined);
      await owner!.close().catch(() => undefined);
      await rm(ownerFile, { force: true }).catch(() => undefined);
      await rmdir(lockDir).catch(() => undefined);
    }
  }
}

// ── Store layout ──

export type ExtensionSlotPointer = {
  contentHash: string;
  version: string;
  sha256: string;
  bytes?: number;
  platform?: string;
  arch?: string;
  updatedAt: string;
};

export type ExtensionInstallReceipt = ExtensionSlotPointer & {
  extensionId: string;
  source: ExtensionUpdateComponentSource | { type: "official" } | { type: "localProductPack"; packId: string };
  channel: "stable" | "local";
  signature: "ed25519" | "local";
  hostApi: string;
  installedAt: string;
};

export type ExtensionSlotSnapshot = {
  active?: ExtensionSlotPointer;
  previous?: ExtensionSlotPointer;
};

function assertExtensionId(id: string): string {
  if (typeof id !== "string" || !EXTENSION_ID_RE.test(id)) {
    throw new ExtensionUpdateError("invalid_input", `invalid extension id '${String(id)}'`);
  }
  return id;
}

function slotsDir(storeRoot: string, extensionId: string): string {
  return join(storeRoot, "extensions", assertExtensionId(extensionId));
}
function objectsRoot(storeRoot: string): string {
  return join(storeRoot, OBJECTS_DIRNAME);
}
function objectDirFor(storeRoot: string, contentHash: string): string {
  if (!/^[0-9a-f]{64}$/.test(contentHash)) throw new ExtensionUpdateError("invalid_input", `invalid content hash '${contentHash}'`);
  return join(storeRoot, OBJECTS_DIRNAME, contentHash);
}
function receiptPathFor(storeRoot: string, extensionId: string, contentHash: string): string {
  return join(slotsDir(storeRoot, extensionId), RECEIPTS_DIRNAME, `${contentHash}.json`);
}
function lockDirFor(storeRoot: string, extensionId: string): string {
  return join(storeRoot, LOCKS_DIRNAME, `${assertExtensionId(extensionId)}.lock`);
}
function tmpRoot(storeRoot: string): string {
  return join(storeRoot, TMP_DIRNAME);
}

async function writeJsonAtomic(path: string, body: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  try {
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Read a slot pointer; absent or corrupt (wrong shape / bad hash) reads as absent. */
export async function readExtensionSlot(storeRoot: string, extensionId: string, slot: "active" | "previous"): Promise<ExtensionSlotPointer | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(slotsDir(storeRoot, extensionId), slot === "active" ? ACTIVE_SLOT_FILENAME : PREVIOUS_SLOT_FILENAME), "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ExtensionSlotPointer>;
    if (typeof parsed.contentHash !== "string" || !/^[0-9a-f]{64}$/.test(parsed.contentHash)) return undefined;
    if (typeof parsed.version !== "string" || !parsed.version) return undefined;
    if (typeof parsed.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(parsed.sha256)) return undefined;
    if (typeof parsed.updatedAt !== "string" || !parsed.updatedAt) return undefined;
    const pointer: ExtensionSlotPointer = {
      contentHash: parsed.contentHash,
      version: parsed.version,
      sha256: parsed.sha256,
      updatedAt: parsed.updatedAt,
    };
    if (typeof parsed.bytes === "number") pointer.bytes = parsed.bytes;
    if (typeof parsed.platform === "string") pointer.platform = parsed.platform;
    if (typeof parsed.arch === "string") pointer.arch = parsed.arch;
    return pointer;
  } catch {
    return undefined;
  }
}

/** Capture both mutable slot pointers so a higher-level Product Pack transaction can restore them exactly. */
export async function readExtensionSlotSnapshot(storeRoot: string, extensionId: string): Promise<ExtensionSlotSnapshot> {
  const [active, previous] = await Promise.all([
    readExtensionSlot(storeRoot, extensionId, "active"),
    readExtensionSlot(storeRoot, extensionId, "previous"),
  ]);
  return {
    ...(active ? { active } : {}),
    ...(previous ? { previous } : {}),
  };
}

/** Restore a previously captured active/previous pair. Receipts and immutable objects intentionally remain durable. */
export async function restoreExtensionSlotSnapshot(
  storeRoot: string,
  extensionId: string,
  snapshot: ExtensionSlotSnapshot,
): Promise<void> {
  const root = slotsDir(storeRoot, extensionId);
  const active = join(root, ACTIVE_SLOT_FILENAME);
  const previous = join(root, PREVIOUS_SLOT_FILENAME);
  if (snapshot.previous) await writeJsonAtomic(previous, snapshot.previous);
  else await rm(previous, { force: true });
  if (snapshot.active) await writeJsonAtomic(active, snapshot.active);
  else await rm(active, { force: true });
}

export async function readExtensionReceipt(storeRoot: string, extensionId: string, contentHash: string): Promise<ExtensionInstallReceipt | undefined> {
  try {
    const parsed = JSON.parse(await readFile(receiptPathFor(storeRoot, extensionId, contentHash), "utf8")) as Partial<ExtensionInstallReceipt>;
    if (parsed.extensionId !== extensionId || parsed.contentHash !== contentHash) return undefined;
    return parsed as ExtensionInstallReceipt;
  } catch {
    return undefined;
  }
}

/**
 * Fallback chain: active slot → previous slot → App built-in recovery seed.
 * A pointer only counts when its content-addressed object still exists and
 * carries a readable manifest.
 */
export async function resolveActiveExtensionObject(input: {
  storeRoot: string;
  extensionId: string;
  seedRoot?: string;
}): Promise<{ objectDir: string; slot: "active" | "previous" | "seed" } | undefined> {
  const id = assertExtensionId(input.extensionId);
  for (const slot of ["active", "previous"] as const) {
    const pointer = await readExtensionSlot(input.storeRoot, id, slot);
    if (!pointer) continue;
    const dir = objectDirFor(input.storeRoot, pointer.contentHash);
    if (!(await exists(join(dir, MANIFEST_COPY_FILENAME)))) continue;
    try {
      const raw = await readFile(join(dir, MANIFEST_COPY_FILENAME), "utf8");
      if (input.seedRoot && (await readExtensionReceipt(input.storeRoot, id, pointer.contentHash))?.source?.type === "official") {
        const manifest = JSON.parse(raw);
        const seed = await readFile(join(input.seedRoot, id, MANIFEST_COPY_FILENAME), "utf8").catch(() => undefined);
        if (seed && (compareUpdateSemver(JSON.parse(seed).version, manifest.version) ?? 0) >= 0) continue;
      }
    } catch {
      continue;
    }
    return { objectDir: dir, slot };
  }
  if (input.seedRoot) {
    const seedDir = join(input.seedRoot, id);
    if (await exists(join(seedDir, EXTENSION_MANIFEST_FILENAME))) return { objectDir: seedDir, slot: "seed" };
  }
  return undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// ── Version discovery (Update Center 评估更新 entry, per component) ──

export type ExtensionUpdateCheckStatus = "updateAvailable" | "upToDate" | "notCheckable";
export type ExtensionUpdateCheck = {
  extensionId: string;
  status: ExtensionUpdateCheckStatus;
  currentVersion?: string;
  latestVersion?: string;
  source: ExtensionUpdateComponentSource;
  error?: string;
};

/**
 * Version discovery only — mirrors `createUpdateCenterService`'s fixed-endpoint
 * checks for one declared component. Never downloads artifacts or touches the
 * store. npm/pypi sources are checkable today but not yet transactional.
 */
export async function checkExtensionUpdate(input: {
  extensionId: string;
  source: ExtensionUpdateComponentSource;
  currentVersion?: string;
  fetchImpl?: ExtensionUpdateFetch;
  timeoutMs?: number;
}): Promise<ExtensionUpdateCheck> {
  const fetchImpl = input.fetchImpl ?? (globalThis.fetch as ExtensionUpdateFetch);
  const timeoutMs = input.timeoutMs ?? 8_000;
  assertExtensionId(input.extensionId);
  if (input.source.type === 'githubCommits') {
    return { extensionId: input.extensionId, status: 'notCheckable', currentVersion: input.currentVersion,
      source: input.source, error: 'Git 提交组件通过更新中心评估源码更新，不是可直接安装的扩展发布包' };
  }
  if (input.currentVersion !== undefined && !parseUpdateSemver(input.currentVersion)) {
    return { extensionId: input.extensionId, status: "notCheckable", currentVersion: input.currentVersion, source: input.source, error: "本机版本不是可识别的 SemVer" };
  }
  const url = input.source.type === "npm"
    ? `https://registry.npmjs.org/${encodeURIComponent(input.source.packageName)}`
    : input.source.type === "pypi"
      ? `https://pypi.org/pypi/${encodeURIComponent(input.source.packageName)}/json`
      : GITHUB_RELEASES_API(input.source.owner, input.source.repo);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: input.source.type === "githubReleases"
        ? { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }
        : { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`版本服务返回 HTTP ${response.status}`);
    const payload = response.json ? await response.json() : JSON.parse(Buffer.from(await response.arrayBuffer!()).toString("utf8"));
    let latest: string | undefined;
    if (input.source.type === "npm") {
      latest = (payload as { ["dist-tags"]?: Record<string, unknown> })?.["dist-tags"]?.latest as string | undefined;
    } else if (input.source.type === "pypi") {
      latest = (payload as { info?: { version?: unknown } })?.info?.version as string | undefined;
    } else {
      latest = latestGithubReleaseVersion(payload);
    }
    if (!latest || !parseUpdateSemver(latest)) throw new Error("版本服务返回了无法识别的数据");
    if (!input.currentVersion) {
      return { extensionId: input.extensionId, status: "updateAvailable", latestVersion: latest, source: input.source };
    }
    const precedence = compareUpdateSemver(latest, input.currentVersion);
    if (precedence === undefined) {
      return { extensionId: input.extensionId, status: "notCheckable", currentVersion: input.currentVersion, latestVersion: latest, source: input.source, error: "本机版本不是可识别的 SemVer" };
    }
    return {
      extensionId: input.extensionId,
      status: precedence > 0 ? "updateAvailable" : "upToDate",
      currentVersion: input.currentVersion,
      latestVersion: latest,
      source: input.source,
    };
  } catch (error) {
    return {
      extensionId: input.extensionId,
      status: "notCheckable",
      currentVersion: input.currentVersion,
      source: input.source,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── The update transaction ──

export type ExtensionUpdateRequest = {
  extensionId: string;
  /** Manifest `update.source` — the closed updateComponents union. */
  source: ExtensionUpdateComponentSource | { type: "official" };
  /** Explicit target; omitted → run discovery first and take the latest. */
  targetVersion?: string;
  currentVersion?: string;
  platform?: string;
  arch?: string;
};

export type ExtensionUpdateEngineOptions = {
  /** App-profile shared store root (never a global ~/.pi path, never per-project). */
  storeRoot: string;
  /** Bundled runtime extensions root — the recovery seed fallback. */
  seedRoot?: string;
  fetchImpl?: ExtensionUpdateFetch;
  /** Host-pinned official ed25519 public key. Required: first version ships signed packages only. */
  signingPublicKey?: string | Buffer | import("node:crypto").KeyObject;
  /** Injectable unpacker (default: system tar/unzip). */
  unpackArchive?: (archivePath: string, stagingDir: string, archiveName: string) => void | Promise<void>;
  /** Post-switch activation verification seam; throw to force slot rollback. */
  activateHook?: (installed: { extensionId: string; contentHash: string; version: string; objectDir: string }) => void | Promise<void>;
  timeoutMs?: number;
  maxRedirects?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  lockTimeoutMs?: number;
  heartbeatMs?: number;
  initGraceMs?: number;
  pidAlive?: (pid: number) => boolean;
  pid?: number;
  token?: string;
};

export type ExtensionUpdateResult = {
  extensionId: string;
  version: string;
  contentHash: string;
  objectDir: string;
  receiptPath: string;
  previousContentHash?: string;
  /** True when discovery found the active version already current (no state change). */
  skipped?: boolean;
};

function releaseAssetUrl(baseUrl: string, entry: ExtensionUpdateAssetEntry): string {
  const url = `${baseUrl.replace(/\/$/, "")}/${entry.asset}`;
  if (url.includes("/latest")) throw new ExtensionUpdateError("asset_index_invalid", `refusing mutable extension asset URL: ${url}`);
  return url;
}

/** Locate the package root (dir containing pipiui-extension.json) after unpack. */
export async function findPackageRoot(stagingDir: string): Promise<string> {
  if (await exists(join(stagingDir, EXTENSION_MANIFEST_FILENAME))) return stagingDir;
  const entries = await readdir(stagingDir, { withFileTypes: true });
  const dirs = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith("."));
  const files = entries.filter(entry => entry.isFile());
  if (dirs.length === 1 && files.length === 0) {
    const nested = join(stagingDir, dirs[0].name);
    if (await exists(join(nested, EXTENSION_MANIFEST_FILENAME))) return nested;
  }
  throw new ExtensionUpdateError("manifest_invalid", `unpacked extension artifact has no ${EXTENSION_MANIFEST_FILENAME} at its package root`);
}

async function fetchReleaseDocument(
  source: Extract<ExtensionUpdateComponentSource, { type: "githubReleases" }>,
  options: { fetchImpl: ExtensionUpdateFetch; timeoutMs: number; maxRedirects: number },
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const { response } = await fetchWithBoundedRedirects(GITHUB_RELEASES_API(source.owner, source.repo), {
      fetchImpl: options.fetchImpl,
      signal: controller.signal,
      maxRedirects: options.maxRedirects,
    });
    if (!response.json) return undefined;
    return await response.json();
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new ExtensionUpdateError("source_unreachable", `extension release discovery timed out after ${options.timeoutMs}ms`);
    }
    if (error instanceof ExtensionUpdateError) throw error;
    throw new ExtensionUpdateError("source_unreachable", `extension release discovery failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Full update transaction. Everything runs under the per-extension lock;
 * every failure before the slot switch leaves the store exactly as it was,
 * and an activation failure rolls the active slot back (previous slot and
 * receipts persist).
 */
export async function applyExtensionUpdate(request: ExtensionUpdateRequest, options: ExtensionUpdateEngineOptions): Promise<ExtensionUpdateResult> {
  const extensionId = assertExtensionId(request.extensionId);
  const storeRoot = options.storeRoot;
  if (typeof storeRoot !== "string" || storeRoot.length < 2) {
    throw new ExtensionUpdateError("invalid_input", "extension update storeRoot must be an explicit absolute path");
  }
  const platform = request.platform || process.platform;
  const arch = request.arch || process.arch;
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as ExtensionUpdateFetch);
  const timeoutMs = options.timeoutMs ?? EXTENSION_UPDATE_DOWNLOAD_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? EXTENSION_UPDATE_MAX_REDIRECTS;
  const now = options.now || Date.now;
  const unpackArchive = options.unpackArchive ?? defaultUnpackArchive;

  if (request.source.type !== "githubReleases" && request.source.type !== "official") {
    throw new ExtensionUpdateError("unsupported_source", `extension artifact updates for source type '${request.source.type}' are not supported yet; first version ships official GitHub-release packages only`);
  }
  const source = request.source;

  return withUpdateLock(lockDirFor(storeRoot, extensionId), options, async () => {
    // 1. Version discovery (the 更新中心 评估更新 entry, reused for this component).
    let targetVersion = request.targetVersion;
    if (!targetVersion) {
      if (source.type === "official") throw new ExtensionUpdateError("invalid_input", "official update requires a published version");
      const check = await checkExtensionUpdate({ extensionId, source, currentVersion: request.currentVersion, fetchImpl, timeoutMs: Math.min(timeoutMs, 8_000) });
      if (check.status !== "updateAvailable" || !check.latestVersion) {
        return {
          extensionId,
          version: check.latestVersion ?? request.currentVersion ?? "",
          contentHash: "",
          objectDir: "",
          receiptPath: "",
          skipped: true,
        };
      }
      targetVersion = check.latestVersion;
    }
    if (request.currentVersion && targetVersion === request.currentVersion) {
      return { extensionId, version: targetVersion, contentHash: "", objectDir: "", receiptPath: "", skipped: true };
    }

    // 2. Release document → asset index.
    const scratch = await mkdtemp(join(tmpdir(), `pipiui-extupdate-${extensionId}-`));
    await mkdir(tmpRoot(storeRoot), { recursive: true });
    const staging = await mkdtemp(join(tmpRoot(storeRoot), `staging-${extensionId}-`));
    try {
      let indexUrl: string;
      let releaseAssets: { name: string; url: string }[] = [];
      if (source.type === "official") {
        if (!parseUpdateSemver(targetVersion)) throw new ExtensionUpdateError("invalid_input", "invalid official version");
        const active = await readExtensionSlot(storeRoot, extensionId, "active");
        if ([active?.version, request.currentVersion].some(version => version && (compareUpdateSemver(targetVersion!, version) ?? 0) <= 0)) {
          throw new ExtensionUpdateError("invalid_input", "插件已更新，请刷新版本列表");
        }
        indexUrl = `https://pipi.aichattrpg.com/downloads/${extensionId}-${targetVersion}-assets.json`;
      } else {
        const releases = await fetchReleaseDocument(source, { fetchImpl, timeoutMs, maxRedirects });
        const release = releaseForVersion(releases, targetVersion);
        const asset = release?.assets.find(asset => asset.name === `${extensionId}-assets.json`);
        if (!asset) throw new ExtensionUpdateError("asset_index_invalid", `release ${targetVersion} carries no ${extensionId}-assets.json`);
        releaseAssets = release!.assets;
        indexUrl = asset.url;
      }
      assertAllowedUpdateUrl(indexUrl);
      const indexFile = join(scratch, "assets-index.json");
      await downloadToFile(indexUrl, indexFile, { fetchImpl, timeoutMs, maxRedirects, label: "extension asset index" });
      let indexJson: unknown;
      try {
        indexJson = JSON.parse(await readFile(indexFile, "utf8"));
      } catch (error) {
        throw new ExtensionUpdateError("asset_index_invalid", `extension asset index is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
      const index = parseAssetIndex(indexJson, targetVersion);
      const entry = index.assets[`${platform}-${arch}`]
        ?? index.assets[platform === "darwin" ? "darwin-universal" : `${platform}-${arch}`];
      if (!entry) {
        throw new ExtensionUpdateError("asset_index_invalid", `no pinned extension asset for ${platform}-${arch}`);
      }

      // 3. Download the artifact to scratch (bounded redirects, byte cap).
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.asset)) throw new ExtensionUpdateError("asset_index_invalid", "invalid asset filename");
      if (source.type === "official" && index.baseUrl !== "https://pipi.aichattrpg.com/downloads") throw new ExtensionUpdateError("asset_index_invalid", "unexpected official asset origin");
      const artifactUrl = releaseAssetUrl(index.baseUrl, entry);
      assertAllowedUpdateUrl(artifactUrl);
      const releaseAsset = releaseAssets.find(asset => asset.name === entry.asset);
      if (releaseAsset) assertAllowedUpdateUrl(releaseAsset.url);
      const artifactUrlFinal = releaseAsset?.url ?? artifactUrl;
      const partial = join(scratch, entry.asset);
      await downloadToFile(artifactUrlFinal, partial, { fetchImpl, timeoutMs, expectedBytes: entry.bytes, maxRedirects, label: `extension artifact ${entry.asset}` });
      const st = await lstat(partial);
      if (st.isSymbolicLink()) throw new ExtensionUpdateError("download_failed", `downloaded extension artifact is a symlink: ${partial}`);
      if (st.size !== entry.bytes) {
        throw new ExtensionUpdateError("size_mismatch", `extension artifact size mismatch for ${entry.asset}: expected ${entry.bytes}, got ${st.size}`);
      }

      // 4. Verify: SHA-256, official ed25519 signature (no unsigned path).
      const bytes = await readFile(partial);
      const actualHash = sha256Hex(bytes);
      if (actualHash !== entry.sha256) {
        throw new ExtensionUpdateError("hash_mismatch", `extension artifact checksum mismatch for ${entry.asset}: expected ${entry.sha256}, got ${actualHash}`);
      }
      if (!options.signingPublicKey) {
        throw new ExtensionUpdateError("signature_invalid", "no official signing public key configured; refusing unsigned extension artifact");
      }
      if (!entry.signature) {
        throw new ExtensionUpdateError("signature_invalid", `extension artifact ${entry.asset} carries no ed25519 signature`);
      }
      let signatureOk = false;
      try {
        signatureOk = cryptoVerify(null, bytes, options.signingPublicKey, Buffer.from(entry.signature, "base64"));
      } catch {
        signatureOk = false;
      }
      if (!signatureOk) {
        throw new ExtensionUpdateError("signature_invalid", `extension artifact ${entry.asset} failed official signature verification`);
      }
      const contentHash = actualHash;

      // 5. Unpack to staging, then architecture-sniff any declared native binary.
      const unpackStaging = join(staging, "unpack");
      await mkdir(unpackStaging, { recursive: true });
      await unpackArchive(partial, unpackStaging, entry.asset);
      const packageRoot = await findPackageRoot(unpackStaging);
      if (entry.nativeExecutable) {
        const nativePath = join(packageRoot, entry.nativeExecutable);
        let nativeBytes: Buffer;
        try {
          nativeBytes = await readFile(nativePath);
        } catch {
          throw new ExtensionUpdateError("arch_mismatch", `declared native binary missing from package: ${entry.nativeExecutable}`);
        }
        const architectures = nativeArchitectures(nativeBytes, platform);
        if (!architectures.includes(arch) || architectures.length !== 1) {
          throw new ExtensionUpdateError("arch_mismatch", `extension native binary is ${architectures.join("+") || "unrecognized"}, expected single-arch ${arch}`);
        }
      }

      // 6. hostApi compatibility against the contract manifest (consumes
      //    contract-scaffold's manifest contract: id + required hostApi range).
      let manifestText: string;
      try {
        manifestText = await readFile(join(packageRoot, EXTENSION_MANIFEST_FILENAME), "utf8");
      } catch (error) {
        throw new ExtensionUpdateError("manifest_invalid", `extension package manifest is unreadable: ${error instanceof Error ? error.message : String(error)}`);
      }
      const parsed = parseExtensionManifestJson(manifestText);
      if (!parsed.ok) {
        throw new ExtensionUpdateError("manifest_invalid", `extension package manifest is invalid: ${parsed.errors.join("; ")}`);
      }
      if (parsed.manifest.id !== extensionId) {
        throw new ExtensionUpdateError("id_mismatch", `extension package manifest id '${parsed.manifest.id}' does not match requested '${extensionId}'`);
      }
      if (parsed.manifest.version !== targetVersion) {
        throw new ExtensionUpdateError("manifest_invalid", `extension package manifest version '${parsed.manifest.version}' does not match target ${targetVersion}`);
      }
      if (!parsed.manifest.hostApi) {
        throw new ExtensionUpdateError("host_api_incompatible", `extension package manifest declares no hostApi range`);
      }
      if (!satisfiesExtensionHostApiRange(parsed.manifest.hostApi, EXTENSION_HOST_API_VERSION)) {
        throw new ExtensionUpdateError(
          "host_api_incompatible",
          `extension ${extensionId} ${parsed.manifest.version} requires hostApi ${parsed.manifest.hostApi}, host is ${EXTENSION_HOST_API_VERSION}`,
        );
      }

      // 7. Promote into the content-addressed store (immutable object).
      const objectDir = objectDirFor(storeRoot, contentHash);
      if (!(await exists(join(objectDir, MANIFEST_COPY_FILENAME)))) {
        const promoteStaging = join(staging, "promote", contentHash);
        await mkdir(dirname(promoteStaging), { recursive: true });
        await rename(packageRoot, promoteStaging);
        await mkdir(objectsRoot(storeRoot), { recursive: true });
        try {
          await rename(promoteStaging, objectDir);
        } catch (error) {
          if (!(await exists(join(objectDir, MANIFEST_COPY_FILENAME)))) throw error;
        }
      }

      // 8. Receipt first (persistent install record), then the slot switch.
      const receipt: ExtensionInstallReceipt = {
        extensionId,
        version: parsed.manifest.version,
        contentHash,
        sha256: entry.sha256,
        bytes: entry.bytes,
        platform,
        arch,
        source: request.source,
        channel: "stable",
        signature: "ed25519",
        hostApi: parsed.manifest.hostApi,
        installedAt: new Date(now()).toISOString(),
        updatedAt: new Date(now()).toISOString(),
      };
      const receiptPath = receiptPathFor(storeRoot, extensionId, contentHash);
      await writeJsonAtomic(receiptPath, receipt);

      // 9. Atomic slot switch: previous ← old active, active ← new (single renames).
      const oldActive = await readExtensionSlot(storeRoot, extensionId, "active");
      const oldPrevious = await readExtensionSlot(storeRoot, extensionId, "previous");
      const pointer: ExtensionSlotPointer = {
        contentHash,
        version: parsed.manifest.version,
        sha256: entry.sha256,
        bytes: entry.bytes,
        platform,
        arch,
        updatedAt: new Date(now()).toISOString(),
      };
      if (oldActive) await writeJsonAtomic(join(slotsDir(storeRoot, extensionId), PREVIOUS_SLOT_FILENAME), oldActive);
      await writeJsonAtomic(join(slotsDir(storeRoot, extensionId), ACTIVE_SLOT_FILENAME), pointer);

      // 10. Activation verification (injectable). On failure roll the slots
      //     back to their exact pre-transaction shape; receipts persist.
      try {
        if (options.activateHook) {
          await options.activateHook({ extensionId, contentHash, version: parsed.manifest.version, objectDir });
        } else {
          const reread = await readExtensionSlot(storeRoot, extensionId, "active");
          if (!reread || reread.contentHash !== contentHash) {
            throw new ExtensionUpdateError("activation_failed", "active slot did not persist the new pointer");
          }
          const manifest = await readFile(join(objectDir, MANIFEST_COPY_FILENAME), "utf8");
          const check = parseExtensionManifestJson(manifest);
          if (!check.ok || check.manifest.id !== extensionId) {
            throw new ExtensionUpdateError("activation_failed", "activated object failed post-switch manifest verification");
          }
        }
      } catch (error) {
        if (oldActive) await writeJsonAtomic(join(slotsDir(storeRoot, extensionId), ACTIVE_SLOT_FILENAME), oldActive);
        else await rm(join(slotsDir(storeRoot, extensionId), ACTIVE_SLOT_FILENAME), { force: true });
        if (oldPrevious) await writeJsonAtomic(join(slotsDir(storeRoot, extensionId), PREVIOUS_SLOT_FILENAME), oldPrevious);
        else await rm(join(slotsDir(storeRoot, extensionId), PREVIOUS_SLOT_FILENAME), { force: true });
        if (error instanceof ExtensionUpdateError) throw error;
        throw new ExtensionUpdateError("activation_failed", `extension activation failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      return {
        extensionId,
        version: parsed.manifest.version,
        contentHash,
        objectDir,
        receiptPath,
        ...(oldActive ? { previousContentHash: oldActive.contentHash } : {}),
      };
    } finally {
      await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}

export type LocalExtensionPackageInstallRequest = {
  /** Extension identity declared by the enclosing Product Pack. */
  extensionId: string;
  /** Absolute directory containing `pipiui-extension.json`; never an archive or symlink. */
  sourceDirectory: string;
  /** Semantic Product Pack identity recorded in the local receipt. */
  packId: string;
};

export type LocalExtensionPackageInstallResult = ExtensionUpdateResult & {
  bytes: number;
};

/**
 * Hash a package tree after it has entered our staging directory. The digest is
 * over type, normalized relative path, byte length, and bytes, so two identical
 * directories share one immutable object regardless of their original location.
 * Symlinks and non-regular filesystem nodes are rejected before promotion.
 */
async function hashRegularPackageTree(root: string): Promise<{ contentHash: string; bytes: number }> {
  const digest = createHash("sha256");
  let bytes = 0;
  const walk = async (directory: string, relativeDirectory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const rel = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const info = await lstat(path);
      if (info.isSymbolicLink()) {
        throw new ExtensionUpdateError("invalid_input", `local extension package contains a symlink: ${rel}`);
      }
      if (info.isDirectory()) {
        digest.update(`d\0${rel}\0`);
        await walk(path, rel);
        continue;
      }
      if (!info.isFile()) {
        throw new ExtensionUpdateError("invalid_input", `local extension package contains a non-regular entry: ${rel}`);
      }
      const file = await readFile(path);
      bytes += file.byteLength;
      digest.update(`f\0${rel}\0${file.byteLength}\0`);
      digest.update(file);
    }
  };
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new ExtensionUpdateError("invalid_input", "local extension package must be a real directory");
  }
  digest.update("pipiui-local-extension-package-v1\0");
  await walk(root, "");
  return { contentHash: digest.digest("hex"), bytes };
}

/**
 * Install an explicitly user-selected local package into the same
 * content-addressed store used by official updates. Local packages are clearly
 * receipted as local and may not carry native resources; signed, arch-specific
 * artifacts remain the official update-engine path.
 */
export async function installLocalExtensionPackage(
  request: LocalExtensionPackageInstallRequest,
  options: Pick<ExtensionUpdateEngineOptions, "storeRoot" | "now" | "lockTimeoutMs" | "heartbeatMs" | "initGraceMs" | "pidAlive" | "pid" | "token">,
): Promise<LocalExtensionPackageInstallResult> {
  const extensionId = assertExtensionId(request.extensionId);
  const packId = assertExtensionId(request.packId);
  if (!isAbsolute(request.sourceDirectory)) {
    throw new ExtensionUpdateError("invalid_input", "local extension package sourceDirectory must be absolute");
  }
  const storeRoot = options.storeRoot;
  if (typeof storeRoot !== "string" || !isAbsolute(storeRoot)) {
    throw new ExtensionUpdateError("invalid_input", "extension update storeRoot must be an explicit absolute path");
  }
  let sourceRoot: string;
  try {
    const sourceInfo = await lstat(request.sourceDirectory);
    if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
      throw new ExtensionUpdateError("invalid_input", "local extension package must be a real directory");
    }
    sourceRoot = await realpath(request.sourceDirectory);
  } catch (error) {
    if (error instanceof ExtensionUpdateError) throw error;
    throw new ExtensionUpdateError("invalid_input", `local extension package is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  return withUpdateLock(lockDirFor(storeRoot, extensionId), options, async () => {
    await mkdir(tmpRoot(storeRoot), { recursive: true });
    const staging = await mkdtemp(join(tmpRoot(storeRoot), `local-${extensionId}-`));
    try {
      const stagedPackage = join(staging, "package");
      await cp(sourceRoot, stagedPackage, { recursive: true, dereference: false, force: false, errorOnExist: true });
      const { contentHash, bytes } = await hashRegularPackageTree(stagedPackage);
      const manifestPath = join(stagedPackage, EXTENSION_MANIFEST_FILENAME);
      let manifestText: string;
      try {
        manifestText = await readFile(manifestPath, "utf8");
      } catch (error) {
        throw new ExtensionUpdateError("manifest_invalid", `local extension package manifest is unreadable: ${error instanceof Error ? error.message : String(error)}`);
      }
      const parsed = parseExtensionManifestJson(manifestText);
      if (!parsed.ok) {
        throw new ExtensionUpdateError("manifest_invalid", `local extension package manifest is invalid: ${parsed.errors.join("; ")}`);
      }
      if (parsed.manifest.id !== extensionId) {
        throw new ExtensionUpdateError("id_mismatch", `local extension package id '${parsed.manifest.id}' does not match Product Pack entry '${extensionId}'`);
      }
      if (!parsed.manifest.hostApi) {
        throw new ExtensionUpdateError("host_api_incompatible", `local extension ${extensionId} declares no hostApi range`);
      }
      if (!satisfiesExtensionHostApiRange(parsed.manifest.hostApi, EXTENSION_HOST_API_VERSION)) {
        throw new ExtensionUpdateError(
          "host_api_incompatible",
          `local extension ${extensionId} ${parsed.manifest.version} requires hostApi ${parsed.manifest.hostApi}, host is ${EXTENSION_HOST_API_VERSION}`,
        );
      }
      if (parsed.manifest.nativeResources?.length) {
        throw new ExtensionUpdateError("arch_mismatch", "local Product Pack extensions with nativeResources must use the signed official artifact path");
      }

      const objectDir = objectDirFor(storeRoot, contentHash);
      if (!(await exists(join(objectDir, MANIFEST_COPY_FILENAME)))) {
        const promote = join(staging, "promote", contentHash);
        await mkdir(dirname(promote), { recursive: true });
        await rename(stagedPackage, promote);
        await mkdir(objectsRoot(storeRoot), { recursive: true });
        try {
          await rename(promote, objectDir);
        } catch (error) {
          if (!(await exists(join(objectDir, MANIFEST_COPY_FILENAME)))) throw error;
        }
      }

      const now = options.now ?? Date.now;
      const receiptPath = receiptPathFor(storeRoot, extensionId, contentHash);
      if (!(await readExtensionReceipt(storeRoot, extensionId, contentHash))) {
        await writeJsonAtomic(receiptPath, {
          extensionId,
          version: parsed.manifest.version,
          contentHash,
          sha256: contentHash,
          bytes,
          source: { type: "localProductPack", packId },
          channel: "local",
          signature: "local",
          hostApi: parsed.manifest.hostApi,
          installedAt: new Date(now()).toISOString(),
          updatedAt: new Date(now()).toISOString(),
        } satisfies ExtensionInstallReceipt);
      }

      const oldActive = await readExtensionSlot(storeRoot, extensionId, "active");
      const pointer: ExtensionSlotPointer = {
        contentHash,
        version: parsed.manifest.version,
        sha256: contentHash,
        bytes,
        updatedAt: new Date(now()).toISOString(),
      };
      if (oldActive) await writeJsonAtomic(join(slotsDir(storeRoot, extensionId), PREVIOUS_SLOT_FILENAME), oldActive);
      await writeJsonAtomic(join(slotsDir(storeRoot, extensionId), ACTIVE_SLOT_FILENAME), pointer);

      return {
        extensionId,
        version: parsed.manifest.version,
        contentHash,
        objectDir,
        receiptPath,
        bytes,
        ...(oldActive ? { previousContentHash: oldActive.contentHash } : {}),
      };
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}

/** Convenience for callers assembling store/seed roots from a pi-agent home. */
export function extensionUpdateRoots(input: { agentDir: string; runtimeRoot?: string }): { storeRoot: string; seedRoot?: string } {
  return {
    storeRoot: extensionUpdateStoreRoot(input.agentDir),
    ...(input.runtimeRoot ? { seedRoot: join(input.runtimeRoot, "extensions") } : {}),
  };
}
