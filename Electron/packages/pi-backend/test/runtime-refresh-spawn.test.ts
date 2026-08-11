import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend, installRuntimeTree } from "../src/index.js";

const repoSources = new URL("../../../resources/runtime/", import.meta.url).pathname;

/**
 * The regression this whole path exists to prevent: a host that installs its extension tree only
 * at startup hands a running app a frozen copy, so an edit under PiExt/PiPhilosophy shows up in a
 * rebuild and never in the live session. Both spawns here come from one backend instance — no
 * relaunch — and the second must see the edit.
 */
describe("runtime tree refresh across spawns", () => {
  let root = "";
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = "" });

  it("picks up a philosophy edit on the next session without restarting the host", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-refresh-"));
    const cwd = join(root, "project");
    const sessionsRoot = join(root, "sessions");
    const sessionDir = join(sessionsRoot, "project");
    const runtimeRoot = join(root, "runtime");
    const sources = join(root, "runtime-source");
    await Promise.all([mkdir(cwd, { recursive: true }), mkdir(sessionDir, { recursive: true })]);
    await cp(repoSources, sources, { recursive: true, filter: path => !path.includes("node_modules") });
    await writeFile(join(sessionDir, "session.jsonl"), `${JSON.stringify({
      type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd,
    })}\n`);

    const assets = { sourceRoot: sources };
    // What the host does at launch. Everything after this is the live-app question.
    expect(installRuntimeTree(assets, runtimeRoot).failures).toEqual([]);

    let args: string[] = [];
    const backend = createPiHostBackend({
      sessionsRoot, runtimeRoot, piPath: "node", runtimeAssets: assets,
      spawn: (_bin, _args, options) => {
        args = _args;
        return spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as any;
      },
    });

    await backend.handle("sendPrompt", ["session-1", "first"]);
    const philosophy = args[args.indexOf("-e") + 1];
    expect(philosophy).toBe(join(runtimeRoot, "pi-philosophy", "philosophy.ts"));
    const layer = join(runtimeRoot, "pi-philosophy", "layers", "30-orchestration.md");
    expect(await readFile(layer, "utf8")).not.toContain("REFRESH-PROBE");

    // Edit the source the way a developer would while the app stays up.
    const sourceLayer = join(sources, "pi-philosophy", "layers", "30-orchestration.md");
    await writeFile(sourceLayer, `${await readFile(sourceLayer, "utf8")}\n<!-- REFRESH-PROBE -->\n`);
    const sourceGit = join(sources, "extensions", "pipiui-git.ts");
    await writeFile(sourceGit, (await readFile(sourceGit, "utf8")).replace("## Git (Pipi UI)", "## Git (REFRESH-PROBE)"));

    await backend.close?.();
    await backend.handle("sendPrompt", ["session-1", "second"]);
    expect(await readFile(layer, "utf8")).toContain("REFRESH-PROBE");
    expect(await readFile(join(runtimeRoot, "extensions", "pipiui-git.ts"), "utf8")).toContain("REFRESH-PROBE");
  }, 30_000);
});
