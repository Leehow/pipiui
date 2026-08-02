import Foundation

/// Read-side aggregation over `TokenLedger` JSONL for Settings → 用量.
enum TokenUsageStats {
    static let noToolKey = "(无工具)"

    enum Period: String, CaseIterable, Identifiable {
        case today
        case last7Days
        case last30Days
        case all

        var id: String { rawValue }

        var label: String {
            switch self {
            case .today: return "今日"
            case .last7Days: return "7 天"
            case .last30Days: return "30 天"
            case .all: return "全部"
            }
        }
    }

    enum GroupBy: String, CaseIterable, Identifiable {
        case model
        case role
        case tool

        var id: String { rawValue }

        var label: String {
            switch self {
            case .model: return "按模型"
            case .role: return "按角色"
            case .tool: return "按工具"
            }
        }
    }

    struct Metrics {
        var calls = 0
        var input = 0
        var output = 0
        var cacheRead = 0
        var cacheWrite = 0
        var cost: Double = 0

        var tokens: Int { input + output + cacheWrite }

        mutating func add(input: Int, output: Int, cacheRead: Int, cacheWrite: Int, cost: Double) {
            calls += 1
            self.input += input
            self.output += output
            self.cacheRead += cacheRead
            self.cacheWrite += cacheWrite
            self.cost += cost
        }

        mutating func add(record: Record) {
            add(
                input: record.input,
                output: record.output,
                cacheRead: record.cacheRead,
                cacheWrite: record.cacheWrite,
                cost: record.cost
            )
        }
    }

    struct Row: Identifiable {
        let key: String
        var metrics: Metrics
        var children: [Row]

        var id: String { key }
    }

    struct Report {
        var total: Metrics
        var rows: [Row]
    }

    /// How `Metrics.cost` is filled during aggregation.
    enum CostMode: Equatable {
        /// Keep ledger `cost` as-is (tests / raw pi USD).
        case ledger
        /// Reprice from tokens using `ModelPricing` → CNY; fall back to ledger×FX.
        case estimateCNY
    }

    struct Record {
        var date: Date
        var channel: String
        var agentName: String?
        var model: String
        var input: Int
        var output: Int
        var cacheRead: Int
        var cacheWrite: Int
        var cost: Double
        var contextTokens: Int
        var tools: [String]
    }

    // MARK: - Role key

