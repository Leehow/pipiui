import XCTest
@testable import PipiUI

/// `ResizeThrottle` collapses the storm of intermediate resize frames SwiftUI
/// fires while dragging a window down to ~60fps. The wrong rate in either
/// direction is visible: too loose and a streaming session still stutters on
/// resize; too tight and the dragged window visibly lags behind the cursor.
final class ResizeThrottleTests: XCTestCase {
    private let cooldown = ResizeThrottle.defaultCooldown
    private let epoch = Date(timeIntervalSince1970: 1_700_000_000)

    func testFirstFrameAlwaysEmits() {
        XCTAssertTrue(ResizeThrottle.shouldEmit(now: epoch, lastEmittedAt: nil))
    }

    func testFrameInsideCooldownIsDropped() {
        // Same instant as the last emit — must drop to avoid re-running layout
        // twice for one refresh.
        XCTAssertFalse(
            ResizeThrottle.shouldEmit(now: epoch, lastEmittedAt: epoch)
        )
        // Just under one cooldown later is still too soon.
        let justBefore = epoch.addingTimeInterval(cooldown - 0.001)
        XCTAssertFalse(
            ResizeThrottle.shouldEmit(now: justBefore, lastEmittedAt: epoch)
        )
    }

    func testFrameAtOrPastCooldownEmits() {
        // Add an epsilon: 1.0/60.0 is a repeating binary fraction, so the exact
        // boundary can land a hair below the stored cooldown. A clearly-past
        // frame is the robust assertion for the "≥ cooldown ⇒ emit" property.
        let justPast = epoch.addingTimeInterval(cooldown + 0.0001)
        XCTAssertTrue(
            ResizeThrottle.shouldEmit(now: justPast, lastEmittedAt: epoch)
        )
        let wellPast = epoch.addingTimeInterval(cooldown + 0.05)
        XCTAssertTrue(
            ResizeThrottle.shouldEmit(now: wellPast, lastEmittedAt: epoch)
        )
    }

    /// Simulates the actual resize storm: a frame every ~6ms (a fast live-resize
    /// tick on a 120Hz display). The throttle must (a) never let two emits
    /// closer than one cooldown, and (b) collapse 150 raw frames down to a small
    /// fraction — that is the property the view layer relies on to keep the main
    /// thread free for streaming work. We assert the invariants rather than a
    /// precise emit count, because the count depends on the discrete input tick
    /// spacing (6ms input vs 16.67ms gate ⇒ emits land every 18ms, not 16.67ms).
    func testHighFrequencyStreamCollapsesToAbout60fps() {
        var lastEmittedAt: Date? = nil
        var emittedCount = 0
        var emittedTimestamps: [Date] = []

        // 150 frames at 6ms spacing ≈ 0.9s of dragging. Unthrottled this would
        // be 150 layout passes.
        for i in 0..<150 {
            let frame = epoch.addingTimeInterval(Double(i) * 0.006)
            if ResizeThrottle.shouldEmit(now: frame, lastEmittedAt: lastEmittedAt) {
                emittedCount += 1
                lastEmittedAt = frame
                emittedTimestamps.append(frame)
            }
        }

        // Every emitted frame is at least one cooldown after the previous.
        for pair in zip(emittedTimestamps, emittedTimestamps.dropFirst()) {
            XCTAssertGreaterThanOrEqual(
                pair.1.timeIntervalSince(pair.0), cooldown - 0.0001,
                "emitted frames must respect the cooldown"
            )
        }
        // Dramatically fewer than the raw frame count — that is the whole point.
        // At ~60fps over 0.9s we expect on the order of 50 emits, never anywhere
        // near 150. Assert a wide safe band rather than an exact number.
        XCTAssertLessThan(emittedCount, 70, "throttle must collapse the resize storm")
        XCTAssertGreaterThan(emittedCount, 30, "throttle must not starve layout (still ~60fps)")
    }

    func testCustomCooldownRespected() {
        // A more aggressive 8ms cooldown (~120fps) lets more frames through.
        let custom: TimeInterval = 0.008
        XCTAssertTrue(ResizeThrottle.shouldEmit(now: epoch, lastEmittedAt: nil, cooldown: custom))
        XCTAssertFalse(
            ResizeThrottle.shouldEmit(
                now: epoch.addingTimeInterval(0.007), lastEmittedAt: epoch, cooldown: custom
            )
        )
        XCTAssertTrue(
            ResizeThrottle.shouldEmit(
                now: epoch.addingTimeInterval(0.008), lastEmittedAt: epoch, cooldown: custom
            )
        )
    }

    func testLiveResizeFreezesSettledLayoutUnlessForced() {
        XCTAssertFalse(
            ResizeThrottle.shouldUpdateSettledLayout(
                force: false,
                inLiveResize: true,
                now: epoch.addingTimeInterval(1),
                lastEmittedAt: epoch
            )
        )
        XCTAssertTrue(
            ResizeThrottle.shouldUpdateSettledLayout(
                force: true,
                inLiveResize: true,
                now: epoch,
                lastEmittedAt: nil
            )
        )
    }

    func testIdleResizeStillRespectsCooldown() {
        XCTAssertFalse(
            ResizeThrottle.shouldUpdateSettledLayout(
                force: false,
                inLiveResize: false,
                now: epoch,
                lastEmittedAt: epoch
            )
        )
        XCTAssertTrue(
            ResizeThrottle.shouldUpdateSettledLayout(
                force: false,
                inLiveResize: false,
                now: epoch.addingTimeInterval(cooldown + 0.0001),
                lastEmittedAt: epoch
            )
        )
    }
}
