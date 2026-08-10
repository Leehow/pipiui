import XCTest
@testable import PipiUI

final class SubagentHeartbeatMessageTests: XCTestCase {
    func testParsesStandardHeartbeat() throws {
        let guidance = "Silence is not progress: it means one of still thinking, died without reporting, or its report was lost."
        let text = """
        [subagent-heartbeat] outstanding=1 vanished=0
          subagent-poll (更新心跳钉值测试) — running 4m21s, idle 2s
        \(guidance)
        """

        let parsed = try XCTUnwrap(SubagentHeartbeatMessage.parse(text))
        XCTAssertEqual(parsed.headerLine, "[subagent-heartbeat] outstanding=1 vanished=0")
        XCTAssertEqual(parsed.outstanding, 1)
        XCTAssertEqual(parsed.vanished, 0)
        XCTAssertEqual(parsed.workers.count, 1)
        XCTAssertEqual(parsed.workers[0].agentId, "subagent-poll")
        XCTAssertEqual(parsed.workers[0].title, "更新心跳钉值测试")
        XCTAssertEqual(parsed.workers[0].status, .running)
        XCTAssertEqual(parsed.workers[0].elapsed, "4m21s")
        XCTAssertEqual(parsed.workers[0].idleSeconds, 2)
        XCTAssertEqual(parsed.remainingText, guidance)
        XCTAssertEqual(parsed.fullText, text)
    }

    func testParsesHeartbeatWithVanishedWorker() throws {
        let recovery = "A vanished worker was interrupted, not failed: its stored conversation is intact."
        let guidance = "Silence is not progress: decide which and act."
        let text = """
        [subagent-heartbeat] outstanding=1 vanished=1 stalled=0
          live-agent (still working) — running 12m3s, idle 8s, state=running
          lost-agent (resume me) — process gone after 9m40s, no result reported, state=interrupted
        \(recovery)
        \(guidance)
        """

        let parsed = try XCTUnwrap(SubagentHeartbeatMessage.parse(text))
        XCTAssertEqual(parsed.outstanding, 1)
        XCTAssertEqual(parsed.vanished, 1)
        XCTAssertEqual(parsed.workers.count, 2)
        XCTAssertEqual(parsed.workers[0].status, .running)
        XCTAssertEqual(parsed.workers[1].agentId, "lost-agent")
        XCTAssertEqual(parsed.workers[1].status, .vanished)
        XCTAssertEqual(parsed.workers[1].elapsed, "9m40s")
        XCTAssertNil(parsed.workers[1].idleSeconds)
        XCTAssertEqual(parsed.remainingText, recovery + "\n" + guidance)
    }

    func testParsesStateTagsAndNoPidVanishedWorker() throws {
        let guidance = "Silence is not progress: decide which and act."
        let text = """
        [subagent-heartbeat] outstanding=5 vanished=1 stalled=1
          stalled-agent (quiet task) — running 2m0s, idle 120s, state=running(stalled)
          finalizing-agent (verify) — running 2m1s, idle 0s, state=finalizing
          succeeded-agent (result) — running 2m2s, idle 0s, state=ok
          failed-agent (result) — running 2m3s, idle 0s, state=failed
          aborted-agent (result) — running 2m4s, idle 0s, state=aborted
          lost-agent (resume me) — process never attached a pid after 5m0s; treated as interrupted (vanished), state=interrupted
        \(guidance)
        """

        let parsed = try XCTUnwrap(SubagentHeartbeatMessage.parse(text))
        XCTAssertEqual(parsed.outstanding, 5)
        XCTAssertEqual(parsed.vanished, 1)
        XCTAssertEqual(parsed.workers.count, 6)
        for index in 0..<5 {
            XCTAssertEqual(parsed.workers[index].status, .running)
            XCTAssertEqual(parsed.workers[index].idleSeconds, index == 0 ? 120 : 0)
        }
        XCTAssertEqual(parsed.workers[5].agentId, "lost-agent")
        XCTAssertEqual(parsed.workers[5].status, .vanished)
        XCTAssertEqual(parsed.workers[5].elapsed, "5m0s")
        XCTAssertNil(parsed.workers[5].idleSeconds)
        XCTAssertEqual(parsed.remainingText, guidance)
    }

    func testParsesHeaderOnlyHeartbeat() throws {
        let text = "[subagent-heartbeat] outstanding=2 vanished=0"

        let parsed = try XCTUnwrap(SubagentHeartbeatMessage.parse(text))
        XCTAssertEqual(parsed.outstanding, 2)
        XCTAssertEqual(parsed.vanished, 0)
        XCTAssertTrue(parsed.workers.isEmpty)
        XCTAssertEqual(parsed.remainingText, "")
    }

    func testNonHeartbeatReturnsNil() {
        XCTAssertNil(SubagentHeartbeatMessage.parse("hello"))
        XCTAssertNil(SubagentHeartbeatMessage.parse("[subagent-stalled] agentId=worker-1"))
    }

    func testMalformedHeartbeatReturnsNil() {
        XCTAssertNil(SubagentHeartbeatMessage.parse("[subagent-heartbeat] outstanding=one vanished=0"))
        XCTAssertNil(SubagentHeartbeatMessage.parse("[subagent-heartbeat] outstanding=1"))
        XCTAssertNil(SubagentHeartbeatMessage.parse("""
        [subagent-heartbeat] outstanding=1 vanished=0
          worker (title) — running eventually, idle unknown
        """))
        XCTAssertNil(SubagentHeartbeatMessage.parse("""
        [subagent-heartbeat] outstanding=1 vanished=0
          worker (title) — running 1s, idle 0s, state=
        """))
    }
}
