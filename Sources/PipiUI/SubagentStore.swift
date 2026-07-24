import Foundation
import Combine

/// subagent 工作流水里的一条记录（文本/思考/工具调用/工具结果）。
struct AgentLogItem: Identifiable, Equatable, Codable {
    let id: Int
    let kind: String // text / thinking / tool / toolResult
    let name: String
    let text: String
    let isError: Bool
}

/// Worktree lifecycle for a subagent (create → review → merge/discard).
enum WorktreeLifecycle: String, Codable, Equatable {
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
struct SubagentInfo: Identifiable, Equatable, Codable {
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
    let depth: Int
    let model: String?
    var state: State = .running
    var output = ""
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

    enum CodingKeys: String, CodingKey {
        case id, parentId, toolCallId, name, task, depth, model
        case state, output, activity, log, cost, turns, started, ended
        case worktreePath, worktreeBranch, worktreeError, worktreeLifecycle
    }

    init(
        id: String,
        parentId: String?,
        toolCallId: String? = nil,
        name: String,
        task: String,
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
        worktreeLifecycle: WorktreeLifecycle = .none
    ) {
        self.id = id
        self.parentId = parentId
        self.toolCallId = toolCallId
        self.name = name
        self.task = task
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
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        parentId = try c.decodeIfPresent(String.self, forKey: .parentId)
        toolCallId = try c.decodeIfPresent(String.self, forKey: .toolCallId)
        name = try c.decode(String.self, forKey: .name)
        task = try c.decode(String.self, forKey: .task)
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
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encodeIfPresent(parentId, forKey: .parentId)
        try c.encodeIfPresent(toolCallId, forKey: .toolCallId)
        try c.encode(name, forKey: .name)
        try c.encode(task, forKey: .task)
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

/// 每个会话一棵 subagent 树；agent_event 桥接事件在主线程进来。
final class SubagentStore: ObservableObject {
    @Published private(set) var agents: [SubagentInfo] = []
    @Published var selectedId: String?
    /// Last merge/discard error for panel display (cleared on success or next action).
    @Published var worktreeActionError: String?
    /// Main project worktree (session root). Used for auto-merge on successful agent end.
    private(set) var mainProjectURL: URL?
    private var logCounter = 0
    private var persistURL: URL?
    private var saveScheduled = false

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

        if agents.isEmpty,
           let data = try? Data(contentsOf: url),
           var loaded = try? JSONDecoder().decode([SubagentInfo].self, from: data) {
            // 上次退出时还在跑的 agent：进程已不存在，如实标记为中断
            for i in loaded.indices where loaded[i].state == .running {
                loaded[i].state = .interrupted
                loaded[i].activity = ""
                loaded[i].ended = loaded[i].ended ?? Date()
                if let path = loaded[i].worktreePath, !path.isEmpty {
                    loaded[i].worktreeLifecycle = .pendingReview
                }
            }
            agents = loaded
            logCounter = loaded.flatMap(\.log).map(\.id).max() ?? 0
            if selectedId == nil { selectedId = agents.last?.id }
        }
    }

    private func scheduleSave() {
        guard persistURL != nil, !saveScheduled else { return }
        saveScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.saveScheduled = false
            self?.saveNow()
        }
    }

    func saveNow() {
        guard let persistURL, let data = try? JSONEncoder().encode(agents) else { return }
        try? data.write(to: persistURL, options: .atomic)
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
                DispatchQueue.main.async { [weak self] in
                    _ = self?.mergeWorktree(agentId: aid, mainProjectURL: main)
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
    @discardableResult
    func mergeWorktree(agentId: String, mainProjectURL: URL) -> String? {
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

        // Best-effort: commit dirty files in the agent worktree so they are not lost.
        _ = GitRepo.commitAllIfDirty(
            in: wtURL,
            message: "pipiui: agent \(agent.id) work"
        )

        do {
            try GitRepo.mergeBranch(branch, into: mainProjectURL)
        } catch {
            let msg = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            return setWorktreeError("合并失败（worktree 未删除）: \(msg)")
        }

        do {
            try GitRepo.worktreeRemove(at: wtURL, in: mainProjectURL, force: true)
        } catch {
            // Merge already succeeded — mark merged but surface remove error.
            agents[i].worktreeLifecycle = .merged
            scheduleSave()
            let msg = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            return setWorktreeError("已合并，但删除 worktree 失败: \(msg)")
        }

        agents[i].worktreeLifecycle = .merged
        // Keep path/branch strings for history display; buttons hide via lifecycle.
        scheduleSave()
        return nil
    }

    /// Force-remove worktree and delete local `pipiui/*` branch without merging.
    @discardableResult
    func discardWorktree(agentId: String, mainProjectURL: URL) -> String? {
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

        do {
            try GitRepo.worktreeRemove(at: wtURL, in: mainProjectURL, force: true)
        } catch {
            // Path may already be gone — continue to branch cleanup if possible.
            if FileManager.default.fileExists(atPath: pathStr) {
                let msg = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                return setWorktreeError("删除 worktree 失败: \(msg)")
            }
        }

        if let branch, !branch.isEmpty, !branch.hasPrefix("-") {
            try? GitRepo.deleteLocalBranch(branch, in: mainProjectURL, force: true)
        }

        agents[i].worktreeLifecycle = .discarded
        scheduleSave()
        return nil
    }

    /// Diff stat for review UI: main HEAD...agent branch (best-effort string).
    func worktreeDiffStat(agentId: String, mainProjectURL: URL) -> String? {
        guard let agent = agents.first(where: { $0.id == agentId }),
              let branch = agent.worktreeBranch, !branch.isEmpty else {
            return nil
        }
        // Prefer symbolic main branch name; fall back to HEAD.
        let mainStatus = GitRepo.probe(workTree: mainProjectURL)
        let from = mainStatus.currentBranch ?? "HEAD"
        return GitRepo.diffStat(from: from, to: branch, in: mainProjectURL)
    }

    @discardableResult
    private func setWorktreeError(_ message: String) -> String {
        worktreeActionError = message
        return message
    }
}