    static func roleKey(channel: String, agentName: String?) -> String {
        if channel == "main" { return "main" }
        if let name = agentName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            return name
        }
        return "subagent"
    }

    // MARK: - Load

    /// mtime+size 指纹；两本 ledger 都未变时复用缓存，避免每次进「用量」tab
    /// 全量重解析 JSONL（模式同 AgentCatalog.directoryStamp）。nil 字段 = 文件缺失。
    private struct LedgerFileStamp: Equatable {
        var mtime: Date?
        var size: NSNumber?
    }

    private static let sharedRecordsCacheLock = NSLock()
    private static var sharedRecordsCache: (stamps: [LedgerFileStamp], records: [Record])?

    static func loadSharedRecords(fileManager: FileManager = .default) -> [Record] {
        // 先把 TokenLedger 内存缓冲落盘，再取指纹，保证缓存判断基于最新文件状态。
        TokenLedger.shared.flushSync()
        let urls = [TokenLedger.shared.fileURL, TokenLedger.shared.rolledFileURL]
        let stamps = urls.map { ledgerStamp(of: $0, fileManager: fileManager) }
        sharedRecordsCacheLock.lock()
        if let cache = sharedRecordsCache, cache.stamps == stamps {
            let records = cache.records
            sharedRecordsCacheLock.unlock()
            return records
        }
        sharedRecordsCacheLock.unlock()
        let records = loadRecords(from: urls, fileManager: fileManager)
        sharedRecordsCacheLock.lock()
        sharedRecordsCache = (stamps: stamps, records: records)
        sharedRecordsCacheLock.unlock()
        return records
    }

    private static func ledgerStamp(of url: URL, fileManager: FileManager) -> LedgerFileStamp {
        guard let attrs = try? fileManager.attributesOfItem(atPath: url.path) else {
            return LedgerFileStamp(mtime: nil, size: nil)
        }
        return LedgerFileStamp(
            mtime: attrs[.modificationDate] as? Date,
            size: attrs[.size] as? NSNumber
        )
    }

    static func loadRecords(from urls: [URL], fileManager: FileManager = .default) -> [Record] {
        var records: [Record] = []
        for url in urls {
            guard fileManager.fileExists(atPath: url.path),
                  let data = try? Data(contentsOf: url),
                  let text = String(data: data, encoding: .utf8) else { continue }
            for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
                if let rec = parseLine(String(line)) {
                    records.append(rec)
                }
            }
        }
        return records
    }

    static func parseLine(_ line: String) -> Record? {
        guard let data = line.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let ts = obj["ts"] as? String,
              let date = parseTimestamp(ts),
              let channel = obj["channel"] as? String,
              let model = obj["model"] as? String else { return nil }

        let agentName = obj["agentName"] as? String
        let input = obj["input"] as? Int ?? 0
        let output = obj["output"] as? Int ?? 0
        let cacheRead = obj["cacheRead"] as? Int ?? 0
        let cacheWrite = obj["cacheWrite"] as? Int ?? 0
        let cost = (obj["cost"] as? NSNumber)?.doubleValue ?? 0
        let contextTokens = obj["contextTokens"] as? Int ?? 0
        let tools = obj["tools"] as? [String] ?? []

        return Record(
            date: date,
            channel: channel,
            agentName: agentName,
            model: model,
            input: input,
            output: output,
            cacheRead: cacheRead,
            cacheWrite: cacheWrite,
            cost: cost,
            contextTokens: contextTokens,
            tools: tools
        )
    }

    /// Resolve display cost for one record (CNY when `costMode == .estimateCNY`).
    static func resolvedCost(
        for record: Record,
        mode: CostMode,
        catalog: ModelPricing.Catalog = .shared
    ) -> Double {
        switch mode {
        case .ledger:
            return record.cost
        case .estimateCNY:
            if let estimated = catalog.estimateCNY(
                model: record.model,
                input: record.input,
                output: record.output,
                cacheRead: record.cacheRead,
                cacheWrite: record.cacheWrite,
                contextTokens: record.contextTokens
            ) {
                return estimated
            }
            // Unknown model: convert ledger USD (often 0 on subscription plans).
            return record.cost * catalog.exchangeRate
        }
    }

    // MARK: - Per-session cache totals (resume rehydration)

    /// Footer/popover values reconstructed from persisted main-chat turns for one session.
    /// `contextTokens` comes from the newest record by timestamp; aggregate fields
    /// (input/output/cacheRead/cacheWrite/cost) cover every valid main-chat record.
    struct SessionUsage {
        var input = 0
        var output = 0
        var cacheRead = 0
        var cacheWrite = 0
        var cost: Double = 0
        var contextTokens: Int?
    }

    /// Read the active and rolled ledgers after flushing pending writes.
    static func sessionUsage(
        for sessionId: String,
        fileManager: FileManager = .default
    ) -> SessionUsage {
        TokenLedger.shared.flushSync()
        return sessionUsage(
            for: sessionId,
            urls: [TokenLedger.shared.fileURL, TokenLedger.shared.rolledFileURL],
            fileManager: fileManager
        )
    }

    /// Testable session-scoped aggregation. Strictly checks the JSON `session` field
    /// before accepting a record, so similarly named sessions can never mix. The
    /// ledger files are not guaranteed to be supplied in chronological order.
    static func sessionUsage(
        for sessionId: String,
        urls: [URL],
        fileManager: FileManager = .default
    ) -> SessionUsage {
        var summary = SessionUsage()
        var latestContext: (date: Date, contextTokens: Int?)?

        for url in urls {
            guard fileManager.fileExists(atPath: url.path),
                  let data = try? Data(contentsOf: url),
                  let text = String(data: data, encoding: .utf8) else { continue }
            for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
                guard line.contains(sessionId),
                      let lineData = String(line).data(using: .utf8),
                      let obj = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                      (obj["session"] as? String) == sessionId,
                      (obj["channel"] as? String) == "main",
                      let record = parseLine(String(line)) else { continue }

                summary.input += record.input
                summary.output += record.output
                summary.cacheRead += record.cacheRead
                summary.cacheWrite += record.cacheWrite
                summary.cost += record.cost
                if latestContext == nil || record.date > latestContext!.date {
                    // Older ledgers may predate contextTokens. Do not invent a zero
                    // context value for the footer when that field was never written.
                    latestContext = (record.date, obj["contextTokens"] as? Int)
                }
            }
        }

        if let latestContext {
            summary.contextTokens = latestContext.contextTokens
        }
        return summary
    }

    /// 累计某会话的 cacheRead / cacheWrite，流式读取 active+rolled ledger，不构建 [Record]、不全量驻留。
    /// 用于 resume 时回填 `ChatSession.sessionCacheRead` / `sessionCacheWrite`。
    /// 公开版先 flush 在途写入，再委托给可注入 urls 的 internal 重载。
    static func sessionCacheTotals(
        for sessionId: String,
        fileManager: FileManager = .default
    ) -> (cacheRead: Int, cacheWrite: Int) {
        TokenLedger.shared.flushSync()
        return sessionCacheTotals(
            for: sessionId,
            urls: [TokenLedger.shared.fileURL, TokenLedger.shared.rolledFileURL],
            fileManager: fileManager
        )
    }

    /// 可注入 urls 的 internal 重载，便于测试；不调用 flushSync（测试直接读写文件）。
    /// 廉价预过滤（`line.contains(sessionId)`）命中后再 JSON 解析，并严格校验
    /// `(obj["session"] as? String) == sessionId` 才累加，避免串会话 / 缺字段 / 非字符串行误计。
    static func sessionCacheTotals(
        for sessionId: String,
        urls: [URL],
        fileManager: FileManager = .default
    ) -> (cacheRead: Int, cacheWrite: Int) {
        var cacheRead = 0
        var cacheWrite = 0
        for url in urls {
            guard fileManager.fileExists(atPath: url.path),
                  let data = try? Data(contentsOf: url),
                  let text = String(data: data, encoding: .utf8) else { continue }
            for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
                // sessionId 通常是较长的唯一路径串，先做一次廉价的子串预过滤。
                guard line.contains(sessionId) else { continue }
                guard let lineData = String(line).data(using: .utf8),
                      let obj = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                      (obj["session"] as? String) == sessionId else { continue }
                cacheRead += obj["cacheRead"] as? Int ?? 0
                cacheWrite += obj["cacheWrite"] as? Int ?? 0
            }
        }
        return (cacheRead, cacheWrite)
    }

    // MARK: - Aggregate

    static func aggregate(
        records: [Record],
        period: Period,
        groupBy: GroupBy,
        now: Date = Date(),
        calendar: Calendar = .current,
        costMode: CostMode = .estimateCNY,
        pricingCatalog: ModelPricing.Catalog = .shared
    ) -> Report {
        let filtered = records.filter { matchesPeriod($0.date, period: period, now: now, calendar: calendar) }
        var total = Metrics()
        var primary: [String: Metrics] = [:]
        var secondary: [String: [String: Metrics]] = [:]

        for rec in filtered {
            let cost = resolvedCost(for: rec, mode: costMode, catalog: pricingCatalog)
            total.add(
                input: rec.input,
                output: rec.output,
                cacheRead: rec.cacheRead,
                cacheWrite: rec.cacheWrite,
                cost: cost
            )
            let role = roleKey(channel: rec.channel, agentName: rec.agentName)

            switch groupBy {
            case .model:
                accumulate(into: &primary, key: rec.model, record: rec, cost: cost)
                accumulateNested(into: &secondary, primary: rec.model, secondary: role, record: rec, cost: cost)
            case .role:
                accumulate(into: &primary, key: role, record: rec, cost: cost)
                accumulateNested(into: &secondary, primary: role, secondary: rec.model, record: rec, cost: cost)
            case .tool:
                let toolKeys = rec.tools.isEmpty ? [noToolKey] : Array(Set(rec.tools))
                for tool in toolKeys {
                    accumulate(into: &primary, key: tool, record: rec, cost: cost)
                    accumulateNested(into: &secondary, primary: tool, secondary: role, record: rec, cost: cost)
                }
            }
        }

        let rows = primary.keys.sorted(by: { sortKeys($0, $1, metrics: primary) }).map { key in
            let childMap = secondary[key] ?? [:]
            let children = childMap.keys.sorted(by: { sortKeys($0, $1, metrics: childMap) }).map { childKey in
                Row(key: childKey, metrics: childMap[childKey] ?? Metrics(), children: [])
            }
            return Row(key: key, metrics: primary[key] ?? Metrics(), children: children)
        }

        return Report(total: total, rows: rows)
    }

    // MARK: - Private helpers

    private static let fractionalTimestampFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let plainTimestampFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static func parseTimestamp(_ ts: String) -> Date? {
        fractionalTimestampFormatter.date(from: ts) ?? plainTimestampFormatter.date(from: ts)
    }

    private static func matchesPeriod(
        _ date: Date,
        period: Period,
        now: Date,
        calendar: Calendar
    ) -> Bool {
        switch period {
        case .all:
            return true
        case .today:
            return calendar.isDate(date, inSameDayAs: now)
        case .last7Days:
            guard let start = calendar.date(byAdding: .day, value: -7, to: now) else { return false }
            return date >= start
        case .last30Days:
            guard let start = calendar.date(byAdding: .day, value: -30, to: now) else { return false }
            return date >= start
        }
    }

    private static func accumulate(
        into map: inout [String: Metrics],
        key: String,
        record: Record,
        cost: Double
    ) {
        var m = map[key] ?? Metrics()
        m.add(
            input: record.input,
            output: record.output,
            cacheRead: record.cacheRead,
            cacheWrite: record.cacheWrite,
            cost: cost
        )
        map[key] = m
    }

    private static func accumulateNested(
        into map: inout [String: [String: Metrics]],
        primary: String,
        secondary: String,
        record: Record,
        cost: Double
    ) {
        var inner = map[primary] ?? [:]
        var m = inner[secondary] ?? Metrics()
        m.add(
            input: record.input,
            output: record.output,
            cacheRead: record.cacheRead,
            cacheWrite: record.cacheWrite,
            cost: cost
        )
        inner[secondary] = m
        map[primary] = inner
    }

    private static func sortKeys(_ a: String, _ b: String, metrics: [String: Metrics]) -> Bool {
        let ma = metrics[a] ?? Metrics()
        let mb = metrics[b] ?? Metrics()
        if ma.cost != mb.cost { return ma.cost > mb.cost }
        if ma.tokens != mb.tokens { return ma.tokens > mb.tokens }
        return a < b
    }
}
