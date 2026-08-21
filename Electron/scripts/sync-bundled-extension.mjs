#!/usr/bin/env node
/**
 * Sync a built workspace extension package into the Bundled runtime extensions tree
 * (spec D10: builtin = Bundled runtime `extensions/` synced by runtime-install).
 *
 * The runtime tree ships compiled `dist/` halves for manifest extensions; the package
 * source tree keeps its TypeScript. This script is the only path that copies one into
 * the other, so the single-source rule holds: never hand-edit the runtime copy.
 *
 * Usage: node scripts/sync-bundled-extension.mjs [packageDirName]
 *   packageDirName defaults to grok-build-oauth-extension (id from its manifest).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(here, "..");

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
const appEntries = [
  ...(manifest.app?.ui?.panels ?? []).map((p) => p.entry),
  ...(manifest.app?.ui?.toolRenderers ?? []).map((r) => r.entry),
  ...(manifest.app?.ui?.settingsSections ?? []).map((s) => s.entry),
].filter((entry) => typeof entry === "string" && entry.length > 0);

// Every declared entry must be built before the runtime copy is refreshed.
for (const entry of [agentEntry, ...appEntries]) {
  if (!entry) continue;
  if (!existsSync(join(packageDir, entry))) {
    console.error(`sync-bundled-extension: missing build artifact ${entry}; run the package build first`);
    process.exit(1);
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

for (const entry of [agentEntry, ...appEntries]) {
  if (!entry) continue;
  if (!existsSync(join(dest, entry))) {
    console.error(`sync-bundled-extension: runtime copy is missing ${entry}`);
    process.exit(1);
  }
}
console.log(`sync-bundled-extension: ${packageDirName} -> resources/runtime/extensions/${id}`);
