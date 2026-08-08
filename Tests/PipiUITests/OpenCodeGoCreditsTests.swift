import XCTest
import SQLite3
@testable import PipiUI

/// OpenCode Go local usage: routing, auth parse, window math, SQLite read.
final class OpenCodeGoCreditsTests: XCTestCase {

    // MARK: - Provider routing / labels

    func testQuotaProviderRoutesOpencodeGoOnly() {
        XCTAssertEqual(
            ModelInfo(provider: "opencode-go", modelId: "gpt-5.6-luna", name: "Luna", contextWindow: nil).quotaProvider,
            .opencodeGo
        )
        XCTAssertEqual(
            ModelInfo(provider: "opencode-go-cn", modelId: "glm-5.2", name: "GLM", contextWindow: nil).quotaProvider,
            .opencodeGo
        )
        // Bare Zen pay-as-you-go must NOT bind Go windows.
        XCTAssertNil(
            ModelInfo(provider: "opencode", modelId: "big-pickle", name: "Zen", contextWindow: nil).quotaProvider
        )
        XCTAssertNil(
            ModelInfo(provider: "opencode-relay", modelId: "x", name: "x", contextWindow: nil).quotaProvider
        )
        XCTAssertTrue(
            ModelInfo(provider: "opencode-go", modelId: "m", name: "m", contextWindow: nil).shouldShowAccountQuota
        )
    }

    func testAccountLabelIsLocalNotOfficialBalance() {
        let label = QuotaProvider.opencodeGo.accountLabel
        XCTAssertEqual(label, "OpenCode Go 本机用量")
        XCTAssertFalse(label.contains("账号额度"))
        XCTAssertFalse(label.lowercased().contains("balance"))
        XCTAssertTrue(QuotaProvider.opencodeGo.monitor === OpenCodeGoQuotaMonitor.shared)
    }

    // MARK: - Auth parse

