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
    /// Integration succeeded, but worktree/branch cleanup is incomplete and actionable.
    case mergedCleanupPending
    /// Discarded (removed without merge).
    case discarded
}

/// Persisted final disposition used by Boss closeout and restart reconciliation.
enum AgentCloseoutDisposition: String, Codable, Equatable, Sendable {
    /// Still running, awaiting merge/verify, or not yet audited.
    case unclassified
    /// Integrated, verified when required, and mechanically cleaned.
    case cleaned
    /// Deliberately preserved because it may contain useful or user-owned work.
    case retained
    /// Boss must dispatch a fixer/integrator/cleanup worker.
    case needsFixer
    /// Product/scope ownership is genuinely ambiguous and requires the user.
    case needsUser
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
    /// Most recent bridge event observed by the UI for this agent. This is a UI-side
    /// liveness hint only; it cannot prove that the subagent process has stopped.
    var lastObservedAt = Date()
    var ended: Date?
    /// 扩展 stall watchdog 上报：120s+ 无任何流式事件。恢复活动后自动解除。
    var stalled: Bool = false
    /// stalled 上报附带的 idle 秒数（badge tooltip 用）。
    var stalledIdleSec: Int = 0
    /// Isolated git worktree path when auto-created for this agent.
    var worktreePath: String? = nil
    var worktreeBranch: String? = nil
    /// Set when worktree was requested but creation failed (spawn fell back).
    var worktreeError: String? = nil
    /// Worktree lifecycle for review/merge UI.
    var worktreeLifecycle: WorktreeLifecycle = .none
    /// Attested smoke-verify command reported at agent end; re-run in main repo after merge.
    var verifyCommand: String? = nil
    /// Attested exit code of the verify command run in the agent worktree.
    /// Present + ≠ 0 ⇒ worker's own verify failed: keep pendingReview, never auto-merge.
    var verifyExit: Int? = nil
    /// Closeout is authoritative in the existing per-session agent history; the
    /// secretary mirrors/summarizes it into the Boss ledger rather than creating a second ledger.
    var closeoutDisposition: AgentCloseoutDisposition = .unclassified
    var closeoutReason: String? = nil
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
        case state, output, activity, log, cost, turns, started, lastObservedAt, ended
        case stalled, stalledIdleSec
        case worktreePath, worktreeBranch, worktreeError, worktreeLifecycle
        case verifyCommand, verifyExit
        case closeoutDisposition, closeoutReason
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
        lastObservedAt: Date? = nil,
        ended: Date? = nil,
        stalled: Bool = false,
        stalledIdleSec: Int = 0,
        worktreePath: String? = nil,
        worktreeBranch: String? = nil,
        worktreeError: String? = nil,
        worktreeLifecycle: WorktreeLifecycle = .none,
        verifyCommand: String? = nil,
        verifyExit: Int? = nil,
        closeoutDisposition: AgentCloseoutDisposition = .unclassified,
        closeoutReason: String? = nil,
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
        self.lastObservedAt = lastObservedAt ?? started
        self.ended = ended
        self.stalled = stalled
        self.stalledIdleSec = stalledIdleSec
        self.worktreePath = worktreePath
        self.worktreeBranch = worktreeBranch
        self.worktreeError = worktreeError
        self.worktreeLifecycle = worktreeLifecycle
        self.verifyCommand = verifyCommand
        self.verifyExit = verifyExit
        self.closeoutDisposition = closeoutDisposition
        self.closeoutReason = closeoutReason
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
        // Older persisted snapshots predate this UI-only observation field. Their
        // known start time is the safest conservative baseline for the watchdog.
        lastObservedAt = try c.decodeIfPresent(Date.self, forKey: .lastObservedAt) ?? started
        ended = try c.decodeIfPresent(Date.self, forKey: .ended)
        stalled = try c.decodeIfPresent(Bool.self, forKey: .stalled) ?? false
        stalledIdleSec = try c.decodeIfPresent(Int.self, forKey: .stalledIdleSec) ?? 0
        worktreePath = try c.decodeIfPresent(String.self, forKey: .worktreePath)
        worktreeBranch = try c.decodeIfPresent(String.self, forKey: .worktreeBranch)
        worktreeError = try c.decodeIfPresent(String.self, forKey: .worktreeError)
        var life = try c.decodeIfPresent(WorktreeLifecycle.self, forKey: .worktreeLifecycle) ?? .none
        if life == .none {
            life = Self.inferredLifecycle(state: state, path: worktreePath)
        }
        worktreeLifecycle = life
        verifyCommand = try c.decodeIfPresent(String.self, forKey: .verifyCommand)
        verifyExit = try c.decodeIfPresent(Int.self, forKey: .verifyExit)
        closeoutDisposition = try c.decodeIfPresent(
            AgentCloseoutDisposition.self,
            forKey: .closeoutDisposition
        ) ?? .unclassified
        closeoutReason = try c.decodeIfPresent(String.self, forKey: .closeoutReason)
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
        try c.encode(lastObservedAt, forKey: .lastObservedAt)
        try c.encodeIfPresent(ended, forKey: .ended)
        try c.encode(stalled, forKey: .stalled)
        try c.encode(stalledIdleSec, forKey: .stalledIdleSec)
        try c.encodeIfPresent(worktreePath, forKey: .worktreePath)
        try c.encodeIfPresent(worktreeBranch, forKey: .worktreeBranch)
        try c.encodeIfPresent(worktreeError, forKey: .worktreeError)
        try c.encode(worktreeLifecycle, forKey: .worktreeLifecycle)
        try c.encodeIfPresent(verifyCommand, forKey: .verifyCommand)
        try c.encodeIfPresent(verifyExit, forKey: .verifyExit)
        try c.encode(closeoutDisposition, forKey: .closeoutDisposition)
        try c.encodeIfPresent(closeoutReason, forKey: .closeoutReason)
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
        case .merged, .mergedCleanupPending, .discarded:
            return false
        }
    }

    var hasWorktreeMeta: Bool {
        if let b = worktreeBranch, !b.isEmpty { return true }
        if let p = worktreePath, !p.isEmpty { return true }
        if let e = worktreeError, !e.isEmpty { return true }
        switch worktreeLifecycle {
        case .merged, .mergedCleanupPending, .discarded, .pendingReview, .active:
            return true
        case .none:
            return false
        }
    }
}

/// 本轮待通知子 agent 终态聚合（纯函数，可单测）：全部成功 → 完成提醒；
/// 任一失败/需人工介入 → 出错提醒（文案含具体子任务名、简短原因，并明确「需人工介入」）。
/// 判定顺序：终态（failed/aborted/interrupted）→ closeout 需人工（needsUser/needsFixer）
/// → verify 失败 → worktree 创建失败。
enum SubagentRoundAggregator {
    /// 失败/需人工介入的简短原因；nil = 该子任务成功。
    static func issueReason(for agent: SubagentInfo) -> String? {
        switch agent.state {
        case .failed: return "执行失败，需人工介入"
        case .aborted: return "已中止，需人工介入"
        case .interrupted: return "中断（进程退出），需人工介入"
        case .running, .ok: break
        }
        switch agent.closeoutDisposition {
        case .needsUser:
            return "需人工介入：\(agent.closeoutReason ?? "归属/范围不明确")"
        case .needsFixer:
            return "需人工介入：\(agent.closeoutReason ?? "修复/合并失败")"
        case .unclassified, .cleaned, .retained:
            break
        }
        if let exit = agent.verifyExit, exit != 0 {
            return "验证失败（exit \(exit)），需人工介入"
        }
        if let error = agent.worktreeError, !error.isEmpty {
            return "worktree 创建失败：\(error)，需人工介入"
        }
        return nil
    }
}

/// UI-only fallback for a missing subagent status channel. It deliberately reports
/// uncertainty rather than inferring that a worker died.
enum SubagentWatchdog {
    static let staleThreshold: TimeInterval = 10 * 60

    static func staleAgentIDs(
        in agents: [SubagentInfo],
        now: Date,
        threshold: TimeInterval = staleThreshold
    ) -> [String] {
        agents.compactMap { agent in
            guard agent.state == .running,
                  now.timeIntervalSince(agent.lastObservedAt) >= threshold else {
                return nil
            }
            return agent.id
        }
    }
}

/// The UI sends this only after a person clicks the watchdog warning. Keep the
/// request narrowly scoped so a status check cannot be mistaken for work authority.
enum SubagentStatusCheckPrompt {
    static func make(agentIDs: [String]) -> String {
        let exactIDs = agentIDs.map { "`\($0)`" }.joined(separator: "、")
        return """
        这是用户在界面主动发起的仅状态检查。请先且只针对以下确切 agentId 调用 `subagent_status`：\(exactIDs)。

        不要自动重新派发任何 subagent；不要修改文件、搜索项目，或执行其他工具/操作。若状态通道不可用或无法确认，请直接清楚报告“状态不可确认”。
        """
    }
}

/// 后台 git 操作结果（detached 任务返回值，跨线程传递）。
enum MergeGitOutcome: Sendable {
    case ok
    case zeroChangeCleaned
    case mergeFailed(String)
    case removeFailed(String)
    case cleanupFailed(String)
}

