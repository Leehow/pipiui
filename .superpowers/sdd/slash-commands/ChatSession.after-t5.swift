import Foundation
import Combine
import AppKit

struct ModelInfo: Identifiable, Hashable {
    let provider: String
    let modelId: String
    let name: String
    var id: String { provider + "/" + modelId }
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
}

/// One live pi RPC session bound to a project directory.
/// All mutation happens on the main thread (PiProcess delivers callbacks there).
final class ChatSession: ObservableObject, Identifiable {
    let id: String
    let projectURL: URL

    @Published var transcript: [ChatItem] = []
    @Published var streamingItem: ChatItem?
    @Published var toolRuns: [String: ToolRun] = [:]
    @Published var isStreaming = false
    @Published var model: ModelInfo?
    @Published var availableModels: [ModelInfo] = []
    @Published var thinkingLevel = "off"
    @Published var thinkingLevels: [String] = ["off"]
    @Published var cost: Double = 0
    @Published var contextPercent: Double?
    @Published var sessionName: String?
    @Published var sessionFile: String?
    @Published var lastError: String?
    @Published var processAlive = true
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

    /// 内置浏览器，pi 的 browser_* 工具通过桥接服务驱动它
    lazy var webView = WebViewStore()

    /// pi 派出的 subagent 树（扩展通过桥接上报）
    let subagents = SubagentStore()

    var onSessionMetaChanged: (() -> Void)?
    private var proc: PiProcess?
    private var itemCounter = 0
    private var queue = SessionMessageQueue()
    /// True from prompt dispatch until agent_start (or failure / process death).
    @Published private(set) var isSendingFromQueue = false
    // 流式更新节流：每个 token delta 都刷 UI 会卡，按 50ms 合并
    private var pendingStreamMessage: J?
    private var streamFlushScheduled = false

