import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createReadStream, existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

import {
  PIPI_HOST_PROTOCOL_VERSION,
  type AgentEvent,
  type AgentSummary,
  type AuthLoginEvent,
  type AuthProviderInfo,
  type AuthType,
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
  type ThinkingLevel,
  type WorktreeStatus,
} from "@pipi/host-api";
import {
  assemblePiSpawn,
  defaultRuntimeRoot,
  resolvePiExecutable,
  resolveSpawnPaths,
  sanitizeEnvironment,
  withToolPath,
  type ComputerDescriptor,
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
import { QuotaStore } from "./quota.js";
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
  type ManagedPackage,
  resolvePiExecutable,
  resolveSpawnPaths,
  sanitizeEnvironment,
  withToolPath,
} from "./spawn-assembly.js";
export {
  HostBridge,
  type BridgeAgentEvent,
  type BridgeHandlers,
} from "./bridge.js";
export { DEFAULT_FEATURES } from "./features.js";
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
  codexWindowLabel,
  CODEX_USAGE_URL,
  fetchCodexQuota,
  parseCodexAuth,
  parseCodexUsageWindows,
  QUOTA_ACCOUNT_LABELS,
  quotaProviderFor,
  QuotaStore,
  QUOTA_STALE_AFTER_MS,
  type CodexCredentials,
  type QuotaFetchDeps,
  type QuotaProviderKind,
} from "./quota.js";

