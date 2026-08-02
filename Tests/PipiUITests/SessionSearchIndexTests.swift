import XCTest
import SQLite3
@testable import PipiUI

final class SessionSearchIndexTests: XCTestCase {
    private var tempDirectory: URL!
    private var databaseURL: URL!

    override func setUpWithError() throws {
        tempDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("SessionSearchIndexTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true)
        databaseURL = tempDirectory.appendingPathComponent("search.sqlite3")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: tempDirectory)
        tempDirectory = nil
        databaseURL = nil
    }

    func testIndexesLatinCJKAndVisibleMessageMetadata() async throws {
        let file = tempDirectory.appendingPathComponent("mixed.jsonl")
        try write([
            message(id: "u-1", role: "user", text: "Please inspect AlphaNeedle in this file"),
            assistantWithThinking(id: "a-1", thinking: "private-secret-needle", text: "AlphaNeedle 的材料表征结论"),
        ], to: file)
        let index = SessionSearchIndex(databaseURL: databaseURL)
        try await index.synchronize(sources: [source(file: file, title: "Microscopy notes")])

        let latin = try await index.search(query: "AlphaNeedle")
        XCTAssertEqual(Set(latin.compactMap(\.messageID)), Set(["u-1", "a-1"]))
        XCTAssertEqual(latin.first(where: { $0.messageID == "u-1" })?.role, "user")
        XCTAssertEqual(latin.first?.projectPath, "/projects/alpha")
        XCTAssertNotNil(latin.first?.messageLineOffset)
        XCTAssertNotNil(latin.first?.messageTimestamp)
        XCTAssertTrue(latin.allSatisfy { $0.snippet?.contains("AlphaNeedle") == true })

        let cjk = try await index.search(query: "材料表征")
        XCTAssertEqual(cjk.count, 1)
        XCTAssertEqual(cjk[0].messageID, "a-1")
        XCTAssertEqual(cjk[0].role, "assistant")

        let shortCJK = try await index.search(query: "材料")
        XCTAssertEqual(shortCJK.map(\.messageID), ["a-1"], "one/two-character CJK uses the bounded LIKE fallback")

        let hiddenThinking = try await index.search(query: "private-secret-needle")
        XCTAssertTrue(hiddenThinking.isEmpty, "thinking parts must not enter the visible-message index")
    }

