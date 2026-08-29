import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend } from "../src/index.js";

describe("fresh Pi session Computer Use spawn contract", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  it("exports the per-session capability and display env, never the legacy extension path", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-computer-spawn-"));
    const cwd = join(root, "project");
    const sessionsRoot = join(root, "sessions");
    const sessionDir = join(sessionsRoot, "project");
    const runtimeRoot = join(root, "runtime");
    await Promise.all([
      mkdir(cwd, { recursive: true }),
      mkdir(sessionDir, { recursive: true }),
      mkdir(join(runtimeRoot, "extensions"), { recursive: true }),
    ]);
    await writeFile(
      join(sessionDir, "session.jsonl"),
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "session-1",
        timestamp: "2026-08-10T00:00:00.000Z",
        cwd,
      })}\n`,
    );

    const spawns: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const backend = createPiHostBackend({
      sessionsRoot,
      runtimeRoot,
      piPath: "node",
      computerDescriptor: { displayID: 7, width: 1440, height: 900 },
      computerUsable: () => true,
      spawn: (_bin, args, options) => {
        spawns.push({ args: [...args], env: { ...options.env } });
        return spawn(
          process.execPath,
          [new URL("./fake-pi.mjs", import.meta.url).pathname],
          options,
        ) as any;
      },
    });

    await backend.handle("sendPrompt", ["session-1", "show the desktop"]);
    const sessionSpawn = spawns.find((entry) => entry.env.PIPIUI_COMPUTER_CAPABILITY);
    expect(sessionSpawn, "main session spawn (not the tool-free title helper)").toBeTruthy();
    expect(sessionSpawn!.env.PIPIUI_COMPUTER_CAPABILITY).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessionSpawn!.env).toMatchObject({
      PIPIUI_COMPUTER_RUNTIME_PROTOCOL: "1",
      PIPIUI_CUA_DRIVER_VERSION: "0.22.0",
      PIPIUI_COMPUTER_DISPLAY_ID: "7",
      PIPIUI_COMPUTER_WIDTH: "1440",
      PIPIUI_COMPUTER_HEIGHT: "900",
    });
    // The legacy reviewed-strategy twin is deleted; its env path must never be exported.
    expect(sessionSpawn!.env.PIPIUI_COMPUTER_EXT).toBeUndefined();
  });
});
