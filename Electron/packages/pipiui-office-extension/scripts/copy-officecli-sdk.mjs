#!/usr/bin/env node
/** Copy the pinned @officecli/sdk CJS entry next to agent/dist so the runtime
 *  extension tree does not depend on workspace node_modules.
 *
 *  The upstream SDK spawnCli() does not accept per-spawn env and inherits
 *  process.env. Patch the bundled copy so every CLI subprocess gets
 *  OFFICECLI_SKIP_UPDATE=1, and disable install() so a packaged App cannot
 *  reach the official installer. */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const require = createRequire(join(pkgRoot, "package.json"));
const src = require.resolve("@officecli/sdk");
const destDir = join(pkgRoot, "agent/dist");
mkdirSync(destDir, { recursive: true });

const original = readFileSync(src, "utf8");
const spawnNeedle = "const opts = { encoding: 'utf8', ...extraOpts };";
if (original.split(spawnNeedle).length !== 2) {
  throw new Error("copy-officecli-sdk: @officecli/sdk spawnCli opts assignment changed; refuse to copy an unpatched SDK");
}
let patched = original.replace(
  spawnNeedle,
  `${spawnNeedle}
  // PipiUI: OfficeCLI subprocesses must not self-update or download.
  opts.env = Object.assign({}, process.env, opts.env || {}, { OFFICECLI_SKIP_UPDATE: '1' });`,
);
const exportNeedle = "module.exports = { open, create, install, Document, OfficeCliError, pipePaths };";
if (!patched.includes(exportNeedle)) {
  throw new Error("copy-officecli-sdk: @officecli/sdk exports changed; refuse to copy");
}
patched = patched.replace(
  exportNeedle,
  `function pipiuiDisabledInstall() {
  throw new Error('PipiUI disables @officecli/sdk install(); OfficeCLI binaries are checksum-pinned by fetch-officecli-binary.mjs');
}
module.exports = { open, create, install: pipiuiDisabledInstall, Document, OfficeCliError, pipePaths };`,
);
writeFileSync(join(destDir, "officecli-sdk.cjs"), patched);