    init(id: String, projectURL: URL, sessionPath: String?,
         bridgePort: UInt16 = 0,
         webviewExtension: String? = nil,
         subagentDir: String? = nil,
         agentsDir: String? = nil,
         bossPromptPath: String? = nil,
         blockedReason: String? = nil) {
        self.id = id
        self.projectURL = projectURL

        // 已知会必然崩的启动条件（例如扩展撞名）就别 spawn 了：
        // 让用户只看到那条能一键修的提示，而不是再叠一条 pi 崩溃日志
        if let blockedReason {
            lastError = blockedReason
            processAlive = false
            return
        }

        var args: [String] = []
        if let sessionPath { args += ["--session", sessionPath] }
        if let bossPromptPath {
            args += ["--append-system-prompt", bossPromptPath]
        }
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
            return
        }
        self.proc = proc
        proc.onEvent = { [weak self] event in self?.handleEvent(event) }
        proc.onExit = { [weak self] code, stderr in
            guard let self else { return }
            self.processAlive = false
            self.isStreaming = false
            self.isSendingFromQueue = false
            if code != 0 {
                self.lastError = "pi 进程退出 (code \(code))：\(stderr.suffix(300))"
            }
        }
        loadInitialState()
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
                return ModelInfo(provider: pid, modelId: mid, name: m["name"].string ?? mid)
            }
        }
        refreshThinkingLevels()
        proc?.request(["type": "get_messages"]) { [weak self] resp in
            guard let self else { return }
            self.transcript = []
            for message in resp["data"]["messages"].array {
                self.ingest(message: message)
            }
        }
        refreshStats()
        proc?.request(["type": "get_commands"]) { [weak self] resp in
            guard let self else { return }
            // Failure/empty → leave availableCommands empty; builtins still work. No flash.
            self.availableCommands = SlashCommandParser.parseGetCommandsResponse(resp)
        }
    }

    private func applyState(_ data: J) {
        if let pid = data["model"]["provider"].string, let mid = data["model"]["id"].string {
            model = ModelInfo(provider: pid, modelId: mid, name: data["model"]["name"].string ?? mid)
        }
        thinkingLevel = data["thinkingLevel"].string ?? "off"
        // get_state 与 agent_start 可能交错：只在本地未处于工作态时才采用远端 isStreaming，
        // 避免把已开始的流式状态盖回 false（#14）。
        if !isWorking, let remoteStreaming = data["isStreaming"].bool {
            isStreaming = remoteStreaming
        }
        sessionName = data["sessionName"].string ?? sessionName
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
            self.cost = resp["data"]["cost"].double ?? self.cost
            self.contextPercent = resp["data"]["contextUsage"]["percent"].double
        }
    }

    // MARK: - Event handling

    private func handleEvent(_ e: J) {
        switch e["type"].string ?? "" {
        case "agent_start":
            isStreaming = true
            isSendingFromQueue = false
            lastError = nil
        case "agent_settled":
            isStreaming = false
            streamingItem = nil
            refreshStats()
            // Drain first; only green when truly idle (no next queued prompt dispatched).
            drainQueueIfIdle()
            if !isWorking && messageQueue.isEmpty {
                markUnseenCompletionAfterSuccessfulSettle()
            }
            proc?.request(["type": "get_state"]) { [weak self] resp in
                self?.applyState(resp["data"])
                self?.onSessionMetaChanged?()
            }
        case "message_start":
            if e["message"]["role"].string == "assistant" {
                streamingItem = convert(message: e["message"], id: "streaming")
            }
        case "message_update":
            pendingStreamMessage = e["message"]
            scheduleStreamFlush()
        case "message_end":
            ingest(message: e["message"])
            if e["message"]["role"].string == "assistant" {
                pendingStreamMessage = nil
                streamingItem = nil
            }
        case "tool_execution_start":
            if let tid = e["toolCallId"].string {
                toolRuns[tid] = ToolRun(isRunning: true)
            }
        case "tool_execution_update":
            if let tid = e["toolCallId"].string {
                var run = toolRuns[tid] ?? ToolRun()
                run.isRunning = true
                run.output = Self.contentText(e["partialResult"]["content"])
                toolRuns[tid] = run
            }
        case "tool_execution_end":
            if let tid = e["toolCallId"].string {
                toolRuns[tid] = ToolRun(
                    isRunning: false,
                    isError: e["isError"].bool ?? false,
                    output: Self.contentText(e["result"]["content"])
                )
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
        default:
            break
        }
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
                self.streamingItem = self.convert(message: message, id: "streaming")
            }
        }
    }

    private func appendSystem(_ text: String) {
        transcript.append(ChatItem(id: nextItemId(), role: "system", blocks: [.text(text)]))
    }

    // MARK: - Message conversion

    private func ingest(message: J) {
        switch message["role"].string ?? "" {
        case "user":
            if let item = convert(message: message, id: nextItemId()),
               !item.blocks.isEmpty { transcript.append(item) }
        case "assistant":
            if let item = convert(message: message, id: nextItemId()) { transcript.append(item) }
        case "toolResult":
            if let tid = message["toolCallId"].string {
                toolRuns[tid] = ToolRun(
                    isRunning: false,
                    isError: message["isError"].bool ?? false,
                    output: Self.contentText(message["content"])
                )
            }
        case "bashExecution":
            let cmd = message["command"].string ?? ""
            let out = message["output"].string ?? ""
            appendSystem("$ \(cmd)\n\(out)")
        default:
            break
        }
    }

    private func convert(message: J, id: String) -> ChatItem? {
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

    /// Supports RPC/session shapes:
    /// - `{ type, data, mimeType }`
    /// - `{ type, source: { type: "base64", mediaType, data } }`
    static func parseImageBlock(_ block: J) -> ImageBlock? {
        let b64: String?
        let mime: String
        if block["source"].exists {
            b64 = block["source"]["data"].string
            mime = block["source"]["mediaType"].string
                ?? block["source"]["mimeType"].string
                ?? "image/png"
        } else {
            b64 = block["data"].string
            mime = block["mimeType"].string ?? block["mediaType"].string ?? "image/png"
        }
        guard let b64, let data = Data(base64Encoded: b64), !data.isEmpty else { return nil }
        return ImageBlock(
            id: block["id"].string ?? UUID().uuidString,
            data: data,
            mimeType: mime
        )
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
            blocks.append(.image(ImageBlock(id: UUID().uuidString, data: data, mimeType: mime)))
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
        // Cover first-send / drain gap before agent_start so sidebar shows spinner, not green.
        isSendingFromQueue = true
        var cmd: [String: Any] = ["type": "prompt", "message": message]
        if !images.isEmpty {
            cmd["images"] = ImageAttachment.rpcPayload(from: images)
        }
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
        // intercept flag only; items stay until idle drain
        proc?.send(["type": "abort"])
    }

    /// Drain queue head when agent is idle. Call only from agent_settled (not applyState / process death).
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
                self.refreshThinkingLevels()
                self.proc?.request(["type": "get_state"]) { [weak self] r in self?.applyState(r["data"]) }
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
        proc?.request(["type": "set_session_name", "name": trimmed]) { [weak self] resp in
            guard let self else { return }
            if resp["success"].bool == true {
                self.sessionName = trimmed
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

    func runSetSessionName(_ name: String) {
        setSessionName(name)
    }

    func runShowSessionStats() {
        // Refresh then flash current snapshot (callbacks update published fields).
        proc?.request(["type": "get_session_stats"]) { [weak self] resp in
            guard let self else { return }
            if resp["success"].bool == true {
                self.cost = resp["data"]["cost"].double ?? self.cost
                self.contextPercent = resp["data"]["contextUsage"]["percent"].double
            }
            self.proc?.request(["type": "get_state"]) { [weak self] stateResp in
                guard let self else { return }
                self.applyState(stateResp["data"])
                let modelName = self.model?.id ?? "(无模型)"
                let name = self.sessionName ?? "(未命名)"
                let pct: String = {
                    if let p = self.contextPercent { return "\(Int(p))%" }
                    return "—"
                }()
                let file = self.sessionFile ?? "—"
                self.flash(
                    "会话：\(name)\n模型：\(modelName)\n费用：$\(String(format: "%.4f", self.cost)) · 上下文：\(pct)\n文件：\(file)"
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
            setModel(ModelInfo(provider: provider, modelId: modelId, name: modelId))
        }
    }
}
