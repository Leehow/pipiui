import Foundation
import Combine
import AppKit

struct ModelInfo: Identifiable, Hashable {
    let provider: String
    let modelId: String
    let name: String
    let contextWindow: Int?
    var id: String { provider + "/" + modelId }

    /// Whether this model belongs to a Grok/xAI provider (used to gate Grok account credit display).
    var isGrokProvider: Bool {
        let p = provider.lowercased()
        let i = modelId.lowercased()
        return p.contains("grok") || p == "xai" || i.contains("grok")
    }
}

struct ToolCallBlock: Identifiable, Equatable {
    let id: String
    let name: String
    let argsSummary: String
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

/// One live pi RPC session bound to a project directory.
/// Published state is mutated on the main thread (PiProcess delivers callbacks there).
/// Heavy initial transcript conversion (image disk/base64) may run off-main before a single assign.
final class ChatSession: ObservableObject, Identifiable {
    let id: String
    let projectURL: URL

    @Published var transcript: [ChatItem] = []
    @Published var streamingItem: ChatItem?
    @Published var toolRuns: [String: ToolRun] = [:]
    /// Monotonic counter bumped when toolRuns actually changes (UI watches this instead of scanning outputs).
    @Published private(set) var toolOutputVersion: UInt64 = 0
    @Published var isStreaming = false
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
    /// Grok/xAI account credit usage 0…100 (nil when unavailable).
    @Published var quotaPercent: Double?
    /// Compact period label: 周 / 月 / 额.
    @Published var quotaPeriodLabel: String?
    /// Tooltip for quota pill: 周额度 / 月额度 / 额度.
    @Published var quotaPeriodHelp: String?
    /// Multi-period usage breakdown from Grok billing (empty when unavailable).
    @Published var periods: [PeriodUsage] = []
    /// User-selected period typeRaw to show in the capsule (persisted per account).
    @Published private(set) var selectedPeriodTypeRaw: Int?
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
    /// Local follow-up queue mirror for SwiftUI (busy Enter enqueues here).
    @Published private(set) var messageQueue: [QueuedMessage] = []
    /// In-memory composer draft (per session; not persisted).
    @Published var draftText: String = ""
    @Published var draftImages: [DraftImage] = []
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

    /// 右侧面板：内置浏览器 / subagent 树
    enum RightPanel: Equatable { case web, agents }
    @Published var rightPanel: RightPanel?

    /// Per-session transcript window (survives detail view reuse when switching sessions).
    @Published var transcriptVisibleCount: Int = 150
    /// Per-session stick-to-bottom preference.
    @Published var pinTranscriptToBottom: Bool = true

    /// 内置浏览器，pi 的 browser_* 工具通过桥接服务驱动它
    lazy var webView = WebViewStore()

    /// pi 派出的 subagent 树（扩展通过桥接上报）
    let subagents = SubagentStore()

    var onSessionMetaChanged: (() -> Void)?
    /// Fired only when the user actually submits a prompt (not resume / name / settle).
    var onUserSubmitted: (() -> Void)?
    private var proc: PiProcess?
    private var itemCounter = 0
    private var queue = SessionMessageQueue()
    /// True from prompt dispatch until agent_start (or failure / process death).
    @Published private(set) var isSendingFromQueue = false
    /// Historical ghost title prompts in old session files (ingest skip only; never sent on main proc).
    static let sessionTitleJobMarker = "[PipiUI internal — session title"
    /// After skipping a historical ghost title user message on load/ingest, drop the following assistant turn.
    private var skipNextAssistantIngest = false
    // 流式更新节流：每个 token delta 都刷 UI 会卡，按 50ms 合并
    private var pendingStreamMessage: J?
    private var streamFlushScheduled = false
    // 工具输出分片同样节流：高频 tool_execution_update 直接刷 toolRuns 会拖垮布局
    private var pendingToolRuns: [String: ToolRun] = [:]
    private var toolRunFlushScheduled = false
    /// Grok quota monitor subscription (shared app-wide cache).
    private var quotaObserverID: UUID?

