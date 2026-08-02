import XCTest
@testable import PipiUI

/// Pure decision for the macOS 14 first-frame cover on session switches
/// (`BottomSettledCover`): hide a fresh pinned scroll root until its explicit
/// bottom scroll has landed. macOS 15+ never needs the cover (role API).
final class BottomSettledCoverTests: XCTestCase {
    func testFreshPinnedRootIsCoveredUntilSettled() {
        // First frame of a new pinned session: never settled → covered.
        XCTAssertTrue(
            BottomSettledCover.needsCover(
                pinned: true,
                settledSessionKey: nil,
                currentSessionKey: "session-a",
                fallbackNeeded: true
            )
        )
    }

    func testSettledMatchingKeyShows() {
        // The current root's bottom jump already landed → visible.
        XCTAssertFalse(
            BottomSettledCover.needsCover(
                pinned: true,
                settledSessionKey: "session-a",
                currentSessionKey: "session-a",
                fallbackNeeded: true
            )
        )
    }

    func testSwitchToNewKeyCoversEvenWithOlderSettledKey() {
        // A→B switch: A's settle must not reveal B's fresh root.
        XCTAssertTrue(
            BottomSettledCover.needsCover(
                pinned: true,
                settledSessionKey: "session-a",
                currentSessionKey: "session-b",
                fallbackNeeded: true
            )
        )
        // Returning to A recreates its scroll root: must re-settle, so B's key
        // cannot reveal A's fresh root either.
        XCTAssertTrue(
            BottomSettledCover.needsCover(
                pinned: true,
                settledSessionKey: "session-b",
                currentSessionKey: "session-a",
                fallbackNeeded: true
            )
        )
    }

    func testUnpinnedWarmHistoryNeverCovers() {
        XCTAssertFalse(
            BottomSettledCover.needsCover(
                pinned: false,
                settledSessionKey: nil,
                currentSessionKey: "session-a",
                fallbackNeeded: true
            )
        )
        XCTAssertFalse(
            BottomSettledCover.needsCover(
                pinned: false,
                settledSessionKey: "session-b",
                currentSessionKey: "session-a",
                fallbackNeeded: true
            )
        )
    }

    func testMacOS15FallbackNotNeededNeverCovers() {
        // macOS 15+ owns the initial offset via the role API.
        XCTAssertFalse(
            BottomSettledCover.needsCover(
                pinned: true,
                settledSessionKey: nil,
                currentSessionKey: "session-a",
                fallbackNeeded: false
            )
        )
        XCTAssertFalse(
            BottomSettledCover.needsCover(
                pinned: true,
                settledSessionKey: "session-a",
                currentSessionKey: "session-b",
                fallbackNeeded: false
            )
        )
    }
}
