import Foundation
import Combine
import AppKit

struct ModelInfo: Identifiable, Hashable {
    let provider: String
    let modelId: String
    let name: String
    let contextWindow: Int?
    /// `nil` means the model-list source did not provide this capability.
    var reasoning: Bool? = nil
    /// A present key with a nil value represents Pi's explicit JSON `null`.
    var thinkingLevelMap: [String: String?]? = nil
    var id: String { provider + "/" + modelId }

    /// Shared behavior-level parsing seam used by helper and in-process model discovery.
    static func parseModelListRow(_ row: [String: Any]) -> ModelInfo? {
        guard let provider = row["provider"] as? String,
              let modelId = row["id"] as? String
        else {
            return nil
        }
        return ModelInfo(
            provider: provider,
            modelId: modelId,
            name: (row["name"] as? String) ?? modelId,
            contextWindow: (row["contextWindow"] as? NSNumber)?.intValue,
            reasoning: row["reasoning"] as? Bool,
            thinkingLevelMap: ThinkingCapability.parseThinkingLevelMap(
                row["thinkingLevelMap"] as? [String: Any]
            )
        )
    }

    /// Whether this model belongs to a Grok/xAI provider (used to gate Grok account credit display).
    var isGrokProvider: Bool {
        let p = provider.lowercased()
        let i = modelId.lowercased()
        return p.contains("grok") || p == "xai" || i.contains("grok")
    }

    /// Whether this model is served via a local relay (e.g. `grok-relay` → 127.0.0.1:18891,
    /// `coding-relay` → 127.0.0.1:18888). Such providers authenticate with a relay token
    /// whose account is unrelated to any first-party account surface, so their credits
    /// cannot be read and the pill is suppressed.
    var isRelayProvider: Bool {
        provider.lowercased().contains("relay")
    }

    /// Which first-party account-quota source backs this model, if any.
    /// `nil` for relay providers and unknown providers → no pill shown.
    /// Provider id strings come from `pi --list-models` (e.g. `xai`, `zai-coding-cn`,
    /// `anthropic`, `openai-codex`, `kimi-coding`).
    var quotaProvider: QuotaProvider? {
        if isRelayProvider { return nil }
        let p = provider.lowercased()
        if p == "xai" || p.contains("grok") { return .grok }
        if p.contains("zai") || p.contains("zhipu") || p.contains("bigmodel") { return .glm }
        if p == "anthropic" || p.contains("claude") { return .claude }
        if p.contains("openai") || p.contains("codex") { return .codex }
        // Kimi Code Plan (`kimi-coding`); not Moonshot open-platform balance.
        if p.contains("kimi") { return .kimi }
        // Qoder subscription (pi-provider-qoder extension: `qoder` / `qoder-cn`).
        if p.contains("qoder") { return .qoder }
        return nil
    }

    /// Whether the account-quota pill should be shown for this model.
    var shouldShowAccountQuota: Bool {
        quotaProvider != nil
    }
}

struct ToolCallBlock: Identifiable, Equatable {
    let id: String
    let name: String
    let argsSummary: String
    /// Char count of streamed write/edit payload (for live `~N tokens`); 0 for other tools.
    var payloadChars: Int = 0
    /// Bounded, UI-safe subset of write/edit arguments used to explain finished changes.
    var fileChangePayload: FileChangePayload? = nil
}

/// Path + payload size for tool-call headers. write/edit never fall back to JSON dumps.
enum ToolCallSummary {
    static func summarize(name: String, args: J) -> (summary: String, payloadChars: Int) {
        switch name {
        case "write":
            return (pathSummary(args), args["content"].string?.count ?? 0)
        case "edit":
            return (pathSummary(args), editPayloadChars(args))
        case "generate_image":
            return (promptSummary(args), 0)
        case "web_search":
            return (args["query"].string ?? "…", 0)
        case "web_fetch":
            return (args["url"].string ?? "…", 0)
        case "browser":
            return (browserSummary(args), 0)
        case "computer":
            let count = args["actions"].array.count
            let action = args["action"].string ?? args["type"].string
            if count > 0 { return ("\(count) desktop actions", 0) }
            return (action ?? "desktop action", 0)
        case "find":
            return (findSummary(args), 0)
        case "grep":
            return (grepSummary(args), 0)
        default:
            return (legacySummary(name: name, args: args), 0)
        }
    }

    /// Summarize when args arrive as a JSON object string (subagent log `item.text`).
    static func summarize(name: String, argsJSON: String) -> (summary: String, payloadChars: Int) {
        let trimmed = argsJSON.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return ("…", 0)
        }
        if let data = trimmed.data(using: .utf8), let j = J.parse(data), j.dict != nil {
            return summarize(name: name, args: j)
        }
        // find always renders a readable `<pattern> in <path>` summary (pattern
        // defaults to `*`) and never echoes raw JSON braces — even for malformed,
        // truncated, or doubly-escaped input. find args are often embedded in
        // activity logs as a JSON string, so unescape lives inside find's own scrape
        // path; other tools keep their prior behavior (no find-specific rescrape).
        if name == "find" {
            return (findScrapedSummary(from: trimmed), 0)
        }
        if name == "grep" {
            return (grepScrapedSummary(from: trimmed), 0)
        }
        // Subagent bridge truncates args (edit/write → invalid JSON). Scrape known fields.
        if let scraped = scrapeSummary(name: name, from: trimmed) {
            return (scraped, 0)
        }
        // Already a plain summary, or truncated non-JSON — never echo braces-heavy dumps as-is if huge.
        if trimmed.contains("{"), trimmed.count > 120 {
            return (String(trimmed.prefix(120)) + "…", 0)
        }
        return (trimmed, 0)
    }

    /// Best-effort field scrape from truncated / invalid tool-arg JSON.
    private static func scrapeSummary(name: String, from text: String) -> String? {
        switch name {
        case "edit", "write", "read", "ls":
            return scrapeJSONString(key: "path", from: text)
                ?? scrapeJSONString(key: "file_path", from: text)
        case "bash", "shell":
            guard let cmd = scrapeJSONString(key: "command", from: text) else { return nil }
            return cmd.count > 120 ? String(cmd.prefix(120)) + "…" : cmd
        case "web_search":
            return scrapeJSONString(key: "query", from: text)
        case "web_fetch":
            return scrapeJSONString(key: "url", from: text)
        case "generate_image":
            guard let prompt = scrapeJSONString(key: "prompt", from: text) else { return nil }
            return prompt.count > 80 ? String(prompt.prefix(80)) + "…" : prompt
        default:
            return scrapeJSONString(key: "path", from: text)
                ?? scrapeJSONString(key: "file_path", from: text)
                ?? scrapeJSONString(key: "command", from: text)
        }
    }

    /// Extract `"key":"…"` value; tolerates truncated trailing content / missing close quote.
    private static func scrapeJSONString(key: String, from text: String) -> String? {
        let needle = "\"\(key)\""
        guard let keyRange = text.range(of: needle) else { return nil }
        var i = keyRange.upperBound
        while i < text.endIndex, text[i].isWhitespace { i = text.index(after: i) }
        guard i < text.endIndex, text[i] == ":" else { return nil }
        i = text.index(after: i)
        while i < text.endIndex, text[i].isWhitespace { i = text.index(after: i) }
        guard i < text.endIndex, text[i] == "\"" else { return nil }
        i = text.index(after: i)
        var result = ""
        while i < text.endIndex {
            let c = text[i]
            if c == "\\" {
                let next = text.index(after: i)
                guard next < text.endIndex else { break }
                result.append(text[next])
                i = text.index(after: next)
                continue
            }
            if c == "\"" { break }
            result.append(c)
            i = text.index(after: i)
        }
        return result.isEmpty ? nil : result
    }

    /// Subagent `activity` is often `toolName {json…}`. Return human summary (no JSON dump).
    static func summarizeActivity(_ activity: String) -> String {
        let trimmed = activity.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        guard let space = trimmed.firstIndex(of: " ") else { return trimmed }
        let name = String(trimmed[..<space])
        let rest = String(trimmed[trimmed.index(after: space)...])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard rest.hasPrefix("{") else {
            return trimmed.count > 160 ? String(trimmed.prefix(160)) + "…" : trimmed
        }
        return summarize(name: name, argsJSON: rest).summary
    }

    /// `browser` is one tool with an `action` discriminator; lead the header with the action
    /// so the card reads `navigate http://localhost:3000` rather than a JSON dump.
    private static func browserSummary(_ args: J) -> String {
        let action = args["action"].string ?? "…"
        let detail = args["url"].string ?? args["js"].string ?? args["mode"].string ?? ""
        return detail.isEmpty ? action : "\(action) \(detail)"
    }

    private static func promptSummary(_ args: J) -> String {
        let raw = args["prompt"].string?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !raw.isEmpty else { return "…" }
        if raw.count <= 80 { return raw }
        return String(raw.prefix(80)) + "…"
    }

    private static func pathSummary(_ args: J) -> String {
        if let path = args["path"].string, !path.isEmpty { return path }
        if let path = args["file_path"].string, !path.isEmpty { return path }
        return "…"
    }

    /// `find` → `<pattern> in <path>`; a missing/empty pattern collapses to `*`.
    private static func findSummary(_ args: J) -> String {
        let pattern: String
        if let p = args["pattern"].string, !p.isEmpty {
            pattern = p
        } else {
            pattern = "*"
        }
        if let path = args["path"].string, !path.isEmpty {
            return "\(pattern) in \(path)"
        }
        return pattern
    }

    /// `grep` → `/<pattern>/ in <path>`; a missing/empty pattern collapses to `…`.
    private static func grepSummary(_ args: J) -> String {
        let pattern: String
        if let p = args["pattern"].string, !p.isEmpty {
            pattern = p
        } else {
            pattern = "…"
        }
        if let path = args["path"].string, !path.isEmpty {
            return "/\(pattern)/ in \(path)"
        }
        return "/\(pattern)/"
    }

    /// find scrape that never fails: pattern defaults to `*` and a scraped path
    /// is appended when present. Doubly-escaped activity-log args are unescaped
    /// first so they still scrape. Used for malformed/truncated find args so the
    /// summary never exposes raw braces.
    private static func findScrapedSummary(from text: String) -> String {
        var pattern = scrapeJSONString(key: "pattern", from: text)
        var path = scrapeJSONString(key: "path", from: text)
        if pattern == nil, path == nil, text.contains("\\") {
            let unescaped = unescapeJSONString(text)
            if unescaped != text {
                pattern = scrapeJSONString(key: "pattern", from: unescaped)
                path = scrapeJSONString(key: "path", from: unescaped)
            }
        }
        let patternValue = (pattern?.isEmpty ?? true) ? "*" : pattern!
        if let path = path, !path.isEmpty {
            return "\(patternValue) in \(path)"
        }
        return patternValue
    }

    /// grep scrape that never fails: pattern defaults to `…` and a scraped path
    /// is appended when present. Its unescape fallback is deliberately grep-scoped
    /// so malformed args for other tools retain their existing behavior.
    private static func grepScrapedSummary(from text: String) -> String {
        var pattern = scrapeJSONString(key: "pattern", from: text)
        var path = scrapeJSONString(key: "path", from: text)
        if pattern == nil, path == nil, text.contains("\\") {
            let unescaped = unescapeJSONString(text)
            if unescaped != text {
                pattern = scrapeJSONString(key: "pattern", from: unescaped)
                path = scrapeJSONString(key: "path", from: unescaped)
            }
        }
        let patternValue = (pattern?.isEmpty ?? true) ? "…" : pattern!
        if let path = path, !path.isEmpty {
            return "/\(patternValue)/ in \(path)"
        }
        return "/\(patternValue)/"
    }

    /// Undo common JSON string escapes (`\"` → `"`, `\\` → `\`) so doubly-escaped
    /// tool-arg strings (embedded in an activity log) can be scraped like normal JSON.
    private static func unescapeJSONString(_ s: String) -> String {
        var out = ""
        out.reserveCapacity(s.count)
        var i = s.startIndex
        while i < s.endIndex {
            let c = s[i]
            if c == "\\", s.index(after: i) < s.endIndex {
                let next = s.index(after: i)
                let d = s[next]
                if d == "\"" || d == "\\" {
                    out.append(d)
                    i = s.index(after: next)
                    continue
                }
            }
            out.append(c)
            i = s.index(after: i)
        }
        return out
    }

    private static func editPayloadChars(_ args: J) -> Int {
        let edits = args["edits"].array
        if !edits.isEmpty {
            return edits.reduce(0) { $0 + ($1["newText"].string?.count ?? 0) }
        }
        return args["newText"].string?.count ?? 0
    }

    private static func legacySummary(name: String, args: J) -> String {
        if let cmd = args["command"].string { return cmd }
        if let path = args["path"].string { return path }
        if let path = args["file_path"].string { return path }
        let compact = args.compactJSON
        return compact.count > 120 ? String(compact.prefix(120)) + "…" : compact
    }
}

struct ImageBlock: Identifiable, Equatable {
    let id: String
    let data: Data
    let mimeType: String
    /// On-disk path when known (attachments, media generation, RPC path/filePath).
    var path: String? = nil

    /// Identity comparison — deliberately **not** byte-for-byte.
    ///
    /// `MessageRow` is `Equatable` so SwiftUI can skip unchanged rows, which means
    /// this `==` runs for every image in the transcript on every diff pass — once per
    /// streaming chunk, and again on every layout-triggered re-evaluation. Synthesized
    /// equality compares `data` byte by byte, so a session holding a few multi-megabyte
    /// images burned hundreds of MB/s of `memcmp` on the main thread purely to conclude
    /// that nothing had changed. An image's bytes never change under a fixed id, so
    /// id + size + type + path is both O(1) and sufficient.
    static func == (lhs: ImageBlock, rhs: ImageBlock) -> Bool {
        lhs.id == rhs.id
            && lhs.data.count == rhs.data.count
            && lhs.mimeType == rhs.mimeType
            && lhs.path == rhs.path
    }
}

struct VideoBlock: Identifiable, Equatable {
    let id: String
    let path: String
    let remoteURL: String?
}

enum ChatBlock: Equatable {
    case text(String)
    case thinking(String)
    case toolCall(ToolCallBlock)
    case image(ImageBlock)
    case video(VideoBlock)
}

