import Foundation
import Combine

/// subagent 工作流水里的一条记录（文本/思考/工具调用/工具结果）。
struct AgentLogItem: Identifiable, Equatable, Codable, Sendable {
    let id: Int
    let kind: String // text / thinking / tool / toolResult
    let name: String
    let text: String
    let isError: Bool
}

/// Worktree lifecycle for a subagent (create → review → merge/discard).
enum WorktreeLifecycle: String, Codable, Equatable, Sendable {
    /// No worktree attached (or unknown legacy).
    case none
    /// Agent is running inside the worktree.
    case active
    /// Agent finished (ok/failed/aborted/interrupted); worktree still present for review.
    case pendingReview
    /// Merged into main worktree and removed.
    case merged
    /// Discarded (removed without merge).
    case discarded
}

/// 一个被派出的 subagent 的实时状态（由扩展通过桥接上报）。
struct SubagentInfo: Identifiable, Equatable, Codable, Sendable {
    enum State: String, Equatable, Codable {
        case running, ok, failed, aborted
        /// App 重启时仍在运行的 agent：进程已不在，标记为中断
        case interrupted
    }

    let id: String
    let parentId: String?
    /// 派出它的主会话 subagent 工具调用 id（用于主界面卡片归属匹配）
    var toolCallId: String?
    let name: String
    let task: String
    /// 短标题：Subagents 面板列表用它替代冗长任务书；为空则回退到 task。
    var title: String?
    let depth: Int
    let model: String?
    var state: State = .running
    var output = ""
    /// 当前工具活动（如 `bash {"command":…}`）；仅详情区展示，不进列表副标题。
    var activity = ""
    var log: [AgentLogItem] = []
    var cost: Double = 0
    var turns = 0
    var started = Date()
    var ended: Date?
    /// Isolated git worktree path when auto-created for this agent.
    var worktreePath: String? = nil
    var worktreeBranch: String? = nil
    /// Set when worktree was requested but creation failed (spawn fell back).
    var worktreeError: String? = nil
    /// Worktree lifecycle for review/merge UI.
    var worktreeLifecycle: WorktreeLifecycle = .none
    /// Attested smoke-verify command reported at agent end; re-run in main repo after merge.
    var verifyCommand: String? = nil
    /// Latest turn context occupancy (from usage.totalTokens / contextTokens).
    var contextTokens: Int = 0
    /// Model context window when known.
    var contextWindow: Int? = nil
    /// Cumulative token usage across turns (for detail metrics line).
    var totalInput: Int = 0
    var totalOutput: Int = 0
    var totalCacheRead: Int = 0
    var totalCacheWrite: Int = 0

