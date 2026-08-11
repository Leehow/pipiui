import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend, type PiCommand } from "../src/index.js";

/**
 * T17 parity: `~/.pi/agent/.env` keys must reach the spawned pi RPC process env, or
 * env-key providers (DeepSeek/Kimi) that `listModels` sees via the auth runtime fail
 * `set_model` with "Model not found". Mirrors Swift `ChatSession.mergedSpawnEnv` +
 * `PiProcess.mergedProcessEnvironment` end to end.
 */
describe("pi spawn env injects ~/.pi/agent/.env (T17 parity)", () => {
  let root = "";
  let currentBackend: ReturnType<typeof createPiHostBackend> | undefined;
  afterEach(async () => {
    // Drain durable-index/queue writes and stop fake pi before removing the temp
    // tree; fire-and-forget persists racing rm recreate agentDir (ENOTEMPTY).
    await currentBackend?.close().catch(() => undefined);
    currentBackend = undefined;
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  /** agentDir with an optional .env; returns the env actually handed to the spawned pi. */
  async function fixture(dotEnv: string | undefined, parentEnv: NodeJS.ProcessEnv = {}, piCommand?: PiCommand) {
    root = await mkdtemp(join(tmpdir(), "pipi-dotenv-"));
    const agent = join(root, "agent");
    const cwd = join(root, "project");
    const sessionDir = join(root, "sessions", "project");
    await Promise.all([
      mkdir(agent, { recursive: true }),
      mkdir(cwd, { recursive: true }),
      mkdir(sessionDir, { recursive: true }),
    ]);
    if (dotEnv !== undefined) await writeFile(join(agent, ".env"), dotEnv);
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
    let captured: NodeJS.ProcessEnv = {};
    let capturedBin = "";
    let capturedArgs: string[] = [];
    const backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      ...(piCommand ? { piCommand } : { piPath: "node" }),
      env: { PATH: "/usr/local/bin:/usr/bin:/bin", ...parentEnv },
      spawn: (bin, args, options) => {
        capturedBin = bin;
        capturedArgs = args;
        captured = options.env;
        return spawn(
          process.execPath,
          [new URL("./fake-pi.mjs", import.meta.url).pathname],
          options,
        ) as any;
      },
    });
    currentBackend = backend;
    return { backend, env: () => captured, command: () => ({ bin: capturedBin, args: capturedArgs }) };
  }

  it("injects .env provider keys (DEEPSEEK_API_KEY / KIMI_API_KEY) into the spawned pi env", async () => {
    const { backend, env } = await fixture("DEEPSEEK_API_KEY=sk-dot\nKIMI_API_KEY=km-dot\n");
    await backend.handle("sendPrompt", ["session-1", "go"]);
    expect(env().DEEPSEEK_API_KEY).toBe("sk-dot");
    expect(env().KIMI_API_KEY).toBe("km-dot");
  });

  it("lets .env win over the host process env for the same key", async () => {
    const { backend, env } = await fixture(
      "DEEPSEEK_API_KEY=sk-dot\nANTHROPIC_API_KEY=dot-key\n",
      { DEEPSEEK_API_KEY: "sk-parent", ANTHROPIC_API_KEY: "parent-key" },
    );
    await backend.handle("sendPrompt", ["session-1", "go"]);
    expect(env().DEEPSEEK_API_KEY).toBe("sk-dot");
    expect(env().ANTHROPIC_API_KEY).toBe("dot-key");
  });

  it("strips stale PIPIUI_* from .env and parent; the host contract wins", async () => {
    const { backend, env } = await fixture(
      "PIPIUI_SESSION_KEY=stale-dotenv\nPIPIUI_BRIDGE_PORT=9999\nPIPIUI_COMPUTER_EXT=/stale/dotenv.ts\n",
      { PIPIUI_SESSION_KEY: "stale-parent", PIPIUI_COMPUTER_EXT: "/stale/parent.ts" },
    );
    await backend.handle("sendPrompt", ["session-1", "go"]);
    const actual = env();
    expect(actual.PIPIUI_SESSION_KEY).toBe("session-1");
    expect(actual.PIPIUI_BRIDGE_PORT).toBeTruthy();
    expect(actual.PIPIUI_BRIDGE_PORT).not.toBe("9999");
    expect(actual.PIPIUI_COMPUTER_EXT).toBeUndefined();
  });

  it("spawns normally when ~/.pi/agent/.env is absent", async () => {
    const { backend, env } = await fixture(undefined, {
      PIPIUI_SESSION_KEY: "stale-parent",
    });
    await backend.handle("sendPrompt", ["session-1", "go"]);
    expect(env().PIPIUI_SESSION_KEY).toBe("session-1");
  });

  it("uses an embedded executable plus prefix args and layers its env above .env", async () => {
    const embedded: PiCommand = {
      executable: "/bundle/node/bin/node",
      prefixArgs: ["/bundle/pi/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"],
      piPath: "/bundle/pi/bin/pi",
      env: {
        PATH: "/bundle/node/bin:/bundle/pi/bin:/usr/bin:/bin",
        PIPIUI_NODE_PATH: "/bundle/node/bin/node",
        PIPIUI_PI_PATH: "/bundle/pi/bin/pi"
      }
    };
    const { backend, env, command } = await fixture(
      "PIPIUI_NODE_PATH=/stale/node\nPIPIUI_PI_PATH=/stale/pi\nDEEPSEEK_API_KEY=from-dotenv\n",
      {},
      embedded,
    );
    await backend.handle("sendPrompt", ["session-1", "go"]);
    expect(command().bin).toBe(embedded.executable);
    expect(command().args.slice(0, 3)).toEqual([embedded.prefixArgs![0], "--mode", "rpc"]);
    expect(env()).toMatchObject({
      DEEPSEEK_API_KEY: "from-dotenv",
      PIPIUI_NODE_PATH: embedded.executable,
      PIPIUI_PI_PATH: embedded.piPath,
      PIPIUI_SESSION_KEY: "session-1",
    });
    expect(env().PATH?.split(":" ).slice(0, 2)).toEqual(["/bundle/node/bin", "/bundle/pi/bin"]);
  });
});