struct ChatItem: Identifiable, Equatable {
    let id: String
    let role: String // user / assistant / system
    var blocks: [ChatBlock]
    var entryId: String? = nil
    /// App-only bubble with no corresponding pi session entry (for example media generation).
    var isLocalOnly = false
}

struct ToolRun: Equatable {
    var isRunning = false
    var isError = false
    var output = ""
    var images: [ImageBlock] = []
}

/// Pure merge of `get_session_stats` / `contextUsage` into current context fields.
/// Distinguishes missing keys from explicit JSON null so compaction cannot leave a stale percent.
enum SessionStatsMerge {
    struct Context: Equatable {
        var tokens: Int?
        var window: Int?
        var percent: Double?
    }

    /// Apply `data["contextUsage"]` (or a usage object) onto `current`.
    /// - If the entire usage value is absent/null: return `current` unchanged.
    /// - tokens/percent: update only when the key is present; JSON null clears the field.
    /// - percent missing (key absent) but tokens+window known: derive percent.
    static func apply(contextUsage usage: J, to current: Context) -> Context {
        // Absent or JSON null usage → keep previous tokens/percent/window.
        guard usage.exists, let dict = usage.dict else { return current }

        var next = current

        if dict.keys.contains("tokens") {
            next.tokens = usage["tokens"].int
        }
        if let w = usage["contextWindow"].int {
            next.window = w
        }

        if dict.keys.contains("percent") {
            // Present: number sets it; explicit null clears (do not keep stale %).
            next.percent = usage["percent"].double
        } else if let t = next.tokens, let w = next.window, w > 0 {
            // Percent omitted entirely → derive when possible.
            next.percent = Double(t) / Double(w) * 100
        }
        // else: percent key missing and cannot derive → leave previous percent

        return next
    }
}

/// Offline result of converting `get_messages` history (safe to build off the main thread).
struct InitialTranscriptBuild: Equatable {
    var items: [ChatItem]
    var toolRuns: [String: ToolRun]
    var itemCounter: Int
    var skipNextAssistantIngest: Bool
}

struct InitialTranscriptReconciliation: Equatable {
    var items: [ChatItem]
    var toolRuns: [String: ToolRun]
    var itemCounter: Int
    var appendedLiveItemCount: Int
}

enum InitialTranscriptReconciler {
    /// Replace an offline preview with authoritative history while preserving app-only/user
    /// bubbles appended after the preview was published.
    static func reconcile(
        authoritative: InitialTranscriptBuild,
        currentItems: [ChatItem],
        currentToolRuns: [String: ToolRun],
        currentItemCounter: Int,
        previewItemCount: Int,
        previewToolRunIDs: Set<String>
    ) -> InitialTranscriptReconciliation {
        let previewCount = min(max(0, previewItemCount), currentItems.count)
        let extras = Array(currentItems.dropFirst(previewCount))
        var counter = max(currentItemCounter, authoritative.itemCounter)
        let rebasedExtras = extras.map { item in
            counter += 1
            return ChatItem(
                id: "item-\(counter)",
                role: item.role,
                blocks: item.blocks,
                entryId: item.entryId,
                isLocalOnly: item.isLocalOnly
            )
        }
        var mergedRuns = authoritative.toolRuns
        for (toolCallID, run) in currentToolRuns where !previewToolRunIDs.contains(toolCallID) {
            mergedRuns[toolCallID] = run
        }
        return InitialTranscriptReconciliation(
            items: authoritative.items + rebasedExtras,
            toolRuns: mergedRuns,
            itemCounter: counter,
            appendedLiveItemCount: rebasedExtras.count
        )
    }
}

/// One live pi RPC session bound to a project directory.
/// Published state is mutated on the main thread (PiProcess delivers callbacks there).
/// Heavy initial transcript conversion (image disk/base64) may run off-main before a single assign.
final class ChatSession: ObservableObject, Identifiable {
    @Published private(set) var id: String
    /// Immutable capability used by bridge extensions spawned with this process.
    /// Unlike the open-session key, this survives edit-fork file rebinding.
    package let bridgeRoutingKey = BridgeCapabilityToken.generate()
    /// Separate desktop-write capability. It is mounted only in the top-level
    /// computer extension and forwarded only to dispatched Pi subagent processes.
    package let computerRoutingKey = BridgeCapabilityToken.generate()
    let projectURL: URL

    /// didSet 版本计数：任何 transcript 写入（append / 整体替换 / 元素修改）都会 bump，
    /// TranscriptPlanner 以此判断是否重算布局。宁滥勿缺——不确定的修改路径走属性写入即自动覆盖。
    @Published var transcript: [ChatItem] = [] {
        didSet { transcriptVersion &+= 1 }
    }
    /// 随 transcript 每次写入单调递增（T6 布局记忆化 key 的一部分）。非 @Published：
    /// transcript 本身的 @Published 已负责触发刷新。
    private(set) var transcriptVersion: UInt64 = 0
    /// T6 transcript 布局记忆化（planTranscript 结果缓存，body 里只读缓存）。
    let transcriptPlanner = TranscriptPlanner()
    @Published var streamingItem: ChatItem?
    @Published var toolRuns: [String: ToolRun] = [:]
    /// Monotonic counter bumped when toolRuns actually changes (UI watches this instead of scanning outputs).
    @Published private(set) var toolOutputVersion: UInt64 = 0
    @Published var isStreaming = false
    /// True between the user clicking Stop and the turn actually settling.
    /// Drives optimistic 'stopping…' UI so one click is visibly acknowledged.
    @Published var isStopping = false
    @Published var model: ModelInfo?
    @Published var availableModels: [ModelInfo] = []
    @Published var thinkingLevel = "off"
    @Published var thinkingLevels: [String] = ["off"]
    @Published var cost: Double = 0
    /// Context tokens currently used (nil after compaction until next usage report).
    @Published var contextTokens: Int?
    /// Model context window size in tokens.
    @Published var contextWindow: Int?
    @Published var contextPercent: Double?
    @Published private(set) var lastTurnUsage: TokenLedger.UsageSnapshot?
    @Published private(set) var sessionCacheRead: Int = 0
    @Published private(set) var sessionCacheWrite: Int = 0
    /// A successful live stats response owns its corresponding restored fields,
    /// regardless of whether its asynchronous ledger read completes before or after it.
    private var hasLiveSessionCost = false
    private var hasLiveSessionContext = false
    /// Account credit usage 0…100 of the shown window (nil when unavailable).
    @Published var quotaPercent: Double?
    /// Compact period label of the shown window: 周 / 5h / 月 / 额.
    @Published var quotaPeriodLabel: String?
    /// Tooltip for quota pill: 周额度 / 5小时额度 / 额度.
    @Published var quotaPeriodHelp: String?
    /// Which provider backs the quota pill (nil = none shown).
    @Published private(set) var quotaProvider: QuotaProvider?
    /// All windows the current provider reports (popover lists these).
    @Published private(set) var quotaWindows: [QuotaWindow] = []
    /// id of the window currently shown in the capsule (popover checkmark).
    @Published private(set) var quotaSelectedWindowId: String?
    /// When the current billing window resets (popover detail).
    @Published var quotaResetsAt: Date?
    @Published var sessionName: String?
    @Published var sessionFile: String?
    @Published var lastError: String?
    @Published var processAlive = true
    /// True from spawn until the first `get_messages` load settles. Drives the
    /// "正在启动会话…" placeholder so a new/resuming session shows progress instead
    /// of a blank pane while pi boots and the initial transcript is built off-main.
    @Published private(set) var isInitializing = true
    /// Sidebar green badge: successful settle not yet acknowledged by selecting this session.
    @Published var hasUnseenCompletion = false
    /// Sidebar red badge: turn was cut off (crash / force-quit) and not yet acknowledged.
    @Published var hasUnseenInterruption = false
    /// Local follow-up queue mirror for SwiftUI (busy Enter enqueues here).
    @Published private(set) var messageQueue: [QueuedMessage] = []
    /// In-memory composer draft (per session; not persisted).
    @Published var draftText: String = ""
    @Published var draftImages: [DraftImage] = []
    /// Large ⌘V bodies collapsed to `[paste #N …]` markers in `draftText` (pi TUI–style).
    private(set) var draftPastes: [Int: String] = [:]
    private var pasteCounter = 0
    /// Local transcript item currently shown in the inline user-message editor.
    @Published var editingItemId: String?
    /// + menu mode: chat vs Grok Imagine image/video generation.
    @Published var composerMode: ComposerMode = .chat
    @Published var imageMediaModel: MediaModel = MediaModelCatalog.defaultModel(for: .generateImage)!
    @Published var videoMediaModel: MediaModel = MediaModelCatalog.defaultModel(for: .generateVideo)!
    @Published var mediaBusy = false
    @Published var mediaStatus: String?

    /// User manually renamed the session — stops auto title.
    @Published private(set) var userRenamedTitle = false
    /// Non-nil when auto title text changed (UI typewriter trigger).
    @Published private(set) var titleAnimationToken: UUID? = nil
    /// Non-placeholder `sessionName` else `新会话`.
    @Published private(set) var displayTitle: String = SessionTitleLogic.placeholderName
    /// Opened with `--session` path (historical disk resume).
    private let resumedFromDisk: Bool
    /// True between `agent_start` and `agent_settled` (for in-flight persistence).
    /// Background subagents after settle are tracked separately via `subagents.runningCount`.
    private var agentTurnActive = false
    /// Notifies AppStore to persist / clear interrupted-path badges.
    var onInFlightChange: ((String, Bool) -> Void)?
    /// False after resuming a disk session that already has a real name.
    private var autoTitleEnabled = true
    /// First `applyState` applied (used once for resume naming policy).
    private var didApplyInitialState = false
    /// At most one side-channel LLM title request per live session (first user message).
    private var didRequestLLMTitle = false
    /// In-flight side-channel title Task; cancelled on abort/shutdown.
    private var titleLLMTask: Task<Void, Never>?

    /// Streaming or prompt dispatch in flight (first send / queue drain until agent_start).
    /// Depends on @Published isStreaming + isSendingFromQueue so observers refresh.
    var isWorking: Bool { isStreaming || isSendingFromQueue }

    /// Provided by AppStore so settle can skip green when this session is already selected.
    var isSelectedCheck: (() -> Bool)?

    /// Server-side slash commands from `get_commands` (extension / prompt / skill).
    @Published var availableCommands: [SlashCommand] = []

    /// Injected by AppStore for `/new`.
    var onRequestNewSession: (() -> Void)?
    /// Injected by AppStore for `/quit`.
    var onRequestClose: (() -> Void)?

    /// 右侧面板：内置浏览器 / subagent 树 / 文档预览
    enum RightPanel: Equatable { case web, agents, document }
    @Published var rightPanel: RightPanel?

    /// Per-session transcript window (survives detail view reuse when switching sessions).
    @Published var transcriptVisibleCount: Int = 150
    /// Per-session stick-to-bottom preference.
    @Published var pinTranscriptToBottom: Bool = true

    /// 内置浏览器，pi 的 browser_* 工具通过桥接服务驱动它
    lazy var webView = WebViewStore()

    /// 文档预览面板（⌘+点击聊天中的 md/txt 文档路径在此打开）
    lazy var documents = DocumentStore()

    /// pi 派出的 subagent 树（扩展通过桥接上报）
    let subagents = SubagentStore()

    var onSessionMetaChanged: (() -> Void)?
    /// Fired only when the user actually submits a prompt (not resume / name / settle).
    var onUserSubmitted: (() -> Void)?
    /// AppStore rekeys a resumed open session after edit-fork changes its backing file.
    var onSessionFileRebound: ((String, String) -> Void)?
    /// AppStore opens the cloned/forked file as a separate sidebar session.
    var onBranchedSessionReady: ((String) -> Void)?
    private var proc: PiProcess?
    private var itemCounter = 0
    private var queue = SessionMessageQueue()
    /// True from prompt dispatch until agent_start (or failure / process death).
    @Published private(set) var isSendingFromQueue = false
    /// Historical ghost title prompts in old session files (ingest skip only; never sent on main proc).
    package static let sessionTitleJobMarker = "[PipiUI internal — session title"
    /// T17: shared reader for `~/.pi/agent/.env` (provider API keys etc.),
    /// injected into every spawned pi process environment at session start.
    private static let dotEnvStore = EnvFileStore()

    /// Merge `.env` pairs as the base layer under PipiUI-internal keys:
    /// internal `PIPIUI_*` keys always win and can never be overridden by `.env`.
    static func mergedSpawnEnv(dotEnv: [String: String], internal internalEnv: [String: String]) -> [String: String] {
        var env = dotEnv
        env.merge(internalEnv) { _, new in new }
        return env
    }
    /// After skipping a historical ghost title user message on load/ingest, drop the following assistant turn.
    private var skipNextAssistantIngest = false
    // 流式更新节流：每个 token delta 都刷 UI 会卡，按 50ms 合并
    private var pendingStreamMessage: J?
    private var streamFlushScheduled = false
    // 工具输出分片同样节流：高频 tool_execution_update 直接刷 toolRuns 会拖垮布局
    private var pendingToolRuns: [String: ToolRun] = [:]
    private var toolRunFlushScheduled = false
    /// Per-provider quota monitor subscription (shared app-wide cache per provider).
    private var quotaObserverID: UUID?
    /// The monitor currently subscribed to (so model switches can unbind/rebind).
    private var currentQuotaMonitor: QuotaMonitor?

    /// Bumped when a new initial `get_messages` load starts; stale background builds are dropped.
    private var initialLoadGeneration: UInt64 = 0
    /// Bumped for each entry-id sync so an older RPC response cannot overwrite newer ids.
    private var entryIdSyncGeneration: UInt64 = 0
    /// True until the first `get_messages` transcript is applied (or the request settles empty/failed).
    /// Runtime assumption (verify in app): pi may emit agent/message/tool events before `get_messages`
    /// completes; those are deferred and replayed after the one-shot transcript assign so they are not wiped.
    private var awaitingInitialTranscript = false
    private var deferredInitialEvents: [J] = []
    private var cachedBranchMessages: [J] = []
    private var cachedLeafId: String?
    /// Exact app-generated prompts that must neither create nor revoke a human path grant.
    private var searchGrantSuppressedMessages: [String: Int] = [:]
    /// Offline preview state is replaced (not appended as optimistic live content) once
    /// authoritative get_messages completes.
    private var initialPreviewItemCount = 0
    private var initialPreviewToolRunIDs: Set<String> = []
    private var processStartCancelled = false

