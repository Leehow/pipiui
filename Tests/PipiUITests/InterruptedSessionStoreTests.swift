import XCTest
@testable import PipiUI

final class InterruptedSessionStoreTests: XCTestCase {
    private var defaults: UserDefaults!
    private let suiteName = "InterruptedSessionStoreTests.\(UUID().uuidString)"

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suiteName)
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        super.tearDown()
    }

    func testMarkContainsClear() {
        let path = "/tmp/session.jsonl"
        XCTAssertFalse(InterruptedSessionStore.contains(path, defaults: defaults))
        InterruptedSessionStore.mark(path, defaults: defaults)
        XCTAssertTrue(InterruptedSessionStore.contains(path, defaults: defaults))
        InterruptedSessionStore.clear(path, defaults: defaults)
        XCTAssertFalse(InterruptedSessionStore.contains(path, defaults: defaults))
    }

    func testMarkIdempotent() {
        let path = "/tmp/a.jsonl"
        InterruptedSessionStore.mark(path, defaults: defaults)
        InterruptedSessionStore.mark(path, defaults: defaults)
        XCTAssertEqual(InterruptedSessionStore.paths(defaults: defaults), [path])
    }

    func testEmptyPathIgnored() {
        InterruptedSessionStore.mark("", defaults: defaults)
        XCTAssertTrue(InterruptedSessionStore.paths(defaults: defaults).isEmpty)
    }

    func testMultiplePaths() {
        InterruptedSessionStore.mark("/a.jsonl", defaults: defaults)
        InterruptedSessionStore.mark("/b.jsonl", defaults: defaults)
        XCTAssertEqual(
            InterruptedSessionStore.paths(defaults: defaults),
            ["/a.jsonl", "/b.jsonl"]
        )
        InterruptedSessionStore.clear("/a.jsonl", defaults: defaults)
        XCTAssertEqual(InterruptedSessionStore.paths(defaults: defaults), ["/b.jsonl"])
    }

    func testShouldPersistMarkIncludesRunningSubagents() {
        // Main settled, waiting on background subagent — must keep crash badge.
        XCTAssertTrue(
            InterruptedSessionStore.shouldPersistMark(
                agentTurnActive: false,
                isWorking: false,
                runningSubagents: 1
            )
        )
        XCTAssertTrue(
            InterruptedSessionStore.shouldPersistMark(
                agentTurnActive: true,
                isWorking: false,
                runningSubagents: 0
            )
        )
        XCTAssertTrue(
            InterruptedSessionStore.shouldPersistMark(
                agentTurnActive: false,
                isWorking: true,
                runningSubagents: 0
            )
        )
        XCTAssertFalse(
            InterruptedSessionStore.shouldPersistMark(
                agentTurnActive: false,
                isWorking: false,
                runningSubagents: 0
            )
        )
    }
}
