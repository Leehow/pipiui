import XCTest
@testable import PipiUI

/// 任务完成系统通知的时序与文案：
/// - 主 agent settle 时若子 agent 仍在运行，不得立即发通知；等主会话空闲、队列为空、
///   且本轮所有关联子 agent 的 closeout/auto-merge/post-merge verify 都可判定后补发一次。
/// - 本轮关联集合按「主 turn 活动期间派出的子 agent」收集，settle 前已失败/结束的子任务
///   也计入；历史旧失败不污染当前轮。
/// - 错误/需人工介入通知必须包含具体子任务名、原因与「需人工介入」表述；多个失败至少
///   列出前 3 个并显示剩余数量。
/// - 无子 agent 仍立即通知；前台/设置门控与绿标行为不回归。
@MainActor
final class SubagentNotificationTimingTests: XCTestCase {
    private var delivered: [TaskAlert] = []
    private var originalDeliver: ((TaskAlert) -> Void)?
    private var originalCompletionEnabled: Bool?
    private var originalErrorEnabled: Bool?

    override func setUp() {
        super.setUp()
        // XCTest 宿主默认没有 AppKit 主循环：先创建共享 NSApplication，NSApp 才有值
        //（生产路径的任务完成提醒用 NSApp.isActive 做前台可见性门控）。
        _ = NSApplication.shared
        originalDeliver = TaskNotifier.shared.deliver
        originalCompletionEnabled = TaskNotifierSettings.completionEnabled()
        originalErrorEnabled = TaskNotifierSettings.errorEnabled()
        TaskNotifierSettings.setCompletionEnabled(true)
        TaskNotifierSettings.setErrorEnabled(true)
        delivered = []
        TaskNotifier.shared.deliver = { [weak self] alert in
            self?.delivered.append(alert)
        }
        // post-merge verify 合流窗口调小：合流逻辑不变，只是测试不用等 2 秒。
        SubagentStore.verifyCoalesceWindow = 0.02
    }

    override func tearDown() {
        SubagentStore.verifyCoalesceWindow = 2.0
        TaskNotifier.shared.deliver = originalDeliver ?? { _ in }
        if let enabled = originalCompletionEnabled {
            TaskNotifierSettings.setCompletionEnabled(enabled)
        }
        if let enabled = originalErrorEnabled {
            TaskNotifierSettings.setErrorEnabled(enabled)
        }
        delivered = []
        super.tearDown()
    }

    // MARK: - Helpers

    /// blockedReason 阻止 spawn pi 进程；测试再手动恢复「健康」标志位，
    /// 并把前台可见性门控固定为「未选中」→ shouldNotifyCompletion 恒为 true。
    private func makeSession() -> ChatSession {
        let session = ChatSession(
            id: UUID().uuidString,
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "subagent-notification-test"
        )
        session.lastError = nil
        session.processAlive = true
        session.isSelectedCheck = { false }
        return session
    }

    private func startEvent(id: String, title: String) -> J {
        J([
            "agentId": id,
            "kind": "start",
            "name": "worker",
            "task": title,
            "title": title,
            "depth": 1,
        ])
    }

    private func endEvent(
        id: String,
        ok: Bool,
        worktreePath: String? = nil,
        worktreeBranch: String? = nil,
        verifyCommand: String? = nil
    ) -> J {
        var raw: [String: Any] = ["agentId": id, "kind": "end", "ok": ok]
        if let path = worktreePath { raw["worktreePath"] = path }
        if let branch = worktreeBranch { raw["worktreeBranch"] = branch }
        if let command = verifyCommand { raw["verifyCommand"] = command }
        return J(raw)
    }

    private func settled(_ session: ChatSession) {
        session.handleEvent(J(["type": "agent_settled"]))
    }

    /// 让主线程上被 release 唤醒的异步链跑完（continuation 恢复 + MainActor.run 可能有多跳）。
    private func drainMainActor(times: Int = 8) async {
        for _ in 0..<times { await Task.yield() }
    }

