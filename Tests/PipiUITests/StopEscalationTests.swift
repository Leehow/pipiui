import XCTest
import Darwin
@testable import PipiUI

/// 前台 turn 停止升级（Stop escalation）的确定性测试：不 spawn 真实 pi。
/// 用 blockedReason 阻止 spawn，注入 signal/restart 替身，并把 static 时间线调小。
/// 生产路径不变：Tier-1/2 → proc.signalDescendants（只发后代），Tier-3 → onRequestRestart。
final class StopEscalationTests: XCTestCase {
    private var originalDelays: (TimeInterval, TimeInterval, TimeInterval)?

    override func setUp() {
        super.setUp()
        originalDelays = (
            ChatSession.stopEscalationSigtermDelay,
            ChatSession.stopEscalationSigkillDelay,
            ChatSession.stopEscalationShutdownDelay
        )
        // 快速、确定：Tier-1 @50ms，Tier-2 @150ms，Tier-3 @300ms。
        ChatSession.stopEscalationSigtermDelay = 0.05
        ChatSession.stopEscalationSigkillDelay = 0.15
        ChatSession.stopEscalationShutdownDelay = 0.3
    }

    override func tearDown() {
        if let originalDelays {
            ChatSession.stopEscalationSigtermDelay = originalDelays.0
            ChatSession.stopEscalationSigkillDelay = originalDelays.1
            ChatSession.stopEscalationShutdownDelay = originalDelays.2
        }
        super.tearDown()
    }

    /// blockedReason 阻止 spawn pi 进程；测试直接驱动调度器。
    private func makeSession() -> ChatSession {
        ChatSession(
            id: UUID().uuidString,
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "stop-escalation-test"
        )
    }

    /// (a) Tier-1 到期时 `isStopping` 仍为真 → 必须走 SIGTERM 后代路径，随后 Tier-2 SIGKILL。
    func testStillStoppingAtTier1SignalsDescendants() async throws {
        let session = makeSession()
        session.isStopping = true
        var signals: [Int32] = []
        let sigterm = expectation(description: "tier-1 SIGTERM delivered")
        let sigkill = expectation(description: "tier-2 SIGKILL delivered")
        session.stopEscalationSignalSink = { sig in
            signals.append(sig)
            if sig == SIGTERM { sigterm.fulfill() }
            if sig == SIGKILL { sigkill.fulfill() }
        }

        session.scheduleStopEscalation()

        await fulfillment(of: [sigterm], timeout: 2)
        XCTAssertTrue(session.isStopping, "turn never settled → escalation must keep firing")
        await fulfillment(of: [sigkill], timeout: 2)
        // 严格分层：先 SIGTERM（温和），仍卡死再 SIGKILL。
        XCTAssertEqual(signals, [SIGTERM, SIGKILL])
    }

    /// (b) Tier-1 前 `agent_settled` 清掉 `isStopping` 并取消升级 → 任何一级都不得触发。
    func testSettleBeforeTier1CancelsEscalation() async throws {
        let session = makeSession()
        session.isStopping = true
        var signals: [Int32] = []
        var restarts = 0
        session.stopEscalationSignalSink = { signals.append($0) }
        session.stopEscalationRestartSink = { restarts += 1 }

        session.scheduleStopEscalation()
        // 模拟 pi 在 Tier-1 窗口内正常 settle。
        session.handleEvent(J(["type": "agent_settled"]))
        XCTAssertFalse(session.isStopping)

        // 等过最后一级（shutdown delay）确认安静。
        let quiet = expectation(description: "quiet window past tier-3")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { quiet.fulfill() }
        await fulfillment(of: [quiet], timeout: 2)

        XCTAssertTrue(signals.isEmpty, "settled turn must never be escalated: \(signals)")
        XCTAssertEqual(restarts, 0, "settled turn must never reach tier-3 restart")
    }

    /// 新 turn 开始（agent_start）同样取消旧升级：陈旧闭包不得在新 turn 后触发。
    func testNewTurnBeforeTier1CancelsEscalation() async throws {
        let session = makeSession()
        session.isStopping = true
        var signals: [Int32] = []
        session.stopEscalationSignalSink = { signals.append($0) }

        session.scheduleStopEscalation()
        session.handleEvent(J(["type": "agent_start"]))
        XCTAssertFalse(session.isStopping)

        let quiet = expectation(description: "quiet window past tier-3")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { quiet.fulfill() }
        await fulfillment(of: [quiet], timeout: 2)

        XCTAssertTrue(signals.isEmpty, "new turn must invalidate the stale stop escalation")
    }
}