    init(id: String, projectURL: URL, sessionPath: String?,
         bridgePort: UInt16 = 0,
         webviewExtension: String? = nil,
         mediaExtension: String? = nil,
         gitExtension: String? = nil,
         reloadExtension: String? = nil,
         webSearchExtension: String? = nil,
         skillLoaderExtension: String? = nil,
         codexServerToolsExtension: String? = nil,
         claudeServerToolsExtension: String? = nil,
         computerUseExtension: String? = nil,
         subagentDir: String? = nil,
         agentsDir: String? = nil,
         philosophyExtension: String? = nil,
         blockedReason: String? = nil,
         initialTranscript: InitialTranscriptBuild? = nil) {
        self.id = id
        self.projectURL = projectURL
        self.resumedFromDisk = sessionPath != nil
        // A restarted/resumed session never inherits a stale external-search grant.
        SearchScopeExtension.resetTurnGrant(sessionKey: id, projectRoot: projectURL)
        // Worktree auto-merge target (successful subagents → merge into session project root).
        subagents.bindMainProject(projectURL)
        // Attribute per-turn usage events to this session in the token ledger.
        subagents.sessionKey = id
        subagents.resolveContextWindow = { [weak self] modelId in
            guard let modelId, !modelId.isEmpty else { return nil }
            if let m = self?.availableModels.first(where: { $0.id == modelId }),
               let w = m.contextWindow, w > 0 {
                return w
            }
            // Allow bare model id match when provider prefix is omitted.
            if let m = self?.availableModels.first(where: { $0.modelId == modelId }),
               let w = m.contextWindow, w > 0 {
                return w
            }
            return nil
        }
        subagents.onWorktreeMergeFailed = { [weak self] agent, error in
            guard let self else { return }
            let text = WorktreeMergeFailedMessage.format(agent: agent, error: error)
            DispatchQueue.main.async {
                self.sendAppGeneratedPrompt(text)
            }
        }
        subagents.onPostMergeVerifyFailed = { [weak self] agent, failure, mainDirty in
            guard let self else { return }
            let text = PostMergeVerifyFailedMessage.format(
                agent: agent, failure: failure, mainDirty: mainDirty)
            DispatchQueue.main.async {
                self.sendAppGeneratedPrompt(text)
            }
        }
        // Keep crash badge while background subagents run after main agent_settled.
        subagents.onRunningCountMayHaveChanged = { [weak self] in
            self?.syncInFlightMark()
        }
        if let sessionPath, InterruptedSessionStore.contains(sessionPath) {
            hasUnseenInterruption = true
        }
        if let initialTranscript {
            transcript = initialTranscript.items
            toolRuns = initialTranscript.toolRuns
            itemCounter = initialTranscript.itemCounter
            skipNextAssistantIngest = initialTranscript.skipNextAssistantIngest
            initialPreviewItemCount = initialTranscript.items.count
            initialPreviewToolRunIDs = Set(initialTranscript.toolRuns.keys)
            // History can render while model/command/composer readiness continues.
            isInitializing = false
        }

        // 已知会必然崩的启动条件（例如扩展撞名）就别 spawn 了：
        // 让用户只看到那条能一键修的提示，而不是再叠一条 pi 崩溃日志
        if let blockedReason {
            lastError = blockedReason
            processAlive = false
            isInitializing = false
            bindQuotaMonitor()
            return
        }

        let computerCaptureDescriptor: ComputerCaptureDescriptor? =
            ComputerUseSettings.isEnabled()
                ? try? ComputerUseSettings.captureDescriptor()
                : nil
        var args: [String] = []
        if let sessionPath { args += ["--session", sessionPath] }
        // Philosophy normally arrives through pi's own package list, so every frontend and every
        // dispatched worker gets it. This `-e` is only the fallback for when that registration
        // is missing; it is deliberately NOT `--append-system-prompt`, which would suppress
        // pi's discovery of the user's own ~/.pi/agent/APPEND_SYSTEM.md entirely.
        if let philosophyExtension { args += ["-e", philosophyExtension] }
        // 对话内 generate_image / git / reload：不依赖 bridge
        if let mediaExtension { args += ["-e", mediaExtension] }
        if let gitExtension { args += ["-e", gitExtension] }
        if let reloadExtension { args += ["-e", reloadExtension] }
        if let webSearchExtension { args += ["-e", webSearchExtension] }
        // Main session only: dispatched workers stay fully skill-free.
        if let skillLoaderExtension { args += ["-e", skillLoaderExtension] }
        if let searchScopeExtension = PiPlugin.searchScopeExtensionPath {
            args += ["-e", searchScopeExtension]
        }
        if let codexServerToolsExtension { args += ["-e", codexServerToolsExtension] }
        if let claudeServerToolsExtension { args += ["-e", claudeServerToolsExtension] }
        // Independent opt-in: mount exactly one selected strategy. External selection
        // suppresses the built-in strategy, so Pi never sees duplicate desktop tools.
        if computerCaptureDescriptor != nil, let computerUseExtension {
            args += ["-e", computerUseExtension]
        }
        // Settings → 工具开关：禁用项走 pi --exclude-tools（会话重启后生效）
        args += ToolSkillSettings.excludeToolsCLIArgs()
        var extraEnv: [String: String] = [:]
        extraEnv["PIPIUI_WEBSEARCH_CONFIG_FILE"] = WebSearchSettings.configFileURL().path
        extraEnv["PIPIUI_SEARCH_GRANT_FILE"] =
            SearchScopeExtension.grantFileURL(sessionKey: id).path
        if let searchScopeExtension = PiPlugin.searchScopeExtensionPath {
            // Nested subagent Pi processes inherit this and pass the same guard via -e.
            extraEnv["PIPIUI_SEARCH_SCOPE_EXT"] = searchScopeExtension
        }
        // App 自有插件通过 -e 加载：webview 工具 + 补丁版 subagent（覆盖自动发现的官方版）
        if bridgePort > 0 {
            if let webviewExtension { args += ["-e", webviewExtension] }
            if let subagentDir {
                args += ["-e", subagentDir]
                // Nested subagent pi processes re-read this to pass `-e` again (#3).
                extraEnv["PIPIUI_SUBAGENT_EXT"] = subagentDir
            }
            extraEnv["PIPIUI_BRIDGE_PORT"] = String(bridgePort)
            extraEnv["PIPIUI_SESSION_KEY"] = bridgeRoutingKey
            if let descriptor = computerCaptureDescriptor,
               computerUseExtension != nil {
                extraEnv["PIPIUI_COMPUTER_EXT"] = computerUseExtension
                extraEnv["PIPIUI_COMPUTER_CAPABILITY"] = computerRoutingKey
                extraEnv["PIPIUI_COMPUTER_RUNTIME_PROTOCOL"] =
                    String(ComputerRuntimeContract.version)
                // The built-in Anthropic provider hook needs synchronous typed-tool
                // dimensions. Runtime v1 negotiation remains authoritative.
                extraEnv["PIPIUI_COMPUTER_DISPLAY_ID"] =
                    String(descriptor.displayID)
                extraEnv["PIPIUI_COMPUTER_WIDTH"] =
                    String(descriptor.outputSize.width)
                extraEnv["PIPIUI_COMPUTER_HEIGHT"] =
                    String(descriptor.outputSize.height)
            }
            // Authoritative session root inherited by nested processes. Management
            // roles such as secretary must never mistake a worker worktree for main.
            extraEnv["PIPIUI_MAIN_CWD"] = projectURL.path
            // 补丁版 subagent 从 App 自有目录读 agent 定义，不碰 ~/.pi/agent/agents
            if let agentsDir { extraEnv["PIPIUI_AGENTS_DIR"] = agentsDir }
            // Subagent 模型设置（热读 JSON）+ 主会话模型（跟随主 Agent = 底栏/composer）
            extraEnv["PIPIUI_SUBAGENT_MODELS_FILE"] =
                SubagentModelSettings.overridesFileURL().path
            extraEnv["PIPIUI_MAIN_MODEL_FILE"] =
                SubagentModelSettings.mainModelFileURL().path
            let mainId = model?.id ?? SubagentModelSettings.readMainModel()
            if let mid = mainId, !mid.isEmpty {
                extraEnv["PIPIUI_MAIN_MODEL"] = mid
            }
        }
        // T17: ~/.pi/agent/.env 注入（GUI app 从 Finder 启动没有 shell 环境）。
        // .env 在底层，PIPIUI_* 内部键绝不被 .env 覆盖；不得在日志打印这些键值。
        let spawnEnv = Self.mergedSpawnEnv(dotEnv: Self.dotEnvStore.all(), internal: extraEnv)
        if initialTranscript != nil {
            // Let AppStore publish the cached transcript before process construction starts.
            DispatchQueue.main.async { [weak self] in
                self?.startProcess(arguments: args, environment: spawnEnv)
            }
        } else {
            startProcess(arguments: args, environment: spawnEnv)
        }
    }

    private func startProcess(arguments: [String], environment: [String: String]) {
        guard !processStartCancelled, proc == nil else { return }
        guard let proc = PiProcess(cwd: projectURL, arguments: arguments, extraEnv: environment) else {
            lastError = "找不到 pi 可执行文件（试过 ~/.npm-global/bin、/opt/homebrew/bin 等）"
            processAlive = false
            isInitializing = false
            return
        }
        self.proc = proc
        proc.onEvent = { [weak self] event in self?.handleEvent(event) }
        proc.onExit = { [weak self] code, stderr in
            guard let self else { return }
            // Main turn OR background subagents waiting → red "已中断" after unexpected quit.
            let cutOff = InterruptedSessionStore.shouldPersistMark(
                agentTurnActive: self.agentTurnActive,
                isWorking: self.isWorking,
                runningSubagents: self.subagents.runningCount
            )
            self.processAlive = false
            self.isStreaming = false
            self.isStopping = false
            self.isSendingFromQueue = false
            // Exit before the first transcript arrives must not leave the spinner up.
            self.isInitializing = false
            self.titleLLMTask?.cancel()
            self.titleLLMTask = nil
            ComputerCoordinator.shared.release(
                sessionKey: self.bridgeRoutingKey,
                revokeConsent: true
            )
            if cutOff {
                self.persistInFlightMark()
                self.hasUnseenInterruption = true
            }
            if code != 0 {
                self.lastError = "pi 进程退出 (code \(code))：\(stderr.suffix(300))"
            }
        }
        loadInitialState()
        bindQuotaMonitor()
    }

    deinit {
        if let quotaObserverID, let monitor = currentQuotaMonitor {
            let id = quotaObserverID
            let mon = monitor
            // deinit may leave the main thread; hop back before touching the monitor.
            DispatchQueue.main.async {
                mon.removeObserver(id)
            }
        }
    }

    /// Bind the quota monitor matching the session's current model provider, if any.
    /// Called on init, on first `applyState`, and on `setModel`. Idempotent: if
    /// already bound to the same provider, it does nothing — this avoids a clear +
    /// re-show flicker when `setModel` then `applyState` both call it in quick
    /// succession for the same new model.
    private func bindQuotaMonitor() {
        let provider = model?.quotaProvider
        // Already bound to this provider → no-op (preserve selection, no churn).
        if quotaProvider == provider, currentQuotaMonitor != nil || provider == nil {
            if provider == nil { applyQuotaSnapshot(nil) }
            return
        }
        unbindQuotaMonitor()
        guard let provider else {
            quotaProvider = nil
            quotaWindows = []
            applyQuotaSnapshot(nil)
            return
        }
        let monitor = provider.monitor
        currentQuotaMonitor = monitor
        quotaProvider = provider
        // Restore the user's previously-picked window for this provider. Re-read on
        // every dispatch (not captured once) so selectQuotaWindow's write is honored
        // by the next poll instead of being clobbered by a stale closure value.
        quotaObserverID = monitor.observe { [weak self, provider] snap in
            guard let self else { return }
            let persisted = LayoutPersistence.quotaSelectedWindow(provider: provider)
            self.applyQuotaSnapshot(snap?.copy(selectedWindowId: persisted ?? snap?.selectedWindowId))
        }
    }

    /// Map a snapshot to the published capsule fields, honoring the selected window.
    private func applyQuotaSnapshot(_ snap: QuotaSnapshot?) {
        quotaWindows = snap?.windows ?? []
        let shown = snap?.capsule
        quotaSelectedWindowId = shown?.id
        quotaPercent = shown?.usedPercent
        quotaPeriodLabel = shown?.label
        quotaPeriodHelp = shown?.title
        quotaResetsAt = shown?.resetsAt
    }

    /// User picked a window in the popover → persist per provider + refresh capsule.
    func selectQuotaWindow(id: String) {
        guard let provider = quotaProvider else { return }
        LayoutPersistence.setQuotaSelectedWindow(id, provider: provider)
        // Apply against the live monitor snapshot.
        let snap = currentQuotaMonitor?.snapshot?.copy(selectedWindowId: id)
        applyQuotaSnapshot(snap)
    }

    private func unbindQuotaMonitor() {
        if let quotaObserverID, let monitor = currentQuotaMonitor {
            monitor.removeObserver(quotaObserverID)
        }
        quotaObserverID = nil
        currentQuotaMonitor = nil
        // Clear immediately so a previous provider's value never flashes while the
        // new provider's snapshot is in flight.
        applyQuotaSnapshot(nil)
    }

    private func nextItemId() -> String {
        itemCounter += 1
        return "item-\(itemCounter)"
    }

    // MARK: - Initial load

    private func loadInitialState() {
        proc?.request(["type": "get_state"]) { [weak self] resp in
            self?.applyState(resp["data"])
        }
        proc?.request(["type": "get_available_models"]) { [weak self] resp in
            self?.availableModels = resp["data"]["models"].array.compactMap { m in
                guard let row = m.dict else { return nil }
                return ModelInfo.parseModelListRow(row)
            }
        }
        refreshThinkingLevels()
        beginInitialMessagesLoad()
        refreshStats()
        // pi 的 get_session_stats 不含上一轮和累计缓存；从本地 TokenLedger 按 session id
        // 恢复完整 footer/popover 快照（off-main）。实时 RPC 回包仍优先于恢复值。
        rehydrateSessionUsage()
        proc?.request(["type": "get_commands"]) { [weak self] resp in
            guard let self else { return }
            // Failure/empty → leave availableCommands empty; builtins still work. No flash.
            self.availableCommands = SlashCommandParser.parseGetCommandsResponse(resp)
        }
    }