private struct WorktreeReconcileCandidate: Sendable {
    let agentId: String
    let branch: String
    let persistedWorktreePath: String?
}

private enum WorktreeReconcileResolution: Sendable {
    case merged
    case discarded
}

private struct WorktreeReconcileResult: Sendable {
    let candidate: WorktreeReconcileCandidate
    let resolution: WorktreeReconcileResolution
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
            "Worktree kept (pendingReview). Default action: dispatch a general-purpose fixer to resolve the merge (brief carries the branch name + conflicted file list, verify = the post-merge build/test command). You adjudicate three ways only: accept the fixer result / discard a worthless worktree / ask the user (one sentence, one concrete choice). Never open conflict diffs yourself; never forward the raw git error to the user; do not treat this message as a new user request.",
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

/// post-merge verify 的完整判定结果（真实执行与测试缝共用）。
struct PostMergeVerifyOutcome: Equatable, Sendable {
    /// nil = verify 通过；非 nil = 失败详情。
    let failure: PostMergeVerifyFailure?
    /// 主仓是否含未提交改动（决定 needsUser vs needsFixer 与提示文案）。
    let mainDirty: Bool
}

/// Injected when the merged tree fails the agent's attested verify command.
enum PostMergeVerifyFailedMessage {
    static let prefix = "[post-merge-verify-failed]"

    static func format(
        agent: SubagentInfo, failure: PostMergeVerifyFailure, mainDirty: Bool = false
    ) -> String {
        let branch = agent.worktreeBranch ?? "?"
        let exitDesc = failure.timedOut ? "\(failure.exitCode) (timeout 120s)" : "\(failure.exitCode)"
        let tail = failure.outputTail.isEmpty ? "(no output)" : failure.outputTail
        let guidance =
            mainDirty
            ? "The main repo failed this attested verify command after merging the branch, but the main repo currently has uncommitted changes — the failure may come from the user's own work in progress, not this agent's work. Attribute first: if it belongs to the agent's work, dispatch a general-purpose fixer on the main repo (brief carries the command and output tail above, verify = the same command); if it looks like user WIP, explain to the user in one sentence and never touch their uncommitted code. Do not treat this message as a new user request."
            : "The main repo failed this attested verify command after merging the branch; the worktree has been merged and removed. Immediately dispatch a general-purpose fixer on the main repo (brief carries the command and output tail above, verify = the same command); accept only after verified=pass. Ask the user briefly only when the trade-off is genuinely theirs. Do not treat this message as a new user request."
        return [
            "\(prefix) agentId=\(agent.id) name=\(agent.name) branch=\(branch)"
                + (mainDirty ? " mainDirty=true" : ""),
            "",
            "verify: $ \(failure.command) → exit \(exitDesc)",
            "output tail:",
            tail,
            "",
            guidance,
        ].joined(separator: "\n")
    }
}

/// Runs the post-merge verify command synchronously on a background thread.
/// Spawns `bash -lc` in its OWN process group (posix_spawn + POSIX_SPAWN_SETPGROUP)
/// so a timeout can SIGKILL the whole group — grandchildren inheriting the pipe die
/// too, the pipe closes, and the read loop below terminates.
/// Output is collected into a rolling 64KB tail buffer (never unbounded in memory);
/// the stored tail stays ≤2000 chars.
enum PostMergeVerifyRunner {
    private static let tailBufferLimit = 64 * 1024

    static func run(command: String, in directory: URL, timeout: TimeInterval = 120) -> PostMergeVerifyFailure {
        var pipeFDs: [Int32] = [0, 0]
        guard Darwin.pipe(&pipeFDs) == 0 else {
            return PostMergeVerifyFailure(
                command: command, exitCode: -1, timedOut: false,
                outputTail: "failed to create verify pipe")
        }
        let readFD = pipeFDs[0]
        let writeFD = pipeFDs[1]

        var fileActions: posix_spawn_file_actions_t? = nil
        posix_spawn_file_actions_init(&fileActions)
        defer { posix_spawn_file_actions_destroy(&fileActions) }
        posix_spawn_file_actions_addopen(&fileActions, STDIN_FILENO, "/dev/null", O_RDONLY, 0)
        posix_spawn_file_actions_adddup2(&fileActions, writeFD, STDOUT_FILENO)
        posix_spawn_file_actions_adddup2(&fileActions, writeFD, STDERR_FILENO)
        posix_spawn_file_actions_addclose(&fileActions, writeFD)
        posix_spawn_file_actions_addclose(&fileActions, readFD)
        posix_spawn_file_actions_addchdir_np(&fileActions, directory.path)

        var attr: posix_spawnattr_t? = nil
        posix_spawnattr_init(&attr)
        defer { posix_spawnattr_destroy(&attr) }
        // New process group: pgid == child pid ⇒ kill(-pid, sig) reaches the whole tree.
        posix_spawnattr_setpgroup(&attr, 0)
        posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETPGROUP))

        let argv: [UnsafeMutablePointer<CChar>?] = [
            strdup("/bin/bash"), strdup("-lc"), strdup(command), nil,
        ]
        defer { for a in argv { free(a) } }
        // Full inherited environment (same as the old Process()-based runner).
        var envp: [UnsafeMutablePointer<CChar>?] =
            ProcessInfo.processInfo.environment.map { strdup("\($0)=\($1)") } + [nil]
        defer { for e in envp { free(e) } }

        var pid = pid_t()
        let spawnErr = posix_spawn(&pid, "/bin/bash", &fileActions, &attr, argv, &envp)
        guard spawnErr == 0 else {
            close(readFD)
            close(writeFD)
            return PostMergeVerifyFailure(
                command: command, exitCode: -1, timedOut: false,
                outputTail: "failed to spawn verify process: posix_spawn error \(spawnErr)")
        }
        // Parent closes its copy of the write end so read() sees EOF at group exit.
        close(writeFD)

        let timedOutBox = LockedBool()
        let timeoutItem = DispatchWorkItem {
            timedOutBox.set(true)
            // SIGTERM the whole group first; escalated to SIGKILL below if needed.
            kill(-pid, SIGTERM)
        }
        let killItem = DispatchWorkItem {
            // Escalate: guarantee the pipe closes even if the TERM was ignored.
            kill(-pid, SIGKILL)
        }
        let timerQueue = DispatchQueue.global()
        timerQueue.asyncAfter(deadline: .now() + timeout, execute: timeoutItem)
        timerQueue.asyncAfter(deadline: .now() + timeout + 3, execute: killItem)

        // Rolling tail buffer: keep only the last tailBufferLimit bytes.
        var tail = Data()
        tail.reserveCapacity(tailBufferLimit)
        var chunk = [UInt8](repeating: 0, count: 8192)
        while true {
            let n = Darwin.read(readFD, &chunk, chunk.count)
            if n <= 0 { break }
            tail.append(contentsOf: chunk[0..<n])
            if tail.count > tailBufferLimit {
                tail.removeFirst(tail.count - tailBufferLimit)
            }
        }
        close(readFD)

        var status: Int32 = 0
        while waitpid(pid, &status, 0) == -1 && errno == EINTR {}
        timeoutItem.cancel()
        killItem.cancel()

        let text = String(data: tail, encoding: .utf8) ?? ""
        let tailText = String(text.suffix(2000)).trimmingCharacters(in: .whitespacesAndNewlines)
        let exitCode: Int32
        if (status & 0x7f) == 0 {
            exitCode = (status >> 8) & 0xff          // WIFEXITED → WEXITSTATUS
        } else {
            exitCode = 128 + (status & 0x7f)         // WIFSIGNALED → 128 + signal
        }
        return PostMergeVerifyFailure(
            command: command, exitCode: exitCode,
            timedOut: timedOutBox.get(), outputTail: tailText)
    }
}

/// Serializes every operation that touches the MAIN project worktree: `git merge`,
/// `git worktree remove`, and post-merge verify runs.
///
/// Agents finishing at the same time each entered `mergeWorktree` independently, and
/// that method releases the main actor at its `await` — so two merges, or a merge and
/// a verify build, ran concurrently against one working tree. Symptoms: `index.lock`
/// collisions, and builds reading a tree another merge was mid-rewrite of, which
/// injected `[post-merge-verify-failed]` for failures that never existed.
enum MainRepoSerialQueue {
    private static let queue = DispatchQueue(label: "pipiui.subagentstore.mainrepo")

    static func run<T: Sendable>(_ body: @escaping @Sendable () -> T) async -> T {
        await withCheckedContinuation { continuation in
            queue.async { continuation.resume(returning: body()) }
        }
    }
}

private final class LockedBool {
    private let lock = NSLock()
    private var value = false
    func set(_ v: Bool) { lock.lock(); value = v; lock.unlock() }
    func get() -> Bool { lock.lock(); defer { lock.unlock() }; return value }
}

