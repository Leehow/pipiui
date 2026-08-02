import XCTest
@testable import PipiUI

final class SubagentSignalClassifierTests: XCTestCase {
    func testHeartbeatIsBackgroundSignal() {
        let item = ChatItem(
            id: "heartbeat",
            role: "user",
            blocks: [.text("[subagent-heartbeat] outstanding=2 idle=30s")]
        )
        XCTAssertTrue(SubagentSignalClassifier.isBackgroundSignal(item: item))
    }

    func testStalledIsBackgroundSignal() {
        let item = ChatItem(
            id: "stalled",
            role: "user",
            blocks: [.text("[subagent-stalled] agentId=abc idle=120s")]
        )
        XCTAssertTrue(SubagentSignalClassifier.isBackgroundSignal(item: item))
    }

    func testDoneRedeliveryIsBackgroundSignal() {
        let item = ChatItem(
            id: "redelivery",
            role: "user",
            blocks: [.text("(re-delivery #2: 上一条完成总结的副本)")]
        )
        XCTAssertTrue(SubagentSignalClassifier.isBackgroundSignal(item: item))
    }

    func testFirstTimeDoneIsNotBackgroundSignal() {
        let item = ChatItem(
            id: "done",
            role: "user",
            blocks: [.text("[subagent-done] agentId=abc")]
        )
        XCTAssertFalse(SubagentSignalClassifier.isBackgroundSignal(item: item))
    }

    func testOrdinaryUserTextIsNotBackgroundSignal() {
        let item = ChatItem(
            id: "user-text",
            role: "user",
            blocks: [.text("继续把剩下的任务做完")]
        )
        XCTAssertFalse(SubagentSignalClassifier.isBackgroundSignal(item: item))
    }

    func testAssistantRoleWithHeartbeatPrefixIsNotBackgroundSignal() {
        let item = ChatItem(
            id: "assistant",
            role: "assistant",
            blocks: [.text("[subagent-heartbeat] outstanding=1")]
        )
        XCTAssertFalse(SubagentSignalClassifier.isBackgroundSignal(item: item))
    }

    func testNilItemIsNotBackgroundSignal() {
        XCTAssertFalse(SubagentSignalClassifier.isBackgroundSignal(item: nil))
    }

    func testHeartbeatInLaterBlockAfterThinkingIsStillBackgroundSignal() {
        // plainText joins only .text blocks; a leading .thinking block must not
        // mask the signal prefix.
        let item = ChatItem(
            id: "heartbeat-thinking",
            role: "user",
            blocks: [.thinking("检查 worker"), .text("[subagent-heartbeat] outstanding=1")]
        )
        XCTAssertTrue(SubagentSignalClassifier.isBackgroundSignal(item: item))
    }
}
