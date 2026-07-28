import XCTest
@testable import PipiUI

final class AgentAutoScrollGateTests: XCTestCase {
    func testBurstCoalescesWhileOneRequestIsActive() {
        var gate = AgentAutoScrollGate()

        let first = gate.request(agentID: "agent-a", isPinned: true)
        let duplicateLog = gate.request(agentID: "agent-a", isPinned: true)
        let duplicateOutput = gate.request(agentID: "agent-a", isPinned: true)

        XCTAssertNotNil(first)
        XCTAssertNil(duplicateLog)
        XCTAssertNil(duplicateOutput)
        XCTAssertEqual(gate.activeToken, first)
    }

    func testUnpinInvalidatesDelayedRequest() throws {
        var gate = AgentAutoScrollGate()
        let token = try XCTUnwrap(gate.request(agentID: "agent-a", isPinned: true))

        XCTAssertNil(gate.request(agentID: "agent-a", isPinned: false))

        XCTAssertFalse(gate.permits(token, agentID: "agent-a", isPinned: false))
        XCTAssertFalse(gate.complete(token))
        XCTAssertNil(gate.activeToken)
    }

    func testAgentChangeInvalidatesOldGeneration() throws {
        var gate = AgentAutoScrollGate()
        let oldToken = try XCTUnwrap(gate.request(agentID: "agent-a", isPinned: true))
        let newToken = try XCTUnwrap(gate.request(agentID: "agent-b", isPinned: true))

        XCTAssertFalse(gate.permits(oldToken, agentID: "agent-b", isPinned: true))
        XCTAssertTrue(gate.permits(newToken, agentID: "agent-b", isPinned: true))
        XCTAssertFalse(gate.complete(oldToken))
        XCTAssertEqual(gate.activeToken, newToken)
    }

    func testCompletedRequestAllowsNextPinnedUpdate() throws {
        var gate = AgentAutoScrollGate()
        let first = try XCTUnwrap(gate.request(agentID: "agent-a", isPinned: true))

        XCTAssertTrue(gate.complete(first))
        let second = try XCTUnwrap(gate.request(agentID: "agent-a", isPinned: true))

        XCTAssertNotEqual(first, second)
        XCTAssertTrue(gate.permits(second, agentID: "agent-a", isPinned: true))
    }

    func testAnchorIdentityIsScopedToAgent() {
        XCTAssertNotEqual(
            AgentAutoScrollGate.anchorID(for: "agent-a"),
            AgentAutoScrollGate.anchorID(for: "agent-b")
        )
    }
}
