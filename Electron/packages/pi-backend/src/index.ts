import { ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { closeSync, constants as fsConstants, createReadStream, createWriteStream, existsSync, lstatSync, openSync, readFileSync, watch, writeSync, promises as fs } from "node:fs";
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
  type DocumentSummary,
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
  type PlanSnapshot,
  type Session,
  type SessionStats,
  type SubagentModelSetting,
  type ThinkingLevel,
  type ThinkingLevelMap,
  type UserMcpServer,
  type WorktreeStatus,
} from "@pipi/host-api";
import { PlanStore, readPlanStore } from "./plan-store.js";
import { readUserMcpServers } from "./user-mcp-servers.js";
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
import { checkoutBranch, initGit, probeGit, probeGitBinary } from "./git.js";
import { HostBridge } from "./bridge.js";
import { DEFAULT_FEATURES } from "./features.js";
import { DocumentFileWatcher } from "./document-watch.js";
import { buildDocumentsOpenedInjection, DocumentInjectionStore, prependDocumentInjection } from "./document-inject.js";
import { ProviderAuthBackend, type AuthRuntimeLike } from "./provider-auth.js";
import { ExternalAuthRuntime } from "./external-auth-runtime.js";
import {
  SessionMessageQueue,
  type DispatchBehavior,
  type QueuedDispatchPayload,
  type QueuedMessage,
} from "./message-queue.js";
import { FileQueueStore, type QueueStore } from "./queue-store.js";
import {
  StopEscalationScheduler,
  defaultStopEscalationHooks,
  readProcessIdentity,
  type StopEscalationDelays,
  type StopEscalationHooks,
} from "./stop-escalation.js";
import { QuotaStore, parseDotEnv } from "./quota.js";
import {
  applySessionMountsToMainEnv,
  configureVaultKeyProvider,
  createSessionEnvRefreshGate,
  deleteSecret,
  envKeyProvider,
  listSecretMeta,
  listSessionMounts,
  loadVault,
  mountSecret,
  putSecret,
  createSessionRedactionGate,
  createSessionWriteBarrier,
  redactSessionJsonl,
  workerEnvFromVault,
  redactText,
  revealMountedSecrets,
  StreamRedactor,
  unmountSecret,
  vaultDiagnosisFor,
  VaultEncryptionError,
  type ExclusiveSessionWork,
  type RevealedSecret,
  type VaultDiagnosis,
  type VaultKeyProvider,
} from "./secret-vault.js";
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
import { createToolBatchTelemetry, type ToolBatchTelemetry } from "./tool-batch-telemetry.js";
import { describeImages } from "./vision-describe.js";
import { ensureWebSearchDefaults } from "./web-search-defaults.js";
import { paddleocrHasKey, writePaddleocrAccessToken } from "./paddleocr-key.js";
import { describeImagesViaGlmMcp, isGlmProvider } from "./glm-vision-mcp.js";
import {
  ensureProjectPiHome,
  migrateSharedProjectModels,
  sanitizePiSettingsFile,
} from "./project-pi-home.js";
export {
  ensureProjectPiHome,
  migrateSharedProjectModels,
  projectPiAgentDir,
  projectPiSessionsDir,
  sanitizePiSettings,
  sanitizePiSettingsFile,
} from "./project-pi-home.js";
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
  initGit,
  parsePorcelain,
  parseUpstreamCounts,
  probeGit,
  probeGitBinary,
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
  DEFAULT_STOP_ESCALATION_DELAYS,
  StopEscalationScheduler,
  listDescendantPids,
} from "./stop-escalation.js";
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
  { name: "general-purpose", description: "Grok-style full-capability worker. Uses an isolated worktree by default; runs directly only when the Boss supplies an explicit reason." },
  { name: "reviewer", description: "Read-only code review specialist for quality and security." },
  { name: "computer-use-leader", description: "Computer Use supervisor. Plans desktop work, receives every private worker result, owns recovery decisions, and returns the single final report." },
  { name: "operator", description: "Computer-use desktop worker. Performs macOS desktop operations and returns a compressed text verdict; does not edit code files." },
  { name: "computer-verifier", description: "Observe-only Computer Use verifier. Takes a fresh desktop observation and independently checks the Leader's requested postconditions." },
  { name: "computer-terminal", description: "Bounded terminal worker using an attenuated one-run Host tool broker; receives no desktop capability." },
  { name: "secretary", description: "Boss closeout secretary. Reconciles agent outcomes, worktrees, branches, verification, temporary artifacts, and the existing Boss ledger without creating another worktree." },
];

type ProcFactory = (
  bin: string,
  args: string[],
  options: any,
) => ChildProcessWithoutNullStreams;

export interface CanonicalModelsWriteQueue {
  enqueue<T>(job: () => Promise<T>): Promise<T>;
}

/** One App-owned FIFO for every canonical models.json read-modify-atomic-write. */
export function createCanonicalModelsWriteQueue(): CanonicalModelsWriteQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    enqueue<T>(job: () => Promise<T>): Promise<T> {
      const run = tail.then(job, job);
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}

async function tightenCanonicalFileMode(path: string): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!stat.isFile()) return;
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  let handle;
  try {
    try {
      handle = await fs.open(path, fsConstants.O_RDWR | noFollow);
    } catch (error) {
      if (!noFollow || !["EINVAL", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      handle = await fs.open(path, fsConstants.O_RDWR);
    }
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) {
      throw new Error("canonical models path changed during permission tighten");
    }
    await handle.chmod(0o600);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writeCanonicalModelsFile(path: string, contents: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}-${process.pid}-${Date.now()}-${crypto.randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(contents, { encoding: "utf8" });
      await handle.chmod(0o600);
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, path);
    await tightenCanonicalFileMode(path);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

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
  /** App-profile writes that must finish before shared models migration starts. */
  profileInitialization?: Promise<unknown>;
  /** Shared App-owned serializer for every canonical models.json writer. */
  canonicalModelsWrite?: CanonicalModelsWriteQueue;
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
  /** Injectable tool-batch stats helper for tests; defaults to agentDir JSONL. */ toolBatchTelemetry?: ToolBatchTelemetry;
  /** Electron injects safeStorage-backed DEK provider. Absent = fail closed. */ vaultKeyProvider?: VaultKeyProvider;
  /** Optional OS-level encryption diagnosis; never blocks ordinary chat. */ vaultAvailability?: () => VaultDiagnosis;
  /** App-profile canonical vault directory. Never derived from a project agentDir. */ vaultDir?: string;
  /** Watermarks/delays for idle-time compaction; defaults to the Swift app's. */
  compaction?: ProactiveCompactionConfiguration;
  /** Testable canonical Swift project source; undefined preserves existing host state. */
  canonicalProjectPaths?: () => Promise<string[] | undefined>;
  /** Injectable abort-unresponsive kill ladder (tests). */
  stopEscalation?: StopEscalationScheduler;
  stopEscalationHooks?: StopEscalationHooks;
  stopEscalationDelays?: StopEscalationDelays;
  /** Max wait for abort RPC ack before emitting stopped (default 1500ms). */
  abortAckTimeoutMs?: number;
  /** Open a project folder in the OS file manager. Defaults to open/explorer/xdg-open. */
  revealPath?: (path: string) => Promise<void>;
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
  /** One-shot text for the next `agent_start` after a PipiUI queue drain.
   *  Pi's own `followUp` list is empty for a regular prompt, and the UI
   *  otherwise treats that started as a ghost. */
  pendingDrainPrompt?: string;
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
  /** Queue turn id from the latest `markBusy`; stale settles must pass this to `queueIdle`. */
  turnEpoch?: number;
  /** Concatenated `text_delta` for the in-flight assistant message. */
  streamedAssistantText?: string;
  streamRedactors?: { text: Map<number, StreamRedactor>; thinking: Map<number, StreamRedactor>; tool: Map<number, StreamRedactor> };
  /** Turn already projected terminal to renderers; suppresses late duplicate settle evidence. */
  terminalEpoch?: number;
  /** Exact final assistant awaiting the last real subagent terminal event. */
  pendingFinalReconciliation?: { epoch: number; identity: FinalAssistantIdentity };
  /** SIGKILL/close in flight: do not write another RPC to this child. */
  exiting?: boolean;
};
const PI_STDERR_TAIL_LIMIT = 16 * 1024;
/** Matches Swift `SubagentWatchdog.staleThreshold`. */
const ORPHAN_STALE_MS = 10 * 60 * 1000;
const ORPHAN_RECONCILE_INTERVAL_MS = 60 * 1000;
const ORPHAN_CLOSEOUT =
  "会话进程已退出且超过 10 分钟无观察事件；按中断成果保留";
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
const assistantVisibleText = (content: any) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => part?.type === "text" ? part.text ?? "" : "").join("")
      : "";
const SUBAGENT_COMPLETION_CUSTOM_TYPE = "pipiui-subagent-complete-v1";
function isSubagentCompletion(value: any): boolean {
  if (!value || typeof value !== "object") return false;
  return value.customType === SUBAGENT_COMPLETION_CUSTOM_TYPE
    || value.message?.customType === SUBAGENT_COMPLETION_CUSTOM_TYPE;
}
function isVisibleCustomMessage(entry: any): boolean {
  return entry?.type === "custom_message" && (Boolean(entry.display) || isSubagentCompletion(entry));
}
function isAlreadyProcessingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("already processing") && message.includes("streamingBehavior");
}
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
let projectionDebugBackendSerial = 0;
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
type LatestSessionMetadata = {
  name?: string;
  model: { provider: string; modelId: string } | null;
  thinkingLevel?: ThinkingLevel;
  updatedAt?: number;
};

/**
 * Scan JSONL records newest-first in fixed-size byte chunks. Memory stays
 * bounded by one chunk plus the largest individual JSONL record, while fields
 * that happen to sit outside the old fixed tail window are still discovered.
 */
async function readLatestSessionMetadata(
  handle: Awaited<ReturnType<typeof fs.open>>,
  size: number,
): Promise<LatestSessionMetadata> {
  let position = size;
  let carry = Buffer.alloc(0);
  let name: string | undefined;
  let model: { provider: string; modelId: string } | null | undefined;
  let thinkingLevel: ThinkingLevel | undefined;
  let foundThinkingLevel = false;
  let updatedAt: number | undefined;
  while (position > 0) {
    const start = Math.max(0, position - METADATA_TAIL_BYTES);
    const chunk = Buffer.alloc(position - start);
    await handle.read(chunk, 0, chunk.length, start);
    const combined = carry.length ? Buffer.concat([chunk, carry]) : chunk;
    let complete = combined;
    if (start > 0) {
      const firstNewline = combined.indexOf(0x0a);
      if (firstNewline < 0) {
        carry = combined;
        position = start;
        continue;
      }
      carry = combined.subarray(0, firstNewline);
      complete = combined.subarray(firstNewline + 1);
    }
    const lines = complete.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let row: any;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (updatedAt === undefined && typeof row?.timestamp === "string") {
        const timestamp = Date.parse(row.timestamp);
        if (Number.isFinite(timestamp)) updatedAt = timestamp;
      }
      if (name === undefined && row?.type === "session_info" && typeof row.name === "string" && row.name.trim())
        name = row.name.trim();
      if (model === undefined && row?.type === "model_change" && typeof row.provider === "string" && row.provider && typeof row.modelId === "string" && row.modelId)
        model = { provider: row.provider, modelId: row.modelId };
      if (!foundThinkingLevel && row?.type === "thinking_level_change" && THINKING_LEVELS.includes(row.thinkingLevel)) {
        thinkingLevel = row.thinkingLevel;
        foundThinkingLevel = true;
      }
    }
    if (name !== undefined && model !== undefined && foundThinkingLevel && updatedAt !== undefined) break;
    position = start;
  }
  return { name, model: model ?? null, thinkingLevel, updatedAt };
}

/** Bounded-memory metadata scan: a small header read plus newest-first chunks. */
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
    const latest = await readLatestSessionMetadata(handle, stat.size);
    return {
      path,
      header,
      name: latest.name ?? sessionName(headRows),
      updatedAt: latest.updatedAt ?? stat.mtimeMs,
      model: latest.model,
      thinkingLevel: latest.thinkingLevel,
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
function redactHistoryEntry(entry: HistoryEntry | undefined, secrets: RevealedSecret[]): HistoryEntry | undefined {
  if (!entry || secrets.length === 0) return entry;
  return {
    ...entry,
    content: redactText(entry.content, secrets),
    ...(entry.thinking ? { thinking: redactText(entry.thinking, secrets) } : {}),
    ...(entry.errorMessage ? { errorMessage: redactText(entry.errorMessage, secrets) } : {}),
    ...(entry.tools ? { tools: entry.tools.map((tool) => ({ ...tool, input: redactText(tool.input, secrets) })) } : {}),
  };
}
function visibleHistoryEntry(entry: any, secrets: RevealedSecret[] = []): HistoryEntry | undefined {
  if (entry?.type === "message") return redactHistoryEntry(historyEntryFromMessage(entry), secrets);
  if (isVisibleCustomMessage(entry)) {
    const content = text(entry.content);
    if (!content) return undefined;
    return { id: entry.id, role: "user", content: redactText(content, secrets), timestamp: asTime(entry.timestamp) };
  }
  if (entry?.type === "compaction") {
    return {
      id: entry.id,
      role: "compaction",
      content: redactText(typeof entry.summary === "string" ? entry.summary : "", secrets),
      timestamp: asTime(entry.timestamp),
    };
  }
}

/**
 * Visible ids on the active leaf parentId chain.
 * Small-file chat history keeps the full leaf (compaction is a card; firstKept
 * does not hide earlier bubbles). Large-file fallback matches SessionManager
 * buildContextEntries: latest compaction, then firstKept through the cut, then
 * everything after the compaction.
 * Metadata rows written with parentId=null (thinking/model/session_info) are
 * stitched to the previous file-order entry instead of starting a new root.
 */
type ContextEntrySummary = {
  id: string;
  parentId: string | null;
  type: string;
  visible: boolean;
  firstKeptEntryId?: string;
};

function isMetadataReroot(type: string): boolean {
  return type === "thinking_level_change" || type === "model_change" || type === "session_info";
}

function leafBranchFromFileOrder(ordered: ContextEntrySummary[]): ContextEntrySummary[] {
  if (ordered.length === 0) return [];
  const byId = new Map(ordered.map(entry => [entry.id, entry]));
  const previous = new Map<string, ContextEntrySummary>();
  for (let index = 1; index < ordered.length; index++) previous.set(ordered[index].id, ordered[index - 1]);
  const branch: ContextEntrySummary[] = [];
  let current: ContextEntrySummary | undefined = ordered[ordered.length - 1];
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    branch.push(current);
    if (current.parentId && byId.has(current.parentId)) {
      current = byId.get(current.parentId);
      continue;
    }
    if (!current.parentId && isMetadataReroot(current.type)) {
      current = previous.get(current.id);
      continue;
    }
    current = undefined;
  }
  branch.reverse();
  return branch;
}

/** Same reorder as SessionManager.buildContextEntries on the leaf path. */
function applyLatestCompactionContext(path: ContextEntrySummary[]): ContextEntrySummary[] {
  let compaction: ContextEntrySummary | undefined;
  for (const entry of path) {
    if (entry.type === "compaction") compaction = entry;
  }
  if (!compaction) return path;
  const compactionIdx = path.findIndex(entry => entry.id === compaction.id);
  if (compactionIdx < 0) return path;
  const contextEntries: ContextEntrySummary[] = [compaction];
  let foundFirstKept = false;
  for (let i = 0; i < compactionIdx; i++) {
    const entry = path[i]!;
    if (entry.id === compaction.firstKeptEntryId) foundFirstKept = true;
    if (foundFirstKept) contextEntries.push(entry);
  }
  contextEntries.push(...path.slice(compactionIdx + 1));
  return contextEntries;
}

