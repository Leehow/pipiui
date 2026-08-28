import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir, mkdtemp, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import type { SessionStats } from "@pipi/host-api";
import {
  createPiHostBackend,
  type PiBackendOptions,
} from "../src/index.js";
import {
  turnTelemetryBackupPath,
  turnTelemetryPath,
  type TurnTelemetryRecord,
} from "../src/turn-telemetry.js";

const SESSION_ID = "aging-session";
const FAKE_PI_PATH = fileURLToPath(new URL("./fake-agent-aging-pi.mjs", import.meta.url));
const FULL_CHECKPOINTS = [1, 10, 100, 1_000] as const;
const DEFAULT_CHECKPOINTS = FULL_CHECKPOINTS;
const OLD_CONTEXT_TOKENS = 90_000;
const COMPACTED_CONTEXT_TOKENS = 8_000;
const OLD_CONTEXT_STEP = 192;
const COMPACTED_CONTEXT_STEP = 24;
const REQUEST_OVERHEAD_TOKENS = 256;
const REQUEST_OVERHEAD_BYTES = 64;
const MAX_REGISTRY_ENTRIES = 32;
const MAX_REQUEST_BYTES = 2_000_000;
// The LeaseManager's single process exit hook is the production listener
// whose per-session growth this benchmark guards. Test runners may install
// their own signal/error listeners asynchronously, so they are not mixed into
// this deterministic ownership count.
const PROCESS_EVENTS = ["exit"] as const;

const roots = new Set<string>();

afterEach(async () => {
  await Promise.all([...roots].map((root) => rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 25,
  })));
  roots.clear();
});

type ContextMode = "old" | "compacted";
type BackendMode = "old" | "fresh";
type AgingState = {
  version: 1;
  contextMode: ContextMode;
  compacted: boolean;
  turns: number;
  contextTokens: number;
  requestTokens: number;
  requestBytes: number;
  promptBytes?: number;
};
type Fixture = {
  root: string;
  home: string;
  profile: string;
  project: string;
  sessions: string;
  sessionFile: string;
  stateFile: string;
  agentDir: string;
  runtimeRoot: string;
};
type AttachmentProbe = {
  pending: boolean;
  aborts: number;
};
type CellRow = {
  cell: string;
  backend: BackendMode;
  context: ContextMode;
  checkpoint: number;
  contextTokens: number;
  requestTokens: number;
  requestBytes: number;
  rpcBytes?: number;
  phases: string;
  listeners: number;
  registry: number;
  attachments: string;
  rssBytes?: number;
  fdCount?: number;
  childCount: number;
};
type CellResult = {
  rows: CellRow[];
  restartProofs: number;
  cleanupState: Record<string, number>;
};

function parseCheckpoints(env: NodeJS.ProcessEnv = process.env): number[] {
  const configured = env.AGENT_AGING_CHECKPOINTS?.trim();
  const source = configured || DEFAULT_CHECKPOINTS.join(",");
  const checkpoints = [...new Set(source.split(",").map((part) => {
    const value = Number(part.trim());
    if (!Number.isSafeInteger(value) || !FULL_CHECKPOINTS.includes(value as (typeof FULL_CHECKPOINTS)[number]))
      throw new Error(`invalid Agent Aging checkpoint ${part}; choose 1, 10, 100, or 1000`);
    return value;
  }))].sort((left, right) => left - right);
  if (!checkpoints.length) throw new Error("Agent Aging requires at least one checkpoint");
  return checkpoints;
}

function processListenerCount(): number {
  return PROCESS_EVENTS.reduce((total, event) => total + process.listenerCount(event), 0);
}

async function fdCount(): Promise<number | undefined> {
  if (process.platform === "win32") return undefined;
  for (const path of ["/dev/fd", "/proc/self/fd"]) {
    try { return (await readdir(path)).length; } catch { /* try the other portable procfs view */ }
  }
  return undefined;
}

function initialState(): AgingState {
  return {
    version: 1,
    contextMode: "old",
    compacted: false,
    turns: 0,
    contextTokens: OLD_CONTEXT_TOKENS,
    requestTokens: OLD_CONTEXT_TOKENS + REQUEST_OVERHEAD_TOKENS,
    requestBytes: (OLD_CONTEXT_TOKENS + REQUEST_OVERHEAD_TOKENS) * 4 + REQUEST_OVERHEAD_BYTES,
  };
}

