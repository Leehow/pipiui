import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { installRuntimeTree } from "../src/runtime-install.js";

it("loads the real zvec native package from the installed mirror in a fresh Node process", async () => {
  const root = await mkdtemp(join(tmpdir(), "runtime-zvec-native-"));
  try {
    const source = join(root, "source"), destination = join(root, "installed");
    for (const dir of ["pi-core-prompt", "pi-ext", "pi-philosophy", "built-in-skills", "pi-goal", "profiles", "extensions/code-retrieval/agent/dist"]) {
      await mkdir(join(source, dir), { recursive: true });
    }
    const ext = join(source, "extensions", "code-retrieval");
    const dependencies = fileURLToPath(new URL("../../../resources/runtime/extensions/code-retrieval/node_modules/", import.meta.url));
    await mkdir(join(ext, "node_modules"));
    // These are the same production dependency trees selected by electron-builder.
    // Materialize links so a green import cannot secretly resolve back to the checkout.
    for (const name of ["@zvec", "detect-libc"]) {
      await cp(join(dependencies, name), join(ext, "node_modules", name), { recursive: true, dereference: true });
    }
    await writeFile(join(ext, "agent/dist/probe.mjs"), [
      'import * as zvec from "@zvec/zvec";',
      'import { realpathSync } from "node:fs";',
      'import { fileURLToPath } from "node:url";',
      'console.log(JSON.stringify({ resolved: realpathSync(fileURLToPath(import.meta.resolve("@zvec/zvec"))), openType: typeof zvec.ZVecOpen, arch: process.arch, node: process.version }));',
    ].join("\n") + "\n");
    await writeFile(join(source, "pipiui-runtime-manifest.json"), JSON.stringify({
      schemaVersion: 1, bundledExtensions: ["code-retrieval"], includeAnydoc: false,
    }));

    const report = installRuntimeTree({ sourceRoot: source }, destination);
    expect(report.failures).toEqual([]);
    const installed = join(destination, "extensions", "code-retrieval");
    const run = spawnSync(process.execPath, [join(installed, "agent/dist/probe.mjs")], {
      cwd: root,
      env: { PATH: process.env.PATH ?? "", HOME: root, TMPDIR: root, NODE_PATH: "", ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8", timeout: 15000,
    });
    expect(run.error).toBeUndefined();
    expect(run.signal, run.stderr).toBeNull();
    expect(run.status, run.stderr).toBe(0);
    const result = JSON.parse(run.stdout.trim());
    expect(result.openType).toBe("function");
    expect(result.resolved.startsWith(join(await realpath(installed), "node_modules", "@zvec", "zvec") + sep)).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  }
}, 30000);