    func testParseAuthKeyFromOpenCodeAuthJSON() {
        let data = Data(#"{"opencode-go":{"type":"api-key","key":"go-key-1"}}"#.utf8)
        XCTAssertEqual(OpenCodeGoAuthStore.parseAuthKey(data: data), "go-key-1")
    }

    func testParseAuthKeyRejectsEmptyAndMissing() {
        XCTAssertNil(OpenCodeGoAuthStore.parseAuthKey(data: Data(#"{"opencode-go":{"type":"api-key","key":"  "}}"#.utf8)))
        XCTAssertNil(OpenCodeGoAuthStore.parseAuthKey(data: Data(#"{"xai":{"access":"t"}}"#.utf8)))
        XCTAssertNil(OpenCodeGoAuthStore.parseAuthKey(data: Data("not-json".utf8)))
    }

    func testHasCredentialFromEnvWithoutAuthFile() throws {
        let envRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("OpenCodeGoAuth-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: envRoot) }
        try FileManager.default.createDirectory(at: envRoot, withIntermediateDirectories: true)
        let missingAuth = envRoot.appendingPathComponent("auth.json")

        XCTAssertTrue(
            OpenCodeGoAuthStore.hasCredential(
                authURL: missingAuth,
                env: ["OPENCODE_API_KEY": "sk-test"],
                envFileValues: { [:] }
            )
        )
        XCTAssertTrue(
            OpenCodeGoAuthStore.hasCredential(
                authURL: missingAuth,
                env: [:],
                envFileValues: { ["OPENCODE_API_KEY": "dotenv-key"] }
            )
        )
        XCTAssertFalse(
            OpenCodeGoAuthStore.hasCredential(
                authURL: missingAuth,
                env: [:],
                envFileValues: { [:] }
            )
        )
    }

    // MARK: - Pure window math

    func testPercentOneDecimalClamped() {
        XCTAssertEqual(OpenCodeGoLocalUsage.percent(used: 3, limit: 12), 25, accuracy: 0.001)
        XCTAssertEqual(OpenCodeGoLocalUsage.percent(used: 11, limit: 60), 18.3, accuracy: 0.001)
        XCTAssertEqual(OpenCodeGoLocalUsage.percent(used: -1, limit: 12), 0, accuracy: 0.001)
        XCTAssertEqual(OpenCodeGoLocalUsage.percent(used: 100, limit: 12), 100, accuracy: 0.001)
        XCTAssertEqual(OpenCodeGoLocalUsage.percent(used: 1, limit: 0), 0, accuracy: 0.001)
    }

    /// Port of CodexBar fixture: now = 2026-03-06T12:00:00Z (epoch 1_772_798_400).
    func testSnapshotFiveHourWeekMonthWindows() throws {
        // 2026-03-06T12:00:00Z
        let now = Date(timeIntervalSince1970: 1_772_798_400)
        let rows = [
            OpenCodeGoUsageRow(createdMs: ms("2026-03-06T11:00:00.000Z"), cost: 3.0),  // in 5h
            OpenCodeGoUsageRow(createdMs: ms("2026-03-05T12:00:00.000Z"), cost: 6.0),  // week, not 5h
            OpenCodeGoUsageRow(createdMs: ms("2026-02-25T07:53:16.000Z"), cost: 2.0),  // month only
        ]
        let snap = OpenCodeGoLocalUsage.snapshot(rows: rows, now: now)
        XCTAssertEqual(snap.windows.map(\.id), ["fiveHour", "weekly", "monthly"])

        let five = try XCTUnwrap(snap.windows.first { $0.id == "fiveHour" })
        XCTAssertEqual(five.usedPercent, 25, accuracy: 0.001) // 3/12
        XCTAssertEqual(five.label, "5h")
        XCTAssertEqual(five.title, "5小时本机用量")
        // oldest in session at 11:00 → reset in 4h = 14400s
        let fiveReset = try XCTUnwrap(five.resetsAt)
        XCTAssertEqual(fiveReset.timeIntervalSince(now), 14_400, accuracy: 1)

        let weekly = try XCTUnwrap(snap.windows.first { $0.id == "weekly" })
        XCTAssertEqual(weekly.usedPercent, 30, accuracy: 0.001) // (3+6)/30
        XCTAssertEqual(weekly.label, "周")
        XCTAssertEqual(weekly.title, "周本机用量")

        let monthly = try XCTUnwrap(snap.windows.first { $0.id == "monthly" })
        XCTAssertEqual(monthly.usedPercent, 18.3, accuracy: 0.001) // 11/60
        XCTAssertEqual(monthly.label, "月")
        XCTAssertEqual(monthly.title, "月本机用量")

        // Default capsule = highest used% (weekly 30).
        XCTAssertEqual(snap.capsule?.id, "weekly")
        XCTAssertEqual(snap.capsule?.usedPercent ?? -1, 30, accuracy: 0.001)

        // Remaining percent for UI consumers that invert used.
        let remaining = 100 - (snap.capsule?.usedPercent ?? 0)
        XCTAssertEqual(remaining, 70, accuracy: 0.001)
    }

    func testEmptyRowsYieldZeroLocalUsage() {
        let now = Date(timeIntervalSince1970: 1_772_798_400)
        let snap = OpenCodeGoLocalUsage.snapshot(rows: [], now: now)
        XCTAssertEqual(snap.windows.count, 3)
        XCTAssertTrue(snap.windows.allSatisfy { $0.usedPercent == 0 })
    }

    func testMonthlyWindowKeepsAnchorAfterShorterMonthClamp() throws {
        // Anchor 2026-01-31; now 2026-03-29T12:00Z — month window still anchored to day 31.
        let now = Date(timeIntervalSince1970: TimeInterval(ms("2026-03-29T12:00:00.000Z")) / 1000)
        let rows = [
            OpenCodeGoUsageRow(createdMs: ms("2026-01-31T00:00:00.000Z"), cost: 1.0),
            OpenCodeGoUsageRow(createdMs: ms("2026-03-29T10:00:00.000Z"), cost: 6.0),
        ]
        let snap = OpenCodeGoLocalUsage.snapshot(rows: rows, now: now)
        let monthly = try XCTUnwrap(snap.windows.first { $0.id == "monthly" })
        // Only the $6 event falls in the current anchored month → 10%.
        XCTAssertEqual(monthly.usedPercent, 10, accuracy: 0.001)
        let reset = try XCTUnwrap(monthly.resetsAt)
        XCTAssertEqual(reset.timeIntervalSince(now), 129_600, accuracy: 1)
    }

    // MARK: - SQLite integration

    func testReadRowsPrefersStepFinishParts() throws {
        let env = try makeEnvironment()
        defer { try? FileManager.default.removeItem(at: env.root) }

        try writeAuth(to: env.authURL)
        try createDatabase(at: env.databaseURL)
        let messageID = try insertMessage(
            databaseURL: env.databaseURL,
            createdMs: ms("2026-03-06T11:00:00.000Z"),
            cost: nil
        )
        try insertStepFinishPart(
            databaseURL: env.databaseURL,
            messageID: messageID,
            createdMs: ms("2026-03-06T11:00:00.000Z"),
            cost: 3.0
        )

        let rows = try OpenCodeGoLocalUsage.readRows(databaseURL: env.databaseURL)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].cost, 3.0, accuracy: 1e-9)

        let snap = try XCTUnwrap(
            OpenCodeGoLocalUsage.fetchSnapshot(
                now: Date(timeIntervalSince1970: 1_772_798_400),
                authURL: env.authURL,
                databaseURL: env.databaseURL,
                env: [:],
                envFileValues: { [:] }
            )
        )
        let five = try XCTUnwrap(snap.windows.first { $0.id == "fiveHour" })
        XCTAssertEqual(five.usedPercent, 25, accuracy: 0.001)
        let weekly = try XCTUnwrap(snap.windows.first { $0.id == "weekly" })
        XCTAssertEqual(weekly.usedPercent, 10, accuracy: 0.001)
        let monthly = try XCTUnwrap(snap.windows.first { $0.id == "monthly" })
        XCTAssertEqual(monthly.usedPercent, 5, accuracy: 0.001)
    }

    func testReadRowsFallsBackToMessageCostWithoutParts() throws {
        let env = try makeEnvironment()
        defer { try? FileManager.default.removeItem(at: env.root) }

        try writeAuth(to: env.authURL)
        try createDatabase(at: env.databaseURL)
        try insertMessage(
            databaseURL: env.databaseURL,
            createdMs: ms("2026-03-06T11:00:00.000Z"),
            cost: 3.0
        )
        // Non-go provider must be ignored.
        try insertMessage(
            databaseURL: env.databaseURL,
            createdMs: ms("2026-03-06T11:30:00.000Z"),
            cost: 99.0,
            providerID: "xai"
        )

        let rows = try OpenCodeGoLocalUsage.readRows(databaseURL: env.databaseURL)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].cost, 3.0, accuracy: 1e-9)
    }

    func testFetchSnapshotNilWhenDatabaseMissing() throws {
        let env = try makeEnvironment()
        defer { try? FileManager.default.removeItem(at: env.root) }
        try writeAuth(to: env.authURL)

        let snap = try OpenCodeGoLocalUsage.fetchSnapshot(
            now: Date(),
            authURL: env.authURL,
            databaseURL: env.databaseURL,
            env: ["OPENCODE_API_KEY": "x"],
            envFileValues: { [:] }
        )
        XCTAssertNil(snap)
    }

    func testFetchSnapshotNilWithoutCredentialOrRows() throws {
        let env = try makeEnvironment()
        defer { try? FileManager.default.removeItem(at: env.root) }
        try createDatabase(at: env.databaseURL)

        let snap = try OpenCodeGoLocalUsage.fetchSnapshot(
            now: Date(),
            authURL: env.authURL,
            databaseURL: env.databaseURL,
            env: [:],
            envFileValues: { [:] }
        )
        XCTAssertNil(snap)
    }

    func testFetchSnapshotZeroWindowsWhenCredPresentButNoRows() throws {
        let env = try makeEnvironment()
        defer { try? FileManager.default.removeItem(at: env.root) }
        try writeAuth(to: env.authURL)
        try createDatabase(at: env.databaseURL)

        let snap = try XCTUnwrap(
            OpenCodeGoLocalUsage.fetchSnapshot(
                now: Date(timeIntervalSince1970: 1_772_798_400),
                authURL: env.authURL,
                databaseURL: env.databaseURL,
                env: [:],
                envFileValues: { [:] }
            )
        )
        XCTAssertEqual(snap.windows.count, 3)
        XCTAssertTrue(snap.windows.allSatisfy { $0.usedPercent == 0 })
    }

    func testIgnoresMessageCostWhenStepFinishPartsExist() throws {
        let env = try makeEnvironment()
        defer { try? FileManager.default.removeItem(at: env.root) }
        try writeAuth(to: env.authURL)
        try createDatabase(at: env.databaseURL)
        let messageID = try insertMessage(
            databaseURL: env.databaseURL,
            createdMs: ms("2026-03-06T11:00:00.000Z"),
            cost: 3.0
        )
        try insertStepFinishPart(
            databaseURL: env.databaseURL,
            messageID: messageID,
            createdMs: ms("2026-03-06T11:00:00.000Z"),
            cost: 1.0
        )
        try insertStepFinishPart(
            databaseURL: env.databaseURL,
            messageID: messageID,
            createdMs: ms("2026-03-06T11:05:00.000Z"),
            cost: 2.0
        )

        let rows = try OpenCodeGoLocalUsage.readRows(databaseURL: env.databaseURL)
        // Parts only (1+2); message cost excluded to avoid double count.
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows.map(\.cost).reduce(0, +), 3.0, accuracy: 1e-9)

        let snap = OpenCodeGoLocalUsage.snapshot(
            rows: rows,
            now: Date(timeIntervalSince1970: 1_772_798_400)
        )
        XCTAssertEqual(snap.windows.first { $0.id == "fiveHour" }?.usedPercent ?? -1, 25, accuracy: 0.001)
    }

    // MARK: - Fixtures

    private func makeEnvironment() throws -> (root: URL, authURL: URL, databaseURL: URL) {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("OpenCodeGoCreditsTests-\(UUID().uuidString)", isDirectory: true)
        let directory = root
            .appendingPathComponent(".local/share/opencode", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return (
            root,
            directory.appendingPathComponent("auth.json"),
            directory.appendingPathComponent("opencode.db")
        )
    }

    private func writeAuth(to url: URL) throws {
        try Data(#"{"opencode-go":{"type":"api-key","key":"go-key"}}"#.utf8).write(to: url)
    }

    private func createDatabase(at url: URL) throws {
        var db: OpaquePointer?
        guard sqlite3_open(url.path, &db) == SQLITE_OK else {
            XCTFail("sqlite open failed"); return
        }
        defer { sqlite3_close(db) }
        try exec(
            db: db,
            sql: """
                CREATE TABLE message (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL,
                  data TEXT NOT NULL,
                  time_created INTEGER,
                  time_updated INTEGER
                );
                CREATE TABLE part (
                  id TEXT PRIMARY KEY,
                  message_id TEXT NOT NULL,
                  session_id TEXT NOT NULL,
                  data TEXT NOT NULL,
                  time_created INTEGER,
                  time_updated INTEGER
                );
            """
        )
    }

    @discardableResult
    private func insertMessage(
        databaseURL: URL,
        createdMs: Int64,
        cost: Double?,
        providerID: String = "opencode-go"
    ) throws -> String {
        var db: OpaquePointer?
        guard sqlite3_open(databaseURL.path, &db) == SQLITE_OK else {
            throw NSError(domain: "OpenCodeGoCreditsTests", code: 1)
        }
        defer { sqlite3_close(db) }

        let messageID = UUID().uuidString
        var payload: [String: Any] = [
            "providerID": providerID,
            "role": "assistant",
            "time": ["created": createdMs],
        ]
        if let cost { payload["cost"] = cost }
        let data = try JSONSerialization.data(withJSONObject: payload)
        let json = String(data: data, encoding: .utf8) ?? "{}"

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(
            db,
            "INSERT INTO message (id, session_id, data, time_created, time_updated) VALUES (?, ?, ?, ?, ?)",
            -1,
            &stmt,
            nil
        ) == SQLITE_OK else {
            throw NSError(domain: "OpenCodeGoCreditsTests", code: 2)
        }
        defer { sqlite3_finalize(stmt) }

        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        sqlite3_bind_text(stmt, 1, messageID, -1, transient)
        sqlite3_bind_text(stmt, 2, "session-1", -1, transient)
        sqlite3_bind_text(stmt, 3, json, -1, transient)
        sqlite3_bind_int64(stmt, 4, createdMs)
        sqlite3_bind_int64(stmt, 5, createdMs)
        guard sqlite3_step(stmt) == SQLITE_DONE else {
            throw NSError(domain: "OpenCodeGoCreditsTests", code: 3)
        }
        return messageID
    }

    private func insertStepFinishPart(
        databaseURL: URL,
        messageID: String,
        createdMs: Int64,
        cost: Double
    ) throws {
        var db: OpaquePointer?
        guard sqlite3_open(databaseURL.path, &db) == SQLITE_OK else {
            throw NSError(domain: "OpenCodeGoCreditsTests", code: 4)
        }
        defer { sqlite3_close(db) }

        let payload: [String: Any] = [
            "type": "step-finish",
            "cost": cost,
            "tokens": ["input": 1, "output": 1, "total": 2],
        ]
        let data = try JSONSerialization.data(withJSONObject: payload)
        let json = String(data: data, encoding: .utf8) ?? "{}"

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(
            db,
            "INSERT INTO part (id, message_id, session_id, data, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)",
            -1,
            &stmt,
            nil
        ) == SQLITE_OK else {
            throw NSError(domain: "OpenCodeGoCreditsTests", code: 5)
        }
        defer { sqlite3_finalize(stmt) }

        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        sqlite3_bind_text(stmt, 1, UUID().uuidString, -1, transient)
        sqlite3_bind_text(stmt, 2, messageID, -1, transient)
        sqlite3_bind_text(stmt, 3, "session-1", -1, transient)
        sqlite3_bind_text(stmt, 4, json, -1, transient)
        sqlite3_bind_int64(stmt, 5, createdMs)
        sqlite3_bind_int64(stmt, 6, createdMs)
        guard sqlite3_step(stmt) == SQLITE_DONE else {
            throw NSError(domain: "OpenCodeGoCreditsTests", code: 6)
        }
    }

    private func exec(db: OpaquePointer?, sql: String) throws {
        var message: UnsafeMutablePointer<CChar>?
        guard sqlite3_exec(db, sql, nil, nil, &message) == SQLITE_OK else {
            let detail = message.map { String(cString: $0) } ?? "exec failed"
            sqlite3_free(message)
            throw NSError(domain: "OpenCodeGoCreditsTests", code: 7, userInfo: [NSLocalizedDescriptionKey: detail])
        }
    }

    private func ms(_ iso: String) -> Int64 {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return Int64((formatter.date(from: iso)?.timeIntervalSince1970 ?? 0) * 1000)
    }
}