    /// 列表副标题：始终用 title（或 task），运行中也不被 activity JSON 盖住。
    var listSubtitle: String {
        if let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return title
        }
        return task
    }

    /// Display title for detail metrics line.
    var displayTitle: String {
        if let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return title
        }
        return task
    }

    /// Cumulative input+output tokens.
    var totalTokens: Int { totalInput + totalOutput }

    /// Session-level cache hit rate; nil when no input-side tokens yet.
    var cacheHitRate: Double? {
        let denom = totalInput + totalCacheRead + totalCacheWrite
        return denom > 0 ? Double(totalCacheRead) / Double(denom) : nil
    }

    /// Accumulate one turn of usage; refresh latest context snapshot.
    mutating func applyUsage(_ usage: TokenLedger.UsageSnapshot, contextWindow window: Int?) {
        totalInput += usage.input
        totalOutput += usage.output
        totalCacheRead += usage.cacheRead
        totalCacheWrite += usage.cacheWrite
        if usage.contextTokens > 0 {
            contextTokens = usage.contextTokens
        }
        if let window, window > 0 {
            contextWindow = window
        }
    }

    enum CodingKeys: String, CodingKey {
        case id, parentId, toolCallId, name, task, title, depth, model
        case state, output, activity, log, cost, turns, started, ended
        case worktreePath, worktreeBranch, worktreeError, worktreeLifecycle
        case verifyCommand
        case contextTokens, contextWindow
        case totalInput, totalOutput, totalCacheRead, totalCacheWrite
    }

    init(
        id: String,
        parentId: String?,
        toolCallId: String? = nil,
        name: String,
        task: String,
        title: String? = nil,
        depth: Int,
        model: String?,
        state: State = .running,
        output: String = "",
        activity: String = "",
        log: [AgentLogItem] = [],
        cost: Double = 0,
        turns: Int = 0,
        started: Date = Date(),
        ended: Date? = nil,
        worktreePath: String? = nil,
        worktreeBranch: String? = nil,
        worktreeError: String? = nil,
        worktreeLifecycle: WorktreeLifecycle = .none,
        verifyCommand: String? = nil,
        contextTokens: Int = 0,
        contextWindow: Int? = nil,
        totalInput: Int = 0,
        totalOutput: Int = 0,
        totalCacheRead: Int = 0,
        totalCacheWrite: Int = 0
    ) {
        self.id = id
        self.parentId = parentId
        self.toolCallId = toolCallId
        self.name = name
        self.task = task
        self.title = title
        self.depth = depth
        self.model = model
        self.state = state
        self.output = output
        self.activity = activity
        self.log = log
        self.cost = cost
        self.turns = turns
        self.started = started
        self.ended = ended
        self.worktreePath = worktreePath
        self.worktreeBranch = worktreeBranch
        self.worktreeError = worktreeError
        self.worktreeLifecycle = worktreeLifecycle
        self.verifyCommand = verifyCommand
        self.contextTokens = contextTokens
        self.contextWindow = contextWindow
        self.totalInput = totalInput
        self.totalOutput = totalOutput
        self.totalCacheRead = totalCacheRead
        self.totalCacheWrite = totalCacheWrite
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        parentId = try c.decodeIfPresent(String.self, forKey: .parentId)
        toolCallId = try c.decodeIfPresent(String.self, forKey: .toolCallId)
        name = try c.decode(String.self, forKey: .name)
        task = try c.decode(String.self, forKey: .task)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        depth = try c.decode(Int.self, forKey: .depth)
        model = try c.decodeIfPresent(String.self, forKey: .model)
        state = try c.decodeIfPresent(State.self, forKey: .state) ?? .running
        output = try c.decodeIfPresent(String.self, forKey: .output) ?? ""
        activity = try c.decodeIfPresent(String.self, forKey: .activity) ?? ""
        log = try c.decodeIfPresent([AgentLogItem].self, forKey: .log) ?? []
        cost = try c.decodeIfPresent(Double.self, forKey: .cost) ?? 0
        turns = try c.decodeIfPresent(Int.self, forKey: .turns) ?? 0
        started = try c.decodeIfPresent(Date.self, forKey: .started) ?? Date()
        ended = try c.decodeIfPresent(Date.self, forKey: .ended)
        worktreePath = try c.decodeIfPresent(String.self, forKey: .worktreePath)
        worktreeBranch = try c.decodeIfPresent(String.self, forKey: .worktreeBranch)
        worktreeError = try c.decodeIfPresent(String.self, forKey: .worktreeError)
        var life = try c.decodeIfPresent(WorktreeLifecycle.self, forKey: .worktreeLifecycle) ?? .none
        if life == .none {
            life = Self.inferredLifecycle(state: state, path: worktreePath)
        }
        worktreeLifecycle = life
        verifyCommand = try c.decodeIfPresent(String.self, forKey: .verifyCommand)
        contextTokens = try c.decodeIfPresent(Int.self, forKey: .contextTokens) ?? 0
        contextWindow = try c.decodeIfPresent(Int.self, forKey: .contextWindow)
        totalInput = try c.decodeIfPresent(Int.self, forKey: .totalInput) ?? 0
        totalOutput = try c.decodeIfPresent(Int.self, forKey: .totalOutput) ?? 0
        totalCacheRead = try c.decodeIfPresent(Int.self, forKey: .totalCacheRead) ?? 0
        totalCacheWrite = try c.decodeIfPresent(Int.self, forKey: .totalCacheWrite) ?? 0
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encodeIfPresent(parentId, forKey: .parentId)
        try c.encodeIfPresent(toolCallId, forKey: .toolCallId)
        try c.encode(name, forKey: .name)
        try c.encode(task, forKey: .task)
        try c.encodeIfPresent(title, forKey: .title)
        try c.encode(depth, forKey: .depth)
        try c.encodeIfPresent(model, forKey: .model)
        try c.encode(state, forKey: .state)
        try c.encode(output, forKey: .output)
        try c.encode(activity, forKey: .activity)
        try c.encode(log, forKey: .log)
        try c.encode(cost, forKey: .cost)
        try c.encode(turns, forKey: .turns)
        try c.encode(started, forKey: .started)
        try c.encodeIfPresent(ended, forKey: .ended)
        try c.encodeIfPresent(worktreePath, forKey: .worktreePath)
        try c.encodeIfPresent(worktreeBranch, forKey: .worktreeBranch)
        try c.encodeIfPresent(worktreeError, forKey: .worktreeError)
        try c.encode(worktreeLifecycle, forKey: .worktreeLifecycle)
        try c.encodeIfPresent(verifyCommand, forKey: .verifyCommand)
        try c.encode(contextTokens, forKey: .contextTokens)
        try c.encodeIfPresent(contextWindow, forKey: .contextWindow)
        try c.encode(totalInput, forKey: .totalInput)
        try c.encode(totalOutput, forKey: .totalOutput)
        try c.encode(totalCacheRead, forKey: .totalCacheRead)
        try c.encode(totalCacheWrite, forKey: .totalCacheWrite)
    }

    /// Infer lifecycle for legacy rows that lack an explicit field.
    static func inferredLifecycle(state: State, path: String?) -> WorktreeLifecycle {
        guard let path, !path.isEmpty else { return .none }
        switch state {
        case .running:
            return .active
        case .ok, .failed, .aborted, .interrupted:
            return .pendingReview
        }
    }

    /// Path still present and eligible for merge/discard UI.
    var canReviewWorktree: Bool {
        guard let path = worktreePath, !path.isEmpty else { return false }
        guard let branch = worktreeBranch, !branch.isEmpty else { return false }
        switch worktreeLifecycle {
        case .pendingReview:
            return true
        case .none:
            // Legacy terminal agents with path
            return state != .running
        case .active:
            return state != .running
        case .merged, .discarded:
            return false
        }
    }

    var hasWorktreeMeta: Bool {
        if let b = worktreeBranch, !b.isEmpty { return true }
        if let p = worktreePath, !p.isEmpty { return true }
        if let e = worktreeError, !e.isEmpty { return true }
        switch worktreeLifecycle {
        case .merged, .discarded, .pendingReview, .active:
            return true
        case .none:
            return false
        }
    }
}

