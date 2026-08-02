import Foundation

/// 30 天消耗回填：把从未经 PipiUI ledger 记账过的 pi 主会话消耗补进「30天内消耗」。
/// 数据源是 pi 自己的主会话文件 `~/.pi/agent/sessions/**/*.jsonl`（headless/CLI
/// 会话、ledger 出现之前的历史都只在里面）。
///
/// 事件行形如 `{"type":"message", ...}`，其中 `message.role == "assistant"` 且带
/// `message.usage` 的行才有成本；`message.timestamp` 是毫秒 epoch。cost 可能是
/// Double，也可能是 `{"total": Double}`（与 `TokenLedger.UsageSnapshot.from` 同源）。
///
/// 防重复计费（凡与 ledger 主通道会话对得上的文件一律跳过）：
/// - Rule A（精确路径）：文件绝对路径 `"resume:" + path` 出现在 ledger 主通道
///   session 值集合中 → 跳过。ledger 原始行里的路径带 JSON 转义（`\/`），解析后
///   自动还原；这里比较的是还原后的值。
/// - Rule B（时间启发）：文件名时间戳（首个下划线之前的
///   `yyyy-MM-dd'T'HH-mm-ss-SSS'Z'`）与任意 `new:` 会话首条主通道记录的 ts
///   相差 ≤ 5 分钟 → 跳过。`new:` 是 app 生成的会话 id，无法按路径匹配，但其 pi
///   会话文件在会话启动时创建 ≈ 首条记录时刻。
///
/// 其余文件：累加落在 `[now - 30d, now)` 窗口内的 assistant 用量 cost。
/// 解析结果按 (mtime, size) 指纹缓存，重复打开不重读文件（模式同
/// `TokenUsageStats.loadSharedRecords`）。
enum PiMainUsageBackfill {

    // MARK: - 公开入口

    /// 回填 30 天窗口内、与 ledger 主通道会话对不上的 pi 主会话消耗（pi USD）。
    /// `rootURL` 缺省为 `~/.pi/agent/sessions`；`now` 可注入以便测试。
    /// `balanceProvider` 非 nil 时只累计 message.provider（缺省时取
    /// message.model 的 `/` 前缀）归属该提供方的消息 —— 余额 popover 的
    /// 「30天内消耗」只显示当前余额账户自己的消耗。
    static func sumLast30Days(
        now: Date = Date(),
        ledgerMainSessions: Set<String>,
        newSessionFirstTs: [(session: String, firstTs: Date)],
        rootURL: URL? = nil,
        fileManager: FileManager = .default,
        balanceProvider: BalanceProvider? = nil
    ) -> Double {
        let root = rootURL ?? fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent(".pi/agent/sessions", isDirectory: true)
        let files = enumerateSessionFiles(root: root, fileManager: fileManager)
        let cutoff = now.addingTimeInterval(-30 * 24 * 60 * 60)
        let firstTsSorted = newSessionFirstTs.map(\.firstTs).sorted()
        let nameFormatter = makeNameDateFormatter()

        var total: Double = 0
        var seenPaths = Set<String>()
        for url in files {
            // 规范化路径（/var → /private/var 等符号链接解析），与 ledger 里 pi
            // 写入的规范路径对齐，Rule A 精确匹配才可靠；同时用作缓存键。
            let resolved = url.resolvingSymlinksInPath()
            let path = resolved.path
            seenPaths.insert(path)
            // Rule A：ledger 已按 `resume:` + 完整路径记账的会话文件。
            guard !ledgerMainSessions.contains("resume:" + path) else { continue }
            // 文件名时间戳解析失败（格式异常/无毫秒）→ 贡献 0（宁缺毋滥，避免误计）。
            guard let nameDate = parseNameDate(url, formatter: nameFormatter) else { continue }
            // Rule B：与任意 new: 会话首条主记录 ts 相距 ≤ 5 分钟 → 视为 app 附加会话。
            if isWithinFiveMinutes(nameDate, of: firstTsSorted) { continue }
            let messages = cachedMessages(for: resolved, fileManager: fileManager)
            for (ts, cost, provider) in messages where ts >= cutoff && ts < now {
                // 按消息级 provider 归属过滤；无法归属的消息（provider 与 model
                // 前缀都缺失）不进入任何提供方的统计。
                if let bp = balanceProvider,
                   PipiUI.balanceProvider(for: provider ?? "") != bp {
                    continue
                }
                total += cost
            }
        }
        pruneCache(keeping: seenPaths)
        return total
    }

