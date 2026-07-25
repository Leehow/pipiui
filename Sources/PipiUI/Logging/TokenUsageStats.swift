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
            tools: tools
        )
    }

    // MARK: - Aggregate

    static func aggregate(
        records: [Record],
        period: Period,
        groupBy: GroupBy,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> Report {
        let filtered = records.filter { matchesPeriod($0.date, period: period, now: now, calendar: calendar) }
        var total = Metrics()
        var primary: [String: Metrics] = [:]
        var secondary: [String: [String: Metrics]] = [:]

        for rec in filtered {
            total.add(record: rec)
            let role = roleKey(channel: rec.channel, agentName: rec.agentName)

            switch groupBy {
            case .model:
                accumulate(into: &primary, key: rec.model, record: rec)
                accumulateNested(into: &secondary, primary: rec.model, secondary: role, record: rec)
            case .role:
                accumulate(into: &primary, key: role, record: rec)
                accumulateNested(into: &secondary, primary: role, secondary: rec.model, record: rec)
            case .tool:
                let toolKeys = rec.tools.isEmpty ? [noToolKey] : Array(Set(rec.tools))
                for tool in toolKeys {
                    accumulate(into: &primary, key: tool, record: rec)
                    accumulateNested(into: &secondary, primary: tool, secondary: role, record: rec)
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

    private static func accumulate(into map: inout [String: Metrics], key: String, record: Record) {
        var m = map[key] ?? Metrics()
        m.add(record: record)
        map[key] = m
    }

    private static func accumulateNested(
        into map: inout [String: [String: Metrics]],
        primary: String,
        secondary: String,
        record: Record
    ) {
        var inner = map[primary] ?? [:]
        var m = inner[secondary] ?? Metrics()
        m.add(record: record)
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