    /// Bumped when a new initial `get_messages` load starts; stale background builds are dropped.
    private var initialLoadGeneration: UInt64 = 0
    /// True until the first `get_messages` transcript is applied (or the request settles empty/failed).
    /// Runtime assumption (verify in app): pi may emit agent/message/tool events before `get_messages`
    /// completes; those are deferred and replayed after the one-shot transcript assign so they are not wiped.
    private var awaitingInitialTranscript = false
    private var deferredInitialEvents: [J] = []

    init(id: String, projectURL: URL, sessionPath: String?,
         bridgePort: UInt16 = 0,
         webviewExtension: String? = nil,
         mediaExtension: String? = nil,
         gitExtension: String? = nil,
         reloadExtension: String? = nil,
         subagentDir: String? = nil,
         agentsDir: String? = nil,
         bossPromptPath: String? = nil,
         blockedReason: String? = nil) {
        self.id = id
        self.projectURL = projectURL
        self.resumedFromDisk = sessionPath != nil
        // Worktree auto-merge target (successful subagents → merge into session project root).
        subagents.bindMainProject(projectURL)
        // Attribute per-turn usage events to this session in the token ledger.
        subagents.sessionKey = id

        // 已知会必然崩的启动条件（例如扩展撞名）就别 spawn 了：
        // 让用户只看到那条能一键修的提示，而不是再叠一条 pi 崩溃日志
        if let blockedReason {
            lastError = blockedReason
            processAlive = false
            isInitializing = false
            bindQuotaMonitor()
            return
        }

        var args: [String] = []
        if let sessionPath { args += ["--session", sessionPath] }
        if let bossPromptPath {
            args += ["--append-system-prompt", bossPromptPath]
        }
        // 对话内 generate_image / git / reload：不依赖 bridge
        if let mediaExtension { args += ["-e", mediaExtension] }
        if let gitExtension { args += ["-e", gitExtension] }
        if let reloadExtension { args += ["-e", reloadExtension] }
        var extraEnv: [String: String] = [:]
        // App 自有插件通过 -e 加载：webview 工具 + 补丁版 subagent（覆盖自动发现的官方版）
        if bridgePort > 0 {
            if let webviewExtension { args += ["-e", webviewExtension] }
            if let subagentDir {
                args += ["-e", subagentDir]
                // Nested subagent pi processes re-read this to pass `-e` again (#3).
                extraEnv["PIPIUI_SUBAGENT_EXT"] = subagentDir
            }
            extraEnv["PIPIUI_BRIDGE_PORT"] = String(bridgePort)
            extraEnv["PIPIUI_SESSION_KEY"] = id
            // 补丁版 subagent 从 App 自有目录读 agent 定义，不碰 ~/.pi/agent/agents
            if let agentsDir { extraEnv["PIPIUI_AGENTS_DIR"] = agentsDir }
        }
        guard let proc = PiProcess(cwd: projectURL, arguments: args, extraEnv: extraEnv) else {
            lastError = "找不到 pi 可执行文件（试过 ~/.npm-global/bin、/opt/homebrew/bin 等）"
            processAlive = false
            isInitializing = false
            return
        }
        self.proc = proc
        proc.onEvent = { [weak self] event in self?.handleEvent(event) }
        proc.onExit = { [weak self] code, stderr in
            guard let self else { return }
            self.processAlive = false
            self.isStreaming = false
            self.isSendingFromQueue = false
            // Exit before the first transcript arrives must not leave the spinner up.
            self.isInitializing = false
            self.titleLLMTask?.cancel()
            self.titleLLMTask = nil
            if code != 0 {
                self.lastError = "pi 进程退出 (code \(code))：\(stderr.suffix(300))"
            }
        }
        loadInitialState()
        bindQuotaMonitor()
    }

    deinit {
        if let quotaObserverID {
            let id = quotaObserverID
            // deinit may leave the main thread; hop back before touching the monitor.
            DispatchQueue.main.async {
                GrokQuotaMonitor.shared.removeObserver(id)
            }
        }
    }