function jsonl(rows: unknown[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

async function writeSession(
  sessionFile: string,
  sessionId: string,
  project: string,
  context: AgingState = initialState(),
): Promise<void> {
  await writeFile(sessionFile, jsonl([
    {
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: "2026-08-28T00:00:00.000Z",
      cwd: project,
    },
    {
      type: "session_info",
      id: `${sessionId}-info`,
      parentId: null,
      timestamp: "2026-08-28T00:00:01.000Z",
      name: "Agent Aging benchmark",
    },
    {
      type: "model_change",
      id: `${sessionId}-model`,
      parentId: `${sessionId}-info`,
      timestamp: "2026-08-28T00:00:02.000Z",
      provider: "aging-fake",
      modelId: "aging-model",
    },
    // This body-free fixture marker makes the persisted old/new boundary
    // visible in the session itself; the fake provider's state file carries
    // the active request measurement across a backend restart.
    {
      type: "pipiui_agent_aging_context",
      id: `${sessionId}-context`,
      timestamp: "2026-08-28T00:00:03.000Z",
      contextMode: context.contextMode,
      contextTokens: context.contextTokens,
      requestTokens: context.requestTokens,
    },
  ]));
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "pipi-agent-aging-"));
  roots.add(root);
  const home = join(root, "home");
  const profile = join(root, "profile");
  const project = join(root, "project");
  const sessions = join(root, "sessions");
  const sessionDir = join(sessions, "project");
  const agentDir = profile;
  const runtimeRoot = join(root, "runtime");
  const sessionFile = join(sessionDir, `${SESSION_ID}.jsonl`);
  const stateFile = join(profile, "agent-aging-state.json");
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(profile, { recursive: true }),
    mkdir(project, { recursive: true }),
    mkdir(sessionDir, { recursive: true }),
    mkdir(runtimeRoot, { recursive: true }),
  ]);
  const state = initialState();
  await writeFile(stateFile, `${JSON.stringify(state)}\n`);
  await writeSession(sessionFile, SESSION_ID, project, state);
  return { root, home, profile, project, sessions, sessionFile, stateFile, agentDir, runtimeRoot };
}

async function readState(path: string): Promise<AgingState> {
  return JSON.parse(await readFile(path, "utf8")) as AgingState;
}

