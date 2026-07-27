import Foundation
import PipiUI
import XCTest

@MainActor
final class DocumentSummaryStoreTests: XCTestCase {
    private final class LoaderProbe: @unchecked Sendable {
        private let lock = NSLock()
        private var calls = 0
        private var mainThreadCalls = 0

        func record() {
            lock.lock()
            calls += 1
            if Thread.isMainThread { mainThreadCalls += 1 }
            lock.unlock()
        }

        func snapshot() -> (calls: Int, mainThreadCalls: Int) {
            lock.lock()
            defer { lock.unlock() }
            return (calls, mainThreadCalls)
        }
    }

    private var tempDir: URL!

    override func setUp() async throws {
        tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-summary-\(UUID().uuidString)", isDirectory: true)
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

    private func settled(
        _ store: DocumentSummaryStore,
        path: String,
        timeout: TimeInterval = 5
    ) async {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if case .loading = store.entry(for: path).state {
                try? await Task.sleep(for: .milliseconds(10))
                continue
            }
            return
        }
        XCTFail("summary did not settle within \(timeout)s for \(path)")
    }

    func testTruncationRespectsCharacterCapIncludingEllipsis() {
        let value = DocumentSummaryTruncation.truncate(String(repeating: "字", count: 300))
        XCTAssertLessThanOrEqual(value.count, 240)
        XCTAssertTrue(value.hasSuffix("…"))
    }

    func testTruncationRespectsLineCap() {
        let value = DocumentSummaryTruncation.truncate(
            (1...8).map { "L\($0)" }.joined(separator: "\n")
        )
        XCTAssertLessThanOrEqual(value.components(separatedBy: "\n").count, 6)
        XCTAssertTrue(value.hasSuffix("…"))
    }

    func testTruncationLeavesShortCJKTextUntouched() {
        XCTAssertEqual(
            DocumentSummaryTruncation.truncate("标题\n这是简短内容"),
            "标题\n这是简短内容"
        )
    }

    func testLoadedSummaryForTextFile() async throws {
        let store = DocumentSummaryStore()
        let url = try write("note.md", "# Title\nbody text")
        store.request(for: url, kind: .markdown)
        await settled(store, path: url.path)

        guard case .loaded(let summary) = store.entry(for: url.path).state else {
            return XCTFail("expected loaded, got \(store.entry(for: url.path).state)")
        }
        XCTAssertEqual(summary.text, "# Title\nbody text")
    }

    func testMissingStateForAbsentFile() async {
        let store = DocumentSummaryStore()
        let url = tempDir.appendingPathComponent("ghost.md")
        store.request(for: url, kind: .markdown)
        await settled(store, path: url.path)
        XCTAssertEqual(store.entry(for: url.path).state, .missing)
    }

    func testTooLargeStateUsesTextCap() async throws {
        let store = DocumentSummaryStore()
        let url = tempDir.appendingPathComponent("big.log")
        FileManager.default.createFile(atPath: url.path, contents: nil)
        let handle = try FileHandle(forWritingTo: url)
        try handle.truncate(atOffset: UInt64(DocumentStore.maxFileSize + 1))
        try handle.close()

        store.request(for: url, kind: .plain)
        await settled(store, path: url.path)
        XCTAssertEqual(
            store.entry(for: url.path).state,
            .tooLarge(size: DocumentStore.maxFileSize + 1)
        )
    }

    func testUnreadableStateMappingThroughDeterministicLoader() async {
        let store = DocumentSummaryStore { _, _ in
            .init(state: .unreadable)
        }
        let url = tempDir.appendingPathComponent("locked.md")
        store.request(for: url, kind: .markdown)
        await settled(store, path: url.path)
        XCTAssertEqual(store.entry(for: url.path).state, .unreadable)
    }

    func testEntryLookupDoesNotScheduleIOAndRequestsAreCachedIdempotently() async {
        let probe = LoaderProbe()
        let store = DocumentSummaryStore { _, _ in
            probe.record()
            return .init(state: .loaded(.init("stub")))
        }
        let path = "/no/such/path/\(UUID().uuidString).md"

        XCTAssertEqual(store.entry(for: path).state, .loading)
        XCTAssertEqual(probe.snapshot().calls, 0, "entry(for:) must only inspect cache")

        let url = URL(fileURLWithPath: path)
        store.request(for: url, kind: .markdown)
        store.request(for: url, kind: .markdown)
        await settled(store, path: path)
        store.request(for: url, kind: .markdown)
        try? await Task.sleep(for: .milliseconds(30))

        let snapshot = probe.snapshot()
        XCTAssertEqual(snapshot.calls, 1)
        XCTAssertEqual(snapshot.mainThreadCalls, 0, "loader must run off main")
        XCTAssertEqual(store.entry(for: path).state, .loaded(.init("stub")))
    }
}
