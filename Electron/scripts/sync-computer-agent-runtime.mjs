#!/usr/bin/env node
// History: this script mirrored shared Computer Agent files from the Swift app
// (Sources/PipiUI/PiExt) into the Electron runtime. The Swift app has been
// retired, so resources/runtime/pi-ext is now the single source of truth and
// there is nothing left to sync. The script keeps its npm-script wiring
// (predev/prebuild/pretest) purely to enforce the Cua driver contract.
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const electronRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = join(electronRoot, "resources", "runtime", "pi-ext");

async function checkCuaContract() {
  const [assetsText, skillText] = await Promise.all([
    readFile(join(electronRoot, "cua-driver-assets.json"), "utf8"),
    readFile(join(runtimeRoot, "packages/computer-agent/skills/cua-driver-operation/SKILL.md"), "utf8"),
  ]);
  const assetsVersion = JSON.parse(assetsText).version;
  const skillVersion = skillText.match(/cua-driver-version:\s*["']?([^"'\s]+)["']?/)?.[1];
  if (!assetsVersion || !skillVersion || assetsVersion !== skillVersion) {
    throw new Error(`Computer Agent Cua skill/driver contract mismatch (skill=${skillVersion ?? "missing"}, driver=${assetsVersion ?? "missing"})`);
  }
}

await checkCuaContract();
console.log("Computer Agent runtime contract OK.");
