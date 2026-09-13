#!/usr/bin/env node
/**
 * Sync compiled Flapcode extension halves into the Bundled runtime extensions tree.
 *
 * Mirrors packages/deepseek-extension/scripts/postbuild.mjs:
 * clean dest → copy package metadata + compiled agent dist.
 *
 * Usage: node scripts/postbuild.mjs
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, "..");
const electronRoot = resolve(packageDir, "../..");
const dest = join(electronRoot, "resources", "runtime", "extensions", "flapcode");

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const file of ["pipiui-extension.json", "package.json", "README.md"]) {
  if (existsSync(join(packageDir, file))) cpSync(join(packageDir, file), join(dest, file));
}
const distDir = join(packageDir, "agent", "dist");
if (existsSync(distDir)) cpSync(distDir, join(dest, "agent", "dist"), { recursive: true });

console.log(`postbuild: flapcode-extension -> resources/runtime/extensions/flapcode`);
