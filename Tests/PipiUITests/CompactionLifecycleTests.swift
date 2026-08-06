import XCTest
import Darwin
@testable import PipiUI

/// 主会话上下文压缩生命周期：start/end 状态、aborted/error 不误报成功、
/// get_state.isCompacting 接入、压缩态占位选择、压缩中 Stop 的短升级时间线。
/// 不 spawn 真实 pi（blockedReason），直接驱动 handleEvent / applyState。
final class CompactionLifecycleTests: XCTestCase {
    private var originalDelays: (
        TimeInterval, TimeInterval, TimeInterval,
        TimeInterval, TimeInterval, TimeInterval
    )?

    override func setUp() {
        super.setUp()
        originalDelays = (
            ChatSession.stopEscalationSigtermDelay,
            ChatSession.stopEscalationSigkillDelay,
            ChatSession.stopEscalationShutdownDelay,
            ChatSession.compactionStopSigtermDelay,
            ChatSession.compactionStopSigkillDelay,
            ChatSession.compactionStopShutdownDelay
        )
        // 压缩专用升级：Tier-1 @50ms，Tier-2 @150ms，Tier-3 @300ms（快速、确定）。
        ChatSession.compactionStopSigtermDelay = 0.05
        ChatSession.compactionStopSigkillDelay = 0.15
        ChatSession.compactionStopShutdownDelay = 0.3
        // get_state 过期窗口：默认关（stale 采纳测试自行设置）。
        ChatSession.compactionStateStaleWindow = -1
    }

    override func tearDown() {
        if let originalDelays {
            ChatSession.stopEscalationSigtermDelay = originalDelays.0
            ChatSession.stopEscalationSigkillDelay = originalDelays.1
            ChatSession.stopEscalationShutdownDelay = originalDelays.2
            ChatSession.compactionStopSigtermDelay = originalDelays.3
            ChatSession.compactionStopSigkillDelay = originalDelays.4
            ChatSession.compactionStopShutdownDelay = originalDelays.5
        }
        super.tearDown()
    }

    private func makeSession() -> ChatSession {
        ChatSession(
            id: UUID().uuidString,
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "compaction-lifecycle-test"
        )
    }

    private func systemTexts(_ session: ChatSession) -> [String] {
        session.transcript.compactMap { item in
            guard item.role == "system" else { return nil }
            if case .text(let t) = item.blocks.first { return t }
            return nil
        }
    }

    // MARK: - start / end 状态

    func testCompactionStartSetsStateAndSuccessEndClears() {
        let session = makeSession()

        session.handleEvent(J(["type": "compaction_start", "reason": "threshold"]))
        XCTAssertTrue(session.isCompacting)
        XCTAssertNotNil(session.compactionStartedAt)
        XCTAssertEqual(session.compactionReason, "threshold")
        XCTAssertTrue(
            systemTexts(session).contains { $0.contains("正在压缩上下文…") },
            "compaction_start must append a system line"
        )

        session.handleEvent(J([
            "type": "compaction_end",
            "reason": "threshold",
            "aborted": false,
            "willRetry": false,
        ]))
        XCTAssertFalse(session.isCompacting, "successful end must clear the compacting state")
        XCTAssertNil(session.compactionStartedAt)
        XCTAssertNil(session.compactionReason)
        XCTAssertTrue(systemTexts(session).contains("上下文压缩完成"))
    }

    func testManualReasonShownInSystemLine() {
        let session = makeSession()
        session.handleEvent(J(["type": "compaction_start", "reason": "manual"]))
        XCTAssertTrue(
            systemTexts(session).contains { $0.contains("（手动触发）") },
            "manual trigger reason must be visible"
        )
    }

    // MARK: - aborted / error 不误报成功

    func testAbortedCompactionShowsCancelNotSuccess() {
        let session = makeSession()
        session.handleEvent(J(["type": "compaction_start", "reason": "overflow"]))
        session.handleEvent(J([
            "type": "compaction_end",
            "reason": "overflow",
            "aborted": true,
            "result": NSNull(),
            "willRetry": false,
        ]))

        let texts = systemTexts(session)
        XCTAssertTrue(texts.contains("上下文压缩已取消"), "aborted compaction must say 已取消, got \(texts)")
        XCTAssertFalse(texts.contains("上下文压缩完成"), "aborted compaction must NOT be reported as success")
        XCTAssertFalse(session.isCompacting)
    }