async function readTelemetry(agentDir: string): Promise<TurnTelemetryRecord[]> {
  const records: TurnTelemetryRecord[] = [];
  for (const path of [turnTelemetryBackupPath(agentDir), turnTelemetryPath(agentDir)]) {
    try {
      const raw = await readFile(path, "utf8");
      records.push(...raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as TurnTelemetryRecord));
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return records;
}

/** Check only the newest bounded record window during the hot 1,000-turn loop. */
async function hasTelemetryTurn(agentDir: string, turnId: string): Promise<boolean> {
  const marker = `"turnId":"${turnId}"`;
  for (const path of [turnTelemetryBackupPath(agentDir), turnTelemetryPath(agentDir)]) {
    try {
      const handle = await open(path, "r");
      try {
        const { size } = await handle.stat();
        const length = Math.min(size, 16 * 1024);
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, size - length);
        const tail = buffer.toString("utf8");
        if (!tail.includes(marker)) continue;
        for (const line of tail.split("\n")) {
          try {
            const record = JSON.parse(line) as TurnTelemetryRecord;
            if (record.turnId === turnId && record.metrics?.contextTokens !== undefined) return true;
          } catch {
            // The first bounded line may begin before the window; skip it.
          }
        }
      } finally {
        await handle.close();
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return false;
}

// This is only a liveness guard for a busy shared CI host; elapsed time is
// reported, never asserted as a benchmark threshold.
async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Agent Aging condition was not met before timeout");
}

function noHeadroomRuntime() {
  return {
    settingsForProject: async () => ({}),
    prepare: async () => ({
      schemaVersion: 1 as const,
      state: "stopped" as const,
      engineVersion: "aging-fake",
      baseUrl: "http://127.0.0.1:1",
      statePath: "",
      updatedAt: new Date(0).toISOString(),
    }),
    stopProject: async () => undefined,
    stopAll: async () => undefined,
    close: async () => undefined,
  };
}

function fakeAuthRuntime(): NonNullable<PiBackendOptions["authRuntime"]> {
  return {
    getProviders: async () => [],
    getAvailable: async () => [
      {
        provider: "aging-fake",
        id: "aging-model",
        name: "Aging fake model",
        reasoning: true,
        capabilities: { inputFiles: true },
      } as any,
    ],
    login: async () => undefined,
    logout: async () => undefined,
  };
}

function immediateAttachmentRemote(): NonNullable<PiBackendOptions["inputFilesRemote"]> {
  return {
    upload: async ({ bytes, name, mimeType }) => ({
      fileId: `aging-${name}`,
      name,
      size: bytes.byteLength,
      mimeType: mimeType ?? "application/octet-stream",
      digest: "aging-digest",
    }),
    remove: async () => undefined,
  };
}

function pendingAttachmentRemote(probe: AttachmentProbe): NonNullable<PiBackendOptions["inputFilesRemote"]> {
  return {
    upload: async ({ signal, bytes, name, mimeType }) => {
      if (!probe.pending) {
        return {
          fileId: `aging-${name}`,
          name,
          size: bytes.byteLength,
          mimeType: mimeType ?? "application/octet-stream",
          digest: "aging-digest",
        };
      }
      return new Promise((resolve, reject) => {
        signal?.addEventListener("abort", () => {
          probe.aborts += 1;
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    },
    remove: async () => undefined,
  };
}

function makeBackend(
  f: Fixture,
  children: Set<ChildProcessWithoutNullStreams>,
  inputFilesRemote = immediateAttachmentRemote(),
) {
  const env = {
    HOME: f.home,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    TMPDIR: f.root,
    LANG: "C",
    LC_ALL: "C",
  };
  return createPiHostBackend({
    agentDir: f.agentDir,
    sessionsRoot: f.sessions,
    runtimeRoot: f.runtimeRoot,
    piPath: process.execPath,
    env,
    features: {},
    canonicalProjectPaths: async () => undefined,
    authRuntime: fakeAuthRuntime(),
    headroomRuntime: noHeadroomRuntime(),
    inputFilesRemote,
    spawn: (_bin, _args, options) => {
      const child = spawn(process.execPath, [FAKE_PI_PATH], {
        ...options,
        env: {
          ...(options.env ?? env),
          FAKE_AGENT_AGING_STATE_FILE: f.stateFile,
          FAKE_AGENT_AGING_SESSION_FILE: f.sessionFile,
        },
      }) as ChildProcessWithoutNullStreams;
      children.add(child);
      child.once("close", () => children.delete(child));
      return child;
    },
  });
}

function rendererSample(turnId: string) {
  const submittedAt = Date.now() - 3;
  return {
    turnId,
    submittedAt,
    preflightStartedAt: submittedAt + 1,
    preflightEndedAt: submittedAt + 2,
    promptBytes: 16,
    attachmentCount: 0,
    attachmentBytes: 0,
    documentCount: 0,
  };
}

function registryCount(counts: Record<string, number>): number {
  return [
    "live",
    "queue",
    "queueLoad",
    "queueWrite",
    "sessionFileBarrier",
    "context",
    "ledger",
    "modelState",
    "extensionMount",
    "documentInjection",
    "openedDocuments",
    "historyCache",
  ].reduce((total, key) => total + (counts[key] ?? 0), 0);
}

function activeState(state: AgingState) {
  return {
    contextMode: state.contextMode,
    compacted: state.compacted,
    turns: state.turns,
    contextTokens: state.contextTokens,
    requestTokens: state.requestTokens,
    requestBytes: state.requestBytes,
  };
}

function emptyRuntimeCounts(): Record<string, number> {
  return {
    live: 0,
    leaseOperationLane: 0,
    queue: 0,
    queueLoad: 0,
    queueWrite: 0,
    sessionFileBarrier: 0,
    context: 0,
    ledger: 0,
    modelState: 0,
    extensionMount: 0,
    documentInjection: 0,
    openedDocuments: 0,
    historyCache: 0,
    inputBytes: 0,
    inputUploads: 0,
  };
}

function duration(value: number | undefined): string {
  return value === undefined ? "-" : String(value);
}

async function checkpoint(
  backend: ReturnType<typeof createPiHostBackend>,
  f: Fixture,
  children: Set<ChildProcessWithoutNullStreams>,
  backendMode: BackendMode,
  contextMode: ContextMode,
  turn: number,
  baselineListeners: number,
): Promise<CellRow> {
  const turnId = `aging-${backendMode}-${contextMode}-${turn}`;
  await backend.handle("sendPrompt", [SESSION_ID, `aging turn ${turn}`, undefined, rendererSample(turnId)]);
  try {
    await eventually(() => hasTelemetryTurn(f.agentDir, turnId));
  } catch (error) {
    throw new Error(`${backendMode}/${contextMode} turn ${turn}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const stats = await backend.handle("getSessionStats", [SESSION_ID]) as SessionStats;
  const records = await readTelemetry(f.agentDir);
  const record = records.find((item) => item.turnId === turnId);
  if (!record) throw new Error(`missing telemetry record for ${turnId}`);
  const state = await readState(f.stateFile);
  const counts = backend.runtimeStateCounts(SESSION_ID);
  const listeners = processListenerCount();
  const fd = await fdCount();
  const resource = record.resources?.end;
  const phases = new Set(record.phases.map((phase) => phase.name));
  for (const phase of [
    "host_received",
    "host_preparation_start",
    "host_preparation_end",
    "pi_dispatch",
    "pi_agent_start",
    "first_stream",
    "first_thinking",
    "first_text",
    "first_assistant",
    "settled",
  ] as const) expect(phases.has(phase), `missing production phase ${phase} at turn ${turn}`).toBe(true);

  expect(state.turns).toBe(turn);
  expect(record.metrics?.contextTokens).toBe(state.contextTokens);
  expect(record.metrics?.inputTokens).toBe(state.requestTokens);
  expect(record.metrics?.piRpcBytes).toEqual(expect.any(Number));
  expect(stats.contextUsage?.tokens).toBe(state.contextTokens);
  expect(counts.inputBytes).toBe(0);
  expect(counts.inputUploads).toBe(0);
  expect(registryCount(counts)).toBeLessThanOrEqual(MAX_REGISTRY_ENTRIES);
  expect(state.requestBytes).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
  expect(listeners).toBeLessThanOrEqual(baselineListeners + 1);

  return {
    cell: `${backendMode} backend + ${contextMode === "old" ? "old/uncompacted" : "new/compacted"} context`,
    backend: backendMode,
    context: contextMode,
    checkpoint: turn,
    contextTokens: state.contextTokens,
    requestTokens: state.requestTokens,
    requestBytes: state.requestBytes,
    rpcBytes: record.metrics?.piRpcBytes,
    phases: `preflight=${duration(record.durations?.rendererPreflightMs)} queue=${duration(record.durations?.hostQueueMs)} prep=${duration(record.durations?.hostPreparationMs)} dispatch=${duration(record.durations?.piDispatchMs)} ttft=${duration(record.durations?.ttftMs)} gen=${duration(record.durations?.generationMs)} turn=${duration(record.durations?.turnMs)}`,
    listeners,
    registry: registryCount(counts),
    attachments: `${counts.inputBytes}B/${counts.inputUploads}up`,
    rssBytes: resource?.rssBytes,
    fdCount: fd,
    childCount: children.size,
  };
}

async function runCell(
  backendMode: BackendMode,
  contextMode: ContextMode,
  checkpoints: number[],
  baselineListeners: number,
): Promise<CellResult> {
  const f = await fixture();
  const children = new Set<ChildProcessWithoutNullStreams>();
  let backend: ReturnType<typeof createPiHostBackend> | undefined = makeBackend(f, children);
  const rows: CellRow[] = [];
  let cleanupState = emptyRuntimeCounts();
  let currentTurn = 0;
  let restartProofs = 0;
  try {
    if (contextMode === "compacted") {
      await backend.handle("compact", [SESSION_ID]);
      const compacted = await readState(f.stateFile);
      expect(compacted.compacted).toBe(true);
      expect(compacted.contextMode).toBe("compacted");
      expect(compacted.contextTokens).toBe(COMPACTED_CONTEXT_TOKENS);
      expect(compacted.requestTokens).toBe(COMPACTED_CONTEXT_TOKENS + REQUEST_OVERHEAD_TOKENS);
    }

    for (const checkpointTurn of checkpoints) {
      while (currentTurn < checkpointTurn) {
        currentTurn += 1;
        if (!backend) throw new Error("Agent Aging backend was unexpectedly closed");
        const row = await checkpoint(backend, f, children, backendMode, contextMode, currentTurn, baselineListeners);
        if (currentTurn === checkpointTurn) rows.push(row);
      }
      // Checkpoint rows are retained only at the requested boundaries. The
      // production telemetry file still contains every turn for phase proof.

      if (backendMode === "fresh") {
        const before = activeState(await readState(f.stateFile));
        if (!backend) throw new Error("Agent Aging backend was unexpectedly closed");
        const closing = backend;
        await closing.close();
        backend = undefined;
        cleanupState = closing.runtimeStateCounts(SESSION_ID);
        expect(cleanupState).toEqual(emptyRuntimeCounts());
        const after = activeState(await readState(f.stateFile));
        expect(after).toEqual(before);
        expect(children.size).toBe(0);
        expect(processListenerCount()).toBe(baselineListeners);
        restartProofs += 1;
        if (checkpointTurn !== checkpoints.at(-1)) backend = makeBackend(f, children);
      }
    }

    if (backend) {
      const closing = backend;
      await closing.close();
      backend = undefined;
      cleanupState = closing.runtimeStateCounts(SESSION_ID);
      expect(cleanupState).toEqual(emptyRuntimeCounts());
      expect(children.size).toBe(0);
      expect(processListenerCount()).toBe(baselineListeners);
    }
    return { rows, restartProofs, cleanupState };
  } finally {
    await backend?.close().catch(() => undefined);
  }
}

async function runDeletedSessionCleanup(baselineListeners: number): Promise<{ sessions: number; aborts: number }> {
  const f = await fixture();
  const children = new Set<ChildProcessWithoutNullStreams>();
  const probe: AttachmentProbe = { pending: true, aborts: 0 };
  const extraIds = ["aging-delete-1", "aging-delete-2", "aging-delete-3", "aging-delete-4"];
  const sessionDir = join(f.sessions, "project");
  for (const id of extraIds) await writeSession(join(sessionDir, `${id}.jsonl`), id, f.project);

  const backend = makeBackend(f, children, pendingAttachmentRemote(probe));
  try {
    const bytes = Buffer.alloc(4_096, 7);
    for (const id of extraIds) {
      // Cold stats resolves the persisted model row without spawning Pi; the
      // subsequent pending upload exercises retained bytes and abort cleanup.
      await backend.handle("getSessionStats", [id]);
      const staged = backend.handle("stageInputFile", [id, {
        id: `${id}-attachment`,
        name: "aging-fixture.bin",
        size: bytes.byteLength,
        mimeType: "application/octet-stream",
        dataBase64: bytes.toString("base64"),
      }]);
      await eventually(() => {
        const counts = backend.runtimeStateCounts(id);
        return counts.inputBytes === bytes.byteLength && counts.inputUploads === 1;
      });
      await backend.handle("deleteSession", [id]);
      const stagedResult = await staged as { status?: string };
      expect(stagedResult.status).toBe("cancelled");
      expect(backend.runtimeStateCounts(id)).toEqual({
        live: 0,
        leaseOperationLane: 0,
        queue: 0,
        queueLoad: 0,
        queueWrite: 0,
        sessionFileBarrier: 0,
        context: 0,
        ledger: 0,
        modelState: 0,
        extensionMount: 0,
        documentInjection: 0,
        openedDocuments: 0,
        historyCache: 0,
        inputBytes: 0,
        inputUploads: 0,
      });
      await expect(access(join(sessionDir, `${id}.jsonl`))).rejects.toThrow(/ENOENT/);
      expect(processListenerCount()).toBeLessThanOrEqual(baselineListeners + 1);
    }
    expect(probe.aborts).toBe(extraIds.length);
    await backend.close();
    expect(children.size).toBe(0);
    expect(processListenerCount()).toBe(baselineListeners);
    return { sessions: extraIds.length, aborts: probe.aborts };
  } finally {
    await backend.close().catch(() => undefined);
  }
}

function printReport(
  rows: CellRow[],
  checkpoints: number[],
  elapsedMs: number,
  cleanup: { sessions: number; aborts: number },
  restartProofs: number,
): void {
  console.log(`\nAgent Aging benchmark — checkpoints=${checkpoints.join(",")} turns=${checkpoints.at(-1)} elapsed_ms=${Math.round(elapsedMs)} (report-only)`);
  console.table(rows.map((row) => ({
    cell: row.cell,
    checkpoint: row.checkpoint,
    context_tokens: row.contextTokens,
    request_tokens: row.requestTokens,
    request_bytes: row.requestBytes,
    rpc_bytes: row.rpcBytes ?? "-",
    phases: row.phases,
    process_listeners: row.listeners,
    registry: row.registry,
    attachments: row.attachments,
    rss_bytes: row.rssBytes ?? "-",
    fd: row.fdCount ?? "-",
    children: row.childCount,
  })));
  const summary = [...new Map(rows.map((row) => [
    `${row.backend}/${row.context}`,
    row,
  ])).values()].map((row) => ({
    cell: row.cell,
    checkpoints: checkpoints.join(","),
    final_context_tokens: row.contextTokens,
    final_request_tokens: row.requestTokens,
    final_request_bytes: row.requestBytes,
  }));
  console.log("2×2 context summary");
  console.table(summary);
  console.log(`restart_same_state_proofs=${restartProofs} deleted_session_cleanup=${cleanup.sessions} attachment_aborts=${cleanup.aborts}`);
}

describe("Agent Aging benchmark", () => {
  it("defaults direct Vitest runs to every approved checkpoint", () => {
    expect(parseCheckpoints({})).toEqual([...FULL_CHECKPOINTS]);
  });

  it("keeps persisted context/request weight stable across restart and bounds runtime state", async () => {
    const startedAt = performance.now();
    const checkpoints = parseCheckpoints();
    const baselineListeners = processListenerCount();
    const cells: Array<[BackendMode, ContextMode]> = [
      ["old", "old"],
      ["old", "compacted"],
      ["fresh", "old"],
      ["fresh", "compacted"],
    ];
    const results = new Map<string, CellResult>();
    const rows: CellRow[] = [];
    let restartProofs = 0;
    for (const [backend, context] of cells) {
      const result = await runCell(backend, context, checkpoints, baselineListeners);
      results.set(`${backend}/${context}`, result);
      rows.push(...result.rows);
      restartProofs += result.restartProofs;
    }

    for (const checkpointTurn of checkpoints) {
      const oldContext = results.get("old/old")!.rows.find((row) => row.checkpoint === checkpointTurn)!;
      const compactedContext = results.get("old/compacted")!.rows.find((row) => row.checkpoint === checkpointTurn)!;
      const freshOld = results.get("fresh/old")!.rows.find((row) => row.checkpoint === checkpointTurn)!;
      const freshCompacted = results.get("fresh/compacted")!.rows.find((row) => row.checkpoint === checkpointTurn)!;
      const expectedOldContext = OLD_CONTEXT_TOKENS + checkpointTurn * OLD_CONTEXT_STEP;
      const expectedCompactedContext = COMPACTED_CONTEXT_TOKENS + checkpointTurn * COMPACTED_CONTEXT_STEP;
      expect(oldContext.contextTokens).toBe(expectedOldContext);
      expect(oldContext.requestTokens).toBe(expectedOldContext + REQUEST_OVERHEAD_TOKENS);
      expect(oldContext.requestBytes).toBe((expectedOldContext + REQUEST_OVERHEAD_TOKENS) * 4 + REQUEST_OVERHEAD_BYTES);
      expect(compactedContext.contextTokens).toBe(expectedCompactedContext);
      expect(compactedContext.requestTokens).toBe(expectedCompactedContext + REQUEST_OVERHEAD_TOKENS);
      expect(compactedContext.requestBytes).toBe((expectedCompactedContext + REQUEST_OVERHEAD_TOKENS) * 4 + REQUEST_OVERHEAD_BYTES);
      // Restart changes neither persisted active context nor provider request
      // weight. These are deterministic fake-provider measurements, not timing.
      expect(freshOld.contextTokens).toBe(oldContext.contextTokens);
      expect(freshOld.requestTokens).toBe(oldContext.requestTokens);
      expect(freshOld.requestBytes).toBe(oldContext.requestBytes);
      expect(freshCompacted.contextTokens).toBe(compactedContext.contextTokens);
      expect(freshCompacted.requestTokens).toBe(compactedContext.requestTokens);
      expect(freshCompacted.requestBytes).toBe(compactedContext.requestBytes);
      // Compaction is the only operation allowed to lower active weight.
      expect(oldContext.contextTokens).toBeGreaterThan(compactedContext.contextTokens);
      expect(oldContext.requestTokens).toBeGreaterThan(compactedContext.requestTokens);
      expect(oldContext.requestBytes).toBeGreaterThan(compactedContext.requestBytes);
    }

    const deleted = await runDeletedSessionCleanup(baselineListeners);
    expect(processListenerCount()).toBe(baselineListeners);
    printReport(rows, checkpoints, performance.now() - startedAt, deleted, restartProofs);
    expect(restartProofs).toBe(checkpoints.length * 2);
    expect(deleted.aborts).toBe(deleted.sessions);
    // These constants document the deterministic fake-provider model and keep
    // accidental fixture drift from turning the benchmark into a no-op.
    expect(OLD_CONTEXT_TOKENS).toBeGreaterThan(COMPACTED_CONTEXT_TOKENS);
    expect(OLD_CONTEXT_STEP).toBeGreaterThan(COMPACTED_CONTEXT_STEP);
  }, 300_000);
});
