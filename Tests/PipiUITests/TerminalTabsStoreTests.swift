import XCTest
@testable import PipiUI

final class TerminalTabsStoreTests: XCTestCase {

    private var projectURL: URL {
        FileManager.default.temporaryDirectory
    }

    func testInitHasOneSelectedTab() {
        let store = TerminalTabsStore(projectURL: projectURL)
        XCTAssertEqual(store.tabs.count, 1)
        XCTAssertEqual(store.selectedTabID, store.tabs[0].id)
        XCTAssertTrue(store.active === store.session(for: store.tabs[0].id))
    }

    func testOpenSelectsNewTabWithIndependentSession() {
        let store = TerminalTabsStore(projectURL: projectURL)
        let firstID = store.tabs[0].id
        let firstSession = store.active

        let second = store.open()
        XCTAssertEqual(store.tabs.count, 2)
        XCTAssertEqual(store.selectedTabID, second)
        XCTAssertFalse(store.active === firstSession)
        XCTAssertTrue(store.session(for: firstID) === firstSession)
    }

    func testCloseTabSelectsNeighbor() {
        let store = TerminalTabsStore(projectURL: projectURL)
        let first = store.tabs[0].id
        let second = store.open()
        let third = store.open()

        store.closeTab(id: second) // 选中项被关 → 选右侧邻居
        XCTAssertEqual(store.tabs.map(\.id), [first, third])
        XCTAssertEqual(store.selectedTabID, third)

        store.closeTab(id: third) // 末尾被关 → 选左侧邻居
        XCTAssertEqual(store.selectedTabID, first)
    }

    func testCloseLastTabRecreatesFreshTab() {
        let store = TerminalTabsStore(projectURL: projectURL)
        let only = store.tabs[0].id
        let onlySession = store.active
        store.closeTab(id: only)
        XCTAssertEqual(store.tabs.count, 1)
        XCTAssertNotEqual(store.tabs[0].id, only)
        XCTAssertEqual(store.selectedTabID, store.tabs[0].id)
        // 新 tab 必须是新 session，旧 PTY 不应复用
        XCTAssertFalse(store.active === onlySession)
    }

    func testSelectRejectsUnknownID() {
        let store = TerminalTabsStore(projectURL: projectURL)
        let original = store.selectedTabID
        store.select(id: "nope")
        XCTAssertEqual(store.selectedTabID, original)
    }

    func testSelectLatestPicksLastTab() {
        let store = TerminalTabsStore(projectURL: projectURL)
        let first = store.tabs[0].id
        let second = store.open()
        store.select(id: first)
        XCTAssertEqual(store.selectedTabID, first)

        store.selectLatest()
        XCTAssertEqual(store.selectedTabID, second)
    }

    func testDisplayTitleFallsBackToPlaceholder() {
        let store = TerminalTabsStore(projectURL: projectURL)
        XCTAssertEqual(store.displayTitle(for: store.tabs[0]), "终端")
    }

    func testSessionsAreIndependentAcrossTabs() {
        let store = TerminalTabsStore(projectURL: projectURL)
        let a = store.tabs[0].id
        let b = store.open()
        let sessionA = store.session(for: a)
        let sessionB = store.session(for: b)
        XCTAssertFalse(sessionA === sessionB)
        XCTAssertEqual(sessionA.projectURL.path, projectURL.path)
        XCTAssertEqual(sessionB.projectURL.path, projectURL.path)
    }
}