    func testFailedCompactionShowsErrorNotSuccess() {
        let session = makeSession()
        session.handleEvent(J(["type": "compaction_start", "reason": "threshold"]))
        session.handleEvent(J([
            "type": "compaction_end",
            "reason": "threshold",
            "aborted": false,
            "result": NSNull(),
            "willRetry": false,
            "errorMessage": "Auto-compaction failed: fetch failed",
        ]))

        let texts = systemTexts(session)
        XCTAssertTrue(
            texts.contains { $0.contains("上下文压缩失败") && $0.contains("fetch failed") },
            "failed compaction must surface the error, got \(texts)"
        )
        XCTAssertFalse(texts.contains("上下文压缩完成"), "failed compaction must NOT be reported as success")
        XCTAssertFalse(session.isCompacting)
    }

    func testSuccessWithWillRetryStillShowsSuccess() {
        let session = makeSession()
        session.handleEvent(J(["type": "compaction_start", "reason": "overflow"]))
        session.handleEvent(J([
            "type": "compaction_end",
            "reason": "overflow",
            "aborted": false,
            "result": ["summary": "s", "firstKeptEntryId": "x"],
            "willRetry": true,
        ]))
        XCTAssertTrue(systemTexts(session).contains("上下文压缩完成"))
        XCTAssertFalse(session.isCompacting)
    }

    // MARK: - get_state.isCompacting 接入

    func testApplyStateAdoptsRemoteIsCompacting() {
        let session = makeSession()
        session.applyState(J(["isCompacting": true]))
        XCTAssertTrue(session.isCompacting)
        XCTAssertNotNil(session.compactionStartedAt, "adopting remote compacting must arm the timer")

        // 本地压缩中：远端 false 快照（可能先于本地事件）不得盖回 false ——
        // 与 isStreaming 的既有规则一致，compaction_end 才是权威清理。
        session.applyState(J(["isCompacting": false]))
        XCTAssertTrue(session.isCompacting, "remote false must not clobber an in-progress compaction")

        // 权威清理路径：compaction_end。
        session.handleEvent(J(["type": "compaction_end", "reason": "threshold", "aborted": false]))
        XCTAssertFalse(session.isCompacting)
        XCTAssertNil(session.compactionStartedAt)

        // 已结束且本地无压缩：远端 false 保持 false。
        session.applyState(J(["isCompacting": false]))
        XCTAssertFalse(session.isCompacting)
    }

    func testApplyStateStaleCompactingSnapshotAfterEndIsIgnored() {
        let session = makeSession()
        // 过期窗口大开：compaction_end 后不久到达的远端 true 视为 stale。
        ChatSession.compactionStateStaleWindow = 100
        session.handleEvent(J(["type": "compaction_start", "reason": "threshold"]))
        session.handleEvent(J(["type": "compaction_end", "reason": "threshold", "aborted": false]))
        XCTAssertFalse(session.isCompacting)

        session.applyState(J(["isCompacting": true]))
        XCTAssertFalse(
            session.isCompacting,
            "a get_state snapshot predating compaction_end must not resurrect compacting state"
        )

        // 窗口关闭后，远端 true（真实的新压缩）正常采纳。
        ChatSession.compactionStateStaleWindow = -1
        session.applyState(J(["isCompacting": true]))
        XCTAssertTrue(session.isCompacting)
    }

    // MARK: - 防御性清理

    func testAgentStartClearsLeftoverCompactionState() {
        let session = makeSession()
        session.handleEvent(J(["type": "compaction_start", "reason": "threshold"]))
        // 模拟漏发 compaction_end 的残流：新 turn 必须收掉压缩态。
        session.handleEvent(J(["type": "agent_start"]))
        XCTAssertFalse(session.isCompacting)
        XCTAssertNil(session.compactionStartedAt)
    }

    func testAgentSettledClearsLeftoverCompactionState() {
        let session = makeSession()
        session.handleEvent(J(["type": "compaction_start", "reason": "threshold"]))
        session.handleEvent(J(["type": "agent_settled"]))
        XCTAssertFalse(session.isCompacting)
    }

    // MARK: - 压缩态占位选择

    func testWaitingPlaceholderChoiceShowsCompactingDuringCompaction() {
        let choice = WaitingPlaceholderChoice(
            mediaBusy: false,
            mediaStatus: nil,
            isStopping: false,
            isCompacting: true
        )
        XCTAssertEqual(choice, .compacting)
        XCTAssertEqual(choice.message, "正在压缩上下文…")
        XCTAssertTrue(choice.usesCompactionTimer, "compacting placeholder must use the compaction timer")
    }