    /// 可控 auto-merge 替身：每次被调用即挂起并计入队列，由测试放行（确定性，不跑真实 git）。
    /// 同一轮多个 merge 并发时按 FIFO 放行，互不覆盖。
    private func mergeGate() -> (
        override: @MainActor (String, URL) async -> MergeGitOutcome?,
        waitCalls: (Int) async -> Void,
        release: (MergeGitOutcome) -> Void
    ) {
        var resultContinuations: [CheckedContinuation<MergeGitOutcome?, Never>] = []
        var waiter: CheckedContinuation<Void, Never>?
        var target = 0
        var calledCount = 0
        let override: @MainActor (String, URL) async -> MergeGitOutcome? = { _, _ in
            calledCount += 1
            if calledCount >= target {
                waiter?.resume()
                waiter = nil
            }
            return await withCheckedContinuation { resultContinuations.append($0) }
        }
        let waitCalls: (Int) async -> Void = { count in
            target = count
            if calledCount >= count { return }
            await withCheckedContinuation { waiter = $0 }
        }
        let release: (MergeGitOutcome) -> Void = { outcome in
            if !resultContinuations.isEmpty {
                resultContinuations.removeFirst().resume(returning: outcome)
            }
        }
        return (override, waitCalls, release)
    }

    /// 可控 post-merge verify 替身：被调用即挂起，由测试放行（failure nil = 通过）。
    private func verifyGate() -> (
        override: @MainActor (String, URL) async -> PostMergeVerifyOutcome,
        waitCalled: () async -> Void,
        release: (PostMergeVerifyOutcome) -> Void
    ) {
        var resultContinuation: CheckedContinuation<PostMergeVerifyOutcome, Never>?
        var calledContinuation: CheckedContinuation<Void, Never>?
        let override: @MainActor (String, URL) async -> PostMergeVerifyOutcome = { _, _ in
            calledContinuation?.resume()
            calledContinuation = nil
            return await withCheckedContinuation { resultContinuation = $0 }
        }
        let waitCalled: () async -> Void = {
            await withCheckedContinuation { calledContinuation = $0 }
        }
        let release: (PostMergeVerifyOutcome) -> Void = { outcome in
            resultContinuation?.resume(returning: outcome)
            resultContinuation = nil
        }
        return (override, waitCalled, release)
    }

    // MARK: - 时序：主 settle + 子仍 running → 不通知；最后子结束后补发一次

    func testSettleWithRunningSubagentDefersNotificationUntilLastSubagentEnds() {
        let session = makeSession()
        session.subagents.handle(startEvent(id: "a1", title: "修复登录"))

        settled(session)

        XCTAssertTrue(delivered.isEmpty, "主 settle 时子 agent 仍在运行 → 不得发通知")

        session.subagents.handle(endEvent(id: "a1", ok: true))

        XCTAssertEqual(delivered.count, 1, "最后一个子 agent 终态后补发一次")
        XCTAssertEqual(delivered[0].kind, .completion)
        XCTAssertTrue(delivered[0].body.contains("修复登录"), "完成通知应列出子任务名")
    }

    func testNotificationFiresOnceAfterAllSubagentsEnd() {
        let session = makeSession()
        session.subagents.handle(startEvent(id: "a1", title: "翻译文档"))
        session.subagents.handle(startEvent(id: "a2", title: "修复登录"))

        settled(session)
        XCTAssertTrue(delivered.isEmpty)

        session.subagents.handle(endEvent(id: "a1", ok: true))
        XCTAssertTrue(delivered.isEmpty, "还有子 agent 在运行，不通知")

        session.subagents.handle(endEvent(id: "a2", ok: true))
        XCTAssertEqual(delivered.count, 1)
        XCTAssertEqual(delivered[0].kind, .completion)
        XCTAssertTrue(delivered[0].body.contains("翻译文档"))
        XCTAssertTrue(delivered[0].body.contains("修复登录"))

        // 已发过一轮：后续生命周期变化不得重复发。
        session.subagents.handle(startEvent(id: "b1", title: "新任务"))
        session.subagents.handle(endEvent(id: "b1", ok: true))
        XCTAssertEqual(delivered.count, 1, "本轮通知只发一次")
    }

