#!/usr/bin/env node
/**
 * Sync compiled DeepSeek extension halves into the Bundled runtime extensions tree.
 *
 * Mirrors Electron/scripts/sync-bundled-extension.mjs (the grok postbuild path):
 * clean dest → copy package metadata + compiled agent/app dist.
 *
 * Usage: node scripts/postbuild.mjs
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, "..");
const electronRoot = resolve(packageDir, "../..");
const dest = join(electronRoot, "resources", "runtime", "extensions", "deepseek");

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const file of ["pipiui-extension.json", "package.json", "README.md"]) {
  if (existsSync(join(packageDir, file))) cpSync(join(packageDir, file), join(dest, file));
}
for (const half of ["agent", "app"]) {
  const distDir = join(packageDir, half, "dist");
  if (existsSync(distDir)) cpSync(distDir, join(dest, half, "dist"), { recursive: true });
}

console.log(`postbuild: deepseek-extension -> resources/runtime/extensions/deepseek`);
