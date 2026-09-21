import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../vendor/sandbox-runtime/", import.meta.url));
const lockBytes = readFileSync(join(root, "package-lock.json"));
const lock = JSON.parse(lockBytes);
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (manifest.dependencies["@anthropic-ai/sandbox-runtime"] !== "0.0.77"
  || lock.packages["node_modules/@anthropic-ai/sandbox-runtime"].version !== "0.0.77") throw new Error("Sandbox runtime must remain pinned to 0.0.77");
const digest = createHash("sha256").update(lockBytes).digest("hex");
const stamp = join(root, "node_modules", ".pipiui-lock-digest");
const installed = () => {
  try {
    if (readFileSync(stamp, "utf8") !== digest) return false;
    return Object.entries(lock.packages).filter(([path]) => path).every(([path, entry]) =>
      JSON.parse(readFileSync(join(root, path, "package.json"), "utf8")).version === entry.version)
      && existsSync(join(root, "node_modules/@anthropic-ai/sandbox-runtime/LICENSE"))
      && existsSync(join(root, "node_modules/@anthropic-ai/sandbox-runtime/dist/index.js"));
  } catch { return false; }
};
if (!installed()) {
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--omit=dev", "--ignore-scripts", "--bin-links=false", "--maxsockets=3", "--workspaces=false"], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Sandbox dependency preparation failed: ${result.error?.message ?? result.status}`);
  writeFileSync(stamp, digest);
  console.log("experiment-lab: prepared pinned sandbox-runtime 0.0.77");
} else console.log("experiment-lab: pinned sandbox dependencies unchanged");
