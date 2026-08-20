#!/usr/bin/env node
/** Stable repository-root entrypoint for the deterministic memory eval. */
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evaluator = join(root, "Electron/resources/runtime/pi-ext/packages/memory-broker/scripts/eval-memory.ts");

async function main() {
  try { await access(evaluator); } catch { throw new Error(`Memory eval CLI is missing: ${evaluator}`); }
  const child = spawn(process.execPath, ["--experimental-strip-types", evaluator, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  });
  const code = await new Promise((resolveChild, reject) => {
    child.once("error", reject);
    child.once("exit", (value, signal) => resolveChild(value ?? (signal ? 1 : 0)));
  });
  process.exitCode = code;
}
main().catch((error) => {
  process.stderr.write(`Memory eval wrapper failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