function visibleIdsFromFileOrder(ordered: ContextEntrySummary[], matchSessionManagerContext = false): string[] {
  const branch = leafBranchFromFileOrder(ordered);
  const path = matchSessionManagerContext ? applyLatestCompactionContext(branch) : branch;
  return path.filter(entry => entry.visible).map(entry => entry.id);
}

async function activeVisibleIds(path: string, matchSessionManagerContext = false): Promise<string[]> {
  const ordered: ContextEntrySummary[] = [];
  const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    let entry: any;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type === "session" || typeof entry?.id !== "string") continue;
    ordered.push({
      id: entry.id,
      parentId: typeof entry.parentId === "string" ? entry.parentId : null,
      type: String(entry.type ?? ""),
      visible: entry.type === "message"
        || isVisibleCustomMessage(entry)
        || entry.type === "compaction",
      firstKeptEntryId: typeof entry.firstKeptEntryId === "string" ? entry.firstKeptEntryId : undefined,
    });
  }
  return visibleIdsFromFileOrder(ordered, matchSessionManagerContext);
}

function historyPage(entries: HistoryEntry[], before: number | string, limit: number): HistoryEntry[] {
  const end = typeof before === "string"
    ? entries.findIndex(entry => entry.id === before)
    : Math.max(0, entries.length - before);
  if (typeof before === "string" && end < 0) throw new Error(`history cursor no longer exists: ${before}`);
  return entries.slice(Math.max(0, end - limit), end);
}

/** History is opened on demand and parsed incrementally; listing never reaches this path. */
async function readHistoryFallback(
  path: string,
  before: number | string = 0,
  limit = 500,
  matchSessionManagerContext = false,
  vaultDir?: string,
  sessionId?: string,
): Promise<HistoryEntry[]> {
  const visibleIds = await activeVisibleIds(path, matchSessionManagerContext);
  const end = typeof before === "string"
    ? visibleIds.indexOf(before)
    : Math.max(0, visibleIds.length - before);
  if (typeof before === "string" && end < 0) throw new Error(`history cursor no longer exists: ${before}`);
  const pageIds = visibleIds.slice(Math.max(0, end - limit), end);
  const wanted = new Set(pageIds);
  const mappedById = new Map<string, HistoryEntry>();
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
    if (!wanted.has(entry?.id)) continue;
    const secrets = vaultDir && sessionId ? revealMountedSecrets(vaultDir, sessionId) : [];
    const mapped = visibleHistoryEntry(entry, secrets);
    if (!mapped) continue;
    mappedById.set(mapped.id, mapped);
  }
  return pageIds.flatMap(id => {
    const entry = mappedById.get(id);
    return entry ? [entry] : [];
  });
}
async function lastJsonlEntryId(path: string): Promise<string | null> {
  const stat = await fs.stat(path);
  const length = Math.min(stat.size, 256 * 1024);
  if (length <= 0) return null;
  const handle = await fs.open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stat.size - length);
    const lines = buffer.toString("utf8").split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index--) {
      const line = lines[index]!.trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry?.type === "session" || typeof entry?.id !== "string") continue;
        return entry.id;
      } catch {
        /* incomplete leading tail line */
      }
    }
  } finally {
    await handle.close();
  }
  return null;
}
const SESSION_MANAGER_MAX_BYTES = 4 * 1024 * 1024;
let sessionManagerModule: Promise<{ SessionManager: any }> | undefined;
async function loadSessionManager() {
  return (sessionManagerModule ??=
    import("@earendil-works/pi-coding-agent") as Promise<{
      SessionManager: any;
    }>);
}
/** Chat-window history: stitched leaf walk. Large files skip SessionManager and match its context order. */
async function readHistory(
  path: string,
  before: number | string = 0,
  limit = 500,
  vaultDir?: string,
  sessionId?: string,
): Promise<HistoryEntry[]> {
  const stat = await fs.stat(path);
  const large = stat.size > SESSION_MANAGER_MAX_BYTES;
  if (large) {
    console.warn(
      `[pipi-backend] SessionManager skipped for ${path}: ${stat.size} bytes exceeds bounded history limit`,
    );
  }
  return readHistoryFallback(path, before, limit, large, vaultDir, sessionId);
}

const TERMINAL_DURABILITY_TAIL_BYTES = 1024 * 1024;
type FinalAssistantIdentity = { timestamp: number; responseId?: string };
function asFinalAssistantTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}
async function isLatestDurableFinalAssistant(path: string, identity: FinalAssistantIdentity): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    const length = Math.min(stat.size, TERMINAL_DURABILITY_TAIL_BYTES);
    if (length <= 0) return false;
    const start = stat.size - length;
    const handle = await fs.open(path, "r");
    let text = "";
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      text = buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
    const lines = text.split("\n");
    if (start > 0) lines.shift();
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index].trim();
      if (!line) continue;
      let entry: any;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry?.type !== "message") continue;
      const message = entry.message;
      return message?.role === "assistant"
        && message.stopReason === "stop"
        && asFinalAssistantTimestamp(message.timestamp) === identity.timestamp
        && (identity.responseId === undefined || message.responseId === identity.responseId);
    }
  } catch {
    return false;
  }
  return false;
}
async function waitForLatestDurableFinalAssistant(
  path: string,
  identity: FinalAssistantIdentity,
  timeoutMs = 30_000,
): Promise<boolean> {
  if (await isLatestDurableFinalAssistant(path, identity)) return true;
  return new Promise<boolean>((resolve) => {
    let complete = false;
    let checking = false;
    let checkAgain = false;
    let watcher: ReturnType<typeof watch> | undefined;
    let timer: NodeJS.Timeout | undefined;
    const finish = (matched: boolean) => {
      if (complete) return;
      complete = true;
      if (timer) clearTimeout(timer);
      watcher?.close();
      resolve(matched);
    };
    const check = async () => {
      if (complete) return;
      if (checking) {
        checkAgain = true;
        return;
      }
      checking = true;
      do {
        checkAgain = false;
        if (await isLatestDurableFinalAssistant(path, identity)) {
          finish(true);
          return;
        }
      } while (!complete && checkAgain);
      checking = false;
    };
    try {
      watcher = watch(path, { persistent: false }, () => void check());
      watcher.on("error", () => finish(false));
    } catch {
      finish(false);
      return;
    }
    timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    // Close the gap between the initial read and watcher registration.
    void check();
  });
}
function dirId(path: string) {
  return Buffer.from(path).toString("base64url");
}
function displayNameFor(path: string, names: Record<string, string>): string {
  const custom = names[path]?.trim();
  return custom || basename(path) || path;
}
/** Open a folder in Finder / Explorer / the desktop file manager. */
function defaultRevealPath(target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const spec =
      process.platform === "darwin"
        ? { cmd: "open", args: [target] }
        : process.platform === "win32"
          ? { cmd: "explorer", args: [target] }
          : { cmd: "xdg-open", args: [target] };
    execFile(spec.cmd, spec.args, (error) => {
      // Windows Explorer often exits 1 after a successful reveal.
      if (error && process.platform !== "win32") reject(error);
      else resolve();
    });
  });
}
const num = (value: any) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const nonEmpty = (value: any): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;
/** `usage` reports whole counts; 0 is meaningful, but a missing field must not overwrite a known one. */
const num2 = (value: any): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const positiveWindow = (value: any): number | undefined => {
  const n = num2(value);
  return n !== undefined && n > 0 ? n : undefined;
};
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
type CachedAgentLog = { itemType: string; text: string; name?: string; isError?: boolean; contentIndex?: number; charCount?: number };
function isCachedAgentLog(value: unknown): value is CachedAgentLog {
  if (!isRecord(value) || typeof value.itemType !== "string" || typeof value.text !== "string") return false;
  if (value.name !== undefined && typeof value.name !== "string") return false;
  if (value.isError !== undefined && typeof value.isError !== "boolean") return false;
  if (value.contentIndex !== undefined && typeof value.contentIndex !== "number") return false;
  if (value.charCount !== undefined && typeof value.charCount !== "number") return false;
  return true;
}

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return undefined;
}

function extractContextWindowFromModelEntry(entry: unknown): number | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const rec = entry as Record<string, unknown>;
  const keys = ["context_length", "context_window", "contextWindow", "max_model_len", "max_context_length", "context"];
  for (const key of keys) {
    const parsed = parsePositiveInt(rec[key]);
    if (parsed !== undefined) return parsed;
  }
  const limits = rec.limits;
  if (limits && typeof limits === "object") {
    const nested = limits as Record<string, unknown>;
    return parsePositiveInt(nested.context) ?? parsePositiveInt(nested.context_length);
  }
  return undefined;
}

