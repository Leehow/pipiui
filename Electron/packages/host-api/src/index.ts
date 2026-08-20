/** Versioned, transport-neutral contract used by every Pipi UI. */
export * from "./plan.js";
export * from "./external-session.js";
import type { PlanEvent, PlanSnapshot } from "./plan.js";
import type { ExternalSession, ExternalSessionHistory, SessionAdoptedFrom } from "./external-session.js";
export const PIPI_HOST_PROTOCOL_VERSION = 2 as const;
/** Stable Electron IPC channel for the Pipi host protocol. */
export const PIPI_HOST_IPC_CHANNEL = "pipi-host:v1";

export type Unsubscribe = () => void;
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const STANDARD_THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];
export type ThinkingLevelMap = Partial<Record<ThinkingLevel, string | null>>;
export type Project = { id: string; name: string; path: string };
export type Session = {
  id: string;
  projectId: string;
  name: string;
  updatedAt: number;
  /** The session's model (provider/modelId), when known. Absent/null means unknown (sidebar falls back to a neutral logo). */
  model?: { provider: string; modelId: string } | null;
  /** Present when this Pi session was adopted from a read-only external record. */
  adoptedFrom?: SessionAdoptedFrom;
};
export type SessionLease = { sessionId: string; writable: boolean; holder?: { protocolVersion: number; holder: string; pid: number; hostname: string; acquiredAt: string; heartbeatAt: string; expiresAt: string } };
export type HistoryTool = { id: string; name: string; input: string };
export type HistoryActivity =
  | { type: "thinking"; contentIndex: number; content: string }
  | { type: "text"; contentIndex: number; content: string }
  | { type: "tool"; contentIndex: number; tool: HistoryTool };
/**
 * Transcript entry. `content` is the plain text of the message; assistant
 * entries additionally carry `thinking` and `tools` so resumed sessions render
 * the same folded tool/turn structure as the live stream (Swift ChatItem parity).
 * `tool` entries (toolResult) reference the tool call they belong to.
 */
export type HistoryEntry = {
  id: string;
  role: "user" | "assistant" | "tool" | "compaction";
  content: string;
  timestamp: number;
  /** assistant only: reasoning text, rendered inside the folded turn card. */
  thinking?: string;
  /** assistant only: tool calls with their raw args JSON. */
  tools?: HistoryTool[];
  /** assistant only: ordered non-text content blocks for exact resume parity. */
  activities?: HistoryActivity[];
  /** assistant only: terminal failure (`stopReason: "error"`) with no text content. */
  errorMessage?: string;
  /** tool (toolResult) only: the tool call this result belongs to. */
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  /** tool only: images extracted from the result (screenshots, generated images). */
  images?: TranscriptImage[];
};
/** Local files that a host makes available to the right-side document reader. */
export type DocumentKind = "markdown" | "plain" | "pdf" | "word" | "spreadsheet" | "presentation";
export const DOCUMENT_KIND_BY_EXTENSION = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "plain",
  ".pdf": "pdf",
  ".doc": "word",
  ".docx": "word",
  ".xls": "spreadsheet",
  ".xlsx": "spreadsheet",
  ".ppt": "presentation",
  ".pptx": "presentation",
} as const satisfies Record<string, DocumentKind>;
export type SupportedDocumentExtension = keyof typeof DOCUMENT_KIND_BY_EXTENSION;
export function documentKindForName(name: string): DocumentKind | null {
  const normalized = name.toLowerCase();
  const extension = Object.keys(DOCUMENT_KIND_BY_EXTENSION).find(candidate => normalized.endsWith(candidate));
  return extension ? DOCUMENT_KIND_BY_EXTENSION[extension as SupportedDocumentExtension] : null;
}
export function documentsDroppedAnnouncement(paths: readonly string[]): string {
  const listed = paths.filter(path => path.trim() && documentKindForName(path)).join("、");
  return `[文档面板] 用户拖拽打开了文档：${listed}。文件在磁盘上，可读取与编辑；面板会自动刷新。`;
}
export const DOCUMENT_INJECTION_EXCERPT_LIMIT = 24_000;
export type DocumentInjectionEntry = {
  path: string;
  kind?: DocumentKind | null;
  excerpt?: string;
  size?: number;
  binary?: boolean;
};
function formatDocumentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
/** Path + readable excerpt (or a binary read hint) so the model can see an opened document. */
export function documentsOpenedInjection(entries: readonly DocumentInjectionEntry[]): string {
  const blocks: string[] = [];
  for (const entry of entries) {
    const path = entry.path.trim();
    if (!path || !documentKindForName(path)) continue;
    const kind = entry.kind ?? documentKindForName(path);
    const excerpt = entry.excerpt?.trim();
    if (excerpt) {
      blocks.push(`[文档面板] 用户打开了文档：${path}\n--- 文档内容 ---\n${excerpt}`);
      continue;
    }
    const size = typeof entry.size === "number" ? `，约 ${formatDocumentSize(entry.size)}` : "";
    const hint = entry.binary
      ? kind === "pdf"
        ? `。文件已在右侧面板打开（${kind}${size}）；请用 pipiui_firecrawl_pdf 工具本地解析该绝对路径（不要用 read）。默认本地提取文字，不会上传；仅当页面需要 OCR 且已配置可选 OCR Key 时才会上传。打开预览本身不会解析。`
        : `。文件已在右侧面板打开（${kind}${size}）；请用 read 工具读取该路径以查看正文。`
      : `。文件在磁盘上，可读取与编辑；面板会自动刷新。`;
    blocks.push(`[文档面板] 用户打开了文档：${path}${hint}`);
  }
  return blocks.join("\n\n");
}
export type DocumentSummary = { id: string; name: string; path: string; kind: DocumentKind; size?: number; updatedAt?: number };
export type TextDocumentContent = DocumentSummary & { kind: "markdown" | "plain"; content: string; bytes?: never };
export type BinaryDocumentContent = DocumentSummary & { kind: "pdf" | "word" | "spreadsheet" | "presentation"; bytes: Uint8Array; content?: never };
export type DocumentContent = TextDocumentContent | BinaryDocumentContent;
export type DocumentErrorCode = "document_invalid_path" | "document_unsupported_type" | "document_not_found" | "document_not_file" | "document_too_large" | "document_read_failed" | "document_external_open_failed";
export type Model = {
  provider: string;
  id: string;
  name: string;
  /** Pi model metadata. Absent means the runtime did not report whether this is a reasoning model. */
  reasoning?: boolean;
  /** Pi's tri-state map: string = supported provider value, null = explicitly unsupported, absent key = provider default. */
  thinkingLevelMap?: ThinkingLevelMap;
  /** Semantic result of Pi API/compat metadata. Absent means configurability is unknown. */
  thinkingConfigurable?: boolean;
  /** Mirrors Swift ModelInfo.supportsImages (pi input array or heuristic). Absent = unknown (defaults to supported). */
  supportsImages?: boolean;
};
export type ModelState = { model: Model; thinkingLevel: ThinkingLevel; availableThinkingLevels: ThinkingLevel[] };

/** One capability source for backend fallbacks, the composer, and subagent overrides. */
export function thinkingLevelsForModel(model: Model, reported?: readonly ThinkingLevel[]): ThinkingLevel[] {
  if (model.reasoning === false || model.thinkingConfigurable === false) return [];
  const thinkingLevelMap = model.thinkingLevelMap;
  if (thinkingLevelMap) {
    // Sparse maps (openai-codex GPT) define only the effort strings chatgpt.com accepts.
    // Absent keys are not valid provider values — do not invent STANDARD levels for them.
    return THINKING_LEVELS.filter(level => {
      if (Object.prototype.hasOwnProperty.call(thinkingLevelMap, level))
        return typeof thinkingLevelMap[level] === "string";
      return level === "off";
    });
  }
  if (reported) {
    const supported = new Set(reported);
    return THINKING_LEVELS.filter(level => supported.has(level));
  }
  return [...STANDARD_THINKING_LEVELS];
}

