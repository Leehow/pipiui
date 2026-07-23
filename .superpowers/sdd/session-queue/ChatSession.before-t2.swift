import Foundation
import Combine

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

enum ChatBlock: Equatable {
    case text(String)
    case thinking(String)
    case toolCall(ToolCallBlock)
    case image(ImageBlock)
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
    // 流式更新节流：每个 token delta 都刷 UI 会卡，按 50ms 合并
    private var pendingStreamMessage: J?
    private var streamFlushScheduled = false

    init(id: String, projectURL: URL, sessionPath: String?,
         bridgePort: UInt16 = 0, extensionPath: String? = nil,
         bossPromptPath: String? = nil) {
        self.id = id
        self.projectURL = projectURL

        var args: [String] = []
        if let sessionPath { args += ["--session", sessionPath] }
        if let bossPromptPath {
            args += ["--append-system-prompt", bossPromptPath]
        }
        var extraEnv: [String: String] = [:]
        if bridgePort > 0, let extensionPath {
            args += ["-e", extensionPath]
            extraEnv["PIPIUI_BRIDGE_PORT"] = String(bridgePort)
            extraEnv["PIPIUI_SESSION_KEY"] = id
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
    }

    private func applyState(_ data: J) {
        if let pid = data["model"]["provider"].string, let mid = data["model"]["id"].string {
            model = ModelInfo(provider: pid, modelId: mid, name: data["model"]["name"].string ?? mid)
        }
        thinkingLevel = data["thinkingLevel"].string ?? "off"
        isStreaming = data["isStreaming"].bool ?? isStreaming
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
            lastError = nil
        case "agent_settled":
            isStreaming = false
            streamingItem = nil
            refreshStats()
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

        // Dual delivery: multimodal RPC images + real on-disk paths.
        // Coding models often try `read /home/workdir/attachments/...` first; without a real
        // path that call fails even when vision works. Saving under .pi/attachments fixes it.
        var message = trimmed
        if !images.isEmpty {
            let paths = ImageAttachment.saveToProjectAttachments(images, projectURL: projectURL)
            message = ImageAttachment.messageWithAttachmentPaths(text: trimmed, paths: paths)
        }

        var cmd: [String: Any] = ["type": "prompt", "message": message]
        if !images.isEmpty {
            cmd["images"] = ImageAttachment.rpcPayload(from: images)
        }
        if isStreaming { cmd["streamingBehavior"] = "steer" }
        proc?.request(cmd) { [weak self] resp in
            if resp["success"].bool != true {
                self?.lastError = resp["error"].string ?? "发送失败"
            }
        }
    }

    func abort() {
        proc?.send(["type": "abort"])
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

    func shutdown() {
        proc?.terminate()
    }

    /// 调试用：直接塞一条 assistant 消息（PIPIUI_MD_DEMO 渲染验证钩子）
    func appendDebugAssistant(_ markdown: String) {
        transcript.append(ChatItem(id: nextItemId(), role: "assistant", blocks: [.text(markdown)]))
    }
}
