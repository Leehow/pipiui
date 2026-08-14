import { ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";

import {
  PIPI_HOST_PROTOCOL_VERSION,
  documentKindForName,
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
    };
  } finally {
    await handle.close();
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
  let images: { data: string; mimeType: string }[] | undefined;
  if (typeof content === "string") {
    textPart = content;
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      if (part.type === "text") textPart += part.text ?? "";
      else if (part.type === "thinking") thinking = (thinking ?? "") + (part.thinking ?? "");
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
        tools.push({
          id: String(part.id ?? ""),
          name: String(part.name ?? "tool"),
          input:
            args != null && typeof args === "object"
              ? JSON.stringify(args)
              : String(args ?? ""),
        });
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
  if (images && images.length) result.images = images;
  if (message.role === "toolResult") {
    result.toolCallId = message.toolCallId;
    result.toolName = message.toolName;
    result.isError = Boolean(message.isError);
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
  /** In-memory agent log cache: agentId → accumulated log entries. Lets the UI
   * reconstruct a completed subagent's transcript without a live subscription. */
  private agentLogCache = new Map<string, { itemType: string; text: string; name?: string; isError?: boolean; contentIndex?: number }[]>();
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
    availableThinkingLevels: ["off"],
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
  /** Shares one directory scan across the concurrent locate() calls a single UI click triggers. */
  private indexScan?: Promise<SessionMeta[]>;
  private piCommand: PiCommand;
  private runtimeRoot: string;
  private managedNodeModulesRoot?: string;
  private runtimeAssets?: RuntimeAssets;
  private agentDir: string;
  private features: SpawnFeatures;
  private proc: ProcFactory;
  private env: NodeJS.ProcessEnv;
  private modelsLoaded?: Promise<void>;
  private configuredModels: Model[] = [];
  /** Cached, deduped pi runtime model catalog for the current auth epoch.
   * Set to undefined by refreshModelsAfterAuthChange so login/logout re-fetches. */
  private runtimeModelsPromise?: Promise<Model[]>;
  private manualModelSelection?: { provider: string; modelId: string };
  private manualModelSelectionLoaded?: Promise<void>;
  private hiddenIds: string[] = [];
  private hiddenIdsLoaded?: Promise<void>;
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
  }
  subscribe(listener: (event: HostEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** Graceful connection teardown for hosts that allocate one backend per client. */
  async close(): Promise<void> {
    this.closed = true;
    await this.bridge.close();
    const live = [...this.live.values()];
    this.live.clear();
    for (const item of live) {
      item.compaction.dispose();
      for (const pending of item.pending.values())
        pending.reject(new Error("host backend closed"));
      item.pending.clear();
      try {
        item.process?.stdin.end();
      } catch {
        /* process is already gone */
      }
    }
    await Promise.all(live.map((item) => item.exit ?? Promise.resolve()));
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
  private cacheAgentLog(agentId: string, entry: { itemType: string; text: string; name?: string; isError?: boolean; contentIndex?: number }) {
    const logs = this.agentLogCache.get(agentId) ?? []
    // log_delta pushes cumulative snapshots keyed by contentIndex; upsert in place.
    if (entry.contentIndex !== undefined) {
      const idx = logs.findIndex(l => l.contentIndex === entry.contentIndex)
      if (idx >= 0) { logs[idx] = entry; this.agentLogCache.set(agentId, logs); return }
    }
    logs.push(entry)
    if (logs.length > 500) logs.splice(0, logs.length - 500)
    this.agentLogCache.set(agentId, logs)
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
    for (const path of this.indexCache.keys())
      if (!seen.has(path)) this.indexCache.delete(path);
    return result;
  }
  private async locate(id: string) {
    for (const item of await this.index())
      if (item.header.id === id) return this.confirmSessionMeta(item);
    throw new Error(`unknown session ${id}`);
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
    if (!ref) return base;
    const known = this.models.find(
      (m) => m.provider === ref.provider && m.id === ref.modelId,
    );
    const model: Model = known ?? {
      provider: ref.provider,
      id: ref.modelId,
      name: ref.modelId,
      reasoning: false,
    };
    return {
      ...base,
      model,
      availableThinkingLevels: model.reasoning
        ? ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
        : ["off"],
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
            configured.push({
              provider: model.provider ?? provider,
              id: model.id,
              name: model.name ?? model.id,
              reasoning: Boolean(model.reasoning),
              supportsImages: supportsImagesFor(
                model.id,
                model.provider ?? provider,
                model.input,
              ),
            });
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
      if (preferred)
        this.modelState = {
          model: preferred,
          thinkingLevel: settings.defaultThinkingLevel ?? "off",
          availableThinkingLevels: preferred.reasoning
            ? ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
            : ["off"],
        };
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
        this.live.get(s.header.id)?.process?.stdin.end();
        this.live.delete(s.header.id);
        this.sessionModelStates.delete(s.header.id);
        this.sessionModelSnapshots.delete(s.header.id);
        return;
      }
      case "getSessionHistory": {
        const session = await this.locate(params[0] as string);
        return readHistory(
          session.path,
          Number(params[1] ?? 0),
          Number(params[2] ?? 500),
        );
      }
      case "getSessionLease": {
        const s = await this.locate(params[0] as string);
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
        return this.loadAndMaterializeSubagentModels();
      case "setSubagentModel":
        return this.saveSubagentModel(params[0], params[1]);
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
        return this.agentLogCache.get(params[0] as string) ?? [];
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
    await this.loadModelCatalog();
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
    this.sessionModelSnapshots.set(id, this.modelState);
    return {
      id,
      projectId,
      name: name ?? "New session",
      updatedAt: Date.now(),
    };
  }
  /**
   * T17 parity: parse `~/.pi/agent/.env` for injection into the spawned pi process env.
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
      // T17 parity: ~/.pi/agent/.env is layered under the internal PIPIUI_* contract
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
    if (desired.model.provider !== "unknown" && desired.model.id !== "unknown") {
      await this.command(id, {
        type: "set_model",
        provider: desired.model.provider,
        modelId: desired.model.id,
      });
    }
    await this.command(id, {
      type: "set_thinking_level",
      level: desired.thinkingLevel,
    });
    await this.refreshState(live);
    return live;
  }
  private lines(live: Live, chunk: string) {
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
          delta: d.delta ?? "",
        });
      if (d.type === "thinking_delta")
        this.stream({
          type: "thinking",
          sessionId: id,
          contentIndex: d.contentIndex ?? 0,
          delta: d.delta ?? "",
        });
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
          toolCallId: call.id ?? `content-${index}`,
          name: call.name ?? "tool",
          delta: args,
        });
      }
    } else if (e.type === "message_end") {
      // A new message restarts content indexing; drop unclaimed tool buffers.
      live.toolArgs.clear();
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
  private async refreshState(live: Live) {
    try {
      const models = await this.command(live.session.id, {
        type: "get_available_models",
      });
      this.models = (models.models ?? []).map((m: any) => ({
        provider: m.provider,
        id: m.id,
        name: m.name ?? m.id,
        reasoning: Boolean(m.reasoning),
        supportsImages: supportsImagesFor(m.id, m.provider, m.input),
      }));
      const state = await this.command(live.session.id, { type: "get_state" });
      const levels = await this.command(live.session.id, {
        type: "get_available_thinking_levels",
      });
      const model = state.model
        ? {
            provider: state.model.provider,
            id: state.model.id,
            name: state.model.name ?? state.model.id,
            reasoning: Boolean(state.model.reasoning),
            supportsImages: supportsImagesFor(
              state.model.id,
              state.model.provider,
              state.model.input,
            ),
          }
        : (this.models[0] ?? this.modelState.model);
      this.sessionModelStates.set(live.session.id, {
        model,
        thinkingLevel: state.thinkingLevel ?? "off",
        availableThinkingLevels: levels.levels ?? ["off"],
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
    this.modelState = {
      ...this.modelState,
      model,
      availableThinkingLevels: model.reasoning
        ? ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
        : ["off"],
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
    this.modelState = {
      ...this.modelState,
      model,
      availableThinkingLevels: model.reasoning
        ? ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
        : ["off"],
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
  private checkedSubagentModelChain(value: unknown): SubagentModelSetting[] {
    if (!Array.isArray(value) || !value.every((entry) =>
      isRecord(entry) && typeof entry.model === "string" && entry.model.trim().length > 0 &&
      (entry.thinking === undefined || typeof entry.thinking === "string"),
    )) throw new Error("subagentModels 必须是 { model, thinking? }[]");
    return value.map((entry) => ({
      model: (entry as { model: string }).model,
      ...((entry as { thinking?: string }).thinking === undefined
        ? {}
        : { thinking: (entry as { thinking: string }).thinking }),
    }));
  }
  private async loadSubagentModels(): Promise<Record<string, SubagentModelSetting[]>> {
    const value = (await this.readSettings()).subagentModels;
    if (value === undefined) return {};
    if (!isRecord(value)) throw new Error("subagentModels 必须是 object");
    return Object.fromEntries(Object.entries(value).map(([name, chain]) => {
      if (!name.trim()) throw new Error("subagentModels agent name 不能为空");
      return [name, this.checkedSubagentModelChain(chain)];
    }));
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
  private async loadAndMaterializeSubagentModels(): Promise<Record<string, SubagentModelSetting[]>> {
    const value = await this.loadSubagentModels();
    await this.materializeSubagentModels(value);
    return value;
  }
  private async saveSubagentModel(agentName: unknown, chain: unknown): Promise<Record<string, SubagentModelSetting[]>> {
    if (typeof agentName !== "string" || !agentName.trim())
      throw new Error("subagent agentName 必须是非空 string");
    const checkedChain = this.checkedSubagentModelChain(chain);
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
    if (!paths.includes(value)) await this.saveProjectPaths([...paths, value]);
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
  private checkedSidebarSessionPreferences(value: unknown): { pinnedSessionIds: string[]; archivedSessionIds: string[] } {
    if (!isRecord(value)) throw new Error("sidebarSessionPreferences 必须是 object");
    const checked = (key: "pinnedSessionIds" | "archivedSessionIds") => {
      const ids = value[key];
      if (!Array.isArray(ids) || !ids.every(id => typeof id === "string" && id.length > 0))
        throw new Error(`${key} 必须是非空 string[]`);
      return [...new Set(ids)];
    };
    const pinnedSessionIds = checked("pinnedSessionIds");
    const archived = new Set(checked("archivedSessionIds"));
    // A session cannot occupy both semantic sections; archive wins.
    return { pinnedSessionIds: pinnedSessionIds.filter(id => !archived.has(id)), archivedSessionIds: [...archived] };
  }
  private async loadSidebarSessionPreferences(): Promise<{ pinnedSessionIds: string[]; archivedSessionIds: string[] }> {
    const value = (await this.readSettings()).sidebarSessionPreferences;
    return value === undefined
      ? { pinnedSessionIds: [], archivedSessionIds: [] }
      : this.checkedSidebarSessionPreferences(value);
  }
  private async saveSidebarSessionPreferences(value: unknown): Promise<{ pinnedSessionIds: string[]; archivedSessionIds: string[] }> {
    const checked = this.checkedSidebarSessionPreferences(value);
    return this.updateSettings(settings => {
      settings.sidebarSessionPreferences = checked;
      return { pinnedSessionIds: [...checked.pinnedSessionIds], archivedSessionIds: [...checked.archivedSessionIds] };
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
    return {
      provider: m.provider,
      id: m.id,
      name: m.name ?? m.id,
      reasoning: Boolean(m.reasoning),
      supportsImages: supportsImagesFor(m.id, m.provider, m.input),
    };
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
  }
  /** Rebuild after pi login/logout while preserving still-configured literal/env-key models. */
  private async refreshModelsAfterAuthChange(
    includeCurrent = true,
  ): Promise<Model[]> {
    this.modelsLoaded = undefined;
    this.runtimeModelsPromise = undefined;
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
      this.modelState = {
        ...this.modelState,
        model: next,
        availableThinkingLevels: next.reasoning
          ? ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
          : ["off"],
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
    await this.ensure(sessionId);
    return this.sessionModelStates.get(sessionId) ?? this.sessionModelSnapshots.get(sessionId) ?? this.modelState;
  }
  /** Legacy/default selection path used before any session exists; live UI changes are session-scoped. */
  private async setConfiguredModel(provider: string, modelId: string) {
    await this.loadModelCatalog();
    const model = this.models.find(
      (item) => item.provider === provider && item.id === modelId,
    );
    if (!model) throw new Error(`unknown model ${provider}/${modelId}`);
    this.modelState = {
      ...this.modelState,
      model,
      availableThinkingLevels: model.reasoning
        ? ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
        : ["off"],
    };
    return this.modelState;
  }
  private async setModel(sessionId: string, provider: string, modelId: string) {
    let live = await this.ensure(sessionId);
    try {
      await this.command(sessionId, { type: "set_model", provider, modelId });
    } catch (error) {
      if (!(error instanceof PiExitedError)) throw error;
      await live.exit;
      live = await this.ensure(sessionId);
      await this.command(sessionId, { type: "set_model", provider, modelId });
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
   * Session stats use a cache-first cold path for the compact context indicator,
   * then publish the authoritative real-pi `get_session_stats` snapshot after
   * background resume. A live/no-ledger session still waits for the real RPC.
   */
  private async getSessionStats(sessionId?: string): Promise<SessionStats> {
    await this.loadSessionContextLedger();
    const id = sessionId ?? [...this.live.keys()].at(-1);
    if (!id) throw new Error("no active session; pass an explicit sessionId");
    const known = this.sessionContextLastKnown.get(id);
    if (!this.live.has(id) && known) {
      await this.loadConfiguredModels();
      const cachedState = this.sessionModelStates.get(id) ?? this.sessionModelSnapshots.get(id);
      const session = cachedState ? undefined : await this.locate(id);
      const state = cachedState ?? this.desiredModelFor(session!);
      this.sessionModelSnapshots.set(id, state);
      // Revalidate without blocking selection. pushSessionStats publishes the
      // authoritative live accounting once the cold Pi session is ready.
      const refresh = this.ensure(id)
        .then(() => this.pushSessionStats(id))
        .catch(() => undefined)
        .finally(() => this.backgroundStatsRefreshes.delete(refresh));
      this.backgroundStatsRefreshes.add(refresh);
      return {
        sessionId: id,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        cost: 0,
        contextUsage: {
          tokens: known.tokens,
          contextWindow: known.contextWindow,
          percent: known.percent,
        },
        model:
          state.model.provider === "unknown" && state.model.id === "unknown"
            ? undefined
            : { provider: state.model.provider, id: state.model.id, name: state.model.name },
      };
    }
    const live = await this.ensure(id);
    return this.sessionStatsData(live.session.id);
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
  private agentKey(agentId: string, sessionId?: string): string {
    return `${sessionId ?? ""}\u0000${agentId}`;
  }
  private loadPersistedAgents(): void {
    try {
      const value = JSON.parse(readFileSync(this.agentsFile(), "utf8"));
      if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.agents)) return;
      const restartedAt = Date.now();
      for (const raw of value.agents) {
        if (!isRecord(raw) || typeof raw.agentId !== "string" || typeof raw.sessionId !== "string") continue;
        const agent = raw as unknown as AgentSummary;
        // A process-local `running` bit is never evidence that a worker survived the host.
        // Its Pi session remains resumable, but the UI must show an interruption, not a spinner.
        if (agent.state === "running" || agent.state === "stalled") {
          agent.state = "interrupted";
          agent.endedAt = agent.endedAt ?? restartedAt;
        }
        this.agents.set(this.agentKey(agent.agentId, agent.sessionId), agent);
      }
      if (Array.isArray(value.worktrees)) for (const raw of value.worktrees) {
        if (isRecord(raw) && typeof raw.agentId === "string") this.worktrees.set(raw.agentId, raw as unknown as WorktreeStatus);
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") console.warn(`[pipi-agents] unable to load durable index: ${error?.message ?? error}`);
    }
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
  private async agentCommand(id: string, operation: "abort" | "resolve") {
    const a = await this.getAgent(id);
		if (operation === "abort") {
			if (!a.sessionId || !/^[A-Za-z0-9_-]{2,160}$/.test(id)) throw new Error("agent abort requires a live session and bounded agent id");
			const abortsOwningTurn = a.name === "computer-use-leader" && !a.parentId;
			// Pi executes extension commands immediately while streaming. Do not forge
			// terminal UI state here; the real child end event remains authoritative.
			await this.withAgentCommandTimeout(
				this.command(a.sessionId, { type: "prompt", message: `/subagent_abort ${id}` }),
				5_000,
				"停止请求在 5 秒内未被主 Agent 接收；请重试",
			);
			await this.waitForAgentTerminal(a.agentId, a.sessionId, a.runId);
			// A root Computer Task is the owning tool call of the current Pi turn. Once
			// its real terminal event arrives, abort that turn as well so Pi emits its
			// authoritative stopped lifecycle and the session queue/composer return to
			// idle. Ordinary child aborts intentionally leave the Boss turn running so
			// it can investigate or recover.
			if (abortsOwningTurn) await this.command(a.sessionId, { type: "abort" });
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
			const poll = () => {
				if (this.closed) return reject(new Error("PipiUI 已关闭，无法确认 subagent 的停止状态"));
				const current = this.agents.get(key);
				if (!current || current.runId !== runId) return reject(new Error("subagent 在停止期间切换了运行实例，请刷新后重试"));
				if (current.state !== "running" && current.state !== "stalled") return resolve();
				if (Date.now() >= deadline) return reject(new Error("停止请求已发送，但 15 秒内没有收到 subagent 的终态；请重试或使用“手动检查”查看状态"));
				const timer = setTimeout(poll, 50);
				timer.unref?.();
			};
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
      handled: current?.handled,
      cost: raw.cost ?? usage?.cost ?? current?.cost,
      turns: raw.turns ?? raw.turn ?? current?.turns,
      outputCount: raw.output ? 1 : current?.outputCount,
      sessionId: sessionId ?? current?.sessionId,
      parentId: raw.parentId !== undefined ? raw.parentId : current?.parentId,
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
      model: modelRef(raw.model) ?? current?.model,
      provider: providerOf(modelRef(raw.model)) ?? current?.provider,
      // The extension's `activity` is the one-line "what this worker is doing right now"; it is what
      // Swift shows as the row subtitle and in the 正在执行 block.
      listSubtitle: nonEmpty(raw.activity) ?? current?.listSubtitle,
      // `update` carries a rolling snapshot of the output; only the terminal event is the real result,
      // so a running worker never renders a 最终结果 card built from a half-written answer.
      finalResult: terminal
        ? (nonEmpty(raw.output) ?? current?.finalResult)
        : sameRun ? current?.finalResult : undefined,
      endedAt: terminal ? (sameRun ? current?.endedAt : undefined) ?? Date.now() : sameRun ? current?.endedAt : undefined,
      inputTokens: num2(usage?.input) ?? current?.inputTokens,
      outputTokens: num2(usage?.output) ?? current?.outputTokens,
      cacheTokens: num2(usage?.cacheRead) ?? current?.cacheTokens,
      contextTokens: num2(usage?.contextTokens) ?? current?.contextTokens,
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
    if (raw.kind === "log_delta") {
      // Runtime log_delta pushes cumulative full text keyed by contentIndex; carry
      // the key so the panel upserts one row instead of adding one per chunk.
      const contentIndex = num2(raw.contentIndex);
      const entry = { itemType: raw.itemType, text: raw.text ?? "", name: raw.name, isError: raw.isError, ...(contentIndex === undefined ? {} : { contentIndex }) };
      this.cacheAgentLog(agent.agentId, entry);
      this.agent({ type: "agent_log", agentId: agent.agentId, ...entry });
    } else if (raw.kind === "log")
      for (const item of raw.items ?? []) {
        const entry = { itemType: item.itemType, text: item.text, name: item.name, isError: item.isError };
        this.cacheAgentLog(agent.agentId, entry);
        this.agent({ type: "agent_log", agentId: agent.agentId, ...entry });
      }
    this.agent({ type: "agent", agent });
    this.persistAgents();
  }
  /** Lease surface deliberately remains absent: no lease is acquired/released in this backend. */
}
export function createPiHostBackend(options: PiBackendOptions = {}) {
  return new PiHostBackend(options);
}
