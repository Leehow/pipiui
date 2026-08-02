import XCTest
@testable import PipiUI

final class LayoutPersistenceTests: XCTestCase {
    /// Window-content size round-trips through UserDefaults.
    /// (The per-account Grok quota-period persistence was removed once the capsule
    /// switched to always showing top-level usedPercent — see GrokCreditsTests.)
    func testWindowContentSizeRoundTrip() {
        let suiteName = "pipiui.test.\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: suiteName)!
        defer { suite.removePersistentDomain(forName: suiteName) }

        XCTAssertNil(LayoutPersistence.storedWindowContentSize(defaults: suite))
        LayoutPersistence.saveWindowContentSize(NSSize(width: 1000, height: 700), defaults: suite)
        let restored = LayoutPersistence.storedWindowContentSize(defaults: suite)
        XCTAssertEqual(restored?.width, 1000)
        XCTAssertEqual(restored?.height, 700)
        LayoutPersistence.flushPendingWrites()
    }

    // MARK: - T23 debounced writes

    private func makeSuite() -> (UserDefaults, String) {
        let suiteName = "pipiui.test.\(UUID().uuidString)"
        return (UserDefaults(suiteName: suiteName)!, suiteName)
    }

    /// A save must not touch UserDefaults synchronously — the whole point of
    /// T23 is that one write per drag frame never reaches disk.
    func testSaveIsNotWrittenSynchronously() {
        let (suite, suiteName) = makeSuite()
        defer {
            LayoutPersistence.flushPendingWrites()
            suite.removePersistentDomain(forName: suiteName)
        }

        LayoutPersistence.saveSidebarWidthRatio(0.25, defaults: suite)
        XCTAssertNil(suite.object(forKey: "pipiui.sidebarWidthRatio"),
                     "drag-frame saves must stay in memory until the debounced flush")
    }

    /// Reads see the pending (not-yet-flushed) value so UI state stays coherent
    /// during a drag.
    func testPendingValueIsVisibleToReads() {
        let (suite, suiteName) = makeSuite()
        defer {
            LayoutPersistence.flushPendingWrites()
            suite.removePersistentDomain(forName: suiteName)
        }

        LayoutPersistence.saveSidebarWidthRatio(0.25, defaults: suite)
        XCTAssertEqual(LayoutPersistence.sidebarWidthRatio(defaults: suite), 0.25)
    }

    /// A burst of saves coalesces into the last value on flush.
    func testBurstCoalescesToSingleFlush() {
        let (suite, suiteName) = makeSuite()
        defer {
            LayoutPersistence.flushPendingWrites()
            suite.removePersistentDomain(forName: suiteName)
        }

        for i in 0..<50 {
            LayoutPersistence.saveSidebarWidthRatio(0.2 + CGFloat(i) * 0.001, defaults: suite)
        }
        LayoutPersistence.flushPendingWrites()
        XCTAssertEqual(suite.double(forKey: "pipiui.sidebarWidthRatio"), 0.249, accuracy: 0.0001)
    }

    /// Without an explicit flush the debounce timer persists within ~300ms.
    func testDebounceTimerFlushesAutomatically() throws {
        let (suite, suiteName) = makeSuite()
        defer { suite.removePersistentDomain(forName: suiteName) }

        LayoutPersistence.saveWindowContentSize(NSSize(width: 1200, height: 800), defaults: suite)
        XCTAssertNil(suite.object(forKey: "pipiui.windowWidth"))

        let expectation = expectation(description: "debounced flush")
        DispatchQueue.main.asyncAfter(
            deadline: .now() + LayoutPersistence.writeDebounceInterval + 0.4
        ) { expectation.fulfill() }
        wait(for: [expectation], timeout: 5)
        XCTAssertEqual(suite.double(forKey: "pipiui.windowWidth"), 1200)
        XCTAssertEqual(suite.double(forKey: "pipiui.windowHeight"), 800)
    }

    /// Pending writes are scoped to the UserDefaults instance they were saved
    /// with — a pending value must not leak into another suite's reads.
    func testPendingWritesAreScopedPerDefaultsInstance() {
        let (suiteA, nameA) = makeSuite()
        let (suiteB, nameB) = makeSuite()
        defer {
            LayoutPersistence.flushPendingWrites()
            suiteA.removePersistentDomain(forName: nameA)
            suiteB.removePersistentDomain(forName: nameB)
        }

        LayoutPersistence.saveSidebarWidthRatio(0.33, defaults: suiteA)
        XCTAssertNil(LayoutPersistence.sidebarWidthRatio(defaults: suiteB))
    }