    func testWaitingPlaceholderChoicePrefersStoppingOverCompacting() {
        let choice = WaitingPlaceholderChoice(
            mediaBusy: false,
            mediaStatus: nil,
            isStopping: true,
            isCompacting: true
        )
        XCTAssertEqual(choice.message, "正在停止…")
        XCTAssertFalse(choice.usesCompactionTimer)
    }

    func testWaitingPlaceholderChoiceFallsBackToThinking() {
        let choice = WaitingPlaceholderChoice(
            mediaBusy: false,
            mediaStatus: nil,
            isStopping: false,
            isCompacting: false
        )
        XCTAssertEqual(choice.message, "AI 正在思考…")
        XCTAssertFalse(choice.usesCompactionTimer)
    }

    func testWaitingPlaceholderChoiceKeepsMediaPriority() {
        let choice = WaitingPlaceholderChoice(
            mediaBusy: true,
            mediaStatus: "正在生成图片",
            isStopping: true,
            isCompacting: true
        )
        XCTAssertEqual(choice.message, "正在生成图片")
    }

    func testWaitingPlaceholderChoiceShowsCaptioningDuringVisionFallback() {
        let choice = WaitingPlaceholderChoice(
            mediaBusy: false,
            mediaStatus: nil,
            isStopping: false,
            isCompacting: false,
            isCaptioning: true
        )
        XCTAssertEqual(choice, .captioning)
        XCTAssertEqual(choice.message, "正在识别图片…")
        XCTAssertFalse(choice.usesCompactionTimer, "caption placeholder must use the turn timer")
    }

    func testWaitingPlaceholderChoiceKeepsStoppingOverCaptioning() {
        let choice = WaitingPlaceholderChoice(
            mediaBusy: false,
            mediaStatus: nil,
            isStopping: true,
            isCompacting: false,
            isCaptioning: true
        )
        XCTAssertEqual(choice.message, "正在停止…")
    }

    func testWaitingPlaceholderChoiceKeepsCompactingOverCaptioning() {
        let choice = WaitingPlaceholderChoice(
            mediaBusy: false,
            mediaStatus: nil,
            isStopping: false,
            isCompacting: true,
            isCaptioning: true
        )
        XCTAssertEqual(choice.message, "正在压缩上下文…")
    }

    func testWaitingPlaceholderChoiceFallsBackToThinkingWithoutCaptioning() {
        let choice = WaitingPlaceholderChoice(
            mediaBusy: false,
            mediaStatus: nil,
            isStopping: false,
            isCompacting: false
        )
        XCTAssertEqual(choice.message, "AI 正在思考…")
    }

    // MARK: - 压缩中 Stop 的短升级时间线

    func testStopEscalationDuringCompactionUsesShortTimeline() async throws {
        let session = makeSession()
        session.handleEvent(J(["type": "compaction_start", "reason": "threshold"]))
        XCTAssertTrue(session.isCompacting)
        session.isStopping = true

        var signals: [Int32] = []
        let sigterm = expectation(description: "compaction tier-1 SIGTERM")
        let sigkill = expectation(description: "compaction tier-2 SIGKILL")
        let restarted = expectation(description: "compaction tier-3 restart")
        session.stopEscalationSignalSink = { sig in
            signals.append(sig)
            if sig == SIGTERM { sigterm.fulfill() }
            if sig == SIGKILL { sigkill.fulfill() }
        }
        session.stopEscalationRestartSink = { restarted.fulfill() }

        session.scheduleStopEscalation()

        await fulfillment(of: [sigterm, sigkill, restarted], timeout: 3)
        XCTAssertEqual(signals, [SIGTERM, SIGKILL])
    }

    func testStopEscalationTimelineSelection() {
        let normal = makeSession()
        XCTAssertFalse(normal.isCompacting)
        XCTAssertEqual(
            normal.stopEscalationTimeline().shutdown,
            ChatSession.stopEscalationShutdownDelay,
            "idle/normal turn keeps the long timeline"
        )

        let compacting = makeSession()
        compacting.handleEvent(J(["type": "compaction_start", "reason": "overflow"]))
        let timeline = compacting.stopEscalationTimeline()
        XCTAssertEqual(timeline.shutdown, ChatSession.compactionStopShutdownDelay)
        XCTAssertLessThan(timeline.shutdown, ChatSession.stopEscalationShutdownDelay)
    }

