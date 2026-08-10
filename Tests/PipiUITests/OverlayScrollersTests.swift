import AppKit
import XCTest
@testable import PipiUI

/// OverlayScrollers idempotency/dedup seam. The installer must (a) apply overlay
/// flags at most once per scroll view and (b) treat already-correct scroll views
/// as no-ops so a steady-state body re-render schedules no 16×50ms timer patrol.
/// These tests cover the pure, AppKit-level invariants that gate that behavior.
final class OverlayScrollersTests: XCTestCase {
    func testApplyIfNeededChangesFlagsFirstTimeOnly() {
        let sv = NSScrollView()
        XCTAssertTrue(OverlayScrollers.applyIfNeeded(to: sv),
                      "first apply should report that it changed scroller flags")
        XCTAssertTrue(OverlayScrollers.isCorrectlyConfigured(sv))

        XCTAssertFalse(OverlayScrollers.applyIfNeeded(to: sv),
                       "second apply on an already-correct view must be a no-op")
        XCTAssertTrue(OverlayScrollers.isCorrectlyConfigured(sv))
    }

    func testIsCorrectlyConfiguredRequiresAllFlags() {
        let sv = NSScrollView()
        XCTAssertFalse(OverlayScrollers.isCorrectlyConfigured(sv))

        // Partial configuration is not enough.
        sv.scrollerStyle = .overlay
        XCTAssertFalse(OverlayScrollers.isCorrectlyConfigured(sv))

        OverlayScrollers.apply(to: sv)
        XCTAssertTrue(OverlayScrollers.isCorrectlyConfigured(sv))
    }

    func testApplyReEstablishesConfiguredStateAfterReset() {
        // Simulates SwiftUI resetting flags after install: the installer must be
        // able to detect the regression and re-apply (this is what arms the one
        // bounded confirm window, instead of a perpetual timer).
        let sv = NSScrollView()
        OverlayScrollers.apply(to: sv)
        XCTAssertTrue(OverlayScrollers.isCorrectlyConfigured(sv))

        sv.scrollerStyle = .legacy
        sv.autohidesScrollers = false
        XCTAssertFalse(OverlayScrollers.isCorrectlyConfigured(sv))
        XCTAssertTrue(OverlayScrollers.applyIfNeeded(to: sv))
        XCTAssertTrue(OverlayScrollers.isCorrectlyConfigured(sv))
    }

    func testCollectFindsDeeplyNestedScrollView() {
        let root = NSView(frame: NSRect(x: 0, y: 0, width: 100, height: 100))
        let middle = NSView(frame: NSRect(x: 0, y: 0, width: 100, height: 100))
        let sv = NSScrollView(frame: NSRect(x: 0, y: 0, width: 80, height: 80))
        root.addSubview(middle)
        middle.addSubview(sv)

        let found = OverlayScrollers.collect(from: root)
        XCTAssertTrue(found.contains(where: { $0 === sv }))
    }

    func testCollectSurfacesEnclosingScrollViewExactlyOnce() {
        let sv = NSScrollView(frame: NSRect(x: 0, y: 0, width: 80, height: 80))
        let document = NSView()
        sv.documentView = document

        let found = OverlayScrollers.collect(from: document)
        let count = found.filter { $0 === sv }.count
        XCTAssertEqual(count, 1, "enclosing scroll view must be surfaced once, not duplicated")
    }
}
