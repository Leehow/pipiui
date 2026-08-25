import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMPACTION_DIAGNOSTICS_BACKUP_SUFFIX,
  COMPACTION_DIAGNOSTICS_FILENAME,
  COMPACTION_DIAGNOSTICS_SCHEMA_VERSION,
  compactionDiagnosticsBackupPath,
  compactionDiagnosticsLine,
  compactionDiagnosticsPath,
  createCompactionDiagnostics,
  rotateCompactionDiagnosticsFile,
  type CompactionDiagnosticsEntry,
} from "../src/compaction-diagnostics.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

const entry: CompactionDiagnosticsEntry = {
  sessionId: "session-1",
  event: "compaction_start",
  operation: "context_compaction",
  trigger: "manual",
  operationId: "session-1:1",
};

describe("paths", () => {
  it("places the JSONL and its single .1 rotation in the agent dir", () => {
    expect(compactionDiagnosticsPath("/tmp/agent")).toBe(
      join("/tmp/agent", "pipiui-compaction-diagnostics.jsonl"),
    );
    expect(compactionDiagnosticsBackupPath("/tmp/agent")).toBe(
      compactionDiagnosticsPath("/tmp/agent") + COMPACTION_DIAGNOSTICS_BACKUP_SUFFIX,
    );
    expect(COMPACTION_DIAGNOSTICS_FILENAME).toBe("pipiui-compaction-diagnostics.jsonl");
  });
});

describe("compactionDiagnosticsLine", () => {
  it("stamps schemaVersion + timestamp and keeps the allowlisted fields", () => {
    const line = compactionDiagnosticsLine(
      { ...entry, contextTokens: 90000, contextWindow: 200000, usagePercent: 45, durationMs: 1234 },
      Date.parse("2026-08-24T00:00:00.000Z"),
    );
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({
      schemaVersion: COMPACTION_DIAGNOSTICS_SCHEMA_VERSION,
      timestamp: "2026-08-24T00:00:00.000Z",
      sessionId: "session-1",
      event: "compaction_start",
      operation: "context_compaction",
      trigger: "manual",
      operationId: "session-1:1",
      contextTokens: 90000,
      contextWindow: 200000,
      usagePercent: 45,
      durationMs: 1234,
    });
  });

  it("drops unknown keys — conversation text, summaries, tool args cannot reach the file", () => {
    const line = compactionDiagnosticsLine(
      {
        ...entry,
        summary: "the user discussed SECRET_TOPIC",
        content: "user message body",
        toolArgs: '{"path":"/etc/passwd"}',
      } as CompactionDiagnosticsEntry & Record<string, unknown>,
      0,
    );
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      "event",
      "operation",
      "operationId",
      "schemaVersion",
      "sessionId",
      "timestamp",
      "trigger",
    ]);
    expect(line).not.toContain("SECRET_TOPIC");
    expect(line).not.toContain("user message body");
  });

  it("truncates every string field, keeps null operationId, and drops unusable numbers", () => {
    const long = "x".repeat(1000);
    const line = compactionDiagnosticsLine(
      {
        ...entry,
        operationId: null,
        reason: long,
        error: long,
        skipReason: "  ",
        usagePercent: Number.NaN,
        durationMs: -5,
        contextTokens: Number.POSITIVE_INFINITY,
      },
      0,
    );
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.operationId).toBeNull();
    expect((parsed.reason as string).length).toBe(256);
    expect((parsed.error as string).length).toBe(200);
    expect(parsed.skipReason).toBeUndefined();
    expect(parsed.usagePercent).toBeUndefined();
    expect(parsed.durationMs).toBeUndefined();
    expect(parsed.contextTokens).toBeUndefined();
  });
});