    // MARK: - 无子 agent：保持现有立即通知行为

    func testNoSubagentStillNotifiesImmediately() {
        let session = makeSession()

        settled(session)

        XCTAssertEqual(delivered.count, 1)
        XCTAssertEqual(delivered[0].kind, .completion)
        XCTAssertEqual(delivered[0].body, "「\(session.displayTitle)」任务已完成")
    }

    // MARK: - 主 agent 在子 agent 终态前再次恢复工作 → 不早发，settle 后补发

    func testMainResumingWorkDefersUntilNextSettle() {
        let session = makeSession()
        session.subagents.handle(startEvent(id: "a1", title: "修复登录"))
        settled(session)
        XCTAssertTrue(delivered.isEmpty)

        // 子 agent 未终态，主 agent 又开始工作；期间子 agent 结束 → 不得早发。
        session.handleEvent(J(["type": "agent_start"]))
        session.subagents.handle(endEvent(id: "a1", ok: true))
        XCTAssertTrue(delivered.isEmpty, "主 agent 仍在工作时不得早发")

        // 新一轮 settle：条件齐备 → 补发上一轮通知（仍只发一次）。
        settled(session)
        XCTAssertEqual(delivered.count, 1)
        XCTAssertEqual(delivered[0].kind, .completion)
        XCTAssertTrue(delivered[0].body.contains("修复登录"))
    }

    // MARK: - 轮次边界：settle 前已失败/结束的子任务必须计入本轮

    func testSubagentFailedBeforeMainSettleIsNotReportedAsCompletion() {
        let session = makeSession()
        session.handleEvent(J(["type": "agent_start"]))
        session.subagents.handle(startEvent(id: "a1", title: "修复登录"))
        // 子任务在主 settle 前就失败结束。
        session.subagents.handle(endEvent(id: "a1", ok: false))
        XCTAssertTrue(delivered.isEmpty, "主 agent 仍在工作中，不早发")

        settled(session)

        XCTAssertEqual(delivered.count, 1)
        XCTAssertEqual(delivered[0].kind, .error, "本轮有子任务失败，不得报主任务完成")
        XCTAssertTrue(delivered[0].body.contains("修复登录"))
        XCTAssertTrue(delivered[0].body.contains("需人工介入"))
    }

    func testSubagentSucceededBeforeMainSettleIsIncludedInCompletion() {
        let session = makeSession()
        session.handleEvent(J(["type": "agent_start"]))
        session.subagents.handle(startEvent(id: "a1", title: "修复登录"))
        session.subagents.handle(endEvent(id: "a1", ok: true))

        settled(session)

        XCTAssertEqual(delivered.count, 1)
        XCTAssertEqual(delivered[0].kind, .completion)
        XCTAssertTrue(delivered[0].body.contains("修复登录"), "settle 前已完成的子任务也要计入本轮")
    }

    func testHistoricalFailureDoesNotFailCurrentRound() {
        let session = makeSession()
        // 第 1 轮：旧任务失败（settle 前结束）→ 只发第 1 轮自己的错误通知。
        session.handleEvent(J(["type": "agent_start"]))
        session.subagents.handle(startEvent(id: "old", title: "旧任务"))
        session.subagents.handle(endEvent(id: "old", ok: false))
        settled(session)
        XCTAssertEqual(delivered.count, 1)
        XCTAssertEqual(delivered[0].kind, .error)
        XCTAssertTrue(delivered[0].body.contains("旧任务"))

        // 第 2 轮：新子任务成功 → 只发完成通知；历史旧失败不得污染新一轮。
        session.handleEvent(J(["type": "agent_start"]))
        session.subagents.handle(startEvent(id: "a1", title: "修复登录"))
        settled(session)
        XCTAssertEqual(delivered.count, 1, "子 agent 仍在运行，不发通知")
        session.subagents.handle(endEvent(id: "a1", ok: true))
        XCTAssertEqual(delivered.count, 2)
        XCTAssertEqual(delivered[1].kind, .completion)
        XCTAssertTrue(delivered[1].body.contains("修复登录"))
        XCTAssertFalse(delivered[1].body.contains("旧任务"))
    }