/// 每个会话一棵 subagent 树；agent_event 先进入短时 mailbox，再在主线程批量应用。
final class SubagentStore: ObservableObject {
    /// Agent rows publish manually so a mailbox drain can apply many mutations with one
    /// `objectWillChange`. Mutations outside a batch retain the old one-write/one-publish
    /// behavior through the in-place modifying accessor.
    private var agentStorage: [SubagentInfo] = []
    private(set) var agents: [SubagentInfo] {
        get { agentStorage }
        _modify {
            if agentPublicationBatchDepth == 0 {
                objectWillChange.send()
            }
            defer { agentsGeneration &+= 1 }
            yield &agentStorage
        }
    }
    private var agentPublicationBatchDepth = 0
    /// 随 agents 每次写入单调递增（非 @Published：agents 本身已负责触发刷新）。
    private(set) var agentsGeneration: UInt64 = 0

    // MARK: - Agent lookup and tree query indices
    /// Stable field updates do not invalidate structural indices. This is separate from
    /// `agentsGeneration`, which intentionally still tracks every row mutation.
    private var agentStructureGeneration: UInt64 = 0
    private var indexedStructureGeneration: UInt64 = .max
    private(set) var agentIndexRebuildCount = 0
    private var agentIndexByID: [String: Int] = [:]
    private var agentIndicesByToolCallId: [String: Set<Int>] = [:]
    private var childIndicesByParentId: [String: [Int]] = [:]

    private func rebuildAgentIndicesIfNeeded() {
        guard indexedStructureGeneration != agentStructureGeneration else { return }
        agentIndexRebuildCount &+= 1
        agentIndexByID.removeAll(keepingCapacity: true)
        agentIndicesByToolCallId.removeAll(keepingCapacity: true)
        childIndicesByParentId.removeAll(keepingCapacity: true)
        for (index, agent) in agents.enumerated() {
            agentIndexByID[agent.id] = index
            if let toolCallId = agent.toolCallId {
                agentIndicesByToolCallId[toolCallId, default: []].insert(index)
            }
            if let parentId = agent.parentId {
                childIndicesByParentId[parentId, default: []].append(index)
            }
        }
        indexedStructureGeneration = agentStructureGeneration
    }

    private func markAgentStructureChanged() {
        agentStructureGeneration &+= 1
    }

    private func rebuildAgentDerivedState() {
        markAgentStructureChanged()
        rebuildAgentIndicesIfNeeded()
        cachedRunningCount = agents.lazy.filter { $0.state == .running }.count
        cachedTotalCost = agents.reduce(0) { $0 + $1.cost }
        if cachedRunningCount == 0 {
            autoOpenWaveActive = false
        }
    }

    private func index(forAgentID id: String) -> Int? {
        rebuildAgentIndicesIfNeeded()
        guard let index = agentIndexByID[id] else { return nil }
        guard agents.indices.contains(index), agents[index].id == id else {
            // Defensive recovery for any future structural mutation that forgets to mark.
            markAgentStructureChanged()
            rebuildAgentIndicesIfNeeded()
            return agentIndexByID[id]
        }
        return index
    }

    func agent(forID id: String) -> SubagentInfo? {
        guard let index = index(forAgentID: id) else { return nil }
        return agents[index]
    }

    private func appendAgent(_ agent: SubagentInfo) {
        rebuildAgentIndicesIfNeeded()
        let newIndex = agents.endIndex
        agents.append(agent)
        agentStructureGeneration &+= 1
        agentIndexByID[agent.id] = newIndex
        if let toolCallId = agent.toolCallId {
            agentIndicesByToolCallId[toolCallId, default: []].insert(newIndex)
        }
        if let parentId = agent.parentId {
            childIndicesByParentId[parentId, default: []].append(newIndex)
        }
        indexedStructureGeneration = agentStructureGeneration
    }