/** Prefer current if allowed, else fallback if allowed, else the first allowed level. */
export function resolveThinkingLevel(
  current: ThinkingLevel | undefined,
  available: readonly ThinkingLevel[],
  fallback?: ThinkingLevel,
): ThinkingLevel | undefined {
  if (current && available.includes(current)) return current;
  if (fallback && available.includes(fallback)) return fallback;
  return available[0];
}
/** Ordered subagent fallback entry. New selections persist `model` as full `provider/modelId`; an empty chain means “follow main Agent”. */
export type SubagentModelSetting = { model: string; thinking?: string };
/** Cross-renderer semantic sidebar state. Device-only disclosure/layout stays local. */
export type SidebarSessionPreferences = {
  pinnedSessionIds: string[];
  archivedSessionIds: string[];
  /** Unix milliseconds when each session entered the archive. Missing legacy entries receive a fresh grace window in the UI. */
  archivedSessionTimestamps?: Record<string, number>;
  /** @deprecated Legacy manual drag order. Unused since sessionOrderVersion 3; keep for IPC compatibility and always persist as []. */
  orderedSessionIds: string[];
  /** Absent / 2 are pre-v3 prefs whose orderedSessionIds must be discarded. Current writers persist 3. */
  sessionOrderVersion?: 2 | 3;
};
/** Built-in subagent role metadata used by the settings UI. */
export type AgentDefinition = { name: string; description: string };
export type AgentState = "running" | "stalled" | "ok" | "failed" | "aborted" | "interrupted";
/** `cost` remains USD for compatibility; these optional fields select its display unit and USD→CNY rate. */
export type CostUnit = "USD" | "CNY";
/** Metadata is optional for v1 producers; v2 producers populate it on snapshots and updates. */
export type AgentSummary = { agentId: string; runId: string; name: string; task: string; state: AgentState; stalled?: boolean; stalledIdleSec?: number; handled?: boolean; cost?: number; costUnit?: CostUnit; exchangeRate?: number; turns?: number; outputCount?: number; sessionId?: string; parentId?: string | null; /** The main-chat tool_call this agent was dispatched from (subagent tool), if any. Lets the transcript card link a tool_call to its live worker. */ toolCallId?: string; depth?: number; role?: string; createdAt?: number; updatedAt?: number; deadlineAt?: number; endedAt?: number; title?: string; model?: string; provider?: string; listSubtitle?: string; closeout?: string; contextTokens?: number; contextWindowTokens?: number; inputTokens?: number; outputTokens?: number; cacheTokens?: number; finalResult?: string;
  /**
   * Writable isolation could not be created for this worker (e.g. the project
   * is not a git work tree). Verbatim technical reason; the UI maps it to an
   * actionable Chinese hint, so this stays detail, not prose.
   */
  worktreeError?: string };
export type WorktreeLifecycle = "none" | "active" | "pendingReview" | "merged" | "mergedCleanupPending" | "discarded";
export type WorktreeStatus = { agentId: string; branch?: string; path?: string; error?: string; lifecycle: WorktreeLifecycle; merge: "ready" | "merged" | "conflict" | "unavailable"; discard: "ready" | "discarded" | "unavailable" };
export type HostCapabilities = { computerUse: boolean; revealInFinder: boolean; terminal: boolean; plan: boolean; retainedWorktreeDisposition: boolean; [capability: string]: boolean };
export type ComputerUsePermissionKind = "screenRecording" | "accessibility";
export type ComputerUseState = { enabled: boolean; screenRecording?: boolean; accessibility?: boolean };
export type UpdateCenterItemStatus = "upToDate" | "updateAvailable" | "checkFailed" | "notCheckable";
export type UpdateCenterItemCategory = "platform" | "runtime" | "toolchain" | "extension";
export type UpdateCenterItem = {
  id: string;
  name: string;
  packageName?: string;
  /** Host-discovered ownership layer. Optional for older hosts and browser fixtures. */
  category?: UpdateCenterItemCategory;
  currentVersion: string;
  latestVersion?: string;
  status: UpdateCenterItemStatus;
  error?: string;
};
export type UpdateCenterSnapshot = { checkedAt: number; items: UpdateCenterItem[] };
/** Stable renderer-to-Pi seam. Policy expansion is owned by the bundled Pi extension. */
export const PIPIUI_UPDATE_EVALUATION_INTENT_VERSION = 1 as const;
export const PIPIUI_UPDATE_EVALUATION_INTENT_PREFIX = "[[PIPIUI_UPDATE_EVALUATION_INTENT]]";
export type PipiuiUpdateEvaluationIntent = {
  version: typeof PIPIUI_UPDATE_EVALUATION_INTENT_VERSION;
  id: string;
  name: string;
  packageName?: string;
  currentVersion: string;
  latestVersion: string;
};
export type PipiuiUpdateEvaluationIntentFields = Omit<PipiuiUpdateEvaluationIntent, "version">;
export function encodePipiuiUpdateEvaluationIntent(fields: PipiuiUpdateEvaluationIntentFields): string {
  return `${PIPIUI_UPDATE_EVALUATION_INTENT_PREFIX}${JSON.stringify({
    version: PIPIUI_UPDATE_EVALUATION_INTENT_VERSION,
    id: fields.id,
    name: fields.name,
    ...(fields.packageName === undefined ? {} : { packageName: fields.packageName }),
    currentVersion: fields.currentVersion,
    latestVersion: fields.latestVersion,
  })}`;
}

/**
 * Work-tree git state for the chat toolbar; mirrors Swift `GitRepoStatus`.
 * A non-repository project reports `isRepo: false` and empty counts — the probe
 * never guesses, so an unreadable work tree looks the same as a missing one.
 */
export type GitStatus = {
  isRepo: boolean;
  /** Absent while detached; read `shortSHA` then. */
  currentBranch?: string;
  isDetached: boolean;
  shortSHA?: string;
  localBranches: string[];
  /** e.g. `origin/main`; absent when the branch has no upstream. */
  upstream?: string;
  /** Commits on HEAD not in upstream. */
  ahead: number;
  /** Commits on upstream not in HEAD. */
  behind: number;
  isDirty: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  /** Only github.com remotes resolve; other hosts stay undefined. */
  githubURL?: string;
};

/** Cumulative per-session token accounting. All values are whole token counts. */
export type SessionTokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
/** Context-window occupancy from pi's `get_session_stats`. `tokens`/`percent` are null when unknown (e.g. right after compaction). `percent` is 0–100. */
export type SessionContextUsage = { tokens: number | null; contextWindow: number; percent: number | null };
/**
 * Reserved for future performance telemetry (TTFT, tokens/second, sample
 * counts). Hosts MUST NOT fabricate these: pi exposes no such measurements, so
 * the field stays absent until a real source exists.
 */
export type SessionPerformance = { ttftMs?: number; tokensPerSecond?: number; sampleCount?: number };
/** Image attachment carried by sendPrompt; mirrors Swift ImageAttachment.rpcPayload. */
export type PromptAttachment = {
  /** Base64-encoded image bytes (no `data:` prefix). */
  dataBase64: string;
  mimeType: string;
  /** Original file name when available. */
  name?: string;
  /** Preserve transport-safe attachment metadata added by future clients. */
  [extra: string]: unknown;
};
/** Host-owned product queue lifecycle (matches the MessageQueue UI states). */
export type QueuedMessageState = "queued" | "sending" | "failed";
/** Durable, actionable message payload. Completed messages leave the active queue. */
export type QueuedMessage = {
  id: string;
  sessionId: string;
  text: string;
  attachments: PromptAttachment[];
  createdAt: number;
  state: QueuedMessageState;
  error?: string;
};
/** Explicit outcome for the opt-in queue API; legacy `sendPrompt` remains void-compatible. */
export type QueueEnqueueResult = { outcome: "direct" | "queued"; message: QueuedMessage };
/** Authentication type pi supports for a provider. */
export type AuthType = "oauth" | "api_key";
/** Non-secret provider auth metadata (pi ModelRuntime.getProviders + stored credential type). */
export type AuthProviderInfo = {
  id: string;
  name: string;
  authTypes: AuthType[];
  loginLabel?: string;
  /** Provider has a stored credential (auth.json metadata only — never the key). */
  authenticated: boolean;
  authType?: AuthType;
};
export type AuthPromptOption = { id: string; label: string };
/** One step of an interactive login flow (pi AuthInteraction prompt/notify events). */
export type AuthLoginEvent =
  | { kind: "auth_url"; url: string; code?: string; instructions?: string }
  | { kind: "prompt"; promptType: "text" | "secret" | "select"; message: string; placeholder?: string; options?: AuthPromptOption[] }
  | { kind: "notice"; message: string }
  | { kind: "completed"; providerId: string }
  | { kind: "failed"; error: string }
  | { kind: "cancelled" };
/** Stable, transport-neutral snapshot of a session's cumulative usage. `cost`
 * is always USD; unknown/missing fields are omitted by producers, never guessed.
 */
export type SessionStats = {
  sessionId: string;
  tokens: SessionTokenUsage;
  /** Cumulative session cost in USD. */
  cost: number;
  contextUsage?: SessionContextUsage;
  /** Current model/provider of the session, when known. */
  model?: { provider?: string; id?: string; name?: string };
  performance?: SessionPerformance;
};
/** Snapshot event pushed by hosts after a session settles (or a manual snapshot). */
export type SessionStatsEvent = { type: "snapshot"; sessionId: string; stats: SessionStats };

