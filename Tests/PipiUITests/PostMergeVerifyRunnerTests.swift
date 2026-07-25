import XCTest
@testable import PipiUI

final class PostMergeVerifyRunnerTests: XCTestCase {
    func testSuccessfulCommandCapturesTailAndZeroExit() {
        let r = PostMergeVerifyRunner.run(
            command: "echo hello-verify",
            in: URL(fileURLWithPath: "/tmp"),
            timeout: 30)
        XCTAssertEqual(r.exitCode, 0)
        XCTAssertFalse(r.timedOut)
        XCTAssertEqual(r.outputTail, "hello-verify")
        XCTAssertEqual(r.command, "echo hello-verify")
    }

    func testFailingCommandPropagatesExitCode() {
        let r = PostMergeVerifyRunner.run(
            command: "echo boom >&2; exit 3",
            in: URL(fileURLWithPath: "/tmp"),
            timeout: 30)
        XCTAssertEqual(r.exitCode, 3)
        XCTAssertFalse(r.timedOut)
        XCTAssertTrue(r.outputTail.contains("boom"))
    }

    /// Output larger than the rolling buffer must not grow memory unboundedly and
    /// the stored tail must stay ≤2000 chars, ending with the FINAL output lines.
    func testRollingTailBufferKeepsOnlyTheEnd() {
        let r = PostMergeVerifyRunner.run(
            command: "for i in $(seq 1 20000); do echo line-$i; done",
            in: URL(fileURLWithPath: "/tmp"),
            timeout: 60)
        XCTAssertEqual(r.exitCode, 0)
        XCTAssertLessThanOrEqual(r.outputTail.count, 2000)
        XCTAssertTrue(r.outputTail.contains("line-20000"))
        XCTAssertFalse(r.outputTail.contains("line-1\n"))
    }

    /// Regression: timeout must kill the whole process GROUP. A grandchild that
    /// inherits the stdout pipe used to keep readDataToEndOfFile() blocked forever;
    /// with kill(-pid) the pipe closes and the runner returns shortly after timeout.
    func testTimeoutKillsProcessGroupAndUnblocksRead() {
        let start = Date()
        let r = PostMergeVerifyRunner.run(
            command: "bash -c 'sleep 30' & sleep 30",
            in: URL(fileURLWithPath: "/tmp"),
            timeout: 2)
        let elapsed = Date().timeIntervalSince(start)
        XCTAssertTrue(r.timedOut)
        // Without the process-group kill this would take ~30s (or hang forever).
        XCTAssertLessThan(elapsed, 12)
    }
}