/// 后台 git 操作结果（detached 任务返回值，跨线程传递）。
private enum MergeGitOutcome: Sendable {
    case ok
    case mergeFailed(String)
    case removeFailed(String)
}

/// Compact strings for the subagent detail metrics line.
enum SubagentMetricsLine {
    struct Parts: Equatable {
        var title: String
        var context: String?
        var cache: String?
        var sum: String?
    }

    static func parts(for agent: SubagentInfo) -> Parts {
        var context: String?
        if agent.contextTokens > 0 {
            if let w = agent.contextWindow, w > 0 {
                context = "\(TokenFormat.compact(agent.contextTokens))/\(TokenFormat.compact(w))"
            } else {
                context = TokenFormat.compact(agent.contextTokens)
            }
        }
        var cache: String?
        if let hit = agent.cacheHitRate {
            cache = "缓存 \(Int((hit * 100).rounded()))%"
        }
        var sum: String?
        if agent.totalTokens > 0 {
            sum = "Σ \(TokenFormat.compact(agent.totalTokens))"
        }
        return Parts(title: agent.displayTitle, context: context, cache: cache, sum: sum)
    }
}

/// Injected when auto/manual worktree merge fails so the main agent can decide next steps.
enum WorktreeMergeFailedMessage {
    static let prefix = "[worktree-merge-failed]"

    static func format(agent: SubagentInfo, error: String) -> String {
        let branch = agent.worktreeBranch ?? "?"
        let path = agent.worktreePath ?? "?"
        return [
            "\(prefix) agentId=\(agent.id) name=\(agent.name) branch=\(branch) path=\(path)",
            "",
            "error:",
            error,
            "",
            "Worktree 仍保留（pendingReview）。请你自行决策并处理：优先用 git/read/subagent 工具解决（例如查看主工作区与分支差异、在主仓合理 stash/commit 后重试合并、解决冲突、或丢弃过时 worktree）。只有无法自行裁决的歧义或不可逆选择时才简短问用户一次。不要把这条消息当成用户新需求。",
        ].joined(separator: "\n")
    }

    static func parse(_ text: String) -> (headerLine: String, agentId: String?, name: String?, error: String)? {
        guard text.hasPrefix(prefix) else { return nil }
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
        let lines = normalized.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let headerLine = lines.first else { return nil }
        var fields: [String: String] = [:]
        let after = headerLine.dropFirst(prefix.count).trimmingCharacters(in: .whitespaces)
        for token in after.split(separator: " ", omittingEmptySubsequences: true) {
            guard let eq = token.firstIndex(of: "=") else { continue }
            let key = String(token[..<eq])
            let value = String(token[token.index(after: eq)...])
            if !key.isEmpty { fields[key] = value }
        }
        var error = ""
        if let idx = lines.firstIndex(where: { $0 == "error:" }), idx + 1 < lines.count {
            var end = idx + 1
            while end < lines.count,
                  !lines[end].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !lines[end].hasPrefix("Worktree ") {
                end += 1
            }
            error = lines[(idx + 1)..<end].joined(separator: "\n")
        }
        return (headerLine, fields["agentId"], fields["name"], error)
    }
}

/// Result of the post-merge smoke verify run in the main project directory.
struct PostMergeVerifyFailure: Equatable, Sendable {
    let command: String
    /// Process exit status; -1 when the process could not be launched.
    let exitCode: Int32
    /// True when the 120s timeout fired and the process had to be terminated.
    let timedOut: Bool
    /// Combined stdout+stderr tail (≤2000 chars).
    let outputTail: String
}

/// Injected when the merged tree fails the agent's attested verify command.
enum PostMergeVerifyFailedMessage {
    static let prefix = "[post-merge-verify-failed]"