/**
 * One usage window of an account-quota plan (mirrors Swift `QuotaWindow`):
 * e.g. a 5-hour cap or a weekly cap. `usedPercent` is 0…100; `resetsAt` is
 * epoch milliseconds when known. `label` is the compact capsule suffix
 * (5h / 周 / 月 / 额度), `title` the popover row title (5小时额度 / 周额度 …).
 */
export type QuotaWindow = { id: string; usedPercent: number; resetsAt?: number; label: string; title: string };
/**
 * Remaining prepaid balance for a pay-per-token provider account (mirrors
 * Swift `BalanceSnapshot`): the amount plus an ISO-ish currency code. The UI
 * renders `¥110.00` for CNY / `$74.75` for USD with two decimals.
 */
export type AccountBalance = { amount: number; currency: string };
/**
 * Per-account snapshot for the provider backing the current model (mirrors
 * Swift `QuotaSnapshot`). `null` means the provider has no quota or balance
 * source, no credential, or the fetch failed — the UI simply hides the pill.
 * `windows` is the subscription-quota plan (Codex 5h/周/月); `balance` is the
 * prepaid pay-per-token balance (DeepSeek). Quota and balance are mutually
 * exclusive per provider — quota wins, exactly like Swift — so at most one is
 * populated. `balance` is optional so existing Codex-only producers and old
 * clients keep working unchanged.
 */
export type QuotaSnapshot = { provider: string; accountLabel: string; windows: QuotaWindow[]; balance?: AccountBalance };

/**
 * Optional terminal extension. It remains optional so existing v2 hosts can
 * continue serving chat-only clients while the Electron terminal rolls out.
 */
export type TerminalDimensions = { cols: number; rows: number };
export type TerminalOpenOptions = { sessionId?: string; projectId?: string; cwd?: string; cols?: number; rows?: number };
export type TerminalPrivateState = "none" | "pending" | "active";
export type TerminalSession = { id: string; title: string; cwd?: string; sessionId?: string; snapshotId?: string; privateState?: TerminalPrivateState; initialOutput?: string };
export type TerminalFramebuffer = { terminalId: string; initialOutput: string; revision: number; cols: number; rows: number; redacted?: boolean; resyncRequired?: boolean };
export type TerminalEvent =
  | { type: "output"; terminalId: string; data: string; revision?: number }
  | { type: "title"; terminalId: string; title: string }
  | { type: "cwd"; terminalId: string; cwd: string }
  | { type: "exit"; terminalId: string; exitCode?: number }
  | { type: "reveal"; sessionId: string; terminalId: string }
  | { type: "opened"; sessionId: string; terminal: TerminalSession }
  | { type: "private"; terminalId: string; state: TerminalPrivateState };
export type TerminalKey = "ENTER" | "TAB" | "ESCAPE" | "BACKSPACE" | "DELETE" | "UP" | "DOWN" | "LEFT" | "RIGHT" | "HOME" | "END" | "PAGE_UP" | "PAGE_DOWN" | "CTRL_C" | "CTRL_D" | "CTRL_Z";
export type TerminalToolRequest = { action: "list" | "open" | "observe" | "wait" | "send" | "key" | "resize" | "close" | "help" | "request_private_input" | "begin_private_input" | "finish_private_input" | "cancel_private_input"; terminal_id?: string; snapshot_id?: string; cwd?: string; cols?: number; rows?: number; text?: string; enter?: boolean; key?: TerminalKey; timeout?: number };
export type TerminalToolResult = Record<string, unknown> & { ok: boolean; error?: string; terminalId?: string; snapshotId?: string; screen?: string; requiresSelection?: boolean; requiresUserInput?: boolean };
export interface TerminalHostAPI {
  open(options?: TerminalOpenOptions): Promise<TerminalSession>;
  write(terminalId: string, data: string): Promise<void>;
  resize?(terminalId: string, dimensions: TerminalDimensions): Promise<void>;
  clear(terminalId: string): Promise<void>;
  privateInput?(terminalId: string, action: "begin_private_input" | "finish_private_input" | "cancel_private_input"): Promise<TerminalToolResult>;
  snapshot?(terminalId: string): Promise<TerminalFramebuffer>;
  close(terminalId: string): Promise<void>;
  subscribe(terminalId: string, listener: (event: TerminalEvent) => void): Unsubscribe;
  subscribeAll?(listener: (event: TerminalEvent) => void): Unsubscribe;
}

/** Browser tab metadata mirrors the agent-browser tab surface without exposing Electron objects. */
export type BrowserTab = { id: string; title: string; url: string; isLoading: boolean; canGoBack: boolean; canGoForward: boolean; /** Electron storage partition owned by this chat session. */ partition?: string };
export type BrowserTabsSnapshot = { tabs: BrowserTab[]; activeTabId?: string };
/** Lightweight MVP snapshot; agent-browser will later populate an accessibility/text payload. */
export type BrowserSnapshot = { tabId: string; url: string; title: string; isLoading: boolean; text?: string };
export type BrowserToolTarget = "active" | "desktop" | "mobile" | "both";
export type BrowserViewMode = "desktop" | "mobile" | "compare";
export type BrowserViewportKind = "desktop" | "mobile";
export type BrowserMobileDeviceId = "responsive" | "iphone-se" | "iphone-14-pro" | "iphone-15-pro-max" | "pixel-7" | "galaxy-s23";
export type BrowserMobileDevicePreset = {
  id: BrowserMobileDeviceId;
  label: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  userAgent: string;
};
export const BROWSER_DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
export const BROWSER_MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
const IPHONE_SAFARI_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const PIXEL_7_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36";
const GALAXY_S23_UA = "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36";
export const BROWSER_MOBILE_DEVICES: readonly BrowserMobileDevicePreset[] = [
  { id: "responsive", label: "响应式 / 自定义", width: 390, height: 844, deviceScaleFactor: 2, userAgent: IPHONE_SAFARI_UA },
  { id: "iphone-se", label: "iPhone SE", width: 375, height: 667, deviceScaleFactor: 2, userAgent: IPHONE_SAFARI_UA },
  { id: "iphone-14-pro", label: "iPhone 14 Pro", width: 393, height: 852, deviceScaleFactor: 3, userAgent: IPHONE_SAFARI_UA },
  { id: "iphone-15-pro-max", label: "iPhone 15 Pro Max", width: 430, height: 932, deviceScaleFactor: 3, userAgent: IPHONE_SAFARI_UA },
  { id: "pixel-7", label: "Pixel 7", width: 412, height: 915, deviceScaleFactor: 2.625, userAgent: PIXEL_7_UA },
  { id: "galaxy-s23", label: "Samsung Galaxy S23", width: 360, height: 780, deviceScaleFactor: 3, userAgent: GALAXY_S23_UA }
];
export function browserMobileDeviceById(id: string | undefined): BrowserMobileDevicePreset {
  return BROWSER_MOBILE_DEVICES.find(item => item.id === id) ?? BROWSER_MOBILE_DEVICES[0]!;
}
export type BrowserToolRequest = { action: string; url?: string; scope?: "viewport" | "page"; snapshot_id?: string; element_index?: number; element_token?: string; selector?: string; text?: string; option?: string; direction?: "up" | "down" | "left" | "right"; amount?: number; mode?: string; js?: string; /** Defaults to the UI's active viewport. Omitted on old clients. */ target?: BrowserToolTarget };
export type BrowserToolImage = { viewport: BrowserViewportKind; base64: string; mimeType: string; width?: number; height?: number };
export type BrowserToolResult = Record<string, unknown> & { ok: boolean; error?: string; base64?: string; mimeType?: string; images?: BrowserToolImage[] };
export type BrowserTabOptions = { url?: string };
export type BrowserViewSlot = { x: number; y: number; width: number; height: number };
/** Backward-compatible presentation envelope; Electron renders it in a separate framed child window. */
export type BrowserMobileOverlay = {
  visible: boolean;
  applyDeviceEmulation?: boolean;
  deviceId?: BrowserMobileDeviceId | string;
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  userAgent?: string;
};
export type BrowserViewBounds = { x: number; y: number; width: number; height: number; visible?: boolean; mode?: BrowserViewMode; slots?: { desktop?: BrowserViewSlot; mobile?: BrowserViewSlot }; mobileOverlay?: BrowserMobileOverlay };
export type BrowserEvent = (
  | { type: "tabs"; snapshot: BrowserTabsSnapshot }
  | { type: "reveal" }
  | { type: "error"; message: string }
  | { type: "mobile-window"; open: boolean; deviceId?: BrowserMobileDeviceId | string }
) & { sessionId: string };

/**
 * Optional desktop-browser extension. `loadURL` is the navigation command;
 * `snapshot` deliberately keeps agent-browser-compatible semantics while this
 * MVP only returns metadata.
 */