    func testPartialTrailingLineIsDeferredThenIndexedOnAppend() async throws {
        let file = tempDirectory.appendingPathComponent("partial.jsonl")
        let first = message(id: "first", role: "user", text: "already complete") + "\n"
        let second = message(id: "second", role: "assistant", text: "partial-append-token")
        try Data((first + String(second.prefix(second.count / 2))).utf8).write(to: file)
        let index = SessionSearchIndex(databaseURL: databaseURL)
        let sourceBefore = source(file: file, title: "Partial")
        try await index.synchronize(sources: [sourceBefore])
        let beforeAppend = try await index.search(query: "partial-append-token")
        XCTAssertTrue(beforeAppend.isEmpty)

        let handle = try FileHandle(forWritingTo: file)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data((String(second.dropFirst(second.count / 2)) + "\n").utf8))
        try handle.close()
        try await index.synchronize(sources: [source(file: file, title: "Partial")])
        let hits = try await index.search(query: "partial-append-token")
        XCTAssertEqual(hits.map(\.messageID), ["second"])
    }

    func testRewriteRemovesOldRowsAndIndexesReplacement() async throws {
        let file = tempDirectory.appendingPathComponent("rewrite.jsonl")
        try write([message(id: "old", role: "user", text: "old-rewrite-token")], to: file)
        let index = SessionSearchIndex(databaseURL: databaseURL)
        try await index.synchronize(sources: [source(file: file, title: "Rewrite")])
        let beforeRewrite = try await index.search(query: "old-rewrite-token")
        XCTAssertEqual(beforeRewrite.count, 1)

        try write([message(id: "new", role: "assistant", text: "new-rewrite-token")], to: file)
        try await index.synchronize(sources: [source(file: file, title: "Rewrite")])
        let oldAfterRewrite = try await index.search(query: "old-rewrite-token")
        let newAfterRewrite = try await index.search(query: "new-rewrite-token")
        XCTAssertTrue(oldAfterRewrite.isEmpty)
        XCTAssertEqual(newAfterRewrite.map(\.messageID), ["new"])
    }

    func testSameInodeGrowingRewriteRejectsAppendAndRebuilds() async throws {
        let file = tempDirectory.appendingPathComponent("in-place-rewrite.jsonl")
        try write([message(id: "stale", role: "user", text: "stale-in-place-token")], to: file)
        let originalAttributes = try FileManager.default.attributesOfItem(atPath: file.path)
        let originalInode = (originalAttributes[.systemFileNumber] as? NSNumber)?.uint64Value
        let originalSize = (originalAttributes[.size] as? NSNumber)?.uint64Value ?? 0
        let index = SessionSearchIndex(databaseURL: databaseURL)
        try await index.synchronize(sources: [source(file: file, title: "In place")])

        let replacementLines = (0..<20).map {
            message(id: "replacement-\($0)", role: "assistant", text: "new-in-place-token row \($0)")
        }
        let replacement = Data((replacementLines.joined(separator: "\n") + "\n").utf8)
        let handle = try FileHandle(forWritingTo: file)
        try handle.truncate(atOffset: 0)
        try handle.write(contentsOf: replacement)
        try handle.close()

        let rewrittenAttributes = try FileManager.default.attributesOfItem(atPath: file.path)
        let rewrittenInode = (rewrittenAttributes[.systemFileNumber] as? NSNumber)?.uint64Value
        let rewrittenSize = (rewrittenAttributes[.size] as? NSNumber)?.uint64Value ?? 0
        XCTAssertEqual(rewrittenInode, originalInode, "FileHandle truncate/write must preserve inode for this regression")
        XCTAssertGreaterThan(rewrittenSize, originalSize)

        try await index.synchronize(sources: [source(file: file, title: "In place")])
        let stale = try await index.search(query: "stale-in-place-token")
        let replacementHits = try await index.search(query: "new-in-place-token")
        XCTAssertTrue(stale.isEmpty, "a growing in-place rewrite must not retain rows from the previous prefix")
        XCTAssertEqual(replacementHits.count, replacementLines.count)
        XCTAssertEqual(Set(replacementHits.compactMap(\.messageID)), Set((0..<20).map { "replacement-\($0)" }))
    }

    func testArchiveScopeMetadataAndDeletionLifecycle() async throws {
        let alpha = tempDirectory.appendingPathComponent("alpha.jsonl")
        let beta = tempDirectory.appendingPathComponent("beta.jsonl")
        try write([message(id: "alpha-message", role: "user", text: "shared-lifecycle-token")], to: alpha)
        try write([message(id: "beta-message", role: "assistant", text: "shared-lifecycle-token")], to: beta)
        let index = SessionSearchIndex(databaseURL: databaseURL)
        let alphaSource = source(file: alpha, title: "Alpha title", archived: true)
        let betaSource = SessionSearchSource(
            projectPath: "/projects/beta",
            projectName: "Beta Project",
            sessionPath: beta.path,
            title: "Beta title",
            modified: Date(timeIntervalSince1970: 200),
            isArchived: false
        )
        try await index.synchronize(sources: [alphaSource, betaSource])

        let scoped = try await index.search(query: "shared-lifecycle-token", projectPath: "/projects/alpha")
        XCTAssertEqual(scoped.map(\.messageID), ["alpha-message"])
        XCTAssertTrue(scoped[0].isArchived)
        let metadata = try await index.search(query: "Beta Project")
        XCTAssertEqual(metadata.first?.path, beta.path)

        let movedAlpha = SessionSearchSource(
            projectPath: "/projects/gamma",
            projectName: "Gamma Project",
            sessionPath: alpha.path,
            title: "Alpha title",
            modified: alphaSource.modified,
            isArchived: false
        )
        try await index.synchronize(sources: [movedAlpha, betaSource])
        let oldProjectAfterMove = try await index.search(query: "shared-lifecycle-token", projectPath: "/projects/alpha")
        let newProjectAfterMove = try await index.search(query: "shared-lifecycle-token", projectPath: "/projects/gamma")
        XCTAssertTrue(oldProjectAfterMove.isEmpty)
        XCTAssertEqual(newProjectAfterMove.map(\.messageID), ["alpha-message"])
        XCTAssertFalse(newProjectAfterMove[0].isArchived)

        try await index.synchronize(sources: [betaSource])
        let deletedScope = try await index.search(query: "shared-lifecycle-token", projectPath: "/projects/alpha")
        let remaining = try await index.search(query: "shared-lifecycle-token")
        XCTAssertTrue(deletedScope.isEmpty)
        XCTAssertEqual(remaining.map(\.messageID), ["beta-message"])
    }

    func testCorruptDatabaseIsDiscardedAndRebuilt() async throws {
        try Data("not-a-sqlite-database".utf8).write(to: databaseURL)
        let file = tempDirectory.appendingPathComponent("recovery.jsonl")
        try write([message(id: "recovered", role: "user", text: "recovery-index-token")], to: file)
        let index = SessionSearchIndex(databaseURL: databaseURL)
        try await index.synchronize(sources: [source(file: file, title: "Recovery")])
        let recovered = try await index.search(query: "recovery-index-token")
        XCTAssertEqual(recovered.map(\.messageID), ["recovered"])
    }

    func testSchemaMismatchIsDiscardedAndRebuilt() async throws {
        let seed = SessionSearchIndex(databaseURL: databaseURL)
        try await seed.rebuild()
        try setUserVersion(999, at: databaseURL)
        let file = tempDirectory.appendingPathComponent("schema.jsonl")
        try write([message(id: "schema-ok", role: "user", text: "schema-rebuild-token")], to: file)

        let reopened = SessionSearchIndex(databaseURL: databaseURL)
        try await reopened.synchronize(sources: [source(file: file, title: "Schema")])
        let hits = try await reopened.search(query: "schema-rebuild-token")
        XCTAssertEqual(hits.map(\.messageID), ["schema-ok"])
    }

    func testIndexesPastLegacyThousandLineLimit() async throws {
        let file = tempDirectory.appendingPathComponent("uncapped.jsonl")
        var lines = (0..<1_050).map { message(id: "filler-\($0)", role: "user", text: "ordinary filler \($0)") }
        lines.append(message(id: "late-hit", role: "assistant", text: "beyond-legacy-line-cap-token"))
        try write(lines, to: file)
        let index = SessionSearchIndex(databaseURL: databaseURL)
        try await index.synchronize(sources: [source(file: file, title: "Uncapped")])
        let hits = try await index.search(query: "beyond-legacy-line-cap-token")
        XCTAssertEqual(hits.map(\.messageID), ["late-hit"])
    }

    // MARK: - Fixtures

    private func source(file: URL, title: String, archived: Bool = false) -> SessionSearchSource {
        SessionSearchSource(
            projectPath: "/projects/alpha",
            projectName: "Alpha Project",
            sessionPath: file.path,
            title: title,
            modified: Date(timeIntervalSince1970: 100),
            isArchived: archived
        )
    }

    private func write(_ lines: [String], to url: URL) throws {
        try Data((lines.joined(separator: "\n") + "\n").utf8).write(to: url, options: .atomic)
    }

    private func message(id: String, role: String, text: String) -> String {
        let escaped = text
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return """
        {"type":"message","id":"\(id)","timestamp":"2026-08-01T12:00:00.000Z","message":{"role":"\(role)","content":[{"type":"text","text":"\(escaped)"}],"timestamp":1785585600000}}
        """
    }

    private func assistantWithThinking(id: String, thinking: String, text: String) -> String {
        """
        {"type":"message","id":"\(id)","message":{"role":"assistant","content":[{"type":"thinking","thinking":"\(thinking)"},{"type":"text","text":"\(text)"}],"timestamp":1785585601000}}
        """
    }

    private func setUserVersion(_ version: Int, at url: URL) throws {
        var database: OpaquePointer?
        XCTAssertEqual(sqlite3_open(url.path, &database), SQLITE_OK)
        guard let database else { return XCTFail("failed to open test database") }
        defer { sqlite3_close(database) }
        XCTAssertEqual(sqlite3_exec(database, "PRAGMA user_version=\(version)", nil, nil, nil), SQLITE_OK)
    }
}
