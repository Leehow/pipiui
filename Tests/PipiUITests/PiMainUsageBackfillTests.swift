import XCTest
@testable import PipiUI

final class PiMainUsageBackfillTests: XCTestCase {
    private let fileManager = FileManager.default

    // MARK: - Helpers

    private func makeTempRoot() -> URL {
        let dir = fileManager.temporaryDirectory
            .appendingPathComponent("PiMainUsageBackfillTests-\(UUID().uuidString)", isDirectory: true)
        try! fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func iso(_ string: String) -> Date {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: string) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: string)!
    }

    /// `yyyy-MM-dd'T'HH-mm-ss-SSS'Z'`（连字符分隔，与 pi 会话文件名一致）。
    private func nameString(from date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd'T'HH-mm-ss-SSS'Z'"
        return f.string(from: date)
    }

    private func writePiFile(
        root: URL,
        slug: String = "cwd-slug",
        name: String,
        uuid: String = "00000000-0000-0000-0000-000000000001",
        lines: [String]
    ) -> URL {
        let dir = root.appendingPathComponent(slug, isDirectory: true)
        try! fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("\(name)_\(uuid).jsonl")
        let data = (lines.joined(separator: "\n") + "\n").data(using: .utf8)!
        try! data.write(to: url)
        return url
    }

    private func messageLine(role: String, tsMs: Double, cost: Any? = nil, provider: String? = nil, model: String? = nil) -> String {
        var message: [String: Any] = ["role": role, "timestamp": tsMs]
        if let cost {
            message["usage"] = ["input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "cost": cost]
        }
        if let provider { message["provider"] = provider }
        if let model { message["model"] = model }
        let obj: [String: Any] = ["type": "message", "message": message]
        let data = try! JSONSerialization.data(withJSONObject: obj)
        return String(data: data, encoding: .utf8)!
    }

    private func assistantLine(tsMs: Double, cost: Any, provider: String? = nil, model: String? = nil) -> String {
        messageLine(role: "assistant", tsMs: tsMs, cost: cost, provider: provider, model: model)
    }

    private func toolResultLine(tsMs: Double, cost: Double) -> String {
        messageLine(role: "toolResult", tsMs: tsMs, cost: cost)
    }

    private func userLine(tsMs: Double) -> String {
        messageLine(role: "user", tsMs: tsMs)
    }

    private func sum(
        root: URL,
        now: Date,
        ledgerMainSessions: Set<String> = [],
        newSessionFirstTs: [(session: String, firstTs: Date)] = [],
        balanceProvider: BalanceProvider? = nil
    ) -> Double {
        PiMainUsageBackfill.sumLast30Days(
            now: now,
            ledgerMainSessions: ledgerMainSessions,
            newSessionFirstTs: newSessionFirstTs,
            rootURL: root,
            balanceProvider: balanceProvider
        )
    }

    // MARK: - Rule A：resume: 精确路径匹配

    func testRuleAPathMatchExcludesLedgerAttachedFile() {
        let root = makeTempRoot()
        let now = iso("2026-07-24T16:31:00Z")
        let tracked = writePiFile(
            root: root,
            name: "2026-07-24T16-01-21-938Z",
            lines: [assistantLine(tsMs: now.timeIntervalSince1970 * 1000 - 60_000, cost: 10.0)]
        )
        // 不在 ledger 集合里的文件照常计入。
        _ = writePiFile(
            root: root, slug: "other",
            name: "2026-07-24T15-00-00-000Z",
            lines: [assistantLine(tsMs: now.timeIntervalSince1970 * 1000 - 3_600_000, cost: 3.0)]
        )
        let result = sum(
            root: root,
            now: now,
            // 与实现一致：两侧都用符号链接解析后的规范路径（/var → /private/var）。
            ledgerMainSessions: ["resume:" + tracked.resolvingSymlinksInPath().path, "new:UNRELATED-9ABC"]
        )
        XCTAssertEqual(result, 3.0, accuracy: 1e-9)
    }

    // MARK: - Rule B：new: 会话时间窗口（±5 分钟）

    func testRuleBTimeProximityExcludesNewSessionFiles() {
        let root = makeTempRoot()
        let now = iso("2026-07-25T10:00:00Z")
        let firstTs = iso("2026-07-24T16:01:21Z")

        // 文件名时间戳 = firstTs + 2 分钟 → 命中 Rule B，排除。
        let within = firstTs.addingTimeInterval(120)
        _ = writePiFile(
            root: root, name: nameString(from: within),
            lines: [assistantLine(tsMs: now.timeIntervalSince1970 * 1000 - 60_000, cost: 5.0)]
        )
        // firstTs - 4 分钟（对称侧）→ 也命中，排除。
        let before = firstTs.addingTimeInterval(-240)
        _ = writePiFile(
            root: root, slug: "other", name: nameString(from: before),
            lines: [assistantLine(tsMs: now.timeIntervalSince1970 * 1000 - 120_000, cost: 6.0)]
        )
        // firstTs + 10 分钟 → 窗口外，计入。
        let far = firstTs.addingTimeInterval(600)
        _ = writePiFile(
            root: root, slug: "third", name: nameString(from: far),
            lines: [assistantLine(tsMs: now.timeIntervalSince1970 * 1000 - 180_000, cost: 7.0)]
        )

        let result = sum(
            root: root,
            now: now,
            newSessionFirstTs: [(session: "new:ABCD-1234", firstTs: firstTs)]
        )
        XCTAssertEqual(result, 7.0, accuracy: 1e-9)
    }

    // MARK: - 孤儿文件全额计入（混合 cost 形状、角色过滤）

    func testOrphanFileSummedWithMixedCostShapesAndRoles() {
        let root = makeTempRoot()
        let now = iso("2026-07-24T16:31:00Z")
        let ms = now.timeIntervalSince1970 * 1000
        let lines = [
            assistantLine(tsMs: ms - 60_000, cost: 1.5),           // Double cost
            assistantLine(tsMs: ms - 120_000, cost: ["total": 2.5]), // dict cost
            assistantLine(tsMs: ms - 180_000, cost: 0),            // cost 0 → 不影响和
            toolResultLine(tsMs: ms - 240_000, cost: 99),          // 非 assistant → 忽略
            userLine(tsMs: ms - 300_000),                          // 非 assistant → 忽略
        ]
        _ = writePiFile(root: root, name: "2026-07-24T16-01-21-938Z", lines: lines)
        XCTAssertEqual(sum(root: root, now: now), 4.0, accuracy: 1e-9)
    }

    // MARK: - 30 天窗口

    func testWindowFiltersMessageTimestamps() {
        let root = makeTempRoot()
        let now = iso("2026-07-24T16:31:00Z")
        let cutoff = now.addingTimeInterval(-30 * 24 * 3600)
        let ms = { (secondsFromNow: TimeInterval) in (now.timeIntervalSince1970 + secondsFromNow) * 1000 }
        let lines = [
            assistantLine(tsMs: ms(1), cost: 1),                     // now + 1s → 窗口外（>= now 排除）
            assistantLine(tsMs: ms(-3600), cost: 2),                 // 窗口内
            assistantLine(tsMs: ms(-30 * 24 * 3600 + 1), cost: 3),   // cutoff + 1s → 窗口内
            assistantLine(tsMs: ms(-30 * 24 * 3600 - 1), cost: 4),   // cutoff - 1s → 窗口外
        ]
        _ = writePiFile(root: root, name: "2026-07-24T16-01-21-938Z", lines: lines)
        XCTAssertEqual(sum(root: root, now: now), 5.0, accuracy: 1e-9)
    }

    // MARK: - 文件名时间戳边界

    func testMalformedAndNoMsFileNamesContributeZero() {
        let root = makeTempRoot()
        let now = iso("2026-07-24T16:31:00Z")
        let ms = now.timeIntervalSince1970 * 1000
        // 完全不可解析的名字。
        _ = writePiFile(root: root, name: "garbage", lines: [assistantLine(tsMs: ms - 60_000, cost: 5)])
        // 无毫秒段（yyyy-MM-dd'T'HH-mm-ss'Z'）→ 严格格式不认，同样贡献 0。
        _ = writePiFile(root: root, slug: "other", name: "2026-07-24T16-01-21Z",
                        lines: [assistantLine(tsMs: ms - 60_000, cost: 6)])
        XCTAssertEqual(sum(root: root, now: now), 0)
    }

    // MARK: - Provider 过滤（余额提供方归属）

    func testProviderFilterSumsOnlyMatchingProviderMessages() {
        let root = makeTempRoot()
        let now = iso("2026-07-24T16:31:00Z")
        let ms = now.timeIntervalSince1970 * 1000
        let lines = [
            assistantLine(tsMs: ms - 60_000, cost: 1.0, provider: "deepseek"),
            assistantLine(tsMs: ms - 120_000, cost: 2.0, provider: "kimi-coding"), // 订阅流量
            assistantLine(tsMs: ms - 180_000, cost: 4.0, provider: "moonshot"),    // 开放平台
            assistantLine(tsMs: ms - 240_000, cost: 8.0),                           // 无 provider → 不归属
        ]
        _ = writePiFile(root: root, name: "2026-07-24T16-01-21-938Z", lines: lines)
        XCTAssertEqual(sum(root: root, now: now, balanceProvider: .deepseek), 1.0, accuracy: 1e-9)
        XCTAssertEqual(sum(root: root, now: now, balanceProvider: .moonshot), 4.0, accuracy: 1e-9)
        XCTAssertEqual(sum(root: root, now: now, balanceProvider: .siliconflow), 0)
        XCTAssertEqual(sum(root: root, now: now, balanceProvider: .openrouter), 0)
        // 不过滤 → 全部计入（保持既有行为）。
        XCTAssertEqual(sum(root: root, now: now), 15.0, accuracy: 1e-9)
    }

    func testProviderFallsBackToModelPrefixWhenProviderKeyMissing() {
        let root = makeTempRoot()
        let now = iso("2026-07-24T16:31:00Z")
        let ms = now.timeIntervalSince1970 * 1000
        let lines = [
            assistantLine(tsMs: ms - 60_000, cost: 3.0, model: "deepseek/deepseek-v4-flash"),
            assistantLine(tsMs: ms - 120_000, cost: 5.0, model: "moonshot/moonshot-v8-32k"),
            assistantLine(tsMs: ms - 180_000, cost: 7.0, model: "kimi-coding/k3-256k"),
            assistantLine(tsMs: ms - 240_000, cost: 11.0, model: "deepseek-v4-flash"), // 裸 id → 无前缀
        ]
        _ = writePiFile(root: root, name: "2026-07-24T16-01-21-938Z", lines: lines)
        XCTAssertEqual(sum(root: root, now: now, balanceProvider: .deepseek), 3.0, accuracy: 1e-9)
        XCTAssertEqual(sum(root: root, now: now, balanceProvider: .moonshot), 5.0, accuracy: 1e-9)
        XCTAssertEqual(sum(root: root, now: now), 26.0, accuracy: 1e-9)
    }

    // MARK: - 缺失目录

    func testMissingDirectoryReturnsZero() {
        let root = makeTempRoot()
        let missing = root.appendingPathComponent("does-not-exist")
        XCTAssertEqual(sum(root: missing, now: iso("2026-07-24T16:31:00Z")), 0)
    }

    // MARK: - 指纹缓存：stamp 未变不重读

    func testCacheSkipsReparseWhenStampsUnchanged() throws {
        let root = makeTempRoot()
        let now = iso("2026-07-24T16:31:00Z")
        let url = writePiFile(
            root: root, name: "2026-07-24T16-01-21-938Z",
            lines: [assistantLine(tsMs: now.timeIntervalSince1970 * 1000 - 60_000, cost: 8.0)]
        )
        let before = PiMainUsageBackfill.parsedFileCount
        XCTAssertEqual(sum(root: root, now: now), 8.0, accuracy: 1e-9)
        XCTAssertEqual(PiMainUsageBackfill.parsedFileCount, before + 1, "首次调用应真实解析该文件")

        // 无任何变化 → 命中指纹缓存，不再重读文件。
        XCTAssertEqual(sum(root: root, now: now), 8.0, accuracy: 1e-9)
        XCTAssertEqual(PiMainUsageBackfill.parsedFileCount, before + 1, "stamp 未变时不得重读")

        // 内容改写（mtime 变化）→ 缓存失效重读；垃圾行解析不出消息 → 0。
        try String(repeating: " ", count: 200).data(using: .utf8)!.write(to: url)
        XCTAssertEqual(sum(root: root, now: now), 0)
        XCTAssertEqual(PiMainUsageBackfill.parsedFileCount, before + 2, "stamp 变化后应重读")
    }

    // MARK: - ledger 主会话元信息提取

    func testLedgerMainSessionMetaParsesSessionsAndEarliestTs() throws {
        let root = makeTempRoot()
        let ledger = root.appendingPathComponent("ledger.jsonl")
        let resumePath = "/Users/haoli/.pi/agent/sessions/x/2026-07-24T14-00-00-000Z_u.jsonl"
        let lines = [
            #"{"ts":"2026-07-24T14:03:52.428Z","session":"new:CAB150C0","channel":"main","cost":0}"#,
            #"{"ts":"2026-07-24T13:00:00.000Z","session":"new:CAB150C0","channel":"main","cost":0}"#,
            #"{"ts":"2026-07-24T15:00:00.000Z","session":"resume:\#(resumePath)","channel":"main","cost":0}"#,
            #"{"ts":"2026-07-24T16:00:00.000Z","session":"new:CAB150C0","channel":"subagent","cost":0}"#,
            "not-json",
        ]
        try (lines.joined(separator: "\n") + "\n").data(using: .utf8)!.write(to: ledger)

        let meta = PiMainUsageBackfill.ledgerMainSessionMeta(urls: [ledger])
        XCTAssertTrue(meta.mainSessions.contains("new:CAB150C0"))
        XCTAssertTrue(meta.mainSessions.contains("resume:" + resumePath))
        XCTAssertEqual(meta.newSessionFirstTs.count, 1)
        XCTAssertEqual(
            meta.newSessionFirstTs[0].firstTs.timeIntervalSince1970,
            iso("2026-07-24T13:00:00Z").timeIntervalSince1970,
            accuracy: 0.001
        )
        XCTAssertEqual(meta.newSessionFirstTs[0].session, "new:CAB150C0")
    }
}