    // MARK: - 异步链：end 后 auto-merge / post-merge verify 未定 → 不发成功；失败后只发一次错误

    func testAutoMergeFailureAfterEndSendsSingleInterventionNotification() async {
        let session = makeSession()
        let merge = mergeGate()
        session.subagents.mergeOutcomeOverride = merge.override

        session.subagents.handle(startEvent(id: "a1", title: "修复登录"))
        settled(session)
        session.subagents.handle(endEvent(
            id: "a1", ok: true,
            worktreePath: "/tmp/pipiui-test-wt-a1",
            worktreeBranch: "pipiui/a1",
            verifyCommand: "swift build"
        ))

        // auto-merge 已安排但未完成：closeout 未分类 → 不得先发成功。
        XCTAssertTrue(delivered.isEmpty)

        await merge.waitCalls(1)
        XCTAssertTrue(delivered.isEmpty, "merge 挂起期间不得发通知")

        merge.release(.mergeFailed("模拟合并失败"))
        await drainMainActor()

        XCTAssertEqual(delivered.count, 1, "merge 失败后只发一次错误")
        XCTAssertEqual(delivered[0].kind, .error)
        XCTAssertTrue(delivered[0].body.contains("修复登录"))
        XCTAssertTrue(delivered[0].body.contains("需人工介入"))
        XCTAssertTrue(delivered[0].body.contains("合并失败"))
    }

    func testMergeOkThenVerifyFailureSendsSingleInterventionNotification() async {
        let session = makeSession()
        let merge = mergeGate()
        let verify = verifyGate()
        session.subagents.mergeOutcomeOverride = merge.override
        session.subagents.postMergeVerifyOutcomeOverride = verify.override

        session.subagents.handle(startEvent(id: "a1", title: "修复登录"))
        settled(session)
        session.subagents.handle(endEvent(
            id: "a1", ok: true,
            worktreePath: "/tmp/pipiui-test-wt-a1",
            worktreeBranch: "pipiui/a1",
            verifyCommand: "swift build"
        ))

        await merge.waitCalls(1)
        merge.release(.ok)
        await drainMainActor()

        // merge 成功 → 进入主仓验证阶段：closeout 仍未分类，不得先发成功。
        XCTAssertTrue(delivered.isEmpty, "post-merge verify 未结束时不得发成功")

        await verify.waitCalled()
        XCTAssertTrue(delivered.isEmpty, "verify 挂起期间不得发通知")

        verify.release(PostMergeVerifyOutcome(
            failure: PostMergeVerifyFailure(
                command: "swift build", exitCode: 1, timedOut: false, outputTail: "boom"
            ),
            mainDirty: false
        ))
        await drainMainActor()

        XCTAssertEqual(delivered.count, 1, "verify 失败后只发一次错误")
        XCTAssertEqual(delivered[0].kind, .error)
        XCTAssertTrue(delivered[0].body.contains("修复登录"))
        XCTAssertTrue(delivered[0].body.contains("需人工介入"))
    }

    func testMergeOkThenVerifySuccessSendsCompletionOnce() async {
        let session = makeSession()
        let merge = mergeGate()
        let verify = verifyGate()
        session.subagents.mergeOutcomeOverride = merge.override
        session.subagents.postMergeVerifyOutcomeOverride = verify.override

        session.subagents.handle(startEvent(id: "a1", title: "修复登录"))
        settled(session)
        session.subagents.handle(endEvent(
            id: "a1", ok: true,
            worktreePath: "/tmp/pipiui-test-wt-a1",
            worktreeBranch: "pipiui/a1",
            verifyCommand: "swift build"
        ))

        await merge.waitCalls(1)
        merge.release(.ok)
        await drainMainActor()
        XCTAssertTrue(delivered.isEmpty, "verify 未结束时不得发成功")

        await verify.waitCalled()
        verify.release(PostMergeVerifyOutcome(failure: nil, mainDirty: false)) // verify 通过
        await drainMainActor()

        XCTAssertEqual(delivered.count, 1, "整条 merge+verify 链成功后只发一次完成通知")
        XCTAssertEqual(delivered[0].kind, .completion)
        XCTAssertTrue(delivered[0].body.contains("修复登录"))
    }

