import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { resolvePiExecutable } from "../src/spawn-assembly.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A directory holding an executable named `pi`, as a PATH entry would. */
async function binDir(...segments: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-exe-"));
  roots.push(root);
  const dir = join(root, ...segments);
  await mkdir(dir, { recursive: true });
  const pi = join(dir, "pi");
  await writeFile(pi, "#!/bin/sh\nexit 0\n");
  await chmod(pi, 0o755);
  return dir;
}

describe("resolvePiExecutable", () => {
  it("ignores a package-local pi, which a transitive dependency owns rather than the user", async () => {
    // `pi-mcp-extension` depends on the pre-rename pi at `*`, so npm installs an old build and
    // gives it `node_modules/.bin/pi` — first on PATH under every `npm run` script.
    const packageLocal = await binDir("node_modules", ".bin");
    const real = await binDir("usr", "local", "bin");
    expect(resolvePiExecutable({ PATH: [packageLocal, real].join(delimiter) })).toBe(join(real, "pi"));
  });

  it("ignores it at any depth, including a workspace's nested install", async () => {
    const nested = await binDir("apps", "electron", "node_modules", "some-pkg", "bin");
    const real = await binDir("opt", "bin");
    expect(resolvePiExecutable({ PATH: [nested, real].join(delimiter) })).toBe(join(real, "pi"));
  });

  it("still prefers the first ordinary PATH entry", async () => {
    const first = await binDir("first");
    const second = await binDir("second");
    expect(resolvePiExecutable({ PATH: [first, second].join(delimiter) })).toBe(join(first, "pi"));
  });

  it("falls back to the bare name rather than a package-local pi", async () => {
    // A real ENOENT names the problem; silently running the wrong Pi hides it.
    const packageLocal = await binDir("node_modules", ".bin");
    expect(resolvePiExecutable({ PATH: packageLocal })).not.toContain("node_modules");
  });

  it("tolerates an absent PATH", () => {
    expect(() => resolvePiExecutable({})).not.toThrow();
  });
});
