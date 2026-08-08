import Foundation
import SQLite3

// MARK: - Auth presence (local only; no cookie / workspace config)

/// Detects whether OpenCode Go credentials exist on this machine.
///
/// Sources (any one is enough):
/// - `~/.local/share/opencode/auth.json` → `opencode-go.key`
/// - process / `.env` `OPENCODE_API_KEY` (same key pi uses for the provider)
///
/// This is a presence check only. We never call OpenCode web APIs and never ask
/// the user for workspace IDs or cookies (usability-first; no official public
/// usage API as of 2026-08).
enum OpenCodeGoAuthStore {
    static func defaultAuthURL() -> URL {
        URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
            .appendingPathComponent(".local/share/opencode/auth.json", isDirectory: false)
    }

    static func defaultDatabaseURL() -> URL {
        URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
            .appendingPathComponent(".local/share/opencode/opencode.db", isDirectory: false)
    }

    /// True when a non-empty OpenCode Go API key is configured locally.
    static func hasCredential(
        authURL: URL = defaultAuthURL(),
        env: [String: String] = ProcessInfo.processInfo.environment,
        envFileValues: () -> [String: String] = { QuotaEnvFallback.envFileValues() }
    ) -> Bool {
        if let key = loadAuthKey(at: authURL), !key.isEmpty { return true }
        if let key = env["OPENCODE_API_KEY"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !key.isEmpty {
            return true
        }
        if let key = envFileValues()["OPENCODE_API_KEY"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !key.isEmpty {
            return true
        }
        return false
    }

    static func loadAuthKey(at url: URL) -> String? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return parseAuthKey(data: data)
    }

    /// Parses `{"opencode-go":{"type":"api-key","key":"…"}}` (and loose variants).
    static func parseAuthKey(data: Data) -> String? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        guard let entry = root["opencode-go"] as? [String: Any] else { return nil }
        if let key = entry["key"] as? String {
            let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        if let key = entry["apiKey"] as? String {
            let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        return nil
    }
}

// MARK: - Local usage windows (device-scoped)

/// Dollar caps published for OpenCode Go (https://opencode.ai/docs/go/).
/// Values are USD-equivalent usage, not request counts.
enum OpenCodeGoPlanLimits {
    static let fiveHourUSD: Double = 12
    static let weeklyUSD: Double = 30
    static let monthlyUSD: Double = 60
    static let fiveHours: TimeInterval = 5 * 60 * 60
    static let week: TimeInterval = 7 * 24 * 60 * 60
}

/// One cost event attributed to provider `opencode-go` on this machine.
struct OpenCodeGoUsageRow: Equatable {
    let createdMs: Int64
    let cost: Double
}

enum OpenCodeGoLocalUsageError: Error, Equatable {
    case databaseMissing
    case sqliteFailed(String)
}

/// Reads `~/.local/share/opencode/opencode.db` and computes **this machine's**
/// rolling 5h / ISO-week / anchored-month usage against Go plan dollar caps.
///
/// Limitations (intentional):
/// - Only local OpenCode history (`providerID == "opencode-go"`). Other devices
///   and pure-web dashboard usage are invisible.
/// - Not an official account balance; UI labels must say 本机用量.
/// - No cookie / workspace scrape (usability-first; PR #16513 usage API unmerged).
enum OpenCodeGoLocalUsage {
    private static let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    // MARK: Public entry

    /// Build a `QuotaSnapshot` from the standard OpenCode paths, or nil when
    /// there is nothing useful to show (no DB and no credential signal).
    static func fetchSnapshot(
        now: Date = Date(),
        authURL: URL = OpenCodeGoAuthStore.defaultAuthURL(),
        databaseURL: URL = OpenCodeGoAuthStore.defaultDatabaseURL(),
        env: [String: String] = ProcessInfo.processInfo.environment,
        envFileValues: () -> [String: String] = { QuotaEnvFallback.envFileValues() }
    ) throws -> QuotaSnapshot? {
        let hasCred = OpenCodeGoAuthStore.hasCredential(
            authURL: authURL, env: env, envFileValues: envFileValues
        )
        let dbExists = FileManager.default.fileExists(atPath: databaseURL.path)
        guard dbExists else {
            // Without local history we refuse to invent a balance.
            return nil
        }
        let rows = try readRows(databaseURL: databaseURL)
        // Empty local history: still surface 0% windows when Go is configured so
        // the capsule binds; labels already say 本机.
        if rows.isEmpty, !hasCred {
            // No credential and no rows → provider unused on this machine.
            return nil
        }
        return snapshot(rows: rows, now: now)
    }

    // MARK: Snapshot math (pure)

    /// Maps cost rows into three windows. Pure — unit-tested without SQLite.
    static func snapshot(rows: [OpenCodeGoUsageRow], now: Date) -> QuotaSnapshot {
        let nowMs = Int64(now.timeIntervalSince1970 * 1000)
        let sessionStart = nowMs - Int64(OpenCodeGoPlanLimits.fiveHours * 1000)
        let weekStart = startOfUTCWeek(now: now)
        let weekStartMs = Int64(weekStart.timeIntervalSince1970 * 1000)
        let weekEndMs = weekStartMs + Int64(OpenCodeGoPlanLimits.week * 1000)
        let earliestMs = rows.map(\.createdMs).min()
        let month = monthBounds(now: now, anchorMs: earliestMs)

        var sessionCost = 0.0
        var weeklyCost = 0.0
        var monthlyCost = 0.0
        var oldestSessionMs: Int64?

        for row in rows {
            if row.createdMs >= sessionStart, row.createdMs < nowMs {
                sessionCost += row.cost
                if oldestSessionMs.map({ row.createdMs < $0 }) ?? true {
                    oldestSessionMs = row.createdMs
                }
            }
            if row.createdMs >= weekStartMs, row.createdMs < weekEndMs {
                weeklyCost += row.cost
            }
            if row.createdMs >= month.startMs, row.createdMs < month.endMs {
                monthlyCost += row.cost
            }
        }

        let oldest = oldestSessionMs ?? nowMs
        let rollingReset = max(0, Int((oldest + Int64(OpenCodeGoPlanLimits.fiveHours * 1000) - nowMs) / 1000))
        let weeklyReset = max(0, Int((weekEndMs - nowMs) / 1000))
        let monthlyReset = max(0, Int((month.endMs - nowMs) / 1000))

        let windows: [QuotaWindow] = [
            QuotaWindow(
                id: "fiveHour",
                usedPercent: percent(used: sessionCost, limit: OpenCodeGoPlanLimits.fiveHourUSD),
                resetsAt: now.addingTimeInterval(TimeInterval(rollingReset)),
                label: "5h",
                title: "5小时本机用量"
            ),
            QuotaWindow(
                id: "weekly",
                usedPercent: percent(used: weeklyCost, limit: OpenCodeGoPlanLimits.weeklyUSD),
                resetsAt: now.addingTimeInterval(TimeInterval(weeklyReset)),
                label: "周",
                title: "周本机用量"
            ),
            QuotaWindow(
                id: "monthly",
                usedPercent: percent(used: monthlyCost, limit: OpenCodeGoPlanLimits.monthlyUSD),
                resetsAt: now.addingTimeInterval(TimeInterval(monthlyReset)),
                label: "月",
                title: "月本机用量"
            ),
        ]
        return QuotaSnapshot(windows: windows, selectedWindowId: nil)
    }

    /// used/limit → 0…100, one decimal (matches CodexBar OpenCode Go local reader).
    static func percent(used: Double, limit: Double) -> Double {
        guard used.isFinite, limit > 0 else { return 0 }
        let value = max(0, min(100, used / limit * 100))
        return (value * 10).rounded() / 10
    }

    // MARK: SQLite

    /// Load cost events for `providerID == "opencode-go"`.
    /// Prefers `part` rows with `type == "step-finish"` (per-step costs); falls
    /// back to assistant `message.cost` when a message has no step-finish parts.
    static func readRows(databaseURL: URL) throws -> [OpenCodeGoUsageRow] {
        var db: OpaquePointer?
        guard sqlite3_open_v2(databaseURL.path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
            let message = db.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "open failed"
            if let db { sqlite3_close(db) }
            throw OpenCodeGoLocalUsageError.sqliteFailed(message)
        }
        defer { sqlite3_close(db) }
        sqlite3_busy_timeout(db, 250)

        let sql = hasTable(named: "part", db: db) ? messageAndPartUsageSQL : messageUsageSQL
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            let message = db.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "prepare failed"
            throw OpenCodeGoLocalUsageError.sqliteFailed(message)
        }
        defer { sqlite3_finalize(stmt) }

        var rows: [OpenCodeGoUsageRow] = []
        while true {
            let step = sqlite3_step(stmt)
            if step == SQLITE_DONE { break }
            guard step == SQLITE_ROW else {
                let message = db.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "step failed"
                throw OpenCodeGoLocalUsageError.sqliteFailed(message)
            }
            let createdMs = sqlite3_column_int64(stmt, 0)
            let cost = sqlite3_column_double(stmt, 1)
            guard createdMs > 0, cost >= 0, cost.isFinite else { continue }
            rows.append(OpenCodeGoUsageRow(createdMs: createdMs, cost: cost))
        }
        return rows
    }

    private static func hasTable(named name: String, db: OpaquePointer?) -> Bool {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(
            db,
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
            -1,
            &stmt,
            nil
        ) == SQLITE_OK else { return false }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_text(stmt, 1, name, -1, sqliteTransient)
        return sqlite3_step(stmt) == SQLITE_ROW
    }

    private static let messageUsageSQL = """
        SELECT
          CAST(COALESCE(json_extract(data, '$.time.created'), time_created) AS INTEGER) AS createdMs,
          CAST(json_extract(data, '$.cost') AS REAL) AS cost
        FROM message
        WHERE json_valid(data)
          AND json_extract(data, '$.providerID') = 'opencode-go'
          AND json_extract(data, '$.role') = 'assistant'
          AND json_type(data, '$.cost') IN ('integer', 'real')
    """

    private static let messageAndPartUsageSQL = """
        WITH provider_messages AS (
          SELECT
            id AS messageID,
            CAST(COALESCE(json_extract(data, '$.time.created'), time_created) AS INTEGER) AS createdMs,
            CAST(json_extract(data, '$.cost') AS REAL) AS cost,
            json_type(data, '$.cost') IN ('integer', 'real') AS hasCost
          FROM message
          WHERE json_valid(data)
            AND json_extract(data, '$.providerID') = 'opencode-go'
            AND json_extract(data, '$.role') = 'assistant'
        )
        SELECT
          CAST(COALESCE(json_extract(p.data, '$.time.created'), p.time_created, m.createdMs) AS INTEGER)
            AS createdMs,
          CAST(json_extract(p.data, '$.cost') AS REAL) AS cost
        FROM part p
        JOIN provider_messages m ON m.messageID = p.message_id
        WHERE json_valid(p.data)
          AND json_extract(p.data, '$.type') = 'step-finish'
          AND json_type(p.data, '$.cost') IN ('integer', 'real')
        UNION ALL
        SELECT createdMs, cost
        FROM provider_messages m
        WHERE hasCost
          AND NOT EXISTS (
            SELECT 1
            FROM part p
            WHERE p.message_id = m.messageID
              AND json_valid(p.data)
              AND json_extract(p.data, '$.type') = 'step-finish'
              AND json_type(p.data, '$.cost') IN ('integer', 'real')
          )
    """

    // MARK: Calendar helpers (UTC ISO week + anchor month)

    /// Monday-start ISO week in UTC (`firstWeekday = 2`, `minimumDaysInFirstWeek = 4`).
    static func startOfUTCWeek(now: Date) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .current
        calendar.firstWeekday = 2
        calendar.minimumDaysInFirstWeek = 4
        let components = calendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: now)
        return calendar.date(from: components) ?? now
    }

    /// Monthly window anchored to the earliest local usage timestamp (UTC).
    /// When the anchor day does not exist in a shorter month, clamp to month end
    /// but keep the original day-of-month for subsequent months (CodexBar parity).
    static func monthBounds(now: Date, anchorMs: Int64?) -> (startMs: Int64, endMs: Int64) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .current

        guard let anchorMs else {
            let start = calendar.date(from: calendar.dateComponents([.year, .month], from: now)) ?? now
            let end = calendar.date(byAdding: .month, value: 1, to: start) ?? start
            return (Int64(start.timeIntervalSince1970 * 1000), Int64(end.timeIntervalSince1970 * 1000))
        }

        let anchor = Date(timeIntervalSince1970: TimeInterval(anchorMs) / 1000)
        let anchorComponents = calendar.dateComponents(
            [.day, .hour, .minute, .second, .nanosecond], from: anchor
        )
        let nowComponents = calendar.dateComponents([.year, .month], from: now)

        var startMonthComponents = nowComponents
        var start = anchoredMonth(calendar: calendar, month: startMonthComponents, anchor: anchorComponents)
        if start > now {
            guard let previous = calendar.date(byAdding: .month, value: -1, to: start) else {
                let end = anchoredMonth(
                    calendar: calendar,
                    month: monthComponents(after: startMonthComponents, calendar: calendar),
                    anchor: anchorComponents
                )
                return (Int64(start.timeIntervalSince1970 * 1000), Int64(end.timeIntervalSince1970 * 1000))
            }
            startMonthComponents = calendar.dateComponents([.year, .month], from: previous)
            start = anchoredMonth(calendar: calendar, month: startMonthComponents, anchor: anchorComponents)
        }
        let end = anchoredMonth(
            calendar: calendar,
            month: monthComponents(after: startMonthComponents, calendar: calendar),
            anchor: anchorComponents
        )
        return (Int64(start.timeIntervalSince1970 * 1000), Int64(end.timeIntervalSince1970 * 1000))
    }

    private static func monthComponents(after month: DateComponents, calendar: Calendar) -> DateComponents {
        let monthStart = calendar.date(from: month) ?? Date()
        let nextMonth = calendar.date(byAdding: .month, value: 1, to: monthStart) ?? monthStart
        return calendar.dateComponents([.year, .month], from: nextMonth)
    }

    private static func anchoredMonth(
        calendar: Calendar,
        month: DateComponents,
        anchor: DateComponents
    ) -> Date {
        var components = DateComponents()
        components.calendar = calendar
        components.timeZone = calendar.timeZone
        components.year = month.year
        components.month = month.month
        components.day = anchor.day
        components.hour = anchor.hour
        components.minute = anchor.minute
        components.second = anchor.second
        components.nanosecond = anchor.nanosecond

        if let date = calendar.date(from: components),
           calendar.component(.month, from: date) == month.month {
            return date
        }

        components.day = calendar.range(
            of: .day,
            in: .month,
            for: calendar.date(from: month) ?? Date()
        )?.count
        return calendar.date(from: components) ?? Date()
    }
}

// MARK: - Monitor

final class OpenCodeGoQuotaMonitor: QuotaMonitor {
    static let shared = OpenCodeGoQuotaMonitor()
    private let core = QuotaMonitorCore()

    private init() {
        core.fetcher = { [weak self] _ in try await self?.fetchLocal() }
    }

    var snapshot: QuotaSnapshot? { core.snapshot }

    @discardableResult
    func observe(_ handler: @escaping (QuotaSnapshot?) -> Void) -> UUID {
        core.observe(handler)
    }

    func removeObserver(_ id: UUID) { core.removeObserver(id) }

    func refreshIfNeeded(force: Bool) { core.refreshIfNeeded(force: force) }

    private func fetchLocal() async throws -> QuotaSnapshot? {
        // Offload SQLite to a background task; failures stay silent (core keeps last good).
        try await Task.detached(priority: .utility) {
            try OpenCodeGoLocalUsage.fetchSnapshot()
        }.value
    }
}