    /// Kick off `get_messages` → background `buildTranscript` → one main-thread assign.
    private func beginInitialMessagesLoad() {
        initialLoadGeneration &+= 1
        let generation = initialLoadGeneration
        awaitingInitialTranscript = true
        deferredInitialEvents.removeAll(keepingCapacity: true)

        guard proc != nil else {
            // No process (should not reach here on normal spawn path) — do not gate events forever.
            applyInitialTranscript(
                InitialTranscriptBuild(items: [], toolRuns: [:], itemCounter: 0, skipNextAssistantIngest: false),
                generation: generation
            )
            return
        }

        let requestedAt = DispatchTime.now()
        proc?.request(["type": "get_messages"]) { [weak self] resp in
            guard let self else { return }
            // Capture JSON messages on main (resp is only valid for this callback), build off-main.
            let messages = resp["data"]["messages"].array
            let success = resp["success"].bool ?? true
            let rpcMs = Double(DispatchTime.now().uptimeNanoseconds - requestedAt.uptimeNanoseconds) / 1_000_000
            Log.info("initial load: get_messages returned \(messages.count) msgs in \(Int(rpcMs))ms", category: .session)
            guard success else {
                self.finishInitialMessagesLoadWithoutReplacement(generation: generation)
                return
            }

            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let buildStart = DispatchTime.now()
                let built = Self.buildTranscript(from: messages)
                let buildMs = Double(DispatchTime.now().uptimeNanoseconds - buildStart.uptimeNanoseconds) / 1_000_000
                let imageCount = built.items.reduce(0) { $0 + Self.imageCount(of: $1) }
                Log.info(
                    "initial load: buildTranscript → \(built.items.count) items, \(imageCount) images in \(Int(buildMs))ms",
                    category: .session
                )
                DispatchQueue.main.async {
                    self?.applyInitialTranscript(built, generation: generation)
                }
            }
        }
    }

    /// A failed get_messages response is not authoritative. Keep the validated preview and
    /// optimistic bubbles, then replay any live events that arrived during the request.
    private func finishInitialMessagesLoadWithoutReplacement(generation: UInt64) {
        guard generation == initialLoadGeneration, awaitingInitialTranscript else { return }
        initialPreviewItemCount = 0
        initialPreviewToolRunIDs.removeAll(keepingCapacity: false)
        awaitingInitialTranscript = false
        isInitializing = false
        let deferred = deferredInitialEvents
        deferredInitialEvents.removeAll(keepingCapacity: false)
        for event in deferred {
            handleEvent(event)
        }
        syncEntryIds()
    }

    /// Apply a background-built history once; drop if generation is stale (session recycled / re-load).
    private func applyInitialTranscript(_ built: InitialTranscriptBuild, generation: UInt64) {
        guard generation == initialLoadGeneration else { return }
        guard awaitingInitialTranscript else { return }

        let reconciled = InitialTranscriptReconciler.reconcile(
            authoritative: built,
            currentItems: transcript,
            currentToolRuns: toolRuns,
            currentItemCounter: itemCounter,
            previewItemCount: initialPreviewItemCount,
            previewToolRunIDs: initialPreviewToolRunIDs
        )
        itemCounter = reconciled.itemCounter
        skipNextAssistantIngest = built.skipNextAssistantIngest
        toolRuns = reconciled.toolRuns
        if !built.toolRuns.isEmpty || reconciled.appendedLiveItemCount > 0 {
            toolOutputVersion &+= 1
        }

        // Single assignment — avoid per-message @Published churn.
        transcript = reconciled.items
        initialPreviewItemCount = 0
        initialPreviewToolRunIDs.removeAll(keepingCapacity: false)

        awaitingInitialTranscript = false
        isInitializing = false
        let deferred = deferredInitialEvents
        deferredInitialEvents.removeAll(keepingCapacity: false)
        for event in deferred {
            handleEvent(event)
        }
        syncEntryIds()
    }

    /// After transcript assign (initial or post-fork), fetch entries and stamp entryIds.
    private func syncEntryIds(completion: (() -> Void)? = nil) {
        entryIdSyncGeneration &+= 1
        let generation = entryIdSyncGeneration
        proc?.request(["type": "get_entries"]) { [weak self] resp in
            guard let self else { return }
            guard generation == self.entryIdSyncGeneration else {
                completion?()
                return
            }
            guard resp["success"].bool == true else {
                completion?()
                return
            }
            let entries = resp["data"]["entries"].array
            let leafId = resp["data"]["leafId"].string
            let branch = MessageActions.activeBranchMessages(entries: entries, leafId: leafId)
            self.transcript = MessageActions.applyingEntryIds(
                items: self.transcript,
                branchMessages: branch
            )
            self.cachedBranchMessages = branch
            self.cachedLeafId = leafId
            completion?()
        }
    }

    private func applyState(_ data: J) {
        if let pid = data["model"]["provider"].string, let mid = data["model"]["id"].string {
            model = ModelInfo(
                provider: pid,
                modelId: mid,
                name: data["model"]["name"].string ?? mid,
                contextWindow: data["model"]["contextWindow"].int
            )
            // Composer / bottom-bar model — source of truth for「跟随主 Agent」.
            if let id = model?.id {
                SubagentModelSettings.writeMainModel(id)
            }
            // Update window immediately from get_state model; keep existing tokens, re-derive %.
            if let w = data["model"]["contextWindow"].int, w > 0 {
                contextWindow = w
                if let t = contextTokens, w > 0 {
                    contextPercent = min(100.0, Double(t) / Double(w) * 100.0)
                }
            }
            // The first applyState reveals the model; bind the matching quota monitor
            // (idempotent if already bound to the same provider).
            bindQuotaMonitor()
        }
        thinkingLevel = data["thinkingLevel"].string ?? "off"
        // get_state 与 agent_start 可能交错：只在本地未处于工作态时才采用远端 isStreaming，
        // 避免把已开始的流式状态盖回 false（#14）。
        if !isWorking, let remoteStreaming = data["isStreaming"].bool {
            isStreaming = remoteStreaming
            if !remoteStreaming { isStopping = false }
        }
        // Prefer local non-placeholder over empty/stale get_state while optimistic auto-title is in flight.
        if let incoming = data["sessionName"].string {
            let local = sessionName
            let localReal = !SessionTitleLogic.isPlaceholderName(local)
            let incomingPlaceholder = SessionTitleLogic.isPlaceholderName(incoming)
            if incomingPlaceholder, localReal {
                // keep local
            } else if localReal,
                      incoming != local,
                      titleAnimationToken != nil {
                // keep optimistic auto title until server catches up
            } else {
                sessionName = incoming
            }
        }
        refreshDisplayTitle()
        if !didApplyInitialState {
            didApplyInitialState = true
            // Historical resume with a real name: never auto-title.
            if resumedFromDisk, !SessionTitleLogic.isPlaceholderName(sessionName) {
                autoTitleEnabled = false
            }
        }
        if let file = data["sessionFile"].string, file != sessionFile {
            sessionFile = file
            onSessionMetaChanged?()
            syncInFlightMark()
        }
        // 会话文件确定后挂载 subagent 树持久化（恢复历史 + 后续落盘）
        if let file = sessionFile {
            subagents.attachPersistence(sessionFile: file)
        }
    }

    private func refreshThinkingLevels() {
        proc?.request(["type": "get_available_thinking_levels"]) { [weak self] resp in
            let levels = resp["data"]["levels"].array.compactMap(\.string)
            self?.thinkingLevels = levels.isEmpty ? ["off"] : levels
        }
    }

    private func refreshStats() {
        proc?.request(["type": "get_session_stats"]) { [weak self] resp in
            guard let self, resp["success"].bool == true else { return }
            self.applySessionStats(resp["data"])
        }
    }

    /// Resume 时按 session id 恢复 ledger 中的主聊天 footer/popover 快照。
    /// Startup does not normally overlap a completed turn; live get_session_stats
    /// remains authoritative for cost/context even if its callback wins this race.
    private func rehydrateSessionUsage() {
        let sid = id
        DispatchQueue.global(qos: .utility).async {
            let usage = TokenUsageStats.sessionUsage(for: sid)
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.lastTurnUsage = usage.lastTurnUsage
                self.sessionCacheRead = usage.cacheRead
                self.sessionCacheWrite = usage.cacheWrite
                if !self.hasLiveSessionCost {
                    self.cost = usage.cost
                }
                if !self.hasLiveSessionContext, let tokens = usage.contextTokens {
                    self.contextTokens = tokens
                    if let window = self.contextWindow ?? self.model?.contextWindow, window > 0 {
                        self.contextWindow = window
                        self.contextPercent = Double(tokens) / Double(window) * 100
                    }
                }
            }
        }
    }

    /// Parse `get_session_stats` payload into published context/cost fields.
    private func applySessionStats(_ data: J) {
        if let liveCost = data["cost"].double {
            hasLiveSessionCost = true
            cost = liveCost
        }
        let contextUsage = data["contextUsage"]
        if contextUsage.exists, contextUsage.dict != nil {
            hasLiveSessionContext = true
            let merged = SessionStatsMerge.apply(
                contextUsage: contextUsage,
                to: .init(tokens: contextTokens, window: contextWindow, percent: contextPercent)
            )
            contextTokens = merged.tokens
            contextWindow = merged.window
            contextPercent = merged.percent
        }
    }

    /// Compact context line for footer /session flash.
    var contextStatusText: String? {
        TokenFormat.contextStatus(
            tokens: contextTokens,
            window: contextWindow,
            percent: contextPercent
        )
    }

    /// Record per-turn usage from an assistant `message_end` into the token ledger.
    /// `pi` emits `message.usage` (same shape subagents parse at `index.ts:1036`);
    /// if absent we silently skip — no telemetry is better than wrong telemetry.
    /// Turn index counts assistant messages in the transcript, which already includes
    /// the one just ingested by the caller.
    private func recordTurnUsage(for message: J) {
        let u = message["usage"]
        guard u["input"].int != nil || u["output"].int != nil else { return }
        let usage = TokenLedger.UsageSnapshot.from(u)
        lastTurnUsage = usage
        sessionCacheRead += usage.cacheRead
        sessionCacheWrite += usage.cacheWrite
        let model = message["model"].string ?? self.model?.id ?? "?"
        let turn = transcript.lazy.filter { $0.role == "assistant" }.count
        TokenLedger.shared.append(
            session: id,
            channel: "main",
            agentId: nil,
            agentName: nil,
            depth: 0,
            model: model,
            turn: turn,
            usage: usage,
            tools: TokenLedger.toolNames(from: message)
        )
        Log.info(
            "main turn \(turn) usage ↑\(usage.input) ↓\(usage.output) R\(usage.cacheRead) W\(usage.cacheWrite) $\(String(format: "%.4f", usage.cost)) ctx:\(usage.contextTokens) — \(model)",
            category: .token
        )
    }

    // MARK: - Event handling

    private func handleEvent(_ e: J) {
        let type = e["type"].string ?? ""

        // Defer transcript/stream/tool mutations until initial history is applied once.
        // Assumption to runtime-verify: cold open can interleave agent_* / message_* / tool_*
        // with the get_messages response; replaying after assign preserves order vs wiping.
        if awaitingInitialTranscript {
            switch type {
            case "agent_start", "agent_settled",
                 "message_start", "message_update", "message_end",
                 "tool_execution_start", "tool_execution_update", "tool_execution_end",
                 "auto_retry_start", "auto_retry_end",
                 "compaction_start", "compaction_end":
                deferredInitialEvents.append(e)
                return
            default:
                break
            }
        }

        switch type {
        case "agent_start":
            isStreaming = true
            // Defensive: a stale stop flag must never bleed into the next turn.
            isStopping = false
            isSendingFromQueue = false
            lastError = nil
            agentTurnActive = true
            syncInFlightMark()
        case "agent_settled":
            isStreaming = false
            isStopping = false
            streamingItem = nil
            agentTurnActive = false
            // Do not clear while background subagents are still running.
            syncInFlightMark()
            hasUnseenInterruption = false
            refreshStats()
            syncEntryIds()
            drainQueueIfIdle()
            // Green badge when still idle after drain (no queued follow-up).
            if !isWorking && messageQueue.isEmpty {
                markUnseenCompletionAfterSuccessfulSettle()
            }
            proc?.request(["type": "get_state"]) { [weak self] resp in
                self?.applyState(resp["data"])
                self?.onSessionMetaChanged?()
            }
        case "message_start":
            if e["message"]["role"].string == "assistant" {
                streamingItem = Self.convert(message: e["message"], id: "streaming", allowDiskRead: false)
            }
        case "message_update":
            pendingStreamMessage = e["message"]
            scheduleStreamFlush()
        case "message_end":
            ingest(message: e["message"])
            if e["message"]["role"].string == "assistant" {
                pendingStreamMessage = nil
                streamingItem = nil
                recordTurnUsage(for: e["message"])
            }
        case "tool_execution_start":
            if let tid = e["toolCallId"].string {
                pendingToolRuns.removeValue(forKey: tid)
                toolRuns[tid] = ToolRun(isRunning: true)
                toolOutputVersion &+= 1
            }
        case "tool_execution_update":
            if let tid = e["toolCallId"].string {
                // Coalesce partial chunks; flush on main ~50ms (same idea as scheduleStreamFlush).
                var run = pendingToolRuns[tid] ?? toolRuns[tid] ?? ToolRun()
                run.isRunning = true
                run.output = Self.contentText(e["partialResult"]["content"])
                pendingToolRuns[tid] = run
                scheduleToolRunFlush()
            }
        case "tool_execution_end":
            if let tid = e["toolCallId"].string {
                pendingToolRuns.removeValue(forKey: tid)
                let content = e["result"]["content"]
                toolRuns[tid] = ToolRun(
                    isRunning: false,
                    isError: e["isError"].bool ?? false,
                    output: Self.contentText(content),
                    images: Self.contentImages(content, allowDiskRead: false)
                )
                toolOutputVersion &+= 1
                scheduleImageBackfill(toolCallId: tid)
            }
        case "auto_retry_start":
            lastError = "请求失败，自动重试中 (\(e["attempt"].int ?? 0)/\(e["maxAttempts"].int ?? 0))…"
        case "auto_retry_end":
            if e["success"].bool == false {
                lastError = "重试失败：\(e["finalError"].string ?? "未知错误")"
            } else {
                lastError = nil
            }
        case "extension_ui_request":
            handleExtensionUI(e)
        case "extension_error":
            appendSystem("扩展错误：\(e["error"].string ?? "?")")
        case "compaction_start":
            appendSystem("正在压缩上下文…")
        case "compaction_end":
            appendSystem("上下文压缩完成")
            // Compaction often reports null tokens/percent; refresh so footer drops stale %.
            refreshStats()
        default:
            break
        }
    }

    // MARK: - Session auto title (provisional + side-channel LLM)

    func markUserRenamedTitle() {
        userRenamedTitle = true
        titleAnimationToken = nil
        refreshDisplayTitle()
    }

    private func refreshDisplayTitle() {
        if let n = sessionName, !SessionTitleLogic.isPlaceholderName(n) {
            displayTitle = n
        } else {
            displayTitle = SessionTitleLogic.placeholderName
        }
    }

    /// Auto-title path: never marks userRenamedTitle; rejects junk names.
    private func applyAutoSessionName(_ name: String, animate: Bool) {
        guard !userRenamedTitle else { return }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !SessionTitleLogic.isPlaceholderName(trimmed) else { return }
        guard !SessionTitleLogic.isJunkAutoTitle(trimmed) else { return }
        let prev = sessionName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard trimmed != prev else {
            refreshDisplayTitle()
            return
        }
        sessionName = trimmed
        if animate {
            let token = UUID()
            titleAnimationToken = token
            // Belt-and-suspenders: drop token after typewriter window so List recycle cannot re-fire.
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                guard let self else { return }
                if self.titleAnimationToken == token {
                    self.titleAnimationToken = nil
                }
            }
        }
        refreshDisplayTitle()
        proc?.request(["type": "set_session_name", "name": trimmed]) { [weak self] resp in
            guard let self else { return }
            if resp["success"].bool == true {
                self.onSessionMetaChanged?()
            }
            // Keep optimistic name on failure.
        }
    }

    /// First real user message only: one side-channel pi RPC (same model, no Boss) to refine title.
    private func requestSideChannelTitleIfNeeded(userMessage: String) {
        guard autoTitleEnabled, !userRenamedTitle else { return }
        guard !didRequestLLMTitle else { return }
        didRequestLLMTitle = true

        let prose = ImageAttachment.stripAttachmentPathsForDisplay(userMessage)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prose.isEmpty else { return }

        let projectURL = self.projectURL
        let model = self.model
        titleLLMTask?.cancel()
        titleLLMTask = Task { [weak self] in
            let title = await SessionTitleClient.generateTitle(
                from: prose,
                projectURL: projectURL,
                model: model
            )
            guard !Task.isCancelled else { return }
            await MainActor.run { [weak self] in
                guard let self else { return }
                guard self.autoTitleEnabled, !self.userRenamedTitle else { return }
                guard let title else { return }
                self.applyAutoSessionName(title, animate: true)
            }
        }
    }

    private func cancelSideChannelTitle() {
        titleLLMTask?.cancel()
        titleLLMTask = nil
    }

    private func handleExtensionUI(_ e: J) {
        let method = e["method"].string ?? ""
        switch method {
        case "notify":
            appendSystem("[\(e["notifyType"].string ?? "info")] \(e["message"].string ?? "")")
        case "confirm":
            // 无人值守时安全默认：拒绝
            if let rid = e["id"].string {
                proc?.send(["type": "extension_ui_response", "id": rid, "confirmed": false])
                appendSystem("扩展请求确认「\(e["title"].string ?? "")」— 已自动拒绝（UI 暂不支持交互对话框）")
            }
        case "select", "input", "editor":
            if let rid = e["id"].string {
                proc?.send(["type": "extension_ui_response", "id": rid, "cancelled": true])
                appendSystem("扩展对话框「\(e["title"].string ?? method)」已自动取消")
            }
        default:
            break
        }
    }

    private func scheduleStreamFlush() {
        guard !streamFlushScheduled else { return }
        streamFlushScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            guard let self else { return }
            self.streamFlushScheduled = false
            if let message = self.pendingStreamMessage {
                self.pendingStreamMessage = nil
                self.streamingItem = Self.convert(message: message, id: "streaming")
            }
        }
    }

    /// Merge high-frequency tool partials into `toolRuns` at most ~every 50ms.
    private func scheduleToolRunFlush() {
        guard !toolRunFlushScheduled else { return }
        toolRunFlushScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            guard let self else { return }
            self.toolRunFlushScheduled = false
            guard !self.pendingToolRuns.isEmpty else { return }
            let batch = self.pendingToolRuns
            self.pendingToolRuns.removeAll(keepingCapacity: true)
            for (tid, run) in batch {
                self.toolRuns[tid] = run
            }
            self.toolOutputVersion &+= 1
        }
    }

    private func appendSystem(_ text: String) {
        transcript.append(ChatItem(id: nextItemId(), role: "system", blocks: [.text(text)]))
    }

    // MARK: - Message conversion

    private func ingest(message: J) {
        switch message["role"].string ?? "" {
        case "user":
            // Historical ghost title prompts (old sessions) must never appear in transcript.
            let text = Self.contentText(message["content"])
            if text.contains(Self.sessionTitleJobMarker) {
                skipNextAssistantIngest = true
                return
            }
            skipNextAssistantIngest = false
            if let raw = Self.convert(message: message, id: nextItemId(), allowDiskRead: false), !raw.blocks.isEmpty {
                // Live path: image bytes stay on disk here (path-only placeholders);
                // scheduleImageBackfill loads them off-main and patches the item.
                let item = Self.hydrateUserImagesIfNeeded(raw, allowDiskRead: false)
                // Replace optimistic local user bubble when the server echoes the same turn.
                let appliedId: String
                if let lastIdx = transcript.indices.last,
                   Self.shouldReplaceOptimisticUser(existing: transcript[lastIdx], incoming: item) {
                    let keepId = transcript[lastIdx].id
                    transcript[lastIdx] = ChatItem(id: keepId, role: item.role, blocks: item.blocks)
                    appliedId = keepId
                } else {
                    transcript.append(item)
                    appliedId = item.id
                }
                scheduleImageBackfill(itemId: appliedId)
            }
        case "assistant":
            if skipNextAssistantIngest {
                skipNextAssistantIngest = false
                return
            }
            if let item = Self.convert(message: message, id: nextItemId(), allowDiskRead: false) {
                if item.blocks.isEmpty, message["stopReason"].string == "error" {
                    // API returned an error with no content — surface it instead of a blank bubble.
                    appendSystem("⚠️ 模型请求失败（stopReason=error），请检查扩展冲突或 API 状态。")
                } else {
                    transcript.append(item)
                    scheduleImageBackfill(itemId: item.id)
                }
            }
        case "toolResult":
            if let tid = message["toolCallId"].string {
                pendingToolRuns.removeValue(forKey: tid)
                let content = message["content"]
                toolRuns[tid] = ToolRun(
                    isRunning: false,
                    isError: message["isError"].bool ?? false,
                    output: Self.contentText(content),
                    images: Self.contentImages(content, allowDiskRead: false)
                )
                toolOutputVersion &+= 1
                scheduleImageBackfill(toolCallId: tid)
            }
        case "bashExecution":
            let cmd = message["command"].string ?? ""
            let out = message["output"].string ?? ""
            appendSystem("$ \(cmd)\n\(out)")
        default:
            break
        }
    }

    /// Convert one pi message JSON into a `ChatItem`.
    /// - `allowDiskRead: true` (history build, off-main): path-only blocks read the file now.
    /// - `allowDiskRead: false` (live main-thread ingest): path-only blocks become zero-byte
    ///   placeholders carrying their path; the caller backfills bytes off the main thread.
    package static func convert(message: J, id: String, allowDiskRead: Bool = true) -> ChatItem? {
        guard let role = message["role"].string else { return nil }
        var blocks: [ChatBlock] = []
        if let text = message["content"].string {
            if !text.isEmpty { blocks.append(.text(text)) }
        } else {
            for block in message["content"].array {
                switch block["type"].string ?? "" {
                case "text":
                    let t = block["text"].string ?? ""
                    if !t.isEmpty { blocks.append(.text(t)) }
                case "thinking":
                    let t = block["thinking"].string ?? ""
                    if !t.isEmpty { blocks.append(.thinking(t)) }
                case "toolCall":
                    let name = block["name"].string ?? "tool"
                    let arguments = block["arguments"]
                    let summary = ToolCallSummary.summarize(name: name, args: arguments)
                    blocks.append(.toolCall(ToolCallBlock(
                        id: block["id"].string ?? UUID().uuidString,
                        name: name,
                        argsSummary: summary.summary,
                        payloadChars: summary.payloadChars,
                        fileChangePayload: FileChangePayload.parse(
                            toolName: name,
                            arguments: arguments
                        )
                    )))
                case "image":
                    if let imageBlock = Self.parseImageBlock(block, allowDiskRead: allowDiskRead) {
                        blocks.append(.image(imageBlock))
                    }
                default:
                    break
                }
            }
        }
        return ChatItem(id: id, role: role, blocks: blocks)
    }

    /// Pure history build for `get_messages` (call off main: disk read + base64 in `parseImageBlock` / hydrate).
    /// Preserves message order; mirrors `ingest` including ghost-title skip and toolResult → toolRuns.
    package static func buildTranscript(
        from messages: [J],
        loadImageData: Bool = true
    ) -> InitialTranscriptBuild {
        var items: [ChatItem] = []
        var toolRuns: [String: ToolRun] = [:]
        var itemCounter = 0
        var skipNextAssistantIngest = false

        func nextId() -> String {
            itemCounter += 1
            return "item-\(itemCounter)"
        }

        for message in messages {
            switch message["role"].string ?? "" {
            case "user":
                let text = contentText(message["content"])
                if text.contains(sessionTitleJobMarker) {
                    skipNextAssistantIngest = true
                    continue
                }
                skipNextAssistantIngest = false
                if let raw = convert(
                    message: message,
                    id: nextId(),
                    allowDiskRead: loadImageData
                ), !raw.blocks.isEmpty {
                    items.append(
                        loadImageData ? hydrateUserImagesIfNeeded(raw) : raw
                    )
                }
            case "assistant":
                if skipNextAssistantIngest {
                    skipNextAssistantIngest = false
                    continue
                }
                if let item = convert(
                    message: message,
                    id: nextId(),
                    allowDiskRead: loadImageData
                ) {
                    items.append(item)
                }
            case "toolResult":
                if let tid = message["toolCallId"].string {
                    let content = message["content"]
                    toolRuns[tid] = ToolRun(
                        isRunning: false,
                        isError: message["isError"].bool ?? false,
                        output: contentText(content),
                        images: contentImages(content, allowDiskRead: loadImageData)
                    )
                }
            case "bashExecution":
                let cmd = message["command"].string ?? ""
                let out = message["output"].string ?? ""
                items.append(ChatItem(
                    id: nextId(),
                    role: "system",
                    blocks: [.text("$ \(cmd)\n\(out)")]
                ))
            default:
                break
            }
        }

        return InitialTranscriptBuild(
            items: items,
            toolRuns: toolRuns,
            itemCounter: itemCounter,
            skipNextAssistantIngest: skipNextAssistantIngest
        )
    }

    /// Supports RPC/session shapes:
    /// - `{ type, data, mimeType }`
    /// - `{ type, source: { type: "base64", mediaType, data } }`
    /// - path-only with on-disk file when base64 missing/empty
    ///
    /// Disk reads go through `ImageFileDataCache` (read-through; a file is read at most once).
    /// With `allowDiskRead: false` (live main-thread ingest) a path-only block becomes a
    /// zero-byte placeholder carrying `path`; the caller backfills bytes off-main via
    /// `backfilledBlocks` / `backfilledImages` and drops placeholders whose file is unreadable.
    static func parseImageBlock(_ block: J, allowDiskRead: Bool = true) -> ImageBlock? {
        let b64: String?
        var mime: String
        if block["source"].exists {
            b64 = block["source"]["data"].string
            mime = block["source"]["mediaType"].string
                ?? block["source"]["mimeType"].string
                ?? "image/png"
        } else {
            b64 = block["data"].string
            mime = block["mimeType"].string ?? block["mediaType"].string ?? "image/png"
        }
        let path = block["path"].string
            ?? block["filePath"].string
            ?? block["file_path"].string
            ?? block["source"]["path"].string
            ?? block["source"]["filePath"].string
        let trimmedPath = path?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedPath = (trimmedPath?.isEmpty == false) ? trimmedPath : nil

        var data: Data?
        if let b64, !b64.isEmpty {
            data = Data(base64Encoded: b64)
                ?? Data(base64Encoded: b64, options: .ignoreUnknownCharacters)
        }
        if data == nil || data?.isEmpty == true, let resolvedPath {
            if mime == "image/png" || mime.isEmpty {
                mime = Self.mimeType(forImagePath: resolvedPath) ?? mime
            }
            if allowDiskRead {
                data = ImageFileDataCache.data(forPath: resolvedPath)
            } else {
                // Live-path placeholder: no stat/read here; backfill decides if it survives.
                return ImageBlock(
                    id: block["id"].string ?? UUID().uuidString,
                    data: Data(),
                    mimeType: mime.isEmpty ? "image/png" : mime,
                    path: resolvedPath
                )
            }
        }
        guard let data, !data.isEmpty else { return nil }
        return ImageBlock(
            id: block["id"].string ?? UUID().uuidString,
            data: data,
            mimeType: mime.isEmpty ? "image/png" : mime,
            path: resolvedPath
        )
    }

    /// Fill missing image blocks from `Attached image file(s):` footnotes (session resume).
    /// `allowDiskRead: false` (live main-thread ingest) appends zero-byte path placeholders
    /// instead of reading; the caller backfills off-main (unreadable files drop the block,
    /// matching this function's legacy skip-missing behavior).
    package static func hydrateUserImagesIfNeeded(_ item: ChatItem, allowDiskRead: Bool = true) -> ChatItem {
        guard item.role == "user" else { return item }
        let plain = plainText(of: item)
        let paths = ImageAttachment.attachmentPaths(fromMessageText: plain)
        guard !paths.isEmpty else { return item }

        var imageBlocks: [ImageBlock] = []
        var nonImage: [ChatBlock] = []
        for block in item.blocks {
            if case .image(let img) = block {
                imageBlocks.append(img)
            } else {
                nonImage.append(block)
            }
        }

        // Attach known paths onto existing images that lack path.
        for i in imageBlocks.indices where imageBlocks[i].path == nil && i < paths.count {
            imageBlocks[i].path = paths[i]
        }

        // Load any footnote paths not already represented as image blocks.
        if imageBlocks.count < paths.count {
            for i in imageBlocks.count..<paths.count {
                let p = paths[i]
                if allowDiskRead {
                    guard let data = ImageFileDataCache.data(forPath: p) else { continue }
                    imageBlocks.append(ImageBlock(
                        id: UUID().uuidString,
                        data: data,
                        mimeType: mimeType(forImagePath: p) ?? "image/png",
                        path: p
                    ))
                } else {
                    imageBlocks.append(ImageBlock(
                        id: UUID().uuidString,
                        data: Data(),
                        mimeType: mimeType(forImagePath: p) ?? "image/png",
                        path: p
                    ))
                }
            }
        }

        // Prefer images-first layout (matches optimistic send).
        var blocks: [ChatBlock] = imageBlocks.map { .image($0) }
        blocks.append(contentsOf: nonImage)
        return ChatItem(id: item.id, role: item.role, blocks: blocks)
    }

    // MARK: - Live image backfill (T4: keep disk reads off the main-thread ingest path)

    /// Placeholder (zero-byte, path-carrying) image blocks produced by live ingest.
    private static func placeholderImageTargets(in images: [ImageBlock]) -> [(id: String, path: String)] {
        images.compactMap { img in
            (img.data.isEmpty && img.path != nil) ? (img.id, img.path!) : nil
        }
    }

    /// Merge off-main loaded bytes into placeholder image blocks.
    /// Placeholders with no readable file are dropped — matching the legacy behavior where
    /// `parseImageBlock` / hydrate produced no block for missing files. Pure; main-thread apply.
    package static func backfilledImages(_ images: [ImageBlock], loaded: [String: Data]) -> [ImageBlock] {
        images.compactMap { img in
            guard img.data.isEmpty, let path = img.path else { return img }
            guard let data = loaded[img.id], !data.isEmpty else { return nil }
            return ImageBlock(id: img.id, data: data, mimeType: img.mimeType, path: path)
        }
    }

    /// `backfilledImages` over generic chat blocks (non-image and non-placeholder pass through).
    package static func backfilledBlocks(_ blocks: [ChatBlock], loaded: [String: Data]) -> [ChatBlock] {
        blocks.compactMap { block in
            guard case .image(let img) = block else { return block }
            guard img.data.isEmpty, let path = img.path else { return block }
            guard let data = loaded[img.id], !data.isEmpty else { return nil }
            return .image(ImageBlock(id: img.id, data: data, mimeType: img.mimeType, path: path))
        }
    }

    /// After live ingest appended an item/toolRun containing path-only placeholder images,
    /// read the files on a background queue (deduped through `ImageFileDataCache`) and patch
    /// the transcript/toolRuns back on the main thread. Items removed in the meantime are skipped.
    private func scheduleImageBackfill(itemId: String? = nil, toolCallId: String? = nil) {
        let targets: [(id: String, path: String)]
        if let itemId, let item = transcript.first(where: { $0.id == itemId }) {
            targets = Self.placeholderImageTargets(in: item.blocks.compactMap { block in
                if case .image(let img) = block { return img }
                return nil
            })
        } else if let toolCallId, let run = toolRuns[toolCallId] {
            targets = Self.placeholderImageTargets(in: run.images)
        } else {
            return
        }
        guard !targets.isEmpty else { return }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var loaded: [String: Data] = [:]
            for target in targets {
                if let data = ImageFileDataCache.data(forPath: target.path) {
                    loaded[target.id] = data
                }
            }
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                if let itemId, let idx = self.transcript.firstIndex(where: { $0.id == itemId }) {
                    var item = self.transcript[idx]
                    item.blocks = Self.backfilledBlocks(item.blocks, loaded: loaded)
                    self.transcript[idx] = item
                }
                if let toolCallId, let run = self.toolRuns[toolCallId] {
                    var next = run
                    next.images = Self.backfilledImages(run.images, loaded: loaded)
                    self.toolRuns[toolCallId] = next
                    self.toolOutputVersion &+= 1
                }
            }
        }
    }

    /// True when `incoming` is the server echo of an optimistic local user bubble.
    package static func shouldReplaceOptimisticUser(existing: ChatItem, incoming: ChatItem) -> Bool {
        guard existing.role == "user", incoming.role == "user" else { return false }
        let a = ImageAttachment.stripAttachmentPathsForDisplay(plainText(of: existing))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let b = ImageAttachment.stripAttachmentPathsForDisplay(plainText(of: incoming))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        // Same prose (incl. both empty for image-only): replace optimistic with server item.
        return a == b
    }

    package static func plainText(of item: ChatItem) -> String {
        item.blocks.compactMap { block -> String? in
            if case .text(let t) = block { return t }
            return nil
        }.joined(separator: "\n")
    }

    package static func imageCount(of item: ChatItem) -> Int {
        item.blocks.reduce(0) { n, b in
            if case .image = b { return n + 1 }
            return n
        }
    }

    package static func mimeType(forImagePath path: String) -> String? {
        switch (path as NSString).pathExtension.lowercased() {
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "tif", "tiff": return "image/tiff"
        case "heic": return "image/heic"
        default: return nil
        }
    }

    static func argsSummary(name: String, args: J) -> String {
        ToolCallSummary.summarize(name: name, args: args).summary
    }

    static func contentText(_ content: J) -> String {
        if let s = content.string { return s }
        return content.array
            .compactMap { $0["type"].string == "text" ? $0["text"].string : nil }
            .joined(separator: "\n")
    }

    /// Images from tool result content (e.g. generate_image / browser_screenshot).
    /// Computer/open_application keep PNG off the wire (marker-only text); when ordinary
    /// image blocks are absent, resolve `[PIPIUI_COMPUTER_SCREENSHOT:id]` via the
    /// process-local memory cache. Cache miss → no images (history after restart).
    static func contentImages(_ content: J, allowDiskRead: Bool = true) -> [ImageBlock] {
        let fromBlocks = content.array.compactMap { block -> ImageBlock? in
            guard block["type"].string == "image" else { return nil }
            return parseImageBlock(block, allowDiskRead: allowDiskRead)
        }
        if !fromBlocks.isEmpty { return fromBlocks }
        return ComputerScreenshotMarker.images(fromText: contentText(content))
    }

    // MARK: - User actions

    /// Keep object identity aligned with AppStore's current dictionary key after a file rebind.
    package func rebindIdentity(to sessionKey: String) {
        guard !sessionKey.isEmpty, sessionKey != id else { return }
        id = sessionKey
        subagents.sessionKey = sessionKey
    }

    func copyItemText(_ item: ChatItem) {
        copyTextToPasteboard(MessageActions.copyableText(from: item))
    }

    func copySegmentsText(_ segments: [AssistantBlockLayout.Segment]) {
        copyTextToPasteboard(MessageActions.copyableText(from: segments))
    }

    private func copyTextToPasteboard(_ text: String) {
        guard !text.isEmpty else {
            flash("没有可复制的内容")
            return
        }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        flash("已复制（\(text.count) 字符）")
    }

    func beginEditingUserMessage(itemId: String) {
        guard !isWorking else { return }
        guard let item = transcript.first(where: { $0.id == itemId }) else { return }
        if item.entryId != nil {
            editingItemId = itemId
            return
        }
        // Ids stamp asynchronously after settle; sync once so 撤回 is usable immediately.
        syncEntryIds { [weak self] in
            guard let self else { return }
            guard let refreshed = self.transcript.first(where: { $0.id == itemId }),
                  refreshed.entryId != nil else {
                self.flash("无法撤回：消息尚未就绪")
                return
            }
            self.editingItemId = itemId
        }
    }

    func cancelEditingUserMessage() {
        editingItemId = nil
    }

    func branchFromAssistant(runLastEntryId: String) {
        guard !isWorking else {
            flash("请等待当前任务结束")
            return
        }
        guard let oldPath = sessionFile, !oldPath.isEmpty else {
            flash("会话尚未保存，稍后再试")
            return
        }
        guard let proc else {
            flash("pi 未运行，无法创建分支")
            return
        }

        isSendingFromQueue = true
        proc.request(["type": "get_entries"]) { [weak self] response in
            guard let self else { return }
            guard response["success"].bool == true else {
                self.isSendingFromQueue = false
                self.flash(response["error"].string ?? "无法读取会话树")
                return
            }

            let entries = response["data"]["entries"].array
            let leafId = response["data"]["leafId"].string
            let branch = MessageActions.activeBranchMessages(entries: entries, leafId: leafId)
            self.cachedBranchMessages = branch
            self.cachedLeafId = leafId
            let nextUser = MessageActions.nextUserEntryId(
                after: runLastEntryId,
                branchMessages: branch
            )
            guard let op = MessageActions.branchOp(
                runLastEntryId: runLastEntryId,
                leafId: leafId,
                nextUserEntryId: nextUser
            ) else {
                self.isSendingFromQueue = false
                self.flash("无法从此消息创建分支")
                return
            }

            let request: [String: Any]
            switch op {
            case .clone:
                request = ["type": "clone"]
            case .fork(let nextUserEntryId):
                request = ["type": "fork", "entryId": nextUserEntryId]
            }
            proc.request(request) { [weak self] branchResponse in
                guard let self else { return }
                guard branchResponse["success"].bool == true,
                      branchResponse["data"]["cancelled"].bool != true else {
                    self.isSendingFromQueue = false
                    self.flash(branchResponse["error"].string ?? "创建分支失败")
                    return
                }

                proc.request(["type": "get_state"]) { [weak self] stateResponse in
                    guard let self else { return }
                    let newPath = stateResponse["data"]["sessionFile"].string
                    guard stateResponse["success"].bool != false,
                          let newPath,
                          !newPath.isEmpty,
                          newPath != oldPath else {
                        self.returnToOriginalSession(path: oldPath) { [weak self] restoreError in
                            guard let self else { return }
                            self.isSendingFromQueue = false
                            let reason = stateResponse["error"].string
                                ?? "创建分支失败：未得到新会话文件"
                            if let restoreError {
                                self.flash("\(reason)；\(restoreError)")
                            } else {
                                self.flash(reason)
                            }
                        }
                        return
                    }

                    self.returnToOriginalSession(path: oldPath) { [weak self] restoreError in
                        guard let self else { return }
                        self.isSendingFromQueue = false
                        if let restoreError {
                            self.flash(restoreError)
                            return
                        }
                        self.onBranchedSessionReady?(newPath)
                        self.flash("已创建分支会话")
                    }
                }
            }
        }
    }

    /// Clone/fork changes the process's active file. Restore this ChatSession to its original
    /// file and transcript before AppStore opens the branch in a second process.
    private func returnToOriginalSession(
        path: String,
        completion: @escaping (String?) -> Void
    ) {
        guard let proc else {
            completion("pi 未运行，无法恢复原会话")
            return
        }
        proc.request(["type": "switch_session", "sessionPath": path]) { [weak self] response in
            guard let self else { return }
            guard response["success"].bool == true,
                  response["data"]["cancelled"].bool != true else {
                let switchError = response["error"].string ?? "未知错误"
                proc.request(["type": "get_state"]) { [weak self] stateResponse in
                    guard let self else { return }
                    let stateRefreshed = stateResponse["success"].bool != false
                    if stateRefreshed {
                        self.applyStateTrackingFileRebind(stateResponse["data"])
                    }
                    self.reloadTranscriptAfterSessionReplace { reloadError in
                        let currentState: String
                        if !stateRefreshed {
                            currentState = "无法确认当前会话文件"
                        } else if let reloadError {
                            currentState = "已重新绑定当前会话，但刷新失败（\(reloadError)）"
                        } else {
                            currentState = "当前会话已重新绑定并载入"
                        }
                        completion("恢复原会话失败（\(switchError)），\(currentState)")
                    }
                }
                return
            }
            self.bindSessionFileAfterConfirmedSwitch(path)
            proc.request(["type": "get_state"]) { [weak self] stateResponse in
                guard let self else { return }
                let stateError: String?
                if stateResponse["success"].bool == false {
                    stateError = stateResponse["error"].string ?? "无法刷新原会话状态"
                } else {
                    self.applyState(stateResponse["data"])
                    stateError = nil
                }
                self.reloadTranscriptAfterSessionReplace { reloadError in
                    completion(stateError ?? reloadError)
                }
            }
        }
    }

    func commitEditingUserMessage(newText: String) {
        let trimmed = newText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard MessageActions.isEditDraftSendable(trimmed) else {
            flash("消息不能为空")
            return
        }
        guard let itemId = editingItemId,
              let item = transcript.first(where: { $0.id == itemId }) else {
            editingItemId = nil
            return
        }
        guard let entryId = item.entryId else {
            editingItemId = nil
            flash("无法撤回：消息尚未就绪")
            return
        }
        let original = MessageActions.copyableText(from: item)
        if MessageActions.shouldNoOpEdit(
            originalText: original,
            newText: trimmed,
            itemEntryId: entryId,
            branchMessages: cachedBranchMessages
        ) {
            editingItemId = nil
            return
        }
        guard let previousPath = sessionFile, !previousPath.isEmpty else {
            flash("会话尚未保存，稍后再试")
            editingItemId = nil
            return
        }
        guard !isWorking else {
            flash("请等待当前任务结束")
            return
        }
        guard proc != nil else {
            flash("pi 未运行，无法编辑消息")
            editingItemId = nil
            return
        }
        let images = draftImages(from: item)

        editingItemId = nil
        forkAndResendPrompt(
            entryId: entryId,
            text: trimmed,
            images: images,
            previousPath: previousPath,
            actionNoun: "编辑"
        )
    }

    /// 重发：撤回后以原文原图重新发送（不弹编辑器）。
    func resendUserMessage(itemId: String) {
        guard !isWorking else {
            flash("请等待当前任务结束")
            return
        }
        guard let item = transcript.first(where: { $0.id == itemId }) else { return }
        guard item.entryId != nil else {
            // Ids stamp asynchronously after settle; sync once so 重发 is usable immediately.
            syncEntryIds { [weak self] in
                guard let self else { return }
                self.resendUserMessageNow(itemId: itemId)
            }
            return
        }
        resendUserMessageNow(itemId: itemId)
    }

    /// 重发核心：用刷新后的 item 重读 entryId / 文本 / 图片，走共享 fork 流程。
    private func resendUserMessageNow(itemId: String) {
        guard !isWorking else {
            flash("请等待当前任务结束")
            return
        }
        guard let item = transcript.first(where: { $0.id == itemId }),
              let entryId = item.entryId else {
            flash("无法重发：消息尚未就绪")
            return
        }
        let text = MessageActions.copyableText(from: item)
        guard MessageActions.isEditDraftSendable(text) else {
            flash("消息为空，无法重发")
            return
        }
        guard let previousPath = sessionFile, !previousPath.isEmpty else {
            flash("会话尚未保存，稍后再试")
            return
        }
        guard proc != nil else {
            flash("pi 未运行，无法重发消息")
            return
        }
        forkAndResendPrompt(
            entryId: entryId,
            text: text,
            images: draftImages(from: item),
            previousPath: previousPath,
            actionNoun: "重发"
        )
    }

    /// 把消息里的 image block 还原成 DraftImage（撤回修改 / 重发时原样携带图片）。
    private func draftImages(from item: ChatItem) -> [DraftImage] {
        item.blocks.compactMap { block -> DraftImage? in
            guard case .image(let img) = block else { return nil }
            var data = img.data
            if data.isEmpty, let path = img.path, !path.isEmpty {
                data = ImageFileDataCache.data(forPath: path) ?? Data()
            }
            guard !data.isEmpty, let preview = NSImage(data: data) else { return nil }
            return DraftImage(data: data, mimeType: img.mimeType, preview: preview)
        }
    }

    /// 撤回修改 / 重发共享的核心流程：fork 到 entryId → get_state → 重绑会话文件
    /// → 重载 transcript → prepareMessage + sendPromptNow。失败时恢复原会话并 flash。
    private func forkAndResendPrompt(
        entryId: String,
        text: String,
        images: [DraftImage],
        previousPath: String,
        actionNoun: String
    ) {
        guard let proc else {
            flash("pi 未运行，无法\(actionNoun)消息")
            return
        }
        isSendingFromQueue = true
        proc.request(["type": "fork", "entryId": entryId]) { [weak self] response in
            guard let self else { return }
            guard response["success"].bool == true,
                  response["data"]["cancelled"].bool != true else {
                self.isSendingFromQueue = false
                self.flash(response["error"].string ?? "\(actionNoun)失败")
                return
            }
            self.proc?.request(["type": "get_state"]) { [weak self] stateResponse in
                guard let self else { return }
                guard stateResponse["success"].bool != false else {
                    self.restorePreviousSessionAfterFailedEdit(
                        previousPath: previousPath,
                        reason: stateResponse["error"].string ?? "无法读取\(actionNoun)后的会话",
                        actionNoun: actionNoun
                    )
                    return
                }
                self.applyStateTrackingFileRebind(stateResponse["data"])
                guard let newPath = self.sessionFile,
                      !newPath.isEmpty,
                      newPath != previousPath else {
                    self.restorePreviousSessionAfterFailedEdit(
                        previousPath: previousPath,
                        reason: "\(actionNoun)分叉后未得到新会话文件",
                        actionNoun: actionNoun
                    )
                    return
                }
                self.reloadTranscriptAfterSessionReplace { [weak self] reloadError in
                    guard let self else { return }
                    if let reloadError {
                        self.restorePreviousSessionAfterFailedEdit(
                            previousPath: previousPath,
                            reason: reloadError,
                            actionNoun: actionNoun
                        )
                    } else {
                        let prepared = self.prepareMessage(text: text, images: images)
                        self.sendPromptNow(message: prepared.message, images: prepared.images)
                    }
                }
            }
        }
    }

    private func applyStateTrackingFileRebind(_ data: J) {
        let previousPath = sessionFile
        applyState(data)
        if let previousPath,
           let newPath = sessionFile,
           !previousPath.isEmpty,
           previousPath != newPath {
            onSessionFileRebound?(previousPath, newPath)
        }
    }

    private func bindSessionFileAfterConfirmedSwitch(_ path: String) {
        guard !path.isEmpty, sessionFile != path else { return }
        let previousPath = sessionFile
        sessionFile = path
        subagents.attachPersistence(sessionFile: path)
        onSessionMetaChanged?()
        if let previousPath, !previousPath.isEmpty {
            onSessionFileRebound?(previousPath, path)
        }
    }

    /// A successful fork changes the process before follow-up reads complete. If those reads
    /// fail, return the process and AppStore binding to the original file before reporting.
    private func restorePreviousSessionAfterFailedEdit(
        previousPath: String,
        reason: String,
        actionNoun: String = "编辑"
    ) {
        guard let proc else {
            isSendingFromQueue = false
            flash("\(actionNoun)未发送：\(reason)；pi 未运行，无法恢复原会话")
            return
        }
        proc.request(["type": "switch_session", "sessionPath": previousPath]) { [weak self] response in
            guard let self else { return }
            let switchedBack = response["success"].bool == true
                && response["data"]["cancelled"].bool != true
            if switchedBack {
                self.bindSessionFileAfterConfirmedSwitch(previousPath)
            }
            self.refreshAfterFailedEdit(
                reason: reason,
                switchedBack: switchedBack,
                switchError: response["error"].string,
                actionNoun: actionNoun
            )
        }
    }

    private func refreshAfterFailedEdit(
        reason: String,
        switchedBack: Bool,
        switchError: String?,
        actionNoun: String = "编辑"
    ) {
        proc?.request(["type": "get_state"]) { [weak self] stateResponse in
            guard let self else { return }
            let stateRefreshed = stateResponse["success"].bool != false
            if stateRefreshed {
                self.applyStateTrackingFileRebind(stateResponse["data"])
            }
            self.reloadTranscriptAfterSessionReplace { [weak self] reloadResult in
                guard let self else { return }
                self.isSendingFromQueue = false
                if switchedBack {
                    if let reloadError = reloadResult {
                        self.flash("\(actionNoun)未发送：\(reason)；已恢复原会话，但刷新失败（\(reloadError)）")
                    } else {
                        self.flash("\(actionNoun)未发送：\(reason)；已恢复原会话")
                    }
                } else {
                    let detail = switchError ?? "未知错误"
                    let location: String
                    if !stateRefreshed {
                        location = "无法确认当前会话文件"
                    } else if let reloadError = reloadResult {
                        location = "已重新绑定当前会话，但刷新失败（\(reloadError)）"
                    } else {
                        location = "当前会话已重新绑定并载入"
                    }
                    self.flash("\(actionNoun)未发送：\(reason)；恢复原会话失败（\(detail)），\(location)")
                }
            }
        }
    }

    private func reloadTranscriptAfterSessionReplace(
        completion: @escaping (String?) -> Void
    ) {
        streamingItem = nil
        isStreaming = false
        isStopping = false
        editingItemId = nil
        pendingStreamMessage = nil
        pendingToolRuns.removeAll(keepingCapacity: false)

        guard let proc else {
            completion("pi 未运行，无法刷新会话")
            return
        }
        proc.request(["type": "get_messages"]) { [weak self] response in
            guard let self else { return }
            guard response["success"].bool != false else {
                completion(response["error"].string ?? "无法刷新编辑后的会话")
                return
            }
            let messages = response["data"]["messages"].array
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let built = Self.buildTranscript(from: messages)
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.transcript = built.items
                    self.toolRuns = built.toolRuns
                    self.toolOutputVersion &+= 1
                    self.itemCounter = built.itemCounter
                    self.skipNextAssistantIngest = built.skipNextAssistantIngest
                    self.cachedBranchMessages = []
                    self.cachedLeafId = nil
                    self.syncEntryIds {
                        completion(nil)
                    }
                }
            }
        }
    }

    func sendPrompt(_ text: String, images: [DraftImage] = []) {
        let expanded = expandedDraftText(from: text)
        // Bodies are now in `expanded`; drop map so markers cannot be re-expanded later.
        clearDraftPastes()
        let trimmed = expanded.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || !images.isEmpty else { return }

        // Defensive: a stale stop flag must never bleed into the next turn.
        isStopping = false

        // Media generation modes bypass pi RPC and hit local relays (Grok Build Imagine path).
        if composerMode == .generateImage || composerMode == .generateVideo {
            guard !trimmed.isEmpty else {
                lastError = composerMode == .generateImage ? "请描述要生成的图像" : "请描述要生成的视频"
                return
            }
            generateMedia(prompt: trimmed, images: images)
            return
        }

        // Builtin slash commands: local/GUI or dedicated RPC — never go through prompt queue.
        // Only when there are no images (slash is text-only UX).
        if images.isEmpty,
           let inv = BuiltinCommands.parseInvocation(trimmed),
           BuiltinCommands.execute(name: inv.name, args: inv.args, host: self) {
            draftText = ""
            draftImages = []
            return
        }

        let prepared = prepareMessage(text: trimmed, images: images)

        // Busy while streaming OR in the gap after drain popped until agent_start.
        if isStreaming || isSendingFromQueue {
            let ok = queue.enqueue(text: prepared.message, images: prepared.images)
            if ok { publishQueue() }
            return
        }
        sendPromptNow(message: prepared.message, images: prepared.images)
    }

    /// App-authored user-role messages are useful orchestration input, but are not
    /// human authorization. Preserve the latest human grant without widening it.
    private func sendAppGeneratedPrompt(_ text: String) {
        let key = text.trimmingCharacters(in: .whitespacesAndNewlines)
        searchGrantSuppressedMessages[key, default: 0] += 1
        sendPrompt(text)
    }

    /// Run image/video generation via grok-relay / coding-relay REST (same APIs as Grok Build).
    func generateMedia(prompt: String, images: [DraftImage]) {
        guard !mediaBusy else { return }
        let mode = composerMode
        let model = mode == .generateVideo ? videoMediaModel : imageMediaModel
        mediaBusy = true
        mediaStatus = "正在\(mode.label)…"
        lastError = nil

        // Show user bubble immediately
        var userBlocks: [ChatBlock] = [.text(prompt)]
        for img in images {
            userBlocks.append(.image(ImageBlock(id: UUID().uuidString, data: img.data, mimeType: img.mimeType)))
        }
        transcript.append(ChatItem(
            id: nextItemId(),
            role: "user",
            blocks: userBlocks,
            isLocalOnly: true
        ))

        Task { [weak self] in
            guard let self else { return }
            do {
                let result = try await MediaClient.generate(
                    model: model,
                    prompt: prompt,
                    referenceImages: images,
                    projectURL: self.projectURL,
                    progress: { [weak self] status in
                        Task { @MainActor [weak self] in
                            self?.mediaStatus = status
                        }
                    }
                )
                await MainActor.run {
                    self.appendMediaResult(result)
                    self.mediaBusy = false
                    self.mediaStatus = nil
                    // Stay in media mode so user can iterate; clear only drafts (caller does that)
                }
            } catch {
                await MainActor.run {
                    self.mediaBusy = false
                    self.mediaStatus = nil
                    self.lastError = error.localizedDescription
                    self.transcript.append(ChatItem(
                        id: self.nextItemId(),
                        role: "system",
                        blocks: [.text("\(mode.label)失败：\(error.localizedDescription)")]
                    ))
                }
            }
        }
    }

    private func appendMediaResult(_ result: MediaGenerationResult) {
        var blocks: [ChatBlock] = [
            .text("\(result.modelId)")
        ]
        switch result.kind {
        case .image(let data, let mime, let path):
            blocks.append(.image(ImageBlock(
                id: UUID().uuidString,
                data: data,
                mimeType: mime,
                path: path?.path
            )))
            if let path {
                blocks.append(.text(path.path))
            }
        case .video(let path, let remote):
            blocks.append(.video(VideoBlock(id: UUID().uuidString, path: path.path, remoteURL: remote)))
            blocks.append(.text(path.path))
        }
        transcript.append(ChatItem(
            id: nextItemId(),
            role: "assistant",
            blocks: blocks,
            isLocalOnly: true
        ))
    }

    /// Store a large paste body and return the short marker to insert into `draftText`.
    @discardableResult
    func registerLargePaste(_ text: String) -> String {
        pasteCounter += 1
        let id = pasteCounter
        draftPastes[id] = text
        let counts = DraftPasteCollapse.lineAndCharCount(of: text)
        return DraftPasteCollapse.makeMarker(id: id, lineCount: counts.lines, charCount: counts.chars)
    }

    func expandedDraftText(from text: String) -> String {
        DraftPasteCollapse.expandPasteMarkers(text: text, pastes: draftPastes)
    }

    func clearDraftPastes() {
        draftPastes = [:]
        pasteCounter = 0
    }

    func pruneOrphanDraftPastes() {
        draftPastes = DraftPasteCollapse.pruneOrphanPastes(text: draftText, pastes: draftPastes)
    }

    /// Dual delivery: multimodal RPC images + real on-disk paths.
    /// Coding models often try `read .../attachments/...` first; saving under .pi/attachments fixes it.
    /// T12: paths are precomputed synchronously (no disk I/O); bytes are written off-main.
    private func prepareMessage(text: String, images: [DraftImage]) -> (message: String, images: [DraftImage]) {
        var message = text
        if !images.isEmpty {
            let paths = ImageAttachment.saveToProjectAttachmentsAsync(images, projectURL: projectURL)
            message = ImageAttachment.messageWithAttachmentPaths(text: text, paths: paths)
        }
        return (message, images)
    }

    private func sendPromptNow(message: String, images: [DraftImage], requeueOnFailure: QueuedMessage? = nil) {
        let suppressionCount = searchGrantSuppressedMessages[message] ?? 0
        if suppressionCount > 0 {
            if suppressionCount == 1 {
                searchGrantSuppressedMessages.removeValue(forKey: message)
            } else {
                searchGrantSuppressedMessages[message] = suppressionCount - 1
            }
        } else {
            // Replace the grant before Pi sees this human-composer turn. A prompt without
            // an explicit path writes an empty list, expiring any permission from last turn.
            try? SearchScopeExtension.recordUserTurn(
                message,
                sessionKey: id,
                projectRoot: projectURL
            )
        }

        // Provisional title + at most one side-channel LLM refine (first user message only).
        // Never ghost-prompt the main pi process.
        if autoTitleEnabled,
           !userRenamedTitle,
           !message.contains(Self.sessionTitleJobMarker) {
            if SessionTitleLogic.isPlaceholderName(sessionName) {
                let prose = ImageAttachment.stripAttachmentPathsForDisplay(message)
                if let title = SessionTitleLogic.provisionalTitle(from: prose) {
                    applyAutoSessionName(title, animate: true)
                }
            }
            requestSideChannelTitleIfNeeded(userMessage: message)
        }

        // Optimistic user bubble (text + images) so thumbnails appear before message_end.
        appendOptimisticUserMessage(message: message, images: images)

        // Cover first-send / drain gap before agent_start so sidebar shows spinner, not green.
        isSendingFromQueue = true
        // Defensive: a stale stop flag must never bleed into the next turn.
        isStopping = false
        var cmd: [String: Any] = ["type": "prompt", "message": message]
        if !images.isEmpty {
            cmd["images"] = ImageAttachment.rpcPayload(from: images)
        }
        // Pin sidebar session to top on user submit (don't wait for agent_settled / disk mtime).
        onUserSubmitted?()
        // Never set streamingBehavior: "steer" — busy delivery is local queue + idle drain.
        proc?.request(cmd) { [weak self] resp in
            guard let self else { return }
            if resp["success"].bool != true {
                self.lastError = resp["error"].string ?? "发送失败"
                self.isSendingFromQueue = false
                if let requeueOnFailure {
                    // Queued item is retried with the same text/paths — keep the files.
                    self.queue.requeueFront(requeueOnFailure)
                    self.publishQueue()
                } else {
                    // Permanent failure: remove attachment files we wrote for this message.
                    // (Only paths recorded by saveToProjectAttachmentsAsync are touched.)
                    ImageAttachment.discardAttachments(
                        atPaths: ImageAttachment.attachmentPaths(fromMessageText: message)
                    )
                }
            }
        }
    }

    /// Local user row before pi `message_end` (deduped on ingest).
    private func appendOptimisticUserMessage(message: String, images: [DraftImage]) {
        var blocks: [ChatBlock] = []
        let paths = ImageAttachment.attachmentPaths(fromMessageText: message)
        for (i, img) in images.enumerated() {
            let path = i < paths.count ? paths[i] : nil
            blocks.append(.image(ImageBlock(
                id: UUID().uuidString,
                data: img.data,
                mimeType: img.mimeType,
                path: path
            )))
        }
        if !message.isEmpty {
            blocks.append(.text(message))
        }
        guard !blocks.isEmpty else { return }
        transcript.append(ChatItem(id: nextItemId(), role: "user", blocks: blocks))
    }

    private func publishQueue() {
        messageQueue = queue.items
    }

    /// Bulk 撤回: returns composer-facing prose (path footnotes stripped) + DraftImages.
    /// Queue stores prepareMessage-annotated text; stripping avoids double path blocks on resend.
    func restoreQueueToDraft() -> (text: String, images: [DraftImage]) {
        let snapshot = queue.items
        let restored = queue.restoreAll()
        publishQueue()
        // Strip each item then re-join — joined annotated blocks only have one trailing footer.
        let displayParts = snapshot
            .map { ImageAttachment.stripAttachmentPathsForDisplay($0.text) }
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return (SessionMessageQueue.joinTexts(displayParts), restored.images)
    }

    func abort() {
        // Optimistic: acknowledge the click immediately. Cleared on settle / exit / new turn.
        isStopping = true
        queue.noteAbort()
        publishQueue()
        cancelSideChannelTitle()
        // intercept flag only; items stay until idle drain
        proc?.send(["type": "abort"])
    }

    /// 插队 / 阻截：中止当前 run（若在生成），settle 后发送队首；FIFO 剩余项不变。不恢复到 draft。
    /// Same path as Stop-with-queue when streaming; when idle, drains head immediately.
    func cutInQueueHead() {
        guard !queue.isEmpty else { return }
        if isStreaming {
            abort()
        } else {
            drainQueueIfIdle()
        }
    }

    /// Drain queue head when agent is idle. Call from agent_settled or cut-in when already idle.
    private func drainQueueIfIdle() {
        // Stale flag if prior drain never saw agent_start (e.g. odd settle path).
        if isSendingFromQueue && !isStreaming {
            isSendingFromQueue = false
        }
        guard let msg = queue.popForIdleDrain(isStreaming: isStreaming, processAlive: processAlive) else {
            publishQueue()
            return
        }
        publishQueue()
        sendPromptNow(message: msg.text, images: msg.images, requeueOnFailure: msg)
    }

    func setModel(_ m: ModelInfo) {
        proc?.request(["type": "set_model", "provider": m.provider, "modelId": m.modelId]) { [weak self] resp in
            guard let self else { return }
            if resp["success"].bool == true {
                self.model = m
                // Keep「跟随主 Agent」aligned with composer/bottom-bar selection.
                SubagentModelSettings.writeMainModel(m.id)
                // Apply new model's context window immediately (re-derive % from existing tokens)
                if let w = (resp["data"]["contextWindow"].int ?? m.contextWindow), w > 0 {
                    self.contextWindow = w
                    if let t = self.contextTokens, w > 0 {
                        self.contextPercent = min(100.0, Double(t) / Double(w) * 100.0)
                    }
                }
                self.refreshThinkingLevels()
                self.proc?.request(["type": "get_state"]) { [weak self] r in self?.applyState(r["data"]) }
                // Authoritative refresh: get_session_stats re-reads current model's window + tokens
                self.refreshStats()
                // Re-bind quota monitor for the new provider, then force-refresh it.
                self.bindQuotaMonitor()
                self.currentQuotaMonitor?.refreshIfNeeded(force: true)
            } else {
                self.lastError = resp["error"].string ?? "切换模型失败"
            }
        }
    }

    func setThinkingLevel(_ level: String) {
        proc?.request(["type": "set_thinking_level", "level": level]) { [weak self] resp in
            if resp["success"].bool == true { self?.thinkingLevel = level }
        }
    }

    func setSessionName(_ name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        // Any public rename path stops auto title jobs (slash / AppStore / UI).
        markUserRenamedTitle()
        proc?.request(["type": "set_session_name", "name": trimmed]) { [weak self] resp in
            guard let self else { return }
            if resp["success"].bool == true {
                self.sessionName = trimmed
                self.refreshDisplayTitle()
                self.onSessionMetaChanged?()
            } else {
                self.lastError = resp["error"].string ?? "重命名失败"
            }
        }
    }

    /// Terminate the pi process (and descendant subagents). Always flushes agent tree to disk first.
    /// If `onExited` is provided, it runs once on the main thread after the process exits or after ~2s timeout
    /// (so restart can spawn without concurrent .jsonl writers).
    func shutdown(onExited: (() -> Void)? = nil) {
        processStartCancelled = true
        cancelSideChannelTitle()
        unbindQuotaMonitor()
        subagents.saveNow()
        ComputerCoordinator.shared.release(
            sessionKey: bridgeRoutingKey,
            revokeConsent: true
        )
        guard let proc else {
            onExited?()
            return
        }
        guard let onExited else {
            proc.terminate()
            return
        }
        if !proc.isRunning {
            onExited()
            return
        }
        var settled = false
        let finish = {
            guard !settled else { return }
            settled = true
            onExited()
        }
        let previous = proc.onExit
        proc.onExit = { code, stderr in
            previous?(code, stderr)
            finish()
        }
        proc.terminate()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak proc] in
            if !settled {
                proc?.forceKill()
            }
            // Force-kill should still trip terminationHandler; hard cap so restart always proceeds.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                finish()
            }
        }
    }

    /// Clear sidebar green/red badges after the user opens/selects this session.
    func markCompletionSeen() {
        if hasUnseenCompletion { hasUnseenCompletion = false }
        if hasUnseenInterruption {
            hasUnseenInterruption = false
            clearInFlightMark()
        }
    }

    /// Mark / clear interrupted-path badge for main turn **or** running background subagents.
    private func syncInFlightMark() {
        if InterruptedSessionStore.shouldPersistMark(
            agentTurnActive: agentTurnActive,
            isWorking: isWorking,
            runningSubagents: subagents.runningCount
        ) {
            persistInFlightMark()
        } else {
            clearInFlightMark()
        }
    }

    private func persistInFlightMark() {
        guard let file = sessionFile, !file.isEmpty else { return }
        InterruptedSessionStore.mark(file)
        onInFlightChange?(file, true)
    }

    private func clearInFlightMark() {
        guard let file = sessionFile, !file.isEmpty else { return }
        InterruptedSessionStore.clear(file)
        onInFlightChange?(file, false)
    }

    /// Green = unseen successful settle. Skip if already selected or unhealthy.
    private func markUnseenCompletionAfterSuccessfulSettle() {
        let healthy = lastError == nil && processAlive
        guard healthy else { return }
        if isSelectedCheck?() == true {
            hasUnseenCompletion = false
        } else {
            hasUnseenCompletion = true
        }
    }

    /// 调试用：直接塞一条 assistant 消息（PIPIUI_MD_DEMO 渲染验证钩子）
    func appendDebugAssistant(_ markdown: String) {
        transcript.append(ChatItem(id: nextItemId(), role: "assistant", blocks: [.text(markdown)]))
    }

    func flash(_ message: String) {
        lastError = message
    }
}

