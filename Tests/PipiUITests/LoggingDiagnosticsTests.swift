import XCTest
@testable import PipiUI

final class RootLayoutMetricsTests: XCTestCase {
    func testNormalWindowIsUsable() {
        let metrics = RootLayoutMetrics.resolve(available: CGSize(width: 1400, height: 900), uiScale: 1.0)
        XCTAssertTrue(metrics.isUsable)
        XCTAssertEqual(metrics.scale, 1.0)
        XCTAssertEqual(metrics.logicalSize, CGSize(width: 1400, height: 900))
    }

    func testScaleDividesLogicalSize() {
        let metrics = RootLayoutMetrics.resolve(available: CGSize(width: 1400, height: 900), uiScale: 1.4)
        XCTAssertEqual(metrics.logicalSize.width, 1000, accuracy: 0.001)
        XCTAssertTrue(metrics.isUsable)
    }

    func testZeroProposalIsNotUsable() {
        let metrics = RootLayoutMetrics.resolve(available: .zero, uiScale: 1.0)
        XCTAssertFalse(metrics.isUsable)
    }

    func testZeroScaleFallsBackInsteadOfProducingInfinity() {
        let metrics = RootLayoutMetrics.resolve(available: CGSize(width: 1200, height: 800), uiScale: 0)
        XCTAssertEqual(metrics.scale, RootLayoutMetrics.fallbackScale)
        XCTAssertTrue(metrics.logicalSize.width.isFinite)
        XCTAssertTrue(metrics.isUsable)
    }

    func testNonFiniteScaleFallsBack() {
        XCTAssertEqual(RootLayoutMetrics.sanitizedScale(.nan), RootLayoutMetrics.fallbackScale)
        XCTAssertEqual(RootLayoutMetrics.sanitizedScale(.infinity), RootLayoutMetrics.fallbackScale)
        XCTAssertEqual(RootLayoutMetrics.sanitizedScale(-2), RootLayoutMetrics.fallbackScale)
    }

    func testScaleIsClampedToSupportedRange() {
        XCTAssertEqual(RootLayoutMetrics.sanitizedScale(9), RootLayoutMetrics.scaleRange.upperBound)
        XCTAssertEqual(RootLayoutMetrics.sanitizedScale(0.1), RootLayoutMetrics.scaleRange.lowerBound)
    }

    func testNaNSizeIsNotUsable() {
        XCTAssertFalse(RootLayoutMetrics.isUsable(CGSize(width: CGFloat.nan, height: 800)))
    }
}

final class ScrollStateTests: XCTestCase {
    private func state(document: CGFloat, visibleY: CGFloat, visibleHeight: CGFloat, subviews: Int) -> ScrollState {
        ScrollState(
            documentHeight: document,
            visibleRect: NSRect(x: 0, y: visibleY, width: 600, height: visibleHeight),
            realizedSubviews: subviews
        )
    }

    func testHealthyTranscriptIsNotBlank() {
        let healthy = state(document: 4000, visibleY: 3200, visibleHeight: 800, subviews: 12)
        XCTAssertFalse(healthy.isBlankSignature)
        XCTAssertEqual(healthy.overshoot, 0)
    }

    func testViewportPastEndOfDocumentIsBlank() {
        // Stale offset from the previous session, new content much shorter.
        let stale = state(document: 500, visibleY: 3200, visibleHeight: 800, subviews: 3)
        XCTAssertTrue(stale.isBlankSignature)
        XCTAssertEqual(stale.overshoot, 3500)
    }

    func testNothingRealizedIsBlank() {
        XCTAssertTrue(state(document: 4000, visibleY: 0, visibleHeight: 800, subviews: 0).isBlankSignature)
    }

    func testEmptyDocumentIsBlank() {
        XCTAssertTrue(state(document: 0, visibleY: 0, visibleHeight: 800, subviews: 1).isBlankSignature)
    }

    func testCollapsedViewportIsNotReported() {
        // A zero-height scroll view is not on screen; do not cry wolf.
        XCTAssertFalse(state(document: 0, visibleY: 0, visibleHeight: 0, subviews: 0).isBlankSignature)
    }

    func testSmallOvershootDuringLayoutIsTolerated() {
        let settling = state(document: 4000, visibleY: 3300, visibleHeight: 800, subviews: 10)
        XCTAssertEqual(settling.overshoot, 100)
        XCTAssertFalse(settling.isBlankSignature)
    }

    /// Regression guard for the "切进流式会话白屏" bug: after a session switch,
    /// `scrollTo("bottom")` lands the clip view on the bottom anchor (overshoot 0)
    /// but a LazyVStack realizes only that anchor row and none of the message rows
    /// in the visible rectangle. Logs captured this exact signature:
    ///   document=10403 visible=9585..10403 (818) subviews=1 overshoot=0
    /// The inverted transcript avoids producing this state by starting at its natural
    /// document origin instead of programmatically scrolling to the bottom on switch.
    func testPinnedToBottomButOnlyAnchorRealizedIsBlank() {
        let signature = state(document: 10403, visibleY: 9585, visibleHeight: 818, subviews: 1)
        XCTAssertEqual(signature.overshoot, 0)
        XCTAssertTrue(signature.isBlankSignature)
    }
}

final class StderrCaptureTests: XCTestCase {
    func testFileNameUsesDayGranularity() {
        let date = Date(timeIntervalSince1970: 0)
        let name = StderrCapture.fileName(for: date)
        XCTAssertTrue(name.hasPrefix(StderrCapture.filePrefix))
        XCTAssertTrue(name.hasSuffix(".log"))
    }

    func testNoRedirectWhenStderrIsATerminal() {
        // Tests run without a tty on CI and with one locally; assert the contract
        // rather than the environment: forcing is what makes the redirect happen.
        if isatty(STDERR_FILENO) != 0 {
            XCTAssertNil(StderrCapture.install(directory: FileManager.default.temporaryDirectory))
        }
    }
}

final class LogAccessTests: XCTestCase {
    func testNewestLogFileIgnoresOtherFiles() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-logtest-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let older = dir.appendingPathComponent("pipiui-2026-07-01.log")
        let newer = dir.appendingPathComponent("pipiui-2026-07-02.log")
        let unrelated = dir.appendingPathComponent("notes.txt")
        for url in [older, newer, unrelated] {
            try Data("x".utf8).write(to: url)
        }
        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSince1970: 1000)], ofItemAtPath: older.path
        )
        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSince1970: 2000)], ofItemAtPath: newer.path
        )

        XCTAssertEqual(LogAccess.newestLogFile(in: dir)?.lastPathComponent, newer.lastPathComponent)
    }

    func testNewestLogFileOnMissingDirectory() {
        let missing = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-missing-\(UUID().uuidString)", isDirectory: true)
        XCTAssertNil(LogAccess.newestLogFile(in: missing))
    }
}
