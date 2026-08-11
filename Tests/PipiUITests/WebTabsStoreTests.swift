import XCTest
@testable import PipiUI

final class WebTabsStoreTests: XCTestCase {

    func testInitHasOneSelectedEmptyTab() {
        let store = WebTabsStore()
        XCTAssertEqual(store.tabs.count, 1)
        XCTAssertEqual(store.selectedTabID, store.tabs[0].id)
        XCTAssertTrue(store.isFresh)
        XCTAssertEqual(store.activityCount, 0)
    }

    func testActivityCountExcludesOnlyFreshDefaultTab() {
        let store = WebTabsStore()
        _ = store.addTab()
        XCTAssertEqual(store.activityCount, 2)

        let first = store.tabs[0].id
        let second = store.tabs[1].id
        store.closeTab(id: second)
        XCTAssertEqual(store.activityCount, 0)
        store.closeTab(id: first)
        XCTAssertEqual(store.activityCount, 0)
    }

    func testAddTabSelectsNewTab() {
        let store = WebTabsStore()
        let second = store.addTab()
        XCTAssertEqual(store.tabs.count, 2)
        XCTAssertEqual(store.selectedTabID, second)
        XCTAssertFalse(store.isFresh)
    }

    func testCloseTabSelectsNeighbor() {
        let store = WebTabsStore()
        let first = store.tabs[0].id
        let second = store.addTab()
        let third = store.addTab()

        store.closeTab(id: second) // 选中项被关 → 选右侧邻居
        XCTAssertEqual(store.tabs.map(\.id), [first, third])
        XCTAssertEqual(store.selectedTabID, third)

        store.closeTab(id: third) // 末尾被关 → 选左侧邻居
        XCTAssertEqual(store.selectedTabID, first)
    }

    func testCloseLastTabRecreatesFreshTab() {
        let store = WebTabsStore()
        let only = store.tabs[0].id
        store.closeTab(id: only)
        XCTAssertEqual(store.tabs.count, 1)
        XCTAssertNotEqual(store.tabs[0].id, only)
        XCTAssertEqual(store.selectedTabID, store.tabs[0].id)
    }

    func testSelectRejectsUnknownID() {
        let store = WebTabsStore()
        let original = store.selectedTabID
        store.select(id: "nope")
        XCTAssertEqual(store.selectedTabID, original)
    }

    // MARK: - Persistence snapshot / restore

    func testRestorePendingTabsAndSnapshotRoundTrip() {
        let store = WebTabsStore()
        store.restore(
            urls: ["", "https://example.com", "http://localhost:3000"],
            selectedIndex: 5 // 越界 → 收敛到最后一个
        )
        XCTAssertEqual(store.tabs.count, 2) // 空 URL 被过滤
        XCTAssertEqual(store.activityCount, 2)
        XCTAssertEqual(store.selectedTab, store.tabs[1])
        XCTAssertFalse(store.isFresh)

        // 快照读回 pendingURL（engine 尚未创建，不发网络请求）
        let snapshot = store.persistenceSnapshot()
        XCTAssertEqual(snapshot.urls, ["https://example.com", "http://localhost:3000"])
        XCTAssertEqual(snapshot.selectedIndex, 1)
        XCTAssertNil(store.engineOrNil(for: store.tabs[0].id))
    }

    func testRestoreRefusesWhenNotFresh() {
        let store = WebTabsStore()
        _ = store.addTab()
        store.restore(urls: ["https://example.com"], selectedIndex: 0)
        XCTAssertEqual(store.tabs.count, 2) // 维持原状
    }

    func testDisplayTitleFallsBackToPendingHostThenPlaceholder() {
        let store = WebTabsStore()
        XCTAssertEqual(store.displayTitle(for: store.tabs[0]), "新标签页")
        store.restore(urls: ["https://example.com/a"], selectedIndex: 0)
        XCTAssertEqual(store.displayTitle(for: store.tabs[0]), "example.com")
    }
}