// MARK: - Subagent 控制

extension ChatSession {
    /// 中止运行中的后台 subagent：RPC prompt → 扩展注册的 `subagent_abort` 命令
    /// （与 pipiui_reload 同一传输通道）。面板不本地改状态——agent 以 aborted 结束后
    /// 经生命周期上报自然落终态；这里只置 abortPending 让按钮置灰防重复点击。
    func abortSubagent(_ agentId: String) {
        guard let proc else {
            flash("pi 未运行，无法中止 subagent")
            return
        }
        // agentId 形如 agent-xxxx-yyyy；拼进 prompt 字符串前拒绝空白/换行。
        guard !agentId.isEmpty,
              agentId.range(of: #"\s"#, options: .regularExpression) == nil else {
            flash("非法 agentId，无法中止")
            return
        }
        subagents.markAbortPending(agentId)
        proc.request(["type": "prompt", "message": "/subagent_abort \(agentId)"]) { [weak self] resp in
            guard let self else { return }
            if resp["success"].bool != true {
                self.subagents.clearAbortPending(agentId)
                self.flash(resp["error"].string ?? "中止 subagent 失败")
            }
        }
    }
}

// MARK: - BuiltinCommandHost

extension ChatSession: BuiltinCommandHost {
    func runCompact() {
        proc?.request(["type": "compact"]) { [weak self] resp in
            guard let self else { return }
            if resp["success"].bool != true {
                self.flash(resp["error"].string ?? "压缩失败")
            }
            // Success: existing compaction_start/end events append system lines.
        }
    }