type Rpc = Record<string, any>;
type ProcFactory = (
  bin: string,
  args: string[],
  options: any,
) => ChildProcessWithoutNullStreams;
export type PiBackendOptions = {
  piPath?: string;
  sessionsRoot?: string;
  /** App-specific installed extension tree. */ runtimeRoot?: string;
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
  ) => Promise<Record<string, unknown>>;
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
};
type Live = {
  session: Session;
  path: string;
  cwd: string;
  process?: ChildProcessWithoutNullStreams;
  exit?: Promise<void>;
  buffer: string;
  pending: Map<
    string,
    { resolve: (data: any) => void; reject: (e: Error) => void }
  >;
  followUps: string[];
  /** contentIndex → streamed tool-args JSON, assembled from toolcall_delta until toolcall_end. */
  toolArgs: Map<number, string>;
};
const text = (content: any) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((p) => p.text ?? p.thinking ?? "").join("")
      : "";
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
    const last = [...tailRows]
      .reverse()
      .find((row) => typeof row?.timestamp === "string");
    const timestamp = Date.parse(last?.timestamp ?? "");
    return {
      path,
      header,
      name: sessionName([...headRows, ...tailRows]),
      updatedAt: Number.isFinite(timestamp) ? timestamp : stat.mtimeMs,
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
  if (typeof content === "string") {
    textPart = content;
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      if (part.type === "text") textPart += part.text ?? "";
      else if (part.type === "thinking") thinking = (thinking ?? "") + (part.thinking ?? "");
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
  const result: HistoryEntry = {
    id: entry.id,
    role,
    content: textPart,
    timestamp: asTime(entry.timestamp ?? message.timestamp),
  };
  if (thinking) result.thinking = thinking;
  if (tools && tools.length) result.tools = tools;
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
  private computerDescriptor?: ComputerDescriptor;
  private computerUsable: () => boolean = () => false;
  private root: string;
  private pi: string;
  private runtimeRoot: string;
  private runtimeAssets?: RuntimeAssets;
  private agentDir: string;
  private features: SpawnFeatures;
  private proc: ProcFactory;
  private env: NodeJS.ProcessEnv;
  private modelsLoaded?: Promise<void>;
  private configuredModels: Model[] = [];
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
  private bridge: HostBridge;
  constructor(options: PiBackendOptions = {}) {
    this.computerDescriptor = options.computerDescriptor;
    this.computerUsable = options.computerUsable ?? (() => false);
    this.agentDir = options.agentDir ?? join(homedir(), ".pi", "agent");
    this.root = options.sessionsRoot ?? join(this.agentDir, "sessions");
    this.pi = options.piPath ?? resolvePiExecutable(options.env ?? process.env);
    this.runtimeRoot = options.runtimeRoot ?? defaultRuntimeRoot();
    this.runtimeAssets = options.runtimeAssets;
    this.features = options.features ?? DEFAULT_FEATURES;
    this.proc = options.spawn ?? (spawn as ProcFactory);
    this.env = options.env ?? process.env;
    const queueRoot =
      options.agentDir || !options.sessionsRoot
        ? join(this.agentDir, "pipiui-queues")
        : join(this.root, ".pipiui-queues");
    this.queueStore = options.queueStore ?? new FileQueueStore(queueRoot);
    this.quotaStore = options.quotaStore ?? new QuotaStore(this.env);
    this.queue = new SessionMessageQueue({
      dispatch: (id, payload, behavior) =>
        this.dispatchQueuedMessage(id, payload, behavior),
      onChange: (id, items) => this.queueChanged(id, items),
    });
    this.bridge = new HostBridge({
      onAgentEvent: (event, sessionId) => this.mapAgentEvent(event, sessionId),
      onPlanEvent: (event, sessionId) => this.planEvent(event, sessionId),
      onBrowserAction: async (event) =>
        options.browserAction
          ? options.browserAction(event)
          : { ok: false, error: "browser host unavailable" },
      onComputerAction: async (event) =>
        options.computerAction
          ? options.computerAction(event)
          : { ok: false, error: "computer host unavailable" },
    });
    if (options.authRuntime) {
      this.authRuntimePromise = Promise.resolve(options.authRuntime);
    } else if (options.authHelperPath) {
      this.authRuntimePromise = Promise.resolve(new ExternalAuthRuntime({
        helperPath: options.authHelperPath,
        nodePath: options.authNodePath,
        piPath: this.pi,
        agentDir: this.agentDir,
        env: this.env,
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
  private async index(): Promise<SessionMeta[]> {
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
    const result: SessionMeta[] = [];
    for (const path of files) {
      try {
        result.push(await readSessionMeta(path));
      } catch {
        /* incomplete/corrupt JSONL is not a session */
      }
    }
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
      };
    } catch (error) {
      console.warn(
        `[pipi-backend] SessionManager metadata fallback for ${meta.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return meta;
    }
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
        return this.command(params[0] as string, { type: "abort" }).then(
          () => undefined,
        );
      case "queueFollowUp":
        return this.prompt(params[0] as string, params[1] as string, true);
      case "getHiddenModelIds":
        return this.loadHiddenModelIds();
      case "setHiddenModelIds":
        return this.saveHiddenModelIds(params[0]);
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
        return this.getQuotaSnapshot();
      case "listAgents": {
        const sessionId = params[0] as string | undefined;
        return [...this.agents.values()].filter(
          (agent) => !sessionId || agent.sessionId === sessionId,
        );
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
    await this.loadConfiguredModels();
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
  private async ensure(id: string): Promise<Live> {
    let live = this.live.get(id);
    if (live) return live;
    await this.requireLease(id);
    const found = await this.locate(id);
    const session = this.toSession(found);
    await this.loadConfiguredModels();
    const desired = this.sessionModelSnapshots.get(id) ?? this.modelState;
    this.sessionModelSnapshots.set(id, desired);
    const bridgePort = await this.bridge.listen();
    const sessionCapability = this.bridge.register(id);
    const computerCapability =
      this.features.computerUse &&
      this.computerDescriptor &&
      this.computerUsable()
        ? this.bridge.registerComputer(id)
        : undefined;
    const output = assemblePiSpawn({
      sessionPath: found.path,
      cwd: found.header.cwd,
      runtimeRoot: this.runtimeRoot,
      features: this.features,
      paths: resolveSpawnPaths(this.refreshRuntimeTree()),
      mainModelId: this.mainModelId(),
      bridgePort,
      bridgeRoutingKey: id,
      sessionCapability,
      computerCapability,
      computerDescriptor: computerCapability
        ? this.computerDescriptor
        : undefined,
    });
    const child = this.proc(this.pi, ["--mode", "rpc", ...output.args], {
      cwd: found.header.cwd,
      env: withToolPath(
        { ...sanitizeEnvironment(this.env), ...output.env },
        this.pi,
      ),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let resolveExit!: () => void;
    const exit = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    live = {
      session,
      path: found.path,
      cwd: found.header.cwd,
      process: child,
      exit,
      buffer: "",
      pending: new Map(),
      followUps: [],
      toolArgs: new Map(),
    };
    this.live.set(id, live);
    child.stdout.on("data", (chunk) => this.lines(live!, chunk.toString()));
    const failPending = (reason: Error) => {
      for (const p of live!.pending.values()) p.reject(reason);
      live!.pending.clear();
    };
    child.on("error", (error) => failPending(error));
    child.on("exit", () => {
      failPending(new Error("pi exited"));
      this.live.delete(id);
      this.bridge.unregister(id);
      resolveExit();
      void this.leases.get(id)?.release();
      if (!this.closed) void this.queueIdle(id);
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
      void this.loadQueue(id).then(() => this.queue.markBusy(id));
      this.stream({ type: "status", sessionId: id, status: "started" });
    } else if (e.type === "agent_settled") {
      this.stream({
        type: "status",
        sessionId: id,
        status: "settled",
        pendingFollowUps: live.followUps,
      });
      void this.queueIdle(id);
      void this.pushSessionStats(id);
    } else if (e.type === "agent_stopped" || e.type === "agent_error") {
      this.stream({
        type: "status",
        sessionId: id,
        status: "stopped",
        pendingFollowUps: live.followUps,
      });
      void this.queueIdle(id);
    } else if (e.type === "queue_update") {
      live.followUps = e.followUp ?? [];
      this.stream({
        type: "status",
        sessionId: id,
        status: "streaming",
        pendingFollowUps: live.followUps,
      });
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
    } else if (e.type === "tool_execution_end")
      this.stream({
        type: "tool_result",
        sessionId: id,
        toolCallId: e.toolCallId,
        content: text(e.result?.content),
        isError: e.isError,
      });
  }
  private command(id: string, body: Rpc) {
    return this.ensure(id).then(
      (live) =>
        new Promise<any>((resolve, reject) => {
          const child = live.process;
          if (child && (child.exitCode !== null || child.signalCode)) {
            reject(new Error("pi exited"));
            return;
          }
          const req = crypto.randomUUID();
          live.pending.set(req, { resolve, reject });
          live.process!.stdin.write(
            JSON.stringify({ id: req, ...body }) + "\n",
          );
        }),
    );
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
  private checkedProjectPaths(value: unknown): string[] {
    if (
      !Array.isArray(value) ||
      !value.every((path) => typeof path === "string" && path.length > 0)
    )
      throw new Error("projectPaths 必须是 string[]（每项不能为空）");
    return [...new Set(value)];
  }
  /** Initializes an explicit empty sidebar once. Version presence makes [] durable. */
  private async loadProjectPaths(): Promise<string[]> {
    if (!this.projectPathsLoaded) {
      this.projectPathsLoaded = (async () => {
        const settings = await this.readSettings();
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
  /** Merge configured/custom models with pi's auth-aware runtime catalog in stable order. */
  private async mergeRuntimeModels(includeCurrent = true): Promise<void> {
    const merged = new Map<string, Model>(
      this.configuredModels.map((model) => [
        `${model.provider}/${model.id}`,
        model,
      ]),
    );
    try {
      const runtime = await this.modelRuntime();
      const available = await runtime.getAvailable();
      const additions = [...available]
        .map((model) => this.toRuntimeModel(model))
        .sort(
          (a, b) =>
            a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id),
        );
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
  }
  /** Rebuild after pi login/logout while preserving still-configured literal/env-key models. */
  private async refreshModelsAfterAuthChange(
    includeCurrent = true,
  ): Promise<Model[]> {
    this.modelsLoaded = undefined;
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
      status: "streaming",
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
    const live = await this.ensure(sessionId);
    await this.command(sessionId, { type: "set_model", provider, modelId });
    await this.refreshState(live);
    const state = this.sessionModelStates.get(sessionId)!;
    this.sessionModelSnapshots.set(sessionId, state);
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
   * Real pi `get_session_stats` RPC mapped onto the stable SessionStats shape.
   * `sessionId` is optional and defaults to the current active (most recently
   * started) live session; a cold session is spawned like any resume so stats
   * always come from pi, never from renderer-side JSONL scanning.
   */
  private async getSessionStats(sessionId?: string): Promise<SessionStats> {
    const id = sessionId ?? [...this.live.keys()].at(-1);
    if (!id) throw new Error("no active session; pass an explicit sessionId");
    const live = await this.ensure(id);
    return this.sessionStatsData(live.session.id);
  }
  /**
   * Account-quota snapshot for the provider backing the current model (Codex
   * plan today). Mirrors the Swift app's quota capsule below the input bar;
   * resolves null — never throws — when the provider has no quota source.
   */
  private async getQuotaSnapshot(): Promise<QuotaSnapshot | null> {
    await this.loadConfiguredModels();
    const provider = this.modelState.model.provider;
    return this.quotaStore.snapshot(provider);
  }
  private async sessionStatsData(id: string): Promise<SessionStats> {
    const data = await this.command(id, { type: "get_session_stats" });
    const tokens = isRecord(data?.tokens) ? data.tokens : {};
    const contextUsage: any = isRecord(data?.contextUsage)
      ? data.contextUsage
      : undefined;
    const model = (this.sessionModelStates.get(id) ?? this.modelState).model;
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
    return stats;
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
  private async getAgent(id: string) {
    const a = this.agents.get(id);
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
    if (operation === "abort") a.state = "aborted";
    else {
      a.handled = true;
      a.closeout = a.closeout ?? "Boss marked this episode handled";
    }
    this.agent({ type: "agent", agent: { ...a } });
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
  private mapAgentEvent(raw: any, sessionId?: string) {
    const current = this.agents.get(raw.agentId);
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
      this.agents.set(agent.agentId, agent);
      this.agent({ type: "agent", agent });
      return;
    }
    const state = raw.ok
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
    const agent: AgentSummary = {
      agentId: raw.agentId,
      runId: raw.runId,
      name: raw.name ?? current?.name ?? "subagent",
      task: raw.task ?? current?.task ?? "",
      state,
      stalled: raw.stalled,
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
        (raw.at ? asTime(raw.at) : (current?.createdAt ?? Date.now())),
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
        : current?.finalResult,
      endedAt: terminal ? (current?.endedAt ?? Date.now()) : current?.endedAt,
      inputTokens: num2(usage?.input) ?? current?.inputTokens,
      outputTokens: num2(usage?.output) ?? current?.outputTokens,
      cacheTokens: num2(usage?.cacheRead) ?? current?.cacheTokens,
      contextTokens: num2(usage?.contextTokens) ?? current?.contextTokens,
    };
    this.agents.set(agent.agentId, agent);
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
    if (raw.kind === "log_delta")
      this.agent({
        type: "agent_log",
        agentId: agent.agentId,
        itemType: raw.itemType,
        text: raw.text ?? "",
        name: raw.name,
        isError: raw.isError,
      });
    else if (raw.kind === "log")
      for (const item of raw.items ?? [])
        this.agent({
          type: "agent_log",
          agentId: agent.agentId,
          itemType: item.itemType,
          text: item.text,
          name: item.name,
          isError: item.isError,
        });
    this.agent({ type: "agent", agent });
  }
  /** Lease surface deliberately remains absent: no lease is acquired/released in this backend. */
}
export function createPiHostBackend(options: PiBackendOptions = {}) {
  return new PiHostBackend(options);
}
