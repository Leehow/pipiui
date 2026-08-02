import XCTest
@testable import PipiUI

/// 错误横幅「重试」按钮的状态机：只有 pi auto_retry 最终失败才可重试；
/// 任何其他 lastError 写入（关闭 / 其他错误 / 重试本身）都会复位可重试标志。
final class RetryLastRequestTests: XCTestCase {
    private func makeSession() -> ChatSession {
        ChatSession(
            id: UUID().uuidString,
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "test-only"
        )
    }

    /// 复现真实时序：agent_start（清掉 blockedReason 塞的 lastError）→
    /// auto_retry_start(第 1 次) → auto_retry_end(最终失败)。
    private func armRetryFailure(_ session: ChatSession) {
        session.handleEvent(J(["type": "agent_start"]))
        session.handleEvent(J([
            "type": "auto_retry_start",
            "attempt": 1,
            "maxAttempts": 3,
        ]))
        session.handleEvent(J([
            "type": "auto_retry_end",
            "success": false,
            "finalError": "fetch failed",
        ]))
    }

    func testAutoRetryEndFailureArmsRetryAndSetsError() {
        let session = makeSession()
        armRetryFailure(session)

        XCTAssertEqual(session.lastError, "重试失败：fetch failed")
        XCTAssertTrue(session.lastErrorCanRetry)
    }

    func testAutoRetryEndSuccessClearsError() {
        let session = makeSession()
        armRetryFailure(session)

        // 下一轮请求成功，重试最终结束且成功 → 错误消失、标志复位。
        session.handleEvent(J([
            "type": "auto_retry_end",
            "success": true,
        ]))

        XCTAssertNil(session.lastError)
        XCTAssertFalse(session.lastErrorCanRetry)
    }

    func testUnrelatedErrorResetsRetryArmedFlag() {
        let session = makeSession()
        armRetryFailure(session)

        // 任何其他 lastError 写入（例如切换模型失败）都让按钮失效，防止误重试。
        session.flash("切换模型失败")

        XCTAssertFalse(session.lastErrorCanRetry)
    }

    func testRetryWithoutRunningProcessFlashes() {
        let session = makeSession()
        armRetryFailure(session)
        // 真实时序里 auto_retry_end(失败) 之后紧跟 agent_settled 结束本轮；
        // 用户点「重试」时 isWorking 已为 false。测试会话没有 pi 进程 → 走 proc 守卫。
        session.handleEvent(J(["type": "agent_settled"]))

        session.retryLastRequest()

        XCTAssertEqual(session.lastError, "pi 未运行，无法重试")
        XCTAssertFalse(session.lastErrorCanRetry)
    }
}