    func runReload() {
        guard let proc else {
            flash("pi 未运行，无法重载")
            return
        }
        // Direct RPC prompt → extension command; do not use sendPrompt (builtin gate / queue).
        proc.request(["type": "prompt", "message": "/pipiui_reload"]) { [weak self] resp in
            guard let self else { return }
            if resp["success"].bool != true {
                self.flash(resp["error"].string ?? "重载失败")
                return
            }
            // Refresh command list (extension commands may have changed).
            proc.request(["type": "get_commands"]) { [weak self] r2 in
                guard let self else { return }
                if r2["success"].bool == true {
                    self.availableCommands = SlashCommandParser.parseGetCommandsResponse(r2)
                }
                self.flash("已重载扩展 / skills / prompts / 上下文")
            }
        }
    }

    func runSetSessionName(_ name: String) {
        setSessionName(name)
    }

    func runShowSessionStats() {
        // Refresh then flash current snapshot (callbacks update published fields).
        currentQuotaMonitor?.refreshIfNeeded(force: true)
        proc?.request(["type": "get_session_stats"]) { [weak self] resp in
            guard let self else { return }
            if resp["success"].bool == true {
                self.applySessionStats(resp["data"])
            }
            self.proc?.request(["type": "get_state"]) { [weak self] stateResp in
                guard let self else { return }
                self.applyState(stateResp["data"])
                let modelName = self.model?.id ?? "(无模型)"
                let name = self.sessionName ?? "(未命名)"
                let ctx = self.contextStatusText ?? "—"
                let quota: String = {
                    if let p = self.quotaPercent, let label = self.quotaPeriodLabel {
                        return "\(label)额度 \(Int(p.rounded()))%"
                    }
                    if let p = self.quotaPercent {
                        return "额度 \(Int(p.rounded()))%"
                    }
                    return "—"
                }()
                let file = self.sessionFile ?? "—"
                self.flash(
                    "会话：\(name)\n模型：\(modelName)\n上下文：\(ctx) · \(quota)\n文件：\(file)"
                )
            }
        }
    }

