#!/usr/bin/env node
/**
 * Sync a built workspace extension package into the Bundled runtime extensions tree
 * (spec D10: builtin = Bundled runtime `extensions/` synced by runtime-install).
 *
 * The runtime tree ships compiled `dist/` halves for manifest extensions; the package
 * source tree keeps its TypeScript. This script is the only path that copies one into
 * the other, so the single-source rule holds: never hand-edit the runtime copy.
 *
 * Reproducible receipts: rebuilding with unchanged manifest/files/host hashes rewrites
 * the previous `pipiui-host-receipt.json` byte-for-byte (generatedAt preserved), so
 * consecutive syncs produce zero diff. generatedAt only moves when the synced content
 * actually changes. When SOURCE_DATE_EPOCH (integer seconds since the Unix epoch, the
 * reproducible-builds convention) is set, it — not the wall clock — determines the
 * timestamp stamped onto freshly written receipts.
 *
 * Usage: node scripts/sync-bundled-extension.mjs [packageDirName]
 *   packageDirName defaults to grok-build-oauth-extension (id from its manifest).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RECEIPT_NAME = "pipiui-host-receipt.json";

const here = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(here, "..");

/**
 * Resolve SOURCE_DATE_EPOCH (reproducible-builds convention: integer seconds
 * since the Unix epoch) into milliseconds. Malformed or out-of-range values
 * fail the sync loudly instead of silently falling back to the wall clock,
 * which would smuggle nondeterminism into a "reproducible" build.
 */
function sourceDateEpochMs() {
  const raw = process.env.SOURCE_DATE_EPOCH;
  if (raw === undefined || raw.trim() === "") return undefined;
  if (!/^\d+$/.test(raw.trim())) {
    console.error(`sync-bundled-extension: SOURCE_DATE_EPOCH must be integer seconds since epoch, got ${JSON.stringify(raw)}`);
    process.exit(1);
  }
  const ms = Number(raw) * 1000;
  if (!Number.isSafeInteger(ms) || !Number.isFinite(new Date(ms).getTime())) {
    console.error(`sync-bundled-extension: SOURCE_DATE_EPOCH out of representable range: ${raw}`);
    process.exit(1);
  }
  return ms;
}

const sourceDateEpoch = sourceDateEpochMs();

/**
 * Deterministic digest of a synced tree: every file's relative posix path
 * (sorted, code-unit order) plus its sha256, folded into one hash. The
 * receipt itself is excluded (it is written after this runs and carries the
 * timestamp), so this covers exactly the manifest + files + host entry bytes
 * that ship.
 */
function hashTree(root) {
  const files = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), entryRel);
      else if (entry.isFile()) files.push(entryRel);
    }
  };
  walk(root, "");
  files.sort();
  const hash = createHash("sha256");
  for (const rel of files) {
    hash.update(rel);
    hash.update("\0");
    hash.update(createHash("sha256").update(readFileSync(join(root, rel))).digest("hex"));
    hash.update("\n");
  }
  return hash.digest("hex");
}