describe("createCompactionDiagnostics", () => {
  it("appends real JSONL lines under the agent dir", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-compact-diag-"));
    const agentDir = join(root, "agent");
    const diagnostics = createCompactionDiagnostics({ agentDir });
    diagnostics.record({ ...entry, event: "compaction_start" });
    diagnostics.record({
      ...entry,
      event: "compaction_end",
      operationId: "session-1:1",
      success: true,
      durationMs: 42,
    });
    await diagnostics.close(2000);
    const text = await readFile(compactionDiagnosticsPath(agentDir), "utf8");
    const lines = text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.event).toBe("compaction_start");
    expect(lines[1]!.event).toBe("compaction_end");
    expect(lines[1]!.operationId).toBe("session-1:1");
    expect(lines[1]!.success).toBe(true);
  });

  it("rotates once to the .1 backup when the live file reaches maxBytes", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-compact-diag-"));
    const agentDir = join(root, "agent");
    const rotations: { file: string; backup: string }[] = [];
    const diagnostics = createCompactionDiagnostics({
      agentDir,
      maxBytes: 10,
      stat: async (file) => ({ size: (await readFile(file, "utf8").catch(() => "")).length }),
      rotate: async (file, backup) => {
        rotations.push({ file, backup });
        await writeFile(backup, await readFile(file, "utf8"));
        await rm(file, { force: true });
      },
    });
    diagnostics.record(entry);
    diagnostics.record({ ...entry, event: "compaction_end", success: true });
    await diagnostics.close(2000);
    expect(rotations).toEqual([
      { file: compactionDiagnosticsPath(agentDir), backup: compactionDiagnosticsBackupPath(agentDir) },
    ]);
    // Backup holds the pre-rotation line; the live file holds the post-rotation one.
    expect(await readFile(compactionDiagnosticsBackupPath(agentDir), "utf8")).toContain("compaction_start");
    expect(await readFile(compactionDiagnosticsPath(agentDir), "utf8")).toContain("compaction_end");
  });

  it("never throws on write failure and throttles the warning", async () => {
    let clock = 0;
    const warnings: string[] = [];
    const diagnostics = createCompactionDiagnostics({
      agentDir: "/definitely/not/writable",
      now: () => clock,
      stat: async () => ({ size: 0 }),
      append: async () => {
        throw new Error("EACCES: permission denied");
      },
      warnIntervalMs: 1000,
      warn: (message) => warnings.push(message),
    });
    expect(() => diagnostics.record(entry)).not.toThrow();
    expect(() => diagnostics.record(entry)).not.toThrow();
    await diagnostics.close(2000);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("append failed");
    // Past the throttle window a new failure warns again.
    clock = 1001;
    diagnostics.record(entry);
    await diagnostics.close(2000);
    expect(warnings).toHaveLength(2);
  });

  it("keeps the previous .1 backup when rename/replace fails", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-compact-diag-"));
    const agentDir = join(root, "agent");
    await mkdir(agentDir, { recursive: true });
    const file = compactionDiagnosticsPath(agentDir);
    const backup = compactionDiagnosticsBackupPath(agentDir);
    await writeFile(file, "LIVE\n");
    await writeFile(backup, "OLD_BACKUP\n");
    await expect(
      rotateCompactionDiagnosticsFile(file, backup, {
        rename: async () => {
          throw new Error("EXDEV: cross-device rename failed");
        },
      }),
    ).rejects.toThrow(/EXDEV/);
    expect(await readFile(backup, "utf8")).toBe("OLD_BACKUP\n");
    expect(await readFile(file, "utf8")).toBe("LIVE\n");
  });

  it("replaces the backup by rename without deleting it first", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-compact-diag-"));
    const agentDir = join(root, "agent");
    await mkdir(agentDir, { recursive: true });
    const file = compactionDiagnosticsPath(agentDir);
    const backup = compactionDiagnosticsBackupPath(agentDir);
    await writeFile(file, "LIVE\n");
    await writeFile(backup, "OLD_BACKUP\n");
    await rotateCompactionDiagnosticsFile(file, backup);
    expect(await readFile(backup, "utf8")).toBe("LIVE\n");
    await expect(readFile(file, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps recording after a failed write and drains on close", async () => {
    let failNext = true;
    const appended: string[] = [];
    const diagnostics = createCompactionDiagnostics({
      agentDir: "/tmp/unused",
      stat: async () => ({ size: 0 }),
      append: async (_file, line) => {
        if (failNext) {
          failNext = false;
          throw new Error("transient");
        }
        appended.push(line);
      },
      warn: () => {},
    });
    diagnostics.record(entry);
    diagnostics.record({ ...entry, event: "compaction_end", success: true });
    await diagnostics.close(2000);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toContain("compaction_end");
  });
});
