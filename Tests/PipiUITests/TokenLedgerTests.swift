import XCTest
@testable import PipiUI

final class TokenLedgerTests: XCTestCase {
    /// Shared queue forces synchronous ordering so assertions can read the file right after.
    private func makeLedger(in dir: URL) -> TokenLedger {
        TokenLedger(
            baseDirectory: dir,
            queue: DispatchQueue(label: "test.token-ledger.\(UUID().uuidString)")
        )
    }

    private func readLines(at url: URL) -> [[String: Any]] {
        guard let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .utf8) else {
            return []
        }
        return text.split(separator: "\n").compactMap { line in
            guard let d = line.data(using: .utf8) else { return nil }
            return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
        }
    }

    func testAppendWritesCompleteRecordAsJSONL() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-ledger-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let ledger = makeLedger(in: dir)
        let usage = TokenLedger.UsageSnapshot(
            input: 1234, output: 567, cacheRead: 100, cacheWrite: 890,
            cost: 0.0123, contextTokens: 12345
        )
        ledger.append(
            session: "sess-A", channel: "main", agentId: nil, agentName: nil,
            depth: 0, model: "xai/grok-4.5:high", turn: 3, usage: usage
        )
        ledger.flushSync()

        let lines = readLines(at: ledger.fileURL)
        XCTAssertEqual(lines.count, 1, "exactly one JSONL line per append")
        let rec = try XCTUnwrap(lines.first)
        XCTAssertEqual(rec["session"] as? String, "sess-A")
        XCTAssertEqual(rec["channel"] as? String, "main")
        XCTAssertEqual(rec["depth"] as? Int, 0)
        XCTAssertEqual(rec["model"] as? String, "xai/grok-4.5:high")
        XCTAssertEqual(rec["turn"] as? Int, 3)
        XCTAssertEqual(rec["input"] as? Int, 1234)
        XCTAssertEqual(rec["output"] as? Int, 567)
        XCTAssertEqual(rec["cacheRead"] as? Int, 100)
        XCTAssertEqual(rec["cacheWrite"] as? Int, 890)
        // NSNumber bridges ambiguously; unwrap via NSNumber.doubleValue.
        let cost = try XCTUnwrap((rec["cost"] as? NSNumber)?.doubleValue)
        XCTAssertEqual(cost, 0.0123, accuracy: 1e-9)
        XCTAssertEqual(rec["contextTokens"] as? Int, 12345)
        XCTAssertNotNil(rec["ts"] as? String, "timestamp always present")
        XCTAssertNil(rec["agentId"], "null fields stripped to keep lines compact")
        XCTAssertNil(rec["agentName"])
    }

    func testMultipleAppendsEachGetOwnLine() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-ledger-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let ledger = makeLedger(in: dir)
        for turn in 1...5 {
            ledger.append(
                session: "s", channel: "subagent", agentId: "a-\(turn)", agentName: "explore",
                depth: 1, model: "xai/grok-4.5:high", turn: turn,
                usage: TokenLedger.UsageSnapshot(input: turn * 10, output: turn)
            )
        }
        ledger.flushSync()

        let lines = readLines(at: ledger.fileURL)
        XCTAssertEqual(lines.count, 5)
        XCTAssertEqual(lines.last?["turn"] as? Int, 5)
        XCTAssertEqual(lines.last?["agentId"] as? String, "a-5")
    }

    func testUsageSnapshotFromParsesAllFields() {
        // Full usage object as pi emits it (cost nested under "total").
        let full: [String: Any] = [
            "input": 100, "output": 50, "cacheRead": 30, "cacheWrite": 70,
            "cost": ["total": 0.5], "totalTokens": 9999,
        ]
        let u = TokenLedger.UsageSnapshot.from(J(full))
        XCTAssertEqual(u.input, 100)
        XCTAssertEqual(u.output, 50)
        XCTAssertEqual(u.cacheRead, 30)
        XCTAssertEqual(u.cacheWrite, 70)
        XCTAssertEqual(u.cost, 0.5, accuracy: 1e-9)
        XCTAssertEqual(u.contextTokens, 9999)
    }

    func testUsageSnapshotFromDefaultsMissingFieldsToZero() {
        // Sparse object — only input present; everything else must default, never crash.
        let sparse: [String: Any] = ["input": 42]
        let u = TokenLedger.UsageSnapshot.from(J(sparse))
        XCTAssertEqual(u.input, 42)
        XCTAssertEqual(u.output, 0)
        XCTAssertEqual(u.cacheRead, 0)
        XCTAssertEqual(u.cacheWrite, 0)
        XCTAssertEqual(u.cost, 0)
        XCTAssertEqual(u.contextTokens, 0)
    }

    func testUsageSnapshotFromNilObjectIsAllZero() {
        let u = TokenLedger.UsageSnapshot.from(J(nil))
        XCTAssertEqual(u.input, 0)
        XCTAssertEqual(u.cost, 0)
    }

    func testRollsWhenExceedingThreshold() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-ledger-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        // Tiny cap (1KB) so a handful of fat records triggers a roll without writing 50MB.
        let ledger = TokenLedger(
            baseDirectory: dir,
            queue: DispatchQueue(label: "test.token-ledger.roll.\(UUID().uuidString)"),
            rollThresholdBytes: 1024
        )
        let fat = String(repeating: "x", count: 400) // ~600-byte record → 2 records exceed 1KB
        for turn in 1...5 {
            ledger.append(
                session: "s", channel: "main", agentId: nil, agentName: fat,
                depth: 0, model: "m", turn: turn,
                usage: TokenLedger.UsageSnapshot(input: 1)
            )
        }
        ledger.flushSync()

        // After rolling, the backup `.1` exists and holds the pre-roll content; the active
        // file holds only the records written after the roll.
        let rolledURL = URL(fileURLWithPath: ledger.fileURL.path + TokenLedger.rolledSuffix)
        XCTAssertTrue(FileManager.default.fileExists(atPath: rolledURL.path), "rolled backup should exist after crossing threshold")
        let rolledLines = readLines(at: rolledURL)
        XCTAssertGreaterThan(rolledLines.count, 0, "rolled backup must contain the pre-roll records")
        let activeLines = readLines(at: ledger.fileURL)
        XCTAssertGreaterThan(activeLines.count, 0, "active file must contain post-roll records")
        XCTAssertLessThan(activeLines.count, rolledLines.count + activeLines.count, "total grew monotonically")
    }

    func testRollReplacesPreviousBackup() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-ledger-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let ledger = TokenLedger(
            baseDirectory: dir,
            queue: DispatchQueue(label: "test.token-ledger.roll2.\(UUID().uuidString)"),
            rollThresholdBytes: 512
        )
        let fat = String(repeating: "y", count: 300)
        // Write enough to roll at least twice; only one `.1` should survive.
        for turn in 1...10 {
            ledger.append(
                session: "s", channel: "main", agentId: nil, agentName: fat,
                depth: 0, model: "m", turn: turn,
                usage: TokenLedger.UsageSnapshot(input: 1)
            )
        }
        ledger.flushSync()

        let rolledURL = URL(fileURLWithPath: ledger.fileURL.path + TokenLedger.rolledSuffix)
        XCTAssertTrue(FileManager.default.fileExists(atPath: rolledURL.path))
        // No `.2` — single-backup contract.
        let rolled2URL = URL(fileURLWithPath: ledger.fileURL.path + ".2")
        XCTAssertFalse(FileManager.default.fileExists(atPath: rolled2URL.path))
    }
}