export interface BrowserHostAPI {
  /** Announces which chat owns the visible Browser panel, even while another tool tab is open. */
  selectSession(sessionId: string): Promise<void>;
  listTabs(sessionId: string): Promise<BrowserTabsSnapshot>;
  getActiveTab(sessionId: string): Promise<BrowserTab | undefined>;
  newTab(sessionId: string, options?: BrowserTabOptions): Promise<BrowserTab>;
  switchTab(sessionId: string, tabId: string): Promise<BrowserTab>;
  closeTab(sessionId: string, tabId: string): Promise<BrowserTabsSnapshot>;
  loadURL(sessionId: string, url: string, tabId?: string): Promise<BrowserTab>;
  goBack(sessionId: string, tabId?: string): Promise<BrowserTab>;
  goForward(sessionId: string, tabId?: string): Promise<BrowserTab>;
  reload(sessionId: string, tabId?: string): Promise<BrowserTab>;
  snapshot(sessionId: string, tabId?: string): Promise<BrowserSnapshot>;
  /** Renderer-to-main placement bridge for the selected session's WebContentsView. */
  setViewBounds(sessionId: string, bounds: BrowserViewBounds): Promise<void>;
  /** Page zoom for the visible desktop WebContents (not the mobile device-frame scale). */
  setZoomFactor(sessionId: string, factor: number, tabId?: string): Promise<number>;
  subscribe(listener: (event: BrowserEvent) => void): Unsubscribe;
}

/** Base64-encoded image attached to a tool result (screenshots, generated images, etc.). */
export type TranscriptImage = { data: string; mimeType: string };

/** Settings → 扩展 → 你添加的. Never includes env or secrets. */
export type UserMcpServer = {
  name: string;
  transport: string;
  summary: string;
};

export type StreamEvent =
  | { type: "user_message"; sessionId: string; content: string; id?: string }
  | { type: "text"; sessionId: string; contentIndex: number; delta: string; segment?: number }
  | { type: "thinking"; sessionId: string; contentIndex: number; delta: string; segment?: number }
  | { type: "tool_call"; sessionId: string; contentIndex?: number; toolCallId: string; name: string; delta?: string; segment?: number }
  | { type: "tool_result"; sessionId: string; toolCallId: string; content: string; isError?: boolean; images?: TranscriptImage[] }
  | { type: "session_title"; sessionId: string; title: string; source: "provisional" | "model" | "manual" }
  | { type: "status"; sessionId: string; status: "started" | "streaming" | "settled" | "stopped"; pendingFollowUps?: string[]; turnEpoch?: number }
  /**
   * Turn-terminal model/provider failure: pi closed the assistant message with
   * `stopReason: "error"` and an `errorMessage` instead of text. Forwarded so a
   * failed turn never settles as a blank bubble. `content` is the raw provider
   * error text. Old clients may safely ignore it.
   */
  | { type: "error"; sessionId: string; content: string }
  /** Snapshot after every queue mutation; old clients may safely ignore this new event type. */
  | { type: "queue_update"; sessionId: string; queue: QueuedMessage[]; pendingFollowUps?: string[] }
  /**
   * Context-compaction lifecycle, mirroring pi's `compaction_start`/`compaction_end`.
   * Emitted for every compaction the session runs — pi's own threshold/overflow
   * path, the host's proactive one, and `/compact` alike. `reason` is pi's
   * (`manual` | `threshold` | `overflow`); `aborted`/`error` are end-only and
   * mutually exclusive with a clean finish. Old clients may safely ignore it.
   */
  | { type: "compaction"; sessionId: string; phase: "start" | "end"; reason?: string; aborted?: boolean; error?: string }
  /**
   * After the session writer is quiet, the host rewrites JSONL and pushes the
   * already-redacted texts so live bubbles replace plaintext. Old clients may
   * safely ignore this new event type.
   */
  | { type: "secret_redact"; sessionId: string; messages: Array<{ id: string; role?: "user" | "assistant" | "tool" | "compaction"; content: string; thinking?: string; tools?: HistoryTool[] }> };
export type AgentEvent = { type: "agent"; agent: AgentSummary } | { type: "agent_log"; /** Optional only so an older host event can be ignored safely; current hosts always emit both identity fields. */ sessionId?: string; agentId: string; runId?: string; itemType: "text" | "thinking" | "tool" | "toolResult"; text: string; name?: string; isError?: boolean; /** Runtime log_delta key: cumulative full text per streamed entry, so the panel can upsert one row per contentIndex instead of one per chunk. */ contentIndex?: number; /** Uncapped thinking length; preview `text` may still be sliced. */ charCount?: number; /** Turn boundary from runtime `kind:"log"`: forget contentIndex slots so the next message's index 0 opens a new row instead of rewriting the previous thinking/text. */ resetStreamSlots?: boolean } | { type: "worktree"; status: WorktreeStatus };
export type DocumentEvent = { type: "documentChanged"; path: string };
export type HostEvent =
  | { protocolVersion: typeof PIPI_HOST_PROTOCOL_VERSION; channel: "stream"; event: StreamEvent }
  | { protocolVersion: typeof PIPI_HOST_PROTOCOL_VERSION; channel: "agents"; event: AgentEvent }
  | { protocolVersion: typeof PIPI_HOST_PROTOCOL_VERSION; channel: "terminal"; event: TerminalEvent }
  | { protocolVersion: typeof PIPI_HOST_PROTOCOL_VERSION; channel: "browser"; event: BrowserEvent }
  | { protocolVersion: typeof PIPI_HOST_PROTOCOL_VERSION; channel: "session_stats"; event: SessionStatsEvent }
  | { protocolVersion: typeof PIPI_HOST_PROTOCOL_VERSION; channel: "document"; event: DocumentEvent }
  | { protocolVersion: typeof PIPI_HOST_PROTOCOL_VERSION; channel: "plan"; event: PlanEvent };