    /// A resume keeps the row index stable, so update the tool-call index in place rather
    /// than invalidating and rebuilding every structural index for the whole tree.
    private func updateToolCallID(_ toolCallId: String, at index: Int) {
        rebuildAgentIndicesIfNeeded()
        let previous = agents[index].toolCallId
        guard previous != toolCallId else { return }
        if let previous {
            agentIndicesByToolCallId[previous]?.remove(index)
            if agentIndicesByToolCallId[previous]?.isEmpty == true {
                agentIndicesByToolCallId.removeValue(forKey: previous)
            }
        }
        agents[index].toolCallId = toolCallId
        agentIndicesByToolCallId[toolCallId, default: []].insert(index)
        agentStructureGeneration &+= 1
        indexedStructureGeneration = agentStructureGeneration
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
    /// 已发出中止请求、等待生命周期上报落终态的 agentId（停止按钮置灰防重复点击）。
    @Published private(set) var abortPending: Set<String> = []
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
    /// ChatSession injects `[post-merge-verify-failed]`. Third arg: main tree was dirty
    /// (the failure may be the user's own WIP rather than the agent's work).
    var onPostMergeVerifyFailed: ((SubagentInfo, PostMergeVerifyFailure, Bool) -> Void)?
    /// Fired after start/end when `runningCount` may have changed (main thread).
    /// ChatSession keeps the interrupted-path badge marked while background subagents run.
    var onRunningCountMayHaveChanged: (() -> Void)?
    /// Fired after a subagent row enters `.running`（start/续作）。ChatSession 用它收集
    /// 当前轮关联子 agent id——不扫历史，避免旧失败污染本轮。
    var onAgentStarted: ((String) -> Void)?
    /// Fired whenever an agent 的 closeout 可能已可判定：end 事件、auto-merge 结果
    /// （成功/失败/清理）、post-merge verify 完成（成功/失败）、对账/手动处置后。
    /// ChatSession 用它重新触发本轮通知补发（不轮询）。
    var onAgentCloseoutMayHaveChanged: (() -> Void)?
    /// 测试缝：替换 auto-merge 的 git 执行（nil = 真实 GitRepo 实现）。
    var mergeOutcomeOverride: (@MainActor (String, URL) async -> MergeGitOutcome?)?
    /// 测试缝：替换 post-merge verify 的进程执行与主仓脏判定（nil = 真实实现）。
    var postMergeVerifyOutcomeOverride: (@MainActor (String, URL) async -> PostMergeVerifyOutcome)?
    /// Dedup identical merge/verify-fail injections within 60s, keyed per event.
    private var recentNotifications: [String: Date] = [:]
    /// Prevent a restored row and its end event from scheduling the same automatic merge twice.
    private var automaticallyMergingAgentIDs: Set<String> = []
    /// 已安排 auto-merge / post-merge verify、closeout 尚不可判定的 agent id。
    /// 仅内存态：进程内异步链；App 重启后 pending 通知本就丢弃，磁盘对账会重建链。
    private var closeoutPendingAgentIDs: Set<String> = []
    /// Persisted rows load asynchronously after the main project may already be bound.
    private var hasLoadedPersistedAgents = false
    private var didRetryPersistedPendingReviewMerges = false
    /// Post-merge verify coalescing: distinct command → 本次被聚留的 agent 列表（含快照）。
    /// 验证只跑一次，但成功/失败结果应用到本次批次内全部相关 agent；flush 时清空，
    /// 之后同命令的新 merge 重新建批，不被旧批次结果提前最终化。
    private var pendingVerifyByCommand: [String: [SubagentInfo]] = [:]
    private var pendingVerifyFlush: DispatchWorkItem?
    /// Debounce window: merges of one wave land within a second or two of each other.
    static var verifyCoalesceWindow: TimeInterval = 2.0
    private var logCounter = 0
    private var cachedRunningCount = 0
    private var cachedTotalCost: Double = 0

    // MARK: - High-fanout event mailbox
    private struct PendingAgentEvent {
        let event: J
        let observedAt: Date
    }
    private var pendingAgentEvents: [PendingAgentEvent] = []
    /// Latest replaceable telemetry slot per agent/kind, cleared at every per-agent segment barrier.
    private var replaceablePendingEventIndex: [String: Int] = [:]
    private var pendingLastEventKindByAgent: [String: String] = [:]
    /// Lifecycle projection for events waiting in the mailbox. Auto-open decisions must
    /// observe enqueue order, not the last published tree, because an end and the next
    /// root start can arrive inside the same 16ms window.
    private var projectedRunningByAgentID: [String: Bool] = [:]
    private var projectedRunningCount: Int?
    private var pendingEventDrain: DispatchWorkItem?
    private static let eventCoalesceWindow: TimeInterval = 0.016
    private var autoOpenWaveActive = false

    /// Internal setter so tests can attach a disk target without the restart-reconcile
    /// side effects of `attachPersistence`.
    var persistURL: URL?
    private enum PersistencePriority: Int {
        case telemetry = 0
        case lifecycle = 1

        var delay: TimeInterval {
            switch self {
            case .telemetry: return 0.5
            case .lifecycle: return 0.05
            }
        }
    }
    private var pendingSaveWorkItem: DispatchWorkItem?
    private var pendingSavePriority: PersistencePriority?
    private var persistWriteInFlight = false
    private var dirtyWhilePersistingPriority: PersistencePriority?
    private var persistenceToken: UInt64 = 0
    private var consecutivePersistenceFailures = 0
    private static let maximumAutomaticPersistenceRetries = 2
    private(set) var persistenceWriteCount = 0
    var hasPendingPersistenceWrite: Bool {
        pendingSaveWorkItem != nil || persistWriteInFlight || dirtyWhilePersistingPriority != nil
    }
    /// Serial queue for JSON encode + atomic write (TokenLedger.append 模式：主线程只拷快照)。
    private let persistQueue = DispatchQueue(label: "pipiui.subagentstore.persist")
    /// Panel appearance and main-turn settle can fire close together; Git reconciliation is capped per store.
    private static let worktreeReconcileThrottle: TimeInterval = 10
    private var lastWorktreeReconcileAt: Date?
    /// 运行中对账 tick：stale 窗口（10min）内至少扫到一次；60s 误差可接受。
    private static let orphanReconcileInterval: TimeInterval = 60
    private static let orphanReconcileTolerance: TimeInterval = 10
    /// 所属会话进程存活判定（ChatSession 注入，读 processAlive）；nil = 未启动对账。
    private var sessionAlivenessProvider: (() -> Bool)?
    /// 运行中对账 timer；deinit 失效，生命周期跟随 store，不泄漏。
    private var orphanReconcileTimer: Timer?

    deinit {
        pendingEventDrain?.cancel()
        pendingSaveWorkItem?.cancel()
        orphanReconcileTimer?.invalidate()
    }

    /// Bind the session's main project URL so successful agents can auto-merge.
    func bindMainProject(_ url: URL) {
        mainProjectURL = url
        retryPersistedPendingReviewMergesIfReady()
    }

    // MARK: - 持久化（跟随 pi 会话文件，App 崩溃/重启后恢复 agent 树）

    /// Reconcile persisted "running" rows after process restart. The process is gone,
    /// so the work must remain reviewable and explicitly classified.
    static func reconcileInterruptedAfterRestart(
        _ persisted: [SubagentInfo]
    ) -> [SubagentInfo] {
        var loaded = persisted
        for i in loaded.indices where loaded[i].state == .running {
            loaded[i].state = .interrupted
            loaded[i].activity = ""
            loaded[i].stalled = false
            loaded[i].stalledIdleSec = 0
            loaded[i].ended = loaded[i].ended ?? Date()
            loaded[i].closeoutDisposition = .retained
            loaded[i].closeoutReason = "App 重启时 agent 仍在运行；按中断成果保留"
            if let path = loaded[i].worktreePath, !path.isEmpty {
                loaded[i].worktreeLifecycle = .pendingReview
            }
        }
        return loaded
    }

    /// App 运行中对账：把「所属会话进程已死、且桥接观察静默超过 watchdog 窗口」的
    /// `.running` 幽灵扫成 `.interrupted`。与 `reconcileInterruptedAfterRestart` 语义一致
    /// （retained、清 activity、补 ended、worktree 转 pendingReview），区别：只在 App 运行期
    /// 使用，且要求会话进程已死——进程活着时，扩展侧 vanished 结算（runningAgents 属于父
    /// 运行时）才是收尸人，App 不越界，避免误伤活 worker。幂等：只动 `.running` 行。
    static func reconcileOrphaned(
        _ persisted: [SubagentInfo], now: Date, sessionAlive: Bool
    ) -> [SubagentInfo] {
        guard !sessionAlive else { return persisted }
        let stale = Set(SubagentWatchdog.staleAgentIDs(in: persisted, now: now))
        guard !stale.isEmpty else { return persisted }
        var loaded = persisted
        for i in loaded.indices where loaded[i].state == .running && stale.contains(loaded[i].id) {
            loaded[i].state = .interrupted
            loaded[i].activity = ""
            loaded[i].stalled = false
            loaded[i].stalledIdleSec = 0
            loaded[i].ended = loaded[i].ended ?? now
            loaded[i].closeoutDisposition = .retained
            loaded[i].closeoutReason =
                "会话进程已退出且超过 \(Int(SubagentWatchdog.staleThreshold / 60)) 分钟无观察事件；按中断成果保留"
            if let path = loaded[i].worktreePath, !path.isEmpty {
                loaded[i].worktreeLifecycle = .pendingReview
            }
        }
        return loaded
    }

    /// 会话文件路径已知后挂载持久化：加载历史 agent 树，此后每次事件防抖落盘。
    func attachPersistence(sessionFile: String) {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI/subagents")
        let name = URL(fileURLWithPath: sessionFile).deletingPathExtension().lastPathComponent + ".agents.json"
        let url = dir.appendingPathComponent(name)
        guard persistURL != url else { return }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        persistURL = url

        // App restart ⇒ no prior-process worker is still alive. Hot sessions may already
        // have rows from message replay before this runs; still reconcile ghosts immediately.
        let needsPersist = applyRestartReconcileToLiveAgents()

        // 后台读 + 解码持久化 JSON，完成后回主线程 assign/merge（避免主线程 IO/解码卡顿）。
        let loadTask = Task.detached(priority: .utility) {
            guard let data = try? Data(contentsOf: url),
                  let persisted = try? JSONDecoder().decode([SubagentInfo].self, from: data) else {
                return Optional<[SubagentInfo]>.none
            }
            return Self.reconcileInterruptedAfterRestart(persisted)
        }
        Task { @MainActor [weak self] in
            guard let self, self.persistURL == url else { return }
            let loaded = await loadTask.value
            var didMutate = needsPersist

            if let loaded {
                if self.agents.isEmpty {
                    self.agents = loaded
                    self.logCounter = loaded.flatMap(\.log).map(\.id).max() ?? 0
                    self.rebuildAgentDerivedState()
                    didMutate = true
                } else {
                    // Merge: keep live fields (already restart-reconciled); append missing history.
                    let liveIds = Set(self.agents.map(\.id))
                    let extras = loaded.filter { !liveIds.contains($0.id) }
                    if !extras.isEmpty {
                        self.agents.append(contentsOf: extras)
                        self.rebuildAgentDerivedState()
                        let maxLogId = self.agents.flatMap(\.log).map(\.id).max() ?? 0
                        if maxLogId > self.logCounter { self.logCounter = maxLogId }
                        didMutate = true
                    }
                    // Replay may race during load — reconcile again (idempotent).
                    if self.applyRestartReconcileToLiveAgents() {
                        didMutate = true
                    }
                }
            } else if self.applyRestartReconcileToLiveAgents() {
                didMutate = true
            }

            self.hasLoadedPersistedAgents = true
            if self.selectedId == nil { self.selectedId = self.agents.last?.id }
            self.retryPersistedPendingReviewMergesIfReady()

            // Without an event-driven save, reconciled ghosts stay `.running` on disk forever.
            if didMutate {
                self.saveNow()
            }
        }
    }

    /// Mark any in-memory `.running` rows as interrupted after process restart.
    /// Idempotent for terminal states. Returns whether any row changed.
    @discardableResult
    private func applyRestartReconcileToLiveAgents() -> Bool {
        let before = agents
        let reconciled = Self.reconcileInterruptedAfterRestart(agents)
        guard reconciled != before else { return false }
        let hadRunning = before.contains { $0.state == .running }
        agents = reconciled
        rebuildAgentDerivedState()
        if hadRunning {
            onRunningCountMayHaveChanged?()
            onAgentCloseoutMayHaveChanged?()
        }
        return true
    }

    /// 单次孤儿对账（timer 每 tick 调一次；ChatSession 也会在进程退出时立即调一次）。
    /// 会话进程活着 → 跳过（扩展侧 vanished 结算负责）；无命中 → 不动磁盘。
    /// 有命中 → 扫成 interrupted 并 saveNow 直接落盘（不走防抖，保证磁盘不再长期挂幽灵）。
    @discardableResult
    func reconcileOrphanedNow(now: Date = Date()) -> Bool {
        guard sessionAlivenessProvider?() == false else { return false }
        let before = agents
        let reconciled = Self.reconcileOrphaned(before, now: now, sessionAlive: false)
        guard reconciled != before else { return false }
        agents = reconciled
        rebuildAgentDerivedState()
        onRunningCountMayHaveChanged?()
        onAgentCloseoutMayHaveChanged?()
        saveNow()
        return true
    }

    /// 启动运行中对账 timer（幂等：重复调用只更新 liveness 闭包，timer 保持单例）。
    /// `isSessionAlive` 由 ChatSession 注入（读本会话 pi 进程存活状态）。
    func startOrphanReconciliation(isSessionAlive: @escaping () -> Bool) {
        sessionAlivenessProvider = isSessionAlive
        guard orphanReconcileTimer == nil else { return }
        let timer = Timer(timeInterval: Self.orphanReconcileInterval, repeats: true) {
            [weak self] _ in
            self?.reconcileOrphanedNow()
        }
        timer.tolerance = Self.orphanReconcileTolerance
        RunLoop.main.add(timer, forMode: .common)
        orphanReconcileTimer = timer
    }

    /// After restart, resume one missed automatic merge for each eligible persisted row.
    /// The end-event path uses the same scheduler, so a concurrent replay cannot duplicate Git work.
    private func retryPersistedPendingReviewMergesIfReady() {
        guard hasLoadedPersistedAgents,
              !didRetryPersistedPendingReviewMerges,
              let main = mainProjectURL else { return }
        didRetryPersistedPendingReviewMerges = true
        for agent in agents where agent.state == .ok
                && agent.worktreeLifecycle == .pendingReview
                && (agent.verifyExit ?? 0) == 0
                && agent.worktreePath?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
            scheduleAutomaticMerge(agentId: agent.id, mainProjectURL: main)
        }
    }

