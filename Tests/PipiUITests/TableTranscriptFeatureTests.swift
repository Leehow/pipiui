import XCTest
@testable import PipiUI

final class TableTranscriptFeatureTests: XCTestCase {
    private let defaultsKey = TableTranscriptFeature.userDefaultsKey

    override func setUp() {
        super.setUp()
        UserDefaults.standard.removeObject(forKey: defaultsKey)
        TableTranscriptFeature.refreshFromStorage()
    }

    override func tearDown() {
        UserDefaults.standard.removeObject(forKey: defaultsKey)
        TableTranscriptFeature.refreshFromStorage()
        super.tearDown()
    }

    func testDefaultDisabledWithoutEnvOrDefaults() {
        // Env may still force-enable in CI; only assert the UserDefaults path.
        UserDefaults.standard.set(false, forKey: defaultsKey)
        TableTranscriptFeature.refreshFromStorage()
        // If env PIPIUI_TABLE_TRANSCRIPT is set, isEnabled follows env — skip strict assert.
        if ProcessInfo.processInfo.environment[TableTranscriptFeature.environmentKey] == nil {
            XCTAssertFalse(TableTranscriptFeature.isEnabled)
        }
    }

    func testSetEnabledUpdatesCacheAndDefaults() {
        TableTranscriptFeature.setEnabled(true)
        XCTAssertTrue(TableTranscriptFeature.isEnabled)
        XCTAssertTrue(UserDefaults.standard.bool(forKey: defaultsKey))

        TableTranscriptFeature.setEnabled(false)
        XCTAssertFalse(TableTranscriptFeature.isEnabled)
        XCTAssertFalse(UserDefaults.standard.bool(forKey: defaultsKey))
    }

    func testHeightCacheInvalidatesOnWidthChange() {
        let cache = TableTranscriptHeightCache()
        cache.noteContentWidth(400)
        XCTAssertTrue(cache.store(id: "a", height: 120))
        XCTAssertEqual(cache.height(for: "a") ?? -1, 120, accuracy: 0.01)

        cache.noteContentWidth(600)
        XCTAssertNil(cache.height(for: "a"))
    }

    func testHeightCacheIgnoresTinyDeltas() {
        let cache = TableTranscriptHeightCache()
        XCTAssertTrue(cache.store(id: "r", height: 100))
        XCTAssertFalse(cache.store(id: "r", height: 100.2))
        XCTAssertTrue(cache.store(id: "r", height: 140))
        XCTAssertEqual(cache.height(for: "r") ?? -1, 140, accuracy: 0.01)
    }

    func testEntryIDsAreStableAndDistinct() {
        let leaf = ChatItem(id: "item-1", role: "user", blocks: [.text("hi")])
        let a = TableTranscriptEntry.settledLeaf(item: leaf)
        let b = TableTranscriptEntry.streamingLeaf(item: leaf)
        XCTAssertNotEqual(a.id, b.id)
        XCTAssertEqual(a.id, "leaf:item-1")
        XCTAssertEqual(b.id, "stream:item-1")
    }
}