export interface PipiHostAPI {
  readonly protocolVersion: typeof PIPI_HOST_PROTOCOL_VERSION;
  listProjects(): Promise<Project[]>; listSessions(projectId: string): Promise<Session[]>;
  /**
   * Read-only sessions written by other local agents for this project cwd.
   * Never mixed into `listSessions` and never leaseable / deletable / sendable.
   */
  listExternalSessions?(projectId: string): Promise<ExternalSession[]>;
  /**
   * Durable explicit sidebar project list. On its first read the host migrates
   * discovered JSONL cwd values once; afterwards even an explicit [] stays
   * empty across restarts until callers add a path again.
   */
  getProjectPaths?(): Promise<string[]>; setProjectPaths?(paths: string[]): Promise<string[]>;
  /** Electron-only native folder chooser. `null` means the user cancelled. */
  pickProjectDirectory?(): Promise<string | null>;
  addProject?(path: string): Promise<Project>; removeProject?(projectId: string): Promise<void>;
  /** Display name only; the on-disk folder is never renamed. */
  renameProject?(projectId: string, name: string): Promise<Project>;
  /** Optional: absent or unsupported v2 hosts let the UI use its local preview fallback. */
  listDocuments?(projectId?: string): Promise<DocumentSummary[]>; readDocument?(documentId: string): Promise<DocumentContent>;
  /** Watch the displayed document; switch unwatches the previous path. Watch errors stay silent. */
  watchDocument?(path: string): Promise<void>;
  unwatchDocument?(): Promise<void>;
  subscribeDocuments?(listener: (event: DocumentEvent) => void): Unsubscribe;
  /** Open or drop: remember the documents and inject path+excerpt into the session. */
  notifyDocumentsDropped?(sessionId: string, paths: string[]): Promise<void>;
  newSession(projectId: string, name?: string): Promise<Session>; resumeSession(sessionId: string): Promise<Session>; renameSession(sessionId: string, name: string): Promise<Session>; deleteSession(sessionId: string): Promise<void>; moveSession(sessionId: string, targetProjectId: string): Promise<Session>;
  /** Newest-first paging cursor: an entry id is stable/exclusive; numeric newest-relative offsets remain supported for compatibility. */
  getSessionHistory(sessionId: string, before?: number | string, limit?: number): Promise<HistoryEntry[]>;
  /**
   * Read-only external history. Sources that cannot safely expose plaintext
   * return `metadata` / `summary` with empty `entries` instead of scanning
   * credential, account, token, FTS, or message-body stores.
   */
  getExternalSessionHistory?(sessionId: string, before?: number | string, limit?: number): Promise<ExternalSessionHistory>;
  /**
   * Derive a writable Pi session from an external record (one-shot, idempotent).
   * Does not mutate the original external files.
   */
  adoptExternalSession?(sessionId: string): Promise<Session>;
  getSessionLease(sessionId: string): Promise<SessionLease>; forceTakeoverSessionLease(sessionId: string): Promise<SessionLease>;
  /** Legacy-compatible send: direct sends and busy queueing are observed through `queue_update` stream events. */
  sendPrompt(sessionId: string, prompt: string, attachments?: PromptAttachment[]): Promise<void>;
  listQueue(sessionId: string): Promise<QueuedMessage[]>; enqueueMessage(sessionId: string, text: string, attachments?: PromptAttachment[]): Promise<QueueEnqueueResult>; updateQueuedMessage(sessionId: string, messageId: string, text: string, attachments?: PromptAttachment[]): Promise<QueuedMessage>; removeQueuedMessage(sessionId: string, messageId: string): Promise<QueuedMessage>; promoteQueuedMessage(sessionId: string, messageId: string): Promise<QueuedMessage>; steerQueuedMessage(sessionId: string, messageId: string): Promise<QueuedMessage>; cutInQueuedMessage(sessionId: string, messageId: string): Promise<QueuedMessage>; retryQueuedMessage(sessionId: string, messageId: string): Promise<QueuedMessage>;
  stop(sessionId: string): Promise<void>; queueFollowUp(sessionId: string, prompt: string): Promise<void>; subscribeStream(sessionId: string, listener: (event: StreamEvent) => void): Unsubscribe;
  /** Optional compatibility extension: observe stream events from every session without changing the selected-session subscription. */
  subscribeAllStreams?(listener: (event: StreamEvent) => void): Unsubscribe;
  /**
   * Compact the session's context now (pi's `compact` RPC — the same path
   * `/compact` uses). Optional: older hosts omit it and the UI hides the
   * command. Progress and outcome arrive as `compaction` stream events, so this
   * resolves once pi accepted and finished the compaction and rejects when it
   * refused (e.g. "Nothing to compact").
   */
  compact?(sessionId: string): Promise<void>;
  listModels(): Promise<Model[]>; getModelState(sessionId?: string): Promise<ModelState>; setModel(sessionId: string, provider: string, modelId: string): Promise<ModelState>; setThinkingLevel(sessionId: string, level: ThinkingLevel): Promise<ModelState>;
  /**
   * Opt-out visibility for the quick model menu — mirrors Swift
   * `ModelVisibility.hiddenModelIds` (sorted full `provider/modelId` refs).
   * Persisted by the host (Electron: ~/.pi/agent/pipiui-settings.json), atomic.
   */
  getHiddenModelIds(): Promise<string[]>; setHiddenModelIds(ids: string[]): Promise<string[]>;
  getSidebarSessionPreferences?(): Promise<SidebarSessionPreferences>;
  setSidebarSessionPreferences?(preferences: SidebarSessionPreferences): Promise<SidebarSessionPreferences>;
  /** Optional desktop-control preference; permission probes are unavailable on some hosts. */
  getComputerUseState?(): Promise<ComputerUseState>;
  setComputerUseEnabled?(enabled: boolean): Promise<{ enabled: boolean }>;
  /** Electron/macOS-only: request the TCC permission and open the matching System Settings pane. */
  openComputerUsePermission?(kind: ComputerUsePermissionKind): Promise<ComputerUseState>;
  /** Optional per-role model fallback chains. Empty chain follows the main Agent model. */
  getSubagentModels?(): Promise<Record<string, SubagentModelSetting[]>>;
  setSubagentModel?(agentName: string, chain: SubagentModelSetting[]): Promise<Record<string, SubagentModelSetting[]>>;
  /** Missing/null means Hermes resolves the active main model at review time. */
  getMemoryReviewModel?(): Promise<string | null>;
  setMemoryReviewModel?(modelRef: string | null): Promise<string | null>;
  /**
   * Optional persistent vision-model selection (full `provider/modelId` ref).
   * `null` means none selected. Backed by the host (Electron:
   * `pipiui-settings.json` + a `vision.json` bridge for @getpipher/vision),
   * atomic. Absent on hosts without vision support — the UI shows an
   * unavailable state instead of calling these.
   */
  getVisionModel?(): Promise<string | null>;
  setVisionModel?(ref: string | null): Promise<string | null>;
  /**
   * Optional global master switch for the image-attachment fallback: when on
   * and a vision model is selected, attached images are described by the
   * vision model and the description text is injected into the message sent to
   * a non-multimodal main model. Persisted by the host (Electron:
   * `pipiui-settings.json`); missing = disabled.
   */
  getVisionEnabled?(): Promise<boolean>;
  setVisionEnabled?(enabled: boolean): Promise<boolean>;
  /**
   * Scan Codex/Claude/Cursor/Grok/OpenCode/ZCode chats into the sidebar.
   * Missing key = enabled.
   */
  getScanExternalSessions?(): Promise<boolean>;
  setScanExternalSessions?(enabled: boolean): Promise<boolean>;
  /** Project-scoped PaddleOCR AI Studio token. Renderer only receives hasKey, never the secret. */
  getPaddleOcrStatus?(projectId: string): Promise<{ hasKey: boolean }>;
  /** Pass a new token or null to clear. Never returned back to the renderer. */
  setPaddleOcrAccessToken?(projectId: string, token: string | null): Promise<{ hasKey: boolean }>;
  /** Global App-profile vault metadata. Values never cross this boundary. Mounts are the current session only. */
  listSecretVault?(sessionId: string): Promise<{ secrets: Array<{ id: string; name: string; envName: string; createdAt: string }>; mounts: Array<{ secretId: string; envName: string; name: string }>; sessionId: string }>;
  putSecretVault?(input: { name: string; envName: string; value: string; sessionId: string }): Promise<{ secret: { id: string; name: string; envName: string; createdAt: string }; mount: { secretId: string; envName: string }; sessionId: string }>;
  mountSecretVault?(sessionId: string, secret: string, envName?: string): Promise<{ sessionId: string; mount: { secretId: string; envName: string } }>;
  unmountSecretVault?(sessionId: string, secret: string): Promise<{ sessionId: string; removed: boolean }>;
  deleteSecretVault?(secret: string): Promise<{ deleted: boolean }>;
  /** Memory-vault availability. Always available; never returns secret values. */
  diagnoseSecretVault?(): Promise<{
    available: boolean;
    kind: 'available' | 'missing-packages' | 'session-bus-unavailable' | 'secret-service-unreachable' | 'keyring-locked' | 'no-graphical-session' | 'encryption-unavailable';
    message: string;
    installHint?: string;
    retryable: boolean;
    platform: string;
  }>;
  listAgentDefinitions?(): Promise<AgentDefinition[]>;
  /**
   * Provider credentials and login — backed by pi's ModelRuntime
   * (getProviders / login / logout / AuthStorage) over IPC and WSS.
   * Credential VALUES never cross this boundary except a single api-key
   * prompt answer; metadata only otherwise.
   */
  authProviders(): Promise<AuthProviderInfo[]>;
  beginProviderLogin(providerId: string, authType: AuthType): Promise<{ loginId: string }>;
  continueProviderLogin(loginId: string, input?: string): Promise<AuthLoginEvent>;
  cancelProviderLogin(loginId: string): Promise<void>;
  /** Deletes the provider's pi credentials (pi logout) and refreshes models. */
  removeProviderCredentials(providerId: string): Promise<ModelState>;
  /**
   * Persist an OpenAI-compatible custom provider into models.json
   * (`api: openai-completions` + baseUrl + apiKey + models[]) and refresh the catalog.
   */
  addOpenAICompatibleProvider?(input: {
    name: string;
    baseUrl: string;
    apiKey: string;
    modelId: string;
    contextWindow?: number;
  }): Promise<{ providerId: string }>;
  /** Electron-only: open an auth URL in the user's browser (safe http/https only). */
  openExternal?(url: string): Promise<void>;
  /** Electron-only: open one validated local supported document in the OS default app. */
  openDocumentExternally?(absolutePath: string): Promise<void>;
  /**
   * Cumulative usage snapshot for a session. `sessionId` is optional: omit it
   * to target the host's current active session. Backed by pi's real
   * `get_session_stats` RPC; unknown/missing fields are omitted, never guessed.
   */
  getSessionStats(sessionId?: string): Promise<SessionStats>; subscribeSessionStats(listener: (event: SessionStatsEvent) => void): Unsubscribe;
  /**
   * Account-quota snapshot for the selected session's model provider
   * (e.g. Codex plan 5h/weekly windows, DeepSeek prepaid balance). Optional:
   * older hosts omit it and the UI hides the quota/balance capsules. Resolves
   * `null` when the provider has no quota or balance source or no credential —
   * never throws for a missing pill. Quota wins over balance: a snapshot that
   * carries usage windows never also carries `balance`.
   */
  getQuotaSnapshot?(sessionId?: string): Promise<QuotaSnapshot | null>;
  /** Current snapshot; omit sessionId only for hosts that intentionally aggregate all sessions. */
  listAgents(sessionId?: string): Promise<AgentSummary[]>; getAgentLogs(agentId: string, sessionId: string, runId: string, scope?: "run" | "agent"): Promise<{ itemType: "text" | "thinking" | "tool" | "toolResult"; text: string; name?: string; isError?: boolean; contentIndex?: number; charCount?: number }[]>; subscribeAgents(listener: (event: AgentEvent) => void): Unsubscribe; subscribeAgentLog(agentId: string, listener: (event: Extract<AgentEvent, { type: "agent_log" }>) => void, sessionId: string, runId: string): Unsubscribe; abortAgent(agentId: string): Promise<void>; resolveAgent(agentId: string): Promise<void>; checkAgent(agentId: string): Promise<AgentSummary>; getWorktreeStatus(agentId: string): Promise<WorktreeStatus>; mergeWorktree(agentId: string): Promise<WorktreeStatus>; discardWorktree(agentId: string): Promise<WorktreeStatus>;
  /**
   * Plans the session's runtime published through the plan tools, newest
   * activity first. Optional: hosts that mount no plan runtime advertise
   * `capabilities().plan === false` and the UI shows the tab as unavailable.
   * Omitting `sessionId` targets the host's current active session.
   */
  getPlans?(sessionId?: string): Promise<PlanSnapshot[]>;
  subscribePlans?(listener: (event: PlanEvent) => void): Unsubscribe;
  capabilities(): Promise<HostCapabilities>;
  /**
   * Optional git extension for the toolbar branch control. Hosts advertise it
   * with `capabilities().git`; `gitCheckout` runs a plain `git checkout` in the
   * project work tree and returns the re-probed status.
   */
  gitStatus?(projectId: string): Promise<GitStatus>;
  gitCheckout?(projectId: string, branch: string): Promise<GitStatus>;
  /**
   * Optional add-project-time probe of an arbitrary directory the user just
   * picked in the native chooser. Hosts that advertise it let the UI warn
   * about non-git folders before the first writable-worker dispatch fails
   * mid-task; `gitInitDirectory` is the matching one-click remedy.
   */
  probeDirectoryGit?(path: string): Promise<GitStatus>;
  gitInitDirectory?(path: string): Promise<GitStatus>;
  /** Electron-only read-only check used by onboarding; old hosts may omit it. */
  probeGitBinary?(): Promise<boolean>;
  /** Optional v2 UI convenience; older hosts simply render Finder reveal disabled. */
  revealProject?(projectId: string): Promise<void>;
  /** Read-only project `.pi/mcp.json` servers for Settings → 扩展. */
  listUserMcpServers?(projectId: string): Promise<UserMcpServer[]>;
  /** Electron-only, read-only version discovery. It never installs or mutates packages. */
  checkForUpdates?(): Promise<UpdateCenterSnapshot>;
  /** Optional extension; remote/non-Electron hosts advertise `capabilities().browser === false`. */
  browser?: BrowserHostAPI;
  /** Optional extension; clients show an unavailable state when an old host omits it. */
  terminal?: TerminalHostAPI;
}

