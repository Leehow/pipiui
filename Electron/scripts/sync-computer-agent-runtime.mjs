#!/usr/bin/env node
import { cp, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const electronRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(electronRoot, "..");
const sourceRoot = join(repoRoot, "Sources", "PipiUI", "PiExt");
const runtimeRoot = join(electronRoot, "resources", "runtime", "pi-ext");
const philosophySourceRoot = join(repoRoot, "Sources", "PipiUI", "PiPhilosophy");
const philosophyRuntimeRoot = join(electronRoot, "resources", "runtime", "pi-philosophy");
const mirrors = [
  ...[
  // Electron owns resources/runtime/pi-ext/subagent. Sources/PipiUI/PiExt is
  // the frozen Swift-app mirror and must not overwrite the default product
  // during normal Electron dev/build/test preparation.
  "agents/operator/AGENT.md",
  "agents/computer-use-leader/AGENT.md",
  "agents/computer-verifier/AGENT.md",
  "agents/computer-terminal/AGENT.md",
  "packages/computer-agent",
  ].map((relative) => ({ sourceRoot, runtimeRoot, relative })),
  ...[
    "layers/30-orchestration.md",
    "capabilities.json",
  ].map((relative) => ({ sourceRoot: philosophySourceRoot, runtimeRoot: philosophyRuntimeRoot, relative })),
];

async function checkCuaContract() {
  const [assetsText, skillText] = await Promise.all([
    readFile(join(electronRoot, "cua-driver-assets.json"), "utf8"),
    readFile(join(sourceRoot, "packages/computer-agent/skills/cua-driver-operation/SKILL.md"), "utf8"),
  ]);
  const assetsVersion = JSON.parse(assetsText).version;
  const skillVersion = skillText.match(/cua-driver-version:\s*["']?([^"'\s]+)["']?/)?.[1];
  if (!assetsVersion || !skillVersion || assetsVersion !== skillVersion) {
    throw new Error(`Computer Agent Cua skill/driver contract mismatch (skill=${skillVersion ?? "missing"}, driver=${assetsVersion ?? "missing"})`);
  }
}

async function filesUnder(root, relative = "") {
  const target = join(root, relative);
  const metadata = await stat(target);
  if (metadata.isFile()) return [relative];
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(target, { withFileTypes: true });
  const nested = await Promise.all(entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => filesUnder(root, join(relative, entry.name))));
  return nested.flat();
}

async function checkPath({ sourceRoot, runtimeRoot, relative }) {
  const sourceFiles = await filesUnder(sourceRoot, relative);
  const runtimeFiles = await filesUnder(runtimeRoot, relative).catch(() => []);
  if (sourceFiles.join("\n") !== runtimeFiles.join("\n")) return false;
  for (const file of sourceFiles) {
    const [source, runtime] = await Promise.all([
      readFile(join(sourceRoot, file)),
      readFile(join(runtimeRoot, file)).catch(() => undefined),
    ]);
    if (!runtime || !source.equals(runtime)) return false;
  }
  return true;
}

if (process.argv.includes("--check")) {
  await checkCuaContract();
  const results = await Promise.all(mirrors.map(checkPath));
  if (results.some((result) => !result)) {
    throw new Error("Electron Computer Agent runtime is stale; run npm run sync:computer-agent");
  }
  console.log("Computer Agent runtime mirror is current.");
} else {
  await checkCuaContract();
  for (const { sourceRoot, runtimeRoot, relative } of mirrors) {
    const destination = join(runtimeRoot, relative);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(sourceRoot, relative), destination, { recursive: true, force: true });
  }
  console.log("Synchronized shared Computer Agent into Electron runtime resources.");
}
