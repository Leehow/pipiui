import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  TOOL_BATCH_STATS_BACKUP_SUFFIX,
  TOOL_BATCH_STATS_FILENAME,
  TOOL_BATCH_STATS_VERSION,
  classifyConcurrency,
  createToolBatchTelemetry,
  serializeToolBatchRecord,
  type ToolBatchStatsRecord,
  type ToolBatchTelemetry,
} from "../src/tool-batch-telemetry.js";

async function dir() {
  return mkdtemp(join(tmpdir(), "tool-batch-"));
}

function lines(text: string): ToolBatchStatsRecord[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ToolBatchStatsRecord);
}

function complete(tel: ToolBatchTelemetry, sessionId: string, name: string) {
  tel.observeRpc(
    { type: "message_update", assistantMessageEvent: { type: "toolcall_end", toolCall: { id: name, name } } },
    { sessionId },
  );
  tel.observeRpc({ type: "tool_execution_end", toolCallId: name, isError: false }, { sessionId });
}

describe("classifyConcurrency", () => {
  it("is single for one tool", () => {
    expect(classifyConcurrency([{ execStartMs: 1, execEndMs: 2 }])).toBe("single");
  });

  it("is unknown without complete start/end pairs", () => {
    expect(
      classifyConcurrency([
        { execStartMs: 1, execEndMs: 10 },
        { execEndMs: 12 },
      ]),
    ).toBe("unknown");
  });

  it("detects overlap as parallel", () => {
    expect(
      classifyConcurrency([
        { execStartMs: 0, execEndMs: 10 },
        { execStartMs: 5, execEndMs: 12 },
      ]),
    ).toBe("parallel");
  });

  it("detects non-overlap as sequential", () => {
    expect(
      classifyConcurrency([
        { execStartMs: 0, execEndMs: 10 },
        { execStartMs: 10, execEndMs: 20 },
      ]),
    ).toBe("sequential");
  });
});

