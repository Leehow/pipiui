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
            now: now, calendar: utcCalendar
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
            now: now, calendar: utcCalendar
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
            now: now, calendar: utcCalendar
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
            now: now, calendar: utcCalendar
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
            now: now, calendar: utcCalendar
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
}
