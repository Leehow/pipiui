import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

export const TOOL_BATCH_STATS_FILENAME = "tool-batch-stats.jsonl";
export const TOOL_BATCH_STATS_BACKUP_SUFFIX = ".1";
export const TOOL_BATCH_STATS_VERSION = 1 as const;
/** Default cap for the live JSONL. One rotated backup is kept, so total is ~2× this. */
export const TOOL_BATCH_STATS_MAX_BYTES = 5 * 1024 * 1024;
/** Host close waits this long for already-queued writes, then returns anyway. */
export const TOOL_BATCH_CLOSE_TIMEOUT_MS = 250;

export type ToolBatchConcurrency = "single" | "parallel" | "sequential" | "unknown";

export type ToolBatchStatsRecord = {
  v: typeof TOOL_BATCH_STATS_VERSION;
  ts: string;
  session: string;
  provider: string;
  model: string;
  toolCount: number;
  toolNames: string[];
  wallMs: number | null;
  success: number;
  failure: number;
  cancelled: number;
  concurrency: ToolBatchConcurrency;
};

const ALLOWED_KEYS = [
  "v",
  "ts",
  "session",
  "provider",
  "model",
  "toolCount",
  "toolNames",
  "wallMs",
  "success",
  "failure",
  "cancelled",
  "concurrency",
] as const;

type ToolOutcome = "success" | "failure" | "cancelled" | "pending" | "unknown";

type ToolObs = {
  id: string;
  name: string;
  execStartMs?: number;
  execEndMs?: number;
  outcome: ToolOutcome;
};

type OpenBatch = {
  sessionId: string;
  provider: string;
  model: string;
  openedMs: number;
  tools: Map<string, ToolObs>;
};

export type ToolBatchObserveContext = {
  sessionId: string;
  provider?: string;
  model?: string;
  nowMs?: number;
};

export type ToolBatchTelemetryOptions = {
  agentDir: string;
  now?: () => number;
  append?: (file: string, line: string) => Promise<void>;
  stat?: (file: string) => Promise<{ size: number }>;
  rotate?: (file: string, backup: string) => Promise<void>;
  maxBytes?: number;
  closeTimeoutMs?: number;
  debug?: boolean | (() => boolean);
};

function debugOn(debug?: boolean | (() => boolean)): boolean {
  if (typeof debug === "function") return debug();
  if (debug === true) return true;
  return Boolean(process.env.PIPIUI_STREAM_DEBUG || process.env.PIPIUI_DEBUG);
}

function logDebug(debug: boolean | (() => boolean) | undefined, error: unknown): void {
  if (!debugOn(debug)) return;
  console.debug(`[tool-batch-telemetry] ${error instanceof Error ? error.message : String(error)}`);
}

export function toolBatchStatsPath(agentDir: string): string {
  return join(agentDir, TOOL_BATCH_STATS_FILENAME);
}

export function toolBatchStatsBackupPath(agentDir: string): string {
  return toolBatchStatsPath(agentDir) + TOOL_BATCH_STATS_BACKUP_SUFFIX;
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT");
}

export function classifyConcurrency(
  tools: readonly { execStartMs?: number; execEndMs?: number }[],
): ToolBatchConcurrency {
  if (tools.length <= 1) return tools.length === 1 ? "single" : "unknown";
  const timed = tools.filter(
    (tool) =>
      typeof tool.execStartMs === "number" &&
      Number.isFinite(tool.execStartMs) &&
      typeof tool.execEndMs === "number" &&
      Number.isFinite(tool.execEndMs),
  );
  if (timed.length !== tools.length) return "unknown";
  const sorted = [...timed].sort((a, b) => a.execStartMs! - b.execStartMs!);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.execStartMs! < sorted[i - 1]!.execEndMs!) return "parallel";
  }
  return "sequential";
}

function extractToolCallsFromMessage(message: unknown): { id: string; name: string }[] {
  if (!message || typeof message !== "object") return [];
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const out: { id: string; name: string }[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const type = (part as { type?: unknown }).type;
    if (type !== "toolCall" && type !== "tool_call" && type !== "tool_use") continue;
    const id = (part as { id?: unknown }).id;
    const name = (part as { name?: unknown }).name;
    out.push({
      id: typeof id === "string" && id ? id : `anon-${out.length}`,
      name: typeof name === "string" && name ? name : "tool",
    });
  }
  return out;
}