    static func format(agent: SubagentInfo, failure: PostMergeVerifyFailure) -> String {
        let branch = agent.worktreeBranch ?? "?"
        let exitDesc = failure.timedOut ? "\(failure.exitCode) (timeout 120s)" : "\(failure.exitCode)"
        let tail = failure.outputTail.isEmpty ? "(no output)" : failure.outputTail
        return [
            "\(prefix) agentId=\(agent.id) name=\(agent.name) branch=\(branch)",
            "",
            "verify: $ \(failure.command) → exit \(exitDesc)",
            "output tail:",
            tail,
            "",
            "主仓在合并该分支后未通过这条系统证词验证；worktree 已合并并移除。请立即派一个 general-purpose fixer 在主仓修复（brief 附上面的命令与输出尾部，verify 填同一条命令），修复后 verified=pass 才可接受；只有取舍真正属于用户时才简短问一次。不要把这条消息当成用户新需求。",
        ].joined(separator: "\n")
    }
}

/// Runs the post-merge verify command synchronously on a background thread.
/// Mirrors GitRepo.run's blocking style, but via `bash -lc` with a hard timeout.
enum PostMergeVerifyRunner {
    static func run(command: String, in directory: URL, timeout: TimeInterval = 120) -> PostMergeVerifyFailure {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/bash")
        proc.arguments = ["-lc", command]
        proc.currentDirectoryURL = directory
        proc.standardInput = FileHandle.nullDevice
        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = pipe
        do {
            try proc.run()
        } catch {
            return PostMergeVerifyFailure(
                command: command, exitCode: -1, timedOut: false,
                outputTail: "无法启动 verify 进程: \(error.localizedDescription)")
        }
        let timedOutBox = LockedBool()
        let timeoutItem = DispatchWorkItem {
            timedOutBox.set(true)
            if proc.isRunning { proc.terminate() }
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: timeoutItem)
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        proc.waitUntilExit()
        timeoutItem.cancel()
        let text = String(data: data, encoding: .utf8) ?? ""
        let tail = String(text.suffix(2000)).trimmingCharacters(in: .whitespacesAndNewlines)
        return PostMergeVerifyFailure(
            command: command, exitCode: proc.terminationStatus,
            timedOut: timedOutBox.get(), outputTail: tail)
    }
}

private final class LockedBool {
    private let lock = NSLock()
    private var value = false
    func set(_ v: Bool) { lock.lock(); value = v; lock.unlock() }
    func get() -> Bool { lock.lock(); defer { lock.unlock() }; return value }
}

/// 每个会话一棵 subagent 树；agent_event 桥接事件在主线程进来。
final class SubagentStore: ObservableObject {
    /// didSet 版本计数：任何 agents 写入（含元素级 in-place 修改）都会 bump，
    /// 下方的 toolCallId/parentId 索引按此惰性重建。宁滥勿缺。
    @Published private(set) var agents: [SubagentInfo] = [] {
        didSet { agentsGeneration &+= 1 }
    }
    /// 随 agents 每次写入单调递增（非 @Published：agents 本身已负责触发刷新）。
    private(set) var agentsGeneration: UInt64 = 0

    // MARK: - T6 消息卡片查询索引（agents 变化时惰性重建，查询 O(结果数)）
    private var indexedGeneration: UInt64 = 0
    private var agentIndicesByToolCallId: [String: [Int]] = [:]
    private var childIndicesByParentId: [String: [Int]] = [:]

    private func rebuildAgentIndicesIfNeeded() {
        guard indexedGeneration != agentsGeneration else { return }
        agentIndicesByToolCallId.removeAll(keepingCapacity: true)
        childIndicesByParentId.removeAll(keepingCapacity: true)
        for (index, agent) in agents.enumerated() {
            if let toolCallId = agent.toolCallId {
                agentIndicesByToolCallId[toolCallId, default: []].append(index)
            }
            if let parentId = agent.parentId {
                childIndicesByParentId[parentId, default: []].append(index)
            }
        }
        indexedGeneration = agentsGeneration
    }

    /// toolCallId → 该 subagent 工具调用派出的 agent（含子孙），按 agents 原顺序返回。
    /// 替代之前每行 `all.filter + keep.contains` 的 O(行数×agents²) 查询。
    func agents(forToolCallIds callIds: Set<String>) -> [SubagentInfo] {
        guard !callIds.isEmpty else { return [] }
        rebuildAgentIndicesIfNeeded()
        var matched = Set<Int>()
        var queue: [Int] = []
        for id in callIds {
            for index in agentIndicesByToolCallId[id] ?? [] where !matched.contains(index) {
                matched.insert(index)
                queue.append(index)
            }
        }
        var head = 0
        while head < queue.count {
            let agent = agents[queue[head]]
            head += 1
            for childIndex in childIndicesByParentId[agent.id] ?? [] where !matched.contains(childIndex) {
                matched.insert(childIndex)
                queue.append(childIndex)
            }
        }
        return matched.sorted().map { agents[$0] }
    }