    func runExportHTML() {
        proc?.request(["type": "export_html"]) { [weak self] resp in
            guard let self else { return }
            if resp["success"].bool == true, let path = resp["data"]["path"].string {
                self.flash("已导出 HTML：\(path)")
                let url = URL(fileURLWithPath: path)
                NSWorkspace.shared.activateFileViewerSelecting([url])
            } else {
                self.flash(resp["error"].string ?? "导出失败")
            }
        }
    }

    func runCopyLastAssistant() {
        // Walk transcript from end for last assistant text blocks.
        for item in transcript.reversed() where item.role == "assistant" {
            let text = item.blocks.compactMap { block -> String? in
                if case .text(let t) = block { return t }
                return nil
            }.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty {
                let pb = NSPasteboard.general
                pb.clearContents()
                pb.setString(text, forType: .string)
                flash("已复制最后一条助手回复（\(text.count) 字符）")
                return
            }
        }
        flash("没有可复制的助手回复")
    }

    func runSetModel(providerSlashId: String) {
        let parts = providerSlashId.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2 else {
            flash("模型格式应为 provider/modelId，例如 openai/gpt-4o")
            return
        }
        let provider = String(parts[0])
        let modelId = String(parts[1])
        guard !provider.isEmpty, !modelId.isEmpty else {
            flash("模型格式应为 provider/modelId，例如 openai/gpt-4o")
            return
        }
        if let known = availableModels.first(where: { $0.provider == provider && $0.modelId == modelId }) {
            setModel(known)
        } else {
            setModel(ModelInfo(provider: provider, modelId: modelId, name: modelId, contextWindow: nil))
        }
    }
}