    /// 从 ledger（active + `.1`）提取主通道 session 元信息：全部 session 值集合 +
    /// 每个 `new:` 会话首条主记录的 ts。带与 `TokenUsageStats.loadSharedRecords`
    /// 相同的 mtime/size 指纹缓存。公开版先 flush 在途写入，再委托给可注入 urls
    /// 的内部重载（便于测试）。
    static func ledgerMainSessionMeta(
        fileManager: FileManager = .default
    ) -> (mainSessions: Set<String>, newSessionFirstTs: [(session: String, firstTs: Date)]) {
        TokenLedger.shared.flushSync()
        return ledgerMainSessionMeta(
            urls: [TokenLedger.shared.fileURL, TokenLedger.shared.rolledFileURL],
            fileManager: fileManager
        )
    }

    /// 可注入 urls 的内部重载。只认 `channel == "main"` 的记录；`new:` 会话按
    /// session 取最早一条的 ts。
    static func ledgerMainSessionMeta(
        urls: [URL],
        fileManager: FileManager = .default
    ) -> (mainSessions: Set<String>, newSessionFirstTs: [(session: String, firstTs: Date)]) {
        let stamps = urls.map { fileStamp(of: $0, fileManager: fileManager) }
        metaCacheLock.lock()
        if let hit = metaCache, hit.stamps == stamps {
            let cached = hit.meta
            metaCacheLock.unlock()
            return cached
        }
        metaCacheLock.unlock()

        var mainSessions = Set<String>()
        var earliestBySession: [String: Date] = [:]
        for url in urls {
            guard fileManager.fileExists(atPath: url.path),
                  let data = try? Data(contentsOf: url),
                  let text = String(data: data, encoding: .utf8) else { continue }
            for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
                guard let lineData = line.data(using: .utf8),
                      let obj = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                      let session = obj["session"] as? String,
                      (obj["channel"] as? String) == "main",
                      let ts = obj["ts"] as? String,
                      let date = parseLedgerTimestamp(ts) else { continue }
                mainSessions.insert(normalizedMainSessionValue(session))
                if session.hasPrefix("new:") {
                    if let existing = earliestBySession[session] {
                        if date < existing { earliestBySession[session] = date }
                    } else {
                        earliestBySession[session] = date
                    }
                }
            }
        }
        let pairs = earliestBySession.keys.sorted().map { session in
            (session: session, firstTs: earliestBySession[session]!)
        }

