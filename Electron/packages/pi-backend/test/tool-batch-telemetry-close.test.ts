import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createPiHostBackend } from "../src/index.js";
import { createToolBatchTelemetry } from "../src/tool-batch-telemetry.js";

async function removeRoot(path: string) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== "ENOTEMPTY" && code !== "EPERM") || attempt >= 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

const idleAuth = {
  getProviders: async () => [],
  getAvailable: async () => [],
};

function enqueueOne(tel: ReturnType<typeof createToolBatchTelemetry>) {
  tel.observeRpc(
    { type: "message_update", assistantMessageEvent: { type: "toolcall_end", toolCall: { id: "t1", name: "read" } } },
    { sessionId: "s1" },
  );
  tel.observeRpc({ type: "tool_execution_end", toolCallId: "t1", isError: false }, { sessionId: "s1" });
}

describe("PiHostBackend.close tool-batch drain", () => {
  let root = "";

  afterEach(async () => {
    if (root) await removeRoot(root);
    root = "";
  });

  it("awaits a delayed append before close returns", async () => {
    root = await mkdtemp(join(tmpdir(), "tool-batch-close-"));
    let done = false;
    const tel = createToolBatchTelemetry({
      agentDir: join(root, "agent"),
      append: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        done = true;
      },
    });
    enqueueOne(tel);
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      toolBatchTelemetry: tel,
      authRuntime: idleAuth,
    });
    await backend.close();
    expect(done).toBe(true);
  });

  it("returns when an append hangs past the close timeout", async () => {
    root = await mkdtemp(join(tmpdir(), "tool-batch-hang-"));
    const tel = createToolBatchTelemetry({
      agentDir: join(root, "agent"),
      closeTimeoutMs: 25,
      append: () => new Promise(() => undefined),
    });
    enqueueOne(tel);
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      toolBatchTelemetry: tel,
      authRuntime: idleAuth,
    });
    const started = Date.now();
    await backend.close();
    expect(Date.now() - started).toBeLessThan(200);
  });
});