type BaseHostMethod = Exclude<keyof Omit<PipiHostAPI, "protocolVersion" | "subscribeStream" | "subscribeAllStreams" | "subscribeAgents" | "subscribeAgentLog" | "subscribeSessionStats" | "subscribeDocuments" | "subscribePlans" | "browser" | "terminal">, "browser" | "terminal">;
export type TerminalHostMethod = "terminalOpen" | "terminalWrite" | "terminalResize" | "terminalClear" | "terminalPrivate" | "terminalSnapshot" | "terminalClose";
export type BrowserHostMethod = "browserSelectSession" | "browserListTabs" | "browserGetActiveTab" | "browserNewTab" | "browserSwitchTab" | "browserCloseTab" | "browserLoadURL" | "browserGoBack" | "browserGoForward" | "browserReload" | "browserSnapshot" | "browserSetViewBounds" | "browserSetZoomFactor";
export type HostMethod = BaseHostMethod | TerminalHostMethod | BrowserHostMethod;
export type HostRequest = { protocolVersion: typeof PIPI_HOST_PROTOCOL_VERSION; id: string; type: "request"; method: HostMethod; params: unknown[] };
export type HostResponse = { protocolVersion: typeof PIPI_HOST_PROTOCOL_VERSION; id: string; type: "response"; ok: true; result: unknown } | { protocolVersion: typeof PIPI_HOST_PROTOCOL_VERSION; id: string; type: "response"; ok: false; error: string; errorCode?: string };
export type HostWireFrame = HostRequest | HostResponse | ({ type: "event" } & HostEvent);
export interface HostBackend {
  handle(method: HostMethod, params: unknown[]): Promise<unknown>;
  subscribe(listener: (event: HostEvent) => void): Unsubscribe;
  /** Exclusive owners may implement this; shared backends must not be closed by a transport. */
  close?(): Promise<void> | void;
}
export interface IpcRendererLike { invoke(channel: string, request: HostRequest): Promise<HostResponse>; on(channel: string, listener: (_event: unknown, frame: HostWireFrame) => void): void; removeListener(channel: string, listener: (_event: unknown, frame: HostWireFrame) => void): void; }