        metaCacheLock.lock()
        metaCache = (stamps: stamps, meta: (mainSessions: mainSessions, newSessionFirstTs: pairs))
        metaCacheLock.unlock()
        return (mainSessions: mainSessions, newSessionFirstTs: pairs)
    }

    /// 把 `resume:` 会话值里的路径也做符号链接规范化，保证与扫描侧
    /// `resolvingSymlinksInPath()` 后的文件路径可比（例如 /var 与 /private/var）。
    /// `new:` 等其它形态原样保留。
    private static func normalizedMainSessionValue(_ raw: String) -> String {
        guard raw.hasPrefix("resume:") else { return raw }
        let path = String(raw.dropFirst("resume:".count))
        return "resume:" + URL(fileURLWithPath: path).resolvingSymlinksInPath().path
    }

    // MARK: - 解析缓存（path → (mtime, size) 指纹 → 消息级 (ts, cost)）

    private struct FileStamp: Equatable {
        var mtime: Date?
        var size: NSNumber?
    }

    private struct CacheEntry {
        var stamp: FileStamp
        // (ts, cost, provider)：provider 在解析时提取（message.provider，缺省取
        // message.model 的 `/` 前缀），过滤留在聚合时按 balanceProvider 进行，
        // 因此切换余额提供方不会触发重读文件。
        var messages: [(ts: Date, cost: Double, provider: String?)]
    }

    private static let messagesCacheLock = NSLock()
    private static var messagesCache: [String: CacheEntry] = [:]

    /// 测试可观测性：实际解析（缓存未命中）过的文件数，锁内维护。
    private(set) static var parsedFileCount = 0

    private static let metaCacheLock = NSLock()
    private static var metaCache: (
        stamps: [FileStamp],
        meta: (mainSessions: Set<String>, newSessionFirstTs: [(session: String, firstTs: Date)])
    )?

    /// 指纹未变则复用已解析的消息级数据；变化（含新文件）才重读该文件。
    private static func cachedMessages(for url: URL, fileManager: FileManager) -> [(ts: Date, cost: Double, provider: String?)] {
        let path = url.path
        let stamp = fileStamp(of: url, fileManager: fileManager)
        messagesCacheLock.lock()
        if let hit = messagesCache[path], hit.stamp == stamp {
            let messages = hit.messages
            messagesCacheLock.unlock()
            return messages
        }
        messagesCacheLock.unlock()

        let messages = parseMessages(from: url, fileManager: fileManager)
        messagesCacheLock.lock()
        messagesCache[path] = CacheEntry(stamp: stamp, messages: messages)
        parsedFileCount += 1
        messagesCacheLock.unlock()
        return messages
    }

    /// 扫描后清理已不存在的文件条目，保持缓存有界。
    private static func pruneCache(keeping paths: Set<String>) {
        messagesCacheLock.lock()
        if messagesCache.keys.contains(where: { !paths.contains($0) }) {
            messagesCache = messagesCache.filter { paths.contains($0.key) }
        }
        messagesCacheLock.unlock()
    }

    // MARK: - 文件扫描与解析

    private static func enumerateSessionFiles(root: URL, fileManager: FileManager) -> [URL] {
        guard let enumerator = fileManager.enumerator(
            at: root,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }
        var files: [URL] = []
        for case let url as URL in enumerator where url.pathExtension.lowercased() == "jsonl" {
            files.append(url)
        }
        return files
    }

    /// 逐行解析，只保留 `role == "assistant"`、cost > 0、带毫秒时间戳的消息。
    /// 同时提取 provider（`message["provider"]`；缺省时从 `message["model"]`
    /// 的第一个 `/` 之前取前缀），供调用方按余额提供方过滤。
    /// 坏行 / 不可读文件直接跳过，不抛错。
    private static func parseMessages(from url: URL, fileManager: FileManager) -> [(ts: Date, cost: Double, provider: String?)] {
        guard fileManager.fileExists(atPath: url.path),
              let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .utf8) else { return [] }
        var messages: [(ts: Date, cost: Double, provider: String?)] = []
        messages.reserveCapacity(min(text.count / 2048 + 16, 100_000))
        for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
            guard let lineData = line.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                  (obj["type"] as? String) == "message",
                  let message = obj["message"] as? [String: Any],
                  (message["role"] as? String) == "assistant",
                  let usage = message["usage"] as? [String: Any] else { continue }
            // 与 TokenLedger.UsageSnapshot.from 相同的 cost 形状：Double 或 {"total": Double}。
            let cost = (usage["cost"] as? Double)
                ?? ((usage["cost"] as? [String: Any])?["total"] as? Double)
                ?? 0
            guard cost > 0,
                  let ms = message["timestamp"] as? NSNumber else { continue }
            // 真实 pi 文件里带 usage 的 assistant 消息都有 message.provider；
            // 缺省时退回 message.model 的 `provider/model` 前缀。
            let provider: String? = {
                if let p = message["provider"] as? String, !p.isEmpty { return p }
                guard let model = message["model"] as? String,
                      let slash = model.firstIndex(of: "/") else { return nil }
                let prefix = String(model[..<slash])
                return prefix.isEmpty ? nil : prefix
            }()
            messages.append((ts: Date(timeIntervalSince1970: ms.doubleValue / 1000), cost: cost, provider: provider))
        }
        return messages
    }

    private static func makeNameDateFormatter() -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd'T'HH-mm-ss-SSS'Z'"
        return f
    }

    /// 文件名前缀（首个下划线之前），如 `2026-07-24T16-01-21-938Z`（连字符分隔、
    /// 3 位毫秒）。严格格式；解析失败返回 nil → 该文件贡献 0。
    private static func parseNameDate(_ url: URL, formatter: DateFormatter) -> Date? {
        let base = url.deletingPathExtension().lastPathComponent
        let prefix = base.split(separator: "_", maxSplits: 1).first.map(String.init) ?? base
        return formatter.date(from: prefix)
    }

    /// Rule B：`sortedFirstTs` 中是否存在与 `date` 相差 ≤ 5 分钟的时间点（二分查找）。
    private static func isWithinFiveMinutes(_ date: Date, of sortedFirstTs: [Date]) -> Bool {
        guard !sortedFirstTs.isEmpty else { return false }
        let windowStart = date.addingTimeInterval(-5 * 60)
        var lo = 0, hi = sortedFirstTs.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if sortedFirstTs[mid] < windowStart { lo = mid + 1 } else { hi = mid }
        }
        guard lo < sortedFirstTs.count else { return false }
        return sortedFirstTs[lo].timeIntervalSince(date) <= 5 * 60
    }

    // MARK: - 时间戳 / 文件指纹

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

    private static func parseLedgerTimestamp(_ ts: String) -> Date? {
        fractionalTimestampFormatter.date(from: ts) ?? plainTimestampFormatter.date(from: ts)
    }

    private static func fileStamp(of url: URL, fileManager: FileManager) -> FileStamp {
        guard let attrs = try? fileManager.attributesOfItem(atPath: url.path) else {
            return FileStamp(mtime: nil, size: nil)
        }
        return FileStamp(mtime: attrs[.modificationDate] as? Date, size: attrs[.size] as? NSNumber)
    }
}
