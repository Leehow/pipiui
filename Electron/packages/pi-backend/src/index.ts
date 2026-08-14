import { ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, readFileSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";

import {
  PIPI_HOST_PROTOCOL_VERSION,
  THINKING_LEVELS,
  documentKindForName,
  resolveThinkingLevel,
  thinkingLevelsForModel,
  type AgentDefinition,
  type AgentEvent,
  type AgentSummary,
  type AuthLoginEvent,
  type AuthProviderInfo,
  type AuthType,
  type DocumentContent,
  type DocumentErrorCode,
  type HostBackend,
  type HostEvent,
  type HostMethod,
  type HistoryEntry,
  type HistoryTool,
  type Model,
  type ModelState,
  type PromptAttachment,
  type Project,
  type QueueEnqueueResult,
  type QuotaSnapshot,
  type Session,
  type SessionStats,
  type SubagentModelSetting,
  type ThinkingLevel,
  type ThinkingLevelMap,
  type WorktreeStatus,
} from "@pipi/host-api";
import {
  assemblePiSpawn,
  defaultRuntimeRoot,
  mergedSpawnEnvironment,
  resolvePiExecutable,
  resolveSpawnPaths,
  withToolPath,
  type ComputerDescriptor,
  type PiCommand,
  type SpawnFeatures,
} from "./spawn-assembly.js";
import { installRuntimeTree, type RuntimeAssets } from "./runtime-install.js";
import { LeaseManager } from "./lease.js";
import { checkoutBranch, probeGit } from "./git.js";
import { HostBridge } from "./bridge.js";
import { DEFAULT_FEATURES } from "./features.js";
import { ProviderAuthBackend, type AuthRuntimeLike } from "./provider-auth.js";
import { ExternalAuthRuntime } from "./external-auth-runtime.js";
import {
  SessionMessageQueue,
  type DispatchBehavior,
  type QueuedDispatchPayload,
  type QueuedMessage,
} from "./message-queue.js";
import { FileQueueStore, type QueueStore } from "./queue-store.js";
import { QuotaStore, parseDotEnv } from "./quota.js";
import {
  appendLedgerRecord,
  latestContextBySession,
  readLedgerFile,
} from "./token-ledger.js";
import {
  ProactiveCompactionScheduler,
  type ProactiveCompactionConfiguration,
} from "./proactive-compaction.js";
import {
  generateModelSessionTitle,
  isPlaceholderSessionTitle,
  provisionalSessionTitle,
} from "./session-title.js";
export {
  ProactiveCompactionPolicy,
  ProactiveCompactionScheduler,
  STANDARD_PROACTIVE_COMPACTION,
  contextUsageFraction,
  type ContextUsageLike,
  type ProactiveCompactionConfiguration,
} from "./proactive-compaction.js";
export {
  ensureManagedPackage,
  ensureManagedPackages,
  globallyRegistered,
  resolveNpmExecutable,
  type ManagedInstall,
} from "./managed-npm.js";
export {
  assemblePiSpawn,
  defaultRuntimeRoot,
  MANAGED_PACKAGES,
  mergedSpawnEnvironment,
  type ManagedPackage,
  resolvePiExecutable,
  resolveSpawnPaths,
  sanitizeEnvironment,
  withElectronRunAsNode,
  withToolPath,
  type PiCommand,
} from "./spawn-assembly.js";
export {
  HostBridge,
  type BridgeAgentEvent,
  type BridgeHandlers,
} from "./bridge.js";
export { DEFAULT_FEATURES } from "./features.js";

const MAX_TEXT_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_BINARY_DOCUMENT_BYTES = 50 * 1024 * 1024;
export class DocumentReadError extends Error {
  constructor(readonly code: DocumentErrorCode, message: string) {
    super(message);
    this.name = "DocumentReadError";
  }
}

function documentError(code: DocumentErrorCode, message: string): DocumentReadError {
  return new DocumentReadError(code, message);
}

async function readBoundedFile(handle: Awaited<ReturnType<typeof fs.open>>, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= limit) {
    const chunk = Buffer.allocUnsafe(Math.min(1024 * 1024, limit + 1 - total));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, total);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead));
    total += bytesRead;
  }
  if (total > limit) throw documentError("document_too_large", `Document is too large (maximum ${limit} bytes)`);
  return Buffer.concat(chunks, total);
}

export async function readLocalDocument(input: unknown): Promise<DocumentContent> {
  if (typeof input !== "string" || !input.trim())
    throw documentError("document_invalid_path", "document path is required");
  const path = input.trim();
  if (!isAbsolute(path)) throw documentError("document_invalid_path", "document path must be absolute");
  const kind = documentKindForName(extname(path));
  if (!kind)
    throw documentError("document_unsupported_type", "unsupported document type; allowed: .md, .markdown, .txt, .pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx");
  const limit = kind === "markdown" || kind === "plain" ? MAX_TEXT_DOCUMENT_BYTES : MAX_BINARY_DOCUMENT_BYTES;

  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(path, "r");
  } catch (error: any) {
    if (error?.code === "ENOENT") throw documentError("document_not_found", `Document does not exist: ${path}`);
    throw documentError("document_read_failed", `Cannot open document: ${path}`);
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw documentError("document_not_file", `Document is not a regular file: ${path}`);
    if (stat.size > limit)
      throw documentError("document_too_large", `Document is too large (maximum ${limit} bytes)`);

    // Read through the validated handle in bounded chunks. The cap+1 probe also
    // catches a file that grows between stat and read without a large up-front allocation.
    const buffer = await readBoundedFile(handle, limit);
    const summary = {
      id: path,
      name: basename(path),
      path,
      kind,
      size: buffer.byteLength,
      updatedAt: stat.mtimeMs,
    };
    if (kind === "markdown" || kind === "plain")
      return { ...summary, kind, content: buffer.toString("utf8") };
    return {
      ...summary,
      kind,
      bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    };
  } catch (error) {
    if (error instanceof DocumentReadError) throw error;
    throw documentError("document_read_failed", `Cannot read document: ${path}`);
  } finally {
    await handle.close();
  }
}
export {
  BOSS_MUTATION_TOOL_NAMES,
  mainSessionExcludeToolArgs,
  resolveMainSessionExcludedTools,
  type MainToolPolicyInput,
} from "./main-tool-policy.js";
export {
  installRuntimeTree,
  syncTree,
  treeSignature,
  type InstallReport,
  type RuntimeAssets,
} from "./runtime-install.js";
export {
  checkoutBranch,
  githubBrowserURL,
  parsePorcelain,
  parseUpstreamCounts,
  probeGit,
  validateBranchName,
} from "./git.js";
export {
  LeaseManager,
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_TTL_MS,
  LEASE_PROTOCOL_VERSION,
  type LeaseRecord,
  type LeaseStatus,
} from "./lease.js";
export {
  SessionMessageQueue,
  type DispatchBehavior,
  type DispatchHandler,
  type EnqueueInput,
  type EnqueueResult,
  type QueueChangeListener,
  type QueuedAttachment,
  type QueuedDispatchPayload,
  type QueuedMessage,
  type QueuedMessageState,
  type SessionMessageQueueOptions,
} from "./message-queue.js";
export { FileQueueStore, type QueueStore } from "./queue-store.js";
export {
  ledgerLine,
  parseLedgerLine,
  readLedgerFile,
  appendLedgerRecord,
  latestContextBySession,
  type LedgerContextRecord,
  type SessionLastContext,
} from "./token-ledger.js";
export {
  BALANCE_ACCOUNT_LABEL,
  balanceProviderFor,
  codexWindowLabel,
  CODEX_USAGE_URL,
  DEEPSEEK_BALANCE_URL,
  deepSeekApiKey,
  fetchCodexQuota,
  fetchDeepSeekBalance,
  parseCodexAuth,
  parseCodexUsageWindows,
  parseDeepSeekBalance,
  parseDotEnv,
  QUOTA_ACCOUNT_LABELS,
  quotaProviderFor,
  QuotaStore,
  QUOTA_STALE_AFTER_MS,
  type BalanceProviderKind,
  type CodexCredentials,
  type QuotaFetchDeps,
  type QuotaProviderKind,
} from "./quota.js";

type Rpc = Record<string, any>;

/** Swift `AgentCatalog.builtInAgents` parity for the Electron settings surface. */
const BUILT_IN_AGENT_DEFINITIONS: AgentDefinition[] = [
  { name: "explore", description: "Grok-style research agent. Searches the web and the repository, reads, greps, and runs shell, but does not edit files." },
  { name: "plan", description: "Grok-style planning agent. Explores and produces an implementation plan; does not edit files." },
  { name: "general-purpose", description: "Grok-style full-capability worker. Implements tasks in an isolated context." },
  { name: "reviewer", description: "Read-only code review specialist for quality and security." },
  { name: "computer-use-leader", description: "Computer Use supervisor. Plans desktop work, receives every private worker result, owns recovery decisions, and returns the single final report." },
  { name: "operator", description: "Computer-use desktop worker. Performs macOS desktop operations and returns a compressed text verdict; does not edit code files." },
  { name: "computer-verifier", description: "Observe-only Computer Use verifier. Takes a fresh desktop observation and independently checks the Leader's requested postconditions." },
  { name: "computer-terminal", description: "Bounded terminal worker using an attenuated one-run Host tool broker; receives no desktop capability." },
  { name: "secretary", description: "Boss closeout secretary. Reconciles agent outcomes, worktrees, branches, verification, temporary artifacts, and the existing Boss ledger without creating another worktree." },
  { name: "long-test", description: "Long-running test runner. Executes end-to-end suites, integration/regression sweeps, opt-in long tests, and cross-repo E2E harnesses; reports pass/fail without fixing code." },
];

type ProcFactory = (
  bin: string,
  args: string[],
  options: any,
) => ChildProcessWithoutNullStreams;
export type PiBackendOptions = {
  /** Explicit Pi process invocation. Packaged Electron supplies bundled Node + unpacked Pi CLI. */
  piCommand?: PiCommand;
  /** Legacy/development shorthand for a directly executable external `pi`. */
  piPath?: string;
  sessionsRoot?: string;
  /** App-specific installed extension tree. */ runtimeRoot?: string;
  /** Real on-disk node_modules containing the two bundled, pinned managed extensions. */
  managedNodeModulesRoot?: string;
  /**
   * Shipped extension sources. When set, the runtime tree is refreshed from them before every
   * spawn, so an edit under the Electron runtime source reaches the next session without
   * relaunching the host — installing only at startup left exactly those files stale in a running
   * dev app, which is the divergence this whole path exists to close. Signature-gated: an
   * unchanged tree costs a few milliseconds and writes nothing.
   */
  runtimeAssets?: RuntimeAssets;
  agentDir?: string;
  /** Bind Pi children to agentDir/sessionsRoot instead of inheriting their ambient profile. */
  profileMode?: "default" | "isolated";
  /** Disable Pi's ambient resource discovery while retaining explicit mounts assembled here. */
  resourceMode?: "default" | "explicit";
  features?: SpawnFeatures;
  spawn?: ProcFactory;
  env?: NodeJS.ProcessEnv;
  browserAction?: (
    request: Record<string, unknown>,
    sessionId: string,
  ) => Promise<Record<string, unknown>>;
  terminalAction?: (
    request: Record<string, unknown>,
    sessionId: string,
  ) => Promise<Record<string, unknown>>;
  terminalSessionDeleted?: (sessionId: string) => void;
  computerAction?: (
    request: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  computerDescriptor?: ComputerDescriptor;
  computerUsable?: () => boolean;
  /** Injectable pi auth runtime for tests; defaults to ModelRuntime in-process. */ authRuntime?: AuthRuntimeLike;
  /** Packaged helper for the external Pi/Node runtime used by the Electron host. */ authHelperPath?: string;
  authNodePath?: string;
  /** Injectable queue persistence; defaults to ~/.pi/agent/pipiui-queues. */ queueStore?: QueueStore;
  /** Injectable account-quota store for tests; defaults to the real Codex fetch. */ quotaStore?: QuotaStore;
  /** Watermarks/delays for idle-time compaction; defaults to the Swift app's. */
  compaction?: ProactiveCompactionConfiguration;
  /** Testable canonical Swift project source; undefined preserves existing host state. */
  canonicalProjectPaths?: () => Promise<string[] | undefined>;
};

async function swiftCanonicalProjectPaths(env: NodeJS.ProcessEnv): Promise<string[] | undefined> {
  if (process.platform !== "darwin") return undefined;
  const home = env.HOME || homedir();
  const plist = join(home, "Library", "Preferences", "com.leehow.pipiui.plist");
  return new Promise(resolveValue => {
    execFile("/usr/bin/plutil", ["-extract", "pipiui\\.projects", "json", "-o", "-", plist], { env }, (error, stdout) => {
      if (error) { resolveValue(undefined); return; }
      try {
        const value: unknown = JSON.parse(stdout);
        resolveValue(Array.isArray(value) && value.every(path => typeof path === "string" && path.length > 0) ? [...new Set(value)] : undefined);
      } catch { resolveValue(undefined); }
    });
  });
}
type Live = {
  session: Session;
  path: string;
  cwd: string;
  process?: ChildProcessWithoutNullStreams;
  exit?: Promise<void>;
  exitError?: PiExitedError;
  buffer: string;
  stderrTail: string;
  pending: Map<
    string,
    { resolve: (data: any) => void; reject: (e: Error) => void }
  >;
  followUps: string[];
  /** contentIndex → streamed tool-args JSON, assembled from toolcall_delta until toolcall_end. */
  toolArgs: Map<number, string>;
  /** Pi restarts contentIndex at every assistant message; this epoch lets the UI
   *  tell same-index content from different messages apart within one turn. */
  messageEpoch: number;
  /** Idle-time context compaction; also tracks pi's own compaction lifecycle. */
  compaction: ProactiveCompactionScheduler;
  /**
   * This compaction started outside a turn, so it — not `agent_settled` — owns
   * the queue's busy flag until `compaction_end`. Prompts typed meanwhile wait
   * in the normal queue instead of racing pi mid-compaction.
   */
  compactionHoldsQueue?: boolean;
  /**
   * A successful host abort owns the turn's terminal semantics. Pi may emit a
   * later generic `agent_settled` (or no terminal event at all), but neither
   * case may turn an interrupted UI back into a completed one.
   */
  hostAbortedTurn?: boolean;
};
const PI_STDERR_TAIL_LIMIT = 16 * 1024;
class PiExitedError extends Error {
  constructor(
    readonly code: number | null,
    readonly signal: NodeJS.Signals | null,
    stderrTail: string,
  ) {
    const status = code !== null
      ? `code ${code}`
      : signal
        ? `signal ${signal}`
        : "unknown status";
    const diagnostic = stderrTail.trim();
    super(`pi exited (${status})${diagnostic ? `: ${diagnostic}` : ""}`);
    this.name = "PiExitedError";
  }
}
const text = (content: any) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((p) => p.text ?? p.thinking ?? "").join("")
      : "";
const SCREENSHOT_MARKER = /\[PIPIUI_COMPUTER_SCREENSHOT:([^\]]+)\]/g;
/** Extract display text and inline images from a tool-result content payload.
 *  Handles structured `{type:"image"}` parts and resolves computer-use markers
 *  from the in-process screenshot cache. Markers without a cache hit are stripped
 *  from the display text so the user never sees raw marker syntax. */
function extractResult(content: any, screenshots?: Map<string, { data: string; mimeType: string }>): { text: string; images: { data: string; mimeType: string }[] } {
  if (typeof content === "string") {
    const { text: clean, images } = resolveMarkers(content, screenshots)
    return { text: clean, images }
  }
  if (!Array.isArray(content)) return { text: "", images: [] }
  const textParts: string[] = []
  const images: { data: string; mimeType: string }[] = []
  for (const part of content) {
    if (!part || typeof part !== "object") continue
    if (part.type === "image") {
      const data = part.data ?? part.source?.data ?? part.source?.url
      const mimeType = part.mimeType ?? part.source?.mediaType ?? part.source?.mime_type
      if (typeof data === "string" && data.length > 0) images.push({ data, mimeType: mimeType ?? "image/png" })
    } else {
      textParts.push(part.text ?? part.thinking ?? "")
    }
  }
  const { text: clean, images: markerImages } = resolveMarkers(textParts.join(""), screenshots)
  return { text: clean, images: [...images, ...markerImages] }
}
function resolveMarkers(textContent: string, screenshots?: Map<string, { data: string; mimeType: string }>): { text: string; images: { data: string; mimeType: string }[] } {
  if (!screenshots || !textContent.includes("PIPIUI_COMPUTER_SCREENSHOT")) return { text: textContent, images: [] }
  const images: { data: string; mimeType: string }[] = []
  let match
  SCREENSHOT_MARKER.lastIndex = 0
  while ((match = SCREENSHOT_MARKER.exec(textContent)) !== null) {
    const shot = screenshots.get(match[1])
    if (shot) images.push(shot)
  }
  return { text: textContent.replace(SCREENSHOT_MARKER, "").trim(), images }
}
const emitFrame = (listeners: Set<(e: HostEvent) => void>, event: HostEvent) =>
  listeners.forEach((l) => l(event));
function asTime(value: any): number {
  const n = Date.parse(value ?? "");
  return Number.isFinite(n) ? n : Date.now();
}
function history(entries: any[]): HistoryEntry[] {
  return entries
    .filter((e) => e?.type === "message")
    .map((e) => {
      const m = e.message ?? {};
      const role = m.role === "toolResult" ? "tool" : m.role;
      return {
        id: e.id,
        role: role === "assistant" || role === "tool" ? role : "user",
        content: text(m.content),
        timestamp: asTime(e.timestamp ?? m.timestamp),
      };
    });
}
type SessionMeta = {
  path: string;
  header: any;
  name?: string;
  updatedAt: number;
  /** Latest `model_change` entry in the JSONL (provider/modelId), when present. */
  model?: { provider: string; modelId: string } | null;
  /** Latest persisted Pi thinking level, when the session recorded one. */
  thinkingLevel?: ThinkingLevel;
};
const METADATA_HEAD_BYTES = 64 * 1024,
  METADATA_TAIL_BYTES = 64 * 1024;
