import XCTest
@testable import PipiUI

final class PanelTabPersistenceTests: XCTestCase {

    // MARK: - Snapshot expiry

    func testSnapshotExpiryUsesRetentionWindow() {
        let now = Date()
        let snapshot = PanelTabSnapshot(
            savedAtEpoch: now.addingTimeInterval(-73 * 3600).timeIntervalSince1970,
            webTabURLs: ["https://example.com"],
            selectedWebIndex: 0,
            documentPaths: [],
            selectedDocumentPath: nil
        )
        XCTAssertTrue(snapshot.isExpired(retentionHours: 72, now: now))
        XCTAssertFalse(snapshot.isExpired(retentionHours: 96, now: now))
        // 0 = 永久保留
        XCTAssertFalse(snapshot.isExpired(retentionHours: 0, now: now))
    }

    func testSnapshotEmptyWhenNoRestorableContent() {
        let empty = PanelTabSnapshot(
            savedAtEpoch: 0,
            webTabURLs: [""],
            selectedWebIndex: 0,
            documentPaths: [],
            selectedDocumentPath: nil
        )
        XCTAssertTrue(empty.isEmpty)
        var withWeb = empty
        withWeb.webTabURLs = ["", "https://example.com"]
        XCTAssertFalse(withWeb.isEmpty)
        var withDoc = empty
        withDoc.documentPaths = ["/tmp/a.md"]
        XCTAssertFalse(withDoc.isEmpty)
    }

    func testSnapshotCodableRoundTrip() throws {
        let snapshot = PanelTabSnapshot(
            savedAtEpoch: 1_700_000_000,
            webTabURLs: ["https://example.com", "http://localhost:3000"],
            selectedWebIndex: 1,
            documentPaths: ["/tmp/a.md", "/tmp/b.txt"],
            selectedDocumentPath: "/tmp/b.txt"
        )
        let data = try JSONEncoder().encode(snapshot)
        let decoded = try JSONDecoder().decode(PanelTabSnapshot.self, from: data)
        XCTAssertEqual(decoded, snapshot)
    }

    // MARK: - Retention setting

    func testRetentionSettingDefaultsAndClamp() {
        let defaults = UserDefaults(suiteName: "PanelTabPersistenceTests.retention")!
        defaults.removePersistentDomain(forName: "PanelTabPersistenceTests.retention")
        defer { defaults.removePersistentDomain(forName: "PanelTabPersistenceTests.retention") }

        XCTAssertEqual(PanelTabSettings.retentionHours(defaults: defaults), 72)

        PanelTabSettings.setRetentionHours(168, defaults: defaults)
        XCTAssertEqual(PanelTabSettings.retentionHours(defaults: defaults), 168)

        PanelTabSettings.setRetentionHours(0, defaults: defaults)
        XCTAssertEqual(PanelTabSettings.retentionHours(defaults: defaults), 0)

        // 非法值不落盘，维持上一次有效值
        PanelTabSettings.setRetentionHours(-5, defaults: defaults)
        XCTAssertEqual(PanelTabSettings.retentionHours(defaults: defaults), 0)
        PanelTabSettings.setRetentionHours(.nan, defaults: defaults)
        XCTAssertEqual(PanelTabSettings.retentionHours(defaults: defaults), 0)
    }

    // MARK: - Disk round trip

    func testPersistenceURLNaming() {
        let url = PanelTabPersistence.persistenceURL(forSessionFile: "/x/y/session-abc.jsonl")
        XCTAssertTrue(url.path.hasSuffix("PipiUI/panel-tabs/session-abc.panel.json"))
    }

    func testAttachRestoresTabsWithinRetentionAndExpiresOldOnes() {
        let sessionFile = "/tmp/pipiui-panel-test-\(UUID().uuidString).jsonl"
        let url = PanelTabPersistence.persistenceURL(forSessionFile: sessionFile)
        defer { try? FileManager.default.removeItem(at: url) }

        // 未过期的快照：浏览器 tab（pendingURL 恢复）+ 文档（文件存在才恢复）。
        let docFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-panel-doc-\(UUID().uuidString).md")
        try? "# hi".write(to: docFile, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: docFile) }

        let fresh = PanelTabSnapshot(
            savedAtEpoch: Date().timeIntervalSince1970 - 3600,
            webTabURLs: ["https://example.com", "http://localhost:3000"],
            selectedWebIndex: 1,
            documentPaths: [docFile.path, "/definitely/missing/x.md"],
            selectedDocumentPath: docFile.path
        )
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? JSONEncoder().encode(fresh).write(to: url)

        let webTabs = WebTabsStore()
        let documentTabs = DocumentTabsStore()
        PanelTabPersistence(webTabs: webTabs, documentTabs: documentTabs)
            .attach(sessionFile: sessionFile)

        XCTAssertEqual(webTabs.tabs.count, 2)
        XCTAssertEqual(webTabs.selectedTab, webTabs.tabs[1])
        // 缺失文档被跳过，只剩存在的那个
        XCTAssertEqual(documentTabs.tabs.map(\.url.path), [docFile.path])
        XCTAssertEqual(documentTabs.selectedTab?.url.path, docFile.path)

        // 过期快照：attach 后直接删文件、不恢复。
        let oldFile = "/tmp/pipiui-panel-old-\(UUID().uuidString).jsonl"
        let oldURL = PanelTabPersistence.persistenceURL(forSessionFile: oldFile)
        let old = PanelTabSnapshot(
            savedAtEpoch: Date().timeIntervalSince1970 - 200 * 3600,
            webTabURLs: ["https://stale.example.com"],
            selectedWebIndex: 0,
            documentPaths: [],
            selectedDocumentPath: nil
        )
        try? JSONEncoder().encode(old).write(to: oldURL)
        let staleWebTabs = WebTabsStore()
        PanelTabPersistence(webTabs: staleWebTabs, documentTabs: DocumentTabsStore())
            .attach(sessionFile: oldFile)
        XCTAssertNil(FileManager.default.contents(atPath: oldURL.path))
        XCTAssertEqual(staleWebTabs.tabs.count, 1)
        XCTAssertTrue(staleWebTabs.isFresh)
    }
}