describe("tool-batch-telemetry", () => {
  it("records a parallel multi-tool batch from execution start/end timing", async () => {
    const agentDir = await dir();
    const tel = createToolBatchTelemetry({ agentDir, now: () => 1_000 });
    const ctx = { sessionId: "s1", provider: "fake", model: "m1" };
    tel.observeRpc(
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "a", name: "read" },
            { type: "toolCall", id: "b", name: "grep" },
          ],
        },
      },
      ctx,
    );
    tel.observeRpc({ type: "tool_execution_start", toolCallId: "a" }, { ...ctx, nowMs: 10 });
    tel.observeRpc({ type: "tool_execution_start", toolCallId: "b" }, { ...ctx, nowMs: 11 });
    tel.observeRpc({ type: "tool_execution_end", toolCallId: "a", isError: false }, { ...ctx, nowMs: 40 });
    tel.observeRpc({ type: "tool_execution_end", toolCallId: "b", isError: false }, { ...ctx, nowMs: 42 });
    await tel.pending();
    const [row] = lines(await readFile(join(agentDir, TOOL_BATCH_STATS_FILENAME), "utf8"));
    expect(row.v).toBe(TOOL_BATCH_STATS_VERSION);
    expect(row.session).toBe("s1");
    expect(row.provider).toBe("fake");
    expect(row.model).toBe("m1");
    expect(row.toolCount).toBe(2);
    expect(row.toolNames).toEqual(["read", "grep"]);
    expect(row.success).toBe(2);
    expect(row.failure).toBe(0);
    expect(row.cancelled).toBe(0);
    expect(row.concurrency).toBe("parallel");
    expect(row.wallMs).toBe(32);
  });

  it("records sequential timing", async () => {
    const agentDir = await dir();
    const tel = createToolBatchTelemetry({ agentDir, now: () => 0 });
    const ctx = { sessionId: "s1", provider: "p", model: "m" };
    tel.observeRpc(
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "a", name: "read" },
            { type: "toolCall", id: "b", name: "write" },
          ],
        },
      },
      ctx,
    );
    tel.observeRpc({ type: "tool_execution_start", toolCallId: "a" }, { ...ctx, nowMs: 0 });
    tel.observeRpc({ type: "tool_execution_end", toolCallId: "a", isError: false }, { ...ctx, nowMs: 8 });
    tel.observeRpc({ type: "tool_execution_start", toolCallId: "b" }, { ...ctx, nowMs: 8 });
    tel.observeRpc({ type: "tool_execution_end", toolCallId: "b", isError: false }, { ...ctx, nowMs: 20 });
    await tel.pending();
    const [row] = lines(await readFile(join(agentDir, TOOL_BATCH_STATS_FILENAME), "utf8"));
    expect(row.concurrency).toBe("sequential");
    expect(row.wallMs).toBe(20);
  });

  it("records a single tool as single", async () => {
    const agentDir = await dir();
    const tel = createToolBatchTelemetry({ agentDir });
    const ctx = { sessionId: "s1" };
    tel.observeRpc(
      { type: "message_update", assistantMessageEvent: { type: "toolcall_end", toolCall: { id: "t1", name: "bash" } } },
      ctx,
    );
    tel.observeRpc({ type: "tool_execution_end", toolCallId: "t1", isError: false }, ctx);
    await tel.pending();
    const [row] = lines(await readFile(join(agentDir, TOOL_BATCH_STATS_FILENAME), "utf8"));
    expect(row.toolCount).toBe(1);
    expect(row.toolNames).toEqual(["bash"]);
    expect(row.concurrency).toBe("single");
  });

  it("counts failure and cancelled without recording results", async () => {
    const agentDir = await dir();
    const tel = createToolBatchTelemetry({ agentDir });
    const ctx = { sessionId: "s1" };
    tel.observeRpc(
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "a", name: "read" },
            { type: "toolCall", id: "b", name: "edit" },
          ],
        },
      },
      ctx,
    );
    tel.observeRpc(
      { type: "tool_execution_end", toolCallId: "a", isError: true, result: { content: "secret boom" } },
      ctx,
    );
    tel.observeRpc({ type: "tool_execution_end", toolCallId: "b", cancelled: true }, ctx);
    await tel.pending();
    const raw = await readFile(join(agentDir, TOOL_BATCH_STATS_FILENAME), "utf8");
    expect(raw).not.toMatch(/secret boom|arguments|result|prompt/);
    const [row] = lines(raw);
    expect(row.failure).toBe(1);
    expect(row.cancelled).toBe(1);
    expect(row.success).toBe(0);
    expect(row.concurrency).toBe("unknown");
  });

  it("keeps two sessions and two batches isolated", async () => {
    const agentDir = await dir();
    const tel = createToolBatchTelemetry({ agentDir });
    tel.observeRpc(
      { type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "a", name: "one" }] } },
      { sessionId: "s1" },
    );
    tel.observeRpc(
      { type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "b", name: "two" }] } },
      { sessionId: "s2" },
    );
    tel.observeRpc({ type: "tool_execution_end", toolCallId: "b", isError: false }, { sessionId: "s2" });
    tel.observeRpc({ type: "tool_execution_end", toolCallId: "a", isError: false }, { sessionId: "s1" });
    tel.observeRpc(
      { type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "c", name: "three" }] } },
      { sessionId: "s1" },
    );
    tel.observeRpc({ type: "tool_execution_end", toolCallId: "c", isError: false }, { sessionId: "s1" });
    await tel.pending();
    const rows = lines(await readFile(join(agentDir, TOOL_BATCH_STATS_FILENAME), "utf8"));
    expect(rows.map((row) => `${row.session}:${row.toolNames.join(",")}`).sort()).toEqual([
      "s1:one",
      "s1:three",
      "s2:two",
    ]);
  });

  it("groups streamed toolcall_end events into one batch", async () => {
    const agentDir = await dir();
    const tel = createToolBatchTelemetry({ agentDir });
    const ctx = { sessionId: "s1" };
    tel.observeRpc(
      { type: "message_update", assistantMessageEvent: { type: "toolcall_end", toolCall: { id: "a", name: "read" } } },
      ctx,
    );
    tel.observeRpc(
      { type: "message_update", assistantMessageEvent: { type: "toolcall_end", toolCall: { id: "b", name: "grep" } } },
      ctx,
    );
    tel.observeRpc({ type: "tool_execution_end", toolCallId: "a", isError: false }, ctx);
    tel.observeRpc({ type: "tool_execution_end", toolCallId: "b", isError: false }, ctx);
    await tel.pending();
    const rows = lines(await readFile(join(agentDir, TOOL_BATCH_STATS_FILENAME), "utf8"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.toolNames).toEqual(["read", "grep"]);
    expect(rows[0]!.concurrency).toBe("unknown");
  });

  it("flushSession writes an unfinished batch without throwing", async () => {
    const agentDir = await dir();
    const tel = createToolBatchTelemetry({ agentDir });
    tel.observeRpc(
      { type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "a", name: "read" }] } },
      { sessionId: "s1" },
    );
    expect(() => tel.flushSession("s1")).not.toThrow();
    await tel.pending();
    const [row] = lines(await readFile(join(agentDir, TOOL_BATCH_STATS_FILENAME), "utf8"));
    expect(row.toolNames).toEqual(["read"]);
    expect(row.success).toBe(0);
    expect(row.concurrency).toBe("single");
  });

  it("does not throw when append fails", async () => {
    const tel = createToolBatchTelemetry({
      agentDir: "/no/such/agent",
      append: async () => {
        throw new Error("disk full");
      },
    });
    expect(() => {
      tel.observeRpc(
        { type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "a", name: "x" }] } },
        { sessionId: "s1" },
      );
      tel.observeRpc({ type: "tool_execution_end", toolCallId: "a", isError: false }, { sessionId: "s1" });
    }).not.toThrow();
    await tel.pending();
  });

  it("serializes concurrent appends onto one queue in emit order", async () => {
    const order: string[] = [];
    let inflight = 0;
    let maxInflight = 0;
    const tel = createToolBatchTelemetry({
      agentDir: await dir(),
      append: async (_file, line) => {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        const name = (JSON.parse(line) as ToolBatchStatsRecord).toolNames[0]!;
        order.push(`start:${name}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(`end:${name}`);
        inflight -= 1;
      },
    });
    complete(tel, "s1", "a");
    complete(tel, "s1", "b");
    complete(tel, "s1", "c");
    await tel.pending();
    expect(maxInflight).toBe(1);
    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
  });

  it("keeps writing after a single append failure", async () => {
    const written: string[] = [];
    let n = 0;
    const tel = createToolBatchTelemetry({
      agentDir: await dir(),
      append: async (_file, line) => {
        n += 1;
        if (n === 1) throw new Error("disk full");
        written.push((JSON.parse(line) as ToolBatchStatsRecord).toolNames[0]!);
      },
    });
    complete(tel, "s1", "a");
    complete(tel, "s1", "b");
    await tel.pending();
    expect(written).toEqual(["b"]);
  });

  it("rotates the live file to a single backup at the size cap", async () => {
    const agentDir = await dir();
    const ops: string[] = [];
    const tel = createToolBatchTelemetry({
      agentDir,
      maxBytes: 10,
      stat: async () => {
        ops.push("stat");
        return { size: 10 };
      },
      rotate: async (_file, backup) => {
        ops.push(`rotate:${backup.slice(backup.lastIndexOf("/") + 1)}`);
      },
      append: async () => {
        ops.push("append");
      },
    });
    complete(tel, "s1", "read");
    await tel.pending();
    expect(ops).toEqual(["stat", `rotate:${TOOL_BATCH_STATS_FILENAME}${TOOL_BATCH_STATS_BACKUP_SUFFIX}`, "append"]);
  });

  it("retains only one backup and complete JSONL records on disk", async () => {
    const agentDir = await dir();
    const maxBytes = 400;
    const tel = createToolBatchTelemetry({ agentDir, maxBytes });
    for (const name of ["one", "two", "three", "four", "five", "six"]) complete(tel, "s1", name);
    await tel.pending();
    const main = await readFile(join(agentDir, TOOL_BATCH_STATS_FILENAME), "utf8");
    const backup = await readFile(
      join(agentDir, `${TOOL_BATCH_STATS_FILENAME}${TOOL_BATCH_STATS_BACKUP_SUFFIX}`),
      "utf8",
    );
    await expect(access(join(agentDir, `${TOOL_BATCH_STATS_FILENAME}.2`))).rejects.toMatchObject({ code: "ENOENT" });
    const names = [...lines(backup), ...lines(main)].map((row) => row.toolNames[0]);
    expect(names).toContain("five");
    expect(names).toContain("six");
    expect(names).not.toContain("one");
    expect(main).not.toMatch(/arguments|result|prompt/);
    expect(backup).not.toMatch(/arguments|result|prompt/);
    expect(Buffer.byteLength(main, "utf8") + Buffer.byteLength(backup, "utf8")).toBeLessThan(maxBytes * 2 + 250);
  });

  it("close waits for a delayed append", async () => {
    let done = false;
    const tel = createToolBatchTelemetry({
      agentDir: await dir(),
      append: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        done = true;
      },
    });
    complete(tel, "s1", "read");
    await tel.close();
    expect(done).toBe(true);
  });

  it("close releases a hung append after the bounded timeout", async () => {
    const tel = createToolBatchTelemetry({
      agentDir: await dir(),
      closeTimeoutMs: 25,
      append: () => new Promise(() => undefined),
    });
    complete(tel, "s1", "read");
    const started = Date.now();
    await tel.close();
    expect(Date.now() - started).toBeLessThan(200);
  });

  it("omits privacy-sensitive fields from serialized records", () => {
    const line = serializeToolBatchRecord({
      v: 1,
      ts: "2026-01-01T00:00:00.000Z",
      session: "s",
      provider: "p",
      model: "m",
      toolCount: 1,
      toolNames: ["read"],
      wallMs: 1,
      success: 1,
      failure: 0,
      cancelled: 0,
      concurrency: "single",
      arguments: { path: "/secret" },
      result: "nope",
      prompt: "hi",
    } as ToolBatchStatsRecord & { arguments: unknown; result: string; prompt: string });
    expect(line).not.toMatch(/secret|nope|"prompt"|"arguments"|"result"/);
  });
});