    @Published var selectedId: String?
    /// Last merge/discard error for panel display (cleared on success or next action).
    @Published var worktreeActionError: String?
    /// Main project worktree (session root). Used for auto-merge on successful agent end.
    private(set) var mainProjectURL: URL?
    /// Owning chat session key; set by ChatSession so per-turn usage events can be
    /// attributed to the right session in the token ledger.
    var sessionKey: String?
    /// Resolve model id (`provider/id`) → context window; set by ChatSession from availableModels.
    var resolveContextWindow: ((String?) -> Int?)?
    /// Fired when merge fails (auto or manual); ChatSession injects `[worktree-merge-failed]`.
    var onWorktreeMergeFailed: ((SubagentInfo, String) -> Void)?
    /// Fired when the merged tree fails the agent's attested verify command;
    /// ChatSession injects `[post-merge-verify-failed]`.
    var onPostMergeVerifyFailed: ((SubagentInfo, PostMergeVerifyFailure) -> Void)?
    /// Dedup identical merge-fail injections (agentId + error) within this window.
    private var lastMergeFailKey: String?
    private var lastMergeFailAt: Date?
    private var logCounter = 0
    private var persistURL: URL?
    private var saveScheduled = false
    /// Serial queue for JSON encode + atomic write (TokenLedger.append 模式：主线程只拷快照)。
    private let persistQueue = DispatchQueue(label: "pipiui.subagentstore.persist")

    /// Bind the session's main project URL so successful agents can auto-merge.
    func bindMainProject(_ url: URL) {
        mainProjectURL = url
    }

    // MARK: - 持久化（跟随 pi 会话文件，App 崩溃/重启后恢复 agent 树）

    /// 会话文件路径已知后挂载持久化：加载历史 agent 树，此后每次事件防抖落盘。
    func attachPersistence(sessionFile: String) {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI/subagents")
        let name = URL(fileURLWithPath: sessionFile).deletingPathExtension().lastPathComponent + ".agents.json"
        let url = dir.appendingPathComponent(name)
        guard persistURL != url else { return }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        persistURL = url

        // 后台读 + 解码持久化 JSON，完成后回主线程 assign（避免主线程 IO/解码卡顿）。
        guard agents.isEmpty else { return }
        Task.detached(priority: .utility) { [weak self] in
            guard let data = try? Data(contentsOf: url),
                  var loaded = try? JSONDecoder().decode([SubagentInfo].self, from: data) else { return }
            // 上次退出时还在跑的 agent：进程已不存在，如实标记为中断
            for i in loaded.indices where loaded[i].state == .running {
                loaded[i].state = .interrupted
                loaded[i].activity = ""
                loaded[i].ended = loaded[i].ended ?? Date()
                if let path = loaded[i].worktreePath, !path.isEmpty {
                    loaded[i].worktreeLifecycle = .pendingReview
                }
            }
            let maxLogId = loaded.flatMap(\.log).map(\.id).max() ?? 0
            await MainActor.run {
                guard let self, self.persistURL == url, self.agents.isEmpty else { return }
                self.agents = loaded
                self.logCounter = maxLogId
                if self.selectedId == nil { self.selectedId = self.agents.last?.id }
            }
        }
    }

