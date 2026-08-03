import XCTest
@testable import PipiUI

/// Record-only AgentSessionBackend stand-in. No real process. Used to prove the
/// protocol can be satisfied by something other than PiProcess, and (in Plan B)
/// to drive ChatSession's event path without spawning pi.
final class FakeBackend: AgentSessionBackend {
    var onEvent: ((J) -> Void)?
    var onExit: ((Int32, String) -> Void)?
    var isRunning = true

    private(set) var sent: [[String: Any]] = []
    private(set) var requested: [[String: Any]] = []
    private(set) var terminateCount = 0
    private(set) var signalDescendantsCalls: [Int32] = []
    private(set) var forceKillCount = 0

    func send(_ object: [String: Any], failure: (() -> Void)?) {
        sent.append(object)
    }
    func request(_ object: [String: Any], completion: ((J) -> Void)?) {
        requested.append(object)
        // No response is fine for the contract test; callers that need a
        // response will set up their own completion handling.
    }
    func terminate() { terminateCount += 1; isRunning = false }
    func signalDescendants(_ sig: Int32) { signalDescendantsCalls.append(sig) }
    func forceKill() { forceKillCount += 1; isRunning = false }
}

final class AgentSessionBackendTests: XCTestCase {

    /// PiProcess must satisfy the protocol (compile-time guarantee; this test
    /// exists so a future signature drift is caught as a test failure, not just
    /// a build break scattered elsewhere).
    func testPiProcessConformsToAgentSessionBackend() {
        // The cast through the protocol existential is the assertion. If
        // PiProcess stopped conforming, this line would not compile.
        let asBackend: (any AgentSessionBackend.Type)? = PiProcess.self as? any AgentSessionBackend.Type
        XCTAssertNotNil(asBackend)
    }

    /// A non-PiProcess type can implement the protocol and route calls.
    func testFakeBackendRecordsCalls() {
        let fake = FakeBackend()
        var receivedEvents: [J] = []
        fake.onEvent = { receivedEvents.append($0) }
        fake.request(["type": "ping"], completion: nil)
        fake.send(["type": "abort"], failure: nil)
        fake.signalDescendants(15)
        fake.terminate()
        fake.forceKill()

        XCTAssertEqual(fake.requested.count, 1)
        XCTAssertEqual(fake.requested.first?["type"] as? String, "ping")
        XCTAssertEqual(fake.sent.count, 1)
        XCTAssertEqual(fake.signalDescendantsCalls, [15])
        XCTAssertEqual(fake.terminateCount, 1)
        XCTAssertEqual(fake.forceKillCount, 1)
        XCTAssertFalse(fake.isRunning)

        // onEvent wiring is invocable (this is exactly what ChatSession will rely on).
        fake.onEvent?(J(["type": "agent_start"]))
        XCTAssertEqual(receivedEvents.count, 1)
        XCTAssertEqual(receivedEvents[0]["type"].string, "agent_start")
    }
}
