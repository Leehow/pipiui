import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BUNDLED_MANIFEST_EXTENSIONS, installRuntimeTree } from "../src/runtime-install.js";

const runtimeDirectories = ["pi-core-prompt", "pi-ext", "pi-philosophy", "extensions", "built-in-skills", "pi-goal", "profiles"];
const shippedRuntime = new URL("../../../resources/runtime/", import.meta.url).pathname;

describe("Git header runtime artifact", () => {
  it("selects git-capability for the shipped runtime keepDist pass", async () => {
    const selection = JSON.parse(await readFile(join(shippedRuntime, "pipiui-runtime-manifest.json"), "utf8")) as {
      bundledExtensions?: string[];
    };
    const gitManifest = JSON.parse(await readFile(join(shippedRuntime, "extensions", "git-capability", "pipiui-extension.json"), "utf8")) as {
      app?: { ui?: { headerActions?: Array<{ entry?: string }> } };
    };
    expect(gitManifest.app?.ui?.headerActions?.[0]?.entry).toBe("app/dist/branch-menu.js");
    expect(BUNDLED_MANIFEST_EXTENSIONS).toContain("git-capability");
    expect(selection.bundledExtensions).toContain("git-capability");
  });

  it("preserves the manifest-declared branch menu through runtime installation", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipiui-git-header-runtime-"));
    try {
      const source = join(root, "source");
      const destination = join(root, "destination");
      for (const directory of runtimeDirectories) await mkdir(join(source, directory), { recursive: true });

      const gitRoot = join(source, "extensions", "git-capability");
      await mkdir(join(gitRoot, "app", "dist"), { recursive: true });
      await writeFile(join(gitRoot, "pipiui-extension.json"), JSON.stringify({
        id: "git-capability",
        name: "PipiUI Git",
        version: "1.0.0",
        capabilities: [],
        app: { ui: { headerActions: [{ id: "git.branch", entry: "app/dist/branch-menu.js", order: 20 }] } },
      }));
      await writeFile(join(gitRoot, "app", "dist", "branch-menu.js"), "export const createHeaderAction = () => () => null\n");
      await writeFile(join(source, "pipiui-runtime-manifest.json"), JSON.stringify({
        schemaVersion: 1,
        bundledExtensions: ["git-capability"],
        includeAnydoc: false,
      }));

      const report = installRuntimeTree({ sourceRoot: source }, destination);
      expect(report.failures).toEqual([]);
      expect(BUNDLED_MANIFEST_EXTENSIONS).toContain("git-capability");

      const installedGit = join(destination, "extensions", "git-capability");
      const manifest = JSON.parse(await readFile(join(installedGit, "pipiui-extension.json"), "utf8")) as {
        app?: { ui?: { headerActions?: Array<{ entry?: string }> } };
      };
      const entry = manifest.app?.ui?.headerActions?.[0]?.entry;
      expect(entry).toBe("app/dist/branch-menu.js");
      expect(entry && existsSync(join(installedGit, entry))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