    private func bindQuotaMonitor() {
        quotaObserverID = GrokQuotaMonitor.shared.observe { [weak self] snap in
            guard let self else { return }
            self.periods = snap?.periods ?? []
            self.recomputeQuotaDisplay(
                usedPercent: snap?.usedPercent,
                periodLabel: snap?.periodLabel ?? "额",
                periodHelp: snap?.periodHelp ?? "额度"
            )
        }
    }

    /// Derive capsule display (quotaPercent/quotaPeriodLabel) from selected period;
    /// falls back to highest-usage period, then to the top-level usedPercent.
    private func recomputeQuotaDisplay(usedPercent: Double?, periodLabel: String, periodHelp: String) {
        if selectedPeriodTypeRaw == nil,
           let aid = GrokAuthStore.load()?.accountId, !aid.isEmpty {
            selectedPeriodTypeRaw = LayoutPersistence.grokQuotaSelectedPeriod(accountId: aid)
        }
        quotaPeriodHelp = periodHelp
        if periods.isEmpty {
            quotaPercent = usedPercent
            quotaPeriodLabel = periodLabel
            return
        }
        let r = GrokQuotaDisplay.resolve(
            periods: periods,
            selected: selectedPeriodTypeRaw,
            fallbackPercent: usedPercent,
            fallbackLabel: periodLabel
        )
        quotaPercent = r.percent
        quotaPeriodLabel = r.label
    }

    /// User picked a period in the popover → persist per account + refresh capsule.
    func selectPeriod(typeRaw: Int) {
        selectedPeriodTypeRaw = typeRaw
        if let aid = GrokAuthStore.load()?.accountId, !aid.isEmpty {
            LayoutPersistence.setGrokQuotaSelectedPeriod(typeRaw, accountId: aid)
        }
        let snap = GrokQuotaMonitor.shared.snapshot
        recomputeQuotaDisplay(
            usedPercent: snap?.usedPercent,
            periodLabel: snap?.periodLabel ?? "额",
            periodHelp: snap?.periodHelp ?? "额度"
        )
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
                guard let pid = m["provider"].string, let mid = m["id"].string else { return nil }
                return ModelInfo(provider: pid, modelId: mid, name: m["name"].string ?? mid, contextWindow: m["contextWindow"].int)
            }
        }
        refreshThinkingLevels()
        beginInitialMessagesLoad()
        refreshStats()
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

            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let buildStart = DispatchTime.now()
                let built: InitialTranscriptBuild
                if success {
                    built = Self.buildTranscript(from: messages)
                } else {
                    built = InitialTranscriptBuild(
                        items: [],
                        toolRuns: [:],
                        itemCounter: 0,
                        skipNextAssistantIngest: false
                    )
                }
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