function requestId(): string { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

function apiFrom(
  call: (method: HostMethod, params: unknown[]) => Promise<unknown>,
  subscribe: (channel: HostEvent["channel"], predicate: (event: HostEvent) => boolean, listener: (event: HostEvent) => void) => Unsubscribe,
  options: { openExternal?: boolean; openDocumentExternally?: boolean; projectDirectoryPicker?: boolean; computerUsePermissions?: boolean; updateCenter?: boolean } = {}
): PipiHostAPI {
  const invoke = <T>(method: HostMethod, ...params: unknown[]) => call(method, params) as Promise<T>;
  const api: PipiHostAPI = {
    protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
    listProjects: () => invoke("listProjects"),
    listSessions: projectId => invoke("listSessions", projectId),
    listExternalSessions: projectId => invoke("listExternalSessions", projectId),
    getProjectPaths: () => invoke("getProjectPaths"),
    setProjectPaths: paths => invoke("setProjectPaths", paths),
    pickProjectDirectory: () => invoke("pickProjectDirectory"),
    addProject: path => invoke("addProject", path),
    removeProject: projectId => invoke("removeProject", projectId),
    renameProject: (projectId, name) => invoke("renameProject", projectId, name),
    listDocuments: projectId => invoke("listDocuments", projectId),
    readDocument: documentId => invoke("readDocument", documentId),
    watchDocument: path => invoke("watchDocument", path),
    unwatchDocument: () => invoke("unwatchDocument"),
    notifyDocumentsDropped: (sessionId, paths) => invoke("notifyDocumentsDropped", sessionId, paths),
    subscribeDocuments: listener => subscribe("document", event => event.channel === "document", event => listener((event as Extract<HostEvent, { channel: "document" }>).event)),
    newSession: (projectId, name) => invoke("newSession", projectId, name),
    resumeSession: sessionId => invoke("resumeSession", sessionId),
    renameSession: (sessionId, name) => invoke("renameSession", sessionId, name),
    deleteSession: sessionId => invoke("deleteSession", sessionId),
    moveSession: (sessionId, targetProjectId) => invoke("moveSession", sessionId, targetProjectId),
    getSessionHistory: (sessionId, before, limit) => before === undefined
      ? invoke("getSessionHistory", sessionId)
      : invoke("getSessionHistory", sessionId, before, limit),
    getExternalSessionHistory: (sessionId, before, limit) => before === undefined
      ? invoke("getExternalSessionHistory", sessionId)
      : invoke("getExternalSessionHistory", sessionId, before, limit),
    adoptExternalSession: sessionId => invoke("adoptExternalSession", sessionId),
    getSessionLease: sessionId => invoke("getSessionLease", sessionId),
    forceTakeoverSessionLease: sessionId => invoke("forceTakeoverSessionLease", sessionId),
    sendPrompt: (sessionId, prompt, attachments) => attachments?.length ? invoke("sendPrompt", sessionId, prompt, attachments) : invoke("sendPrompt", sessionId, prompt),
    listQueue: sessionId => invoke("listQueue", sessionId),
    enqueueMessage: (sessionId, text, attachments) => attachments?.length ? invoke("enqueueMessage", sessionId, text, attachments) : invoke("enqueueMessage", sessionId, text),
    updateQueuedMessage: (sessionId, messageId, text, attachments) => attachments === undefined ? invoke("updateQueuedMessage", sessionId, messageId, text) : invoke("updateQueuedMessage", sessionId, messageId, text, attachments),
    removeQueuedMessage: (sessionId, messageId) => invoke("removeQueuedMessage", sessionId, messageId),
    promoteQueuedMessage: (sessionId, messageId) => invoke("promoteQueuedMessage", sessionId, messageId),
    steerQueuedMessage: (sessionId, messageId) => invoke("steerQueuedMessage", sessionId, messageId),
    cutInQueuedMessage: (sessionId, messageId) => invoke("cutInQueuedMessage", sessionId, messageId),
    retryQueuedMessage: (sessionId, messageId) => invoke("retryQueuedMessage", sessionId, messageId),
    stop: sessionId => invoke("stop", sessionId),
    queueFollowUp: (sessionId, prompt) => invoke("queueFollowUp", sessionId, prompt),
    compact: sessionId => invoke("compact", sessionId),
    subscribeStream: (sessionId, listener) => subscribe("stream", event => event.channel === "stream" && event.event.sessionId === sessionId, event => listener((event as Extract<HostEvent, { channel: "stream" }>).event)),
    subscribeAllStreams: listener => subscribe("stream", event => event.channel === "stream", event => listener((event as Extract<HostEvent, { channel: "stream" }>).event)),
    listModels: () => invoke("listModels"),
    getModelState: sessionId => sessionId ? invoke("getModelState", sessionId) : invoke("getModelState"),
    setModel: (sessionId, provider, modelId) => invoke("setModel", sessionId, provider, modelId),
    setThinkingLevel: (sessionId, level) => invoke("setThinkingLevel", sessionId, level),
    authProviders: () => invoke("authProviders"),
    beginProviderLogin: (providerId, authType) => invoke("beginProviderLogin", providerId, authType),
    continueProviderLogin: (loginId, input) => input === undefined ? invoke("continueProviderLogin", loginId) : invoke("continueProviderLogin", loginId, input),
    cancelProviderLogin: loginId => invoke("cancelProviderLogin", loginId),
    removeProviderCredentials: providerId => invoke("removeProviderCredentials", providerId),
    addOpenAICompatibleProvider: input => invoke("addOpenAICompatibleProvider", input),
    getHiddenModelIds: () => invoke("getHiddenModelIds"),
    setHiddenModelIds: ids => invoke("setHiddenModelIds", ids),
    getSidebarSessionPreferences: () => invoke("getSidebarSessionPreferences"),
    setSidebarSessionPreferences: preferences => invoke("setSidebarSessionPreferences", preferences),
    getComputerUseState: () => invoke("getComputerUseState"),
    setComputerUseEnabled: enabled => invoke("setComputerUseEnabled", enabled),
    getSubagentModels: () => invoke("getSubagentModels"),
    setSubagentModel: (agentName, chain) => invoke("setSubagentModel", agentName, chain),
    getMemoryReviewModel: () => invoke("getMemoryReviewModel"),
    setMemoryReviewModel: (modelRef) => invoke("setMemoryReviewModel", modelRef),
    getVisionModel: () => invoke("getVisionModel"),
    setVisionModel: ref => invoke("setVisionModel", ref),
    getVisionEnabled: () => invoke("getVisionEnabled"),
    setVisionEnabled: enabled => invoke("setVisionEnabled", enabled),
    getScanExternalSessions: () => invoke("getScanExternalSessions"),
    setScanExternalSessions: enabled => invoke("setScanExternalSessions", enabled),
    getPaddleOcrStatus: projectId => invoke("getPaddleOcrStatus", projectId),
    setPaddleOcrAccessToken: (projectId, token) => invoke("setPaddleOcrAccessToken", projectId, token),
    listSecretVault: sessionId => invoke("listSecretVault", sessionId),
    putSecretVault: input => invoke("putSecretVault", input),
    mountSecretVault: (sessionId, secret, envName) => invoke("mountSecretVault", sessionId, secret, envName),
    unmountSecretVault: (sessionId, secret) => invoke("unmountSecretVault", sessionId, secret),
    deleteSecretVault: secret => invoke("deleteSecretVault", secret),
    diagnoseSecretVault: () => invoke("diagnoseSecretVault"),
    listAgentDefinitions: () => invoke("listAgentDefinitions"),
    getSessionStats: sessionId => invoke("getSessionStats", sessionId),
    getQuotaSnapshot: sessionId => sessionId === undefined ? invoke("getQuotaSnapshot") : invoke("getQuotaSnapshot", sessionId),
    subscribeSessionStats: listener => subscribe("session_stats", event => event.channel === "session_stats", event => listener((event as Extract<HostEvent, { channel: "session_stats" }>).event)),
    listAgents: sessionId => invoke("listAgents", sessionId),
    getAgentLogs: (agentId, sessionId, runId, scope) => scope ? invoke("getAgentLogs", agentId, sessionId, runId, scope) : invoke("getAgentLogs", agentId, sessionId, runId),
    subscribeAgents: listener => subscribe("agents", event => event.channel === "agents", event => listener((event as Extract<HostEvent, { channel: "agents" }>).event)),
    subscribeAgentLog: (agentId, listener, sessionId, runId) => subscribe("agents", event => event.channel === "agents" && event.event.type === "agent_log" && event.event.agentId === agentId && event.event.sessionId === sessionId && event.event.runId === runId, event => listener((event as Extract<HostEvent, { channel: "agents" }>).event as Extract<AgentEvent, { type: "agent_log" }>)),
    abortAgent: agentId => invoke("abortAgent", agentId),
    resolveAgent: agentId => invoke("resolveAgent", agentId),
    checkAgent: agentId => invoke("checkAgent", agentId),
    getWorktreeStatus: agentId => invoke("getWorktreeStatus", agentId),
    mergeWorktree: agentId => invoke("mergeWorktree", agentId),
    discardWorktree: agentId => invoke("discardWorktree", agentId),
    getPlans: sessionId => sessionId === undefined ? invoke("getPlans") : invoke("getPlans", sessionId),
    subscribePlans: listener => subscribe("plan", event => event.channel === "plan", event => listener((event as Extract<HostEvent, { channel: "plan" }>).event)),
    capabilities: () => invoke("capabilities"),
    gitStatus: projectId => invoke("gitStatus", projectId),
    gitCheckout: (projectId, branch) => invoke("gitCheckout", projectId, branch),
    probeDirectoryGit: path => invoke("probeDirectoryGit", path),
    gitInitDirectory: path => invoke("gitInitDirectory", path),
    probeGitBinary: () => invoke("probeGitBinary"),
    revealProject: projectId => invoke("revealProject", projectId),
    listUserMcpServers: projectId => invoke("listUserMcpServers", projectId),
    checkForUpdates: () => invoke("checkForUpdates"),
    browser: {
      selectSession: sessionId => invoke("browserSelectSession", sessionId),
      listTabs: sessionId => invoke("browserListTabs", sessionId),
      getActiveTab: sessionId => invoke("browserGetActiveTab", sessionId),
      newTab: (sessionId, options) => invoke("browserNewTab", sessionId, options),
      switchTab: (sessionId, tabId) => invoke("browserSwitchTab", sessionId, tabId),
      closeTab: (sessionId, tabId) => invoke("browserCloseTab", sessionId, tabId),
      loadURL: (sessionId, url, tabId) => invoke("browserLoadURL", sessionId, url, tabId),
      goBack: (sessionId, tabId) => invoke("browserGoBack", sessionId, tabId),
      goForward: (sessionId, tabId) => invoke("browserGoForward", sessionId, tabId),
      reload: (sessionId, tabId) => invoke("browserReload", sessionId, tabId),
      snapshot: (sessionId, tabId) => invoke("browserSnapshot", sessionId, tabId),
      setViewBounds: (sessionId, bounds) => invoke("browserSetViewBounds", sessionId, bounds),
      setZoomFactor: (sessionId, factor, tabId) => invoke("browserSetZoomFactor", sessionId, factor, tabId),
      subscribe: listener => subscribe("browser", event => event.channel === "browser", event => listener((event as Extract<HostEvent, { channel: "browser" }>).event))
    },
    terminal: {
      open: options => invoke("terminalOpen", options),
      write: (terminalId, data) => invoke("terminalWrite", terminalId, data),
      resize: (terminalId, dimensions) => invoke("terminalResize", terminalId, dimensions),
      clear: terminalId => invoke("terminalClear", terminalId),
      privateInput: (terminalId, action) => invoke("terminalPrivate", terminalId, action),
      snapshot: terminalId => invoke("terminalSnapshot", terminalId),
      close: terminalId => invoke("terminalClose", terminalId),
      subscribe: (terminalId, listener) => subscribe("terminal", event => event.channel === "terminal" && "terminalId" in event.event && event.event.terminalId === terminalId, event => listener((event as Extract<HostEvent, { channel: "terminal" }>).event))
      ,subscribeAll: listener => subscribe("terminal", event => event.channel === "terminal", event => listener((event as Extract<HostEvent, { channel: "terminal" }>).event))
    }
  };
  if (!options.projectDirectoryPicker) delete api.pickProjectDirectory;
  if (options.openExternal) api.openExternal = url => invoke("openExternal", url);
  if (options.openDocumentExternally) api.openDocumentExternally = path => invoke("openDocumentExternally", path);
  if (options.computerUsePermissions) api.openComputerUsePermission = kind => invoke("openComputerUsePermission", kind);
  if (!options.updateCenter) delete api.checkForUpdates;
  return api;
}

function responseError(response: Extract<HostResponse, { ok: false }>): Error & { code?: string } {
  const error = new Error(response.error) as Error & { code?: string };
  if (response.errorCode) error.code = response.errorCode;
  return error;
}

export function createIpcHost(ipc: IpcRendererLike, channel = PIPI_HOST_IPC_CHANNEL, options?: { openExternal?: boolean; openDocumentExternally?: boolean; projectDirectoryPicker?: boolean; computerUsePermissions?: boolean; updateCenter?: boolean }): PipiHostAPI {
  return apiFrom(
    async (method, params) => {
      const response = await ipc.invoke(channel, { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id: requestId(), type: "request", method, params });
      if (!response.ok) throw responseError(response);
      return response.result;
    },
    (wanted, predicate, listener) => {
      const handler = (_event: unknown, frame: HostWireFrame) => {
        if (frame.type === "event" && frame.channel === wanted && predicate(frame)) listener(frame);
      };
      ipc.on(channel, handler);
      return () => ipc.removeListener(channel, handler);
    },
    options
  );
}

/** Stable client error when a socket drops with in-flight Host API requests. Never replay mutations. */
export const TRANSPORT_DISCONNECTED = "transport_disconnected" as const;

export type HostWireParseResult =
  | { ok: true; frame: HostWireFrame }
  | { ok: false; error: string };

export type BindHostBackendOptions = {
  /** When set, connection close also calls `backend.close?.()`. Shared backends must omit this. */
  ownsBackend?: boolean;
};

export type HostBackendSession = {
  receive(raw: unknown): void;
  close(): Promise<void>;
};

function isWireRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeWirePayload(raw: unknown): unknown {
  if (typeof raw === "string") return raw;
  if (!isWireRecord(raw) || !("data" in raw)) return raw;
  const data = raw.data;
  if (typeof data === "string") return data;
  if (data == null) return raw;
  if (typeof (data as { toString?: unknown }).toString === "function") return String(data);
  return data;
}

function transportDisconnectedError(): Error & { code: typeof TRANSPORT_DISCONNECTED } {
  const error = new Error("transport disconnected") as Error & { code: typeof TRANSPORT_DISCONNECTED };
  error.code = TRANSPORT_DISCONNECTED;
  return error;
}

function protocolErrorResponse(id = ""): Extract<HostResponse, { ok: false }> {
  return { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id, type: "response", ok: false, error: "unsupported protocol" };
}

function thrownHostError(error: unknown): Pick<Extract<HostResponse, { ok: false }>, "error" | "errorCode"> {
  const message = error instanceof Error ? error.message : String(error);
  const errorCode = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
  return errorCode ? { error: message, errorCode } : { error: message };
}

/**
 * Host API v2 wire seam. Frames stay `{ protocolVersion: 2, type, ... }` — no room/secret.
 * Clients send `request`; servers send `response` or `event`.
 * Unknown response ids are ignored. The first response for an id wins; later duplicates are unknown.
 * Malformed, wrong-version, and wrong-direction frames are `unsupported protocol`.
 */
export function parseHostWireFrame(raw: unknown): HostWireParseResult {
  let value = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { return { ok: false, error: "unsupported protocol" }; }
  }
  if (!isWireRecord(value) || value.protocolVersion !== PIPI_HOST_PROTOCOL_VERSION) {
    return { ok: false, error: "unsupported protocol" };
  }
  if (value.type === "request") {
    if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > 256
      || typeof value.method !== "string" || value.method.length === 0
      || !Array.isArray(value.params)) {
      return { ok: false, error: "unsupported protocol" };
    }
    return { ok: true, frame: value as unknown as HostRequest };
  }
  if (value.type === "response") {
    if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > 256 || typeof value.ok !== "boolean") {
      return { ok: false, error: "unsupported protocol" };
    }
    if (value.ok === false && typeof value.error !== "string") return { ok: false, error: "unsupported protocol" };
    if (value.ok === false && value.errorCode !== undefined && typeof value.errorCode !== "string") {
      return { ok: false, error: "unsupported protocol" };
    }
    return { ok: true, frame: value as unknown as HostResponse };
  }
  if (value.type === "event") {
    if (typeof value.channel !== "string" || value.channel.length === 0 || !isWireRecord(value.event)) {
      return { ok: false, error: "unsupported protocol" };
    }
    return { ok: true, frame: value as unknown as HostWireFrame };
  }
  return { ok: false, error: "unsupported protocol" };
}

