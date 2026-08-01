import XCTest
@testable import PipiUI

final class SessionSearchTests: XCTestCase {
    private var tempDir: URL!

    override func setUp() {
        super.setUp()
        tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("SessionSearchTests-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: tempDir)
        tempDir = nil
        super.tearDown()
    }

    // MARK: - Helpers

    /// Real pi JSONL shape: top-level `type`/`message`/`role`/`content` as parts array or String.
    @discardableResult
    private func writeJSONL(_ name: String, lines: [String]) -> URL {
        let url = tempDir.appendingPathComponent(name)
        let body = lines.joined(separator: "\n") + "\n"
        try! body.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    private func sessionLine(role: String, contentJSON: String) -> String {
        """
        {"type":"message","id":"\(UUID().uuidString.prefix(8))","parentId":null,"timestamp":"2026-07-25T16:33:09.487Z","message":{"role":"\(role)","content":\(contentJSON),"timestamp":1784997189471}}
        """
    }

    private func textParts(_ text: String) -> String {
        let escaped = text
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
        return "[{\"type\":\"text\",\"text\":\"\(escaped)\"}]"
    }

    private func multiPartContent(thinking: String, text: String) -> String {
        let tEsc = thinking
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let xEsc = text
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return "[{\"type\":\"thinking\",\"thinking\":\"\(tEsc)\"},{\"type\":\"text\",\"text\":\"\(xEsc)\"}]"
    }

    private func meta(path: String, name: String, modified: Date = Date(timeIntervalSince1970: 1_700_000_000)) -> SessionMeta {
        SessionMeta(path: path, name: name, modified: modified)
    }

    // MARK: - Cases

    func testBodyKeywordHitReturnsSnippetContainingKeyword() {
        // Real shape: content is an array of parts (type/text).
        let url = writeJSONL("body.jsonl", lines: [
            #"{"type":"session","version":3,"id":"abc","timestamp":"2026-07-25T16:33:09.371Z","cwd":"/tmp"}"#,
            sessionLine(role: "user", contentJSON: textParts("请帮我查一下 foo-unique-token 的用法")),
            sessionLine(role: "assistant", contentJSON: multiPartContent(
                thinking: "User asked about a token.",
                text: "这是关于 foo-unique-token 的说明。"
            )),
        ])
        let hit = SessionSearch.scan(
            file: url,
            title: "普通标题",
            query: "foo-unique-token",
            modified: Date()
        )
        XCTAssertNotNil(hit)
        XCTAssertEqual(hit?.isTitleMatch, false)
        XCTAssertTrue(hit?.snippet?.contains("foo-unique-token") == true, "snippet=\(hit?.snippet ?? "nil")")
    }

    func testCaseInsensitiveEnglish() {
        let url = writeJSONL("case.jsonl", lines: [
            sessionLine(role: "user", contentJSON: textParts("Hello WORLD from session body")),
        ])
        let hit = SessionSearch.scan(file: url, title: "neutral", query: "hello world", modified: nil)
        XCTAssertNotNil(hit)
        XCTAssertTrue(hit?.snippet?.lowercased().contains("hello world") == true)
    }

    func testTitleMatchRanksBeforeBodyAndSkipsBodyScan() {
        let bodyOnly = writeJSONL("body-only.jsonl", lines: [
            sessionLine(role: "user", contentJSON: textParts("contains shared-keyword in the body only")),
        ])
        let titleOnly = writeJSONL("title-only.jsonl", lines: [
            // Body intentionally has NO match for "shared-keyword".
            sessionLine(role: "user", contentJSON: textParts("completely unrelated body text")),
        ])
        let older = Date(timeIntervalSince1970: 1_000)
        let newer = Date(timeIntervalSince1970: 2_000)
        let hits = SessionSearch.search(
            metas: [
                meta(path: bodyOnly.path, name: "Body Session", modified: newer),
                meta(path: titleOnly.path, name: "Title has shared-keyword here", modified: older),
            ],
            archived: [],
            query: "shared-keyword",
            liveEntries: []
        )
        XCTAssertEqual(hits.count, 2)
        XCTAssertEqual(hits[0].path, titleOnly.path)
        XCTAssertEqual(hits[0].isTitleMatch, true)
        XCTAssertNil(hits[0].snippet, "title-only hit must not scan body / must have nil snippet")
        XCTAssertEqual(hits[1].path, bodyOnly.path)
        XCTAssertEqual(hits[1].isTitleMatch, false)
        XCTAssertNotNil(hits[1].snippet)
    }

    func testNoMatchReturnsEmpty() {
        let url = writeJSONL("none.jsonl", lines: [
            sessionLine(role: "user", contentJSON: textParts("nothing interesting here")),
        ])
        let hits = SessionSearch.search(
            metas: [meta(path: url.path, name: "Plain")],
            archived: [],
            query: "zzzz-no-such-token",
            liveEntries: []
        )
        XCTAssertTrue(hits.isEmpty)
        XCTAssertNil(SessionSearch.scan(file: url, title: "Plain", query: "zzzz-no-such-token", modified: nil))
    }

    func testArchivedFlagSetWhenPassedInArchivedArray() {
        // Explicit String content form (also supported by contentText).
        let url = writeJSONL("arch.jsonl", lines: [
            sessionLine(role: "user", contentJSON: "\"please find archive-token-xyz here\""),
        ])
        let hits = SessionSearch.search(
            metas: [],
            archived: [meta(path: url.path, name: "Archived Session")],
            query: "archive-token-xyz",
            liveEntries: []
        )
        XCTAssertEqual(hits.count, 1)
        XCTAssertTrue(hits[0].isArchived)
        XCTAssertEqual(hits[0].path, url.path)
    }

    func testLongContentSnippetTruncatedWithEllipsis() {
        let prefix = String(repeating: "甲", count: 80)
        let suffix = String(repeating: "乙", count: 80)
        let body = prefix + "needle-token" + suffix
        let url = writeJSONL("long.jsonl", lines: [
            sessionLine(role: "user", contentJSON: textParts(body)),
        ])
        let hit = SessionSearch.scan(file: url, title: "Long", query: "needle-token", modified: Date())
        XCTAssertNotNil(hit?.snippet)
        let snip = hit!.snippet!
        XCTAssertTrue(snip.contains("needle-token"))
        XCTAssertTrue(snip.hasPrefix("…"), "expected leading ellipsis, got: \(snip)")
        XCTAssertTrue(snip.hasSuffix("…"), "expected trailing ellipsis, got: \(snip)")
        // ±60 around match → well under full body length
        XCTAssertLessThan(snip.count, body.count)
    }

    func testStringContentAndEmptyQuery() {
        let url = writeJSONL("str.jsonl", lines: [
            sessionLine(role: "assistant", contentJSON: "\"plain string body with kiwi-fruit\""),
        ])
        let hit = SessionSearch.scan(file: url, title: "S", query: "kiwi-fruit", modified: nil)
        XCTAssertNotNil(hit)
        XCTAssertTrue(hit?.snippet?.contains("kiwi-fruit") == true)

        let empty = SessionSearch.search(
            metas: [meta(path: url.path, name: "S")],
            archived: [],
            query: "   ",
            liveEntries: []
        )
        XCTAssertTrue(empty.isEmpty)
    }

    func testLiveTitleOnly() {
        let hits = SessionSearch.search(
            metas: [],
            archived: [],
            query: "草稿",
            liveEntries: [("new:abc", "我的草稿会话"), ("new:def", "其他")]
        )
        XCTAssertEqual(hits.count, 1)
        XCTAssertEqual(hits[0].path, "new:abc")
        XCTAssertTrue(hits[0].isLive)
        XCTAssertTrue(hits[0].isTitleMatch)
        XCTAssertNil(hits[0].snippet)
    }
}
