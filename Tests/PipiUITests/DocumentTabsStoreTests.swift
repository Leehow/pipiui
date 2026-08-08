import XCTest
@testable import PipiUI

final class DocumentTabsStoreTests: XCTestCase {

    private func makeTempDocument(_ name: String = UUID().uuidString) -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-doctabs-\(name).md")
        try? "# doc".write(to: url, atomically: true, encoding: .utf8)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    func testOpenDeduplicatesByPathAndSelectsExisting() {
        let store = DocumentTabsStore()
        let a = makeTempDocument()
        let b = makeTempDocument()

        store.open(a)
        store.open(b)
        XCTAssertEqual(store.tabs.count, 2)
        XCTAssertEqual(store.selectedTab?.url.path, b.path)

        store.open(a) // 同路径 → 只切换，不新增
        XCTAssertEqual(store.tabs.count, 2)
        XCTAssertEqual(store.selectedTab?.url.path, a.path)
        XCTAssertNotNil(store.activeStore)
    }

    func testCloseTabSelectsNeighborAndEmptyClearsSelection() {
        let store = DocumentTabsStore()
        let a = makeTempDocument()
        let b = makeTempDocument()
        let c = makeTempDocument()
        store.open(a)
        store.open(b)
        store.open(c)

        let bID = store.tabs[1].id
        store.closeTab(id: bID) // 选中 c，关中间项 → 选中不变
        XCTAssertEqual(store.tabs.map(\.url.path), [a.path, c.path])
        XCTAssertEqual(store.selectedTab?.url.path, c.path)

        let cID = store.tabs.first { $0.url.path == c.path }!.id
        store.closeTab(id: cID) // 关掉选中项 → 选左侧邻居
        XCTAssertEqual(store.selectedTab?.url.path, a.path)

        let aID = store.tabs[0].id
        store.closeTab(id: aID) // 全关 → 空态
        XCTAssertTrue(store.tabs.isEmpty)
        XCTAssertNil(store.selectedTabID)
        XCTAssertNil(store.activeStore)
    }

    func testRestoreSkipsMissingFilesAndHonorsSelection() {
        let store = DocumentTabsStore()
        let alive = makeTempDocument()
        store.restore(
            paths: ["/definitely/missing/x.md", alive.path],
            selectedPath: alive.path
        )
        XCTAssertEqual(store.tabs.map(\.url.path), [alive.path])
        XCTAssertEqual(store.selectedTab?.url.path, alive.path)
    }

    func testRestoreRefusesWhenTabsAlreadyOpen() {
        let store = DocumentTabsStore()
        let first = makeTempDocument()
        let second = makeTempDocument()
        store.open(first)
        store.restore(paths: [second.path], selectedPath: second.path)
        XCTAssertEqual(store.tabs.map(\.url.path), [first.path])
    }

    func testPersistenceSnapshotRoundTrip() {
        let store = DocumentTabsStore()
        let a = makeTempDocument()
        let b = makeTempDocument()
        store.open(a)
        store.open(b)

        let snapshot = store.persistenceSnapshot()
        XCTAssertEqual(snapshot.paths, [a.path, b.path])
        XCTAssertEqual(snapshot.selectedPath, b.path)

        let restored = DocumentTabsStore()
        restored.restore(paths: snapshot.paths, selectedPath: snapshot.selectedPath)
        XCTAssertEqual(restored.persistenceSnapshot().paths, snapshot.paths)
        XCTAssertEqual(restored.persistenceSnapshot().selectedPath, snapshot.selectedPath)
    }
}
