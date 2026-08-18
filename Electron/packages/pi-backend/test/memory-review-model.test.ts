import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend } from "../src/index.js";

describe("Hermes review model spawn wiring", () => {
  let root = "";
  let backend: ReturnType<typeof createPiHostBackend> | undefined;

  afterEach(async () => {
    await backend?.close().catch(() => undefined);
    backend = undefined;
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  async function fixture() {
    root = await mkdtemp(join(tmpdir(), "pipi-memory-review-"));
    const agentDir = join(root, "agent");
    const sessionsRoot = join(root, "sessions");
    const cwd = join(root, "project");
    const runtimeRoot = join(root, "runtime");
    await Promise.all([
      mkdir(agentDir, { recursive: true }),
      mkdir(join(sessionsRoot, "project"), { recursive: true }),
      mkdir(cwd, { recursive: true }),
      mkdir(join(runtimeRoot, "pi-ext", "packages", "memory-broker"), { recursive: true }),
    ]);
    await writeFile(join(runtimeRoot, "pi-ext", "packages", "memory-broker", "package.json"), JSON.stringify({ name: "pipiui-memory-broker" }));
    await writeFile(join(sessionsRoot, "project", "session.jsonl"), `${JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd })}\n`);
    const spawnedEnvs: NodeJS.ProcessEnv[] = [];
    const makeBackend = () => createPiHostBackend({
        agentDir,
        sessionsRoot,
        runtimeRoot,
        piPath: "node",
        spawn: (_bin, _args, options) => {
          spawnedEnvs.push(options.env);
          return spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as any;
        },
      });
    backend = makeBackend();
    return { spawnedEnvs, makeBackend };
  }

  it("omits override for follow-main, emits an explicit provider/model, and omits again after clear", async () => {
    const state = await fixture();
    const mainEnv = () => [...state.spawnedEnvs].reverse().find(env => env.PIPIUI_SESSION_KEY === "session-1");
    await backend!.handle("sendPrompt", ["session-1", "default"]);
    expect(mainEnv()?.PIPIUI_MEMORY_REVIEW_MODEL).toBeUndefined();

    await backend!.close();
    backend = state.makeBackend();
    await backend!.handle("setMemoryReviewModel", ["anthropic/claude-sonnet-4"]);
    await backend!.handle("sendPrompt", ["session-1", "explicit"]);
    expect(mainEnv()?.PIPIUI_MEMORY_REVIEW_MODEL).toBe("anthropic/claude-sonnet-4");

    await backend!.close();
    backend = state.makeBackend();
    await backend!.handle("setMemoryReviewModel", [null]);
    await backend!.handle("sendPrompt", ["session-1", "follow again"]);
    expect(mainEnv()?.PIPIUI_MEMORY_REVIEW_MODEL).toBeUndefined();
  });
});