    private func scheduleSave() {
        guard persistURL != nil, !saveScheduled else { return }
        saveScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.saveScheduled = false
            self?.persistSnapshotAsync()
        }
    }

    /// 主线程只拷贝值类型快照；encode + 原子写挪到串行 persistQueue（不阻塞主线程）。
    private func persistSnapshotAsync() {
        guard let persistURL else { return }
        let snapshot = agents
        persistQueue.async {
            guard let data = try? JSONEncoder().encode(snapshot) else { return }
            try? data.write(to: persistURL, options: .atomic)
        }
    }

    /// 同步 flush：排队等此前所有异步写完成后，本快照 encode+write 一并落盘。
    /// 用于退出路径（AppStore.shutdown → applicationWillTerminate、ChatSession.shutdown）。
    func saveNow() {
        guard let persistURL else { return }
        let snapshot = agents
        persistQueue.sync {
            guard let data = try? JSONEncoder().encode(snapshot) else { return }
            try? data.write(to: persistURL, options: .atomic)
        }
    }

    var runningCount: Int {
        agents.lazy.filter { $0.state == .running }.count
    }

    var totalCost: Double {
        agents.reduce(0) { $0 + $1.cost }
    }

    /// 打开 Subagents 面板时选中最近启动的 agent；不会在面板已打开时抢走用户的手动选择。
    func selectLatest() {
        selectedId = agents.max(by: { $0.started < $1.started })?.id
    }

    func handle(_ e: J) {
        guard let id = e["agentId"].string, !id.isEmpty else { return }
        switch e["kind"].string ?? "" {
        case "start":
            // Same agentId may resume (续作) after end — refresh running state + worktree meta.
            if let i = agents.firstIndex(where: { $0.id == id }) {
                agents[i].state = .running
                agents[i].activity = ""
                agents[i].ended = nil
                if let tc = e["toolCallId"].string { agents[i].toolCallId = tc }
                if let t = e["title"].string { agents[i].title = t }
                if let path = e["worktreePath"].string { agents[i].worktreePath = path }
                if let branch = e["worktreeBranch"].string { agents[i].worktreeBranch = branch }
                if let err = e["worktreeError"].string {
                    agents[i].worktreeError = err
                } else if e["worktreePath"].string != nil {
                    agents[i].worktreeError = nil
                }
                if let path = agents[i].worktreePath, !path.isEmpty {
                    agents[i].worktreeLifecycle = .active
                }
                break
            }
            var info = SubagentInfo(
                id: id,
                parentId: e["parentId"].string,
                toolCallId: e["toolCallId"].string,
                name: e["name"].string ?? "agent",
                task: e["task"].string ?? "",
                title: e["title"].string,
                depth: max(1, e["depth"].int ?? 1),
                model: e["model"].string
            )
            info.worktreePath = e["worktreePath"].string
            info.worktreeBranch = e["worktreeBranch"].string
            info.worktreeError = e["worktreeError"].string
            if let path = info.worktreePath, !path.isEmpty {
                info.worktreeLifecycle = .active
            }
            agents.append(info)
            if selectedId == nil { selectedId = id }
        case "update":
            guard let i = agents.firstIndex(where: { $0.id == id }) else { return }
            if let output = e["output"].string, !output.isEmpty { agents[i].output = output }
            agents[i].activity = e["activity"].string ?? agents[i].activity
            agents[i].cost = e["cost"].double ?? agents[i].cost
            agents[i].turns = e["turns"].int ?? agents[i].turns
        case "log":
            guard let i = agents.firstIndex(where: { $0.id == id }) else { return }
            for item in e["items"].array {
                logCounter += 1
                agents[i].log.append(AgentLogItem(
                    id: logCounter,
                    kind: item["itemType"].string ?? "text",
                    name: item["name"].string ?? "",
                    text: item["text"].string ?? "",
                    isError: item["isError"].bool ?? false
                ))
            }
            if agents[i].log.count > 800 {
                agents[i].log.removeFirst(agents[i].log.count - 800)
            }
        case "usage":
            // Per-turn usage from the subagent extension (`index.ts` message_end →
            // pipiuiReport kind:"usage"). Updates detail metrics + token ledger.
            guard let i = agents.firstIndex(where: { $0.id == id }) else { return }
            let usage = TokenLedger.UsageSnapshot.from(e["usage"])
            let model = e["model"].string ?? agents[i].model ?? "?"
            let turn = e["turn"].int ?? 0
            let window = e["usage"]["contextWindow"].int
                ?? resolveContextWindow?(model)
                ?? resolveContextWindow?(agents[i].model)
            agents[i].applyUsage(usage, contextWindow: window)
            let agent = agents[i]
            let tools = e["tools"].array.compactMap(\.string)
            TokenLedger.shared.append(
                session: sessionKey ?? "",
                channel: "subagent",
                agentId: id,
                agentName: agent.name,
                depth: agent.depth,
                model: model,
                turn: turn,
                usage: usage,
                tools: tools
            )
            Log.info(
                "subagent \(agent.name) turn \(turn) usage ↑\(usage.input) ↓\(usage.output) R\(usage.cacheRead) W\(usage.cacheWrite) $\(String(format: "%.4f", usage.cost)) ctx:\(usage.contextTokens) — \(model)",
                category: .token
            )
        case "end":
            guard let i = agents.firstIndex(where: { $0.id == id }) else { return }
            if e["aborted"].bool == true {
                agents[i].state = .aborted
            } else {
                agents[i].state = (e["ok"].bool == true) ? .ok : .failed
            }
            if let output = e["output"].string, !output.isEmpty { agents[i].output = output }
            agents[i].activity = ""
            agents[i].cost = e["cost"].double ?? agents[i].cost
            agents[i].turns = e["turns"].int ?? agents[i].turns
            agents[i].ended = Date()
            if let path = e["worktreePath"].string { agents[i].worktreePath = path }
            if let branch = e["worktreeBranch"].string { agents[i].worktreeBranch = branch }
            if let err = e["worktreeError"].string { agents[i].worktreeError = err }
            if let verify = e["verifyCommand"].string { agents[i].verifyCommand = verify }
            // Terminal + still has worktree path → pending review.
            if let path = agents[i].worktreePath, !path.isEmpty {
                switch agents[i].worktreeLifecycle {
                case .merged, .discarded:
                    break
                default:
                    agents[i].worktreeLifecycle = .pendingReview
                }
            }
            // Product default: successful agent + worktree → auto-merge into main + remove wt.
            // failed/aborted/interrupted keep pendingReview for续作; UI buttons remain as fallback.
            if agents[i].state == .ok,
               agents[i].worktreeLifecycle == .pendingReview,
               let main = mainProjectURL {
                let aid = agents[i].id
                // git 操作在 mergeWorktree 内部 Task.detached 后台执行，主线程只收尾状态。
                Task { [weak self] in
                    _ = await self?.mergeWorktree(agentId: aid, mainProjectURL: main)
                }
            }
        default:
            break
        }
        scheduleSave()
    }

    /// 按树序展开（父节点后紧跟其子孙），用于列表显示。
    var displayOrder: [SubagentInfo] {
        var byParent: [String?: [SubagentInfo]] = [:]
        for agent in agents {
            byParent[agent.parentId, default: []].append(agent)
        }
        // 根：parentId 为空，或父节点不在本树里（例如更上层是主会话）
        let knownIds = Set(agents.map(\.id))
        var result: [SubagentInfo] = []
        func append(_ node: SubagentInfo) {
            result.append(node)
            for child in byParent[node.id] ?? [] { append(child) }
        }
        for agent in agents where agent.parentId == nil || !knownIds.contains(agent.parentId!) {
            append(agent)
        }
        return result
    }

    func clearFinished() {
        agents.removeAll { $0.state != .running }
        if let selected = selectedId, !agents.contains(where: { $0.id == selected }) {
            selectedId = agents.first?.id
        }
        scheduleSave()
    }

    // MARK: - Worktree merge / discard (main worktree only; no push)

    /// Merge agent branch into `mainProjectURL` HEAD, then remove the worktree.
    /// - Returns: `nil` on success; otherwise a user-visible error string.
    /// - Called automatically when an agent ends with `.ok` and a pending worktree;
    ///   also available from the Subagents panel as a manual fallback. Never pushes remote.
    /// - Threading: `@MainActor` entry/exit（读校验、写 lifecycle/error）；git CLI 在
    ///   `Task.detached` 后台执行。收尾前 re-check agent 仍存在，避免脏写。
    @MainActor
    @discardableResult
    func mergeWorktree(agentId: String, mainProjectURL: URL) async -> String? {
        worktreeActionError = nil
        guard let i = agents.firstIndex(where: { $0.id == agentId }) else {
            return setWorktreeError("找不到 agent")
        }
        let agent = agents[i]
        guard agent.canReviewWorktree,
              let pathStr = agent.worktreePath, !pathStr.isEmpty,
              let branch = agent.worktreeBranch, !branch.isEmpty else {
            return setWorktreeError("没有可合并的 worktree（需审核中且有 branch/path）")
        }
        if branch.hasPrefix("-") || pathStr.hasPrefix("-") {
            return setWorktreeError("非法 branch/path")
        }

        let wtURL = URL(fileURLWithPath: pathStr, isDirectory: true)
        let main = mainProjectURL

        let outcome: MergeGitOutcome = await Task.detached(priority: .userInitiated) {
            // Best-effort: commit dirty files in the agent worktree so they are not lost.
            _ = GitRepo.commitAllIfDirty(
                in: wtURL,
                message: "pipiui: agent \(agentId) work"
            )
            do {
                try GitRepo.mergeBranch(branch, into: main)
            } catch {
                let msg = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                return .mergeFailed(msg)
            }
            do {
                try GitRepo.worktreeRemove(at: wtURL, in: main, force: true)
            } catch {
                let msg = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                return .removeFailed(msg)
            }
            return .ok
        }.value

        // 回到主线程：git 期间 agent 可能已被清空/移除，写状态前 re-check。
        switch outcome {
        case .ok:
            guard let idx = agents.firstIndex(where: { $0.id == agentId }) else { return nil }
            agents[idx].worktreeLifecycle = .merged
            // Keep path/branch strings for history display; buttons hide via lifecycle.
            scheduleSave()
            runPostMergeVerifyIfNeeded(agent: agents[idx], mainProjectURL: main)
            return nil
        case .mergeFailed(let msg):
            let full = "合并失败（worktree 未删除）: \(msg)"
            if let idx = agents.firstIndex(where: { $0.id == agentId }) {
                notifyMergeFailed(agent: agents[idx], error: full)
            }
            return setWorktreeError(full)
        case .removeFailed(let msg):
            // Merge already succeeded — mark merged but surface remove error.
            if let idx = agents.firstIndex(where: { $0.id == agentId }) {
                agents[idx].worktreeLifecycle = .merged
                scheduleSave()
            }
            return setWorktreeError("已合并，但删除 worktree 失败: \(msg)")
        }
    }

    /// Force-remove worktree and delete local `pipiui/*` branch without merging.
    /// Threading: 同 `mergeWorktree` —— git 后台跑，状态主线程收尾并 re-check。
    @MainActor
    @discardableResult
    func discardWorktree(agentId: String, mainProjectURL: URL) async -> String? {
        worktreeActionError = nil
        guard let i = agents.firstIndex(where: { $0.id == agentId }) else {
            return setWorktreeError("找不到 agent")
        }
        let agent = agents[i]
        guard agent.canReviewWorktree || agent.worktreeLifecycle == .active,
              let pathStr = agent.worktreePath, !pathStr.isEmpty else {
            return setWorktreeError("没有可丢弃的 worktree")
        }
        // Prefer not discarding while still running
        if agent.state == .running {
            return setWorktreeError("agent 仍在运行，请先结束再丢弃")
        }
        if pathStr.hasPrefix("-") {
            return setWorktreeError("非法 worktree 路径")
        }

        let wtURL = URL(fileURLWithPath: pathStr, isDirectory: true)
        let branch = agent.worktreeBranch
        let main = mainProjectURL

        let errorMsg: String? = await Task.detached(priority: .userInitiated) {
            do {
                try GitRepo.worktreeRemove(at: wtURL, in: main, force: true)
            } catch {
                // Path may already be gone — continue to branch cleanup if possible.
                if FileManager.default.fileExists(atPath: pathStr) {
                    let msg = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    return "删除 worktree 失败: \(msg)"
                }
            }
            if let branch, !branch.isEmpty, !branch.hasPrefix("-") {
                try? GitRepo.deleteLocalBranch(branch, in: main, force: true)
            }
            return nil
        }.value

        if let errorMsg {
            return setWorktreeError(errorMsg)
        }
        if let idx = agents.firstIndex(where: { $0.id == agentId }) {
            agents[idx].worktreeLifecycle = .discarded
            scheduleSave()
        }
        return nil
    }

    /// Diff stat for review UI: main HEAD...agent branch (best-effort string).
    /// Threading: 主线程取 branch 后，`probe` + `diff --stat` 后台执行。
    @MainActor
    func worktreeDiffStat(agentId: String, mainProjectURL: URL) async -> String? {
        guard let agent = agents.first(where: { $0.id == agentId }),
              let branch = agent.worktreeBranch, !branch.isEmpty else {
            return nil
        }
        return await Task.detached(priority: .utility) {
            // Prefer symbolic main branch name; fall back to HEAD.
            let mainStatus = GitRepo.probe(workTree: mainProjectURL)
            let from = mainStatus.currentBranch ?? "HEAD"
            return GitRepo.diffStat(from: from, to: branch, in: mainProjectURL)
        }.value
    }

    @discardableResult
    private func setWorktreeError(_ message: String) -> String {
        worktreeActionError = message
        return message
    }

    /// Notify main agent once per (agentId, error) within 60s.
    func notifyMergeFailed(agent: SubagentInfo, error: String) {
        guard shouldNotify(kind: "merge", agentId: agent.id, detail: error) else { return }
        onWorktreeMergeFailed?(agent, error)
    }

    /// Post-merge smoke verify: re-run the agent's attested command in the MAIN project
    /// directory. Silent on success; injects `[post-merge-verify-failed]` on failure/timeout.
    /// Threading: bash 在 Task.detached 后台跑，回调回主线程。
    private func runPostMergeVerifyIfNeeded(agent: SubagentInfo, mainProjectURL: URL) {
        guard let command = agent.verifyCommand?.trimmingCharacters(in: .whitespacesAndNewlines),
              !command.isEmpty else { return }
        Task.detached(priority: .utility) { [weak self] in
            let result = PostMergeVerifyRunner.run(command: command, in: mainProjectURL, timeout: 120)
            guard result.exitCode == 0, !result.timedOut else {
                await MainActor.run { [weak self] in
                    self?.notifyPostMergeVerifyFailed(agent: agent, failure: result)
                }
                return
            }
            Log.info("post-merge verify passed for \(agent.name): \(command)", category: .session)
        }
    }

    /// Dedup post-merge verify-fail injections the same way as merge failures.
    func notifyPostMergeVerifyFailed(agent: SubagentInfo, failure: PostMergeVerifyFailure) {
        guard shouldNotify(kind: "verify", agentId: agent.id,
                           detail: "\(failure.command)|\(failure.exitCode)|\(failure.timedOut)") else { return }
        onPostMergeVerifyFailed?(agent, failure)
    }

    /// Shared 60s dedup for merge/verify failure injections (keyed per kind).
    private func shouldNotify(kind: String, agentId: String, detail: String) -> Bool {
        let key = "\(kind)|\(agentId)|\(detail)"
        let now = Date()
        if let lastKey = lastMergeFailKey, lastKey == key,
           let at = lastMergeFailAt, now.timeIntervalSince(at) < 60 {
            return false
        }
        lastMergeFailKey = key
        lastMergeFailAt = now
        return true
    }
}