    // MARK: - 并行波次：共享 verifyCommand 聚留 → 结果应用到批次内全部 agent

    private func makeSharedCommandWaveSession(
        _ session: ChatSession,
        merge: (override: @MainActor (String, URL) async -> MergeGitOutcome?, waitCalls: (Int) async -> Void, release: (MergeGitOutcome) -> Void),
        verify: (override: @MainActor (String, URL) async -> PostMergeVerifyOutcome, waitCalled: () async -> Void, release: (PostMergeVerifyOutcome) -> Void)
    ) {
        session.subagents.mergeOutcomeOverride = merge.override
        session.subagents.postMergeVerifyOutcomeOverride = verify.override

        session.subagents.handle(startEvent(id: "a1", title: "翻译文档"))
        session.subagents.handle(startEvent(id: "a2", title: "修复登录"))
        settled(session)
        session.subagents.handle(endEvent(
            id: "a1", ok: true,
            worktreePath: "/tmp/pipiui-test-wt-a1",
            worktreeBranch: "pipiui/a1",
            verifyCommand: "swift build"
        ))
        session.subagents.handle(endEvent(
            id: "a2", ok: true,
            worktreePath: "/tmp/pipiui-test-wt-a2",
            worktreeBranch: "pipiui/a2",
            verifyCommand: "swift build"
        ))
    }

    func testSharedVerifyCommandWaveSuccessSendsOneCompletionWithBothTasks() async {
        let session = makeSession()
        let merge = mergeGate()
        let verify = verifyGate()
        makeSharedCommandWaveSession(session, merge: merge, verify: verify)

        // 两个 auto-merge 都挂起；放行后各自 merge 成功，进入同一个共享 verify 批次。
        await merge.waitCalls(2)
        merge.release(.ok)
        merge.release(.ok)
        await drainMainActor()
        XCTAssertTrue(delivered.isEmpty, "共享 verify 未完成，不得发通知")

        await verify.waitCalled()
        XCTAssertTrue(delivered.isEmpty, "verify 挂起期间不得发通知")

        verify.release(PostMergeVerifyOutcome(failure: nil, mainDirty: false))
        await drainMainActor()

        XCTAssertEqual(delivered.count, 1, "共享 verify 成功后整轮只发一次完成通知")
        XCTAssertEqual(delivered[0].kind, .completion)
        XCTAssertTrue(delivered[0].body.contains("翻译文档"), "批次内两个子任务都要计入：\(delivered[0].body)")
        XCTAssertTrue(delivered[0].body.contains("修复登录"), "批次内两个子任务都要计入：\(delivered[0].body)")
    }

    func testSharedVerifyCommandWaveFailureSendsOneInterventionNotificationForBoth() async {
        let session = makeSession()
        let merge = mergeGate()
        let verify = verifyGate()
        makeSharedCommandWaveSession(session, merge: merge, verify: verify)

        await merge.waitCalls(2)
        merge.release(.ok)
        merge.release(.ok)
        await drainMainActor()
        XCTAssertTrue(delivered.isEmpty, "共享 verify 未完成，不得发通知")

        await verify.waitCalled()
        verify.release(PostMergeVerifyOutcome(
            failure: PostMergeVerifyFailure(
                command: "swift build", exitCode: 1, timedOut: false, outputTail: "boom"
            ),
            mainDirty: false
        ))
        await drainMainActor()

        XCTAssertEqual(delivered.count, 1, "共享 verify 失败后整轮只发一次错误通知")
        XCTAssertEqual(delivered[0].kind, .error)
        XCTAssertTrue(delivered[0].body.contains("翻译文档"), "批次内两个子任务都要点名：\(delivered[0].body)")
        XCTAssertTrue(delivered[0].body.contains("修复登录"), "批次内两个子任务都要点名：\(delivered[0].body)")
        XCTAssertTrue(delivered[0].body.contains("需人工介入"))
    }