function parseLines(data: string): any[] {
  const result: any[] = [];
  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    try {
      result.push(JSON.parse(line));
    } catch {
      /* a partial tail record is expected */
    }
  }
  return result;
}
function sessionName(records: any[]): string | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (
      r?.type === "session_info" &&
      typeof r.name === "string" &&
      r.name.trim()
    )
      return r.name.trim();
  }
  for (const r of records) {
    if (r?.type === "message" && r.message?.role === "user") {
      const value = text(r.message.content).trim();
      if (value) return value.slice(0, 80);
    }
  }
}
/** Latest `model_change` row in file order (pi persists the session model as a model_change entry). */
function sessionModelFromRows(rows: any[]): { provider: string; modelId: string } | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (
      r?.type === "model_change" &&
      typeof r.provider === "string" &&
      r.provider &&
      typeof r.modelId === "string" &&
      r.modelId
    )
      return { provider: r.provider, modelId: r.modelId };
  }
  return null;
}
/** Latest valid `thinking_level_change` row in file order. */
function sessionThinkingLevelFromRows(rows: any[]): ThinkingLevel | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (
      row?.type === "thinking_level_change" &&
      THINKING_LEVELS.includes(row.thinkingLevel)
    )
      return row.thinkingLevel;
  }
}
/** Bounded metadata probe: header plus a small head/tail window, never a full JSONL parse. */
async function readSessionMeta(path: string): Promise<SessionMeta> {
  const stat = await fs.stat(path);
  const handle = await fs.open(path, "r");
  try {
    const head = Buffer.alloc(Math.min(METADATA_HEAD_BYTES, stat.size));
    await handle.read(head, 0, head.length, 0);
    const headRows = parseLines(head.toString("utf8"));
    const header = headRows.find((row) => row?.type === "session");
    if (!header?.id || typeof header.cwd !== "string")
      throw new Error("invalid session header");
    const tailLength = Math.min(METADATA_TAIL_BYTES, stat.size);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, Math.max(0, stat.size - tailLength));
    const tailRows = parseLines(tail.toString("utf8"));
    const rows = [...headRows, ...tailRows];
    const last = [...rows]
      .reverse()
      .find((row) => typeof row?.timestamp === "string");
    const timestamp = Date.parse(last?.timestamp ?? "");
    return {
      path,
      header,
      name: sessionName(rows),
      updatedAt: Number.isFinite(timestamp) ? timestamp : stat.mtimeMs,
      model: sessionModelFromRows(rows),
      thinkingLevel: sessionThinkingLevelFromRows(rows),
    };
  } finally {
    await handle.close();
  }
}

