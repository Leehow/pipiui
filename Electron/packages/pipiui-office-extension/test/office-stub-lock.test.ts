// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const electronRoot = join(pkgRoot, "../..");
const stubDir = join(pkgRoot, "vendor/officecli-cli-stub");

function officecliNodes(lock: Record<string, unknown>): Array<[string, Record<string, unknown>]> {
  const packages = (lock.packages ?? {}) as Record<string, Record<string, unknown>>;
  return Object.entries(packages).filter(([key]) => key.includes("@officecli/officecli"));
}

describe("officecli stub lock and fresh install", () => {
  it("workspace lock has no nested real @officecli/officecli install script or tarball", () => {
    const lock = JSON.parse(readFileSync(join(electronRoot, "package-lock.json"), "utf8")) as Record<string, unknown>;
    const nodes = officecliNodes(lock);
    expect(nodes.length).toBeGreaterThan(0);
    for (const [key, node] of nodes) {
      expect(node.hasInstallScript, key).toBeUndefined();
      const resolved = String(node.resolved ?? "");
      expect(resolved).not.toMatch(/registry\.npmjs\.org\/@officecli\/officecli/);
      expect(resolved).not.toMatch(/officecli-1\.0\.144\.tgz/);
      if (node.version) expect(String(node.version)).toBe("1.0.144");
    }
    const stubPkg = JSON.parse(readFileSync(join(stubDir, "package.json"), "utf8")) as { version: string; scripts?: unknown };
    expect(stubPkg.version).toBe("1.0.144");
    expect(stubPkg.scripts).toBeUndefined();
  });

  it("fresh npm install with the stub override does not run upstream postinstall/download", async () => {
    const dir = await mkdtemp(join(tmpdir(), "office-stub-install-"));
    try {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify(
          {
            name: "office-stub-probe",
            private: true,
            dependencies: { "@officecli/sdk": "0.1.2" },
            overrides: { "@officecli/officecli": `file:${stubDir}` },
          },
          null,
          2,
        ),
      );
      const result = spawnSync("npm", ["install", "--maxsockets", "3", "--ignore-scripts=false"], {
        cwd: dir,
        encoding: "utf8",
        timeout: 120_000,
        env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
      });
      expect(result.status, result.stderr || result.stdout).toBe(0);
      const lock = JSON.parse(await readFile(join(dir, "package-lock.json"), "utf8")) as Record<string, unknown>;
      for (const [key, node] of officecliNodes(lock)) {
        expect(node.hasInstallScript, key).toBeUndefined();
        expect(String(node.resolved ?? "")).not.toMatch(/registry\.npmjs\.org\/@officecli\/officecli/);
      }
      expect(existsSync(join(dir, "node_modules/@officecli/officecli/install.js"))).toBe(false);
      const stub = JSON.parse(await readFile(join(dir, "node_modules/@officecli/officecli/package.json"), "utf8")) as {
        version: string;
      };
      expect(stub.version).toBe("1.0.144");
      const stubMod = createRequire(join(dir, "package.json"))("@officecli/officecli") as {
        binaryPath: () => unknown;
        ensureBinary: () => Promise<unknown>;
      };
      expect(stubMod.binaryPath()).toBeNull();
      await expect(stubMod.ensureBinary()).rejects.toThrow(/auto-download/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