/** Transport-neutral HostBackend ↔ HostRequest/HostResponse/HostEvent pump. */
export function createHostBackendSession(
  backend: HostBackend,
  send: (frame: HostWireFrame) => void,
  options: BindHostBackendOptions = {}
): HostBackendSession {
  let closed = false;
  const unsubscribe = backend.subscribe(event => {
    if (!closed) send({ type: "event", ...event });
  });
  return {
    receive(raw) {
      if (closed) return;
      const parsed = parseHostWireFrame(raw);
      if (!parsed.ok || parsed.frame.type !== "request") {
        send(protocolErrorResponse());
        return;
      }
      const request = parsed.frame;
      void Promise.resolve(backend.handle(request.method, request.params)).then(
        result => {
          if (!closed) send({ protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id: request.id, type: "response", ok: true, result });
        },
        error => {
          if (closed) return;
          send({ protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id: request.id, type: "response", ok: false, ...thrownHostError(error) });
        }
      );
    },
    async close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      if (options.ownsBackend) await Promise.resolve(backend.close?.()).catch(() => undefined);
    }
  };
}

/** Bind the v2 pump to any WebSocketLike. Close cancels this connection only unless `ownsBackend`. */
export function bindHostBackend(backend: HostBackend, socket: WebSocketLike, options?: BindHostBackendOptions): Unsubscribe {
  const session = createHostBackendSession(backend, frame => {
    if (socket.readyState !== 1) return;
    try { socket.send(JSON.stringify(frame)); } catch { /* close race */ }
  }, options);
  const onMessage = (raw: unknown) => session.receive(decodeWirePayload(raw));
  const onStop = () => dispose();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("close", onStop);
    socket.removeEventListener("error", onStop);
    void session.close();
  };
  socket.addEventListener("message", onMessage);
  socket.addEventListener("close", onStop);
  socket.addEventListener("error", onStop);
  if (socket.readyState === 2 || socket.readyState === 3) dispose();
  return dispose;
}

export interface WebSocketLike { readyState: number; send(data: string): void; addEventListener(type: "message" | "close" | "error", listener: (event: any) => void): void; removeEventListener(type: "message" | "close" | "error", listener: (event: any) => void): void; }

export function createWsHost(socket: WebSocketLike): PipiHostAPI {
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const events = new Set<(event: HostEvent) => void>();
  let disconnected = socket.readyState === 2 || socket.readyState === 3;
  const failPending = () => {
    if (disconnected) return;
    disconnected = true;
    const error = transportDisconnectedError();
    for (const item of pending.values()) item.reject(error);
    pending.clear();
  };
  const onMessage = (raw: unknown) => {
    if (disconnected) return;
    const parsed = parseHostWireFrame(decodeWirePayload(raw));
    if (!parsed.ok || parsed.frame.type === "request") return;
    const frame = parsed.frame;
    if (frame.type === "response") {
      const item = pending.get(frame.id);
      if (!item) return;
      pending.delete(frame.id);
      frame.ok ? item.resolve(frame.result) : item.reject(responseError(frame));
    } else {
      events.forEach(listener => listener(frame));
    }
  };
  socket.addEventListener("message", onMessage);
  socket.addEventListener("close", failPending);
  socket.addEventListener("error", failPending);
  return apiFrom(
    (method, params) => new Promise((resolve, reject) => {
      if (disconnected || socket.readyState === 2 || socket.readyState === 3) {
        reject(transportDisconnectedError());
        return;
      }
      const id = requestId();
      pending.set(id, { resolve, reject });
      try {
        socket.send(JSON.stringify({ protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id, type: "request", method, params } satisfies HostRequest));
      } catch {
        pending.delete(id);
        reject(transportDisconnectedError());
      }
    }),
    (channel, predicate, listener) => {
      const relay = (event: HostEvent) => { if (event.channel === channel && predicate(event)) listener(event); };
      events.add(relay);
      return () => events.delete(relay);
    }
  );
}