async function fetchCompatModelsCatalog(baseUrl: string, apiKey: string): Promise<unknown[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const json: unknown = await response.json();
    return Array.isArray(json)
      ? json
      : json && typeof json === "object" && Array.isArray((json as { data?: unknown }).data)
        ? (json as { data: unknown[] }).data
        : [];
  } catch (error) {
    console.warn("compat provider context probe failed", error);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function contextWindowFromCompatList(list: unknown[], modelId: string): number | undefined {
  const entry = list.find((item: unknown) => {
    if (!item || typeof item !== "object") return false;
    const rec = item as Record<string, unknown>;
    return rec.id === modelId || rec.name === modelId;
  });
  return extractContextWindowFromModelEntry(entry);
}

async function probeCompatContextWindow(baseUrl: string, apiKey: string, modelId: string): Promise<number | undefined> {
  const list = await fetchCompatModelsCatalog(baseUrl, apiKey);
  return contextWindowFromCompatList(list, modelId);
}

type IsolatedProjectHome = {
  displayPath: string;
  realProjectRoot: string;
  agentDir: string;
  sessionsDir: string;
};

export class PiHostBackend implements HostBackend {
  readonly protocolVersion = 2 as const;
  private listeners = new Set<(event: HostEvent) => void>();
  private openedDocumentPaths: string[] = [];
  private readonly documentInjections = new DocumentInjectionStore();
  private readonly documentWatcher = new DocumentFileWatcher((path) => {
    emitFrame(this.listeners, {
      protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
      channel: "document",
      event: { type: "documentChanged", path },
    });
  });
  private readonly projectionDebugBackendTag = `backend#${projectionDebugBackendSerial += 1}`;
  private projectionDebugSessionSerial = 0;
  private projectionDebugAgentSerial = 0;
  private projectionDebugSessionTags = new Map<string, string>();
  private projectionDebugAgentTags = new Map<string, string>();
  private projectionDebugProvenance = new Map<string, string>();
  private projectionDebugFilePath: string | null | undefined;
  private live = new Map<string, Live>();
  private sessionFileBarriers = new Map<string, ExclusiveSessionWork>();
  private readonly sessionRedact = createSessionRedactionGate({
    hasWork: (sessionId) => this.sessionSecrets(sessionId).length > 0,
    canRewrite: (sessionId) => this.canRewriteSessionFile(sessionId),
    confirmWriterIdle: (sessionId) => this.closeQuietSessionWriter(sessionId),
    rewrite: (sessionId) => this.rewriteSessionSecrets(sessionId),
  });
  private readonly sessionEnvRefresh = createSessionEnvRefreshGate({
    canRefresh: (sessionId) => this.canRewriteSessionFile(sessionId),
    stopWriter: (sessionId) => this.closeQuietSessionWriter(sessionId),
  });
  private readonly planStore = new PlanStore();
  private planRuntimeMounted: boolean | undefined;
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
  private historyCache = new Map<string, { mtimeMs: number; size: number; before: number | string; limit: number; entries: HistoryEntry[] }>();
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
  /** Coalesce durable index writes: a log_delta burst must not retain one snapshot string per event. */
  private agentsPersistDirty = false;
  private agentsPersistInflight = false;
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
  private vaultDir: string;
  private vaultKeyProvider: VaultKeyProvider;
  private vaultAvailability?: () => VaultDiagnosis;
  private features: SpawnFeatures;
  private profileMode: "default" | "isolated";
  private resourceMode: "default" | "explicit";
  private proc: ProcFactory;
  private env: NodeJS.ProcessEnv;
  private modelsLoaded?: Promise<void>;
  /** True only after configured and auth-aware runtime catalogs have been merged successfully. */
  private modelCatalogReady = false;
  /** One /models probe per backend lifetime per normalized baseUrl. */
  private probedCompatBaseUrls = new Set<string>();
  private modelsJsonUnwritableWarned = false;
  /** Latest fire-and-forget contextWindow backfill (tests may await). */
  compatContextBackfill?: Promise<void>;
  private configuredModels: Model[] = [];
  /** Cached, deduped pi runtime model catalog for the current auth epoch.
   * Set to undefined by refreshModelsAfterAuthChange so login/logout re-fetches. */
  private runtimeModelsPromise?: Promise<Model[]>;
  private manualModelSelection?: { provider: string; modelId: string };
  private manualModelSelectionLoaded?: Promise<void>;
  private manualThinkingLevel?: ThinkingLevel;
  private manualThinkingLevelLoaded?: Promise<void>;
  private hiddenIds: string[] = [];
  private hiddenIdsLoaded?: Promise<void>;
  /** Selected vision model (full "provider/id" ref) mirrored into vision.json for @getpipher/vision. */
  private visionModel: string | null = null;
  private visionModelLoaded?: Promise<void>;
  /** Master switch for describing attachments through the selected vision model. */
  private visionEnabled = false;
  private visionEnabledLoaded?: Promise<void>;
  private projectPaths: string[] = [];
  private projectPathsLoaded?: Promise<void>;
  private projectModelsInitialized?: Promise<void>;
  private profileInitialization: Promise<void>;
  private modelsWrite: CanonicalModelsWriteQueue;
  private isolatedHomes = new Map<string, IsolatedProjectHome>();
  private projectNames: Record<string, string> = {};
  private projectNamesLoaded?: Promise<void>;
  private revealPath: (path: string) => Promise<void>;
  private settingsWrite: Promise<void> = Promise.resolve();
  private auth: ProviderAuthBackend;
  private authRuntimePromise?: Promise<AuthRuntimeLike>;
  /** Resident external-pi worker (when authHelperPath is used); stopped on backend close. */
  private externalAuthRuntime?: ExternalAuthRuntime;
  private queue: SessionMessageQueue;
  private stopEscalation: StopEscalationScheduler;
  private abortAckTimeoutMs: number;
  private queueStore: QueueStore;
  private quotaStore: QuotaStore;
  private toolBatchTelemetry: ToolBatchTelemetry;
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
    this.vaultDir = options.vaultDir ?? this.agentDir;
    this.vaultKeyProvider = options.vaultKeyProvider ?? envKeyProvider(options.env ?? process.env);
    this.vaultAvailability = options.vaultAvailability;
    configureVaultKeyProvider(this.vaultKeyProvider);
    this.modelsWrite = options.canonicalModelsWrite ?? createCanonicalModelsWriteQueue();
    this.profileInitialization = Promise.resolve(options.profileInitialization).then(
      () => undefined,
      () => undefined,
    );
    if (options.profileInitialization !== undefined) {
      void this.modelsWrite.enqueue(() => this.profileInitialization);
    }
    this.toolBatchTelemetry = options.toolBatchTelemetry ?? createToolBatchTelemetry({ agentDir: this.agentDir });
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
    this.revealPath = options.revealPath ?? defaultRevealPath;
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
    const stopHooks = options.stopEscalationHooks ?? defaultStopEscalationHooks();
    this.stopEscalation = options.stopEscalation
      ?? new StopEscalationScheduler({
        ...stopHooks,
        kill: (pid, signal) => {
          if (signal === "SIGKILL") this.markLiveExitingByPid(pid);
          stopHooks.kill(pid, signal);
        },
      }, options.stopEscalationDelays);
    this.abortAckTimeoutMs = options.abortAckTimeoutMs ?? 1_500;
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
      this.externalAuthRuntime = new ExternalAuthRuntime({
        helperPath: options.authHelperPath,
        nodePath: options.authNodePath ?? (this.piCommand.prefixArgs?.length ? this.piCommand.executable : undefined),
        piPath: this.piCommand.piPath ?? this.piCommand.executable,
        agentDir: this.agentDir,
        sessionsRoot: this.root,
        enforceProfile: this.profileMode === "isolated",
        env: { ...this.env, ...(this.piCommand.env ?? {}) },
      });
      this.authRuntimePromise = Promise.resolve(this.externalAuthRuntime);
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
    // Isolated init enqueues capability (if provided) then deterministic project migration.
    // Catalog preload waits on that same promise so the first listModels cannot cache a
    // pre-migration snapshot.
    void this.loadModelCatalog().catch(() => undefined);
    void this.index().catch(() => undefined);
  }
  subscribe(listener: (event: HostEvent) => void) {
    this.listeners.add(listener);
    this.projectionDebug("subscribe", { listeners: this.listeners.size });
    return () => {
      this.listeners.delete(listener);
      this.projectionDebug("unsubscribe", { listeners: this.listeners.size });
    };
  }
  private projectionDebugEnabled(): boolean {
    return Boolean(this.env?.PIPIUI_STREAM_DEBUG);
  }
  private projectionDebugFile(): string | undefined {
    if (!this.projectionDebugEnabled()) return undefined;
    if (this.projectionDebugFilePath !== undefined) return this.projectionDebugFilePath ?? undefined;
    const candidate = this.env?.PIPIUI_STREAM_DEBUG_FILE;
    try {
      const stat = typeof candidate === "string" && isAbsolute(candidate) ? lstatSync(candidate) : undefined;
      this.projectionDebugFilePath = typeof candidate === "string"
        && isAbsolute(candidate)
        && stat?.isFile()
        && !stat.isSymbolicLink()
        ? candidate
        : null;
    } catch {
      this.projectionDebugFilePath = null;
    }
    return this.projectionDebugFilePath ?? undefined;
  }
  private projectionDebugLine(line: string, output: "log" | "warn" = "warn"): void {
    if (!this.projectionDebugEnabled()) return;
    const bounded = line.slice(0, 1_999);
    console[output](bounded);
    const path = this.projectionDebugFile();
    if (!path) return;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(path, fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_NOFOLLOW);
      writeSync(descriptor, `${bounded}\n`, undefined, "utf8");
    } catch {
      // Debug observability is never product behavior. A removed, replaced, or
      // unwritable sink must not affect the host or create a new file.
    } finally {
      if (descriptor !== undefined) {
        try { closeSync(descriptor); } catch { /* best-effort diagnostic sink */ }
      }
    }
  }
  private projectionDebugSessionTag(sessionId?: string): string {
    if (!sessionId) return "session#none";
    let tag = this.projectionDebugSessionTags.get(sessionId);
    if (!tag) {
      tag = `session#${this.projectionDebugSessionSerial += 1}`;
      this.projectionDebugSessionTags.set(sessionId, tag);
    }
    return tag;
  }
  private projectionDebugAgentTag(key: string): string {
    let tag = this.projectionDebugAgentTags.get(key);
    if (!tag) {
      tag = `key#${this.projectionDebugAgentSerial += 1}`;
      this.projectionDebugAgentTags.set(key, tag);
    }
    return tag;
  }
  private projectionDebugActive(sessionId?: string): { active: number; activeKeys: string } {
    const rows = [...this.agents.entries()]
      .filter(([, agent]) => (!sessionId || agent.sessionId === sessionId) && this.isLiveAgentState(agent.state))
      .sort(([left], [right]) => left.localeCompare(right));
    const visible = rows.slice(0, 12).map(([key, agent]) =>
      `${this.projectionDebugAgentTag(key)}:${agent.state}:${this.projectionDebugProvenance.get(key) ?? "unknown"}`);
    return {
      active: rows.length,
      activeKeys: `${visible.join(",") || "none"}${rows.length > visible.length ? `,+${rows.length - visible.length}` : ""}`,
    };
  }
  private projectionDebug(reason: string, fields: Record<string, string | number | boolean | undefined> = {}): void {
    if (!this.projectionDebugEnabled()) return;
    const suffix = Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, "_").slice(0, 256)}`)
      .join(" ");
    this.projectionDebugLine(`[projection-debug] backend=${this.projectionDebugBackendTag} reason=${reason}${suffix ? ` ${suffix}` : ""}`);
  }
  private childStillRunning(child?: ChildProcessWithoutNullStreams): boolean {
    return Boolean(child && child.exitCode === null && !child.signalCode);
  }
  private liveProcessUsable(live: Live): boolean {
    return !live.exiting && this.childStillRunning(live.process);
  }
  private markLiveExitingByPid(pid: number): void {
    for (const live of this.live.values()) {
      if (live.process?.pid === pid) live.exiting = true;
    }
  }
  private async awaitUnusableLiveExit(id: string): Promise<void> {
    const live = this.live.get(id);
    if (!live || this.liveProcessUsable(live)) return;
    await (live.exit ?? Promise.resolve());
    if (this.live.get(id) === live) this.live.delete(id);
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
    this.persistAgents();
    this.closed = true;
    this.stopEscalation.cancelAll();
    this.stopOrphanReconcileTimer();
    // Stop the resident external-pi worker if one was spawned during this run.
    this.externalAuthRuntime?.stop();
    for (const wake of [...this.agentTerminalWaiters]) wake();
    this.titleGenerationAbort.abort();
    this.toolBatchTelemetry.dispose();
    await Promise.allSettled([...this.backgroundTitleGenerations]);
    await this.bridge.close();
    const live = [...this.live.values()];
    this.live.clear();
    this.planStore.clear();
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
    // Bounded wait for already-queued stats lines; a hung append must not block exit.
    await this.toolBatchTelemetry.close();
    this.leases.clear();
    this.documentWatcher.stop();
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
  private async queueIdle(id: string, epoch?: number): Promise<void> {
    if (this.closed) return;
    await this.loadQueue(id);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await this.awaitUnusableLiveExit(id);
    if (!this.closed) await this.queue.notifyIdle(id, epoch);
    if (!this.closed) {
      try {
        await this.flushSessionRedact(id);
        await this.flushSessionEnvRefresh(id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[secret-vault] session redaction failed", message);
        this.stream({ type: "error", sessionId: id, content: `secret redaction failed: ${message}` });
      }
    }
  }
  /**
   * Host abort: write abort, emit stopped quickly, escalate hung descendants,
   * sweep agents in the background. User stop never FIFO-drains.
   */
  private async abortSessionTurn(
    sessionId: string,
    options: { drain: false | "cutIn" },
  ): Promise<void> {
    const live = this.live.get(sessionId);
    if (live) live.hostAbortedTurn = true;
    if (options.drain === false && !this.queue.hasPendingCutIn(sessionId)) {
      this.queue.suppressIdleDrain(sessionId);
    }
    const abortLive = this.live.get(sessionId);
    const abortPid = abortLive?.process?.pid;
    if (abortPid !== undefined && this.childStillRunning(abortLive?.process)) {
      this.stopEscalation.start(
        sessionId,
        {
          piPid: abortPid,
          piIdentity: readProcessIdentity(abortPid),
        },
      () => {
        const current = this.live.get(sessionId);
        if (!current) {
          this.stream({ type: "status", sessionId, status: "stopped", pendingFollowUps: [] });
          return;
        }
        if (current.terminalEpoch !== current.turnEpoch) {
          this.projectTurnTerminal(current, "stopped");
        }
      },
      );
    }
    try {
      await Promise.race([
        this.command(sessionId, { type: "abort" }).catch(() => undefined),
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, this.abortAckTimeoutMs);
          timer.unref?.();
        }),
      ]);
    } catch {
      /* process already gone */
    }
    const after = this.live.get(sessionId);
    this.stream({
      type: "status",
      sessionId,
      status: "stopped",
      pendingFollowUps: after?.followUps ?? live?.followUps ?? [],
      turnEpoch: after?.turnEpoch ?? live?.turnEpoch,
    });
    after?.compaction.settleTurn();
    void this.sweepSessionAgents(sessionId);
  }
  private async cutInQueuedMessage(sessionId: string, messageId: string): Promise<QueuedMessage> {
    const message = await this.queue.cutInMessage(sessionId, messageId);
    if (this.queue.hasPendingCutIn(sessionId)) {
      await this.abortSessionTurn(sessionId, { drain: "cutIn" });
    }
    return message;
  }
  private async enqueueMessage(
    id: string,
    text: string,
    attachments?: PromptAttachment[],
  ): Promise<QueueEnqueueResult> {
    await this.loadQueue(id);
    const result = this.queue.enqueue(id, { text, attachments });
    if (result.outcome === "dispatched") await this.queue.waitForDispatch(id);
    else this.retryPendingFinalReconciliation(id);
    return {
      outcome: result.outcome === "dispatched" ? "direct" : "queued",
      message: result.message,
    };
  }
  /** A later user prompt must be able to wake a missed-settled turn and drain. */
  private retryPendingFinalReconciliation(sessionId: string): void {
    const live = this.live.get(sessionId);
    const pending = live?.pendingFinalReconciliation;
    if (!live || !pending) return;
    if (live.turnEpoch !== pending.epoch || live.terminalEpoch === pending.epoch) return;
    void this.reconcileFinalAssistantTurn(live, pending.epoch, pending.identity);
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
    if (this.profileMode === "isolated") {
      try {
        for (const project of await this.loadProjectPaths()) {
          const home = this.lookupIsolatedHome(project);
          if (home) await walk(home.sessionsDir);
        }
      } catch {
        /* a missing project list must not hide host-root sessions */
      }
    }
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
  private async readHistoryCached(path: string, before: number | string, limit: number, sessionId?: string): Promise<HistoryEntry[]> {
    const stat = await fs.stat(path);
    const hit = this.historyCache.get(path);
    if (
      hit &&
      hit.mtimeMs === stat.mtimeMs &&
      hit.size === stat.size &&
      hit.before === before &&
      hit.limit === limit
    )
      return hit.entries;
    const entries = await readHistory(path, before, limit, this.vaultDir, sessionId);
    this.historyCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, before, limit, entries });
    return entries;
  }
  private sessionSecrets(sessionId: string): RevealedSecret[] {
    try { return revealMountedSecrets(this.vaultDir, sessionId); }
    catch { return []; }
  }
  private sessionFileExclusive(sessionId: string): ExclusiveSessionWork {
    const existing = this.sessionFileBarriers.get(sessionId);
    if (existing) return existing;
    const created = createSessionWriteBarrier();
    this.sessionFileBarriers.set(sessionId, created);
    return created;
  }
  private canRewriteSessionFile(sessionId: string): boolean {
    const live = this.live.get(sessionId);
    if (live && this.liveProcessUsable(live)) return this.isSessionQuiet(sessionId);
    return !this.queue.isBusy(sessionId) && this.queue.listQueue(sessionId).length === 0;
  }
  private async closeQuietSessionWriter(sessionId: string): Promise<boolean> {
    const live = this.live.get(sessionId);
    if (!live || !this.liveProcessUsable(live)) return true;
    if (!this.isSessionQuiet(sessionId)) return false;
    live.exiting = true;
    live.compaction.dispose();
    await this.stopLiveProcess(live);
    await (live.exit ?? Promise.resolve());
    if (this.childStillRunning(live.process)) return false;
    if (this.live.get(sessionId) === live) this.live.delete(sessionId);
    return true;
  }
  private async rewriteSessionSecrets(sessionId: string): Promise<void> {
    const secrets = this.sessionSecrets(sessionId);
    if (secrets.length === 0) return;
    const path = this.live.get(sessionId)?.path ?? (await this.findSession(sessionId).catch(() => undefined))?.path;
    if (!path) throw new Error("session file unavailable for redaction");
    await redactSessionJsonl(path, secrets);
    this.historyCache.delete(path);
  }
  private requestSessionRedact(sessionId: string): void {
    this.sessionRedact.request(sessionId);
  }
  private async flushSessionRedact(sessionId: string): Promise<void> {
    await this.sessionFileExclusive(sessionId)(() => this.sessionRedact.flush(sessionId));
  }
  private async redactSessionFile(sessionId: string): Promise<void> {
    this.requestSessionRedact(sessionId);
    await this.flushSessionRedact(sessionId);
  }
  private requestSessionEnvRefresh(sessionId: string): void {
    this.sessionEnvRefresh.request(sessionId);
  }
  private async flushSessionEnvRefresh(sessionId: string): Promise<void> {
    await this.sessionFileExclusive(sessionId)(() => this.sessionEnvRefresh.flush(sessionId));
  }
  private async refreshSessionChildEnv(sessionId: string): Promise<void> {
    this.requestSessionEnvRefresh(sessionId);
    await this.flushSessionEnvRefresh(sessionId);
  }
  private vaultDek(): string | undefined {
    try { return this.vaultKeyProvider.getDek().toString("base64"); }
    catch { return undefined; }
  }
  private diagnoseVault(): VaultDiagnosis {
    if (this.vaultAvailability) return this.vaultAvailability();
    try {
      this.vaultKeyProvider.getDek();
      return vaultDiagnosisFor("available");
    } catch {
      return vaultDiagnosisFor("encryption-unavailable");
    }
  }
  private assertVaultReady(): void {
    const diagnosis = this.diagnoseVault();
    if (diagnosis.available) return;
    throw new VaultEncryptionError(diagnosis.kind, diagnosis.message);
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
      reasoning: true,
    };
    const availableThinkingLevels = thinkingLevelsForModel(model);
    return {
      ...base,
      model,
      thinkingLevel: resolveThinkingLevel(s.thinkingLevel ?? base.thinkingLevel, availableThinkingLevels, base.thinkingLevel) ?? "off",
      availableThinkingLevels,
    };
  }
  private project(path: string, names = this.projectNames): Project {
    return { id: dirId(path), name: displayNameFor(path, names), path };
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
        return this.listConfiguredProjects();
      case "getProjectPaths":
        return [...(await this.loadProjectPaths())];
      case "setProjectPaths":
        return this.saveProjectPaths(params[0]);
      case "addProject":
        return this.addProject(params[0]);
      case "removeProject":
        return this.removeProject(params[0] as string);
      case "renameProject":
        return this.renameProject(params[0] as string, params[1]);
      case "revealProject":
        return this.revealProject(params[0] as string);
      case "listUserMcpServers":
        return this.listUserMcpServers(params[0]);
      case "listDocuments":
        return this.listOpenedDocuments();
      case "readDocument":
        return readLocalDocument(params[0]);
      case "watchDocument":
        this.rememberOpenedDocuments([params[0]]);
        this.documentWatcher.setPath(typeof params[0] === "string" ? params[0].trim() : null);
        return undefined;
      case "unwatchDocument":
        this.documentWatcher.stop();
        return undefined;
      case "notifyDocumentsDropped":
        return this.notifyDocumentsDropped(params[0], params[1]);
      case "listSessions": {
        const pid = params[0] as string;
        const paths = await this.loadProjectPaths();
        if (!paths.some((path) => dirId(path) === pid))
          throw new Error(`unknown project ${pid}`);
        const all = await this.index();
        return all
          .filter((s) => dirId(s.header.cwd) === pid)
          .map((s) => {
            // A running Pi owns the newest in-memory session metadata. Its
            // set_session_name acknowledgement can arrive before the JSONL
            // stat/index pass observes the appended session_info row, so a
            // list refresh must not re-publish the older cached title.
            const live = this.live.get(s.header.id)?.session;
            return {
              id: s.header.id,
              projectId: pid,
              name: live?.name ?? s.name ?? "Session",
              updatedAt: Math.max(s.updatedAt, live?.updatedAt ?? 0),
              model: this.sessionModelOf(s),
            };
          })
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
        this.planStore.forget(s.header.id);
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
        const requestedBefore = params[1];
        const requestedLimit = Number(params[2] ?? 500);
        const numericBefore = Number(requestedBefore ?? 0);
        const before = typeof requestedBefore === "string" && requestedBefore
          ? requestedBefore
          : Number.isFinite(numericBefore) ? Math.max(0, Math.floor(numericBefore)) : 0;
        const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(500, Math.floor(requestedLimit))) : 500;
        return this.readHistoryCached(
          session.path,
          before,
          limit,
          session.header.id,
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
      case "cutInQueuedMessage":
        await this.loadQueue(params[0] as string);
        return this.cutInQueuedMessage(
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
          await this.abortSessionTurn(sessionId, { drain: false });
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
      case "addOpenAICompatibleProvider":
        return this.addOpenAICompatibleProvider(params[0]);
      case "getComputerUseState":
        return { enabled: await this.loadComputerUseEnabled() };
      case "setComputerUseEnabled":
        return { enabled: await this.saveComputerUseEnabled(params[0]) };
      case "getSubagentModels":
        return this.loadAndMaterializeSubagentModels(true);
      case "setSubagentModel":
        return this.saveSubagentModel(params[0], params[1]);
      case "getMemoryReviewModel":
        return this.loadMemoryReviewModel();
      case "setMemoryReviewModel":
        return this.saveMemoryReviewModel(params[0]);
      case "getVisionModel":
        return this.loadVisionModel();
      case "setVisionModel":
        return this.saveVisionModel(params[0]);
      case "getVisionEnabled":
        return this.loadVisionEnabled();
      case "setVisionEnabled":
        return this.saveVisionEnabled(params[0]);
      case "getPaddleOcrStatus":
        return this.loadPaddleOcrStatus(params[0]);
      case "setPaddleOcrAccessToken":
        return this.savePaddleOcrAccessToken(params[0], params[1]);
      case "diagnoseSecretVault":
        return this.diagnoseVault();
      case "listSecretVault": {
        const sessionId = String(params[0] ?? "");
        return {
          sessionId,
          secrets: listSecretMeta(this.vaultDir),
          mounts: listSessionMounts(this.vaultDir, sessionId),
        };
      }
      case "putSecretVault": {
        this.assertVaultReady();
        const input = params[0] as { name: string; envName: string; value: string; sessionId: string };
        const secret = await putSecret(this.vaultDir, input);
        const mount = await mountSecret(this.vaultDir, String(input.sessionId), secret.id);
        this.requestSessionEnvRefresh(String(input.sessionId));
        await this.redactSessionFile(String(input.sessionId)).catch((error) => {
          console.error("[secret-vault] session redaction failed", error);
          throw error;
        });
        await this.flushSessionEnvRefresh(String(input.sessionId));
        return { secret, mount, sessionId: input.sessionId };
      }
      case "mountSecretVault": {
        this.assertVaultReady();
        const sessionId = String(params[0]);
        const mount = await mountSecret(this.vaultDir, sessionId, String(params[1]), params[2] ? String(params[2]) : undefined);
        await this.refreshSessionChildEnv(sessionId);
        return { sessionId, mount };
      }
      case "unmountSecretVault": {
        const sessionId = String(params[0]);
        const removed = await unmountSecret(this.vaultDir, sessionId, String(params[1]));
        await this.refreshSessionChildEnv(sessionId);
        return { sessionId, removed };
      }
      case "deleteSecretVault": {
        const affected = new Set([...Object.keys(loadVault(this.vaultDir).mounts), ...this.live.keys()]);
        const deleted = await deleteSecret(this.vaultDir, String(params[0]));
        for (const sessionId of affected) this.requestSessionEnvRefresh(sessionId);
        for (const sessionId of affected) await this.flushSessionEnvRefresh(sessionId);
        return { deleted };
      }
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
        const rows = [...this.agents.values()].filter(
          (agent) => !sessionId || agent.sessionId === sessionId,
        );
        const result = params[1] === "history" ? rows : this.currentAgentSummaries(rows);
        const active = this.projectionDebugActive(sessionId);
        this.projectionDebug("list_agents", {
          session: this.projectionDebugSessionTag(sessionId),
          history: params[1] === "history",
          rows: result.length,
          ...active,
        });
        return result;
      }
      case "getAgentLogs": {
        const agentId = params[0] as string;
        const sessionId = params[1] as string;
        const runId = params[2] as string;
        if (params[3] === "agent") {
          const runs = [...this.agents.values()]
            .filter(agent => agent.agentId === agentId && (agent.sessionId ?? "") === sessionId)
            .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0) || left.runId.localeCompare(right.runId));
          const logs: CachedAgentLog[] = [];
          for (const run of runs) {
            for (const entry of this.agentLogCache.get(this.agentLogKey(sessionId, agentId, run.runId)) ?? []) {
              logs.push({ itemType: entry.itemType, text: entry.text, name: entry.name, isError: entry.isError });
            }
          }
          return logs;
        }
        return this.agentLogCache.get(this.agentLogKey(sessionId, agentId, runId)) ?? [];
      }
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
      case "probeDirectoryGit":
        return probeGit(await this.pickedDirectory(params[0]));
      case "gitInitDirectory":
        return initGit(await this.pickedDirectory(params[0]));
      case "probeGitBinary":
        return probeGitBinary();
      case "getPlans":
        return this.getPlans(params[0] as string | undefined);
      case "capabilities":
        return {
          computerUse: Boolean(
            this.features.computerUse &&
              this.computerDescriptor &&
              this.computerUsable(),
          ),
          revealInFinder: true,
          terminal: true,
          git: true,
          plan: this.planRuntimeAvailable(),
          retainedWorktreeDisposition: false,
          compact: true,
        };
    }
  }
  private rememberOpenedDocuments(input: unknown): void {
    const paths = Array.isArray(input) ? input : [input];
    for (const raw of paths) {
      if (typeof raw !== "string") continue;
      const path = raw.trim();
      if (!path || !isAbsolute(path) || !documentKindForName(path)) continue;
      if (!this.openedDocumentPaths.includes(path)) this.openedDocumentPaths.push(path);
    }
  }
  private async listOpenedDocuments(): Promise<DocumentSummary[]> {
    const out: DocumentSummary[] = [];
    for (const path of this.openedDocumentPaths) {
      const kind = documentKindForName(path);
      if (!kind) continue;
      try {
        const stat = await fs.stat(path);
        out.push({ id: path, name: basename(path), path, kind, size: stat.size, updatedAt: stat.mtimeMs });
      } catch {
        out.push({ id: path, name: basename(path), path, kind });
      }
    }
    return out;
  }
  private async notifyDocumentsDropped(sessionId: unknown, paths: unknown): Promise<void> {
    const list = Array.isArray(paths) ? paths.filter((item): item is string => typeof item === "string") : [];
    this.rememberOpenedDocuments(list);
    const supported = list.map((item) => item.trim()).filter((item) => item && isAbsolute(item) && documentKindForName(item));
    if (!supported.length) return;
    const injection = await buildDocumentsOpenedInjection(supported);
    if (!injection) return;
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      console.warn("[document-drop] no active session; skip announce");
      return;
    }
    const id = sessionId.trim();
    if (this.queue.isBusy(id) && this.live.has(id)) {
      try {
        await this.command(id, { type: "steer", message: injection });
        return;
      } catch (error) {
        console.warn("[document-drop]", error);
      }
    }
    this.documentInjections.setPending(id, injection, supported);
  }
  /** Configured display path: project identity, settings keys, and returned `path`. */
  private async configuredProject(projectId: string): Promise<Project> {
    const projects = (await this.handle("listProjects", [])) as Project[];
    const project = projects.find((item) => item.id === projectId);
    if (!project) throw new Error(`unknown project ${projectId}`);
    return project;
  }
  /** Git operations run in a known project work tree only — never in an id-derived path. */
  private async projectPath(projectId: string): Promise<string> {
    return this.verifiedProjectRoot((await this.configuredProject(projectId)).path);
  }
  /**
   * Add-project-time git probe/init run in a directory the user just picked in
   * the native chooser — the same trust level as `addProject`. Still refuse
   * anything that is not an existing absolute directory so a malformed value
   * can never point git at an arbitrary file.
   */
  private async pickedDirectory(value: unknown): Promise<string> {
    const path = typeof value === "string" ? value.trim() : "";
    if (!path || !isAbsolute(path)) throw new Error("目录必须是绝对路径");
    const stat = await fs.stat(path).catch(() => undefined);
    if (!stat?.isDirectory()) throw new Error(`目录不存在或不是文件夹：${path}`);
    return path;
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
  private lookupIsolatedHome(projectRoot: string): IsolatedProjectHome | undefined {
    return this.isolatedHomes.get(projectRoot) ?? this.isolatedHomes.get(resolve(projectRoot));
  }
  private rememberIsolatedHome(displayPath: string, home: IsolatedProjectHome): void {
    this.isolatedHomes.set(displayPath, home);
    this.isolatedHomes.set(resolve(displayPath), home);
    this.isolatedHomes.set(home.realProjectRoot, home);
    this.isolatedHomes.set(home.displayPath, home);
  }
  private isolatedProjectPaths(cwd: string): { agentDir?: string; sessionsRoot?: string } {
    if (this.profileMode !== "isolated") return {};
    const home = this.lookupIsolatedHome(cwd);
    if (!home) return {};
    return {
      agentDir: home.agentDir,
      sessionsRoot: home.sessionsDir,
    };
  }
  private verifiedProjectRoot(displayOrCwd: string): string {
    if (this.profileMode !== "isolated") return displayOrCwd;
    return this.lookupIsolatedHome(displayOrCwd)?.realProjectRoot ?? displayOrCwd;
  }
  private migrateSharedModels(projectRoots: string[]): Promise<void> {
    return this.modelsWrite.enqueue(async () => {
      await migrateSharedProjectModels({ canonicalAgentDir: this.agentDir, projectRoots });
    }).then(() => undefined);
  }
  private async ensureIsolatedProjectHome(
    projectRoot: string,
    options?: { migrate?: boolean },
  ): Promise<IsolatedProjectHome | undefined> {
    if (this.profileMode !== "isolated") return undefined;
    const cached = this.lookupIsolatedHome(projectRoot);
    if (cached) {
      if (options?.migrate !== false) {
        await this.migrateSharedModels([cached.realProjectRoot]);
      }
      return cached;
    }
    await sanitizePiSettingsFile(join(this.agentDir, "settings.json")).catch(() => false);
    const prepared = await ensureProjectPiHome({
      projectRoot,
      credentialSeedDir: this.agentDir,
      deferModelsMigration: true,
    });
    const home: IsolatedProjectHome = {
      displayPath: projectRoot,
      realProjectRoot: prepared.realProjectRoot,
      agentDir: prepared.agentDir,
      sessionsDir: prepared.sessionsDir,
    };
    this.rememberIsolatedHome(projectRoot, home);
    if (options?.migrate !== false) {
      await this.migrateSharedModels([home.realProjectRoot]);
    }
    return home;
  }
  private async newSession(projectId: string, name?: string): Promise<Session> {
    // Session creation needs only local configuration. The optional authenticated runtime
    // catalog may involve network-backed provider discovery and must never gate a sidebar click.
    await this.loadConfiguredModels();
    this.applyManualModelSelection(await this.loadManualModelSelection());
    this.applyManualThinkingLevel(await this.loadManualThinkingLevel());
    const projects = (await this.handle("listProjects", [])) as Project[];
    const p = projects.find((x) => x.id === projectId);
    if (!p) throw new Error(`unknown project ${projectId}`);
    const id = crypto.randomUUID();
    const isolated = this.profileMode === "isolated"
      ? await this.ensureIsolatedProjectHome(p.path)
      : undefined;
    const dir = isolated
      ? isolated.sessionsDir
      : join(this.root, encodeURIComponent(p.path));
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
    const inheritedThinking = this.modelState.thinkingLevel;
    if (this.modelState.availableThinkingLevels.includes(inheritedThinking)) {
      lines.push(
        JSON.stringify({
          type: "thinking_level_change",
          id: crypto.randomUUID(),
          parentId: null,
          timestamp: new Date().toISOString(),
          thinkingLevel: inheritedThinking,
        }),
      );
    }
    await fs.writeFile(path, lines.join("\n") + "\n");
    const created = await fs.stat(path);
    this.rememberSessionMeta(
      {
        path,
        header,
        name: name ?? "New session",
        updatedAt: Date.now(),
        thinkingLevel: this.modelState.availableThinkingLevels.includes(inheritedThinking)
          ? inheritedThinking
          : undefined,
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
        await this.sessionFileExclusive(sessionId)(async () => {
          await fs.appendFile(session.path, `${JSON.stringify({
            type: "session_info",
            id: crypto.randomUUID(),
            parentId: await lastJsonlEntryId(session.path),
            timestamp,
            name: title,
          })}\n`);
        });
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
    if (live && this.liveProcessUsable(live)) return Promise.resolve(live);
    if (live && !this.liveProcessUsable(live)) {
      return (live.exit ?? Promise.resolve()).then(() => {
        if (this.live.get(id) === live) this.live.delete(id);
        return this.ensure(id);
      });
    }
    const inFlight = this.ensureInFlight.get(id);
    if (inFlight) return inFlight;
    this.stopEscalation.cancel(id);
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
    if (this.features.webSearch && this.profileMode === "isolated") {
      try {
        await ensureWebSearchDefaults(this.agentDir);
      } catch (error) {
        console.warn(
          `[pipiui] web-search defaults: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const isolated = this.profileMode === "isolated"
      ? await this.ensureIsolatedProjectHome(found.header.cwd)
      : undefined;
    const spawnCwd = isolated?.realProjectRoot ?? found.header.cwd;
    const output = assemblePiSpawn({
      sessionPath: found.path,
      sessionId: id,
      cwd: spawnCwd,
      runtimeRoot: this.runtimeRoot,
      ...this.isolatedProjectPaths(found.header.cwd),
      resourceMode: this.resourceMode,
      features: this.features,
      paths: resolveSpawnPaths(this.refreshRuntimeTree(), {
        managedNodeModulesRoot: this.managedNodeModulesRoot,
      }),
      mainModelId: this.mainModelId(),
      memoryReviewModelId: (await this.loadMemoryReviewModel()) ?? undefined,
      subagentModelsFile: this.subagentModelsRuntimeFile(),
      bridgePort,
      bridgeRoutingKey: id,
      sessionCapability,
      computerCapability,
      computerDescriptor: computerCapability
        ? this.computerDescriptor
        : undefined,
      vaultDir: this.vaultDir,
      vaultDek: this.vaultDek(),
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
      cwd: spawnCwd,
      // T17 parity: the configured agent profile's .env is layered under the internal host contract
      // (and wins over the host process env), so env-key providers like DeepSeek/Kimi
      // that `listModels` sees via the auth runtime resolve in the RPC session too.
      env: withToolPath(
        // Main Pi must keep the host-injected DEK so pipiui-secret-vault can encrypt.
        // Workers go through applySessionMountsToWorkerEnv and never see the DEK.
        applySessionMountsToMainEnv(
          mergedSpawnEnvironment(this.env, await this.readDotEnv(), {
            ...output.env,
            ...(this.piCommand.env ?? {}),
          }),
          workerEnvFromVault(this.vaultDir, id),
        ),
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
      cwd: spawnCwd,
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
      this.bridge.unregister(id);
      this.toolBatchTelemetry.flushSession(id);
      // Pi sometimes writes the final assistant message and exits without
      // `agent_settled`. Without this the UI stays 进行中 forever.
      if (!this.closed && this.queue.isBusy(id))
        this.projectTurnTerminal(live, live.hostAbortedTurn ? "stopped" : "settled");
      live.compaction.dispose();
      const finish = () => {
        if (this.live.get(id) === live) this.live.delete(id);
        resolveExit();
        this.reconcileOrphanedNow(id);
        if (!this.closed) void this.queueIdle(id, live.turnEpoch);
      };
      // Keep the writer lease after Pi exits. Releasing here let another
      // pipiui-electron (dev:browser, a second App) steal the file while this
      // UI still looked writable, then the next send failed with
      // "session is read-only: held by pipiui-electron".
      finish();
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
    if (this.projectionDebugEnabled()) this.projectionDebugLine(`[stream-debug] stdout session=${this.projectionDebugSessionTag(live.session.id)} t=${Date.now()} bytes=${chunk.length}`, "log");
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
    try {
      const model =
        this.sessionModelStates.get(live.session.id)?.model
        ?? this.sessionModelSnapshots.get(live.session.id)?.model
        ?? this.modelState.model;
      this.toolBatchTelemetry.observeRpc(e, {
        sessionId: live.session.id,
        provider: model?.provider,
        model: model?.id,
      });
    } catch {
      /* best-effort telemetry must not affect the live stream */
    }
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
      // Must be synchronous: fake-pi/real Pi emit agent_start and agent_settled
      // in the same stdout chunk. An async markBusy lets the settle run with a
      // stale epoch and drop the drain that should release the next queued item.
      live.turnEpoch = this.queue.markBusy(id);
      live.pendingFinalReconciliation = undefined;
      if (!this.queueLoads.has(id)) {
        void this.loadQueue(id).then(() => {
          if (this.live.get(id) !== live) return;
          live.turnEpoch = this.queue.markBusy(id);
        });
      }
      const pendingFollowUps = live.followUps.length > 0
        ? live.followUps
        : live.pendingDrainPrompt
          ? [live.pendingDrainPrompt]
          : [];
      live.pendingDrainPrompt = undefined;
      live.streamedAssistantText = "";
      this.stream({
        type: "status",
        sessionId: id,
        status: "started",
        pendingFollowUps,
        turnEpoch: live.turnEpoch,
      });
    } else if (e.type === "agent_settled") {
      this.requestSessionRedact(id);
      this.projectTurnTerminal(live, live.hostAbortedTurn ? "stopped" : "settled", true);
    } else if (e.type === "agent_stopped" || e.type === "agent_error") {
      this.requestSessionRedact(id);
      this.projectTurnTerminal(live, "stopped");
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
      const secrets = this.sessionSecrets(id);
      live.streamRedactors ??= { text: new Map(), thinking: new Map(), tool: new Map() };
      const redactor = (kind: "text" | "thinking" | "tool", index: number) => {
        const bag = live.streamRedactors![kind];
        const existing = bag.get(index);
        if (existing) return existing;
        const created = new StreamRedactor(secrets);
        bag.set(index, created);
        return created;
      };
      if (d.type === "text_delta") {
        const delta = redactor("text", d.contentIndex ?? 0).push(d.delta ?? "");
        live.streamedAssistantText = (live.streamedAssistantText ?? "") + delta;
        this.stream({
          type: "text",
          sessionId: id,
          contentIndex: d.contentIndex ?? 0,
          segment: live.messageEpoch,
          delta,
        });
      }
      if (d.type === "thinking_delta") {
        const delta = redactor("thinking", d.contentIndex ?? 0).push(d.delta ?? "");
        this.stream({
          type: "thinking",
          sessionId: id,
          contentIndex: d.contentIndex ?? 0,
          segment: live.messageEpoch,
          delta,
        });
      }
      if (this.projectionDebugEnabled() && (d.type === "text_delta" || d.type === "thinking_delta"))
        this.projectionDebugLine(`[stream-debug] emit ${d.type} session=${this.projectionDebugSessionTag(id)} t=${Date.now()} len=${(d.delta ?? "").length}`, "log");
      if (d.type === "toolcall_start") {
        // Name/id are stripped from RPC start/delta events. Emit a provisional
        // card immediately so a long think is not followed by a silent wait
        // until every toolcall_end arrives in one burst.
        const index = d.contentIndex ?? 0;
        if (!live.toolArgs.has(index)) live.toolArgs.set(index, "");
        this.stream({
          type: "tool_call",
          sessionId: id,
          contentIndex: index,
          segment: live.messageEpoch,
          toolCallId: `content-${index}`,
          name: "tool",
          delta: "",
        });
      } else if (d.type === "toolcall_delta") {
        const index = d.contentIndex ?? 0;
        const delta = redactor("tool", index).push(d.delta ?? "");
        live.toolArgs.set(index, (live.toolArgs.get(index) ?? "") + delta);
        this.stream({
          type: "tool_call",
          sessionId: id,
          contentIndex: index,
          segment: live.messageEpoch,
          toolCallId: `content-${index}`,
          name: "tool",
          delta,
        });
      } else if (d.type === "toolcall_end") {
        const index = d.contentIndex ?? 0;
        const tail = live.streamRedactors?.tool.get(index)?.flush() ?? "";
        live.streamRedactors?.tool.delete(index);
        const buffered = (live.toolArgs.get(index) ?? "") + tail;
        live.toolArgs.delete(index);
        const call = d.toolCall ?? {};
        const args =
          call.arguments != null && typeof call.arguments === "object"
            ? redactText(JSON.stringify(call.arguments), secrets)
            : typeof call.arguments === "string"
              ? redactText(call.arguments, secrets)
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
      const endingEpoch = live.messageEpoch;
      const endedMessage = e.message ?? {};
      const secrets = this.sessionSecrets(id);
      if (endedMessage.role === "assistant") {
        const flushed = [...(live.streamRedactors?.text.values() ?? [])].map((item) => item.flush()).join("");
        live.streamRedactors?.text.clear();
        live.streamRedactors?.thinking.forEach((item) => {
          const tail = item.flush();
          if (tail) this.stream({ type: "thinking", sessionId: id, contentIndex: 0, segment: endingEpoch, delta: tail });
        });
        live.streamRedactors?.thinking.clear();
        const fullText = redactText(assistantVisibleText(endedMessage.content), secrets);
        const already = (live.streamedAssistantText ?? "") + flushed;
        if (fullText && (!already || (fullText.startsWith(already) && fullText.length > already.length))) {
          this.stream({
            type: "text",
            sessionId: id,
            contentIndex: 0,
            segment: endingEpoch,
            delta: already ? fullText.slice(already.length) : fullText,
          });
        } else if (flushed) {
          this.stream({ type: "text", sessionId: id, contentIndex: 0, segment: endingEpoch, delta: flushed });
        }
        live.streamedAssistantText = "";
      }
      // A new message restarts content indexing; drop unclaimed tool buffers and
      // bump the epoch so later thinking segments key apart from earlier ones.
      live.toolArgs.clear();
      live.messageEpoch++;
      // Swift ingests user rows on message_end. Follow-ups such as [subagent-done]
      // never go through sendPrompt, so without this the live transcript stays on
      // the previous assistant turn and the composer looks falsely stuck.
      const message = e.message ?? {};
      if (message.role === "user" || isSubagentCompletion(message) || isSubagentCompletion(e)) {
        const content = text(message.content ?? e.content);
        if (content) {
          this.stream({
            type: "user_message",
            sessionId: id,
            id: typeof message.id === "string" ? message.id : typeof e.id === "string" ? e.id : undefined,
            content: redactText(content, secrets),
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
        if (content) this.stream({ type: "error", sessionId: id, content: redactText(content, secrets) });
      }
      if (
        message.role === "assistant"
        && message.stopReason === "stop"
        && !((Array.isArray(message.content) ? message.content : []).some((part: any) =>
          part?.type === "toolCall" || part?.type === "tool_call" || part?.type === "tool_use"))
      ) {
        const epoch = live.turnEpoch;
        const timestamp = asFinalAssistantTimestamp(message.timestamp);
        const identity = timestamp !== undefined
          ? {
              timestamp,
              ...(typeof message.responseId === "string" && message.responseId
                ? { responseId: message.responseId }
                : {}),
            }
          : undefined;
        if (epoch !== undefined && identity) {
          live.pendingFinalReconciliation = { epoch, identity };
          this.projectionDebug("final_seen", {
            session: this.projectionDebugSessionTag(id),
            epoch,
            terminalEpoch: live.terminalEpoch,
            listeners: this.listeners.size,
            ...this.projectionDebugActive(id),
          });
          void this.reconcileFinalAssistantTurn(live, epoch, identity);
        }
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
  private projectTurnTerminal(live: Live, status: "settled" | "stopped", pushStats = false): boolean {
    const epoch = live.turnEpoch;
    if (epoch === undefined || live.terminalEpoch === epoch) return false;
    live.terminalEpoch = epoch;
    live.pendingFinalReconciliation = undefined;
    this.stopEscalation.cancel(live.session.id);
    // The durable agent index is authoritative at a terminal boundary. Replay
    // its current session view so a renderer that missed an end event cannot
    // retain a stale running projection. Real live agents remain live here;
    // this does not clear or rewrite any agent state.
    const replay = this.currentAgentSummaries(
      [...this.agents.values()].filter(agent => agent.sessionId === live.session.id),
    );
    this.projectionDebug("terminal_replay", {
      session: this.projectionDebugSessionTag(live.session.id),
      epoch,
      status,
      rows: replay.length,
      listeners: this.listeners.size,
      ...this.projectionDebugActive(live.session.id),
    });
    for (const agent of replay) {
      const key = this.agentKey(agent.agentId, agent.sessionId, agent.runId);
      this.projectionDebug("agent_broadcast", {
        source: "terminal_replay",
        key: this.projectionDebugAgentTag(key),
        state: agent.state,
        provenance: this.projectionDebugProvenance.get(key) ?? "unknown",
        listeners: this.listeners.size,
      });
      this.agent({ type: "agent", agent });
    }
    this.stream({
      type: "status",
      sessionId: live.session.id,
      status,
      pendingFollowUps: live.followUps,
      turnEpoch: epoch,
    });
    this.projectionDebug("terminal_projected", {
      session: this.projectionDebugSessionTag(live.session.id),
      epoch,
      status,
      listeners: this.listeners.size,
      ...this.projectionDebugActive(live.session.id),
    });
    void this.queueIdle(live.session.id, epoch);
    // A compact lifecycle that omitted its end event must not wedge the
    // scheduler; terminal projection is the final authority for this turn.
    live.compaction.settleTurn();
    if (pushStats) void this.pushSessionStats(live.session.id);
    return true;
  }
  private terminalReconciliationHasPendingWork(live: Live, state: any): boolean {
    // Host-queued user prompts are why we must settle: notifyIdle drains them.
    // Counting them as pending work deadlocks "typed after a missed agent_settled".
    const hasRunningAgent = [...this.agents.values()].some(agent =>
      agent.sessionId === live.session.id && (agent.state === "running" || agent.state === "stalled"));
    return state?.pendingMessageCount !== 0
      || state?.isCompacting === true
      || live.followUps.length > 0
      || live.pendingDrainPrompt !== undefined
      || live.compactionHoldsQueue === true
      || live.compaction.isCompacting
      || hasRunningAgent;
  }
  private debugTerminalReconciliation(
    live: Live,
    epoch: number,
    reason: string,
    state?: any,
    durableFinal?: boolean,
  ): void {
    if (!this.projectionDebugEnabled()) return;
    const actionableQueueCount = this.queue.listQueue(live.session.id)
      .filter(item => item.state === "queued" || item.state === "sending").length;
    const runningAgentCount = [...this.agents.values()].filter(agent =>
      agent.sessionId === live.session.id && (agent.state === "running" || agent.state === "stalled")).length;
    this.projectionDebugLine(
      `[terminal-reconcile] reason=${reason}`
      + ` backend=${this.projectionDebugBackendTag}`
      + ` session=${this.projectionDebugSessionTag(live.session.id)}`
      + ` epoch=${epoch}`
      + ` epochCurrent=${live.turnEpoch === epoch}`
      + ` epochTerminal=${live.terminalEpoch === epoch}`
      + ` streaming=${String(state?.isStreaming)}`
      + ` compacting=${String(state?.isCompacting)}`
      + ` pending=${String(state?.pendingMessageCount)}`
      + ` followUps=${live.followUps.length}`
      + ` queue=${actionableQueueCount}`
      + ` agents=${runningAgentCount}`
      + ` activeKeys=${this.projectionDebugActive(live.session.id).activeKeys}`
      + ` listeners=${this.listeners.size}`
      + ` compactionHold=${live.compactionHoldsQueue === true}`
      + ` compactionLive=${live.compaction.isCompacting}`
      + ` durable=${String(durableFinal)}`,
    );
  }
  private async reconcileFinalAssistantTurn(live: Live, epoch: number, identity: FinalAssistantIdentity): Promise<void> {
    this.projectionDebug("reconcile_invoke", {
      session: this.projectionDebugSessionTag(live.session.id),
      epoch,
      terminalEpoch: live.terminalEpoch,
      listeners: this.listeners.size,
      ...this.projectionDebugActive(live.session.id),
    });
    // Let any normal agent_settled / queued immediate re-entry already present
    // in the same stdout batch win before asking Pi for its authoritative state.
    await new Promise<void>(resolve => setImmediate(resolve));
    if (this.closed || this.live.get(live.session.id) !== live || live.turnEpoch !== epoch || live.terminalEpoch === epoch) {
      this.debugTerminalReconciliation(live, epoch, "initial_fence");
      return;
    }
    let state: any;
    try {
      state = await this.command(live.session.id, { type: "get_state" });
    } catch {
      this.debugTerminalReconciliation(live, epoch, "first_state_error");
      return;
    }
    if (this.closed || this.live.get(live.session.id) !== live || live.turnEpoch !== epoch || live.terminalEpoch === epoch) {
      this.debugTerminalReconciliation(live, epoch, "first_state_fence", state);
      return;
    }
    if (this.terminalReconciliationHasPendingWork(live, state)) {
      this.debugTerminalReconciliation(live, epoch, "first_state_pending", state);
      return;
    }
    if (state?.isStreaming === false) {
      this.debugTerminalReconciliation(live, epoch, "idle_settle", state);
      this.projectTurnTerminal(live, "settled", true);
      return;
    }
    // Pi can persist the final assistant message but omit agent_settled while
    // its in-memory isStreaming flag remains stale. Require exact durable
    // evidence, then a short stable interval and a second authoritative state
    // check before projecting terminal. A real queued re-entry, worker, tool
    // continuation, compaction, or late agent_settled wins every fence.
    const durableFinal = await waitForLatestDurableFinalAssistant(live.path, identity);
    if (this.closed || this.live.get(live.session.id) !== live || live.turnEpoch !== epoch || live.terminalEpoch === epoch) {
      this.debugTerminalReconciliation(live, epoch, "durable_wait_fence", state, durableFinal);
      return;
    }
    if (!durableFinal) {
      this.debugTerminalReconciliation(live, epoch, "durable_missing", state, false);
      return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 100));
    if (this.closed || this.live.get(live.session.id) !== live || live.turnEpoch !== epoch || live.terminalEpoch === epoch) {
      this.debugTerminalReconciliation(live, epoch, "stable_wait_fence", state, true);
      return;
    }
    try {
      state = await this.command(live.session.id, { type: "get_state" });
    } catch {
      this.debugTerminalReconciliation(live, epoch, "second_state_error", undefined, true);
      return;
    }
    if (this.closed || this.live.get(live.session.id) !== live || live.turnEpoch !== epoch || live.terminalEpoch === epoch) {
      this.debugTerminalReconciliation(live, epoch, "second_state_fence", state, true);
      return;
    }
    if (this.terminalReconciliationHasPendingWork(live, state)) {
      this.debugTerminalReconciliation(live, epoch, "second_state_pending", state, true);
      return;
    }
    this.debugTerminalReconciliation(live, epoch, "durable_settle", state, true);
    this.projectTurnTerminal(live, "settled", true);
  }
  private writeCommand(live: Live, body: Rpc) {
    return new Promise<any>((resolve, reject) => {
      const req = crypto.randomUUID();
      live.pending.set(req, { resolve, reject });
      live.process!.stdin.write(
        JSON.stringify({ id: req, ...body }) + "\n",
      );
    });
  }
  private async command(id: string, body: Rpc, retried = false): Promise<any> {
    if (body.type === "abort") {
      const live = this.live.get(id);
      if (!live || !this.liveProcessUsable(live)) return;
      return this.writeCommand(live, body);
    }
    const live = await this.ensure(id);
    if (!this.liveProcessUsable(live)) {
      await (live.exit ?? Promise.resolve());
      if (this.live.get(id) === live) this.live.delete(id);
      if (retried) {
        throw live.exitError ?? new PiExitedError(
          live.process?.exitCode ?? null,
          live.process?.signalCode ?? null,
          live.stderrTail,
        );
      }
      return this.command(id, body, true);
    }
    return this.writeCommand(live, body);
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
  private async loadManualThinkingLevel(): Promise<ThinkingLevel | undefined> {
    if (!this.manualThinkingLevelLoaded) {
      this.manualThinkingLevelLoaded = (async () => {
        const value = (await this.readSettings()).manualThinkingLevel;
        this.manualThinkingLevel =
          typeof value === "string" && THINKING_LEVELS.includes(value as ThinkingLevel)
            ? value as ThinkingLevel
            : undefined;
      })();
    }
    await this.manualThinkingLevelLoaded;
    return this.manualThinkingLevel;
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
  /** A remembered thinking档 affects only future sessions; existing sessions keep their own level. */
  private applyManualThinkingLevel(level: ThinkingLevel | undefined): void {
    if (!level) return;
    this.modelState = {
      ...this.modelState,
      thinkingLevel: resolveThinkingLevel(level, this.modelState.availableThinkingLevels, this.modelState.thinkingLevel) ?? "off",
    };
  }
  private async rememberManualModelSelection(model: Model): Promise<void> {
    const selection = { provider: model.provider, modelId: model.id };
    await this.updateSettings((settings) => {
      settings.manualModelSelection = selection;
    });
    this.manualModelSelection = selection;
    this.manualModelSelectionLoaded = Promise.resolve();
    const availableThinkingLevels = thinkingLevelsForModel(model);
    this.modelState = {
      ...this.modelState,
      model,
      thinkingLevel: resolveThinkingLevel(
        this.manualThinkingLevel ?? this.modelState.thinkingLevel,
        availableThinkingLevels,
      ) ?? "off",
      availableThinkingLevels,
    };
  }
  private async rememberManualThinkingLevel(level: ThinkingLevel): Promise<void> {
    await this.updateSettings((settings) => {
      settings.manualThinkingLevel = level;
    });
    this.manualThinkingLevel = level;
    this.manualThinkingLevelLoaded = Promise.resolve();
    this.applyManualThinkingLevel(level);
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
  private checkedMemoryReviewModel(value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string")
      throw new Error("memoryReviewModel 必须是 provider/model 完整标识或 null");
    const model = value.trim();
    const slash = model.indexOf("/");
    if (model.length > 300 || slash <= 0 || slash === model.length - 1 || /[\u0000-\u001f\u007f\s]/u.test(model))
      throw new Error(`Hermes 复核模型必须使用 provider/model 完整标识：${model}`);
    return model;
  }
  private async loadMemoryReviewModel(): Promise<string | null> {
    return this.checkedMemoryReviewModel((await this.readSettings()).memoryReviewModel);
  }
  private async saveMemoryReviewModel(value: unknown): Promise<string | null> {
    const checked = this.checkedMemoryReviewModel(value);
    return this.updateSettings((settings) => {
      if (checked) settings.memoryReviewModel = checked;
      else delete settings.memoryReviewModel;
      return checked;
    });
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
    if (this.profileMode === "isolated" && !this.projectModelsInitialized) {
      const realRoots: string[] = [];
      for (const projectRoot of this.projectPaths) {
        const home = await this.ensureIsolatedProjectHome(projectRoot, { migrate: false });
        if (home) realRoots.push(home.realProjectRoot);
      }
      const initialization = this.migrateSharedModels(realRoots);
      this.projectModelsInitialized = initialization;
      try {
        await initialization;
      } catch (error) {
        if (this.projectModelsInitialized === initialization) this.projectModelsInitialized = undefined;
        throw error;
      }
    } else {
      await this.projectModelsInitialized;
    }
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
    if (this.profileMode === "isolated") {
      const realRoots: string[] = [];
      for (const projectRoot of saved) {
        const home = await this.ensureIsolatedProjectHome(projectRoot, { migrate: false });
        if (home) realRoots.push(home.realProjectRoot);
      }
      const initialization = this.migrateSharedModels(realRoots);
      this.projectModelsInitialized = initialization;
      try {
        await initialization;
      } catch (error) {
        if (this.projectModelsInitialized === initialization) this.projectModelsInitialized = undefined;
        throw error;
      }
      this.modelsLoaded = undefined;
      this.runtimeModelsPromise = undefined;
      this.modelCatalogReady = false;
      await this.loadModelCatalog(true);
    }
    return [...saved];
  }
  private async addProject(value: unknown): Promise<Project> {
    if (typeof value !== "string" || !value.length)
      throw new Error("project path 必须是非空 string");
    const paths = await this.loadProjectPaths();
    if (!paths.includes(value)) await this.saveProjectPaths([value, ...paths]);
    await this.ensureIsolatedProjectHome(value);
    await this.loadProjectNames();
    return this.project(value);
  }
  private async listConfiguredProjects(): Promise<Project[]> {
    const paths = await this.loadProjectPaths();
    const names = await this.loadProjectNames();
    return paths.map((path) => this.project(path, names));
  }
  /** Display name only — never renames the on-disk folder. */
  private async renameProject(projectId: string, name: unknown): Promise<Project> {
    if (typeof name !== "string") throw new Error("project name 必须是 string");
    const trimmed = name.trim();
    if (!trimmed) throw new Error("项目名称不能为空");
    if (trimmed.length > 120) throw new Error("项目名称过长");
    const project = await this.configuredProject(projectId);
    const displayPath = project.path;
    const names = await this.loadProjectNames();
    const next = { ...names };
    if (trimmed === (basename(displayPath) || displayPath)) delete next[displayPath];
    else next[displayPath] = trimmed;
    await this.saveProjectNames(next);
    return this.project(displayPath, next);
  }
  private async listUserMcpServers(projectId: unknown): Promise<UserMcpServer[]> {
    if (typeof projectId !== "string" || !projectId.trim()) return [];
    let root: string;
    try {
      root = await this.projectPath(projectId);
    } catch {
      return [];
    }
    return readUserMcpServers(join(root, ".pi", "mcp.json"));
  }
  private async revealProject(projectId: string): Promise<void> {
    const path = await this.projectPath(projectId);
    let stat;
    try {
      stat = await fs.stat(path);
    } catch (error: any) {
      if (error?.code === "ENOENT") throw new Error(`项目文件夹不存在：${path}`);
      throw new Error(`无法打开项目文件夹：${error instanceof Error ? error.message : String(error)}`);
    }
    if (!stat.isDirectory()) throw new Error(`项目路径不是文件夹：${path}`);
    await this.revealPath(path);
  }
  private checkedProjectNames(value: unknown): Record<string, string> {
    if (value === undefined) return {};
    if (
      !isRecord(value) ||
      !Object.entries(value).every(([key, name]) => typeof key === "string" && key.length > 0 && typeof name === "string" && name.trim().length > 0)
    )
      throw new Error("projectNames 必须是 Record<string, string>");
    return Object.fromEntries(Object.entries(value).map(([key, name]) => [key, (name as string).trim()]));
  }
  private async loadProjectNames(): Promise<Record<string, string>> {
    if (!this.projectNamesLoaded) {
      this.projectNamesLoaded = (async () => {
        this.projectNames = this.checkedProjectNames((await this.readSettings()).projectNames);
      })();
    }
    await this.projectNamesLoaded;
    return { ...this.projectNames };
  }
  private async saveProjectNames(names: Record<string, string>): Promise<Record<string, string>> {
    const saved = await this.updateSettings((settings) => {
      if (Object.keys(names).length === 0) delete settings.projectNames;
      else settings.projectNames = { ...names };
      return { ...names };
    });
    this.projectNames = saved;
    this.projectNamesLoaded = Promise.resolve();
    return { ...saved };
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
  /** Master switch for routing attachments to the selected vision model. Missing is intentionally false. */
  private async loadVisionEnabled(): Promise<boolean> {
    if (!this.visionEnabledLoaded) {
      this.visionEnabledLoaded = (async () => {
        const value = (await this.readSettings()).visionEnabled;
        if (value === undefined) {
          this.visionEnabled = false;
          return;
        }
        if (typeof value !== "boolean") throw new Error("visionEnabled 必须是 boolean");
        this.visionEnabled = value;
      })();
    }
    await this.visionEnabledLoaded;
    return this.visionEnabled;
  }
  private async saveVisionEnabled(value: unknown): Promise<boolean> {
    if (typeof value !== "boolean") throw new Error("visionEnabled 必须是 boolean");
    await this.updateSettings((settings) => {
      settings.visionEnabled = value;
    });
    this.visionEnabled = value;
    this.visionEnabledLoaded = Promise.resolve();
    return value;
  }
  private async paddleOcrAgentDir(projectId: unknown): Promise<string> {
    if (typeof projectId !== "string" || !projectId.trim()) throw new Error("projectId 必须是 string");
    const path = await this.projectPath(projectId);
    if (this.profileMode === "isolated") {
      const home = await this.ensureIsolatedProjectHome(path);
      if (!home) throw new Error("isolated project home is unavailable");
      return home.agentDir;
    }
    return this.agentDir;
  }
  private async loadPaddleOcrStatus(projectId: unknown): Promise<{ hasKey: boolean }> {
    const agentDir = await this.paddleOcrAgentDir(projectId);
    return { hasKey: await paddleocrHasKey(agentDir) };
  }
  private async savePaddleOcrAccessToken(projectId: unknown, token: unknown): Promise<{ hasKey: boolean }> {
    if (token !== null && typeof token !== "string") throw new Error("token 必须是 string 或 null");
    const agentDir = await this.paddleOcrAgentDir(projectId);
    const hasKey = await writePaddleocrAccessToken(agentDir, token);
    return { hasKey };
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
  private awaitCanonicalModelsIdle(): Promise<void> {
    return this.modelsWrite.enqueue(async () => undefined);
  }
  /** Renderer/API catalog reads wait for isolated init and the current write-queue tail. */
  private async loadModelCatalog(includeCurrent = true): Promise<void> {
    if (this.profileMode === "isolated") {
      await this.loadProjectPaths();
      await this.awaitCanonicalModelsIdle();
      this.invalidateModelCatalog();
    }
    await this.loadModelCatalogUnsafe(includeCurrent);
  }
  /** Queue-job catalog reread. Must not await the write queue it is already running on. */
  private async loadModelCatalogUnsafe(includeCurrent = true): Promise<void> {
    await this.loadConfiguredModels();
    await this.mergeRuntimeModels(includeCurrent);
    this.applyManualModelSelection(await this.loadManualModelSelection());
    this.applyManualThinkingLevel(await this.loadManualThinkingLevel());
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
    this.scheduleCompatContextBackfill();
  }
  private invalidateModelCatalog(): void {
    this.modelsLoaded = undefined;
    this.runtimeModelsPromise = undefined;
    this.modelCatalogReady = false;
  }
  /** Rebuild after pi login/logout while preserving still-configured literal/env-key models. */
  private async refreshModelsAfterAuthChange(
    includeCurrent = true,
  ): Promise<Model[]> {
    this.invalidateModelCatalog();
    await this.loadModelCatalog(includeCurrent);
    return this.models;
  }
  private async refreshModelsAfterAuthChangeUnsafe(
    includeCurrent = true,
  ): Promise<Model[]> {
    this.invalidateModelCatalog();
    await this.loadModelCatalogUnsafe(includeCurrent);
    return this.models;
  }
  /**
   * Invalidate the cached configured/runtime model catalog and reload it from disk.
   *
   * The host runs profile migration and bundled model-capability override installs in
   * the background so the window can paint before they finish. The backend's
   * constructor preload may therefore read models.json before those overrides land;
   * this method clears the affected caches and re-reads them so the renderer's next
   * listModels returns the complete, capability-aware catalog. Safe to call before or
   * while the constructor's preload is still in flight (it only replaces the result).
   */
  async refreshModelCatalog(): Promise<Model[]> {
    this.invalidateModelCatalog();
    await this.loadModelCatalog(true);
    return this.models;
  }
  private async refreshModelCatalogUnsafe(): Promise<Model[]> {
    this.invalidateModelCatalog();
    await this.loadModelCatalogUnsafe(true);
    return this.models;
  }
  private slugifyProviderId(name: string): string {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    return slug || "custom-openai";
  }

  private reservedOfficialProviderIds(): Set<string> {
    return new Set([
      "openai",
      "anthropic",
      "google",
      "google-gemini-cli",
      "github-copilot",
      "amazon-bedrock",
      "azure-openai-responses",
      "openai-codex",
      "xai",
      "groq",
      "mistral",
      "openrouter",
      "deepseek",
      "minimax",
      "huggingface",
      "opencode",
      "opencode-go",
      "vercel-ai-gateway",
      "zai",
    ]);
  }

  /** Write openai-completions provider into models.json (literal apiKey + baseUrl + models). */
  private async addOpenAICompatibleProvider(raw: unknown): Promise<{ providerId: string }> {
    if (!raw || typeof raw !== "object") throw new Error("参数无效");
    const input = raw as Record<string, unknown>;
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim() : "";
    const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    const modelId = typeof input.modelId === "string" ? input.modelId.trim() : "";
    const explicitContextWindow = parsePositiveInt(input.contextWindow);
    if (!name) throw new Error("名称不能为空");
    if (!baseUrl) throw new Error("URL 不能为空");
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error("URL 必须是 http(s) 地址");
    if (!apiKey) throw new Error("Key 不能为空");
    if (!modelId) throw new Error("模型 id 不能为空");

    let providerId = this.slugifyProviderId(name);
    if (this.reservedOfficialProviderIds().has(providerId)) {
      providerId = `custom-${providerId}`;
    }

    let contextWindow = explicitContextWindow;
    if (contextWindow === undefined) {
      contextWindow = await probeCompatContextWindow(baseUrl, apiKey, modelId);
    }
    return this.modelsWrite.enqueue(async () => {
      const modelsPath = join(this.agentDir, "models.json");
      let catalog: any = { providers: {} };
      try {
        catalog = JSON.parse(await fs.readFile(modelsPath, "utf8"));
      } catch (error: any) {
        if (error?.code !== "ENOENT") throw new Error(`无法读取 models.json：${error instanceof Error ? error.message : String(error)}`);
      }
      if (!catalog || typeof catalog !== "object") catalog = { providers: {} };
      const providers = catalog.providers && typeof catalog.providers === "object" ? catalog.providers : {};
      let uniqueId = providerId;
      let n = 2;
      while (providers[uniqueId] && providers[uniqueId]?.baseUrl !== baseUrl) {
        uniqueId = `${providerId}-${n++}`;
      }
      const existing = providers[uniqueId] && typeof providers[uniqueId] === "object" ? providers[uniqueId] : {};
      const models = Array.isArray(existing.models) ? [...existing.models] : [];
      const existingIndex = models.findIndex((m: any) => m && m.id === modelId);
      if (existingIndex < 0) {
        models.push({
          id: modelId,
          name: modelId,
          reasoning: true,
          ...(contextWindow !== undefined ? { contextWindow } : {}),
        });
      } else if (contextWindow !== undefined && parsePositiveInt(models[existingIndex]?.contextWindow) === undefined) {
        models[existingIndex] = { ...models[existingIndex], contextWindow };
      }
      providers[uniqueId] = {
        ...existing,
        baseUrl,
        api: "openai-completions",
        apiKey,
        models,
      };
      catalog.providers = providers;
      await writeCanonicalModelsFile(modelsPath, `${JSON.stringify(catalog, null, 2)}\n`);
      await this.refreshModelsAfterAuthChangeUnsafe(false);
      return { providerId: uniqueId };
    });
  }

  private scheduleCompatContextBackfill(): void {
    if (this.compatContextBackfill) return;
    const ready = this.profileMode === "isolated"
      ? (this.projectModelsInitialized ?? Promise.resolve()).catch(() => undefined)
      : Promise.resolve();
    this.compatContextBackfill = ready
      .then(() => this.modelsWrite.enqueue(() => this.backfillCompatContextWindows()))
      .catch((error) => {
        console.warn("compat provider context backfill failed", error);
      });
  }

  private resolveLiteralApiKey(raw: unknown): string | undefined {
    if (typeof raw !== "string") return undefined;
    const key = raw.trim();
    if (!key) return undefined;
    if (key.startsWith("$")) {
      const envVal = this.env[key.slice(1)];
      return typeof envVal === "string" && envVal.trim() ? envVal.trim() : undefined;
    }
    return key;
  }

  private async modelsJsonWritable(modelsPath: string): Promise<boolean> {
    try {
      await fs.access(modelsPath, fsConstants.W_OK);
      return true;
    } catch (error: any) {
      if (error?.code === "ENOENT") return true;
      if (!this.modelsJsonUnwritableWarned) {
        this.modelsJsonUnwritableWarned = true;
        console.warn("compat provider context backfill skipped: models.json is not writable");
      }
      return false;
    }
  }

  private async backfillCompatContextWindows(): Promise<void> {
    const modelsPath = join(this.agentDir, "models.json");
    if (!(await this.modelsJsonWritable(modelsPath))) return;
    let catalog: any;
    try {
      catalog = JSON.parse(await fs.readFile(modelsPath, "utf8"));
    } catch {
      return;
    }
    if (!catalog || typeof catalog !== "object") return;
    const providers = catalog.providers && typeof catalog.providers === "object" ? catalog.providers : null;
    if (!providers) return;

    type Need = { providerId: string; baseUrl: string; apiKey: string; models: any[] };
    const needs: Need[] = [];
    for (const [providerId, raw] of Object.entries(providers)) {
      if (!raw || typeof raw !== "object") continue;
      const entry = raw as Record<string, unknown>;
      if (entry.api !== "openai-completions") continue;
      const baseUrl = typeof entry.baseUrl === "string" ? entry.baseUrl.trim() : "";
      if (!/^https?:\/\//i.test(baseUrl)) continue;
      const apiKey = this.resolveLiteralApiKey(entry.apiKey);
      if (!apiKey) continue;
      const models = Array.isArray(entry.models) ? entry.models : [];
      if (!models.some((m: any) => m && typeof m.id === "string" && parsePositiveInt(m.contextWindow) === undefined)) continue;
      needs.push({ providerId, baseUrl, apiKey, models });
    }
    if (needs.length === 0) return;

    const byBase = new Map<string, Need[]>();
    for (const need of needs) {
      const key = need.baseUrl.replace(/\/+$/, "");
      const list = byBase.get(key) ?? [];
      list.push(need);
      byBase.set(key, list);
    }

    let wrote = false;
    for (const [normalized, group] of byBase) {
      if (this.probedCompatBaseUrls.has(normalized)) continue;
      this.probedCompatBaseUrls.add(normalized);
      const { baseUrl, apiKey } = group[0];
      const list = await fetchCompatModelsCatalog(baseUrl, apiKey);
      if (list.length === 0) continue;
      for (const need of group) {
        const nextModels = need.models.map((model: any) => {
          if (!model || typeof model !== "object" || typeof model.id !== "string") return model;
          if (parsePositiveInt(model.contextWindow) !== undefined) return model;
          const window = contextWindowFromCompatList(list, model.id);
          if (window === undefined) return model;
          wrote = true;
          return { ...model, contextWindow: window };
        });
        providers[need.providerId] = { ...(providers[need.providerId] as object), models: nextModels };
      }
    }
    if (!wrote) {
      await tightenCanonicalFileMode(modelsPath);
      return;
    }
    try {
      await writeCanonicalModelsFile(modelsPath, `${JSON.stringify(catalog, null, 2)}\n`);
    } catch (error) {
      if (!this.modelsJsonUnwritableWarned) {
        this.modelsJsonUnwritableWarned = true;
        console.warn("compat provider context backfill skipped: models.json is not writable");
      }
      return;
    }
    await this.refreshModelCatalogUnsafe();
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
    described = false,
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
    if (!described) {
      lines.push(
        "(Images are also embedded multimodally; prefer viewing them directly. If you use the read tool, use the paths above — do not invent paths like /home/workdir/attachments/.)",
      );
    }
    return lines.join("\n");
  }
  /**
   * Whether this send should describe attachments through the selected vision
   * model instead of embedding them: only when vision routing is enabled, a
   * vision model is selected, and the session's current main model cannot
   * accept images.
   */
  private async visionDescribePlan(live: Live): Promise<{ active: boolean; visionRef: string | null }> {
    if (!(await this.loadVisionEnabled())) return { active: false, visionRef: null };
    const visionRef = await this.loadVisionModel();
    if (!visionRef) return { active: false, visionRef: null };
    const model = this.sessionModelStates.get(live.session.id)?.model
      ?? this.sessionModelSnapshots.get(live.session.id)?.model
      ?? this.modelState.model;
    if (supportsImagesFor(model.id, model.provider)) return { active: false, visionRef };
    return { active: true, visionRef };
  }
  /**
   * Describe the given attachments via the selected vision model in an isolated
   * no-session/no-tools Pi process. Best-effort: failures resolve `undefined`
   * and never block the user's send.
   */
  private async describeAttachedImages(
    live: Live,
    visionRef: string,
    attachments: PromptAttachment[],
    userText?: string,
  ): Promise<string | undefined> {
    if (this.profileMode === "isolated") await this.ensureIsolatedProjectHome(live.cwd);
    const isolated = assemblePiSpawn({
      cwd: live.cwd,
      ...this.isolatedProjectPaths(live.cwd),
      resourceMode: "explicit",
      features: {},
      paths: {},
    });
    const slash = visionRef.indexOf("/");
    return describeImages({
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
      model: {
        provider: visionRef.slice(0, slash),
        id: visionRef.slice(slash + 1),
      },
      images: attachments.map((a) => ({
        dataBase64: a.dataBase64,
        mimeType: a.mimeType,
      })),
      userText,
      signal: this.titleGenerationAbort.signal,
    });
  }
  /**
   * 描述附图。GLM 会话（feature glmVisionMcp 开启）优先走智谱官方视觉 MCP；MCP 失败、无 key、
   * 或非 GLM 一律回退到既有 visionDescribePlan 的隔离 Pi 进程路径，优雅降级不打断用户发送。
   */
  private async describeAttachments(
    live: Live,
    visionRef: string,
    attachments: PromptAttachment[],
    userText?: string,
  ): Promise<string | undefined> {
    const model = this.sessionModelStates.get(live.session.id)?.model
      ?? this.sessionModelSnapshots.get(live.session.id)?.model
      ?? this.modelState.model;
    if (this.features.glmVisionMcp && isGlmProvider(model.provider)) {
      const viaMcp = await describeImagesViaGlmMcp({
        provider: model.provider,
        agentDir: this.agentDir,
        env: this.env,
        images: attachments.map((a) => ({ dataBase64: a.dataBase64, mimeType: a.mimeType })),
        userText,
        signal: this.titleGenerationAbort.signal,
      }).catch(() => undefined);
      if (viaMcp) return viaMcp;
    }
    return this.describeAttachedImages(live, visionRef, attachments, userText)
      .catch(() => undefined);
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
    const plan = attachments.length && behavior !== "follow_up"
      ? await this.visionDescribePlan(live)
      : { active: false, visionRef: null };
    const promptText = prependDocumentInjection(payload.text, this.documentInjections.takePending(id));
    const message = attachments.length
      ? await this.prepareImageMessage(live, promptText, attachments, plan.active)
      : promptText;
    const body: Rpc = {
      type:
        behavior === "steer"
          ? "steer"
          : behavior === "follow_up"
            ? "follow_up"
            : "prompt",
      message,
    };
    let described = false;
    if (plan.active && plan.visionRef) {
      const description = await this.describeAttachments(live, plan.visionRef, attachments, payload.text);
      if (description) {
        described = true;
        body.message = `${body.message}\n\n${description}`;
      }
    }
    if (attachments.length && behavior !== "follow_up" && !described)
      body.images = attachments.map((a) => ({
        type: "image",
        data: a.dataBase64,
        mimeType: a.mimeType,
      }));
    if (payload.text.trim() && behavior !== "steer") {
      live.pendingDrainPrompt = payload.text;
    }
    try {
      await this.command(id, body);
    } catch (error) {
      if (body.type !== "prompt" || !isAlreadyProcessingError(error)) {
        if (live.pendingDrainPrompt === payload.text) live.pendingDrainPrompt = undefined;
        throw error;
      }
      // Queue thought the session was idle (stale settle, follow-up already
      // running). Pi is the authority: re-send with the behavior it asked for
      // instead of surfacing the raw RPC error to the composer.
      await this.command(id, { ...body, streamingBehavior: "followUp" });
    }
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
    if (this.profileMode === "isolated") await this.ensureIsolatedProjectHome(live.cwd);
    const isolated = assemblePiSpawn({
      cwd: live.cwd,
      ...this.isolatedProjectPaths(live.cwd),
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
      turnEpoch: live.turnEpoch,
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
  private composeSessionModelState(sessionId: string, provider: string, modelId: string): ModelState {
    const known = this.models.find((item) => item.provider === provider && item.id === modelId);
    const model: Model = known ?? { provider, id: modelId, name: modelId, reasoning: true };
    const current =
      this.sessionModelStates.get(sessionId) ??
      this.sessionModelSnapshots.get(sessionId) ??
      this.modelState;
    const availableThinkingLevels = thinkingLevelsForModel(model);
    return {
      model,
      thinkingLevel: resolveThinkingLevel(current.thinkingLevel, availableThinkingLevels) ?? "off",
      availableThinkingLevels,
    };
  }
  /** Append a Pi-shaped JSONL row without opening SessionManager or spawning Pi. */
  private async persistColdSessionRow(
    sessionId: string,
    row:
      | { type: "model_change"; provider: string; modelId: string }
      | { type: "thinking_level_change"; thinkingLevel: ThinkingLevel },
  ): Promise<void> {
    const meta = await this.findSession(sessionId);
    const status = await this.leaseFor(meta).acquire();
    if (!status.writable)
      throw new Error(`session is read-only: held by ${status.holder?.holder ?? "another writer"}`);
    await this.sessionFileExclusive(sessionId)(async () => {
      const parentId = await lastJsonlEntryId(meta.path);
      await fs.appendFile(
        meta.path,
        `${JSON.stringify({
          ...row,
          id: crypto.randomUUID(),
          parentId,
          timestamp: new Date().toISOString(),
        })}\n`,
      );
      const stat = await fs.stat(meta.path);
      this.rememberSessionMeta(
        {
          ...meta,
          updatedAt: Date.now(),
          model: row.type === "model_change" ? { provider: row.provider, modelId: row.modelId } : meta.model,
          thinkingLevel: row.type === "thinking_level_change" ? row.thinkingLevel : meta.thinkingLevel,
        },
        stat.size,
        stat.mtimeMs,
      );
    });
  }
  private async setModel(sessionId: string, provider: string, modelId: string) {
    await this.loadModelCatalog();
    if (this.live.has(sessionId) || this.ensureInFlight.has(sessionId)) {
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
    const next = this.composeSessionModelState(sessionId, provider, modelId);
    await this.persistColdSessionRow(sessionId, { type: "model_change", provider, modelId });
    this.sessionModelStates.set(sessionId, next);
    this.sessionModelSnapshots.set(sessionId, next);
    await this.rememberManualModelSelection(next.model);
    return next;
  }
  private async setThinking(sessionId: string, level: ThinkingLevel) {
    await this.loadModelCatalog();
    const raw =
      this.sessionModelStates.get(sessionId) ??
      this.sessionModelSnapshots.get(sessionId);
    const reported = raw ??
      ((this.live.has(sessionId) || this.ensureInFlight.has(sessionId))
        ? this.modelState
        : await this.getModelState(sessionId));
    const known = this.models.find(
      (item) => item.provider === reported.model.provider && item.id === reported.model.id,
    );
    const model: Model = known ?? {
      provider: reported.model.provider,
      id: reported.model.id,
      name: reported.model.name || reported.model.id,
      reasoning: true,
      ...(reported.model.thinkingLevelMap
        ? { thinkingLevelMap: reported.model.thinkingLevelMap }
        : {}),
    };
    const availableThinkingLevels = thinkingLevelsForModel(
      model,
      reported.availableThinkingLevels.length > 0 ? reported.availableThinkingLevels : undefined,
    );
    if (!availableThinkingLevels.includes(level))
      throw new Error(`thinking level ${level} is unavailable`);
    if (this.live.has(sessionId) || this.ensureInFlight.has(sessionId)) {
      const live = await this.ensure(sessionId);
      await this.command(sessionId, { type: "set_thinking_level", level });
      await this.refreshState(live);
      const refreshed = this.sessionModelStates.get(sessionId)!;
      const catalog = this.models.find(
        (item) => item.provider === refreshed.model.provider && item.id === refreshed.model.id,
      );
      const state = {
        model: catalog ?? refreshed.model,
        thinkingLevel: level,
        availableThinkingLevels: thinkingLevelsForModel(
          catalog ?? model,
          refreshed.availableThinkingLevels.length > 0
            ? refreshed.availableThinkingLevels
            : availableThinkingLevels,
        ),
      };
      this.sessionModelStates.set(sessionId, state);
      this.sessionModelSnapshots.set(sessionId, state);
      await this.rememberManualThinkingLevel(state.thinkingLevel);
      return state;
    }
    const next = { model, thinkingLevel: level, availableThinkingLevels };
    await this.persistColdSessionRow(sessionId, { type: "thinking_level_change", thinkingLevel: level });
    this.sessionModelStates.set(sessionId, next);
    this.sessionModelSnapshots.set(sessionId, next);
    await this.rememberManualThinkingLevel(next.thinkingLevel);
    return next;
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
  private orphanReconcileTimer?: ReturnType<typeof setInterval>;
  private agentsFile(): string {
    return join(this.agentDir, "pipiui-agent-index.json");
  }
  private agentLogsFile(): string {
    return join(this.agentDir, "pipiui-agent-logs.json");
  }
  private agentKey(agentId: string, sessionId: string | undefined, runId: string): string {
    return `${sessionId ?? ""}\u0000${agentId}\u0000${runId}`;
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
        const key = this.agentKey(agent.agentId, agent.sessionId, agent.runId);
        this.agents.set(key, agent);
        this.projectionDebugProvenance.set(key, "durable_load");
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
    this.agentsPersistDirty = true;
    this.enqueuePersistAgents();
  }
  private enqueuePersistAgents(): void {
    if (this.agentsPersistInflight || !this.agentsPersistDirty) return;
    this.agentsPersistInflight = true;
    this.agentsWrite = this.agentsWrite.then(async () => {
      try {
        while (this.agentsPersistDirty) {
          this.agentsPersistDirty = false;
          const target = this.agentsFile();
          const snapshot = JSON.stringify({ version: 1, agents: [...this.agents.values()], worktrees: [...this.worktrees.values()] }, null, 2) + "\n";
          await fs.mkdir(dirname(target), { recursive: true });
          const tmp = `${target}.tmp-${process.pid}`;
          await fs.writeFile(tmp, snapshot, { encoding: "utf8", mode: 0o600 });
          await fs.rename(tmp, target);
        }
      } finally {
        this.agentsPersistInflight = false;
        if (this.agentsPersistDirty) this.enqueuePersistAgents();
      }
    }).catch(error => {
      this.agentsPersistInflight = false;
      console.warn(`[pipi-agents] unable to persist durable index: ${error?.message ?? error}`);
    });
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
    if (!live || !this.liveProcessUsable(live)) return undefined;
    return live;
  }
  private lastObservedAt(agent: AgentSummary): number | undefined {
    return agent.updatedAt ?? agent.createdAt;
  }
  private isLiveAgentState(state: AgentSummary["state"]): boolean {
    return state === "running" || state === "stalled";
  }
  private currentAgentSummaries(rows: AgentSummary[]): AgentSummary[] {
    const current = new Map<string, AgentSummary>();
    for (const agent of rows) {
      const key = `${agent.sessionId ?? ""}\u0000${agent.agentId}`;
      const previous = current.get(key);
      if (!previous || Number(this.isLiveAgentState(agent.state)) > Number(this.isLiveAgentState(previous.state)) ||
        (this.isLiveAgentState(agent.state) === this.isLiveAgentState(previous.state) && (agent.createdAt ?? 0) > (previous.createdAt ?? 0))) {
        current.set(key, agent);
      }
    }
    return [...current.values()];
  }
  private stopOrphanReconcileTimer(): void {
    if (!this.orphanReconcileTimer) return;
    clearInterval(this.orphanReconcileTimer);
    this.orphanReconcileTimer = undefined;
  }
  private syncOrphanReconcileTimer(): void {
    const needsTick = [...this.agents.values()].some(
      (agent) =>
        this.isLiveAgentState(agent.state) &&
        Boolean(agent.sessionId) &&
        !this.liveSessionProcess(agent.sessionId!),
    );
    if (!needsTick || this.closed) {
      this.stopOrphanReconcileTimer();
      return;
    }
    if (this.orphanReconcileTimer) return;
    this.orphanReconcileTimer = setInterval(
      () => this.reconcileAllOrphaned(),
      ORPHAN_RECONCILE_INTERVAL_MS,
    );
    this.orphanReconcileTimer.unref?.();
  }
  private retainOrphanWorktree(agentId: string): void {
    const current = this.worktrees.get(agentId);
    if (!current?.path || current.lifecycle !== "active") return;
    const status: WorktreeStatus = {
      ...current,
      lifecycle: "pendingReview",
      merge: "ready",
      discard: "ready",
    };
    this.worktrees.set(agentId, status);
    this.agent({ type: "worktree", status });
  }
  /**
   * App-runtime orphan sweep (Swift `SubagentStore.reconcileOrphanedNow`):
   * only when the session process is dead, and only for running/stalled rows
   * whose last observation is older than the 10-minute watchdog window.
   */
  private reconcileOrphanedNow(sessionId: string, now = Date.now()): boolean {
    if (this.liveSessionProcess(sessionId)) {
      this.syncOrphanReconcileTimer();
      return false;
    }
    let changed = false;
    for (const agent of [...this.agents.values()]) {
      if (agent.sessionId !== sessionId || !this.isLiveAgentState(agent.state)) continue;
      const observed = this.lastObservedAt(agent);
      if (observed === undefined || now - observed < ORPHAN_STALE_MS) continue;
      const next: AgentSummary = {
        ...agent,
        state: "interrupted",
        stalled: false,
        stalledIdleSec: undefined,
        listSubtitle: "",
        endedAt: agent.endedAt ?? now,
        closeout: agent.closeout ?? ORPHAN_CLOSEOUT,
      };
      this.agents.set(this.agentKey(agent.agentId, agent.sessionId, agent.runId), next);
      this.agent({ type: "agent", agent: next });
      this.retainOrphanWorktree(agent.agentId);
      changed = true;
    }
    if (changed) this.persistAgents();
    this.syncOrphanReconcileTimer();
    return changed;
  }
  private reconcileAllOrphaned(now = Date.now()): void {
    const sessionIds = new Set(
      [...this.agents.values()]
        .map((agent) => agent.sessionId)
        .filter((id): id is string => Boolean(id)),
    );
    for (const sessionId of sessionIds) this.reconcileOrphanedNow(sessionId, now);
  }
  private forceAbortAgent(agent: AgentSummary, reason: string): void {
    const key = this.agentKey(agent.agentId, agent.sessionId, agent.runId);
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
  /**
   * Stop-sweep the session's background subagents. Reuses the /subagent_abort_all
   * extension command so the kill paths, receipt suppression, and the host-stop
   * quiet gate stay owned by the runtime extension. Force-aborts any panel entry
   * still running afterwards so the UI never wedges on 运行中.
   */
  private async sweepSessionAgents(sessionId: string): Promise<void> {
    if (this.closed) return;
    const running = [...this.agents.values()].filter(
      (agent) => agent.sessionId === sessionId && agent.state === "running",
    );
    const target = this.live.get(sessionId);
    if (!target || !this.liveProcessUsable(target)) {
      for (const agent of running) {
        this.forceAbortAgent(agent, "宿主停止时无主 Agent 进程，已在界面结束该子任务");
      }
      return;
    }
    try {
      if (!this.liveProcessUsable(target)) {
        throw new Error("宿主停止时目标进程已退出");
      }
      await this.withAgentCommandTimeout(
        this.writeCommand(target, { type: "prompt", message: "/subagent_abort_all", streamingBehavior: "followUp" }),
        5_000,
        "停止扫场请求在 5 秒内未被主 Agent 接收",
      );
      await Promise.allSettled(
        running.map((agent) => this.waitForAgentTerminal(agent.agentId, agent.sessionId ?? "", agent.runId, 5_000)),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "停止扫场请求未能送达";
      for (const agent of running) this.forceAbortAgent(agent, reason);
      return;
    }
    for (const agent of running) {
      const current = this.agents.get(this.agentKey(agent.agentId, agent.sessionId, agent.runId));
      if (current && current.runId === agent.runId && current.state === "running") {
        this.forceAbortAgent(agent, "停止扫场后未收到终态，已在界面结束该子任务");
      }
    }
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
						this.command(a.sessionId, { type: "prompt", message: `/subagent_abort ${id}`, streamingBehavior: "followUp" }),
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
   * True only when a session would actually mount the plan tools: the feature is
   * enabled *and* the runtime file resolves in the installed tree. Resolved once
   * per backend — a host missing the extension must not advertise a Plan surface
   * that can never receive an event.
   */
  private planRuntimeAvailable(): boolean {
    if (!this.features.plan) return false;
    if (this.planRuntimeMounted === undefined)
      this.planRuntimeMounted = Boolean(resolveSpawnPaths(this.refreshRuntimeTree()).planRuntime);
    return this.planRuntimeMounted;
  }
  /**
   * One `plan_event` from the bundled plan runtime. The extension already wrote
   * `.pi/plans/current.json`; this mirrors the snapshot for the Plan panel and
   * republishes it on the `plan` channel. An unrecognizable payload is dropped
   * rather than thrown — the worker's reporting call must still succeed.
   */
  private planEvent(event: Record<string, unknown>, sessionId: string) {
    const published = this.planStore.accept(event, sessionId);
    if (!published) return;
    // The live event supersedes whatever the file said; no cold read can undo it.
    this.planStore.markHydrated(sessionId);
    emitFrame(this.listeners, {
      protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
      channel: "plan",
      event: published,
    });
  }
  /**
   * Plans for one session: the live mirror, backfilled once from the project's
   * plan file so a resumed session shows the plan it was already executing.
   */
  private async getPlans(sessionId?: string): Promise<PlanSnapshot[]> {
    const id = sessionId ?? [...this.live.keys()].at(-1);
    if (!id) return [];
    if (this.planStore.needsHydration(id)) {
      const cwd = await this.planCwd(id);
      if (cwd) this.planStore.merge(id, await readPlanStore(cwd, id));
      this.planStore.markHydrated(id);
    }
    return this.planStore.list(id);
  }
  /** Work tree a session's plan file lives in: the running cwd, else the JSONL header. */
  private async planCwd(sessionId: string): Promise<string | null> {
    const live = this.live.get(sessionId);
    if (live) return live.cwd;
    try {
      return (await this.findSession(sessionId)).header.cwd;
    } catch {
      return null;
    }
  }
	private waitForAgentTerminal(agentId: string, sessionId: string, runId: string, timeoutMs = 15_000): Promise<void> {
		const key = this.agentKey(agentId, sessionId, runId);
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
    const key = this.agentKey(raw.agentId, sessionId, raw.runId);
    const current = this.agents.get(key);
    const eventKind = ["start", "end", "update", "usage", "log", "log_delta", "closeout"].includes(raw.kind)
      ? String(raw.kind)
      : "unknown";
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
      this.projectionDebugProvenance.set(key, eventKind);
      this.projectionDebug("agent_event", {
        session: this.projectionDebugSessionTag(sessionId),
        kind: eventKind,
        key: this.projectionDebugAgentTag(key),
        before: current.state,
        after: agent.state,
      });
      this.projectionDebug("agent_broadcast", {
        source: "event",
        key: this.projectionDebugAgentTag(key),
        state: agent.state,
        provenance: eventKind,
        listeners: this.listeners.size,
      });
      this.agent({ type: "agent", agent });
      this.persistAgents();
      return;
    }
    if (raw.kind !== "start" && !current) {
      this.projectionDebug("agent_event", {
        session: this.projectionDebugSessionTag(sessionId),
        kind: eventKind,
        key: this.projectionDebugAgentTag(key),
        before: "missing",
        after: "ignored",
      });
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
			// A terminal event always drops the stored deadline: a dead worker must never keep
			// showing "最迟 NNN 秒后自动中止" from a budget that no longer exists.
			deadlineAt: num2(raw.deadlineAt) ?? (terminal ? undefined : (sameRun ? current?.deadlineAt : undefined)),
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
      worktreeError: nonEmpty(raw.worktreeError) ?? (sameRun ? current?.worktreeError : undefined),
      endedAt: terminal ? (sameRun ? current?.endedAt : undefined) ?? Date.now() : sameRun ? current?.endedAt : undefined,
      // Usage payloads are already session-cumulative (completed + live
      // message_update, then message_end). Replace the latest totals; never add.
      inputTokens: num2(usage?.input) ?? (sameRun ? current?.inputTokens : undefined),
      outputTokens: num2(usage?.output) ?? (sameRun ? current?.outputTokens : undefined),
      cacheTokens: num2(usage?.cacheRead) ?? (sameRun ? current?.cacheTokens : undefined),
      contextTokens: num2(usage?.contextTokens) ?? (sameRun ? current?.contextTokens : undefined),
      contextWindowTokens: positiveWindow(usage?.contextWindow) ?? positiveWindow(raw.contextWindow) ?? (sameRun ? current?.contextWindowTokens : undefined) ?? (sessionId ? this.sessionContextLastKnown.get(sessionId)?.contextWindow : undefined),
    };
    this.agents.set(key, agent);
    this.projectionDebugProvenance.set(key, eventKind);
    this.projectionDebug("agent_event", {
      session: this.projectionDebugSessionTag(sessionId),
      kind: eventKind,
      key: this.projectionDebugAgentTag(key),
      before: current?.state ?? "missing",
      after: agent.state,
    });
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
      const charCount = num2(raw.charCount);
      const entry = { itemType: raw.itemType, text: raw.text ?? "", name: raw.name, isError: raw.isError, ...(contentIndex === undefined ? {} : { contentIndex }), ...(charCount === undefined ? {} : { charCount }) };
      this.cacheAgentLog(logSessionId, agent.agentId, agent.runId, entry);
      this.agent({ type: "agent_log", sessionId: logSessionId, agentId: agent.agentId, runId: agent.runId, ...entry });
    } else if (raw.kind === "log" && logSessionId) {
      this.resetAgentLogStreamSlots(logSessionId, agent.agentId, agent.runId);
      this.agent({ type: "agent_log", sessionId: logSessionId, agentId: agent.agentId, runId: agent.runId, itemType: "text", text: "", resetStreamSlots: true });
      for (const item of raw.items ?? []) {
        const charCount = num2(item.charCount);
        const entry = { itemType: item.itemType, text: item.text, name: item.name, isError: item.isError, ...(charCount === undefined ? {} : { charCount }) };
        this.cacheAgentLog(logSessionId, agent.agentId, agent.runId, entry);
        this.agent({ type: "agent_log", sessionId: logSessionId, agentId: agent.agentId, runId: agent.runId, ...entry });
      }
    }
    this.projectionDebug("agent_broadcast", {
      source: "event",
      key: this.projectionDebugAgentTag(key),
      state: agent.state,
      provenance: eventKind,
      listeners: this.listeners.size,
    });
    this.agent({ type: "agent", agent });
    // Streaming log_delta is preview-only. Persisting the whole index on every
    // 50ms flush queued one JSON snapshot per event and froze the Electron main
    // process (100% CPU, multi-GB heap) once a few workers were live.
    if (raw.kind !== "log_delta") this.persistAgents();
    if (terminal && sessionId) {
      const live = this.live.get(sessionId);
      const pending = live?.pendingFinalReconciliation;
      if (live && pending && live.turnEpoch === pending.epoch && live.terminalEpoch !== pending.epoch) {
        this.projectionDebug("terminal_retry", {
          session: this.projectionDebugSessionTag(sessionId),
          epoch: pending.epoch,
          key: this.projectionDebugAgentTag(key),
          state: agent.state,
          ...this.projectionDebugActive(sessionId),
        });
        void this.reconcileFinalAssistantTurn(live, pending.epoch, pending.identity);
      }
    }
  }
  /** Lease surface deliberately remains absent: no lease is acquired/released in this backend. */
}
export function createPiHostBackend(options: PiBackendOptions = {}) {
  return new PiHostBackend(options);
}
export {
  configureVaultKeyProvider,
  createSealedDekProvider,
  memoryKeyProvider,
  ubuntuVaultInstallHint,
  vaultDiagnosisFor,
  VaultEncryptionError,
  type VaultDiagnosis,
  type VaultDiagKind,
  type VaultKeyProvider,
} from "./secret-vault.js";