    /// Apply a background-built history once; drop if generation is stale (session recycled / re-load).
    private func applyInitialTranscript(_ built: InitialTranscriptBuild, generation: UInt64) {
        guard generation == initialLoadGeneration else { return }
        guard awaitingInitialTranscript else { return }

        // Optimistic local bubbles (rare: user sent while history still loading) stay after history.
        // Re-id them so they cannot collide with history `item-N` ids from the build.
        let extras = transcript
        var counter = max(itemCounter, built.itemCounter)
        let rebasedExtras: [ChatItem] = extras.map { item in
            counter += 1
            return ChatItem(id: "item-\(counter)", role: item.role, blocks: item.blocks)
        }

        itemCounter = counter
        skipNextAssistantIngest = built.skipNextAssistantIngest

        // History toolRuns first; any live runs already on self win (should be empty while gated).
        var mergedRuns = built.toolRuns
        for (tid, run) in toolRuns {
            mergedRuns[tid] = run
        }
        toolRuns = mergedRuns
        if !built.toolRuns.isEmpty || !rebasedExtras.isEmpty {
            toolOutputVersion &+= 1
        }

        // Single assignment — avoid per-message @Published churn.
        transcript = built.items + rebasedExtras

        awaitingInitialTranscript = false
        isInitializing = false
        let deferred = deferredInitialEvents
        deferredInitialEvents.removeAll(keepingCapacity: false)
        for event in deferred {
            handleEvent(event)
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
            // Update window immediately from get_state model; keep existing tokens, re-derive %.
            if let w = data["model"]["contextWindow"].int, w > 0 {
                contextWindow = w
                if let t = contextTokens, w > 0 {
                    contextPercent = min(100.0, Double(t) / Double(w) * 100.0)
                }
            }
        }
        thinkingLevel = data["thinkingLevel"].string ?? "off"
        // get_state 与 agent_start 可能交错：只在本地未处于工作态时才采用远端 isStreaming，
        // 避免把已开始的流式状态盖回 false（#14）。
        if !isWorking, let remoteStreaming = data["isStreaming"].bool {
            isStreaming = remoteStreaming
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

    /// Parse `get_session_stats` payload into published context/cost fields.
    private func applySessionStats(_ data: J) {
        cost = data["cost"].double ?? cost
        let merged = SessionStatsMerge.apply(
            contextUsage: data["contextUsage"],
            to: .init(tokens: contextTokens, window: contextWindow, percent: contextPercent)
        )
        contextTokens = merged.tokens
        contextWindow = merged.window
        contextPercent = merged.percent
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
            usage: usage
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
            isSendingFromQueue = false
            lastError = nil
        case "agent_settled":
            isStreaming = false
            streamingItem = nil
            refreshStats()
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
                streamingItem = Self.convert(message: e["message"], id: "streaming")
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
                    images: Self.contentImages(content)
                )
                toolOutputVersion &+= 1
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
            if let raw = Self.convert(message: message, id: nextItemId()), !raw.blocks.isEmpty {
                let item = Self.hydrateUserImagesIfNeeded(raw)
                // Replace optimistic local user bubble when the server echoes the same turn.
                if let lastIdx = transcript.indices.last,
                   Self.shouldReplaceOptimisticUser(existing: transcript[lastIdx], incoming: item) {
                    let keepId = transcript[lastIdx].id
                    transcript[lastIdx] = ChatItem(id: keepId, role: item.role, blocks: item.blocks)
                } else {
                    transcript.append(item)
                }
            }
        case "assistant":
            if skipNextAssistantIngest {
                skipNextAssistantIngest = false
                return
            }
            if let item = Self.convert(message: message, id: nextItemId()) { transcript.append(item) }
        case "toolResult":
            if let tid = message["toolCallId"].string {
                pendingToolRuns.removeValue(forKey: tid)
                let content = message["content"]
                toolRuns[tid] = ToolRun(
                    isRunning: false,
                    isError: message["isError"].bool ?? false,
                    output: Self.contentText(content),
                    images: Self.contentImages(content)
                )
                toolOutputVersion &+= 1
            }
        case "bashExecution":
            let cmd = message["command"].string ?? ""
            let out = message["output"].string ?? ""
            appendSystem("$ \(cmd)\n\(out)")
        default:
            break
        }
    }

