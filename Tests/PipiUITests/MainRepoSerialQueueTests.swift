import XCTest
@testable import PipiUI

/// Regression tests for the main-repo race: agents finishing together used to run
/// `git merge` and post-merge verify builds concurrently against one working tree,
/// producing index.lock collisions and phantom `[post-merge-verify-failed]` reports.
final class MainRepoSerialQueueTests: XCTestCase {

    /// Core property: no two operations submitted to the queue ever overlap in time,
    /// however many are submitted concurrently.
    func testOperationsNeverOverlap() async {
        let tracker = OverlapTracker()
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<12 {
                group.addTask {
                    await MainRepoSerialQueue.run {
                        tracker.enter()
                        // Long enough that unserialized work would demonstrably overlap.
                        Thread.sleep(forTimeInterval: 0.02)
                        tracker.leave()
                    }
                }
            }
        }
        XCTAssertEqual(tracker.maxConcurrent, 1, "main-repo operations must be serialized")
        XCTAssertEqual(tracker.completed, 12)
    }

    /// A merge and a verify submitted at the same instant must not interleave —
    /// this is the exact pair that produced builds reading a half-merged tree.
    func testMergeAndVerifyDoNotInterleave() async {
        let tracker = OverlapTracker()
        async let merge: Void = MainRepoSerialQueue.run {
            tracker.enter()
            Thread.sleep(forTimeInterval: 0.05)
            tracker.leave()
        }
        async let verify: Void = MainRepoSerialQueue.run {
            tracker.enter()
            Thread.sleep(forTimeInterval: 0.05)
            tracker.leave()
        }
        _ = await (merge, verify)
        XCTAssertEqual(tracker.maxConcurrent, 1)
    }

    /// Return values must survive the continuation round-trip (merge outcomes rely on it).
    func testReturnsBodyValue() async {
        let value = await MainRepoSerialQueue.run { 42 }
        XCTAssertEqual(value, 42)
    }
}

/// Counts peak concurrency across threads.
private final class OverlapTracker: @unchecked Sendable {
    private let lock = NSLock()
    private var current = 0
    private(set) var maxConcurrent = 0
    private(set) var completed = 0

    func enter() {
        lock.lock()
        current += 1
        maxConcurrent = max(maxConcurrent, current)
        lock.unlock()
    }

    func leave() {
        lock.lock()
        current -= 1
        completed += 1
        lock.unlock()
    }
}