    // MARK: - clearFinished 清掉全部关联 agent → pending 不永久挂起

    func testClearFinishedAllRoundAgentsClearsPending() async {
        let session = makeSession()

        session.subagents.handle(startEvent(id: "a1", title: "修复登录"))
        settled(session)
        session.subagents.handle(endEvent(
            id: "a1", ok: true,
            worktreePath: "/tmp/pipiui-test-wt-a1",
            worktreeBranch: "pipiui/a1",
            verifyCommand: "swift build"
        ))
        XCTAssertTrue(delivered.isEmpty, "merge 未完成，本轮通知挂起中")

        // 用户清掉全部已结束子 agent → 本轮 pending 应被清除，而不是永久挂起。
        session.subagents.clearFinished()
        XCTAssertTrue(delivered.isEmpty, "清掉后不得凭空发本轮通知")

        // 之后普通 settle（无子 agent）恢复「立即通知」路径，证明 pending 已被清掉。
        settled(session)
        XCTAssertEqual(delivered.count, 1)
        XCTAssertEqual(delivered[0].kind, .completion)

        // 被排队的 auto-merge 在 agent 行已不存在后运行：走「找不到 agent」提前返回
        //（不会到达 merge 替身），不得产生新通知，也不会卡住 closeout 判定。
        await drainMainActor()
        XCTAssertEqual(delivered.count, 1, "已清空的 agent 不得再触发通知")
    }

    // MARK: - 多个失败任务文案

    func testMultipleFailedSubagentsListFirstThreeAndRemainingCount() {
        let session = makeSession()
        session.handleEvent(J(["type": "agent_start"]))
        for i in 1...4 {
            session.subagents.handle(startEvent(id: "f\(i)", title: "失败任务\(i)"))
            session.subagents.handle(endEvent(id: "f\(i)", ok: false))
        }

        settled(session)

        XCTAssertEqual(delivered.count, 1)
        XCTAssertEqual(delivered[0].kind, .error)
        let body = delivered[0].body
        XCTAssertTrue(body.contains("4 项子任务需人工介入"), "总数要明确：\(body)")
        XCTAssertTrue(body.contains("另有 1 项"), "剩余数量不能被截断吞掉：\(body)")
        XCTAssertTrue(body.contains("①「失败任务1」"))
        XCTAssertTrue(body.contains("②「失败任务2」"))
        XCTAssertTrue(body.contains("③「失败任务3」"))
        XCTAssertTrue(body.contains("需人工介入"))
    }

    // MARK: - 终态聚合纯函数（文案）

    private func makeAgent(
        id: String,
        state: SubagentInfo.State = .ok,
        title: String = "子任务",
        verifyExit: Int? = nil,
        worktreeError: String? = nil,
        closeoutDisposition: AgentCloseoutDisposition = .unclassified,
        closeoutReason: String? = nil
    ) -> SubagentInfo {
        SubagentInfo(
            id: id,
            parentId: nil,
            name: "worker",
            task: title,
            title: title,
            depth: 1,
            model: nil,
            state: state,
            worktreeError: worktreeError,
            verifyExit: verifyExit,
            closeoutDisposition: closeoutDisposition,
            closeoutReason: closeoutReason
        )
    }

    func testAggregatorSuccessMeansNoIssue() {
        XCTAssertNil(SubagentRoundAggregator.issueReason(for: makeAgent(id: "a", state: .ok)))
        // retained 不是需人工介入（仅供审核），不算失败。
        XCTAssertNil(SubagentRoundAggregator.issueReason(
            for: makeAgent(id: "a", state: .ok, closeoutDisposition: .retained)
        ))
        XCTAssertNil(SubagentRoundAggregator.issueReason(
            for: makeAgent(id: "a", state: .ok, closeoutDisposition: .cleaned)
        ))
    }