/** Atomically replace only the JSONL session header without loading a large transcript into memory. */
async function rewriteSessionCwd(path: string, cwd: string): Promise<void> {
  const stat = await fs.stat(path);
  const handle = await fs.open(path, "r");
  let firstNewline = -1;
  let header: any;
  try {
    const head = Buffer.alloc(Math.min(METADATA_HEAD_BYTES, stat.size));
    await handle.read(head, 0, head.length, 0);
    firstNewline = head.indexOf(0x0a);
    const firstLine = head.subarray(0, firstNewline < 0 ? head.length : firstNewline).toString("utf8").trim();
    header = JSON.parse(firstLine);
    if (header?.type !== "session" || typeof header.id !== "string" || typeof header.cwd !== "string")
      throw new Error("invalid session header");
  } finally {
    await handle.close();
  }
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  try {
    await fs.writeFile(tmp, JSON.stringify({ ...header, cwd }) + "\n", { mode: stat.mode });
    if (firstNewline >= 0 && firstNewline + 1 < stat.size)
      await pipeline(createReadStream(path, { start: firstNewline + 1 }), createWriteStream(tmp, { flags: "a" }));
    await fs.rename(tmp, path);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}
/**
 * Map one session message into a transcript entry, preserving the tool/turn
 * structure (thinking + toolCall parts on assistant, toolCallId on toolResult)
 * so resumed sessions render the same folded cards as the live stream.
 */
function historyEntryFromMessage(entry: any): HistoryEntry | undefined {
  const message = entry.message ?? {};
  const role = message.role === "toolResult" ? "tool" : message.role;
  if (role !== "user" && role !== "assistant" && role !== "tool") return undefined;
  const content = message.content;
  let textPart = "";
  let thinking: string | undefined;
  let tools: HistoryTool[] | undefined;
  let activities: NonNullable<HistoryEntry["activities"]> | undefined;
  let images: { data: string; mimeType: string }[] | undefined;
  if (typeof content === "string") {
    textPart = content;
  } else if (Array.isArray(content)) {
    for (const [contentIndex, part] of content.entries()) {
      if (!part || typeof part !== "object") continue;
      if (part.type === "text") {
        const fragment = part.text ?? "";
        textPart += fragment;
        if (fragment) {
          activities = activities ?? [];
          activities.push({ type: "text", contentIndex, content: fragment });
        }
      }
      else if (part.type === "thinking") {
        const fragment = part.thinking ?? "";
        thinking = (thinking ?? "") + fragment;
        activities = activities ?? [];
        activities.push({ type: "thinking", contentIndex, content: fragment });
      }
      else if (part.type === "image") {
        const imgData = part.data ?? part.source?.data;
        const imgMime = part.mimeType ?? part.source?.mediaType;
        if (typeof imgData === "string" && imgData.length > 0) {
          images = images ?? [];
          images.push({ data: imgData, mimeType: imgMime ?? "image/png" });
        }
      }
      else if (part.type === "toolCall") {
        const args = part.arguments;
        tools = tools ?? [];
        const tool = {
          id: String(part.id ?? ""),
          name: String(part.name ?? "tool"),
          input:
            args != null && typeof args === "object"
              ? JSON.stringify(args)
              : String(args ?? ""),
        };
        tools.push(tool);
        activities = activities ?? [];
        activities.push({ type: "tool", contentIndex, tool });
      }
    }
  }
  // Strip computer-use screenshot markers from display text (past-session
  // screenshots are not in the in-memory cache, so they can't be resolved).
  if (textPart.includes("PIPIUI_COMPUTER_SCREENSHOT")) {
    textPart = textPart.replace(SCREENSHOT_MARKER, "").trim();
    SCREENSHOT_MARKER.lastIndex = 0;
  }
  const result: HistoryEntry = {
    id: entry.id,
    role,
    content: textPart,
    timestamp: asTime(entry.timestamp ?? message.timestamp),
  };
  if (thinking) result.thinking = thinking;
  if (tools && tools.length) result.tools = tools;
  if (activities && activities.length) result.activities = activities;
  if (images && images.length) result.images = images;
  if (message.role === "toolResult") {
    result.toolCallId = message.toolCallId;
    result.toolName = message.toolName;
    result.isError = Boolean(message.isError);
  }
  if (role === "assistant" && message.stopReason === "error") {
    const errorMessage =
      typeof message.errorMessage === "string" && message.errorMessage
        ? message.errorMessage
        : undefined;
    if (errorMessage) result.errorMessage = errorMessage;
  }
  return result;
}
/** History is opened on demand and parsed incrementally; listing never reaches this path. */
async function readHistoryFallback(
  path: string,
  offset = 0,
  limit = 500,
): Promise<HistoryEntry[]> {
  const result: HistoryEntry[] = [];
  let seen = 0;
  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "message") continue;
    if (seen++ < offset) continue;
    const mapped = historyEntryFromMessage(entry);
    if (!mapped) continue;
    result.push(mapped);
    if (result.length >= limit) break;
  }
  return result;
}
const SESSION_MANAGER_MAX_BYTES = 4 * 1024 * 1024;
let sessionManagerModule: Promise<{ SessionManager: any }> | undefined;
async function loadSessionManager() {
  return (sessionManagerModule ??=
    import("@earendil-works/pi-coding-agent") as Promise<{
      SessionManager: any;
    }>);
}
/** Uses pi's active-branch/compaction semantics for bounded-size files. Large files stay on the streaming fallback. */
async function readHistory(
  path: string,
  offset = 0,
  limit = 500,
): Promise<HistoryEntry[]> {
  const stat = await fs.stat(path);
  if (stat.size > SESSION_MANAGER_MAX_BYTES) {
    console.warn(
      `[pipi-backend] SessionManager skipped for ${path}: ${stat.size} bytes exceeds bounded history limit`,
    );
    return readHistoryFallback(path, offset, limit);
  }
  try {
    const { SessionManager } = await loadSessionManager();
    const manager = SessionManager.open(path);
    const entries = manager.buildContextEntries();
    const visible: HistoryEntry[] = [];
    for (const entry of entries as any[]) {
      if (entry.type === "message") {
        const mapped = historyEntryFromMessage(entry);
        if (mapped) visible.push(mapped);
      } else if (entry.type === "custom_message" && entry.display) {
        visible.push({
          id: entry.id,
          role: "user",
          content: text(entry.content),
          timestamp: asTime(entry.timestamp),
        });
      } else if (entry.type === "compaction" && entry.summary) {
        visible.push({
          id: entry.id,
          role: "assistant",
          content: entry.summary,
          timestamp: asTime(entry.timestamp),
        });
      }
    }
    return visible.slice(offset, offset + limit);
  } catch (error) {
    console.warn(
      `[pipi-backend] SessionManager fallback for ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return readHistoryFallback(path, offset, limit);
  }
}
function dirId(path: string) {
  return Buffer.from(path).toString("base64url");
}
const num = (value: any) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const nonEmpty = (value: any): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;
/** `usage` reports whole counts; 0 is meaningful, but a missing field must not overwrite a known one. */
const num2 = (value: any): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
/** pi model refs are `provider/id`; `start` may send null before the model resolves. */
const modelRef = (value: any): string | undefined => nonEmpty(value);
const providerOf = (ref?: string): string | undefined => {
  const provider = ref?.split("/")[0];
  return provider && provider !== ref ? provider : undefined;
};
const isRecord = (value: any): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/** Mirrors Swift ModelInfo.supportsImages: pi `input` array when present, else heuristic. */
function supportsImagesFor(
  modelId: string,
  provider: string,
  input?: unknown,
): boolean {
  if (Array.isArray(input)) return input.some((x) => x === "image");
  const p = provider.toLowerCase(),
    m = modelId.toLowerCase();
  if (p.includes("deepseek") || m.includes("deepseek")) return false;
  const visionHints = [
    "gpt-4o",
    "claude-3",
    "claude-4",
    "claude-5",
    "gemini",
    "qwen-vl",
    "glm-4v",
    "glm-5v",
    "llava",
    "moondream",
    "vision",
  ];
  if (visionHints.some((h) => p.includes(h) || m.includes(h))) return true;
  if (m.includes("vl") || p.includes("vl")) return true;
  return true;
}
function thinkingLevelMapFrom(value: unknown): ThinkingLevelMap | undefined {
  if (!isRecord(value)) return undefined;
  const result: ThinkingLevelMap = {};
  for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const) {
    const mapped = value[level];
    if (typeof mapped === "string" || mapped === null) result[level] = mapped;
  }
  return result;
}
/** Reduce Pi's provider-shaped model into the small capability contract renderers need. */
function hostModelFromPi(raw: any, fallbackProvider?: string, inherited: any = {}): Model {
  const provider = raw?.provider ?? fallbackProvider ?? inherited?.provider ?? "unknown";
  const id = raw?.id ?? "unknown";
  const reasoning = typeof raw?.reasoning === "boolean"
    ? raw.reasoning
    : (typeof inherited?.reasoning === "boolean" ? inherited.reasoning : undefined);
  const thinkingLevelMap = thinkingLevelMapFrom(raw?.thinkingLevelMap ?? inherited?.thinkingLevelMap);
  let thinkingConfigurable: boolean | undefined;
  if (reasoning === false) {
    thinkingConfigurable = false;
  } else if (reasoning === true && thinkingLevelMap) {
    thinkingConfigurable = thinkingLevelsForModel({ provider, id, name: raw?.name ?? id, reasoning, thinkingLevelMap }).length > 0;
  } else if (reasoning === true) {
    thinkingConfigurable = true;
  }
  return {
    provider,
    id,
    name: raw?.name ?? id,
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
    ...(thinkingConfigurable === undefined ? {} : { thinkingConfigurable }),
    supportsImages: supportsImagesFor(id, provider, raw?.input ?? inherited?.input),
  };
}
const ATTACHMENT_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
function sanitizeAttachmentName(
  name: string | undefined,
  fallback: string,
): string {
  const base = basename(name ?? "");
  const safe = base.replace(/[^\w.\-() ]/g, "").trim();
  return safe || fallback;
}
type CachedAgentLog = { itemType: string; text: string; name?: string; isError?: boolean; contentIndex?: number };
function isCachedAgentLog(value: unknown): value is CachedAgentLog {
  if (!isRecord(value) || typeof value.itemType !== "string" || typeof value.text !== "string") return false;
  if (value.name !== undefined && typeof value.name !== "string") return false;
  if (value.isError !== undefined && typeof value.isError !== "boolean") return false;
  if (value.contentIndex !== undefined && typeof value.contentIndex !== "number") return false;
  return true;
}
export class PiHostBackend implements HostBackend {
  readonly protocolVersion = 2 as const;
  private listeners = new Set<(event: HostEvent) => void>();
  private live = new Map<string, Live>();
  private leases = new Map<string, LeaseManager>();
  /**
   * Per-session in-flight spawn (ensure) promises. Concurrent ensure() calls for
   * the same cold session share one spawn, so only the winner races the
   * single-winner lease acquire(); losers await its result instead of losing
   * the lease and surfacing a spurious "session is read-only" error. Cleared on
   * settle (success or failure) so a later call can re-attempt after a failure;
   * different sessions stay fully parallel.
   */
  private ensureInFlight = new Map<string, Promise<Live>>();
  /** Parsed history for an unchanged JSONL. Switching back must not re-parse on the UI thread. */
  private historyCache = new Map<string, { mtimeMs: number; size: number; offset: number; limit: number; entries: HistoryEntry[] }>();
  /** At most one Swift-parity title side channel may be launched per placeholder session. */
  private titleGenerationStarted = new Set<string>();
  /** A user rename always wins over an already-running automatic title refinement. */
  private manualTitleOverrides = new Set<string>();
  private backgroundTitleGenerations = new Set<Promise<void>>();
  private titleGenerationAbort = new AbortController();
  /** In-memory agent log cache: exact session + agent + run → accumulated log entries. Lets the UI
   * reconstruct a completed subagent's transcript without a live subscription. */
  private agentLogCache = new Map<string, CachedAgentLog[]>();
  private agentLogsPersistTimer: ReturnType<typeof setTimeout> | undefined;
  /** Cache-first stats refreshes that must settle during graceful close. */
  private backgroundStatsRefreshes = new Set<Promise<void>>();
  private models: Model[] = [];
  private modelState: ModelState = {
    model: {
      provider: "unknown",
      id: "unknown",
      name: "Unknown",
      reasoning: false,
    },
    thinkingLevel: "off",
    availableThinkingLevels: [],
  };
  private sessionModelStates = new Map<string, ModelState>();
  private sessionModelSnapshots = new Map<string, ModelState>();
  /** Per-session last-known context occupancy, rehydrated from the token ledger on cold start. */
  private sessionContextLastKnown = new Map<
    string,
    { tokens: number; contextWindow: number; percent: number | null }
  >();
  private sessionContextLedgerLoaded?: Promise<void>;
  private computerDescriptor?: ComputerDescriptor;
  private computerUsable: () => boolean = () => false;
  private root: string;
  /** Stat-validated session metadata cache; re-reads only files whose size/mtime changed. */
  private indexCache = new Map<string, { size: number; mtimeMs: number; meta: SessionMeta }>();
  /** Last index, keyed by session id. findSession must not walk the tree again. */
  private sessionById = new Map<string, SessionMeta>();
  private indexGenerations = 0;
  /** Shares one directory scan across the concurrent locate() calls a single UI click triggers. */
  private indexScan?: Promise<SessionMeta[]>;
  private piCommand: PiCommand;
  private runtimeRoot: string;
  private managedNodeModulesRoot?: string;
  private runtimeAssets?: RuntimeAssets;
  private agentDir: string;
  private features: SpawnFeatures;
  private profileMode: "default" | "isolated";
  private resourceMode: "default" | "explicit";
  private proc: ProcFactory;
  private env: NodeJS.ProcessEnv;
  private modelsLoaded?: Promise<void>;
  /** True only after configured and auth-aware runtime catalogs have been merged successfully. */
  private modelCatalogReady = false;
  private configuredModels: Model[] = [];
  /** Cached, deduped pi runtime model catalog for the current auth epoch.
   * Set to undefined by refreshModelsAfterAuthChange so login/logout re-fetches. */
  private runtimeModelsPromise?: Promise<Model[]>;
  private manualModelSelection?: { provider: string; modelId: string };
  private manualModelSelectionLoaded?: Promise<void>;
  private hiddenIds: string[] = [];
  private hiddenIdsLoaded?: Promise<void>;
  /** Selected vision model (full "provider/id" ref) mirrored into vision.json for @getpipher/vision. */
  private visionModel: string | null = null;
  private visionModelLoaded?: Promise<void>;
  private projectPaths: string[] = [];
  private projectPathsLoaded?: Promise<void>;
  private settingsWrite: Promise<void> = Promise.resolve();
  private auth: ProviderAuthBackend;
  private authRuntimePromise?: Promise<AuthRuntimeLike>;
  private queue: SessionMessageQueue;
  private queueStore: QueueStore;
  private quotaStore: QuotaStore;
  private queueLoads = new Map<string, Promise<void>>();
  private queueWrites = new Map<string, Promise<void>>();
  private closed = false;
  private agentTerminalWaiters = new Set<() => void>();
  /** Computer-use screenshot cache: screenshotId → base64+mimeType. Populated by
   * the computerAction handler so tool-result markers resolve to inline images. */
  private computerScreenshots = new Map<string, { data: string; mimeType: string }>();
  private bridge: HostBridge;
  /** Durable Electron-side projection of runtime lifecycle events. Pi owns the worker
   * conversations; this small index only lets the UI rebuild its tree after host restart. */
  private agentsWrite: Promise<void> = Promise.resolve();
  private compactionConfiguration?: ProactiveCompactionConfiguration;
  private canonicalProjectPaths: () => Promise<string[] | undefined>;
  private terminalSessionDeleted?: (sessionId: string) => void;
  constructor(options: PiBackendOptions = {}) {
    this.terminalSessionDeleted = options.terminalSessionDeleted;
    this.compactionConfiguration = options.compaction;
    this.computerDescriptor = options.computerDescriptor;
    this.computerUsable = options.computerUsable ?? (() => false);
    this.agentDir = options.agentDir ?? join(homedir(), ".pi", "agent");
    this.root = options.sessionsRoot ?? join(this.agentDir, "sessions");
    this.piCommand = options.piCommand
      ? {
          executable: options.piCommand.executable,
          prefixArgs: [...(options.piCommand.prefixArgs ?? [])],
          env: { ...(options.piCommand.env ?? {}) },
          piPath: options.piCommand.piPath,
        }
      : { executable: options.piPath ?? resolvePiExecutable(options.env ?? process.env) };
    this.runtimeRoot = options.runtimeRoot ?? defaultRuntimeRoot();
    this.managedNodeModulesRoot = options.managedNodeModulesRoot;
    this.runtimeAssets = options.runtimeAssets;
    this.features = options.features ?? DEFAULT_FEATURES;
    this.profileMode = options.profileMode ?? "default";
    this.resourceMode = options.resourceMode ?? "default";
    this.proc = options.spawn ?? (spawn as ProcFactory);
    this.env = options.env ?? process.env;
    this.canonicalProjectPaths = options.canonicalProjectPaths ?? (() => swiftCanonicalProjectPaths(this.env));
    const queueRoot =
      options.agentDir || !options.sessionsRoot
        ? join(this.agentDir, "pipiui-queues")
        : join(this.root, ".pipiui-queues");
    this.queueStore = options.queueStore ?? new FileQueueStore(queueRoot);
    this.quotaStore = options.quotaStore ?? new QuotaStore(this.env, { agentDir: this.agentDir });
    this.queue = new SessionMessageQueue({
      dispatch: (id, payload, behavior) =>
        this.dispatchQueuedMessage(id, payload, behavior),
      onChange: (id, items) => this.queueChanged(id, items),
    });
    this.bridge = new HostBridge({
      onAgentEvent: (event, sessionId) => this.mapAgentEvent(event, sessionId),
      onPlanEvent: (event, sessionId) => this.planEvent(event, sessionId),
      onBrowserAction: async (event, sessionId) =>
        options.browserAction
          ? options.browserAction(event, sessionId)
          : { ok: false, error: "browser host unavailable" },
      onTerminalAction: async (event, sessionId) =>
        options.terminalAction
          ? options.terminalAction(event, sessionId)
          : { ok: false, error: "terminal host unavailable" },
      onComputerAction: async (event) => {
        if (!options.computerAction) return { ok: false, error: "computer host unavailable" }
        const result = await options.computerAction(event)
        // Cache computer-use screenshots so tool-result markers resolve into
        // inline images for the transcript.
        if (result && typeof result === "object" && typeof (result as any).screenshotId === "string" && typeof (result as any).base64 === "string") {
          this.computerScreenshots.set((result as any).screenshotId, { data: (result as any).base64, mimeType: (result as any).mimeType ?? "image/png" })
          if (this.computerScreenshots.size > 24) this.computerScreenshots.delete(this.computerScreenshots.keys().next().value!)
        }
        return result
      },
    });
    if (options.authRuntime) {
      this.authRuntimePromise = Promise.resolve(options.authRuntime);
    } else if (options.authHelperPath) {
      this.authRuntimePromise = Promise.resolve(new ExternalAuthRuntime({
        helperPath: options.authHelperPath,
        nodePath: options.authNodePath ?? (this.piCommand.prefixArgs?.length ? this.piCommand.executable : undefined),
        piPath: this.piCommand.piPath ?? this.piCommand.executable,
        agentDir: this.agentDir,
        sessionsRoot: this.root,
        enforceProfile: this.profileMode === "isolated",
        env: { ...this.env, ...(this.piCommand.env ?? {}) },
      }));
    }
    this.auth = new ProviderAuthBackend({
      runtime: {
        getProviders: async () => (await this.modelRuntime()).getProviders(),
        getAvailable: async () => (await this.modelRuntime()).getAvailable(),
        login: async (p, t, i) => (await this.modelRuntime()).login(p, t, i),
        logout: async (p) => (await this.modelRuntime()).logout(p),
      },
      authPath: join(this.agentDir, "auth.json"),
      onLoginCompleted: () => {
        void this.refreshModelsAfterAuthChange();
      },
    });
    // The bridge callback is synchronous, so finish the small durable-index read before this
    // backend can receive any live event. An async constructor load could otherwise overwrite a
    // newer same-key run or persist an incomplete map when START arrived immediately.
    this.loadPersistedAgents();
    this.loadPersistedAgentLogs();
    // Preload the pi SessionManager module at startup: otherwise the first session open after
    // launch pays its ~1s dynamic-import cost and the chat appears to stall before painting.
    void loadSessionManager();
    // Preload the model catalog at startup so opening Settings or the Subagent
    // modal never stalls on "正在加载模型": the costly `list-models` child-process
    // spawn overlaps with window load, and the resolved catalog is cached
    // (runtimeModelsPromise) so the renderer's mount-time listModels reuses it
    // instead of re-spawning. Errors are swallowed here — they resurface on the
    // next on-demand listModels, and the cache self-clears on failure.
    void this.loadModelCatalog().catch(() => undefined);
    void this.index().catch(() => undefined);
  }
  subscribe(listener: (event: HostEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private childStillRunning(child?: ChildProcessWithoutNullStreams): boolean {
    return Boolean(child && child.exitCode === null && !child.signalCode);
  }

  /** EOF first; if the child ignores it (or is not Node), SIGTERM then SIGKILL. */
  private async stopLiveProcess(item: Live, graceMs = 250): Promise<void> {
    try {
      item.process?.stdin.end();
    } catch {
      /* process is already gone */
    }
    const child = item.process;
    const finished = item.exit ?? Promise.resolve();
    if (!this.childStillRunning(child)) {
      await finished;
      return;
    }
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
      });
    await Promise.race([finished, wait(graceMs)]);
    if (this.childStillRunning(child)) {
      try {
        child!.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      await Promise.race([finished, wait(graceMs)]);
    }
    if (this.childStillRunning(child)) {
      try {
        child!.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      await Promise.race([finished, wait(graceMs)]);
    }
  }

  /** Graceful connection teardown for hosts that allocate one backend per client. */
  async close(): Promise<void> {
    this.persistAgentLogs();
    this.closed = true;
    for (const wake of [...this.agentTerminalWaiters]) wake();
    this.titleGenerationAbort.abort();
    await Promise.allSettled([...this.backgroundTitleGenerations]);
    await this.bridge.close();
    const live = [...this.live.values()];
    this.live.clear();
    for (const item of live) {
      item.compaction.dispose();
      for (const pending of item.pending.values())
        pending.reject(new Error("host backend closed"));
      item.pending.clear();
    }
    await Promise.all(live.map((item) => this.stopLiveProcess(item)));
    await Promise.allSettled([...this.backgroundStatsRefreshes]);
    await Promise.all(
      [...this.leases.values()].map((lease) =>
        lease.release().catch(() => undefined),
      ),
    );
    await Promise.all(
      [...this.queueWrites.values()].map((write) =>
        write.catch(() => undefined),
      ),
    );
    // Drain the durable agent index last: events from dying pi processes can
    // still enqueue persists until their exit settles, and callers (tests,
    // host shutdown) rely on close() completing every write to agentDir.
    await this.agentsWrite;
    this.leases.clear();
    this.listeners.clear();
  }
  private stream(event: any) {
    emitFrame(this.listeners, {
      protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
      channel: "stream",
      event,
    });
  }
  private agent(event: AgentEvent) {
    emitFrame(this.listeners, {
      protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
      channel: "agents",
      event,
    });
  }
  /** Append a log entry to the in-memory cache for a completed-agent transcript. */
  private resetAgentLogStreamSlots(sessionId: string, agentId: string, runId: string) {
    const key = this.agentLogKey(sessionId, agentId, runId)
    const logs = this.agentLogCache.get(key)
    if (!logs?.length) return
    this.agentLogCache.set(key, logs.map(log => log.contentIndex === undefined ? log : { ...log, contentIndex: undefined }))
    this.persistAgentLogs()
  }
  private cacheAgentLog(sessionId: string, agentId: string, runId: string, entry: CachedAgentLog) {
    const key = this.agentLogKey(sessionId, agentId, runId)
    const logs = this.agentLogCache.get(key) ?? []
    // log_delta pushes cumulative snapshots keyed by contentIndex; upsert in place.
    if (entry.contentIndex !== undefined) {
      const idx = logs.findIndex(l => l.contentIndex === entry.contentIndex)
      if (idx >= 0) { logs[idx] = entry; this.agentLogCache.set(key, logs); this.schedulePersistAgentLogs(); return }
    }
    logs.push(entry)
    if (logs.length > 500) logs.splice(0, logs.length - 500)
    this.agentLogCache.set(key, logs)
    this.schedulePersistAgentLogs()
  }
  private queueChanged(id: string, items: QueuedMessage[]) {
    if (this.closed) return;
    this.persistQueue(id, items);
    this.stream({
      type: "queue_update",
      sessionId: id,
      queue: items,
      pendingFollowUps: this.live.get(id)?.followUps ?? [],
    });
  }
  private persistQueue(id: string, items: QueuedMessage[]) {
    const prior = this.queueWrites.get(id) ?? Promise.resolve();
    const write = prior
      .catch(() => undefined)
      .then(() => this.queueStore.save(id, items));
    this.queueWrites.set(id, write);
    void write.catch((error) =>
      console.warn(
        `[pipi-backend] queue persistence failed for ${id}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
  private async loadQueue(id: string): Promise<void> {
    let task = this.queueLoads.get(id);
    if (!task) {
      task = this.queueStore
        .load(id)
        .then((items) => this.queue.restoreQueue(id, items))
        .catch((error) => {
          console.warn(
            `[pipi-backend] queue restore failed for ${id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          this.queue.restoreQueue(id, []);
        });
      this.queueLoads.set(id, task);
    }
    await task;
  }
  private async queueIdle(id: string): Promise<void> {
    if (this.closed) return;
    await this.loadQueue(id);
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (!this.closed) await this.queue.notifyIdle(id);
  }
  private async enqueueMessage(
    id: string,
    text: string,
    attachments?: PromptAttachment[],
  ): Promise<QueueEnqueueResult> {
    await this.loadQueue(id);
    const result = this.queue.enqueue(id, { text, attachments });
    if (result.outcome === "dispatched") await this.queue.waitForDispatch(id);
    return {
      outcome: result.outcome === "dispatched" ? "direct" : "queued",
      message: result.message,
    };
  }
  private index(): Promise<SessionMeta[]> {
    // A single session selection fires several locate() calls at once; share one
    // scan and reuse stat-validated metadata instead of re-reading every JSONL.
    return (this.indexScan ??= this.scanIndex().finally(() => {
      this.indexScan = undefined;
    }));
  }
  private async scanIndex(): Promise<SessionMeta[]> {
    this.indexGenerations += 1;
    const files: string[] = [];
    const walk = async (d: string) => {
      if (!existsSync(d)) return;
      for (const e of await fs.readdir(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        e.isDirectory()
          ? await walk(p)
          : e.isFile() && p.endsWith(".jsonl") && files.push(p);
      }
    };
    await walk(this.root);
    const seen = new Set<string>();
    const result: SessionMeta[] = [];
    for (const path of files) {
      seen.add(path);
      try {
        const stat = await fs.stat(path);
        const cached = this.indexCache.get(path);
        if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
          result.push(cached.meta);
          continue;
        }
        const meta = await readSessionMeta(path);
        this.indexCache.set(path, { size: stat.size, mtimeMs: stat.mtimeMs, meta });
        result.push(meta);
      } catch {
        /* incomplete/corrupt JSONL is not a session */
      }
    }
    for (const path of [...this.indexCache.keys()]) {
      if (seen.has(path)) continue;
      try {
        await fs.stat(path);
      } catch {
        const stale = this.indexCache.get(path)?.meta;
        this.indexCache.delete(path);
        if (stale) this.sessionById.delete(stale.header.id);
      }
    }
    this.rebuildSessionById();
    return result;
  }
  private rebuildSessionById() {
    this.sessionById.clear();
    for (const { meta } of this.indexCache.values())
      this.sessionById.set(meta.header.id, meta);
  }
  private rememberSessionMeta(meta: SessionMeta, size: number, mtimeMs: number) {
    this.indexCache.set(meta.path, { size, mtimeMs, meta });
    this.sessionById.set(meta.header.id, meta);
  }
  /** Index metadata only. A known id must not walk the session tree again. */
  private async findSession(id: string) {
    const cached = this.sessionById.get(id);
    if (cached) return cached;
    await this.index();
    const found = this.sessionById.get(id);
    if (found) return found;
    throw new Error(`unknown session ${id}`);
  }
  private async locate(id: string) {
    return this.confirmSessionMeta(await this.findSession(id));
  }
  private async readHistoryCached(path: string, offset: number, limit: number): Promise<HistoryEntry[]> {
    const stat = await fs.stat(path);
    const hit = this.historyCache.get(path);
    if (
      hit &&
      hit.mtimeMs === stat.mtimeMs &&
      hit.size === stat.size &&
      hit.offset === offset &&
      hit.limit === limit
    )
      return hit.entries;
    const entries = await readHistory(path, offset, limit);
    this.historyCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, offset, limit, entries });
    return entries;
  }
  private async confirmSessionMeta(meta: SessionMeta): Promise<SessionMeta> {
    try {
      if ((await fs.stat(meta.path)).size > SESSION_MANAGER_MAX_BYTES)
        return meta;
      const { SessionManager } = await loadSessionManager();
      const manager = SessionManager.open(meta.path);
      const header = manager.getHeader();
      if (!header) return meta;
      const entries = manager.getEntries() as any[];
      const last = entries.at(-1);
      return {
        ...meta,
        header,
        name: manager.getSessionName() ?? meta.name,
        updatedAt: last?.timestamp ? asTime(last.timestamp) : meta.updatedAt,
        model: sessionModelFromRows(entries) ?? meta.model,
        thinkingLevel: sessionThinkingLevelFromRows(entries) ?? meta.thinkingLevel,
      };
    } catch (error) {
      console.warn(
        `[pipi-backend] SessionManager metadata fallback for ${meta.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return meta;
    }
  }
  /** Resolve a session's model: in-memory snapshot (set this host run, may not be flushed yet) wins over the JSONL probe. */
  private sessionModelOf(s: SessionMeta): { provider: string; modelId: string } | null {
    const inMemory =
      this.sessionModelStates.get(s.header.id) ??
      this.sessionModelSnapshots.get(s.header.id);
    if (inMemory) {
      const m = inMemory.model;
      if (m.provider !== "unknown" && m.id !== "unknown")
        return { provider: m.provider, modelId: m.id };
    }
    return s.model ?? null;
  }
  /**
   * Model to spawn a session with: an in-memory selection wins; a cold session
   * restores its JSONL `model_change` (per-session binding); only sessions with
   * no model record inherit the configured global default.
   */
  private desiredModelFor(s: SessionMeta): ModelState {
    const inMemory =
      this.sessionModelStates.get(s.header.id) ??
      this.sessionModelSnapshots.get(s.header.id);
    if (inMemory) return inMemory;
    const base = this.modelState;
    const ref = this.sessionModelOf(s);
    if (!ref) {
      if (s.thinkingLevel === undefined) return base;
      return {
        ...base,
        thinkingLevel: resolveThinkingLevel(s.thinkingLevel, base.availableThinkingLevels, base.thinkingLevel) ?? "off",
      };
    }
    const known = this.models.find(
      (m) => m.provider === ref.provider && m.id === ref.modelId,
    );
    const model: Model = known ?? {
      provider: ref.provider,
      id: ref.modelId,
      name: ref.modelId,
      reasoning: false,
    };
    const availableThinkingLevels = thinkingLevelsForModel(model);
    return {
      ...base,
      model,
      thinkingLevel: resolveThinkingLevel(s.thinkingLevel ?? base.thinkingLevel, availableThinkingLevels, base.thinkingLevel) ?? "off",
      availableThinkingLevels,
    };
  }
  private project(path: string): Project {
    return { id: dirId(path), name: basename(path) || path, path };
  }
  private async loadConfiguredModels(): Promise<void> {
    if (this.modelsLoaded) return this.modelsLoaded;
    this.modelsLoaded = (async () => {
      let settings: any = {},
        catalog: any = {};
      try {
        settings = JSON.parse(
          await fs.readFile(join(this.agentDir, "settings.json"), "utf8"),
        );
      } catch {}
      try {
        catalog = JSON.parse(
          await fs.readFile(join(this.agentDir, "models.json"), "utf8"),
        );
      } catch {}
      const configured: Model[] = [];
      for (const [provider, config] of Object.entries<any>(
        catalog.providers ?? {},
      )) {
        const key = config?.apiKey;
        const available =
          typeof key === "string" &&
          key.trim() !== "" &&
          (key.startsWith("$") ? Boolean(this.env[key.slice(1)]) : true);
        if (!available) continue;
        for (const model of config.models ?? [])
          if (typeof model?.id === "string")
            configured.push(hostModelFromPi(model, provider, config));
      }
      this.configuredModels = configured;
      this.models = [...configured];
      const preferred =
        configured.find(
          (model) =>
            model.provider === settings.defaultProvider &&
            model.id === settings.defaultModel,
        ) ??
        configured.find((model) => model.id === settings.defaultModel) ??
        configured[0];
      if (preferred) {
        const availableThinkingLevels = thinkingLevelsForModel(preferred);
        this.modelState = {
          model: preferred,
          thinkingLevel: resolveThinkingLevel(settings.defaultThinkingLevel ?? "off", availableThinkingLevels) ?? "off",
          availableThinkingLevels,
        };
      }
    })();
    return this.modelsLoaded;
  }
  async handle(method: HostMethod, params: unknown[]): Promise<unknown> {
    switch (method) {
      case "listProjects":
        return (await this.loadProjectPaths()).map((path) =>
          this.project(path),
        );
      case "getProjectPaths":
        return [...(await this.loadProjectPaths())];
      case "setProjectPaths":
        return this.saveProjectPaths(params[0]);
      case "addProject":
        return this.addProject(params[0]);
      case "removeProject":
        return this.removeProject(params[0] as string);
      case "listDocuments":
        // Documents are opened explicitly from transcript references; never scan a project.
        return [];
      case "readDocument":
        return readLocalDocument(params[0]);
      case "listSessions": {
        const pid = params[0] as string;
        const paths = await this.loadProjectPaths();
        if (!paths.some((path) => dirId(path) === pid))
          throw new Error(`unknown project ${pid}`);
        const all = await this.index();
        return all
          .filter((s) => dirId(s.header.cwd) === pid)
          .map((s) => ({
            id: s.header.id,
            projectId: pid,
            name: s.name ?? "Session",
            updatedAt: s.updatedAt,
            model: this.sessionModelOf(s),
          }))
          .sort((a, b) => b.updatedAt - a.updatedAt);
      }
      case "newSession":
        return this.newSession(
          params[0] as string,
          params[1] as string | undefined,
        );
      case "resumeSession": {
        const s = await this.locate(params[0] as string);
        await this.leaseFor(s).acquire();
        await this.loadQueue(s.header.id);
        return this.toSession(s);
      }
      case "renameSession":
        return this.renameSession(params[0] as string, params[1] as string);
      case "deleteSession": {
        const s = await this.locate(params[0] as string);
        // Revoke tool authority before any asynchronous filesystem/process
        // cleanup; otherwise a stale Pi process can recreate deleted resources.
        this.bridge.unregister(s.header.id);
        this.terminalSessionDeleted?.(s.header.id);
        await this.leases.get(s.header.id)?.release();
        this.leases.delete(s.header.id);
        await this.queueWrites.get(s.header.id)?.catch(() => undefined);
        await this.queueStore.remove(s.header.id);
        this.queueLoads.delete(s.header.id);
        await fs.rm(s.path);
        this.historyCache.delete(s.path);
        this.indexCache.delete(s.path);
        this.sessionById.delete(s.header.id);
        this.live.get(s.header.id)?.process?.stdin.end();
        this.live.delete(s.header.id);
        this.sessionModelStates.delete(s.header.id);
        this.sessionModelSnapshots.delete(s.header.id);
        this.manualTitleOverrides.delete(s.header.id);
        return;
      }
      case "moveSession":
        return this.moveSession(params[0] as string, params[1] as string);
      case "getSessionHistory": {
        const session = await this.findSession(params[0] as string);
        return this.readHistoryCached(
          session.path,
          Number(params[1] ?? 0),
          Number(params[2] ?? 500),
        );
      }
      case "getSessionLease": {
        const s = await this.findSession(params[0] as string);
        return this.leaseFor(s).query();
      }
      case "forceTakeoverSessionLease": {
        const s = await this.locate(params[0] as string);
        return this.leaseFor(s).forceTakeover();
      }
      case "sendPrompt":
        return this.enqueueMessage(
          params[0] as string,
          params[1] as string,
          params[2] as PromptAttachment[] | undefined,
        );
      case "listQueue":
        await this.loadQueue(params[0] as string);
        return this.queue.listQueue(params[0] as string);
      case "enqueueMessage":
        return this.enqueueMessage(
          params[0] as string,
          params[1] as string,
          params[2] as PromptAttachment[] | undefined,
        );
      case "updateQueuedMessage": {
        const input: any = { text: params[2] as string };
        if (params.length > 3)
          input.attachments = params[3] as PromptAttachment[];
        await this.loadQueue(params[0] as string);
        return this.queue.updateMessage(
          params[0] as string,
          params[1] as string,
          input,
        );
      }
      case "removeQueuedMessage":
        await this.loadQueue(params[0] as string);
        return this.queue.removeMessage(
          params[0] as string,
          params[1] as string,
        );
      case "promoteQueuedMessage":
        await this.loadQueue(params[0] as string);
        return this.queue.promoteMessage(
          params[0] as string,
          params[1] as string,
        );
      case "steerQueuedMessage":
        await this.loadQueue(params[0] as string);
        return this.queue.steerMessage(
          params[0] as string,
          params[1] as string,
        );
      case "retryQueuedMessage":
        await this.loadQueue(params[0] as string);
        return this.queue.retryMessage(
          params[0] as string,
          params[1] as string,
        );
      case "stop":
        {
          const sessionId = params[0] as string;
          const live = this.live.get(sessionId);
          if (live) live.hostAbortedTurn = true;
          try {
            await this.command(sessionId, { type: "abort" });
          } catch (error) {
            if (live) live.hostAbortedTurn = false;
            throw error;
          }
          this.stream({
            type: "status",
            sessionId,
            status: "stopped",
            pendingFollowUps: live?.followUps ?? [],
          });
          live?.compaction.settleTurn();
          await this.queueIdle(sessionId);
          return undefined;
        }
      case "queueFollowUp":
        return this.prompt(params[0] as string, params[1] as string, true);
      case "compact":
        return this.compactSession(params[0] as string);
      case "getHiddenModelIds":
        return this.loadHiddenModelIds();
      case "setHiddenModelIds":
        return this.saveHiddenModelIds(params[0]);
      case "getSidebarSessionPreferences":
        return this.loadSidebarSessionPreferences();
      case "setSidebarSessionPreferences":
        return this.saveSidebarSessionPreferences(params[0]);
      case "authProviders":
        return this.auth.listProviders();
      case "beginProviderLogin":
        return {
          loginId: this.auth.beginLogin(
            params[0] as string,
            params[1] as AuthType,
          ),
        };
      case "continueProviderLogin":
        return this.auth.continueLogin(
          params[0] as string,
          params[1] as string | undefined,
        );
      case "cancelProviderLogin":
        this.auth.cancelLogin(params[0] as string);
        return;
      case "removeProviderCredentials":
        return this.removeProviderCredentials(params[0] as string);
      case "getComputerUseState":
        return { enabled: await this.loadComputerUseEnabled() };
      case "setComputerUseEnabled":
        return { enabled: await this.saveComputerUseEnabled(params[0]) };
      case "getSubagentModels":
        return this.loadAndMaterializeSubagentModels(true);
      case "setSubagentModel":
        return this.saveSubagentModel(params[0], params[1]);
      case "getVisionModel":
        return this.loadVisionModel();
      case "setVisionModel":
        return this.saveVisionModel(params[0]);
      case "listAgentDefinitions":
        return BUILT_IN_AGENT_DEFINITIONS.map((agent) => ({ ...agent }));
      case "listModels":
        await this.loadModelCatalog();
        return this.models;
      case "getModelState":
        return this.getModelState(params[0] as string | undefined);
      case "setModel":
        if (params.length === 2)
          return this.setConfiguredModel(params[0] as string, params[1] as string);
        return this.setModel(
          params[0] as string,
          params[1] as string,
          params[2] as string,
        );
      case "setThinkingLevel":
        return this.setThinking(
          params[0] as string,
          params[1] as ThinkingLevel,
        );
      case "getSessionStats":
        return this.getSessionStats(params[0] as string | undefined);
      case "getQuotaSnapshot":
        return this.getQuotaSnapshot(params[0] as string | undefined);
      case "listAgents": {
        const sessionId = params[0] as string | undefined;
        return [...this.agents.values()].filter(
          (agent) => !sessionId || agent.sessionId === sessionId,
        );
      }
      case "getAgentLogs":
        return this.agentLogCache.get(this.agentLogKey(params[1] as string, params[0] as string, params[2] as string)) ?? [];
      case "abortAgent":
        return this.agentCommand(params[0] as string, "abort");
      case "resolveAgent":
        return this.agentCommand(params[0] as string, "resolve");
      case "checkAgent":
        return this.getAgent(params[0] as string);
      case "getWorktreeStatus":
        return this.getWorktree(params[0] as string);
      case "mergeWorktree":
        return this.worktreeCommand(params[0] as string, "merge");
      case "discardWorktree":
        return this.worktreeCommand(params[0] as string, "discard");
      case "gitStatus":
        return probeGit(await this.projectPath(params[0] as string));
      case "gitCheckout":
        return checkoutBranch(
          await this.projectPath(params[0] as string),
          params[1] as string,
        );
      case "capabilities":
        return {
          computerUse: Boolean(
            this.features.computerUse &&
              this.computerDescriptor &&
              this.computerUsable(),
          ),
          revealInFinder: process.platform === "darwin",
          terminal: true,
          git: true,
          plan: false,
          retainedWorktreeDisposition: false,
          compact: true,
        };
    }
  }
  /** Git operations run in a known project work tree only — never in an id-derived path. */
  private async projectPath(projectId: string): Promise<string> {
    const projects = (await this.handle("listProjects", [])) as Project[];
    const project = projects.find((item) => item.id === projectId);
    if (!project) throw new Error(`unknown project ${projectId}`);
    return project.path;
  }
  /**
   * Bring the runtime tree up to the shipped sources, then hand back its root for path
   * resolution. Runs per spawn rather than once at startup: a host that installs only on launch
   * hands a running dev app a frozen copy of PiExt/PiPhilosophy, so an edit there shows up in a
   * rebuild and never in the live session. Warnings are emitted only when a refresh actually
   * fails, so the common no-op path stays silent.
   */
  private refreshRuntimeTree(): string {
    if (!this.runtimeAssets) return this.runtimeRoot;
    const report = installRuntimeTree(this.runtimeAssets, this.runtimeRoot);
    for (const failure of report.failures)
      console.warn(`[pipi-install] ${failure}`);
    return this.runtimeRoot;
  }
  /** `provider/model` for PIPIUI_MAIN_MODEL, so dispatched workers can size themselves against the main model. Unknown stays absent rather than guessed. */
  private mainModelId(): string | undefined {
    const m = this.modelState.model;
    return m.provider === "unknown" && m.id === "unknown"
      ? undefined
      : `${m.provider}/${m.id}`;
  }
  private toSession(s: SessionMeta): Session {
    return {
      id: s.header.id,
      projectId: dirId(s.header.cwd),
      name: s.name ?? "Session",
      updatedAt: s.updatedAt,
      model: this.sessionModelOf(s),
    };
  }
  private leaseFor(s: { path: string; header: any }): LeaseManager {
    let lease = this.leases.get(s.header.id);
    if (!lease) {
      lease = new LeaseManager({ sessionId: s.header.id, sessionPath: s.path });
      this.leases.set(s.header.id, lease);
    }
    return lease;
  }
  private async requireLease(id: string): Promise<void> {
    const s = await this.locate(id);
    const status = await this.leaseFor(s).acquire();
    if (!status.writable)
      throw new Error(
        `session is read-only: held by ${status.holder?.holder ?? "another writer"}`,
      );
  }
  private async newSession(projectId: string, name?: string): Promise<Session> {
    // Session creation needs only local configuration. The optional authenticated runtime
    // catalog may involve network-backed provider discovery and must never gate a sidebar click.
    await this.loadConfiguredModels();
    this.applyManualModelSelection(await this.loadManualModelSelection());
    const projects = (await this.handle("listProjects", [])) as Project[];
    const p = projects.find((x) => x.id === projectId);
    if (!p) throw new Error(`unknown project ${projectId}`);
    const id = crypto.randomUUID();
    const dir = join(this.root, encodeURIComponent(p.path));
    await fs.mkdir(dir, { recursive: true });
    const path = join(
      dir,
      `${new Date().toISOString().replace(/[:.]/g, "-")}_${id}.jsonl`,
    );
    const header = {
      type: "session",
      version: 3,
      id,
      timestamp: new Date().toISOString(),
      cwd: p.path,
    };
    const lines = [JSON.stringify(header)];
    if (name)
      lines.push(
        JSON.stringify({
          type: "session_info",
          id: crypto.randomUUID(),
          parentId: null,
          timestamp: new Date().toISOString(),
          name,
        }),
      );
    await fs.writeFile(path, lines.join("\n") + "\n");
    const created = await fs.stat(path);
    this.rememberSessionMeta(
      {
        path,
        header,
        name: name ?? "New session",
        updatedAt: Date.now(),
      },
      created.size,
      created.mtimeMs,
    );
    this.sessionModelSnapshots.set(id, this.modelState);
    return {
      id,
      projectId,
      name: name ?? "New session",
      updatedAt: Date.now(),
    };
  }
  private async renameSession(sessionId: string, name: string): Promise<Session> {
    const title = typeof name === "string" ? name.trim() : "";
    if (!title || title.length > 120) throw new Error("session name must be 1-120 characters");
    const session = await this.locate(sessionId);
    const lease = this.leaseFor(session);
    const status = await lease.acquire();
    if (!status.writable)
      throw new Error(`session is read-only: held by ${status.holder?.holder ?? "another writer"}`);

    this.manualTitleOverrides.add(sessionId);
    const timestamp = new Date().toISOString();
    const live = this.live.get(sessionId);
    try {
      if (live) {
        await this.command(sessionId, { type: "set_session_name", name: title });
        live.session = { ...live.session, name: title, updatedAt: Date.now() };
      } else {
        await fs.appendFile(session.path, `${JSON.stringify({
          type: "session_info",
          id: crypto.randomUUID(),
          parentId: null,
          timestamp,
          name: title,
        })}\n`);
      }
    } catch (error) {
      this.manualTitleOverrides.delete(sessionId);
      throw error;
    }

    this.indexCache.delete(session.path);
    const refreshed = await readSessionMeta(session.path);
    const stat = await fs.stat(session.path);
    this.indexCache.set(session.path, { size: stat.size, mtimeMs: stat.mtimeMs, meta: refreshed });
    const renamed = live ? { ...live.session, name: title } : this.toSession(refreshed);
    this.stream({ type: "session_title", sessionId, title, source: "manual" });
    return renamed;
  }
  /**
   * Move a session's real working directory. An idle live Pi is closed first so
   * its in-memory cwd cannot disagree with the durable JSONL header; active or
   * queued work is never moved underneath a running turn.
   */
  private async moveSession(sessionId: string, targetProjectId: string): Promise<Session> {
    const paths = await this.loadProjectPaths();
    const targetPath = paths.find(path => dirId(path) === targetProjectId);
    if (!targetPath) throw new Error(`unknown project ${targetProjectId}`);
    const session = await this.locate(sessionId);
    if (dirId(session.header.cwd) === targetProjectId) return this.toSession(session);
    await this.loadQueue(sessionId);
    if (this.ensureInFlight.has(sessionId) || this.queue.isBusy(sessionId) || this.queue.listQueue(sessionId).length > 0)
      throw new Error("会话正在执行或仍有排队消息，暂时不能移动");
    const live = this.live.get(sessionId);
    if (live) {
      if (!this.isSessionQuiet(sessionId)) throw new Error("会话正在执行，暂时不能移动");
      live.compaction.dispose();
      live.process?.stdin.end();
      await Promise.race([
        live.exit ?? Promise.resolve(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("等待会话停止超时，未移动")), 5_000)),
      ]);
    }
    const lease = this.leaseFor(session);
    const status = await lease.acquire();
    if (!status.writable)
      throw new Error(`session is read-only: held by ${status.holder?.holder ?? "another writer"}`);
    try {
      await rewriteSessionCwd(session.path, targetPath);
      this.indexCache.delete(session.path);
      const moved = await readSessionMeta(session.path);
      const stat = await fs.stat(session.path);
      this.indexCache.set(session.path, { size: stat.size, mtimeMs: stat.mtimeMs, meta: moved });
      return this.toSession(moved);
    } finally {
      await lease.release().catch(() => undefined);
    }
  }
  /**
   * T17 parity: parse the configured agent profile's `.env` for Pi process injection.
   * A missing/unreadable file is not an error — a GUI launch from Finder may have none.
   */
  private async readDotEnv(): Promise<Record<string, string>> {
    try {
      return parseDotEnv(await fs.readFile(join(this.agentDir, ".env"), "utf8"));
    } catch {
      return {};
    }
  }
  private ensure(id: string): Promise<Live> {
    const live = this.live.get(id);
    if (live) return Promise.resolve(live);
    const inFlight = this.ensureInFlight.get(id);
    if (inFlight) return inFlight;
    const attempt = this.spawnLive(id).finally(() => {
      this.ensureInFlight.delete(id);
    });
    this.ensureInFlight.set(id, attempt);
    return attempt;
  }
  private async spawnLive(id: string): Promise<Live> {
    await this.requireLease(id);
    const found = await this.locate(id);
    const session = this.toSession(found);
    await this.loadConfiguredModels();
    const desired = this.desiredModelFor(found);
    this.sessionModelSnapshots.set(id, desired);
    const bridgePort = await this.bridge.listen();
    const sessionCapability = this.bridge.register(id);
    const computerCapability =
      this.features.computerUse &&
      this.computerDescriptor &&
      this.computerUsable()
        ? this.bridge.registerComputer(id)
        : undefined;
    await this.loadAndMaterializeSubagentModels();
    const output = assemblePiSpawn({
      sessionPath: found.path,
      cwd: found.header.cwd,
      runtimeRoot: this.runtimeRoot,
      agentDir: this.profileMode === "isolated" ? this.agentDir : undefined,
      sessionsRoot: this.profileMode === "isolated" ? this.root : undefined,
      resourceMode: this.resourceMode,
      features: this.features,
      paths: resolveSpawnPaths(this.refreshRuntimeTree(), {
        managedNodeModulesRoot: this.managedNodeModulesRoot,
      }),
      mainModelId: this.mainModelId(),
      subagentModelsFile: this.subagentModelsRuntimeFile(),
      bridgePort,
      bridgeRoutingKey: id,
      sessionCapability,
      computerCapability,
      computerDescriptor: computerCapability
        ? this.computerDescriptor
        : undefined,
    });
    // close() may race a cache-first background resume before the child is
    // inserted into `live`. Fail closed here so shutdown cannot miss a late Pi
    // process or leave its session lease behind.
    if (this.closed) {
      this.bridge.unregister(id);
      await this.leases.get(id)?.release().catch(() => undefined);
      throw new Error("host backend closed");
    }
    const child = this.proc(this.piCommand.executable, [
      ...(this.piCommand.prefixArgs ?? []),
      "--mode",
      "rpc",
      ...output.args,
    ], {
      cwd: found.header.cwd,
      // T17 parity: the configured agent profile's .env is layered under the internal host contract
      // (and wins over the host process env), so env-key providers like DeepSeek/Kimi
      // that `listModels` sees via the auth runtime resolve in the RPC session too.
      env: withToolPath(
        mergedSpawnEnvironment(this.env, await this.readDotEnv(), {
          ...output.env,
          ...(this.piCommand.env ?? {}),
        }),
        this.piCommand.executable,
      ),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let resolveExit!: () => void;
    const exit = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    let live!: Live;
    live = {
      session,
      path: found.path,
      cwd: found.header.cwd,
      process: child,
      exit,
      buffer: "",
      stderrTail: "",
      pending: new Map(),
      followUps: [],
      toolArgs: new Map(),
      messageEpoch: 0,
      compaction: new ProactiveCompactionScheduler({
        configuration: this.compactionConfiguration,
        isIdle: () => this.isSessionQuiet(id),
        compact: () => this.command(id, { type: "compact" }),
      }),
    };
    this.live.set(id, live);
    child.stdout.on("data", (chunk) => this.lines(live!, chunk.toString()));
    child.stderr.on("data", (chunk) => {
      live!.stderrTail = (live!.stderrTail + chunk.toString()).slice(-PI_STDERR_TAIL_LIMIT);
    });
    const failPending = (reason: Error) => {
      for (const p of live!.pending.values()) p.reject(reason);
      live!.pending.clear();
    };
    child.on("error", (error) => failPending(error));
    child.on("close", (code, signal) => {
      const reason = new PiExitedError(code, signal, live!.stderrTail);
      live!.exitError = reason;
      failPending(reason);
      live!.compaction.dispose();
      this.bridge.unregister(id);
      const finish = () => {
        if (this.live.get(id) === live) this.live.delete(id);
        resolveExit();
        if (!this.closed) void this.queueIdle(id);
      };
      const lease = this.leases.get(id);
      if (lease) void lease.release().catch(() => undefined).finally(finish);
      else finish();
    });
    if (this.closed) {
      await this.stopLiveProcess(live);
      throw new Error("host backend closed");
    }
    if (desired.model.provider !== "unknown" && desired.model.id !== "unknown")
      await this.selectExactModel(live, desired.model.provider, desired.model.id);
    const spawnThinkingLevel = resolveThinkingLevel(
      desired.thinkingLevel,
      desired.availableThinkingLevels,
      this.modelState.thinkingLevel,
    );
    if (spawnThinkingLevel !== undefined) {
      await this.command(id, {
        type: "set_thinking_level",
        level: spawnThinkingLevel,
      });
    }
    await this.refreshState(live);
    return live;
  }
  private lines(live: Live, chunk: string) {
    if (process.env.PIPIUI_STREAM_DEBUG) console.log(`[stream-debug] stdout chunk sid=${live.session.id} t=${Date.now()} bytes=${chunk.length}`);
    live.buffer += chunk;
    let at;
    while ((at = live.buffer.indexOf("\n")) >= 0) {
      const line = live.buffer.slice(0, at).replace(/\r$/, "");
      live.buffer = live.buffer.slice(at + 1);
      if (!line) continue;
      try {
        this.rpcEvent(live, JSON.parse(line));
      } catch {
        /* pi stderr is diagnostic, stdout malformed lines are ignored */
      }
    }
  }
  private rpcEvent(live: Live, e: Rpc) {
    if (e.type === "agent_event" || e.type === "pipiui_agent_event") {
      this.mapAgentEvent(e.event ?? e, live.session.id);
      return;
    }
    if (e.type === "response") {
      const pending = live.pending.get(e.id);
      if (pending) {
        live.pending.delete(e.id);
        e.success
          ? pending.resolve(e.data)
          : pending.reject(new Error(e.error ?? "pi RPC failed"));
      }
      return;
    }
    const id = live.session.id;
    if (e.type === "agent_start") {
      live.hostAbortedTurn = false;
      live.compaction.cancel();
      void this.loadQueue(id).then(() => this.queue.markBusy(id));
      this.stream({ type: "status", sessionId: id, status: "started" });
    } else if (e.type === "agent_settled") {
      this.stream({
        type: "status",
        sessionId: id,
        status: live.hostAbortedTurn ? "stopped" : "settled",
        pendingFollowUps: live.followUps,
      });
      void this.queueIdle(id);
      // A compact lifecycle that omitted its end event must not wedge the
      // scheduler; settle is the final authority. The stats push that follows
      // is what re-arms the policy.
      live.compaction.settleTurn();
      void this.pushSessionStats(id);
    } else if (e.type === "agent_stopped" || e.type === "agent_error") {
      this.stream({
        type: "status",
        sessionId: id,
        status: "stopped",
        pendingFollowUps: live.followUps,
      });
      void this.queueIdle(id);
      live.compaction.settleTurn();
    } else if (e.type === "compaction_start") {
      live.compaction.compactionStarted();
      // A compaction that started outside a turn (idle-time or `/compact`) must
      // hold the queue itself: a prompt sent meanwhile would otherwise reach pi
      // mid-compaction. Inside a turn the turn already owns the flag.
      if (!this.queue.isBusy(id)) {
        live.compactionHoldsQueue = true;
        void this.loadQueue(id).then(() => this.queue.markBusy(id));
      }
      this.stream({
        type: "compaction",
        sessionId: id,
        phase: "start",
        reason: typeof e.reason === "string" ? e.reason : undefined,
      });
    } else if (e.type === "compaction_end") {
      const aborted = e.aborted === true;
      const error =
        typeof e.errorMessage === "string" && e.errorMessage
          ? e.errorMessage
          : undefined;
      live.compaction.compactionFinished(!aborted && !error);
      if (live.compactionHoldsQueue) {
        live.compactionHoldsQueue = false;
        void this.queueIdle(id);
      }
      this.stream({
        type: "compaction",
        sessionId: id,
        phase: "end",
        reason: typeof e.reason === "string" ? e.reason : undefined,
        aborted: aborted || undefined,
        error,
      });
      // Compaction reports null tokens/percent until the next assistant usage;
      // refresh so the pill drops the stale number instead of showing 316k/200k.
      void this.pushSessionStats(id);
    } else if (e.type === "queue_update") {
      // Follow-up list only. Emitting status:streaming here reopened a settled
      // composer as 生成中 with no turn — the UI treats streaming as "busy now".
      live.followUps = e.followUp ?? [];
    } else if (e.type === "message_update") {
      const d = e.assistantMessageEvent ?? {};
      if (d.type === "text_delta")
        this.stream({
          type: "text",
          sessionId: id,
          contentIndex: d.contentIndex ?? 0,
          segment: live.messageEpoch,
          delta: d.delta ?? "",
        });
      if (d.type === "thinking_delta")
        this.stream({
          type: "thinking",
          sessionId: id,
          contentIndex: d.contentIndex ?? 0,
          segment: live.messageEpoch,
          delta: d.delta ?? "",
        });
      if (process.env.PIPIUI_STREAM_DEBUG && (d.type === "text_delta" || d.type === "thinking_delta"))
        console.log(`[stream-debug] emit ${d.type} sid=${id} t=${Date.now()} len=${(d.delta ?? "").length}`);
      if (d.type === "toolcall_delta") {
        // Tool args stream as partial JSON chunks keyed by contentIndex; the real
        // toolCallId/name only become known at toolcall_end. Buffer the chunks so
        // the single tool_call card emitted at toolcall_end carries the full args
        // under the real id/name — the UI renders one card per tool with a readable
        // summary instead of a placeholder "tool" card plus a name-only card.
        const index = d.contentIndex ?? 0;
        live.toolArgs.set(
          index,
          (live.toolArgs.get(index) ?? "") + (d.delta ?? ""),
        );
      } else if (d.type === "toolcall_end") {
        const index = d.contentIndex ?? 0;
        const buffered = live.toolArgs.get(index) ?? "";
        live.toolArgs.delete(index);
        const call = d.toolCall ?? {};
        const args =
          call.arguments != null && typeof call.arguments === "object"
            ? JSON.stringify(call.arguments)
            : typeof call.arguments === "string"
              ? call.arguments
              : buffered;
        this.stream({
          type: "tool_call",
          sessionId: id,
          contentIndex: index,
          segment: live.messageEpoch,
          toolCallId: call.id ?? `content-${index}`,
          name: call.name ?? "tool",
          delta: args,
        });
      }
    } else if (e.type === "message_end") {
      // A new message restarts content indexing; drop unclaimed tool buffers and
      // bump the epoch so later thinking segments key apart from earlier ones.
      live.toolArgs.clear();
      live.messageEpoch++;
      // Swift ingests user rows on message_end. Follow-ups such as [subagent-done]
      // never go through sendPrompt, so without this the live transcript stays on
      // the previous assistant turn and the composer looks falsely stuck.
      const message = e.message ?? {};
      if (message.role === "user") {
        const content = text(message.content);
        if (content) {
          this.stream({
            type: "user_message",
            sessionId: id,
            id: typeof message.id === "string" ? message.id : typeof e.id === "string" ? e.id : undefined,
            content,
          });
        }
      }
      // A failed turn still ends with a message_end whose assistant message has
      // stopReason "error", an errorMessage, and no content — dropping it leaves
      // the user a blank bubble. Forward it as a stream error so the UI can
      // render the real provider failure (e.g. a Codex schema validation error).
      if (message.stopReason === "error") {
        const content =
          typeof message.errorMessage === "string" && message.errorMessage
            ? message.errorMessage
            : undefined;
        if (content) this.stream({ type: "error", sessionId: id, content });
      }
    } else if (e.type === "tool_execution_end") {
      const { text: resultText, images } = extractResult(e.result?.content, this.computerScreenshots)
      this.stream({
        type: "tool_result",
        sessionId: id,
        toolCallId: e.toolCallId,
        content: resultText,
        images: images.length > 0 ? images : undefined,
        isError: e.isError,
      });
    }
  }
  private async command(id: string, body: Rpc) {
    const live = await this.ensure(id);
    const child = live.process;
    if (child && (child.exitCode !== null || child.signalCode)) {
      await live.exit;
      throw live.exitError ?? new PiExitedError(child.exitCode, child.signalCode, live.stderrTail);
    }
    return new Promise<any>((resolve, reject) => {
      const req = crypto.randomUUID();
      live.pending.set(req, { resolve, reject });
      live.process!.stdin.write(
        JSON.stringify({ id: req, ...body }) + "\n",
      );
    });
  }
  /** Pi model ids are not provider-unique. Never silently accept a same-id sibling. */
  private async selectExactModel(live: Live, provider: string, modelId: string) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.command(live.session.id, { type: "set_model", provider, modelId });
      const state = await this.command(live.session.id, { type: "get_state" });
      if (state.model?.provider === provider && state.model?.id === modelId) return;
    }
    const state = await this.command(live.session.id, { type: "get_state" });
    throw new Error(
      `Pi 模型选择未生效：期望 ${provider}/${modelId}，实际 ${state.model?.provider ?? "unknown"}/${state.model?.id ?? "unknown"}`,
    );
  }
  private async refreshState(live: Live) {
    try {
      const models = await this.command(live.session.id, {
        type: "get_available_models",
      });
      const catalogModels = this.models;
      this.models = (models.models ?? []).map((raw: any) => {
        const reported = hostModelFromPi(raw);
        const catalog = catalogModels.find(item => item.provider === reported.provider && item.id === reported.id);
        if (!catalog) return reported;
        const thinkingLevelMap = reported.thinkingLevelMap ?? catalog.thinkingLevelMap;
        return {
          ...catalog,
          ...reported,
          ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
          thinkingConfigurable: thinkingLevelMap
            ? thinkingLevelsForModel({ ...reported, thinkingLevelMap }).length > 0
            : (reported.thinkingConfigurable ?? catalog.thinkingConfigurable),
        };
      });
      const state = await this.command(live.session.id, { type: "get_state" });
      const levels = await this.command(live.session.id, {
        type: "get_available_thinking_levels",
      });
      const reportedModel = state.model ? hostModelFromPi(state.model) : undefined;
      const model = reportedModel
        ? (this.models.find(item => item.provider === reportedModel.provider && item.id === reportedModel.id) ?? reportedModel)
        : (this.models[0] ?? this.modelState.model);
      const availableThinkingLevels = thinkingLevelsForModel(model, levels.levels);
      const previous = this.sessionModelSnapshots.get(live.session.id);
      const reportedThinkingLevel = state.thinkingLevel as ThinkingLevel | undefined;
      const thinkingLevel = resolveThinkingLevel(
        reportedThinkingLevel,
        availableThinkingLevels,
        previous?.thinkingLevel,
      ) ?? reportedThinkingLevel ?? "off";
      if (thinkingLevel !== reportedThinkingLevel && availableThinkingLevels.includes(thinkingLevel))
        await this.command(live.session.id, { type: "set_thinking_level", level: thinkingLevel });
      this.sessionModelStates.set(live.session.id, {
        model,
        thinkingLevel,
        availableThinkingLevels,
      });
    } catch {
      /* sessions can be viewed without configured models */
    }
  }
  /** Shared atomic settings store. New fields must merge here so model/queue preferences survive project-list updates. */
  private settingsFile(): string {
    return join(this.agentDir, "pipiui-settings.json");
  }
  private async readSettings(): Promise<Record<string, unknown>> {
    let value: unknown;
    try {
      value = JSON.parse(await fs.readFile(this.settingsFile(), "utf8"));
    } catch (error: any) {
      if (error?.code === "ENOENT") return {};
      throw new Error(
        `无法读取 PipiUI 设置：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!isRecord(value)) throw new Error("PipiUI 设置必须是 object");
    return value;
  }
  private async updateSettings<T>(
    update: (settings: Record<string, unknown>) => T,
  ): Promise<T> {
    let result!: T;
    const write = this.settingsWrite
      .catch(() => undefined)
      .then(async () => {
        const settings = await this.readSettings();
        result = update(settings);
        const target = this.settingsFile();
        await fs.mkdir(dirname(target), { recursive: true });
        const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
        await fs.writeFile(
          tmp,
          JSON.stringify(settings, null, 2) + "\n",
          "utf8",
        );
        await fs.rename(tmp, target);
      });
    this.settingsWrite = write;
    await write;
    return result;
  }
  private async loadManualModelSelection(): Promise<{ provider: string; modelId: string } | undefined> {
    if (!this.manualModelSelectionLoaded) {
      this.manualModelSelectionLoaded = (async () => {
        const value = (await this.readSettings()).manualModelSelection;
        this.manualModelSelection =
          isRecord(value) &&
          typeof value.provider === "string" && value.provider.trim().length > 0 &&
          typeof value.modelId === "string" && value.modelId.trim().length > 0
            ? { provider: value.provider, modelId: value.modelId }
            : undefined;
      })();
    }
    await this.manualModelSelectionLoaded;
    return this.manualModelSelection;
  }
  /** A remembered selection affects only future sessions; existing sessions retain their own model state. */
  private applyManualModelSelection(selection: { provider: string; modelId: string } | undefined): void {
    if (!selection) return;
    const model = this.models.find(
      (item) => item.provider === selection.provider && item.id === selection.modelId,
    );
    if (!model) return;
    const availableThinkingLevels = thinkingLevelsForModel(model);
    this.modelState = {
      ...this.modelState,
      model,
      thinkingLevel: resolveThinkingLevel(this.modelState.thinkingLevel, availableThinkingLevels) ?? "off",
      availableThinkingLevels,
    };
  }
  private async rememberManualModelSelection(model: Model): Promise<void> {
    const selection = { provider: model.provider, modelId: model.id };
    await this.updateSettings((settings) => {
      settings.manualModelSelection = selection;
    });
    this.manualModelSelection = selection;
    this.manualModelSelectionLoaded = Promise.resolve();
    // Do not inherit the selected session's thinking level into future sessions.
    const availableThinkingLevels = thinkingLevelsForModel(model);
    this.modelState = {
      ...this.modelState,
      model,
      thinkingLevel: resolveThinkingLevel(this.modelState.thinkingLevel, availableThinkingLevels) ?? "off",
      availableThinkingLevels,
    };
  }
  private checkedProjectPaths(value: unknown): string[] {
    if (
      !Array.isArray(value) ||
      !value.every((path) => typeof path === "string" && path.length > 0)
    )
      throw new Error("projectPaths 必须是 string[]（每项不能为空）");
    return [...new Set(value)];
  }
  /** Missing is intentionally false so upgraded Electron hosts stay desktop-safe. */
  private async loadComputerUseEnabled(): Promise<boolean> {
    const value = (await this.readSettings()).computerUseEnabled;
    if (value === undefined) return false;
    if (typeof value !== "boolean") throw new Error("computerUseEnabled 必须是 boolean");
    return value;
  }
  private async saveComputerUseEnabled(value: unknown): Promise<boolean> {
    if (typeof value !== "boolean") throw new Error("computerUseEnabled 必须是 boolean");
    return this.updateSettings((settings) => {
      settings.computerUseEnabled = value;
      return value;
    });
  }
  private checkedSubagentModelChain(value: unknown, allowLegacyBare = true): SubagentModelSetting[] {
    if (!Array.isArray(value) || !value.every((entry) =>
      isRecord(entry) && typeof entry.model === "string" && entry.model.trim().length > 0 &&
      (entry.thinking === undefined || typeof entry.thinking === "string"),
    )) throw new Error("subagentModels 必须是 { model, thinking? }[]");
    return value.map((entry) => {
      const model = (entry as { model: string }).model.trim();
      const slash = model.indexOf("/");
      if (!allowLegacyBare && (slash <= 0 || slash === model.length - 1))
        throw new Error(`Subagent 模型必须使用 provider/model 完整标识：${model}`);
      return {
        model,
        ...((entry as { thinking?: string }).thinking === undefined
          ? {}
          : { thinking: (entry as { thinking: string }).thinking }),
      };
    });
  }
  private checkedSubagentModels(value: unknown): Record<string, SubagentModelSetting[]> {
    if (value === undefined) return {};
    if (!isRecord(value)) throw new Error("subagentModels 必须是 object");
    return Object.fromEntries(Object.entries(value).map(([name, chain]) => {
      if (!name.trim()) throw new Error("subagentModels agent name 不能为空");
      return [name, this.checkedSubagentModelChain(chain)];
    }));
  }
  /** Qualify a historical bare id only when the authenticated catalog has one unambiguous owner. */
  private qualifyLegacySubagentModels(value: Record<string, SubagentModelSetting[]>): { value: Record<string, SubagentModelSetting[]>; changed: boolean } {
    const refsById = new Map<string, Set<string>>();
    const exactRefs = new Set<string>();
    for (const model of this.models) {
      const ref = `${model.provider}/${model.id}`;
      exactRefs.add(ref);
      const refs = refsById.get(model.id) ?? new Set<string>();
      refs.add(ref);
      refsById.set(model.id, refs);
    }
    let changed = false;
    const qualified = Object.fromEntries(Object.entries(value).map(([name, chain]) => [name, chain.map(entry => {
      if (exactRefs.has(entry.model)) return entry;
      const matches = [...(refsById.get(entry.model) ?? [])];
      if (matches.length !== 1) return entry;
      changed = true;
      return { ...entry, model: matches[0] };
    })]));
    return { value: qualified, changed };
  }
  private async loadSubagentModels(waitForCatalog = false): Promise<Record<string, SubagentModelSetting[]>> {
    const loaded = this.checkedSubagentModels((await this.readSettings()).subagentModels);
    if (waitForCatalog) {
      try {
        await this.loadModelCatalog();
      } catch {
        // Preserve legacy settings when the auth-aware catalog is unavailable. Runtime will
        // reject a still-bare override explicitly instead of letting Pi guess a provider.
        return loaded;
      }
    } else if (!this.modelCatalogReady) {
      // Session spawn must never wait for the optional auth catalog preload. If it has not
      // completed yet, materialize the stored value and let the runtime's explicit guard handle it.
      return loaded;
    }
    const normalized = this.qualifyLegacySubagentModels(loaded);
    if (!normalized.changed) return loaded;
    return this.updateSettings(settings => {
      const current = this.checkedSubagentModels(settings.subagentModels);
      const latest = this.qualifyLegacySubagentModels(current).value;
      settings.subagentModels = latest;
      return latest;
    });
  }
  private subagentModelsRuntimeFile(): string {
    return join(this.agentDir, "pipiui-subagent-models-runtime.json");
  }
  private async materializeSubagentModels(value: Record<string, SubagentModelSetting[]>): Promise<void> {
    const target = this.subagentModelsRuntimeFile();
    await fs.mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmp, target);
  }
  private async loadAndMaterializeSubagentModels(waitForCatalog = false): Promise<Record<string, SubagentModelSetting[]>> {
    const value = await this.loadSubagentModels(waitForCatalog);
    await this.materializeSubagentModels(value);
    return value;
  }
  private async saveSubagentModel(agentName: unknown, chain: unknown): Promise<Record<string, SubagentModelSetting[]>> {
    if (typeof agentName !== "string" || !agentName.trim())
      throw new Error("subagent agentName 必须是非空 string");
    const checkedChain = this.checkedSubagentModelChain(chain, false);
    const all = await this.updateSettings((settings) => {
      const current = settings.subagentModels;
      if (current !== undefined && !isRecord(current))
        throw new Error("subagentModels 必须是 object");
      const all: Record<string, SubagentModelSetting[]> = current
        ? Object.fromEntries(Object.entries(current).map(([name, value]) => [name, this.checkedSubagentModelChain(value)]))
        : {};
      if (checkedChain.length) all[agentName] = checkedChain;
      else delete all[agentName];
      settings.subagentModels = all;
      return all;
    });
    await this.materializeSubagentModels(all);
    return all;
  }
  /** Initializes an explicit empty sidebar once. Version presence makes [] durable. */
  private async loadProjectPaths(): Promise<string[]> {
    if (!this.projectPathsLoaded) {
      this.projectPathsLoaded = (async () => {
        const settings = await this.readSettings();
        if (settings.projectPathsCanonicalMigrationVersion !== 1) {
          const canonical = await this.canonicalProjectPaths();
          if (canonical !== undefined) {
            this.projectPaths = await this.updateSettings(current => {
              if (current.projectPathsCanonicalMigrationVersion === 1)
                return this.checkedProjectPaths(current.projectPaths);
              current.projectPathsVersion = 1;
              current.projectPaths = this.checkedProjectPaths(canonical);
              current.projectPathsCanonicalMigrationVersion = 1;
              current.projectPathsCanonicalMigrationSource = "com.leehow.pipiui:pipiui.projects";
              return [...canonical];
            });
            return;
          }
        }
        if (settings.projectPathsVersion === 1) {
          this.projectPaths = this.checkedProjectPaths(settings.projectPaths);
          return;
        }
        if (
          settings.projectPathsVersion !== undefined ||
          settings.projectPaths !== undefined
        )
          throw new Error("unsupported projectPaths settings version");
        this.projectPaths = await this.updateSettings((current) => {
          if (current.projectPathsVersion === 1)
            return this.checkedProjectPaths(current.projectPaths);
          if (
            current.projectPathsVersion !== undefined ||
            current.projectPaths !== undefined
          )
            throw new Error("unsupported projectPaths settings version");
          current.projectPathsVersion = 1;
          current.projectPaths = [];
          return [];
        });
      })();
    }
    await this.projectPathsLoaded;
    return [...this.projectPaths];
  }
  private async saveProjectPaths(value: unknown): Promise<string[]> {
    const paths = this.checkedProjectPaths(value);
    const saved = await this.updateSettings((settings) => {
      settings.projectPathsVersion = 1;
      settings.projectPaths = [...paths];
      return [...paths];
    });
    this.projectPaths = saved;
    this.projectPathsLoaded = Promise.resolve();
    return [...saved];
  }
  private async addProject(value: unknown): Promise<Project> {
    if (typeof value !== "string" || !value.length)
      throw new Error("project path 必须是非空 string");
    const paths = await this.loadProjectPaths();
    if (!paths.includes(value)) await this.saveProjectPaths([value, ...paths]);
    return this.project(value);
  }
  /** Removes only the explicit sidebar entry; session JSONL files remain untouched. */
  private async removeProject(projectId: string): Promise<void> {
    const paths = await this.loadProjectPaths();
    if (!paths.some((path) => dirId(path) === projectId))
      throw new Error(`unknown project ${projectId}`);
    await this.saveProjectPaths(
      paths.filter((path) => dirId(path) !== projectId),
    );
  }
  /** Atomic opt-out visibility store, mirroring Swift ModelVisibility(UserDefaults). */
  private async loadHiddenModelIds(): Promise<string[]> {
    if (!this.hiddenIdsLoaded) {
      this.hiddenIdsLoaded = (async () => {
        const raw = await this.readSettings();
        const value = raw.hiddenModelIds;
        if (value === undefined) {
          this.hiddenIds = [];
          return;
        }
        if (
          !Array.isArray(value) ||
          !value.every((id: unknown) => typeof id === "string")
        )
          throw new Error("hiddenModelIds 必须是 string[]");
        this.hiddenIds = [...new Set(value)].sort();
      })();
    }
    await this.hiddenIdsLoaded;
    return [...this.hiddenIds];
  }
  private async saveHiddenModelIds(value: unknown): Promise<string[]> {
    if (!Array.isArray(value) || !value.every((id) => typeof id === "string"))
      throw new Error("hiddenModelIds 必须是 string[]");
    const sorted = [...new Set(value)].sort();
    await this.updateSettings((settings) => {
      settings.hiddenModelIds = [...sorted];
    });
    this.hiddenIds = [...sorted];
    this.hiddenIdsLoaded = Promise.resolve();
    return [...sorted];
  }
  /**
   * Selected vision model (full `provider/id` ref). Stored in
   * pipiui-settings.json and mirrored atomically into vision.json as the
   * `{ provider, model }` bridge consumed by @getpipher/vision.
   */
  private async loadVisionModel(): Promise<string | null> {
    if (!this.visionModelLoaded) {
      this.visionModelLoaded = (async () => {
        const value = (await this.readSettings()).visionModel;
        if (value === undefined || value === null) {
          this.visionModel = null;
          return;
        }
        this.visionModel = this.checkedVisionModelRef(value);
      })();
    }
    await this.visionModelLoaded;
    return this.visionModel;
  }
  private checkedVisionModelRef(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string" || !value.includes("/"))
      throw new Error('visionModel 必须是 "provider/id" 字符串或 null');
    const [provider, ...modelParts] = value.split("/");
    if (!provider || !modelParts.length || !modelParts.every((part) => part.length > 0))
      throw new Error('visionModel 必须是 "provider/id" 字符串或 null');
    return value;
  }
  private visionBridgeFile(): string {
    return join(this.agentDir, "vision.json");
  }
  /** Atomic { provider, model } bridge write for @getpipher/vision; null writes {} (no vision model). */
  private async writeVisionBridgeFile(ref: string | null): Promise<void> {
    const target = this.visionBridgeFile();
    const payload = ref ? { provider: ref.split("/")[0], model: ref.slice(ref.indexOf("/") + 1) } : {};
    await fs.mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmp, target);
  }
  private async saveVisionModel(value: unknown): Promise<string | null> {
    const ref = this.checkedVisionModelRef(value);
    await this.updateSettings((settings) => {
      if (ref === null) delete settings.visionModel;
      else settings.visionModel = ref;
    });
    this.visionModel = ref;
    this.visionModelLoaded = Promise.resolve();
    await this.writeVisionBridgeFile(ref);
    return ref;
  }
  private checkedSidebarSessionPreferences(value: unknown): { pinnedSessionIds: string[]; archivedSessionIds: string[]; archivedSessionTimestamps?: Record<string, number>; orderedSessionIds: string[]; sessionOrderVersion?: 2 } {
    if (!isRecord(value)) throw new Error("sidebarSessionPreferences 必须是 object");
    const checked = (key: "pinnedSessionIds" | "archivedSessionIds" | "orderedSessionIds", optional = false) => {
      const ids = value[key];
      if (optional && ids === undefined) return [];
      if (!Array.isArray(ids) || !ids.every(id => typeof id === "string" && id.length > 0))
        throw new Error(`${key} 必须是非空 string[]`);
      return [...new Set(ids)];
    };
    const pinnedSessionIds = checked("pinnedSessionIds");
    const archived = new Set(checked("archivedSessionIds"));
    const rawTimestamps = value.archivedSessionTimestamps;
    let archivedSessionTimestamps: Record<string, number> | undefined;
    if (rawTimestamps !== undefined) {
      if (!isRecord(rawTimestamps)) throw new Error("archivedSessionTimestamps 必须是 object");
      archivedSessionTimestamps = {};
      for (const [id, timestamp] of Object.entries(rawTimestamps)) {
        if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp < 0)
          throw new Error("archivedSessionTimestamps 必须只包含非负时间戳");
        if (archived.has(id)) archivedSessionTimestamps[id] = timestamp;
      }
    }
    const orderedSessionIds = checked("orderedSessionIds", true);
    const sessionOrderVersion = value.sessionOrderVersion;
    if (sessionOrderVersion !== undefined && sessionOrderVersion !== 2)
      throw new Error("sessionOrderVersion 必须是 2");
    // A session cannot occupy both semantic sections; archive wins.
    return { pinnedSessionIds: pinnedSessionIds.filter(id => !archived.has(id)), archivedSessionIds: [...archived], ...(archivedSessionTimestamps === undefined ? {} : { archivedSessionTimestamps }), orderedSessionIds, ...(sessionOrderVersion === 2 ? { sessionOrderVersion: 2 as const } : {}) };
  }
  private async loadSidebarSessionPreferences(): Promise<{ pinnedSessionIds: string[]; archivedSessionIds: string[]; archivedSessionTimestamps?: Record<string, number>; orderedSessionIds: string[]; sessionOrderVersion?: 2 }> {
    const value = (await this.readSettings()).sidebarSessionPreferences;
    return value === undefined
      ? { pinnedSessionIds: [], archivedSessionIds: [], orderedSessionIds: [] }
      : this.checkedSidebarSessionPreferences(value);
  }
  private async saveSidebarSessionPreferences(value: unknown): Promise<{ pinnedSessionIds: string[]; archivedSessionIds: string[]; archivedSessionTimestamps?: Record<string, number>; orderedSessionIds: string[]; sessionOrderVersion?: 2 }> {
    const checked = this.checkedSidebarSessionPreferences(value);
    return this.updateSettings(settings => {
      settings.sidebarSessionPreferences = checked;
      return { pinnedSessionIds: [...checked.pinnedSessionIds], archivedSessionIds: [...checked.archivedSessionIds], ...(checked.archivedSessionTimestamps === undefined ? {} : { archivedSessionTimestamps: { ...checked.archivedSessionTimestamps } }), orderedSessionIds: [...checked.orderedSessionIds], ...(checked.sessionOrderVersion === 2 ? { sessionOrderVersion: 2 as const } : {}) };
    });
  }
  private async modelRuntime(): Promise<AuthRuntimeLike> {
    if (!this.authRuntimePromise) {
      this.authRuntimePromise = (async () => {
        const mod: any = await import("@earendil-works/pi-coding-agent");
        const real = await mod.ModelRuntime.create({
          authPath: join(this.agentDir, "auth.json"),
          modelsPath: join(this.agentDir, "models.json"),
          allowModelNetwork: false,
        });
        return {
          getProviders: () => real.getProviders(),
          getAvailable: () => real.getAvailable(),
          login: (p: any, t: any, i: any) => real.login(p, t, i),
          logout: (p: any) => real.logout(p),
        };
      })();
    }
    return this.authRuntimePromise;
  }
  private toRuntimeModel(m: any): Model {
    return hostModelFromPi(m);
  }
  /**
   * Pi's auth-aware runtime catalog with in-flight dedup + caching. The first
   * call pays the `list-models` child-process spawn; concurrent callers (the
   * constructor preload + the renderer's mount-time listModels) and subsequent
   * callers within the same auth epoch reuse the resolved promise instead of
   * re-spawning. Invalidated by refreshModelsAfterAuthChange on login/logout.
   * On failure the cache self-clears so the next call retries.
   */
  private runtimeModels(): Promise<Model[]> {
    if (!this.runtimeModelsPromise) {
      this.runtimeModelsPromise = (async () => {
        try {
          const runtime = await this.modelRuntime();
          const available = await runtime.getAvailable();
          return [...available]
            .map((model) => this.toRuntimeModel(model))
            .sort(
              (a, b) =>
                a.provider.localeCompare(b.provider) ||
                a.id.localeCompare(b.id),
            );
        } catch (error) {
          this.runtimeModelsPromise = undefined;
          throw error;
        }
      })();
    }
    return this.runtimeModelsPromise;
  }
  /** Merge configured/custom models with pi's auth-aware runtime catalog in stable order. */
  private async mergeRuntimeModels(includeCurrent = true): Promise<void> {
    const merged = new Map<string, Model>(
      this.configuredModels.map((model) => [
        `${model.provider}/${model.id}`,
        model,
      ]),
    );
    try {
      const additions = await this.runtimeModels();
      for (const model of additions) {
        const key = `${model.provider}/${model.id}`;
        if (!merged.has(key)) merged.set(key, model);
      }
    } catch (error) {
      throw new Error(`Pi 模型目录不可用（未返回可能不完整的配置模型回退）：${error instanceof Error ? error.message : String(error)}`);
    }
    const current = this.modelState.model;
    const currentKey = `${current.provider}/${current.id}`;
    if (
      includeCurrent &&
      current.provider !== "unknown" &&
      !merged.has(currentKey)
    )
      merged.set(currentKey, current);
    this.models = [...merged.values()];
  }
  private async loadModelCatalog(includeCurrent = true): Promise<void> {
    await this.loadConfiguredModels();
    await this.mergeRuntimeModels(includeCurrent);
    this.applyManualModelSelection(await this.loadManualModelSelection());
    for (const [sessionId, state] of this.sessionModelStates) {
      const catalog = this.models.find(model =>
        model.provider === state.model.provider && model.id === state.model.id,
      );
      if (!catalog) continue;
      const availableThinkingLevels = thinkingLevelsForModel(catalog, state.availableThinkingLevels);
      const snapshot = this.sessionModelSnapshots.get(sessionId);
      const thinkingLevel = resolveThinkingLevel(
        state.thinkingLevel,
        availableThinkingLevels,
        snapshot?.thinkingLevel,
      ) ?? state.thinkingLevel;
      this.sessionModelStates.set(sessionId, {
        model: catalog,
        thinkingLevel,
        availableThinkingLevels,
      });
      // A late catalog map (sparse openai-codex) can invalidate a stale "high".
      // Persist through the existing set-thinking RPC so the next prompt does not send it.
      if (thinkingLevel !== state.thinkingLevel && availableThinkingLevels.includes(thinkingLevel)) {
        this.sessionModelSnapshots.set(sessionId, {
          model: catalog,
          thinkingLevel,
          availableThinkingLevels,
        });
        if (this.live.has(sessionId)) {
          try {
            await this.command(sessionId, { type: "set_thinking_level", level: thinkingLevel });
          } catch {
            /* session may have exited between catalog merge and persist */
          }
        }
      }
    }
    this.modelCatalogReady = true;
  }
  /** Rebuild after pi login/logout while preserving still-configured literal/env-key models. */
  private async refreshModelsAfterAuthChange(
    includeCurrent = true,
  ): Promise<Model[]> {
    this.modelsLoaded = undefined;
    this.runtimeModelsPromise = undefined;
    this.modelCatalogReady = false;
    await this.loadModelCatalog(includeCurrent);
    return this.models;
  }
  private async removeProviderCredentials(
    providerId: string,
  ): Promise<ModelState> {
    const rt = await this.modelRuntime();
    await rt.logout(providerId);
    const models = await this.refreshModelsAfterAuthChange(false);
    if (this.modelState.model.provider === providerId) {
      const next = models[0] ?? {
        provider: "unknown",
        id: "unknown",
        name: "无可用模型",
        reasoning: false,
      };
      const availableThinkingLevels = thinkingLevelsForModel(next);
      this.modelState = {
        ...this.modelState,
        model: next,
        thinkingLevel: resolveThinkingLevel(this.modelState.thinkingLevel, availableThinkingLevels) ?? "off",
        availableThinkingLevels,
      };
    }
    return this.modelState;
  }
  /** Mirror Swift prepareMessage: persist under <cwd>/.pi/attachments and append readable paths. */
  private async prepareImageMessage(
    live: Live,
    text: string,
    attachments: PromptAttachment[],
  ): Promise<string> {
    const dir = join(live.cwd, ".pi", "attachments");
    await fs.mkdir(dir, { recursive: true });
    const paths: string[] = [];
    for (const [i, a] of attachments.entries()) {
      const ext = ATTACHMENT_EXT[a.mimeType] ?? "img";
      const name = sanitizeAttachmentName(a.name, `attachment-${i + 1}.${ext}`);
      const file = name.endsWith(`.${ext}`)
        ? join(dir, name)
        : join(dir, `${name}.${ext}`);
      await fs.writeFile(file, Buffer.from(a.dataBase64, "base64"));
      paths.push(file);
    }
    const trimmed = text.trim();
    const lines: string[] = [];
    if (trimmed) lines.push(trimmed);
    lines.push("");
    if (paths.length === 1) lines.push(`Attached image file: ${paths[0]}`);
    else {
      lines.push("Attached image files:");
      for (const p of paths) lines.push(`- ${p}`);
    }
    lines.push(
      "(Images are also embedded multimodally; prefer viewing them directly. If you use the read tool, use the paths above — do not invent paths like /home/workdir/attachments/.)",
    );
    return lines.join("\n");
  }
  private async dispatchQueuedMessage(
    id: string,
    payload: QueuedDispatchPayload,
    behavior: DispatchBehavior,
  ) {
    await this.requireLease(id);
    const live = await this.ensure(id);
    if (behavior === "prompt" && payload.text.trim()) {
      await this.startAutomaticSessionTitle(live, payload.text);
    }
    const attachments = payload.attachments as PromptAttachment[];
    const message = attachments.length
      ? await this.prepareImageMessage(live, payload.text, attachments)
      : payload.text;
    const body: Rpc = {
      type:
        behavior === "steer"
          ? "steer"
          : behavior === "follow_up"
            ? "follow_up"
            : "prompt",
      message,
    };
    if (attachments.length && behavior !== "follow_up")
      body.images = attachments.map((a) => ({
        type: "image",
        data: a.dataBase64,
        mimeType: a.mimeType,
      }));
    await this.command(id, body);
  }

  /**
   * Swift parity: immediately expose a deterministic first-message title, then refine it through
   * an isolated no-session/no-tools Pi process. Title generation never enters the conversation or
   * writes an orphan JSONL, and a failed/slow side channel never blocks the user's main prompt.
   */
  private async startAutomaticSessionTitle(live: Live, userMessage: string): Promise<void> {
    const id = live.session.id;
    if (this.titleGenerationStarted.has(id) || !isPlaceholderSessionTitle(live.session.name)) return;
    const provisional = provisionalSessionTitle(userMessage);
    if (!provisional) return;
    this.titleGenerationStarted.add(id);
    try {
      await this.applyAutomaticSessionTitle(live, provisional, "provisional");
    } catch {
      // Naming is enhancement-only: never turn a valid user prompt into a send failure.
    }
    const refinement = this.refineAutomaticSessionTitle(live, userMessage)
      .catch(() => undefined)
      .finally(() => this.backgroundTitleGenerations.delete(refinement));
    this.backgroundTitleGenerations.add(refinement);
  }

  private async applyAutomaticSessionTitle(
    live: Live,
    title: string,
    source: "provisional" | "model",
  ): Promise<void> {
    await this.command(live.session.id, { type: "set_session_name", name: title });
    live.session = { ...live.session, name: title, updatedAt: Date.now() };
    this.stream({ type: "session_title", sessionId: live.session.id, title, source });
  }

  private async refineAutomaticSessionTitle(live: Live, userMessage: string): Promise<void> {
    const isolated = assemblePiSpawn({
      cwd: live.cwd,
      agentDir: this.profileMode === "isolated" ? this.agentDir : undefined,
      sessionsRoot: this.profileMode === "isolated" ? this.root : undefined,
      resourceMode: "explicit",
      features: {},
      paths: {},
    });
    const model = this.sessionModelStates.get(live.session.id)?.model
      ?? this.sessionModelSnapshots.get(live.session.id)?.model
      ?? this.modelState.model;
    const title = await generateModelSessionTitle({
      spawn: this.proc,
      executable: this.piCommand.executable,
      args: [
        ...(this.piCommand.prefixArgs ?? []),
        "--mode", "rpc",
        "--no-session", "--no-tools",
        ...isolated.args,
        "--thinking", "off",
      ],
      cwd: live.cwd,
      env: withToolPath(
        mergedSpawnEnvironment(this.env, await this.readDotEnv(), {
          ...isolated.env,
          ...(this.piCommand.env ?? {}),
        }),
        this.piCommand.executable,
      ),
      userMessage,
      model: { provider: model.provider, id: model.id },
      signal: this.titleGenerationAbort.signal,
    });
    if (!title || title === live.session.name || this.closed || this.manualTitleOverrides.has(live.session.id)) return;
    await this.applyAutomaticSessionTitle(live, title, "model");
  }
  private async prompt(
    id: string,
    prompt: string,
    follow: boolean,
    attachments?: PromptAttachment[],
  ) {
    if (!follow) {
      await this.enqueueMessage(id, prompt, attachments);
      return;
    }
    await this.dispatchQueuedMessage(
      id,
      { text: prompt, attachments: [] },
      "follow_up",
    );
    const live = this.live.get(id);
    if (!live) return;
    live.followUps.push(prompt);
    this.stream({
      type: "status",
      sessionId: id,
      status: "started",
      pendingFollowUps: live.followUps,
    });
  }
  private async getModelState(sessionId?: string): Promise<ModelState> {
    await this.loadModelCatalog();
    if (!sessionId) return this.modelState;
    if (this.live.has(sessionId) || this.ensureInFlight.has(sessionId)) {
      await this.ensure(sessionId);
      const liveState = this.sessionModelStates.get(sessionId) ?? this.sessionModelSnapshots.get(sessionId) ?? this.modelState;
      const persisted = (await this.findSession(sessionId)).thinkingLevel;
      if (
        persisted &&
        liveState.availableThinkingLevels.includes(persisted) &&
        liveState.thinkingLevel !== persisted &&
        liveState.thinkingLevel === liveState.availableThinkingLevels[0]
      ) {
        const restored = { ...liveState, thinkingLevel: persisted };
        this.sessionModelStates.set(sessionId, restored);
        return restored;
      }
      return liveState;
    }
    const cached = this.sessionModelStates.get(sessionId) ?? this.sessionModelSnapshots.get(sessionId);
    if (cached) return cached;
    const desired = this.desiredModelFor(await this.findSession(sessionId));
    this.sessionModelSnapshots.set(sessionId, desired);
    return desired;
  }
  /** Legacy/default selection path used before any session exists; live UI changes are session-scoped. */
  private async setConfiguredModel(provider: string, modelId: string) {
    await this.loadModelCatalog();
    const model = this.models.find(
      (item) => item.provider === provider && item.id === modelId,
    );
    if (!model) throw new Error(`unknown model ${provider}/${modelId}`);
    const availableThinkingLevels = thinkingLevelsForModel(model);
    this.modelState = {
      ...this.modelState,
      model,
      thinkingLevel: resolveThinkingLevel(this.modelState.thinkingLevel, availableThinkingLevels) ?? "off",
      availableThinkingLevels,
    };
    return this.modelState;
  }
  private async setModel(sessionId: string, provider: string, modelId: string) {
    let live = await this.ensure(sessionId);
    try {
      await this.selectExactModel(live, provider, modelId);
    } catch (error) {
      if (!(error instanceof PiExitedError)) throw error;
      await live.exit;
      live = await this.ensure(sessionId);
      await this.selectExactModel(live, provider, modelId);
    }
    await this.refreshState(live);
    const state = this.sessionModelStates.get(sessionId)!;
    this.sessionModelSnapshots.set(sessionId, state);
    if (state.model.provider === provider && state.model.id === modelId)
      await this.rememberManualModelSelection(state.model);
    return state;
  }
  private async setThinking(sessionId: string, level: ThinkingLevel) {
    const live = await this.ensure(sessionId);
    const current = this.sessionModelStates.get(sessionId) ?? this.sessionModelSnapshots.get(sessionId) ?? this.modelState;
    if (!current.availableThinkingLevels.includes(level))
      throw new Error(`thinking level ${level} is unavailable`);
    await this.command(sessionId, { type: "set_thinking_level", level });
    await this.refreshState(live);
    const state = this.sessionModelStates.get(sessionId)!;
    this.sessionModelSnapshots.set(sessionId, state);
    return state;
  }
  /**
   * Per-session last-known context persistence. Same file name and line format
   * as Swift's TokenLedger (`pipiui-token-ledger.jsonl`), written beside the
   * host's other state in `~/.pi/agent`; existing files are parsed with the
   * same reader, so records from earlier runs (or a Swift host sharing the
   * sessions) are reused instead of recreated with a new format.
   */
  private contextLedgerFile(): string {
    return join(this.agentDir, "pipiui-token-ledger.jsonl");
  }
  private loadSessionContextLedger(): Promise<void> {
    if (!this.sessionContextLedgerLoaded) {
      this.sessionContextLedgerLoaded = this.readSessionContextLedger();
    }
    return this.sessionContextLedgerLoaded;
  }
  private async readSessionContextLedger(): Promise<void> {
    try {
      const records = await readLedgerFile(this.contextLedgerFile());
      for (const [session, context] of latestContextBySession(records)) {
        if (this.sessionContextLastKnown.has(session)) continue;
        if (typeof context.contextWindow === "number" && context.contextWindow > 0)
          this.sessionContextLastKnown.set(session, {
            tokens: context.tokens,
            contextWindow: context.contextWindow,
            percent: context.percent,
          });
      }
    } catch {
      /* a missing/unreadable ledger is fine; live stats still work */
    }
  }
  /** Best-effort ledger append of one observed context sample. */
  private persistSessionContext(
    id: string,
    known: { tokens: number; contextWindow: number },
    model: Model,
  ): void {
    const ref =
      model.provider === "unknown" && model.id === "unknown"
        ? "?"
        : `${model.provider}/${model.id}`;
    void appendLedgerRecord(this.contextLedgerFile(), {
      ts: new Date().toISOString(),
      session: id,
      channel: "main",
      depth: 0,
      model: ref,
      turn: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: known.tokens,
      contextWindow: known.contextWindow,
    });
  }
  /**
   * Browsing a session must not spawn Pi. Live RPC is used only when a process
   * is already running; otherwise the pill reads the token ledger / zeros.
   */
  private async getSessionStats(sessionId?: string): Promise<SessionStats> {
    await this.loadSessionContextLedger();
    const id = sessionId ?? [...this.live.keys()].at(-1);
    if (!id) throw new Error("no active session; pass an explicit sessionId");
    if (this.live.has(id)) return this.sessionStatsData(id);
    return this.coldSessionStats(id);
  }
  private async coldSessionStats(id: string): Promise<SessionStats> {
    await this.loadConfiguredModels();
    const cachedState = this.sessionModelStates.get(id) ?? this.sessionModelSnapshots.get(id);
    const state = cachedState ?? this.desiredModelFor(await this.findSession(id));
    this.sessionModelSnapshots.set(id, state);
    const known = this.sessionContextLastKnown.get(id);
    return {
      sessionId: id,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
      contextUsage: known
        ? {
            tokens: known.tokens,
            contextWindow: known.contextWindow,
            percent: known.percent,
          }
        : undefined,
      model:
        state.model.provider === "unknown" && state.model.id === "unknown"
          ? undefined
          : { provider: state.model.provider, id: state.model.id, name: state.model.name },
    };
  }
  /**
   * Account-quota snapshot for the requested session's model. A session model
   * can differ from the configured default, so using `this.modelState` here
   * made a live Codex session ask the quota store for the wrong provider and
   * silently hide its pills. The optional no-id form remains the legacy
   * configured-default query.
   */
  private async getQuotaSnapshot(sessionId?: string): Promise<QuotaSnapshot | null> {
    await this.loadConfiguredModels();
    const state = sessionId
      ? this.sessionModelStates.get(sessionId) ?? this.sessionModelSnapshots.get(sessionId) ?? await this.getModelState(sessionId)
      : this.modelState;
    return this.quotaStore.snapshot(state.model.provider);
  }
  private async sessionStatsData(id: string): Promise<SessionStats> {
    await this.loadSessionContextLedger();
    // Issue order is recorded before the RPC so a stale pre-compaction response
    // can never re-arm the policy after a compaction already succeeded.
    const generation = this.live.get(id)?.compaction.beginUsageRequest();
    const data = await this.command(id, { type: "get_session_stats" });
    const tokens = isRecord(data?.tokens) ? data.tokens : {};
    const liveUsage: any = isRecord(data?.contextUsage)
      ? data.contextUsage
      : undefined;
    const model = (this.sessionModelStates.get(id) ?? this.modelState).model;
    // Per-session last-known context: fresh live occupancy is remembered and
    // persisted to the token ledger; when pi omits usage (e.g. right after
    // compaction) the snapshot falls back to last-known instead of dropping
    // the ring entirely.
    let contextUsage = liveUsage;
    if (liveUsage) {
      const liveTokens =
        typeof liveUsage.tokens === "number" ? liveUsage.tokens : null;
      const liveWindow = num(liveUsage.contextWindow);
      if (liveTokens !== null && liveWindow > 0) {
        const known = {
          tokens: liveTokens,
          contextWindow: liveWindow,
          percent:
            typeof liveUsage.percent === "number"
              ? liveUsage.percent
              : Math.min(100, (liveTokens / liveWindow) * 100),
        };
        this.sessionContextLastKnown.set(id, known);
        this.persistSessionContext(id, known, model);
      }
    } else {
      const known = this.sessionContextLastKnown.get(id);
      if (known) {
        contextUsage = {
          tokens: known.tokens,
          contextWindow: known.contextWindow,
          percent: known.percent,
        };
      }
    }
    const stats: SessionStats = {
      sessionId: id,
      tokens: {
        input: num(tokens.input),
        output: num(tokens.output),
        cacheRead: num(tokens.cacheRead),
        cacheWrite: num(tokens.cacheWrite),
        total: num(tokens.total),
      },
      cost: typeof data?.cost === "number" ? data.cost : 0,
      contextUsage: contextUsage
        ? {
            tokens:
              typeof contextUsage.tokens === "number"
                ? contextUsage.tokens
                : null,
            contextWindow: num(contextUsage.contextWindow),
            percent:
              typeof contextUsage.percent === "number"
                ? contextUsage.percent
                : null,
          }
        : undefined,
      model:
        model.provider === "unknown" && model.id === "unknown"
          ? undefined
          : { provider: model.provider, id: model.id, name: model.name },
    };
    if (generation !== undefined)
      this.live.get(id)?.compaction.observeUsage(stats.contextUsage, generation);
    return stats;
  }
  /**
   * Every live gate the idle-time compaction respects. Deliberately narrower
   * than "no work anywhere": dispatched workers may keep running in the
   * background — only main-turn activity blocks a main-session compact.
   */
  private isSessionQuiet(id: string): boolean {
    if (this.closed) return false;
    const live = this.live.get(id);
    const child = live?.process;
    if (!live || !child) return false;
    if (child.exitCode !== null || child.signalCode) return false;
    if (live.followUps.length > 0) return false;
    if (this.queue.isBusy(id)) return false;
    return this.queue.listQueue(id).length === 0;
  }
  /**
   * Manual `/compact` and the scheduler share this path. Resolves once pi
   * finished the compaction; `compaction` stream events carry the progress.
   */
  private async compactSession(id: string): Promise<void> {
    const live = await this.ensure(id);
    // The pending quiet-period timer is only a hint; an explicit compact
    // supersedes it rather than racing a second one behind it.
    live.compaction.cancel();
    await this.command(live.session.id, { type: "compact" });
  }
  /** Best-effort post-settle snapshot; the command query above stays authoritative. */
  private async pushSessionStats(id: string) {
    try {
      const stats = await this.sessionStatsData(id);
      emitFrame(this.listeners, {
        protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
        channel: "session_stats",
        event: { type: "snapshot", sessionId: id, stats },
      });
    } catch {
      /* a missed snapshot is fine; getSessionStats returns the same data on demand */
    }
  }
  private agents = new Map<string, AgentSummary>();
  private worktrees = new Map<string, WorktreeStatus>();
  private agentsFile(): string {
    return join(this.agentDir, "pipiui-agent-index.json");
  }
  private agentLogsFile(): string {
    return join(this.agentDir, "pipiui-agent-logs.json");
  }
  private agentKey(agentId: string, sessionId?: string): string {
    return `${sessionId ?? ""}\u0000${agentId}`;
  }
  private agentLogKey(sessionId: string, agentId: string, runId: string): string {
    return `${sessionId}\u0000${agentId}\u0000${runId}`;
  }
  private loadPersistedAgents(): void {
    try {
      const value = JSON.parse(readFileSync(this.agentsFile(), "utf8"));
      if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.agents)) return;
      const restartedAt = Date.now();
      let normalized = false;
      for (const raw of value.agents) {
        if (!isRecord(raw) || typeof raw.agentId !== "string" || typeof raw.sessionId !== "string") continue;
        const agent = raw as unknown as AgentSummary;
        // A process-local `running` bit is never evidence that a worker survived the host.
        // Its Pi session remains resumable, but the UI must show an interruption, not a spinner.
        if (agent.state === "running" || agent.state === "stalled") {
          agent.state = "interrupted";
          agent.endedAt = agent.endedAt ?? restartedAt;
          normalized = true;
        }
        this.agents.set(this.agentKey(agent.agentId, agent.sessionId), agent);
      }
      if (Array.isArray(value.worktrees)) for (const raw of value.worktrees) {
        if (isRecord(raw) && typeof raw.agentId === "string") this.worktrees.set(raw.agentId, raw as unknown as WorktreeStatus);
      }
      if (normalized) this.persistAgents();
    } catch (error: any) {
      if (error?.code !== "ENOENT") console.warn(`[pipi-agents] unable to load durable index: ${error?.message ?? error}`);
    }
  }
  private loadPersistedAgentLogs(): void {
    try {
      const value = JSON.parse(readFileSync(this.agentLogsFile(), "utf8"));
      if (!isRecord(value) || value.version !== 1 || !isRecord(value.logs)) return;
      for (const [key, entries] of Object.entries(value.logs)) {
        if (typeof key !== "string" || !Array.isArray(entries)) continue;
        this.agentLogCache.set(key, entries.filter(isCachedAgentLog));
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") console.warn(`[pipi-agents] unable to load durable logs: ${error?.message ?? error}`);
    }
  }
  private schedulePersistAgentLogs(): void {
    if (this.closed || this.agentLogsPersistTimer) return;
    this.agentLogsPersistTimer = setTimeout(() => {
      this.agentLogsPersistTimer = undefined;
      this.persistAgentLogs();
    }, 250);
    this.agentLogsPersistTimer.unref?.();
  }
  private persistAgentLogs(): void {
    if (this.agentLogsPersistTimer) {
      clearTimeout(this.agentLogsPersistTimer);
      this.agentLogsPersistTimer = undefined;
    }
    if (this.closed) return;
    const known = new Set(
      [...this.agents.values()].map(agent => this.agentLogKey(agent.sessionId ?? "", agent.agentId, agent.runId)),
    );
    const logs: Record<string, CachedAgentLog[]> = {};
    for (const [key, entries] of this.agentLogCache) {
      if (!entries.length) continue;
      if (known.size > 0 && !known.has(key)) continue;
      logs[key] = entries;
    }
    const target = this.agentLogsFile();
    const snapshot = JSON.stringify({ version: 1, logs }) + "\n";
    this.agentsWrite = this.agentsWrite.then(async () => {
      await fs.mkdir(dirname(target), { recursive: true });
      const tmp = `${target}.tmp-${process.pid}`;
      await fs.writeFile(tmp, snapshot, { encoding: "utf8", mode: 0o600 });
      await fs.rename(tmp, target);
    }).catch(error => console.warn(`[pipi-agents] unable to persist durable logs: ${error?.message ?? error}`));
  }
  private persistAgents(): void {
    if (this.closed) return;
    const target = this.agentsFile();
    const snapshot = JSON.stringify({ version: 1, agents: [...this.agents.values()], worktrees: [...this.worktrees.values()] }, null, 2) + "\n";
    this.agentsWrite = this.agentsWrite.then(async () => {
      await fs.mkdir(dirname(target), { recursive: true });
      const tmp = `${target}.tmp-${process.pid}`;
      await fs.writeFile(tmp, snapshot, { encoding: "utf8", mode: 0o600 });
      await fs.rename(tmp, target);
    }).catch(error => console.warn(`[pipi-agents] unable to persist durable index: ${error?.message ?? error}`));
  }
  private async getAgent(id: string) {
    // Commands predate session-qualified ids. Prefer an active matching row, then the newest;
    // listAgents itself remains exactly session-scoped even when two projects reuse `builder`.
    const a = [...this.agents.values()]
      .filter(agent => agent.agentId === id)
      .sort((left, right) => Number(right.state === "running") - Number(left.state === "running") || (right.createdAt ?? 0) - (left.createdAt ?? 0))[0];
    if (!a) throw new Error(`unknown agent ${id}`);
    return a;
  }
  private async getWorktree(id: string) {
    return (
      this.worktrees.get(id) ??
      ({
        agentId: id,
        lifecycle: "none",
        merge: "unavailable",
        discard: "unavailable",
      } satisfies WorktreeStatus)
    );
  }
  private liveSessionProcess(sessionId: string): Live | undefined {
    const live = this.live.get(sessionId);
    if (!live?.process) return undefined;
    if (live.process.exitCode !== null || live.process.signalCode) return undefined;
    return live;
  }
  private forceAbortAgent(agent: AgentSummary, reason: string): void {
    const key = this.agentKey(agent.agentId, agent.sessionId);
    const current = this.agents.get(key);
    if (!current || current.runId !== agent.runId) return;
    if (current.state !== "running" && current.state !== "stalled") return;
    const next: AgentSummary = {
      ...current,
      state: "aborted",
      endedAt: current.endedAt ?? Date.now(),
      closeout: current.closeout ?? reason,
    };
    this.agents.set(key, next);
    this.agent({ type: "agent", agent: next });
    this.persistAgents();
  }
  private async agentCommand(id: string, operation: "abort" | "resolve") {
    const a = await this.getAgent(id);
		if (operation === "abort") {
			if (!a.sessionId || !/^[A-Za-z0-9_-]{2,160}$/.test(id)) throw new Error("agent abort requires a live session and bounded agent id");
			const abortsOwningTurn = a.name === "computer-use-leader" && !a.parentId;
			const live = this.closed ? undefined : this.liveSessionProcess(a.sessionId);
			if (live) {
				// Pi executes extension commands immediately while streaming. Prefer the
				// real child end event, but never leave the panel stuck on 运行中 if the
				// owning process is wedged, already gone, or the host is closing.
				try {
					await this.withAgentCommandTimeout(
						this.command(a.sessionId, { type: "prompt", message: `/subagent_abort ${id}` }),
						5_000,
						"停止请求在 5 秒内未被主 Agent 接收",
					);
					try {
						await this.waitForAgentTerminal(a.agentId, a.sessionId, a.runId);
					} catch (error) {
						if (error instanceof Error && error.message.includes("切换了运行实例")) throw error;
						this.forceAbortAgent(a, error instanceof Error ? error.message : "停止请求已发送，但没有收到终态");
					}
				} catch (error) {
					if (error instanceof Error && error.message.includes("切换了运行实例")) throw error;
					this.forceAbortAgent(a, error instanceof Error ? error.message : "停止请求未能送达");
				}
			} else {
				this.forceAbortAgent(a, "没有可接收停止请求的主 Agent 进程，已在界面结束该子任务");
			}
			// A root Computer Task is the owning tool call of the current Pi turn. Once
			// its real terminal event arrives, abort that turn as well so Pi emits its
			// authoritative stopped lifecycle and the session queue/composer return to
			// idle. Ordinary child aborts intentionally leave the Boss turn running so
			// it can investigate or recover.
			if (abortsOwningTurn && this.liveSessionProcess(a.sessionId) && !this.closed) {
				await this.command(a.sessionId, { type: "abort" }).catch(() => undefined);
			}
			return;
		} else {
      a.handled = true;
      a.closeout = a.closeout ?? "Boss marked this episode handled";
    }
    this.agent({ type: "agent", agent: { ...a } });
    this.persistAgents();
  } /**
   * Manual merge/discard of a retained worker worktree.
   *
   * Automatic finalization is real: this host sets PIPIUI_WORKTREE_FINALIZER=pi, so a successful
   * worker is merged and cleaned up by the audited service inside pi. What is NOT implemented is
   * this manual fallback for a worktree the policy deliberately retained (failed/aborted work).
   * It used to flip the status fields to "merged"/"discarded" and report success while touching
   * no Git at all — telling a user their work was merged when the branch was untouched is worse
   * than having no button. Until this routes through a real host-api operation, it fails loudly.
   */
  private async worktreeCommand(id: string, operation: "merge" | "discard") {
    const current = await this.getWorktree(id);
    if (operation === "merge" && current.merge !== "ready")
      throw new Error("worktree cannot be merged");
    if (operation === "discard" && current.discard !== "ready")
      throw new Error("worktree cannot be discarded");
    throw new Error(
      `manual worktree ${operation} is not implemented in this host yet: retained worktree ${current.path ?? id} on branch ${current.branch ?? "(unknown)"} is untouched. Use Git manually: inspect that exact worktree and branch, then merge or remove them with your normal repository workflow.`,
    );
  }
  /**
   * Reserved for a future Plan store. The default feature set never mounts a Plan runtime and
   * capabilities report false until this handler persists revisioned state.
   */
  private planEvent(event: Record<string, unknown>, sessionId: string) {
    void event;
    void sessionId;
  }
	private waitForAgentTerminal(agentId: string, sessionId: string, runId: string, timeoutMs = 15_000): Promise<void> {
		const key = this.agentKey(agentId, sessionId);
		const deadline = Date.now() + timeoutMs;
		return new Promise((resolve, reject) => {
			let settled = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const finish = (fn: () => void) => {
				if (settled) return;
				settled = true;
				if (timer !== undefined) clearTimeout(timer);
				this.agentTerminalWaiters.delete(poll);
				fn();
			};
			const poll = () => {
				if (this.closed) return finish(() => reject(new Error("PipiUI 已关闭，无法确认 subagent 的停止状态")));
				const current = this.agents.get(key);
				if (!current || current.runId !== runId) return finish(() => reject(new Error("subagent 在停止期间切换了运行实例，请刷新后重试")));
				if (current.state !== "running" && current.state !== "stalled") return finish(() => resolve());
				if (Date.now() >= deadline) return finish(() => reject(new Error("停止请求已发送，但 15 秒内没有收到 subagent 的终态；请重试或使用“手动检查”查看状态")));
				timer = setTimeout(poll, 50);
				timer.unref?.();
			};
			this.agentTerminalWaiters.add(poll);
			poll();
		});
	}
	private withAgentCommandTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
		return new Promise((resolve, reject) => {
			let settled = false;
			const timer = setTimeout(() => {
				settled = true;
				reject(new Error(message));
			}, timeoutMs);
			timer.unref?.();
			operation.then(
				(value) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					resolve(value);
				},
				(error) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					reject(error);
				},
			);
		});
	}
  private mapAgentEvent(raw: any, sessionId?: string) {
    const key = this.agentKey(raw.agentId, sessionId);
    const current = this.agents.get(key);
    if (raw.kind === "closeout") {
      if (
        !current ||
        current.runId !== raw.runId ||
        raw.disposition !== "cleaned"
      )
        return;
      const agent: AgentSummary = {
        ...current,
        handled: true,
        closeout: raw.reason ?? current.closeout,
      };
      this.agents.set(key, agent);
      this.agent({ type: "agent", agent });
      this.persistAgents();
      return;
    }
    const reportedName = raw.name ?? current?.name;
    const privateComputerWorker = reportedName === "operator" || reportedName === "computer-verifier" || reportedName === "computer-terminal";
    let closedWorkerOutcome: string | undefined;
    if (privateComputerWorker && raw.kind === "end" && typeof raw.output === "string") {
      try {
        const parsed = JSON.parse(raw.output.trim());
        if (isRecord(parsed) && typeof parsed.outcome === "string") closedWorkerOutcome = parsed.outcome;
      } catch {
        // These private roles promise closed JSON. A malformed terminal verdict
        // is not task success even when the child process itself exited zero.
      }
    }
    const semanticWorkerFailure = privateComputerWorker && raw.kind === "end"
      && !["completed", "verified"].includes(closedWorkerOutcome ?? "");
    const reportedState = raw.ok && !semanticWorkerFailure
      ? "ok"
      : raw.aborted
        ? "aborted"
        : raw.interrupted
          ? "interrupted"
          : raw.stalled
            ? "stalled"
            : raw.kind === "end"
              ? "failed"
              : "running";
    const usage = isRecord(raw.usage) ? raw.usage : undefined;
    const terminal = raw.kind === "end";
    const sameRun = current?.runId === raw.runId;
		const eventAt = raw.at ? asTime(raw.at) : Date.now();
		const currentIsTerminal = sameRun && current !== undefined && current.state !== "running" && current.state !== "stalled";
		// HTTP lifecycle reports can arrive out of order. Once one run reaches a
		// terminal state, a late preview/update/log/stall may enrich metrics but it
		// must never reopen that same run. A new runId remains free to start.
		const staleAfterTerminal = currentIsTerminal && !terminal;
		const state = staleAfterTerminal ? current.state : reportedState;
    const agent: AgentSummary = {
      agentId: raw.agentId,
      runId: raw.runId,
      name: raw.name ?? current?.name ?? "subagent",
      task: raw.task ?? current?.task ?? "",
      state,
      stalled: staleAfterTerminal ? false : raw.stalled,
      handled: sameRun ? current?.handled : undefined,
      cost: raw.cost ?? usage?.cost ?? (sameRun ? current?.cost : undefined),
      turns: raw.turns ?? raw.turn ?? (sameRun ? current?.turns : undefined),
      outputCount: raw.output ? 1 : sameRun ? current?.outputCount : undefined,
      sessionId: sessionId ?? current?.sessionId,
      parentId: raw.parentId !== undefined ? raw.parentId : current?.parentId,
      toolCallId: nonEmpty(raw.toolCallId) ?? (sameRun ? current?.toolCallId : undefined),
      depth: raw.depth ?? current?.depth,
      role: raw.role ?? raw.agentType ?? current?.role ?? raw.name,
      title: raw.title ?? current?.title,
      createdAt:
        raw.createdAt ??
				(raw.at ? asTime(raw.at) : (sameRun ? current?.createdAt : undefined) ?? Date.now()),
			updatedAt: eventAt,
			deadlineAt: num2(raw.deadlineAt) ?? (sameRun ? current?.deadlineAt : undefined),
      // `start` sends `model: null` when the worker inherits the main model, so a null must never
      // clobber a model a later `usage` event resolved.
      model: modelRef(raw.model) ?? (sameRun ? current?.model : undefined),
      provider: providerOf(modelRef(raw.model)) ?? (sameRun ? current?.provider : undefined),
      // The extension's `activity` is the one-line "what this worker is doing right now"; it is what
      // Swift shows as the row subtitle and in the 正在执行 block.
      listSubtitle: nonEmpty(raw.activity) ?? (sameRun ? current?.listSubtitle : undefined),
      // `update` carries a rolling snapshot of the output; only the terminal event is the real result,
      // so a running worker never renders a 最终结果 card built from a half-written answer.
      finalResult: terminal
        ? (nonEmpty(raw.output) ?? current?.finalResult)
        : sameRun ? current?.finalResult : undefined,
      endedAt: terminal ? (sameRun ? current?.endedAt : undefined) ?? Date.now() : sameRun ? current?.endedAt : undefined,
      inputTokens: num2(usage?.input) ?? (sameRun ? current?.inputTokens : undefined),
      outputTokens: num2(usage?.output) ?? (sameRun ? current?.outputTokens : undefined),
      cacheTokens: num2(usage?.cacheRead) ?? (sameRun ? current?.cacheTokens : undefined),
      contextTokens: num2(usage?.contextTokens) ?? (sameRun ? current?.contextTokens : undefined),
    };
    this.agents.set(key, agent);
    const lifecycle =
      raw.worktreeLifecycle ??
      (raw.worktreePath
        ? state === "running"
          ? "active"
          : "pendingReview"
        : undefined);
    if (lifecycle) {
      const status: WorktreeStatus = {
        agentId: agent.agentId,
        path: raw.worktreePath ?? this.worktrees.get(agent.agentId)?.path,
        branch: raw.worktreeBranch ?? this.worktrees.get(agent.agentId)?.branch,
        error: raw.worktreeError ?? this.worktrees.get(agent.agentId)?.error,
        lifecycle,
        merge:
          lifecycle === "pendingReview"
            ? "ready"
            : lifecycle === "merged"
              ? "merged"
              : "unavailable",
        discard:
          lifecycle === "pendingReview"
            ? "ready"
            : lifecycle === "discarded"
              ? "discarded"
              : "unavailable",
      };
      this.worktrees.set(agent.agentId, status);
      this.agent({ type: "worktree", status });
    }
    const logSessionId = agent.sessionId;
    if (raw.kind === "log_delta" && logSessionId) {
      // Runtime log_delta pushes cumulative full text keyed by contentIndex; carry
      // the key so the panel upserts one row instead of adding one per chunk.
      const contentIndex = num2(raw.contentIndex);
      const entry = { itemType: raw.itemType, text: raw.text ?? "", name: raw.name, isError: raw.isError, ...(contentIndex === undefined ? {} : { contentIndex }) };
      this.cacheAgentLog(logSessionId, agent.agentId, agent.runId, entry);
      this.agent({ type: "agent_log", sessionId: logSessionId, agentId: agent.agentId, runId: agent.runId, ...entry });
    } else if (raw.kind === "log" && logSessionId) {
      this.resetAgentLogStreamSlots(logSessionId, agent.agentId, agent.runId);
      this.agent({ type: "agent_log", sessionId: logSessionId, agentId: agent.agentId, runId: agent.runId, itemType: "text", text: "", resetStreamSlots: true });
      for (const item of raw.items ?? []) {
        const entry = { itemType: item.itemType, text: item.text, name: item.name, isError: item.isError };
        this.cacheAgentLog(logSessionId, agent.agentId, agent.runId, entry);
        this.agent({ type: "agent_log", sessionId: logSessionId, agentId: agent.agentId, runId: agent.runId, ...entry });
      }
    }
    this.agent({ type: "agent", agent });
    this.persistAgents();
  }
  /** Lease surface deliberately remains absent: no lease is acquired/released in this backend. */
}
export function createPiHostBackend(options: PiBackendOptions = {}) {
  return new PiHostBackend(options);
}