    // MARK: - Subagent panel list-height ratio

    /// No stored value → nil; a save round-trips through pending + flush.
    func testSubagentListHeightRatioRoundTrip() {
        let (suite, suiteName) = makeSuite()
        defer {
            LayoutPersistence.flushPendingWrites()
            suite.removePersistentDomain(forName: suiteName)
        }

        XCTAssertNil(LayoutPersistence.subagentListHeightRatio(defaults: suite))
        LayoutPersistence.saveSubagentListHeightRatio(0.62, defaults: suite)
        XCTAssertEqual(LayoutPersistence.subagentListHeightRatio(defaults: suite), 0.62)
        LayoutPersistence.flushPendingWrites()
        XCTAssertEqual(suite.double(forKey: "pipiui.subagentListHeightRatio"), 0.62, accuracy: 0.0001)
    }

    /// Saves outside the persisted range are rejected and must not overwrite the
    /// last valid value; the range edges themselves are accepted.
    func testSubagentListHeightRatioClampRejectsOutOfRange() {
        let (suite, suiteName) = makeSuite()
        defer {
            LayoutPersistence.flushPendingWrites()
            suite.removePersistentDomain(forName: suiteName)
        }

        LayoutPersistence.saveSubagentListHeightRatio(0.1, defaults: suite)
        XCTAssertNil(LayoutPersistence.subagentListHeightRatio(defaults: suite))

        LayoutPersistence.saveSubagentListHeightRatio(0.15, defaults: suite)
        XCTAssertEqual(LayoutPersistence.subagentListHeightRatio(defaults: suite), 0.15)

        LayoutPersistence.saveSubagentListHeightRatio(0.9, defaults: suite)
        XCTAssertEqual(LayoutPersistence.subagentListHeightRatio(defaults: suite), 0.15,
                       "out-of-range save must not overwrite the stored value")

        LayoutPersistence.saveSubagentListHeightRatio(0.85, defaults: suite)
        XCTAssertEqual(LayoutPersistence.subagentListHeightRatio(defaults: suite), 0.85)
    }

    /// Non-finite values are rejected instead of being persisted.
    func testSubagentListHeightRatioRejectsNonFinite() {
        let (suite, suiteName) = makeSuite()
        defer {
            LayoutPersistence.flushPendingWrites()
            suite.removePersistentDomain(forName: suiteName)
        }

        LayoutPersistence.saveSubagentListHeightRatio(.nan, defaults: suite)
        XCTAssertNil(LayoutPersistence.subagentListHeightRatio(defaults: suite))
        LayoutPersistence.saveSubagentListHeightRatio(.infinity, defaults: suite)
        XCTAssertNil(LayoutPersistence.subagentListHeightRatio(defaults: suite))
        LayoutPersistence.saveSubagentListHeightRatio(-0.5, defaults: suite)
        XCTAssertNil(LayoutPersistence.subagentListHeightRatio(defaults: suite))
    }

    /// Default fallback is a valid in-range ratio for the first launch.
    func testSubagentListHeightRatioDefaultIsInRange() {
        XCTAssertEqual(LayoutPersistence.defaultSubagentListHeightRatio, 0.45)
        XCTAssertTrue(LayoutPersistence.subagentListRatioRange
            .contains(LayoutPersistence.defaultSubagentListHeightRatio))
    }

    // MARK: - Sidebar project-folder expansion persistence

    /// No stored value → empty set.
    func testExpandedProjectPathsEmptyByDefault() {
        let (suite, suiteName) = makeSuite()
        defer { suite.removePersistentDomain(forName: suiteName) }

        XCTAssertEqual(LayoutPersistence.expandedProjectPaths(defaults: suite), [])
    }

    /// A multi-path set round-trips through UserDefaults (sorted on disk,
    /// restored as an equal set).
    func testExpandedProjectPathsRoundTrip() {
        let (suite, suiteName) = makeSuite()
        defer { suite.removePersistentDomain(forName: suiteName) }

        let paths: Set<String> = [
            "/Users/alice/projects/alpha",
            "/Users/alice/projects/beta",
            "/Users/alice/projects/gamma",
        ]
        LayoutPersistence.saveExpandedProjectPaths(paths, defaults: suite)
        XCTAssertEqual(LayoutPersistence.expandedProjectPaths(defaults: suite), paths)
    }
}