    /// Convert one pi message JSON into a `ChatItem` (image base64/path I/O may run here).
    package static func convert(message: J, id: String) -> ChatItem? {
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
                    blocks.append(.toolCall(ToolCallBlock(
                        id: block["id"].string ?? UUID().uuidString,
                        name: name,
                        argsSummary: Self.argsSummary(name: name, args: block["arguments"])
                    )))
                case "image":
                    if let imageBlock = Self.parseImageBlock(block) {
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
    package static func buildTranscript(from messages: [J]) -> InitialTranscriptBuild {
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
                if let raw = convert(message: message, id: nextId()), !raw.blocks.isEmpty {
                    items.append(hydrateUserImagesIfNeeded(raw))
                }
            case "assistant":
                if skipNextAssistantIngest {
                    skipNextAssistantIngest = false
                    continue
                }
                if let item = convert(message: message, id: nextId()) {
                    items.append(item)
                }
            case "toolResult":
                if let tid = message["toolCallId"].string {
                    let content = message["content"]
                    toolRuns[tid] = ToolRun(
                        isRunning: false,
                        isError: message["isError"].bool ?? false,
                        output: contentText(content),
                        images: contentImages(content)
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
    static func parseImageBlock(_ block: J) -> ImageBlock? {
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
        if data == nil || data?.isEmpty == true, let resolvedPath,
           FileManager.default.fileExists(atPath: resolvedPath) {
            data = try? Data(contentsOf: URL(fileURLWithPath: resolvedPath))
            if mime == "image/png" || mime.isEmpty {
                mime = Self.mimeType(forImagePath: resolvedPath) ?? mime
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
    package static func hydrateUserImagesIfNeeded(_ item: ChatItem) -> ChatItem {
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
                guard FileManager.default.fileExists(atPath: p),
                      let data = try? Data(contentsOf: URL(fileURLWithPath: p)),
                      !data.isEmpty else { continue }
                imageBlocks.append(ImageBlock(
                    id: UUID().uuidString,
                    data: data,
                    mimeType: mimeType(forImagePath: p) ?? "image/png",
                    path: p
                ))
            }
        }

        // Prefer images-first layout (matches optimistic send).
        var blocks: [ChatBlock] = imageBlocks.map { .image($0) }
        blocks.append(contentsOf: nonImage)
        return ChatItem(id: item.id, role: item.role, blocks: blocks)
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
        if let cmd = args["command"].string { return cmd }
        if let path = args["path"].string { return path }
        if let path = args["file_path"].string { return path }
        let compact = args.compactJSON
        return compact.count > 120 ? String(compact.prefix(120)) + "…" : compact
    }

    static func contentText(_ content: J) -> String {
        if let s = content.string { return s }
        return content.array
            .compactMap { $0["type"].string == "text" ? $0["text"].string : nil }
            .joined(separator: "\n")
    }

    /// Images from tool result content (e.g. generate_image / browser_screenshot).
    static func contentImages(_ content: J) -> [ImageBlock] {
        content.array.compactMap { block -> ImageBlock? in
            guard block["type"].string == "image" else { return nil }
            return parseImageBlock(block)
        }
    }

    // MARK: - User actions

    func sendPrompt(_ text: String, images: [DraftImage] = []) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || !images.isEmpty else { return }

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
        transcript.append(ChatItem(id: nextItemId(), role: "user", blocks: userBlocks))

        Task { [weak self] in
            guard let self else { return }
            do {
                let result = try await MediaClient.generate(
                    model: model,
                    prompt: prompt,
                    referenceImages: images,
                    projectURL: self.projectURL,
                    progress: { [weak self] status in
                        DispatchQueue.main.async { self?.mediaStatus = status }
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
        transcript.append(ChatItem(id: nextItemId(), role: "assistant", blocks: blocks))
    }

    /// Dual delivery: multimodal RPC images + real on-disk paths.
    /// Coding models often try `read .../attachments/...` first; saving under .pi/attachments fixes it.
    private func prepareMessage(text: String, images: [DraftImage]) -> (message: String, images: [DraftImage]) {
        var message = text
        if !images.isEmpty {
            let paths = ImageAttachment.saveToProjectAttachments(images, projectURL: projectURL)
            message = ImageAttachment.messageWithAttachmentPaths(text: text, paths: paths)
        }
        return (message, images)
    }

    private func sendPromptNow(message: String, images: [DraftImage], requeueOnFailure: QueuedMessage? = nil) {
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
                    self.queue.requeueFront(requeueOnFailure)
                    self.publishQueue()
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
                GrokQuotaMonitor.shared.refreshIfNeeded(force: true)
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
        cancelSideChannelTitle()
        if let quotaObserverID {
            GrokQuotaMonitor.shared.removeObserver(quotaObserverID)
            self.quotaObserverID = nil
        }
        subagents.saveNow()
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

    /// Clear the sidebar green badge after the user opens/selects this session.
    func markCompletionSeen() {
        if hasUnseenCompletion { hasUnseenCompletion = false }
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
        GrokQuotaMonitor.shared.refreshIfNeeded(force: true)
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