function outcomeFromEnd(event: any): Exclude<ToolOutcome, "pending"> {
  if (event?.cancelled === true || event?.isCancelled === true) return "cancelled";
  if (event?.isError === true) return "failure";
  if (event?.isError === false) return "success";
  return "unknown";
}

export function serializeToolBatchRecord(record: ToolBatchStatsRecord): string {
  const safe: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) safe[key] = record[key];
  return JSON.stringify(safe) + "\n";
}

async function defaultAppend(file: string, line: string): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true });
  await fs.appendFile(file, line, "utf8");
}

async function defaultStat(file: string): Promise<{ size: number }> {
  try {
    return await fs.stat(file);
  } catch (error) {
    if (isNotFound(error)) return { size: 0 };
    throw error;
  }
}

async function defaultRotate(file: string, backup: string): Promise<void> {
  await fs.rm(backup, { force: true });
  try {
    await fs.rename(file, backup);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
}

function waitWithTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    void promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

function applyModel(batch: OpenBatch, ctx: ToolBatchObserveContext): void {
  if (ctx.provider) batch.provider = ctx.provider;
  if (ctx.model) batch.model = ctx.model;
}

function upsertTools(batch: OpenBatch, calls: { id: string; name: string }[]): void {
  for (const call of calls) {
    const prev = batch.tools.get(call.id);
    batch.tools.set(call.id, {
      id: call.id,
      name: call.name || prev?.name || "tool",
      execStartMs: prev?.execStartMs,
      execEndMs: prev?.execEndMs,
      outcome: prev?.outcome ?? "pending",
    });
  }
}

export function createToolBatchTelemetry(options: ToolBatchTelemetryOptions) {
  const file = toolBatchStatsPath(options.agentDir);
  const backup = toolBatchStatsBackupPath(options.agentDir);
  const now = options.now ?? (() => Date.now());
  const append = options.append ?? defaultAppend;
  const stat = options.stat ?? defaultStat;
  const rotate = options.rotate ?? defaultRotate;
  const maxBytes = options.maxBytes ?? TOOL_BATCH_STATS_MAX_BYTES;
  const closeTimeoutMs = options.closeTimeoutMs ?? TOOL_BATCH_CLOSE_TIMEOUT_MS;
  /** Per session: last still-collecting batch, then any earlier unfinished batches. */
  const sessions = new Map<string, OpenBatch[]>();
  /** Rotation + append share one chain so records stay whole and ordered. */
  let chain = Promise.resolve();

  function enqueue(task: () => Promise<void>): void {
    chain = chain.then(async () => {
      try {
        await task();
      } catch (error) {
        logDebug(options.debug, error);
      }
    });
  }

  async function persist(line: string): Promise<void> {
    try {
      const size = (await stat(file)).size;
      if (size >= maxBytes) await rotate(file, backup);
    } catch (error) {
      logDebug(options.debug, error);
    }
    await append(file, line);
  }

  function list(sessionId: string): OpenBatch[] {
    let batches = sessions.get(sessionId);
    if (!batches) {
      batches = [];
      sessions.set(sessionId, batches);
    }
    return batches;
  }

  function findBatch(sessionId: string, toolCallId: string | undefined): OpenBatch | undefined {
    if (!toolCallId) return undefined;
    const batches = sessions.get(sessionId);
    if (!batches) return undefined;
    for (let i = batches.length - 1; i >= 0; i--) {
      if (batches[i]!.tools.has(toolCallId)) return batches[i];
    }
    return undefined;
  }

  function newBatch(ctx: ToolBatchObserveContext): OpenBatch {
    return {
      sessionId: ctx.sessionId,
      provider: ctx.provider ?? "unknown",
      model: ctx.model ?? "unknown",
      openedMs: ctx.nowMs ?? now(),
      tools: new Map(),
    };
  }

  /**
   * Streaming toolcall_end events belong to the current assembling batch.
   * A later message_end with a disjoint id set starts a new batch so consecutive
   * assistant turns cannot merge.
   */
  function addCalls(ctx: ToolBatchObserveContext, calls: { id: string; name: string }[], fromMessageEnd: boolean): OpenBatch | undefined {
    if (!ctx.sessionId || calls.length === 0) return undefined;
    const batches = list(ctx.sessionId);
    const current = batches[batches.length - 1];
    const ids = new Set(calls.map((call) => call.id));
    const overlaps = current ? [...current.tools.keys()].some((id) => ids.has(id)) : false;
    const startNew = !current || (fromMessageEnd && !overlaps && current.tools.size > 0);
    const batch = startNew ? newBatch(ctx) : current;
    if (startNew) batches.push(batch);
    applyModel(batch, ctx);
    upsertTools(batch, calls);
    return batch;
  }

  function drop(batch: OpenBatch): void {
    const batches = sessions.get(batch.sessionId);
    if (!batches) return;
    const index = batches.indexOf(batch);
    if (index >= 0) batches.splice(index, 1);
    if (batches.length === 0) sessions.delete(batch.sessionId);
  }

  function maybeComplete(batch: OpenBatch): void {
    if (batch.tools.size === 0) return;
    for (const tool of batch.tools.values()) {
      if (tool.outcome === "pending" || tool.execEndMs === undefined) return;
    }
    drop(batch);
    emit(batch);
  }

  function emit(batch: OpenBatch): void {
    const tools = [...batch.tools.values()];
    const ends = tools.map((tool) => tool.execEndMs).filter((value): value is number => typeof value === "number");
    const starts = tools
      .map((tool) => tool.execStartMs)
      .filter((value): value is number => typeof value === "number");
    const wallMs =
      ends.length === tools.length && tools.length > 0
        ? Math.max(0, Math.max(...ends) - (starts.length === tools.length ? Math.min(...starts) : batch.openedMs))
        : null;
    const record: ToolBatchStatsRecord = {
      v: TOOL_BATCH_STATS_VERSION,
      ts: new Date(now()).toISOString(),
      session: batch.sessionId,
      provider: batch.provider || "unknown",
      model: batch.model || "unknown",
      toolCount: tools.length,
      toolNames: tools.map((tool) => tool.name),
      wallMs,
      success: tools.filter((tool) => tool.outcome === "success").length,
      failure: tools.filter((tool) => tool.outcome === "failure").length,
      cancelled: tools.filter((tool) => tool.outcome === "cancelled").length,
      concurrency: classifyConcurrency(tools),
    };
    enqueue(() => persist(serializeToolBatchRecord(record)));
  }

  function observeRpc(event: any, ctx: ToolBatchObserveContext): void {
    try {
      if (!event || typeof event !== "object" || !ctx.sessionId) return;
      const at = ctx.nowMs ?? now();
      if (event.type === "message_update") {
        const d = event.assistantMessageEvent ?? {};
        if (d.type !== "toolcall_end") return;
        const call = d.toolCall ?? {};
        const id = typeof call.id === "string" && call.id ? call.id : undefined;
        if (!id) return;
        addCalls(ctx, [{ id, name: typeof call.name === "string" && call.name ? call.name : "tool" }], false);
        return;
      }
      if (event.type === "message_end") {
        const message = event.message ?? {};
        if (message.role && message.role !== "assistant") return;
        const calls = extractToolCallsFromMessage(message);
        if (calls.length === 0) return;
        addCalls(ctx, calls, true);
        return;
      }
      if (event.type === "tool_execution_start") {
        const id = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
        const batch = findBatch(ctx.sessionId, id);
        if (!batch || !id) return;
        const tool = batch.tools.get(id);
        if (!tool) return;
        tool.execStartMs = at;
        if (typeof event.toolName === "string" && event.toolName) tool.name = event.toolName;
        return;
      }
      if (event.type === "tool_execution_end") {
        const id = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
        if (!id) return;
        let batch = findBatch(ctx.sessionId, id);
        if (!batch) {
          batch = addCalls(
            ctx,
            [{ id, name: typeof event.toolName === "string" && event.toolName ? event.toolName : "tool" }],
            false,
          );
        }
        if (!batch) return;
        const tool = batch.tools.get(id);
        if (!tool) return;
        tool.execEndMs = at;
        tool.outcome = outcomeFromEnd(event);
        maybeComplete(batch);
      }
    } catch (error) {
      logDebug(options.debug, error);
    }
  }

  function flushSession(sessionId: string): void {
    const batches = sessions.get(sessionId);
    if (!batches?.length) return;
    sessions.delete(sessionId);
    for (const batch of batches) emit(batch);
  }

  function dispose(): void {
    for (const sessionId of [...sessions.keys()]) flushSession(sessionId);
  }

  async function drain(timeoutMs = closeTimeoutMs): Promise<void> {
    await waitWithTimeout(chain, timeoutMs);
  }

  async function close(timeoutMs = closeTimeoutMs): Promise<void> {
    dispose();
    await drain(timeoutMs);
  }

  return {
    file,
    observeRpc,
    flushSession,
    dispose,
    drain,
    close,
    pending: () => chain,
  };
}

export type ToolBatchTelemetry = ReturnType<typeof createToolBatchTelemetry>;