    func testSettleCancelsCompactionEscalation() async throws {
        let session = makeSession()
        session.handleEvent(J(["type": "compaction_start", "reason": "threshold"]))
        session.isStopping = true
        var signals: [Int32] = []
        var restarts = 0
        session.stopEscalationSignalSink = { signals.append($0) }
        session.stopEscalationRestartSink = { restarts += 1 }

        session.scheduleStopEscalation()
        // 压缩在升级窗口内完成并 settle → 升级必须全部作废。
        session.handleEvent(J(["type": "compaction_end", "reason": "threshold", "aborted": false]))
        session.handleEvent(J(["type": "agent_settled"]))
        XCTAssertFalse(session.isStopping)

        let quiet = expectation(description: "quiet window past compaction tier-3")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { quiet.fulfill() }
        await fulfillment(of: [quiet], timeout: 2)

        XCTAssertTrue(signals.isEmpty, "settled compaction must never be escalated: \(signals)")
        XCTAssertEqual(restarts, 0, "settled compaction must never reach tier-3 restart")
    }

    /// 竞态回归：压缩中 Stop 武装短时间线后，compaction_end 先于 agent_settled 到达
    /// （isStopping 仍为 true）。旧短时间线必须被取消并按非压缩状态重排长时间线——
    /// 否则压缩 4s 级 restart 会把已离开压缩阶段的正常 post-compaction 工作过早杀重启。
    func testCompactionEndBeforeSettleRearmsNormalTimeline() async throws {
        // 长时间线整体调小但仍晚于压缩短时间线（setUp：0.05/0.15/0.3s），
        // 同一测试里即可同时证明「短时间线未触发」和「长时间线已接管」。
        ChatSession.stopEscalationSigtermDelay = 0.5
        ChatSession.stopEscalationSigkillDelay = 0.65
        ChatSession.stopEscalationShutdownDelay = 0.8

        let session = makeSession()
        session.handleEvent(J(["type": "compaction_start", "reason": "threshold"]))
        XCTAssertTrue(session.isCompacting)
        session.isStopping = true

        var events: [(kind: String, elapsed: TimeInterval)] = []
        let t0 = Date()
        let longSigterm = expectation(description: "long timeline SIGTERM")
        let longSigkill = expectation(description: "long timeline SIGKILL")
        let longRestart = expectation(description: "long timeline restart")
        session.stopEscalationSignalSink = { sig in
            events.append((sig == SIGTERM ? "SIGTERM" : "SIGKILL", Date().timeIntervalSince(t0)))
            if sig == SIGTERM { longSigterm.fulfill() }
            if sig == SIGKILL { longSigkill.fulfill() }
        }
        session.stopEscalationRestartSink = {
            events.append(("restart", Date().timeIntervalSince(t0)))
            longRestart.fulfill()
        }

        // 压缩中 Stop：武装压缩专用短时间线。
        session.scheduleStopEscalation()

        // compaction_end 先到；turn 尚未 settle（isStopping 仍为 true）。
        session.handleEvent(J(["type": "compaction_end", "reason": "threshold", "aborted": false]))
        XCTAssertFalse(session.isCompacting)
        XCTAssertTrue(session.isStopping, "precondition: turn not settled yet")

        // 长时间线接管 → 完整 SIGTERM → SIGKILL → restart 序列按新时间线走完。
        await fulfillment(of: [longSigterm, longSigkill, longRestart], timeout: 3)

        XCTAssertEqual(events.map(\.kind), ["SIGTERM", "SIGKILL", "restart"])
        guard let first = events.first else {
            return XCTFail("expected at least one escalation action")
        }
        // 旧短时间线（0.3s 即 restart）不得触发：首动作必须落在长时间线 sigterm
        // 偏移（0.5s）附近，远晚于压缩 tier-3（0.3s）。
        XCTAssertGreaterThanOrEqual(first.elapsed, 0.4, "short compaction timeline must be cancelled after compaction_end")
        // restart 必须按长时间线 shutdown 偏移（0.65s 之后）触发，而非压缩 0.3s。
        if let restart = events.first(where: { $0.kind == "restart" }) {
            XCTAssertGreaterThanOrEqual(restart.elapsed, 0.65, "restart must follow the long timeline offset")
        }
    }
}