    private func scheduleAutomaticMerge(agentId: String, mainProjectURL: URL) {
        guard automaticallyMergingAgentIDs.insert(agentId).inserted else { return }
        closeoutPendingAgentIDs.insert(agentId)
        Task { [weak self] in
            _ = await self?.mergeWorktree(agentId: agentId, mainProjectURL: mainProjectURL)
            self?.automaticallyMergingAgentIDs.remove(agentId)
        }
    }

    private func scheduleSave(priority: PersistencePriority = .lifecycle) {
        guard persistURL != nil else { return }
        if persistWriteInFlight {
            if priority.rawValue > (dirtyWhilePersistingPriority?.rawValue ?? -1) {
                dirtyWhilePersistingPriority = priority
            }
            return
        }
        if let existing = pendingSavePriority, existing.rawValue >= priority.rawValue {
            return
        }
        pendingSaveWorkItem?.cancel()
        pendingSavePriority = priority
        let item = DispatchWorkItem { [weak self] in
            self?.beginPersistenceWrite()
        }
        pendingSaveWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + priority.delay, execute: item)
    }

    /// At most one full snapshot is encoding/writing. Events arriving during that write
    /// set one dirty bit (with lifecycle priority) instead of queueing more snapshots.
    private func beginPersistenceWrite() {
        dispatchPrecondition(condition: .onQueue(.main))
        pendingSaveWorkItem = nil
        pendingSavePriority = nil
        guard let persistURL, !persistWriteInFlight else { return }
        persistWriteInFlight = true
        persistenceToken &+= 1
        let token = persistenceToken
        let snapshot = agents
        persistenceWriteCount &+= 1
        persistQueue.async { [weak self] in
            let succeeded: Bool
            do {
                let data = try JSONEncoder().encode(snapshot)
                try data.write(to: persistURL, options: .atomic)
                succeeded = true
            } catch {
                succeeded = false
            }
            DispatchQueue.main.async {
                self?.finishPersistenceWrite(token: token, succeeded: succeeded)
            }
        }
    }

    private func finishPersistenceWrite(token: UInt64, succeeded: Bool) {
        guard token == persistenceToken else { return }
        persistWriteInFlight = false
        if succeeded {
            consecutivePersistenceFailures = 0
        } else {
            consecutivePersistenceFailures += 1
        }
        var followUp = dirtyWhilePersistingPriority
        dirtyWhilePersistingPriority = nil
        if !succeeded,
           consecutivePersistenceFailures <= Self.maximumAutomaticPersistenceRetries {
            followUp = .lifecycle
        }
        if let followUp {
            scheduleSave(priority: followUp)
        }
    }

    /// 同步 flush：排队等此前所有异步写完成后，本快照 encode+write 一并落盘。
    /// 用于退出路径（AppStore.shutdown → applicationWillTerminate、ChatSession.shutdown）。
    func saveNow() {
        guard let persistURL else { return }
        pendingSaveWorkItem?.cancel()
        pendingSaveWorkItem = nil
        pendingSavePriority = nil
        dirtyWhilePersistingPriority = nil
        // Invalidate completion callbacks from a previous asynchronous write. The sync
        // below waits behind that write, then persists the newest lifecycle state.
        persistenceToken &+= 1
        let snapshot = agents
        persistQueue.sync {
            guard let data = try? JSONEncoder().encode(snapshot) else { return }
            try? data.write(to: persistURL, options: .atomic)
        }
        persistWriteInFlight = false
        consecutivePersistenceFailures = 0
        persistenceWriteCount &+= 1
    }

    var runningCount: Int {
        cachedRunningCount
    }

    /// closeout 是否已可判定：终态、已有明确处置、且无未决 auto-merge/post-merge verify 链。
    /// 本轮通知等全部关联 agent 可判定后才补发，避免先发成功、后到 .needsFixer/.needsUser。
    func isCloseoutDecidable(_ agent: SubagentInfo) -> Bool {
        agent.state != .running
            && agent.closeoutDisposition != .unclassified
            && !closeoutPendingAgentIDs.contains(agent.id)
    }

    var totalCost: Double {
        cachedTotalCost
    }

    /// Running agents whose UI bridge observation has been silent for the
    /// conservative watchdog window. `now` is injectable for deterministic tests.
    func staleRunningAgentIDs(now: Date = Date()) -> [String] {
        SubagentWatchdog.staleAgentIDs(in: agents, now: now)
    }

    /// 打开 Subagents 面板时选中最近启动的 agent；不会在面板已打开时抢走用户的手动选择。
    func selectLatest() {
        selectedId = agents.max(by: { $0.started < $1.started })?.id
    }

    /// 标记已发出中止请求（面板停止按钮置灰）；end 上报到达或 RPC 失败时清除。
    func markAbortPending(_ agentId: String) {
        abortPending.insert(agentId)
    }

    /// 中止 RPC 未被接受时解除置灰，允许重试。
    func clearAbortPending(_ agentId: String) {
        abortPending.remove(agentId)
    }

    /// 任意正常活动上报到达 → 解除 stalled 标记（扩展侧恢复活动时也会重新武装 watchdog）。
    private func clearStalled(_ index: Int) {
        agents[index].stalled = false
        agents[index].stalledIdleSec = 0
    }

    private func markObserved(_ index: Int, at date: Date) {
        if date > agents[index].lastObservedAt {
            agents[index].lastObservedAt = date
        }
    }

    /// Advances the mailbox's lifecycle projection and returns whether this event starts
    /// a new root wave. The projection is updated before later events are considered, so
    /// `end(A) -> start(B)` in one mailbox window correctly opens B's new wave.
    private func projectAutoOpenDecision(for event: J, agentID id: String) -> Bool {
        if projectedRunningCount == nil {
            projectedRunningCount = cachedRunningCount
        }
        let wasRunning = projectedRunningByAgentID[id]
            ?? index(forAgentID: id).map { agents[$0].state == .running }
            ?? false
        let kind = event["kind"].string ?? ""
        let willRun: Bool
        switch kind {
        case "start": willRun = true
        case "end": willRun = false
        default: willRun = wasRunning
        }

        let startsNewRootWave = kind == "start"
            && event["parentId"].string == nil
            && projectedRunningCount == 0
            && !autoOpenWaveActive
        if wasRunning != willRun {
            projectedRunningCount = max(
                0,
                (projectedRunningCount ?? 0) + (willRun ? 1 : -1)
            )
            projectedRunningByAgentID[id] = willRun
        }
        if projectedRunningCount == 0 {
            autoOpenWaveActive = false
        }
        if startsNewRootWave {
            autoOpenWaveActive = true
            selectedId = id
        }
        return startsNewRootWave
    }

    /// O(1) bridge ingress. Replaceable telemetry is collapsed within one frame; log and
    /// usage records remain lossless, and start/end events form ordering barriers per agent.
    /// The return value is true exactly once when a root event begins a projected wave.
    @discardableResult
    func enqueue(_ event: J, observedAt: Date = Date()) -> Bool {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let id = event["agentId"].string, !id.isEmpty else { return false }
        let shouldAutoOpen = projectAutoOpenDecision(for: event, agentID: id)
        let kind = event["kind"].string ?? ""
        let replacementKey = "\(id)|\(kind)"
        // Coalesce only one consecutive same-kind segment. Any intervening event for
        // this agent is an ordering barrier, including lossless log/usage records.
        if pendingLastEventKindByAgent[id] != kind {
            replaceablePendingEventIndex.removeValue(forKey: "\(id)|update")
            replaceablePendingEventIndex.removeValue(forKey: "\(id)|stalled")
        }
        pendingLastEventKindByAgent[id] = kind
        if kind == "update" || kind == "stalled" {
            if let index = replaceablePendingEventIndex[replacementKey] {
                pendingAgentEvents[index] = PendingAgentEvent(
                    event: event,
                    observedAt: observedAt
                )
            } else {
                replaceablePendingEventIndex[replacementKey] = pendingAgentEvents.count
                pendingAgentEvents.append(PendingAgentEvent(event: event, observedAt: observedAt))
            }
        } else {
            pendingAgentEvents.append(PendingAgentEvent(event: event, observedAt: observedAt))
        }
        guard pendingEventDrain == nil else { return shouldAutoOpen }
        let item = DispatchWorkItem { [weak self] in
            self?.flushPendingAgentEvents()
        }
        pendingEventDrain = item
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.eventCoalesceWindow, execute: item)
        return shouldAutoOpen
    }

    func flushPendingAgentEvents() {
        dispatchPrecondition(condition: .onQueue(.main))
        pendingEventDrain?.cancel()
        pendingEventDrain = nil
        let batch = pendingAgentEvents
        pendingAgentEvents.removeAll(keepingCapacity: true)
        replaceablePendingEventIndex.removeAll(keepingCapacity: true)
        pendingLastEventKindByAgent.removeAll(keepingCapacity: true)
        projectedRunningByAgentID.removeAll(keepingCapacity: true)
        projectedRunningCount = nil
        applyAgentEvents(batch)
    }

    var pendingAgentEventCount: Int { pendingAgentEvents.count }

    func handle(_ e: J, observedAt: Date = Date()) {
        applyAgentEvents([PendingAgentEvent(event: e, observedAt: observedAt)])
    }

    private func applyAgentEvents(_ events: [PendingAgentEvent]) {
        guard !events.isEmpty else { return }
        objectWillChange.send()
        agentPublicationBatchDepth += 1
        var didMutate = false
        var lifecycleChanged = false
        for pending in events {
            let result = applyAgentEvent(pending.event, observedAt: pending.observedAt)
            didMutate = didMutate || result.didMutate
            lifecycleChanged = lifecycleChanged || result.lifecycleChanged
        }
        agentPublicationBatchDepth -= 1
        guard didMutate else { return }
        scheduleSave(priority: lifecycleChanged ? .lifecycle : .telemetry)
        if lifecycleChanged {
            onRunningCountMayHaveChanged?()
            onAgentCloseoutMayHaveChanged?()
        }
        if cachedRunningCount == 0 {
            autoOpenWaveActive = false
        }
    }

    private func applyAgentEvent(
        _ e: J,
        observedAt: Date
    ) -> (didMutate: Bool, lifecycleChanged: Bool) {
        guard let id = e["agentId"].string, !id.isEmpty else { return (false, false) }
        let kind = e["kind"].string ?? ""
        let oldIndex = index(forAgentID: id)
        let oldState = oldIndex.map { agents[$0].state }
        let oldCost = oldIndex.map { agents[$0].cost } ?? 0
        // For every event tied to an existing agent, record that the UI-side
        // status channel itself is still delivering. `start` also covers a new row.
        if kind != "start", let i = oldIndex {
            markObserved(i, at: observedAt)
        }
        var lifecycleChanged = false
        var didMutate = true
        switch kind {
        case "start":
            lifecycleChanged = true
            // Same agentId may resume (续作) after end — refresh running state + worktree meta.
            if let i = oldIndex {
                markObserved(i, at: observedAt)
                agents[i].state = .running
                agents[i].activity = ""
                clearStalled(i)
                if abortPending.contains(id) { abortPending.remove(id) }
                agents[i].ended = nil
                agents[i].closeoutDisposition = .unclassified
                agents[i].closeoutReason = nil
                if let tc = e["toolCallId"].string { updateToolCallID(tc, at: i) }
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
                model: e["model"].string,
                started: observedAt,
                lastObservedAt: observedAt
            )
            info.worktreePath = e["worktreePath"].string
            info.worktreeBranch = e["worktreeBranch"].string
            info.worktreeError = e["worktreeError"].string
            if let path = info.worktreePath, !path.isEmpty {
                info.worktreeLifecycle = .active
            }
            appendAgent(info)
            if selectedId == nil { selectedId = id }
        case "update":
            guard let i = oldIndex else { return (false, false) }
            clearStalled(i)
            if let output = e["output"].string, !output.isEmpty { agents[i].output = output }
            agents[i].activity = e["activity"].string ?? agents[i].activity
            agents[i].cost = e["cost"].double ?? agents[i].cost
            agents[i].turns = e["turns"].int ?? agents[i].turns
        case "log":
            guard let i = oldIndex else { return (false, false) }
            clearStalled(i)
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
            guard let i = oldIndex else { return (false, false) }
            clearStalled(i)
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
        case "stalled":
            // Stall watchdog：120s+ 无流式事件 → 面板黄标；后续 update/log/usage 自动解除。
            guard let i = oldIndex else { return (false, false) }
            if agents[i].state == .running {
                agents[i].stalled = true
                agents[i].stalledIdleSec = e["idle"].int ?? agents[i].stalledIdleSec
                if let last = e["activity"].string, !last.isEmpty {
                    agents[i].activity = last
                }
            }
        case "end":
            guard let i = oldIndex else { return (false, false) }
            lifecycleChanged = true
            clearStalled(i)
            if abortPending.contains(id) { abortPending.remove(id) }
            // Vanished/interrupted is not a user abort and not a failed answer — keep
            // resumable context (same disposition as reconcileInterruptedAfterRestart).
            let interruptedFlag = e["interrupted"].bool == true || e["vanished"].bool == true
            if interruptedFlag {
                agents[i].state = .interrupted
            } else if e["aborted"].bool == true {
                agents[i].state = .aborted
            } else {
                agents[i].state = (e["ok"].bool == true) ? .ok : .failed
            }
            if let output = e["output"].string, !output.isEmpty { agents[i].output = output }
            agents[i].activity = ""
            agents[i].cost = e["cost"].double ?? agents[i].cost
            agents[i].turns = e["turns"].int ?? agents[i].turns
            agents[i].ended = observedAt
            if let path = e["worktreePath"].string { agents[i].worktreePath = path }
            if let branch = e["worktreeBranch"].string { agents[i].worktreeBranch = branch }
            if let err = e["worktreeError"].string { agents[i].worktreeError = err }
            if let verify = e["verifyCommand"].string { agents[i].verifyCommand = verify }
            if let verifyExit = e["verifyExit"].int { agents[i].verifyExit = verifyExit }
            // Terminal + still has worktree path → pending review.
            if let path = agents[i].worktreePath, !path.isEmpty {
                switch agents[i].worktreeLifecycle {
                case .merged, .mergedCleanupPending, .discarded:
                    break
                default:
                    agents[i].worktreeLifecycle = .pendingReview
                }
            }
            let verifyFailed = (agents[i].verifyExit ?? 0) != 0
            if agents[i].state != .ok {
                agents[i].closeoutDisposition = .retained
                agents[i].closeoutReason = "agent \(agents[i].state.rawValue)；成果与 worktree 保留审核"
            } else if verifyFailed {
                agents[i].closeoutDisposition = .retained
                agents[i].closeoutReason = "agent worktree 验证失败；禁止自动合并或清理"
            } else if agents[i].worktreePath?.isEmpty != false {
                // Explicit-main-cwd roles (notably secretary) have no branch/worktree to clean.
                agents[i].closeoutDisposition = .cleaned
                agents[i].closeoutReason = "无隔离 worktree；运行时无需机械清理"
            }
            // Product default: successful agent + worktree → auto-merge into main + remove wt.
            // failed/aborted/interrupted (incl. vanished settle) keep pendingReview for续作.
            // Attested verify FAILED in the worktree (verifyExit present and ≠ 0): keep
            // pendingReview and skip auto-merge — merging would knowingly break main and
            // delete the worktree the failure-recovery loop needs.
            if agents[i].state == .ok,
               agents[i].worktreeLifecycle == .pendingReview,
               (agents[i].verifyExit ?? 0) == 0,
               let main = mainProjectURL {
                let aid = agents[i].id
                // git 操作在 mergeWorktree 内部 Task.detached 后台执行，主线程只收尾状态。
                scheduleAutomaticMerge(agentId: aid, mainProjectURL: main)
            }
        default:
            didMutate = false
        }

        if didMutate, let newIndex = index(forAgentID: id) {
            let newState = agents[newIndex].state
            let newCost = agents[newIndex].cost
            if oldState == .running, newState != .running {
                cachedRunningCount -= 1
            } else if oldState != .running, newState == .running {
                cachedRunningCount += 1
            }
            cachedTotalCost += newCost - oldCost
        }
        if kind == "start" {
            onAgentStarted?(id)
        }
        return (didMutate, lifecycleChanged)
    }

    /// 活动序（与主会话按 modified 排序一致）：已完成在前、谁最后动谁排前，
    /// 运行中整体垫底（组内同样按最近活动排序）。依据 UI 观测到的最近一次
    /// 桥接事件 lastObservedAt；agent 终态后不再有事件，已完成部分的相对顺序稳定。
    var displayOrder: [SubagentInfo] {
        agents.sorted { lhs, rhs in
            let lhsRunning = lhs.state == .running
            let rhsRunning = rhs.state == .running
            if lhsRunning != rhsRunning {
                return !lhsRunning // 运行中放最下面
            }
            if lhs.lastObservedAt != rhs.lastObservedAt {
                return lhs.lastObservedAt > rhs.lastObservedAt
            }
            return lhs.id < rhs.id
        }
    }

    func clearFinished() {
        agents.removeAll { $0.state != .running }
        rebuildAgentDerivedState()
        abortPending.formIntersection(agents.map(\.id))
        if let selected = selectedId, index(forAgentID: selected) == nil {
            selectedId = agents.first?.id
        }
        scheduleSave()
        // 清掉的行已无 closeout 可等；剩下的行若已可判定，给本轮通知一次补发机会。
        onAgentCloseoutMayHaveChanged?()
    }

    /// 用户手动把失败项标记为已处理：closeout 置为 `.cleaned`，不再计入「需关注」。
    /// `agents` 的 in-place 修改访问器在批外自动发布 objectWillChange，无需手动发送。
    func markCleaned(id: String) {
        guard let i = index(forAgentID: id) else { return }
        agents[i].closeoutDisposition = .cleaned
        agents[i].closeoutReason = "用户标记为已处理"
        scheduleSave()
        onAgentCloseoutMayHaveChanged?()
    }

    /// Reconcile terminal agent rows with Git after the worktree was handled outside this panel.
    /// This is observation-only: it never removes a worktree, branch, or file. Synchronous Git
    /// probes run on the serialized main-repo background queue; only state updates run on main.
    @MainActor
    func reconcileWorktreeLifecycles(mainProjectURL: URL? = nil) async {
        guard let main = mainProjectURL ?? self.mainProjectURL else { return }

        let candidates = agents.compactMap { agent -> WorktreeReconcileCandidate? in
            guard agent.state != .running else { return nil }
            guard agent.worktreeLifecycle == .active
                    || agent.worktreeLifecycle == .pendingReview else { return nil }
            guard let branch = agent.worktreeBranch?
                .trimmingCharacters(in: .whitespacesAndNewlines),
                  !branch.isEmpty else { return nil }
            let path = agent.worktreePath?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return WorktreeReconcileCandidate(
                agentId: agent.id,
                branch: branch,
                persistedWorktreePath: path.flatMap { $0.isEmpty ? nil : $0 }
            )
        }
        guard !candidates.isEmpty else { return }

        let now = Date()
        if let lastWorktreeReconcileAt,
           now.timeIntervalSince(lastWorktreeReconcileAt) < Self.worktreeReconcileThrottle {
            return
        }
        lastWorktreeReconcileAt = now

        let results: [WorktreeReconcileResult] = await MainRepoSerialQueue.run {
            candidates.compactMap { candidate -> WorktreeReconcileResult? in
                // A persisted path still on disk is not externally closed out, even if Git's
                // registration is momentarily unavailable or stale.
                if let path = candidate.persistedWorktreePath,
                   FileManager.default.fileExists(atPath: path) {
                    return nil
                }

                let state = GitRepo.reconcileAgentBranch(
                    candidate.branch,
                    persistedWorktreePath: candidate.persistedWorktreePath,
                    integrationRef: "HEAD",
                    in: main
                )
                guard state.registeredWorktreePath == nil else { return nil }

                switch state.disposition {
                case .eligible:
                    guard state.branchExists,
                          state.isAncestorOfIntegrationHead == true else { return nil }
                    return WorktreeReconcileResult(candidate: candidate, resolution: .merged)
                case .alreadyAbsent:
                    guard !state.branchExists else { return nil }
                    return WorktreeReconcileResult(candidate: candidate, resolution: .discarded)
                case .retainedNonInternal, .retainedRegisteredWorktree,
                     .retainedUniqueCommits, .blocked:
                    return nil
                }
            }
        }

        var didChange = false
        for result in results {
            guard let index = index(forAgentID: result.candidate.agentId) else { continue }
            let trimmedCurrentPath = agents[index].worktreePath?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let currentPath = trimmedCurrentPath.flatMap { $0.isEmpty ? nil : $0 }
            guard agents[index].state != .running,
                  agents[index].worktreeLifecycle == .active
                    || agents[index].worktreeLifecycle == .pendingReview,
                  agents[index].worktreeBranch?
                    .trimmingCharacters(in: .whitespacesAndNewlines) == result.candidate.branch,
                  currentPath == result.candidate.persistedWorktreePath else {
                continue
            }

            switch result.resolution {
            case .merged:
                agents[index].worktreeLifecycle = .merged
                agents[index].worktreeError = nil
                agents[index].closeoutDisposition = .cleaned
                agents[index].closeoutReason = "外部已集成（非本面板合并）；worktree 已清理"
            case .discarded:
                agents[index].worktreeLifecycle = .discarded
                agents[index].worktreeError = nil
                agents[index].closeoutDisposition = .cleaned
                agents[index].closeoutReason = "外部已清理 worktree 与分支"
            }
            didChange = true
        }

        if didChange {
            // This unkeyed panel error is necessarily stale once its pending row is closed out.
            worktreeActionError = nil
            scheduleSave()
            onAgentCloseoutMayHaveChanged?()
        }
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
        guard let i = index(forAgentID: agentId) else {
            cancelPendingCloseout(agentId)
            return setWorktreeError("找不到 agent")
        }
        let agent = agents[i]
        guard agent.canReviewWorktree,
              let pathStr = agent.worktreePath, !pathStr.isEmpty,
              let branch = agent.worktreeBranch, !branch.isEmpty else {
            cancelPendingCloseout(agentId)
            return setWorktreeError("没有可合并的 worktree（需审核中且有 branch/path）")
        }
        if branch.hasPrefix("-") || pathStr.hasPrefix("-") {
            cancelPendingCloseout(agentId)
            return setWorktreeError("非法 branch/path")
        }

        let wtURL = URL(fileURLWithPath: pathStr, isDirectory: true)
        let main = mainProjectURL

        let outcome: MergeGitOutcome
        if let override = mergeOutcomeOverride {
            outcome = await override(agentId, main) ?? .mergeFailed("测试替身未提供合并结果")
        } else {
            // Serialized against every other main-repo operation (other merges, verify runs).
            outcome = await MainRepoSerialQueue.run {
                // A clean branch that is already reachable from main has no agent work to merge.
                // Remove it directly, but only after both conditions prove no changes can be lost.
                if !GitRepo.probe(workTree: wtURL).isDirty,
                   GitRepo.isAncestor(branch, of: "HEAD", in: main) {
                    do {
                        try GitRepo.worktreeRemove(at: wtURL, in: main, force: false)
                    } catch {
                        let msg = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                        return .removeFailed(msg)
                    }
                    let cleanup = GitRepo.safelyDeleteMergedAgentBranch(
                        branch,
                        persistedWorktreePath: pathStr,
                        integrationRef: "HEAD",
                        in: main
                    )
                    if let warning = cleanup.warning, !warning.isEmpty {
                        return .cleanupFailed(warning)
                    }
                    return .zeroChangeCleaned
                }

                // Best-effort: commit dirty files in the agent worktree so they are not lost.
                _ = GitRepo.commitAllIfDirty(
                    in: wtURL,
                    message: "pipiui: agent \(agentId) work"
                )
                // Never force-remove unexplained leftovers after a failed commit attempt.
                // The existing add-all commit contract remains for compatibility, but a
                // still-dirty tree is retained for secretary/fixer classification.
                if GitRepo.probe(workTree: wtURL).isDirty {
                    return .mergeFailed(
                        "agent worktree 提交后仍有未提交/未分类文件；已保留，禁止自动清理"
                    )
                }
                do {
                    try GitRepo.mergeBranch(branch, into: main)
                } catch {
                    let msg = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    return .mergeFailed(msg)
                }
                do {
                    try GitRepo.worktreeRemove(at: wtURL, in: main, force: false)
                } catch {
                    let msg = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    return .removeFailed(msg)
                }
                let cleanup = GitRepo.safelyDeleteMergedAgentBranch(
                    branch,
                    persistedWorktreePath: pathStr,
                    integrationRef: "HEAD",
                    in: main
                )
                if let warning = cleanup.warning, !warning.isEmpty {
                    return .cleanupFailed(warning)
                }
                return .ok
            }
        }

        // 回到主线程：git 期间 agent 可能已被清空/移除，写状态前 re-check。
        // auto-merge 链到此终结 → 解除 pending；随后安排的 post-merge verify 会重新置 pending。
        closeoutPendingAgentIDs.remove(agentId)
        var result: String?
        switch outcome {
        case .zeroChangeCleaned:
            if let idx = index(forAgentID: agentId) {
                agents[idx].worktreeLifecycle = .merged
                agents[idx].worktreeError = nil
                agents[idx].closeoutDisposition = .cleaned
                agents[idx].closeoutReason = "零改动,已直接清理"
                scheduleSave()
            }
        case .ok:
            if let idx = index(forAgentID: agentId) {
                agents[idx].worktreeLifecycle = .merged
                agents[idx].worktreeError = nil
                markIntegratedAwaitingVerifyOrCleaned(index: idx)
                // Keep path/branch strings for history display; buttons hide via lifecycle.
                scheduleSave()
                schedulePostMergeVerify(agent: agents[idx], mainProjectURL: main)
            }
        case .mergeFailed(let msg):
            let dirtyPrefix = GitRepo.probe(workTree: main).isDirty ? "主仓有未提交改动;" : ""
            let full = "\(dirtyPrefix)合并失败（worktree 未删除）: \(msg)"
            if let idx = index(forAgentID: agentId) {
                agents[idx].closeoutDisposition = .needsFixer
                agents[idx].closeoutReason = full
                notifyMergeFailed(agent: agents[idx], error: full)
            }
            result = setWorktreeError(full)
        case .removeFailed(let msg):
            // Merge already succeeded — preserve integration, retain actionable cleanup state,
            // and still run post-merge verify.
            if let idx = index(forAgentID: agentId) {
                let warning = "已合并，但删除 worktree 失败: \(msg)"
                agents[idx].worktreeLifecycle = .mergedCleanupPending
                agents[idx].worktreeError = warning
                agents[idx].closeoutDisposition = .needsFixer
                agents[idx].closeoutReason = warning
                scheduleSave()
                schedulePostMergeVerify(agent: agents[idx], mainProjectURL: main)
            }
            result = setWorktreeError("已合并，但删除 worktree 失败: \(msg)")
        case .cleanupFailed(let msg):
            // Merge + worktree removal succeeded. The ref remains because safe cleanup
            // could not prove deletion eligibility or `git branch -d` failed.
            if let idx = index(forAgentID: agentId) {
                let warning = "已合并并删除 worktree，但 \(msg)"
                agents[idx].worktreeLifecycle = .mergedCleanupPending
                agents[idx].worktreeError = warning
                agents[idx].closeoutDisposition = .needsFixer
                agents[idx].closeoutReason = warning
                scheduleSave()
                schedulePostMergeVerify(agent: agents[idx], mainProjectURL: main)
            }
            result = setWorktreeError("已合并并删除 worktree，但 \(msg)")
        }
        onAgentCloseoutMayHaveChanged?()
        return result
    }

    /// 本轮通知的 closeout 判定：合并链未真正终结（如 agent 已被清空）时也要解除 pending，
    /// 否则 flush 会被一个不再存在的 agent 永久卡住。
    private func cancelPendingCloseout(_ agentId: String) {
        closeoutPendingAgentIDs.remove(agentId)
        onAgentCloseoutMayHaveChanged?()
    }

    private func markIntegratedAwaitingVerifyOrCleaned(index: Int) {
        let verify = agents[index].verifyCommand?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if verify?.isEmpty == false {
            agents[index].closeoutDisposition = .unclassified
            agents[index].closeoutReason = "已集成并完成机械清理；等待主仓验证"
        } else {
            agents[index].closeoutDisposition = .cleaned
            agents[index].closeoutReason = "已集成，worktree 与内部分支已安全清理"
        }
    }

    /// Force-remove an explicitly discarded worktree. The separately confirmed UI action
    /// may also force-delete its now-unregistered runtime-owned branch, including unique commits.
    /// Non-internal branches and any branch still registered to a worktree remain retained.
    /// Threading: 同 `mergeWorktree` —— git 后台跑，状态主线程收尾并 re-check。
    @MainActor
    @discardableResult
    func discardWorktree(agentId: String, mainProjectURL: URL) async -> String? {
        worktreeActionError = nil
        guard let i = index(forAgentID: agentId) else {
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

        let discardOutcome: (error: String?, warning: String?) = await Task.detached(
            priority: .userInitiated
        ) {
            do {
                try GitRepo.worktreeRemove(at: wtURL, in: main, force: true)
            } catch {
                // Path may already be gone — continue to branch cleanup if possible.
                if FileManager.default.fileExists(atPath: pathStr) {
                    let msg = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    return ("删除 worktree 失败: \(msg)", nil)
                }
            }
            if let branch, !branch.isEmpty, !branch.hasPrefix("-") {
                let warning = GitRepo.forceDeleteInternalAgentBranchAfterConfirmedDiscard(
                    branch,
                    persistedWorktreePath: pathStr,
                    in: main
                )
                return (nil, warning)
            }
            return (nil, nil)
        }.value

        if let errorMsg = discardOutcome.error {
            return setWorktreeError(errorMsg)
        }
        if let idx = index(forAgentID: agentId) {
            agents[idx].worktreeLifecycle = .discarded
            if let warning = discardOutcome.warning, !warning.isEmpty {
                agents[idx].worktreeError = "worktree 已按确认丢弃；\(warning)"
                agents[idx].closeoutDisposition = .retained
                agents[idx].closeoutReason = agents[idx].worktreeError
            } else {
                agents[idx].worktreeError = nil
                agents[idx].closeoutDisposition = .cleaned
                agents[idx].closeoutReason = "已按用户确认丢弃 worktree，并删除对应内部分支"
            }
            scheduleSave()
            onAgentCloseoutMayHaveChanged?()
        }
        return nil
    }

    /// Diff stat for review UI: main HEAD...agent branch (best-effort string).
    /// Threading: 主线程取 branch 后，`probe` + `diff --stat` 后台执行。
    @MainActor
    func worktreeDiffStat(agentId: String, mainProjectURL: URL) async -> String? {
        guard let agent = agent(forID: agentId),
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
    ///
    /// Coalesced by command: a wave of agents sharing one verify command (the common
    /// case — everyone passes `swift build`) runs it ONCE, after the last merge in the
    /// wave settles. Without this, N agents meant N cold builds of the same tree, and
    /// each one raced the others' merges.
    ///
    /// The surviving run tests the tree AFTER every merge in the window, which is the
    /// state that actually matters; the batch keeps EVERY agent in the wave so the
    /// single outcome finalizes them all (closeout pending 全部解除，通知只发一次)。
    @MainActor
    private func schedulePostMergeVerify(agent: SubagentInfo, mainProjectURL: URL) {
        guard let command = agent.verifyCommand?.trimmingCharacters(in: .whitespacesAndNewlines),
              !command.isEmpty else { return }
        closeoutPendingAgentIDs.insert(agent.id)
        var batch = pendingVerifyByCommand[command] ?? []
        if !batch.contains(where: { $0.id == agent.id }) {
            batch.append(agent)
        }
        pendingVerifyByCommand[command] = batch
        pendingVerifyFlush?.cancel()
        let item = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated { self?.flushPendingVerifies(mainProjectURL: mainProjectURL) }
        }
        pendingVerifyFlush = item
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.verifyCoalesceWindow, execute: item)
    }

    /// Run one verify per distinct command, serialized behind any in-flight merge.
    @MainActor
    private func flushPendingVerifies(mainProjectURL: URL) {
        let batch = pendingVerifyByCommand
        pendingVerifyByCommand.removeAll()
        pendingVerifyFlush = nil
        for (command, batchAgents) in batch {
            Task { [weak self] in
                // MainRepoSerialQueue: never let a build read a tree another merge is rewriting.
                let outcome: PostMergeVerifyOutcome
                if let override = self?.postMergeVerifyOutcomeOverride {
                    outcome = await override(command, mainProjectURL)
                } else {
                    let result = await MainRepoSerialQueue.run {
                        PostMergeVerifyRunner.run(command: command, in: mainProjectURL, timeout: 120)
                    }
                    if result.exitCode != 0 || result.timedOut {
                        // A dirty main tree is the user's own WIP — a failure there may not be
                        // the agent's fault, so say so instead of sending the boss after it.
                        let mainDirty = await MainRepoSerialQueue.run {
                            GitRepo.probe(workTree: mainProjectURL).isDirty
                        }
                        outcome = PostMergeVerifyOutcome(failure: result, mainDirty: mainDirty)
                    } else {
                        outcome = PostMergeVerifyOutcome(failure: nil, mainDirty: false)
                    }
                }
                guard let failure = outcome.failure else {
                    // 成功：本次批次内全部 agent 解除 closeout pending 并最终化。
                    Log.info("post-merge verify passed: \(command)", category: .session)
                    await MainActor.run {
                        guard let self else { return }
                        for agent in batchAgents {
                            self.closeoutPendingAgentIDs.remove(agent.id)
                            if let index = self.index(forAgentID: agent.id),
                               self.agents[index].worktreeLifecycle == .merged,
                               self.agents[index].closeoutDisposition == .unclassified {
                                self.agents[index].closeoutDisposition = .cleaned
                                self.agents[index].closeoutReason =
                                    "已集成、主仓验证通过，worktree 与内部分支已清理"
                                self.scheduleSave()
                            }
                        }
                        self.onAgentCloseoutMayHaveChanged?()
                    }
                    return
                }
                // 失败：本次批次内全部 agent 标记为需人工介入（各自解除 pending）。
                await MainActor.run {
                    guard let self else { return }
                    for agent in batchAgents {
                        self.notifyPostMergeVerifyFailed(
                            agent: agent, failure: failure, mainDirty: outcome.mainDirty)
                    }
                }
            }
        }
    }

    /// Dedup post-merge verify-fail injections the same way as merge failures.
    func notifyPostMergeVerifyFailed(
        agent: SubagentInfo, failure: PostMergeVerifyFailure, mainDirty: Bool = false
    ) {
        if let index = index(forAgentID: agent.id) {
            agents[index].closeoutDisposition = mainDirty ? .needsUser : .needsFixer
            agents[index].closeoutReason = mainDirty
                ? "主仓验证失败且含未提交改动；需确认失败归属"
                : "主仓验证失败；需 fixer 修复后重新验证"
            scheduleSave()
        }
        closeoutPendingAgentIDs.remove(agent.id)
        onAgentCloseoutMayHaveChanged?()
        guard shouldNotify(kind: "verify", agentId: agent.id,
                           detail: "\(failure.command)|\(failure.exitCode)|\(failure.timedOut)") else { return }
        onPostMergeVerifyFailed?(agent, failure, mainDirty)
    }

    /// 60s dedup for merge/verify failure injections, keyed per (kind, agentId, detail).
    /// A dictionary, not a single slot: in a parallel wave, agent B's failure must not
    /// evict agent A's key and let A's identical failure re-inject.
    private func shouldNotify(kind: String, agentId: String, detail: String) -> Bool {
        let key = "\(kind)|\(agentId)|\(detail)"
        let now = Date()
        if let at = recentNotifications[key], now.timeIntervalSince(at) < 60 {
            return false
        }
        recentNotifications = recentNotifications.filter { now.timeIntervalSince($0.value) < 60 }
        recentNotifications[key] = now
        return true
    }
}
