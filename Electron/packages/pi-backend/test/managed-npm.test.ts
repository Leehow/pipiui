import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureManagedPackage, globallyRegistered, resolveNpmExecutable } from "../src/managed-npm.js";
import { MANAGED_PACKAGES, resolveSpawnPaths } from "../src/spawn-assembly.js";

const temp = () => mkdtemp(join(tmpdir(), "managed-npm-"));
const web = MANAGED_PACKAGES[0];

/** Lays out exactly what `resolveSpawnPaths` looks for, so both halves are checked against one shape. */
async function seedPackage(root: string, name: string, version: string): Promise<void> {
  const dir = join(root, "managed-npm", `${name}-${version}`, "node_modules", name);
  await mkdir(join(dir, "dist"), { recursive: true });
  await writeFile(join(dir, "dist", "index.js"), "//\n");
  await writeFile(join(dir, "package.json"), JSON.stringify({ name, version, pi: { extensions: ["./dist/index.js"] } }));
}

describe("ensureManagedPackage", () => {
  it("treats an already-installed pinned version as present without invoking npm", async () => {
    const root = await temp();
    try {
      await seedPackage(root, web.name, web.version);
      const npmIsForbidden = async () => { throw new Error("npm must not run when the pinned version is already installed") };
      expect(await ensureManagedPackage(web, root, { run: npmIsForbidden })).toEqual({ package: web.name, state: "present" });
      // The mount lookup finds the same tree the installer just accepted.
      expect(resolveSpawnPaths(root).webSearch).toBe(join(root, "managed-npm", `${web.name}-${web.version}`, "node_modules", web.name, "dist", "index.js"));
    } finally { await rm(root, { recursive: true, force: true }) }
  });

  it("declines to install a package the user already registered with pi", async () => {
    const root = await temp();
    try {
      const settings = join(root, "settings.json");
      await writeFile(settings, JSON.stringify({ packages: [`${web.name}@0.19.0`] }));
      expect(globallyRegistered(web.name, settings)).toBe(true);
      expect(globallyRegistered("pi-mcp-extension", settings)).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }) }
  });

  it("reports a missing npm instead of leaving an unexplained gap in the mounted extensions", async () => {
    const root = await temp();
    try {
      const result = await ensureManagedPackage(web, root, { resolveNpm: () => undefined });
      expect(result).toEqual({ package: web.name, state: "failed", detail: "npm is unavailable on PATH" });
    } finally { await rm(root, { recursive: true, force: true }) }
  });

  it("installs the pinned version and refuses to claim success when npm writes nothing", async () => {
    const root = await temp();
    try {
      const args: string[][] = [];
      const failed = await ensureManagedPackage(web, root, {
        resolveNpm: () => "/usr/bin/npm",
        run: async (_npm, given) => { args.push(given); return { status: 0, detail: "" } }
      });
      expect(args[0]).toEqual(["install", "--prefix", join(root, "managed-npm", `${web.name}-${web.version}`), `${web.name}@${web.version}`]);
      expect(failed.state).toBe("failed");
      expect(failed.detail).toContain("not on disk");

      const installed = await ensureManagedPackage(web, root, {
        resolveNpm: () => "/usr/bin/npm",
        run: async () => { await seedPackage(root, web.name, web.version); return { status: 0, detail: "" } }
      });
      expect(installed).toEqual({ package: web.name, state: "installed" });
    } finally { await rm(root, { recursive: true, force: true }) }
  });

  it("finds npm even when PATH is the minimal set a Finder launch inherits", () => {
    expect(resolveNpmExecutable({ PATH: "/usr/bin:/bin" })).toBeTypeOf("string");
  });

  it("treats unreadable or package-less pi settings as not registered", async () => {
    const root = await temp();
    try {
      await writeFile(join(root, "empty.json"), "{}");
      expect(globallyRegistered(web.name, join(root, "empty.json"))).toBe(false);
      expect(globallyRegistered(web.name, join(root, "absent.json"))).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }) }
  });
});
