import XCTest
@testable import PipiUI

final class TokenUsageStatsTests: XCTestCase {
    private var utcCalendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }

    private func parseISO(_ string: String) -> Date {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: string) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: string)!
    }

    private func makeRecord(
        iso: String,
        channel: String = "main",
        agentName: String? = nil,
        model: String = "xai/a",
        input: Int = 0,
        output: Int = 0,
        cacheRead: Int = 0,
        cacheWrite: Int = 0,
        cost: Double = 0,
        tools: [String] = []
    ) -> TokenUsageStats.Record {
        TokenUsageStats.Record(
            date: parseISO(iso),
            channel: channel,
            agentName: agentName,
            model: model,
            input: input,
            output: output,
            cacheRead: cacheRead,
            cacheWrite: cacheWrite,
            cost: cost,
            contextTokens: 0,
            tools: tools
        )
    }

    // MARK: - roleKey

    func testRoleKeyMainAndSubagentTypes() {
        XCTAssertEqual(TokenUsageStats.roleKey(channel: "main", agentName: nil), "main")
        XCTAssertEqual(TokenUsageStats.roleKey(channel: "subagent", agentName: "explore"), "explore")
        XCTAssertEqual(TokenUsageStats.roleKey(channel: "subagent", agentName: nil), "subagent")
        XCTAssertEqual(TokenUsageStats.roleKey(channel: "subagent", agentName: ""), "subagent")
        XCTAssertEqual(TokenUsageStats.roleKey(channel: "subagent", agentName: "   "), "subagent")
    }

    // MARK: - Metrics

    func testTokensExcludeCacheRead() {
        var m = TokenUsageStats.Metrics()
        m.add(input: 100, output: 50, cacheRead: 9999, cacheWrite: 20, cost: 1)
        XCTAssertEqual(m.tokens, 170)
        XCTAssertEqual(m.calls, 1)
    }

    // MARK: - aggregate by model

    func testAggregateByModelSplitsRoles() throws {
        let now = parseISO("2026-07-25T12:00:00Z")
        let records = [
            makeRecord(iso: "2026-07-25T10:00:00Z", model: "xai/grok", input: 200, cost: 2.0),
            makeRecord(iso: "2026-07-25T11:00:00Z", channel: "subagent", agentName: "explore",
                   model: "xai/grok", input: 100, cost: 1.0),
            makeRecord(iso: "2026-07-25T11:30:00Z", model: "kimi/k3", input: 50, cost: 0.5),
        ]
        let report = TokenUsageStats.aggregate(
            records: records, period: .all, groupBy: .model,
            now: now, calendar: utcCalendar, costMode: .ledger
        )
        XCTAssertEqual(report.total.calls, 3)
        XCTAssertEqual(report.total.cost, 3.5, accuracy: 1e-9)
        XCTAssertEqual(report.rows.count, 2)
        XCTAssertEqual(report.rows[0].key, "xai/grok")
        XCTAssertEqual(report.rows[0].metrics.cost, 3.0, accuracy: 1e-9)
        XCTAssertEqual(report.rows[0].children.count, 2)
        let grokRoles: [String: Double] = Dictionary(uniqueKeysWithValues: report.rows[0].children.map { ($0.key, $0.metrics.cost) })
        XCTAssertEqual(grokRoles["main"] ?? -1, 2.0, accuracy: 1e-9)
        XCTAssertEqual(grokRoles["explore"] ?? -1, 1.0, accuracy: 1e-9)
        XCTAssertEqual(report.rows[1].key, "kimi/k3")
        XCTAssertEqual(report.rows[1].metrics.cost, 0.5, accuracy: 1e-9)
        XCTAssertEqual(report.rows[1].children.count, 1)
        XCTAssertEqual(report.rows[1].children[0].key, "main")
    }

    // MARK: - aggregate by role

    func testAggregateByRoleSplitsModels() throws {
        let now = parseISO("2026-07-25T12:00:00Z")
        let records = [
            makeRecord(iso: "2026-07-25T10:00:00Z", model: "xai/grok", cost: 2.0),
            makeRecord(iso: "2026-07-25T11:00:00Z", channel: "subagent", agentName: "explore",
                   model: "xai/grok", cost: 1.0),
            makeRecord(iso: "2026-07-25T11:30:00Z", channel: "subagent", agentName: "explore",
                   model: "kimi/k3", cost: 0.5),
        ]
        let report = TokenUsageStats.aggregate(
            records: records, period: .all, groupBy: .role,
            now: now, calendar: utcCalendar, costMode: .ledger
        )
        XCTAssertEqual(report.rows.count, 2)
        XCTAssertEqual(report.rows[0].key, "main")
        XCTAssertEqual(report.rows[0].metrics.cost, 2.0, accuracy: 1e-9)
        XCTAssertEqual(report.rows[1].key, "explore")
        XCTAssertEqual(report.rows[1].metrics.cost, 1.5, accuracy: 1e-9)
        let exploreModels: [String: Double] = Dictionary(uniqueKeysWithValues: report.rows[1].children.map { ($0.key, $0.metrics.cost) })
        XCTAssertEqual(exploreModels["xai/grok"] ?? -1, 1.0, accuracy: 1e-9)
        XCTAssertEqual(exploreModels["kimi/k3"] ?? -1, 0.5, accuracy: 1e-9)
    }

    // MARK: - aggregate by tool

    func testAggregateByToolFullTurnAttribution() throws {
        let now = parseISO("2026-07-25T12:00:00Z")
        let records = [
            makeRecord(iso: "2026-07-25T10:00:00Z", input: 100, cost: 1.0, tools: ["bash", "read"]),
            makeRecord(iso: "2026-07-25T11:00:00Z", input: 50, cost: 0.5, tools: ["bash"]),
        ]
        let report = TokenUsageStats.aggregate(
            records: records, period: .all, groupBy: .tool,
            now: now, calendar: utcCalendar, costMode: .ledger
        )
        XCTAssertEqual(report.total.cost, 1.5, accuracy: 1e-9)
        XCTAssertEqual(report.total.calls, 2)
        let byTool: [String: TokenUsageStats.Metrics] = Dictionary(uniqueKeysWithValues: report.rows.map { ($0.key, $0.metrics) })
        XCTAssertEqual(byTool["bash"]?.cost ?? -1, 1.5, accuracy: 1e-9)
        XCTAssertEqual(byTool["bash"]?.calls, 2)
        XCTAssertEqual(byTool["read"]?.cost ?? -1, 1.0, accuracy: 1e-9)
        XCTAssertEqual(byTool["read"]?.calls, 1)
        // secondary = role
        let bashRow = try XCTUnwrap(report.rows.first { $0.key == "bash" })
        XCTAssertEqual(bashRow.children.count, 1)
        XCTAssertEqual(bashRow.children[0].key, "main")
    }

    func testAggregateByToolLegacyNoToolsBucket() {
        let now = parseISO("2026-07-25T12:00:00Z")
        let records = [
            makeRecord(iso: "2026-07-25T10:00:00Z", cost: 0.25, tools: []),
        ]
        let report = TokenUsageStats.aggregate(
            records: records, period: .all, groupBy: .tool,
            now: now, calendar: utcCalendar, costMode: .ledger
        )
        XCTAssertEqual(report.rows.count, 1)
        XCTAssertEqual(report.rows[0].key, TokenUsageStats.noToolKey)
        XCTAssertEqual(report.rows[0].metrics.cost, 0.25, accuracy: 1e-9)
    }

    // MARK: - period filter

    func testPeriodTodayFiltersOtherDays() {
        let now = parseISO("2026-07-25T15:00:00Z")
        let records = [
            makeRecord(iso: "2026-07-25T10:00:00Z", cost: 1.0),
            makeRecord(iso: "2026-07-24T23:59:59Z", cost: 9.0),
        ]
        let report = TokenUsageStats.aggregate(
            records: records, period: .today, groupBy: .model,
            now: now, calendar: utcCalendar, costMode: .ledger
        )
        XCTAssertEqual(report.total.calls, 1)
        XCTAssertEqual(report.total.cost, 1.0, accuracy: 1e-9)
    }

    // MARK: - loadRecords

    func testLoadRecordsFromJSONLFiles() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-stats-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let active = dir.appendingPathComponent("active.jsonl")
        let rolled = dir.appendingPathComponent("active.jsonl.1")
        let line1 = """
        {"ts":"2026-07-25T10:00:00.123Z","session":"s","channel":"main","depth":0,"model":"xai/a","turn":1,"input":10,"output":5,"cacheRead":0,"cacheWrite":0,"cost":0.1,"contextTokens":15,"tools":["bash"]}
        """
        let line2 = """
        {"ts":"2026-07-24T10:00:00Z","session":"s","channel":"subagent","agentName":"explore","depth":1,"model":"kimi/b","turn":2,"input":20,"output":10,"cacheRead":1,"cacheWrite":2,"cost":0.2,"contextTokens":30}
        """
        try (line1 + "\n").write(to: active, atomically: true, encoding: .utf8)
        try (line2 + "\n").write(to: rolled, atomically: true, encoding: .utf8)

        let records = TokenUsageStats.loadRecords(from: [active, rolled])
        XCTAssertEqual(records.count, 2)
        let byModel: [String: TokenUsageStats.Record] = Dictionary(uniqueKeysWithValues: records.map { ($0.model, $0) })
        XCTAssertEqual(byModel["xai/a"]?.tools, ["bash"])
        XCTAssertEqual(byModel["kimi/b"]?.tools, [])
        XCTAssertEqual(byModel["kimi/b"]?.agentName, "explore")
        XCTAssertEqual(byModel["xai/a"]?.input, 10)
    }

    func testParseLineHandlesFractionalAndPlainTimestamps() {
        let fractional = """
        {"ts":"2026-07-25T10:00:00.456Z","session":"s","channel":"main","model":"m","input":1,"output":2,"cacheRead":0,"cacheWrite":0,"cost":0}
        """
        let plain = """
        {"ts":"2026-07-25T10:00:00Z","session":"s","channel":"main","model":"m","input":3,"output":4,"cacheRead":0,"cacheWrite":0,"cost":0}
        """
        XCTAssertEqual(TokenUsageStats.parseLine(fractional)?.input, 1)
        XCTAssertEqual(TokenUsageStats.parseLine(plain)?.input, 3)
    }

    // MARK: - sessionCacheTotals (resume rehydration)

    private func writeJSONL(_ lines: [String], to url: URL) throws {
        let payload = lines.joined(separator: "\n") + "\n"
        try payload.write(to: url, atomically: true, encoding: .utf8)
    }

    func testSessionCacheTotalsSumsMatchingSessionOnly() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-cache-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let active = dir.appendingPathComponent("active.jsonl")
        let alpha = "alpha-sess-id"
        let beta = "beta-sess-id"

        let lines = [
            // alpha, turn 1
            #"{"ts":"2026-07-25T10:00:00Z","session":"\#(alpha)","channel":"main","model":"m","input":1,"output":1,"cacheRead":100,"cacheWrite":10,"cost":0.1}"#,
            // beta — must be ignored for alpha
            #"{"ts":"2026-07-25T10:01:00Z","session":"\#(beta)","channel":"main","model":"m","input":1,"output":1,"cacheRead":999,"cacheWrite":999,"cost":0.1}"#,
            // alpha, turn 2
            #"{"ts":"2026-07-25T10:02:00Z","session":"\#(alpha)","channel":"main","model":"m","input":1,"output":1,"cacheRead":200,"cacheWrite":20,"cost":0.1}"#,
            // no session field, but substring appears in model — must be ignored
            #"{"ts":"2026-07-25T10:03:00Z","channel":"main","model":"\#(alpha)-x","input":1,"output":1,"cacheRead":5,"cacheWrite":6,"cost":0.1}"#,
            // session = null, substring in model — must be ignored
            #"{"ts":"2026-07-25T10:04:00Z","session":null,"channel":"main","model":"\#(alpha)-x","input":1,"output":1,"cacheRead":7,"cacheWrite":8,"cost":0.1}"#,
            // session = number, substring in model — must be ignored
            #"{"ts":"2026-07-25T10:05:00Z","session":123,"channel":"main","model":"\#(alpha)-x","input":1,"output":1,"cacheRead":9,"cacheWrite":11,"cost":0.1}"#,
        ]
        try writeJSONL(lines, to: active)

        let alphaTotals = TokenUsageStats.sessionCacheTotals(for: alpha, urls: [active])
        XCTAssertEqual(alphaTotals.cacheRead, 300)
        XCTAssertEqual(alphaTotals.cacheWrite, 30)

        let betaTotals = TokenUsageStats.sessionCacheTotals(for: beta, urls: [active])
        XCTAssertEqual(betaTotals.cacheRead, 999)
        XCTAssertEqual(betaTotals.cacheWrite, 999)

        let noneTotals = TokenUsageStats.sessionCacheTotals(for: "missing-sess-id", urls: [active])
        XCTAssertEqual(noneTotals.cacheRead, 0)
        XCTAssertEqual(noneTotals.cacheWrite, 0)
    }

    func testSessionCacheTotalsAcrossActiveAndRolled() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-cache2-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let active = dir.appendingPathComponent("active.jsonl")
        let rolled = dir.appendingPathComponent("active.jsonl.1")
        let alpha = "alpha-sess-id"

        try writeJSONL([
            #"{"ts":"2026-07-25T10:00:00Z","session":"\#(alpha)","channel":"main","model":"m","input":1,"output":1,"cacheRead":100,"cacheWrite":10,"cost":0.1}"#,
        ], to: active)
        try writeJSONL([
            #"{"ts":"2026-07-24T10:00:00Z","session":"\#(alpha)","channel":"main","model":"m","input":1,"output":1,"cacheRead":200,"cacheWrite":20,"cost":0.1}"#,
        ], to: rolled)

        let totals = TokenUsageStats.sessionCacheTotals(for: alpha, urls: [active, rolled])
        XCTAssertEqual(totals.cacheRead, 300)
        XCTAssertEqual(totals.cacheWrite, 30)
    }

    func testSessionCacheTotalsMissingFilesAreZero() {
        let totals = TokenUsageStats.sessionCacheTotals(
            for: "alpha",
            urls: [FileManager.default.temporaryDirectory.appendingPathComponent("does-not-exist-\(UUID().uuidString).jsonl")]
        )
        XCTAssertEqual(totals.cacheRead, 0)
        XCTAssertEqual(totals.cacheWrite, 0)
    }

    func testSessionUsageRestoresOnlyMainTurnsAndUsesLatestTimestampAcrossFiles() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-session-usage-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let active = dir.appendingPathComponent("active.jsonl")
        let rolled = dir.appendingPathComponent("active.jsonl.1")
        let session = "session-alpha"
        try writeJSONL([
            // Newer than the active file even though it is supplied second.
            #"{"ts":"2026-07-25T12:00:00Z","session":"\#(session)","channel":"main","model":"m","input":120,"output":12,"cacheRead":1200,"cacheWrite":120,"cost":1.2,"contextTokens":12000}"#,
            // Another session and a subagent must never affect the footer.
            #"{"ts":"2026-07-25T13:00:00Z","session":"session-beta","channel":"main","model":"m","input":999,"output":999,"cacheRead":999,"cacheWrite":999,"cost":9.9,"contextTokens":99999}"#,
            #"{"ts":"2026-07-25T14:00:00Z","session":"\#(session)","channel":"subagent","model":"m","input":777,"output":777,"cacheRead":777,"cacheWrite":777,"cost":7.7,"contextTokens":77777}"#,
        ], to: rolled)
        try writeJSONL([
            #"{"ts":"2026-07-25T11:00:00Z","session":"\#(session)","channel":"main","model":"m","input":110,"output":11,"cacheRead":1100,"cacheWrite":110,"cost":1.1,"contextTokens":11000}"#,
            "{malformed json}",
            // A matching substring without a string session value is not a record.
            #"{"ts":"2026-07-25T15:00:00Z","session":null,"channel":"main","model":"\#(session)","input":1,"output":1,"cacheRead":1,"cacheWrite":1,"cost":1,"contextTokens":1}"#,
        ], to: active)

        let usage = TokenUsageStats.sessionUsage(for: session, urls: [active, rolled])
        XCTAssertEqual(usage.cacheRead, 2300)
        XCTAssertEqual(usage.cacheWrite, 230)
        XCTAssertEqual(usage.cost, 2.3, accuracy: 1e-9)
        XCTAssertEqual(usage.input, 230)
        XCTAssertEqual(usage.output, 23)
        XCTAssertEqual(usage.contextTokens, 12000)
    }
}
