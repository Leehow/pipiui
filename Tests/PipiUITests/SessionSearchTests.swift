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

    // MARK: - Review findings

    func testOpenActionDispatchArchivedGoesThroughRestore() {
        var hit = SessionSearchHit(
            path: "/tmp/arch.jsonl",
            title: "Archived T",
            modified: nil,
            snippet: nil,
            isTitleMatch: true,
            isArchived: true,
            isLive: false
        )
        guard case .restoreArchived(let meta) = SessionSearch.openAction(for: hit) else {
            return XCTFail("archived hit must dispatch to restoreArchived, got \(SessionSearch.openAction(for: hit))")
        }
        XCTAssertEqual(meta.path, "/tmp/arch.jsonl")
        XCTAssertEqual(meta.name, "Archived T")

        hit = SessionSearchHit(
            path: "/tmp/disk.jsonl",
            title: "Disk T",
            modified: Date(timeIntervalSince1970: 1),
            snippet: "s",
            isTitleMatch: false,
            isArchived: false,
            isLive: false
        )
        guard case .openDisk(let diskMeta) = SessionSearch.openAction(for: hit) else {
            return XCTFail("disk hit must dispatch to openDisk")
        }
        XCTAssertEqual(diskMeta.path, "/tmp/disk.jsonl")
        XCTAssertEqual(diskMeta.modified, Date(timeIntervalSince1970: 1))

        hit = SessionSearchHit(
            path: "new:abc",
            title: "Live T",
            modified: nil,
            snippet: nil,
            isTitleMatch: true,
            isArchived: false,
            isLive: true
        )
        guard case .selectLive(let key) = SessionSearch.openAction(for: hit) else {
            return XCTFail("live hit must dispatch to selectLive")
        }
        XCTAssertEqual(key, "new:abc")
    }

    func testScannerSurvivesByteCutMidMultibyteChar() {
        // Line 1 holds the keyword; a 3-byte 中 is placed so its lead byte (E4)
        // lands at maxBytes-2 and its final byte (AD) falls outside the 10MiB
        // read window. The old whole-prefix UTF-8 decode would fail entirely;
        // the streaming scanner only drops the cut partial line.
        let maxBytes = 10 * 1024 * 1024
        let keywordLine = sessionLine(role: "user", contentJSON: textParts("early-keyword-survives-cut"))
        var data = Data(keywordLine.utf8)
        data.append(0x0A)
        let padCount = maxBytes - 2 - data.count
        XCTAssertGreaterThan(padCount, 0)
        data.append(Data(repeating: 0x41, count: padCount)) // 'A'
        data.append(Data([0xE4, 0xB8, 0xAD])) // 中 cut mid-scalar
        let url = tempDir.appendingPathComponent("cut.jsonl")
        try! data.write(to: url)
        XCTAssertGreaterThan(data.count, maxBytes)

        let hit = SessionSearch.scan(
            file: url,
            title: "Cut",
            query: "early-keyword-survives-cut",
            modified: nil
        )
        XCTAssertNotNil(hit)
        XCTAssertTrue(hit?.snippet?.contains("early-keyword-survives-cut") == true)
    }

    func testMalformedLinesSkipped() {
        let url = writeJSONL("malformed.jsonl", lines: [
            "not json at all {{{",
            sessionLine(role: "user", contentJSON: textParts("valid-line-with-marker-token")),
            #"{"type":"message","message":{"role":"user","content":[{"type":"text","text":"truncated""#,
            "",
            "{\"type\":\"custom_message\",\"customType\":\"pipiui-git-snapshot\",\"content\":[{\"type\":\"text\",\"text\":\"## Git\\nno token here\"}],\"display\":false}",
            "{invalid",
            // Valid JSON but no message key → skipped without failing the scan.
            #"{"type":"session","version":3,"id":"abc","timestamp":"2026-07-25T16:33:09.371Z","cwd":"/tmp"}"#,
        ])
        let hit = SessionSearch.scan(file: url, title: "Mal", query: "valid-line-with-marker-token", modified: nil)
        XCTAssertNotNil(hit)
        XCTAssertTrue(hit?.snippet?.contains("valid-line-with-marker-token") == true)
    }

    func testQueryWithQuoteMatchesDecodedText() {
        // The raw line stores the quote escaped as \" so the decoded text
        // contains 说"好" while the raw bytes only have 说\"好\" — the old
        // raw-text prefilter could never match this query.
        let content = "她说\"好\"吧"
        let url = writeJSONL("quote.jsonl", lines: [
            sessionLine(role: "user", contentJSON: textParts(content)),
        ])
        let hit = SessionSearch.scan(file: url, title: "Q", query: "说\"好\"", modified: nil)
        XCTAssertNotNil(hit)
        XCTAssertEqual(hit?.snippet, "她说\"好\"吧")
    }

    func testQueryWithNewlineMatchesDecodedText() {
        // Decoded text has a real newline; the raw line only carries the \n
        // escape, so a raw prefilter cannot see the query 行\n第二.
        let content = "第一行\n第二行"
        let url = writeJSONL("nl.jsonl", lines: [
            sessionLine(role: "user", contentJSON: textParts(content)),
        ])
        let hit = SessionSearch.scan(file: url, title: "NL", query: "行\n第二", modified: nil)
        XCTAssertNotNil(hit)
        XCTAssertTrue(hit?.snippet?.contains("第一行") == true)
    }

    func testLineCapRespected() {
        var lines: [String] = []
        for _ in 0..<1000 {
            lines.append(sessionLine(role: "user", contentJSON: textParts("filler no match here")))
        }
        lines.append(sessionLine(role: "user", contentJSON: textParts("beyond-line-cap-token")))
        let url = writeJSONL("linecap.jsonl", lines: lines)
        let hit = SessionSearch.scan(file: url, title: "Cap", query: "beyond-line-cap-token", modified: nil)
        XCTAssertNil(hit, "keyword on line 1001 must be beyond the 1000-line cap")

        var withEarly = lines
        withEarly.insert(sessionLine(role: "user", contentJSON: textParts("within-line-cap-token")), at: 500)
        let url2 = writeJSONL("linecap2.jsonl", lines: withEarly)
        let hit2 = SessionSearch.scan(file: url2, title: "Cap", query: "within-line-cap-token", modified: nil)
        XCTAssertNotNil(hit2)
    }

    func testByteCapRespected() {
        let maxBytes = 10 * 1024 * 1024
        let fillerLine = sessionLine(role: "user", contentJSON: textParts("filler"))
        let keywordLine = sessionLine(role: "user", contentJSON: textParts("beyond-byte-cap-token"))
        var data = Data()
        while data.count < maxBytes {
            data.append(Data(fillerLine.utf8))
            data.append(0x0A)
        }
        data.append(Data(keywordLine.utf8))
        data.append(0x0A)
        let url = tempDir.appendingPathComponent("bytecap.jsonl")
        try! data.write(to: url)

        let hit = SessionSearch.scan(file: url, title: "Byte", query: "beyond-byte-cap-token", modified: nil)
        XCTAssertNil(hit, "keyword beyond the 10MiB window must not be searched")
    }

    func testTieBreakerDeterministicByPath() {
        let same = Date(timeIntervalSince1970: 1_700_000_000)
        let a = writeJSONL("a.jsonl", lines: [
            sessionLine(role: "user", contentJSON: textParts("tie-token-aaa")),
        ])
        let z = writeJSONL("z.jsonl", lines: [
            sessionLine(role: "user", contentJSON: textParts("tie-token-zzz")),
        ])
        let hits = SessionSearch.search(
            metas: [
                meta(path: z.path, name: "Z", modified: same),
                meta(path: a.path, name: "A", modified: same),
            ],
            archived: [],
            query: "tie-token",
            liveEntries: []
        )
        XCTAssertEqual(hits.count, 2)
        XCTAssertEqual(hits[0].path, a.path, "equal-modified body hits must break ties by path ascending")
        XCTAssertEqual(hits[1].path, z.path)
    }
}
