#!/usr/bin/env node
/**
 * Pack a bundled extension package into the official release artifact consumed
 * by the extension update transaction (`applyExtensionUpdate`).
 *
 * Office release-chain pattern, applied to extension packages:
 *   - the artifact targets ONE fixed release (an immutable `releases/download/<tag>` base URL;
 *     mutable `/latest` URLs are refused, mirroring the engine's own refusal),
 *   - SHA-256 + exact bytes are pinned per platform key in `<extensionId>-assets.json`,
 *   - every artifact is optionally signed with the official ed25519 private key
 *     (base64 signature over the raw artifact bytes; the host verifies with
 *     `PIPIUI_EXTENSION_UPDATE_PUBLIC_KEY` — first version ships signed packages only),
 *   - the index is written atomically (tmp + rename) and any failure leaves no
 *     partial index behind; publishing the release itself is a single immutable
 *     GitHub action, so a failed upload is retried, never half-published.
 *
 * The engine unpacks tar.gz/zip and requires `pipiui-extension.json` at the
 * package root (directly or inside one top-level directory), so the artifact is
 * a plain `tar -czf` of the extension directory.
 *
 * Usage:
 *   node scripts/pack-extension-release.mjs <extensionDir> --version <x.y.z> \
 *     --base-url https://github.com/<owner>/<repo>/releases/download/v<x.y.z> \
 *     [--out <dir>] [--signing-key <ed25519 private key PEM path>]
 *
 * Output: `<out>/<extensionId>-assets.json` plus `<extensionId>-<version>.tar.gz`.
 * The printed JSON receipt (extensionId, version, artifact, bytes, sha256) is
 * the release-process record.
 */
import { createHash, createPrivateKey, sign as cryptoSign } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, lutimesSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));

function fail(message) {
  console.error(`pack-extension-release: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const named = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--version") named.version = argv[++i];
    else if (arg === "--base-url") named.baseUrl = argv[++i];
    else if (arg === "--out") named.out = argv[++i];
    else if (arg === "--signing-key") named.signingKey = argv[++i];
    else positional.push(arg);
  }
  return { positional, named };
}

const { positional, named } = parseArgs(process.argv.slice(2));
const extensionDir = positional[0] ? resolve(positional[0]) : undefined;
if (!extensionDir || !named.version || !named.baseUrl) {
  fail("usage: pack-extension-release.mjs <extensionDir> --version <x.y.z> --base-url <immutable release URL> [--out <dir>] [--signing-key <pem>]");
}
if (named.baseUrl.includes("/latest")) {
  fail(`refusing mutable release URL: ${named.baseUrl}`);
}

const manifestPath = join(extensionDir, "pipiui-extension.json");
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  fail(`unreadable extension manifest at ${manifestPath}: ${error.message}`);
}
const extensionId = manifest.id;
if (typeof extensionId !== "string" || !/^[a-z][a-z0-9-]*$/.test(extensionId)) {
  fail(`invalid extension id ${JSON.stringify(extensionId)}`);
}
if (manifest.version !== named.version) {
  fail(`manifest version ${manifest.version} does not match --version ${named.version}`);
}

// Deterministic-enough artifact: sorted names, fixed mtime, no junk files.
const staging = mkdtempSync(join(tmpdir(), `pipiui-pack-${extensionId}-`));
const packageRoot = join(staging, "package", extensionId);
const artifactName = `${extensionId}-${named.version}.tar.gz`;
const artifactPath = join(staging, artifactName);
let bytes;
try {
  rmSync(packageRoot, { recursive: true, force: true });
  mkdirSync(dirname(packageRoot), { recursive: true });
  cpSync(extensionDir, packageRoot, {
    recursive: true,
    filter: (source) => {
      const name = basename(source);
      return name !== ".DS_Store" && name !== "pipiui-host-receipt.json" && name !== ".git";
    },
  });
  // A retry of the same release must produce the same signed bytes.
  const files = [];
  const add = (name, directory) => {
    const path = join(staging, "package", name);
    files.push(name);
    if (directory) {
      const entries = readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      for (const entry of entries) add(name + "/" + entry.name, entry.isDirectory());
    }
    lutimesSync(path, 0, 0);
  };
  add(extensionId, true);
  const rawArchive = join(staging, "package.tar");
  const tar = spawnSync("tar", ["-cf", rawArchive, "-C", join(staging, "package"), "--no-recursion", "--null", "-T", "-"], {
    input: files.join("\0") + "\0", encoding: "utf8", env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  if (tar.status !== 0) fail(`tar failed: ${(tar.stderr || "").trim()}`);
  await pipeline(createReadStream(rawArchive), createGzip(), createWriteStream(artifactPath));
  bytes = readFileSync(artifactPath);
} catch (error) {
  rmSync(staging, { recursive: true, force: true });
  fail(`packing failed: ${error.message}`);
}

const sha256 = createHash("sha256").update(bytes).digest("hex");
const entry = {
  asset: artifactName,
  bytes: bytes.byteLength,
  sha256,
};

if (named.signingKey) {
  let privateKey;
  try {
    privateKey = createPrivateKey(readFileSync(named.signingKey, "utf8"));
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    fail(`unreadable signing key: ${error.message}`);
  }
  try {
    entry.signature = cryptoSign(null, bytes, privateKey).toString("base64");
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    fail(`signing failed (is the key an ed25519 private key?): ${error.message}`);
  }
}

// The package is pure JS/TS: one universal artifact serves every platform key
// the update engine probes (`<platform>-<arch>`, with `darwin-universal` as the
// darwin fallback). Native resources (e.g. the Cua driver) stay separate
// App-provided resources and are never baked into the artifact.
const assets = {};
for (const key of [
  "darwin-universal", "darwin-arm64", "darwin-x64",
  "linux-arm64", "linux-x64",
  "win32-arm64", "win32-x64",
]) {
  assets[key] = { ...entry };
}

const index = {
  version: named.version,
  baseUrl: named.baseUrl.replace(/\/$/, ""),
  assets,
};

const outDir = named.out ? resolve(named.out) : process.cwd();
const indexPath = join(outDir, `${extensionId}-assets.json`);
try {
  mkdirSync(outDir, { recursive: true });
  const tmp = join(outDir, `.${extensionId}-assets.json.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(index, null, 2)}\n`);
  renameSync(tmp, indexPath); // atomic index publish; failure leaves the previous index intact
} catch (error) {
  rmSync(staging, { recursive: true, force: true });
  fail(`index publish failed: ${error.message}`);
}

const keptArtifact = join(outDir, artifactName);
try {
  rmSync(keptArtifact, { force: true });
  renameSync(artifactPath, keptArtifact);
} catch (error) {
  rmSync(staging, { recursive: true, force: true });
  fail(`artifact publish failed: ${error.message}`);
}
rmSync(staging, { recursive: true, force: true });

console.log(JSON.stringify({
  extensionId,
  version: named.version,
  artifact: keptArtifact,
  bytes: entry.bytes,
  sha256,
  signed: Boolean(entry.signature),
  index: indexPath,
}, null, 2));
