import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MANAGED_PACKAGES, type ManagedPackage } from "./spawn-assembly.js";

/**
 * App-owned, version-pinned npm installs for the two extensions pi does not ship in this
 * repository (`pi-web-access`, `pi-mcp-extension`). Node translation of Swift
 * `ManagedNpmPackage` + `WebAccessPackage.ensureInstalled`.
 *
 * Installed under the runtime root's own `managed-npm/` prefix, never into `~/.pi` or a global
 * npm prefix, so a PipiUI feature stays scoped to sessions this host launches.
 */

export type ManagedInstall = { package: string; state: "installed" | "present" | "skipped" | "failed"; detail?: string };

/**
 * A package the user registered with pi themselves must not also be mounted through `-e`: pi
 * would load the same extension twice. Not installing it is what keeps it unmounted, since
 * `resolveSpawnPaths` only mounts what is actually on disk.
 */
export function globallyRegistered(pkg: string, settingsPath: string = join(homedir(), ".pi", "agent", "settings.json")): boolean {
  try {
    const packages = JSON.parse(readFileSync(settingsPath, "utf8"))?.packages;
    if (!Array.isArray(packages)) return false;
    return packages.some((entry: unknown) => {
      const source = typeof entry === "string" ? entry : (entry as { source?: unknown } | null)?.source;
      return typeof source === "string" && (source === pkg || source.startsWith(`${pkg}@`) || source.endsWith(`/${pkg}`));
    });
  } catch { return false }
}

/** Same reasoning as `resolvePiExecutable`: a Finder-launched app inherits a minimal PATH. */
export function resolveNpmExecutable(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const fromPath = (env.PATH ?? "").split(":").filter(Boolean).map(dir => join(dir, "npm"));
  return [...fromPath, "/opt/homebrew/bin/npm", "/usr/local/bin/npm", "/usr/bin/npm"]
    .find(candidate => { try { accessSync(candidate, constants.X_OK); return true } catch { return false } });
}

const installedVersion = (dir: string, pkg: string): string | undefined => {
  try { return JSON.parse(readFileSync(join(dir, "node_modules", pkg, "package.json"), "utf8")).version } catch { return undefined }
};

const runNpm = (npm: string, args: string[]) => new Promise<{ status: number; detail: string }>(resolve => {
  const child = spawn(npm, args, { stdio: ["ignore", "pipe", "pipe"] });
  let detail = "";
  child.stdout.on("data", chunk => { detail += String(chunk) });
  child.stderr.on("data", chunk => { detail += String(chunk) });
  child.on("error", error => resolve({ status: -1, detail: error.message }));
  child.on("close", status => resolve({ status: status ?? -1, detail: detail.slice(-2000) }));
});

/** Injected in tests so no test ever reaches the real npm or the network. */
export type ManagedNpmDeps = {
  env?: NodeJS.ProcessEnv;
  settingsPath?: string;
  resolveNpm?: (env: NodeJS.ProcessEnv) => string | undefined;
  run?: (npm: string, args: string[]) => Promise<{ status: number; detail: string }>;
};

/**
 * Bring one pinned package up on disk. `npm install --prefix` rather than `npm pack` so every
 * generated file — lockfile, metadata, transitive deps — stays inside this app-owned tree.
 */
export async function ensureManagedPackage(
  entry: ManagedPackage,
  runtimeRoot: string,
  deps: ManagedNpmDeps = {}
): Promise<ManagedInstall> {
  const { name, version } = entry;
  const env = deps.env ?? process.env;
  if (globallyRegistered(name, deps.settingsPath)) return { package: name, state: "skipped", detail: "registered in ~/.pi/agent/settings.json" };
  const dir = join(runtimeRoot, "managed-npm", `${name}-${version}`);
  if (installedVersion(dir, name) === version) return { package: name, state: "present" };
  const npm = (deps.resolveNpm ?? resolveNpmExecutable)(env);
  if (!npm) return { package: name, state: "failed", detail: "npm is unavailable on PATH" };
  try { mkdirSync(dir, { recursive: true }) } catch (error) { return { package: name, state: "failed", detail: String(error) } }
  const result = await (deps.run ?? runNpm)(npm, ["install", "--prefix", dir, `${name}@${version}`]);
  if (result.status !== 0) return { package: name, state: "failed", detail: `exit ${result.status}: ${result.detail}` };
  if (!existsSync(join(dir, "node_modules", name, "package.json")))
    return { package: name, state: "failed", detail: "npm reported success but the package is not on disk" };
  return { package: name, state: "installed" };
}

/**
 * Deliberately async and never awaited by app startup: this is the one install step that needs
 * the network, and a slow registry must not delay the first window. `resolveSpawnPaths` runs per
 * spawn, so a package that lands late is mounted by the next session rather than lost.
 */
export async function ensureManagedPackages(runtimeRoot: string, deps: ManagedNpmDeps = {}): Promise<ManagedInstall[]> {
  return Promise.all(MANAGED_PACKAGES.map(entry => ensureManagedPackage(entry, runtimeRoot, deps)));
}