    func testAggregatorTerminalStatesProduceReasons() {
        XCTAssertEqual(
            SubagentRoundAggregator.issueReason(for: makeAgent(id: "a", state: .failed)),
            "执行失败，需人工介入"
        )
        XCTAssertEqual(
            SubagentRoundAggregator.issueReason(for: makeAgent(id: "a", state: .aborted)),
            "已中止，需人工介入"
        )
        XCTAssertEqual(
            SubagentRoundAggregator.issueReason(for: makeAgent(id: "a", state: .interrupted)),
            "中断（进程退出），需人工介入"
        )
    }

    func testAggregatorVerifyWorktreeAndCloseoutReasons() {
        XCTAssertEqual(
            SubagentRoundAggregator.issueReason(
                for: makeAgent(id: "a", state: .ok, verifyExit: 1)
            ),
            "验证失败（exit 1），需人工介入"
        )
        XCTAssertEqual(
            SubagentRoundAggregator.issueReason(
                for: makeAgent(id: "a", state: .ok, worktreeError: "磁盘已满")
            ),
            "worktree 创建失败：磁盘已满，需人工介入"
        )
        XCTAssertEqual(
            SubagentRoundAggregator.issueReason(
                for: makeAgent(
                    id: "a", state: .ok,
                    closeoutDisposition: .needsUser,
                    closeoutReason: "主仓有未提交改动"
                )
            ),
            "需人工介入：主仓有未提交改动"
        )
        XCTAssertEqual(
            SubagentRoundAggregator.issueReason(
                for: makeAgent(
                    id: "a", state: .ok,
                    closeoutDisposition: .needsFixer,
                    closeoutReason: "合并失败"
                )
            ),
            "需人工介入：合并失败"
        )
    }

    // MARK: - TaskNotifier 文案

    func testCompletionBodyListsSubtaskTitlesAndCapsAtThree() {
        let (notifier, _) = makeNotifier()
        var delivered: [TaskAlert] = []
        notifier.deliver = { delivered.append($0) }

        notifier.notifyCompletion(
            sessionTitle: "重构",
            subagentTitles: ["翻译文档", "修复登录", "补测试", "性能分析"]
        )

        XCTAssertEqual(delivered.count, 1)
        XCTAssertEqual(
            delivered[0].body,
            "「重构」任务已完成（子任务：翻译文档、修复登录、补测试 等4项）"
        )
    }

    func testSubagentErrorBodyContainsTaskNameAndIntervention() {
        let (notifier, _) = makeNotifier()
        var delivered: [TaskAlert] = []
        notifier.deliver = { delivered.append($0) }

        notifier.notifySubagentError(
            sessionTitle: "重构",
            issues: [("修复登录", "执行失败，需人工介入")]
        )

        XCTAssertEqual(delivered.count, 1)
        XCTAssertEqual(delivered[0].kind, .error)
        XCTAssertEqual(delivered[0].body, "「重构」子任务「修复登录」执行失败，需人工介入")
    }

    func testSubagentErrorBodyListsFirstThreeIssuesAndRemainingCount() {
        let (notifier, _) = makeNotifier()
        var delivered: [TaskAlert] = []
        notifier.deliver = { delivered.append($0) }

        notifier.notifySubagentError(
            sessionTitle: "重构",
            issues: [
                ("甲", "执行失败，需人工介入"),
                ("乙", "已中止，需人工介入"),
                ("丙", "验证失败（exit 1），需人工介入"),
                ("丁", "中断（进程退出），需人工介入"),
            ]
        )

        XCTAssertEqual(delivered.count, 1)
        XCTAssertEqual(delivered[0].kind, .error)
        XCTAssertEqual(
            delivered[0].body,
            "「重构」4 项子任务需人工介入（另有 1 项）：①「甲」执行失败，需人工介入；"
                + "②「乙」已中止，需人工介入；③「丙」验证失败（exit 1），需人工介入"
        )
    }

    private func makeNotifier() -> (TaskNotifier, UserDefaults) {
        let suite = "pipiui.test.subagentnotification.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return (TaskNotifier(defaults: defaults), defaults)
    }
}
