import XCTest
import PipiUI
import Foundation

final class DocumentDetectorTests: XCTestCase {

    private func url(_ name: String) -> URL {
        URL(fileURLWithPath: "/tmp/pipiui-doc-test/\(name)")
    }

    func testMarkdownExtensions() {
        for name in ["a.md", "b.markdown", "c.MD", "d.MdX", "e.mdown", "f.mkd"] {
            XCTAssertEqual(DocumentDetector.kind(for: url(name)), .markdown, name)
        }
    }

    func testPlainTextExtensions() {
        for name in ["a.txt", "b.text", "c.LOG", "d.log"] {
            XCTAssertEqual(DocumentDetector.kind(for: url(name)), .plain, name)
        }
    }

    func testExtensionlessWellKnownDocs() {
        for name in ["README", "LICENSE", "changelog", "NOTES"] {
            XCTAssertEqual(DocumentDetector.kind(for: url(name)), .plain, name)
        }
    }

    func testNonDocumentsReturnNil() {
        for name in ["a.swift", "b.py", "c.png", "d.jpg", "e.json", "f.zip", "randomfile"] {
            XCTAssertNil(DocumentDetector.kind(for: url(name)), name)
            XCTAssertFalse(DocumentDetector.isDocument(url(name)), name)
        }
    }
}

@MainActor
final class DocumentStoreTests: XCTestCase {

    private var tempDir: URL!

    override func setUp() async throws {
        tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-docstore-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: tempDir)
    }

    private func write(_ name: String, _ contents: String) throws -> URL {
        let url = tempDir.appendingPathComponent(name)
        try contents.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    /// T25: 磁盘读取已挪后台，loadState 异步落地。轮询直到 isLoading 归位。
    private func waitForSettled(_ store: DocumentStore, timeout: TimeInterval = 5) async {
        let deadline = Date().addingTimeInterval(timeout)
        while store.isLoading, Date() < deadline {
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertFalse(store.isLoading, "load did not settle within \(timeout)s")
    }

    func testOpenMarkdownLoadsRendered() async throws {
        let store = DocumentStore()
        let url = try write("note.md", "# 标题\n\n正文 **粗体**\n")
        store.open(url)
        XCTAssertTrue(store.isLoading, "open must mark loading synchronously")
        await waitForSettled(store)

        guard case .loaded(let doc) = store.loadState else {
            return XCTFail("expected .loaded, got \(store.loadState)")
        }
        XCTAssertEqual(doc.kind, .markdown)
        XCTAssertEqual(doc.text, "# 标题\n\n正文 **粗体**\n")
        XCTAssertEqual(doc.url, url)
        XCTAssertEqual(doc.fileSize, doc.text.utf8.count)
        XCTAssertNotNil(doc.modifiedAt)
        XCTAssertEqual(store.currentURL, url)
    }

    func testOpenPlainTextKind() async throws {
        let store = DocumentStore()
        let url = try write("log.txt", "line1\nline2")
        store.open(url)
        await waitForSettled(store)

        guard case .loaded(let doc) = store.loadState else {
            return XCTFail("expected .loaded, got \(store.loadState)")
        }
        XCTAssertEqual(doc.kind, .plain)
    }

    func testExtensionlessReadmeLoadsAsPlain() async throws {
        let store = DocumentStore()
        let url = try write("README", "just prose")
        store.open(url)
        await waitForSettled(store)

        guard case .loaded(let doc) = store.loadState else {
            return XCTFail("expected .loaded, got \(store.loadState)")
        }
        XCTAssertEqual(doc.kind, .plain)
    }

    func testMissingFile() async {
        let store = DocumentStore()
        let url = tempDir.appendingPathComponent("ghost.md")
        store.open(url)
        await waitForSettled(store)

        XCTAssertEqual(store.loadState, .missing(path: url.path))
        XCTAssertEqual(store.currentURL, url)
    }

    func testTooLargeFileRejected() async throws {
        let store = DocumentStore()
        let url = tempDir.appendingPathComponent("huge.md")
        // 稀疏文件：不占磁盘但 size 超限。
        FileManager.default.createFile(atPath: url.path, contents: nil)
        let handle = try FileHandle(forWritingTo: url)
        try handle.truncate(atOffset: UInt64(DocumentStore.maxFileSize + 1))
        try handle.close()

        store.open(url)
        await waitForSettled(store)
        guard case .tooLarge(let path, let size) = store.loadState else {
            return XCTFail("expected .tooLarge, got \(store.loadState)")
        }
        XCTAssertEqual(path, url.path)
        XCTAssertEqual(size, DocumentStore.maxFileSize + 1)
    }

    func testCloseResetsState() async throws {
        let store = DocumentStore()
        let url = try write("a.md", "x")
        store.open(url)
        await waitForSettled(store)
        store.close()

        XCTAssertEqual(store.loadState, .empty)
        XCTAssertNil(store.currentURL)
    }

    /// 快速连续 open：第一个后台读完成时已被取代，其结果不得覆盖新目标。
    func testStaleBackgroundReadIsDiscarded() async throws {
        let store = DocumentStore()
        let first = try write("first.md", "first")
        let second = try write("second.md", "second")
        store.open(first)
        store.open(second)
        await waitForSettled(store)

        guard case .loaded(let doc) = store.loadState else {
            return XCTFail("expected .loaded, got \(store.loadState)")
        }
        XCTAssertEqual(doc.url, second)
        XCTAssertEqual(doc.text, "second")
    }

    func testWatcherReloadsAfterExternalEdit() async throws {
        let store = DocumentStore()
        let url = try write("watch.md", "v1")
        store.open(url)
        await waitForSettled(store)
        guard case .loaded(let doc1) = store.loadState, doc1.text == "v1" else {
            return XCTFail("expected v1 loaded, got \(store.loadState)")
        }

        // 模拟外部编辑（atomic save 会触发 rename 事件）。0.3s 去抖 + 后台读 → 等 1.5s。
        try "v2".write(to: url, atomically: true, encoding: .utf8)
        try await Task.sleep(for: .milliseconds(1500))
        await waitForSettled(store)

        guard case .loaded(let doc2) = store.loadState else {
            return XCTFail("expected .loaded after edit, got \(store.loadState)")
        }
        XCTAssertEqual(doc2.text, "v2")
    }
}