const packageDirName = process.argv[2] ?? "grok-build-oauth-extension";
const packageDir = join(electronRoot, "packages", packageDirName);
const manifestPath = join(packageDir, "pipiui-extension.json");
if (!existsSync(manifestPath)) {
  console.error(`sync-bundled-extension: missing manifest at ${manifestPath}`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const id = manifest.id;
if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error(`sync-bundled-extension: invalid extension id ${JSON.stringify(id)}`);
  process.exit(1);
}

const dest = join(electronRoot, "resources", "runtime", "extensions", id);
const agentEntry = manifest.agent?.extension;
const hostEntry = typeof manifest.host?.entry === "string" ? manifest.host.entry : undefined;
const appEntries = [
  ...(manifest.app?.ui?.panels ?? []).map((p) => p.entry),
  ...(manifest.app?.ui?.toolRenderers ?? []).map((r) => r.entry),
  ...(manifest.app?.ui?.settingsSections ?? []).map((s) => s.entry),
].filter((entry) => typeof entry === "string" && entry.length > 0);

// Every declared entry must be built before the runtime copy is refreshed.
for (const entry of [agentEntry, hostEntry, ...appEntries]) {
  if (!entry) continue;
  if (!existsSync(join(packageDir, entry))) {
    console.error(`sync-bundled-extension: missing build artifact ${entry}; run the package build first`);
    process.exit(1);
  }
}

// Snapshot the previous receipt (exact bytes + parsed) before the tree is
// rebuilt, so an unchanged rebuild can rewrite it byte-for-byte.
const receiptPath = join(dest, RECEIPT_NAME);
let previousReceiptBytes = null;
let previousReceipt = null;
if (existsSync(receiptPath)) {
  previousReceiptBytes = readFileSync(receiptPath);
  try {
    previousReceipt = JSON.parse(previousReceiptBytes.toString("utf8"));
  } catch {
    previousReceipt = null;
  }
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const file of ["pipiui-extension.json", "package.json", "README.md"]) {
  if (existsSync(join(packageDir, file))) cpSync(join(packageDir, file), join(dest, file));
}
for (const half of ["agent", "app"]) {
  const distDir = join(packageDir, half, "dist");
  if (existsSync(distDir)) cpSync(distDir, join(dest, half, "dist"), { recursive: true });
}

for (const entry of [agentEntry, hostEntry, ...appEntries]) {
  if (!entry) continue;
  if (!existsSync(join(dest, entry))) {
    console.error(`sync-bundled-extension: runtime copy is missing ${entry}`);
    process.exit(1);
  }
}

// Host receipt: pin the declared host library entry's content hash so a
// cross-host resolver (pi-coc) can verify both hosts consume the same build
// artifact byte-for-byte (spec §D1). Written next to the manifest. The
// contentHash digest additionally pins the whole synced tree (manifest +
// files + host entry) so receipt freshness is a pure function of content.
if (hostEntry) {
  const hostFile = join(dest, hostEntry);
  if (!existsSync(hostFile)) {
    console.error(`sync-bundled-extension: runtime copy is missing host entry ${hostEntry}`);
    process.exit(1);
  }
  const hostBytes = readFileSync(hostFile);
  const next = {
    version: 1,
    extensionId: id,
    manifestVersion: manifest.version,
    hostEntry,
    sha256: createHash("sha256").update(hostBytes).digest("hex"),
    bytes: hostBytes.byteLength,
    contentHash: hashTree(dest),
  };
  const unchanged =
    previousReceipt !== null &&
    typeof previousReceipt === "object" &&
    previousReceipt.version === 1 &&
    previousReceipt.extensionId === next.extensionId &&
    previousReceipt.manifestVersion === next.manifestVersion &&
    previousReceipt.hostEntry === next.hostEntry &&
    previousReceipt.sha256 === next.sha256 &&
    previousReceipt.bytes === next.bytes &&
    previousReceipt.contentHash === next.contentHash &&
    typeof previousReceipt.generatedAt === "string" &&
    previousReceipt.generatedAt.trim().length > 0;

  if (unchanged && sourceDateEpoch === undefined) {
    // Manifest/files/host hashes all match the previous receipt: rewrite the
    // exact previous bytes so the rebuilt tree is byte-identical and the
    // recorded generatedAt is preserved.
    writeFileSync(receiptPath, previousReceiptBytes);
    console.log(`sync-bundled-extension: ${packageDirName} -> resources/runtime/extensions/${id} (receipt unchanged, generatedAt preserved)`);
  } else {
    // Content (or receipt schema) changed, or SOURCE_DATE_EPOCH explicitly
    // pins the timestamp: stamp freshly.
    const generatedAt = new Date(sourceDateEpoch ?? Date.now()).toISOString();
    writeFileSync(receiptPath, `${JSON.stringify({ ...next, generatedAt }, null, 2)}\n`);
    console.log(`sync-bundled-extension: ${packageDirName} -> resources/runtime/extensions/${id} (receipt refreshed)`);
  }
} else {
  console.log(`sync-bundled-extension: ${packageDirName} -> resources/runtime/extensions/${id}`);
}
