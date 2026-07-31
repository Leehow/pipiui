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
private enum MergeGitOutcome: Sendable {
    case ok
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
    /// Dedup identical merge/verify-fail injections within 60s, keyed per event.
    private var recentNotifications: [String: Date] = [:]
    /// Post-merge verify coalescing: distinct command → latest merged agent to report it.
    private var pendingVerifyByCommand: [String: SubagentInfo] = [:]
    private var pendingVerifyFlush: DispatchWorkItem?
    /// Debounce window: merges of one wave land within a second or two of each other.
    private static let verifyCoalesceWindow: TimeInterval = 2.0
    private var logCounter = 0
    private var persistURL: URL?
    private var saveScheduled = false
    /// Serial queue for JSON encode + atomic write (TokenLedger.append 模式：主线程只拷快照)。
    private let persistQueue = DispatchQueue(label: "pipiui.subagentstore.persist")
    /// Panel appearance and main-turn settle can fire close together; Git reconciliation is capped per store.
    private static let worktreeReconcileThrottle: TimeInterval = 10
    private var lastWorktreeReconcileAt: Date?

    /// Bind the session's main project URL so successful agents can auto-merge.
    func bindMainProject(_ url: URL) {
        mainProjectURL = url
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
        let loadTask = Task.detached(priority: .utility) {
            guard let data = try? Data(contentsOf: url),
                  let persisted = try? JSONDecoder().decode([SubagentInfo].self, from: data) else {
                return Optional<([SubagentInfo], Int)>.none
            }
            let loaded = Self.reconcileInterruptedAfterRestart(persisted)
            let maxLogId = loaded.flatMap(\.log).map(\.id).max() ?? 0
            return (loaded, maxLogId)
        }
        Task { @MainActor [weak self] in
            guard let (loaded, maxLogId) = await loadTask.value,
                  let self,
                  self.persistURL == url,
                  self.agents.isEmpty else { return }
            self.agents = loaded
            self.logCounter = maxLogId
            if self.selectedId == nil { self.selectedId = self.agents.last?.id }
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
        agents[index].lastObservedAt = date
    }

    func handle(_ e: J, observedAt: Date = Date()) {
        guard let id = e["agentId"].string, !id.isEmpty else { return }
        let kind = e["kind"].string ?? ""
        // For every event tied to an existing agent, record that the UI-side
        // status channel itself is still delivering. `start` also covers a new row.
        if kind != "start", let i = agents.firstIndex(where: { $0.id == id }) {
            markObserved(i, at: observedAt)
        }
        var runningCountMayHaveChanged = false
        switch kind {
        case "start":
            runningCountMayHaveChanged = true
            // Same agentId may resume (续作) after end — refresh running state + worktree meta.
            if let i = agents.firstIndex(where: { $0.id == id }) {
                markObserved(i, at: observedAt)
                agents[i].state = .running
                agents[i].activity = ""
                clearStalled(i)
                abortPending.remove(id)
                agents[i].ended = nil
                agents[i].closeoutDisposition = .unclassified
                agents[i].closeoutReason = nil
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
            agents.append(info)
            if selectedId == nil { selectedId = id }
        case "update":
            guard let i = agents.firstIndex(where: { $0.id == id }) else { return }
            clearStalled(i)
            if let output = e["output"].string, !output.isEmpty { agents[i].output = output }
            agents[i].activity = e["activity"].string ?? agents[i].activity
            agents[i].cost = e["cost"].double ?? agents[i].cost
            agents[i].turns = e["turns"].int ?? agents[i].turns
        case "log":
            guard let i = agents.firstIndex(where: { $0.id == id }) else { return }
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
            guard let i = agents.firstIndex(where: { $0.id == id }) else { return }
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
            guard let i = agents.firstIndex(where: { $0.id == id }) else { return }
            if agents[i].state == .running {
                agents[i].stalled = true
                agents[i].stalledIdleSec = e["idle"].int ?? agents[i].stalledIdleSec
                if let last = e["activity"].string, !last.isEmpty {
                    agents[i].activity = last
                }
            }
        case "end":
            guard let i = agents.firstIndex(where: { $0.id == id }) else { return }
            runningCountMayHaveChanged = true
            clearStalled(i)
            abortPending.remove(id)
            if e["aborted"].bool == true {
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
            // failed/aborted/interrupted keep pendingReview for续作; UI buttons remain as fallback.
            // Attested verify FAILED in the worktree (verifyExit present and ≠ 0): keep
            // pendingReview and skip auto-merge — merging would knowingly break main and
            // delete the worktree the failure-recovery loop needs.
            if agents[i].state == .ok,
               agents[i].worktreeLifecycle == .pendingReview,
               (agents[i].verifyExit ?? 0) == 0,
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
        if runningCountMayHaveChanged {
            onRunningCountMayHaveChanged?()
        }
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
        abortPending.formIntersection(agents.map(\.id))
        if let selected = selectedId, !agents.contains(where: { $0.id == selected }) {
            selectedId = agents.first?.id
        }
        scheduleSave()
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
            guard let index = agents.firstIndex(where: {
                $0.id == result.candidate.agentId
            }) else { continue }
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

        // Serialized against every other main-repo operation (other merges, verify runs).
        let outcome: MergeGitOutcome = await MainRepoSerialQueue.run {
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

        // 回到主线程：git 期间 agent 可能已被清空/移除，写状态前 re-check。
        switch outcome {
        case .ok:
            guard let idx = agents.firstIndex(where: { $0.id == agentId }) else { return nil }
            agents[idx].worktreeLifecycle = .merged
            agents[idx].worktreeError = nil
            markIntegratedAwaitingVerifyOrCleaned(index: idx)
            // Keep path/branch strings for history display; buttons hide via lifecycle.
            scheduleSave()
            schedulePostMergeVerify(agent: agents[idx], mainProjectURL: main)
            return nil
        case .mergeFailed(let msg):
            let full = "合并失败（worktree 未删除）: \(msg)"
            if let idx = agents.firstIndex(where: { $0.id == agentId }) {
                agents[idx].closeoutDisposition = .needsFixer
                agents[idx].closeoutReason = full
                notifyMergeFailed(agent: agents[idx], error: full)
            }
            return setWorktreeError(full)
        case .removeFailed(let msg):
            // Merge already succeeded — preserve integration, retain actionable cleanup state,
            // and still run post-merge verify.
            if let idx = agents.firstIndex(where: { $0.id == agentId }) {
                let warning = "已合并，但删除 worktree 失败: \(msg)"
                agents[idx].worktreeLifecycle = .mergedCleanupPending
                agents[idx].worktreeError = warning
                agents[idx].closeoutDisposition = .needsFixer
                agents[idx].closeoutReason = warning
                scheduleSave()
                schedulePostMergeVerify(agent: agents[idx], mainProjectURL: main)
            }
            return setWorktreeError("已合并，但删除 worktree 失败: \(msg)")
        case .cleanupFailed(let msg):
            // Merge + worktree removal succeeded. The ref remains because safe cleanup
            // could not prove deletion eligibility or `git branch -d` failed.
            if let idx = agents.firstIndex(where: { $0.id == agentId }) {
                let warning = "已合并并删除 worktree，但 \(msg)"
                agents[idx].worktreeLifecycle = .mergedCleanupPending
                agents[idx].worktreeError = warning
                agents[idx].closeoutDisposition = .needsFixer
                agents[idx].closeoutReason = warning
                scheduleSave()
                schedulePostMergeVerify(agent: agents[idx], mainProjectURL: main)
            }
            return setWorktreeError("已合并并删除 worktree，但 \(msg)")
        }
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
        if let idx = agents.firstIndex(where: { $0.id == agentId }) {
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
    ///
    /// Coalesced by command: a wave of agents sharing one verify command (the common
    /// case — everyone passes `swift build`) runs it ONCE, after the last merge in the
    /// wave settles. Without this, N agents meant N cold builds of the same tree, and
    /// each one raced the others' merges.
    ///
    /// The surviving run tests the tree AFTER every merge in the window, which is the
    /// state that actually matters; the latest merged agent is recorded as the reporter.
    @MainActor
    private func schedulePostMergeVerify(agent: SubagentInfo, mainProjectURL: URL) {
        guard let command = agent.verifyCommand?.trimmingCharacters(in: .whitespacesAndNewlines),
              !command.isEmpty else { return }
        pendingVerifyByCommand[command] = agent
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
        for (command, agent) in batch {
            Task { [weak self] in
                // MainRepoSerialQueue: never let a build read a tree another merge is rewriting.
                let result = await MainRepoSerialQueue.run {
                    PostMergeVerifyRunner.run(command: command, in: mainProjectURL, timeout: 120)
                }
                guard result.exitCode != 0 || result.timedOut else {
                    Log.info("post-merge verify passed: \(command)", category: .session)
                    await MainActor.run {
                        guard let self,
                              let index = self.agents.firstIndex(where: { $0.id == agent.id }),
                              self.agents[index].worktreeLifecycle == .merged,
                              self.agents[index].closeoutDisposition == .unclassified else {
                            return
                        }
                        self.agents[index].closeoutDisposition = .cleaned
                        self.agents[index].closeoutReason =
                            "已集成、主仓验证通过，worktree 与内部分支已清理"
                        self.scheduleSave()
                    }
                    return
                }
                // A dirty main tree is the user's own WIP — a failure there may not be
                // the agent's fault, so say so instead of sending the boss after it.
                let mainDirty = await MainRepoSerialQueue.run {
                    GitRepo.probe(workTree: mainProjectURL).isDirty
                }
                await MainActor.run {
                    self?.notifyPostMergeVerifyFailed(
                        agent: agent, failure: result, mainDirty: mainDirty)
                }
            }
        }
    }

    /// Dedup post-merge verify-fail injections the same way as merge failures.
    func notifyPostMergeVerifyFailed(
        agent: SubagentInfo, failure: PostMergeVerifyFailure, mainDirty: Bool = false
    ) {
        if let index = agents.firstIndex(where: { $0.id == agent.id }) {
            agents[index].closeoutDisposition = mainDirty ? .needsUser : .needsFixer
            agents[index].closeoutReason = mainDirty
                ? "主仓验证失败且含未提交改动；需确认失败归属"
                : "主仓验证失败；需 fixer 修复后重新验证"
            scheduleSave()
        }
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
