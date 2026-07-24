import Foundation
import AppKit

// MARK: - Compact token formatting

enum TokenFormat {
    /// Compact token counts for footer metrics: `1.2k`, `60k`, `200k`, `1.5m`.
    static func compact(_ value: Int) -> String {
        let absValue = abs(value)
        let sign = value < 0 ? "-" : ""
        if absValue >= 1_000_000 {
            let scaled = Double(absValue) / 1_000_000
            return "\(sign)\(Self.trimDecimal(scaled))m"
        }
        if absValue >= 1000 {
            let scaled = Double(absValue) / 1000
            return "\(sign)\(Self.trimDecimal(scaled))k"
        }
        return "\(value)"
    }

    private static func trimDecimal(_ scaled: Double) -> String {
        if scaled >= 10 {
            return String(format: "%.0f", scaled)
        }
        var s = String(format: "%.1f", scaled)
        if s.hasSuffix(".0") { s.removeLast(2) }
        return s
    }

    /// Context footer string: `60k/200k 30%`, or degraded forms when fields are missing.
    static func contextStatus(tokens: Int?, window: Int?, percent: Double?) -> String? {
        let pctText = percent.map { "\(Int($0.rounded()))%" }
        switch (tokens, window) {
        case let (t?, w?):
            let base = "\(compact(t))/\(compact(w))"
            if let pctText { return "\(base) \(pctText)" }
            return base
        case (nil, let w?):
            if let pctText { return "?/\(compact(w)) \(pctText)" }
            return "?/\(compact(w))"
        case (let t?, nil):
            if let pctText { return "\(compact(t)) \(pctText)" }
            return compact(t)
        case (nil, nil):
            return pctText
        }
    }
}

// MARK: - Auth (~/.grok/auth.json)

struct GrokAuthCredentials {
    let accessToken: String
    let expiresAt: Date?
    let principalType: String?

    var isExpired: Bool {
        guard let expiresAt else { return false }
        return Date() >= expiresAt
    }

    var isTeamPrincipal: Bool {
        principalType?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .caseInsensitiveCompare("team") == .orderedSame
    }
}

enum GrokAuthStore {
    static let oidcScopePrefix = "https://auth.x.ai::"
    static let legacySessionScope = "https://accounts.x.ai/sign-in"

    static func grokHomeURL(
        env: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) -> URL {
        if let custom = env["GROK_HOME"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !custom.isEmpty {
            return URL(fileURLWithPath: (custom as NSString).expandingTildeInPath, isDirectory: true)
        }
        return fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent(".grok", isDirectory: true)
    }

    static func authFileURL(
        env: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) -> URL {
        grokHomeURL(env: env, fileManager: fileManager).appendingPathComponent("auth.json")
    }

    static func load(
        env: [String: String] = ProcessInfo.processInfo.environment
    ) -> GrokAuthCredentials? {
        let url = authFileURL(env: env)
        guard FileManager.default.fileExists(atPath: url.path),
              let data = try? Data(contentsOf: url)
        else { return nil }
        return parse(data: data)
    }

    static func parse(data: Data) -> GrokAuthCredentials? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        guard let (_, entry) = selectPreferredEntry(in: root),
              let key = entry["key"] as? String,
              !key.isEmpty
        else { return nil }

        return GrokAuthCredentials(
            accessToken: key,
            expiresAt: parseDate(entry["expires_at"]),
            principalType: (entry["principal_type"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .nilIfEmpty
        )
    }

    private static func selectPreferredEntry(
        in root: [String: Any]
    ) -> (scope: String, entry: [String: Any])? {
        var oidc: (String, [String: Any])?
        var legacy: (String, [String: Any])?
        for (scope, value) in root {
            guard let entry = value as? [String: Any],
                  let key = entry["key"] as? String,
                  !key.isEmpty
            else { continue }
            if scope.hasPrefix(oidcScopePrefix) {
                oidc = (scope, entry)
            } else if scope == legacySessionScope || scope.contains("/sign-in") {
                legacy = (scope, entry)
            }
        }
        return oidc ?? legacy
    }

    private static func parseDate(_ raw: Any?) -> Date? {
        guard let value = raw as? String, !value.isEmpty else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }
}

// MARK: - Web billing snapshot

struct PeriodUsage: Equatable, Identifiable {
    /// 周期类型 enum 原始值（来自 [1,7,1]）。持久化引用用。
    let typeRaw: Int
    /// 5小时 / 周 / 月 / 额
    let label: String
    /// 0…100
    let percent: Double
    let resetDate: Date?
    var id: Int { typeRaw }
}

struct GrokCreditsSnapshot: Equatable {
    /// 0…100 usage against included credits.
    var usedPercent: Double
    var resetsAt: Date?
    /// Compact period glyph for footer: 周 / 月 / 额
    var periodLabel: String
    /// Help tooltip: 周额度 / 月额度 / 额度
    var periodHelp: String
    var periods: [PeriodUsage] = []

    /// Prefer full billing-window length (start→end); fall back to time-until-reset.
    static func period(
        resetsAt: Date?,
        periodStart: Date? = nil,
        now: Date = Date()
    ) -> (label: String, help: String) {
        if let resetsAt, let periodStart {
            let window = resetsAt.timeIntervalSince(periodStart)
            if let labeled = label(forDuration: window) { return labeled }
        }
        if let resetsAt {
            let untilReset = resetsAt.timeIntervalSince(now)
            if let labeled = label(forDuration: untilReset) { return labeled }
        }
        return ("额", "额度")
    }

    private static func label(forDuration seconds: TimeInterval) -> (label: String, help: String)? {
        guard seconds > 3600 else { return nil }
        let hours = seconds / 3600
        if (4.5...5.5).contains(hours) { return ("5小时", "5小时额度") }
        let days = Int((seconds / 86400).rounded(.toNearestOrAwayFromZero))
        if (4...12).contains(days) { return ("周", "周额度") }
        if (20...45).contains(days) { return ("月", "月额度") }
        return nil
    }
}

// MARK: - gRPC-web billing fetch

/// Minimal port of CodexBar's working grok.com billing path (bearer from `~/.grok/auth.json`).
enum GrokWebBilling {
    static let defaultEndpoint =
        URL(string: "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig")!

    private static let requestTimeoutSeconds: TimeInterval = 15

    static func fetch(
        credentials: GrokAuthCredentials,
        endpoint: URL = defaultEndpoint,
        session: URLSession = .shared,
        now: Date = Date()
    ) async throws -> GrokCreditsSnapshot {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = requestTimeoutSeconds
        // Empty gRPC-web frame (5-byte header + 0-length message).
        request.httpBody = Data([0x00, 0x00, 0x00, 0x00, 0x00])
        request.setValue("Bearer \(credentials.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("https://grok.com", forHTTPHeaderField: "Origin")
        request.setValue("https://grok.com/?_s=usage", forHTTPHeaderField: "Referer")
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        request.setValue("application/grpc-web+proto", forHTTPHeaderField: "Content-Type")
        request.setValue("1", forHTTPHeaderField: "x-grpc-web")
        request.setValue("connect-es/2.1.1", forHTTPHeaderField: "x-user-agent")
        request.setValue("PipiUI", forHTTPHeaderField: "User-Agent")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw BillingError.invalidResponse
        }
        guard http.statusCode == 200 else {
            let body = String(data: data.prefix(200), encoding: .utf8) ?? ""
            throw BillingError.httpStatus(http.statusCode, body)
        }
        try validateGRPCStatusFields(grpcHeaderFields(from: http.allHeaderFields))
        try validateGRPCWebTrailers(data)

        let parsed = try parseGRPCWebResponse(data, now: now)
        let period = GrokCreditsSnapshot.period(
            resetsAt: parsed.resetsAt,
            periodStart: parsed.periodStart,
            now: now
        )
        return GrokCreditsSnapshot(
            usedPercent: parsed.usedPercent,
            resetsAt: parsed.resetsAt,
            periodLabel: period.label,
            periodHelp: period.help
        )
    }

    enum BillingError: Error {
        case invalidResponse
        case httpStatus(Int, String)
        case rpcFailed(Int, String)
        case emptyResponse
        case parseFailed
    }

    // MARK: Protobuf / gRPC-web parsing (simplified from CodexBar)

    struct ParsedBilling: Equatable {
        var usedPercent: Double
        var resetsAt: Date?
        var periodStart: Date?
    }

    static func parseGRPCWebResponse(_ data: Data, now: Date = Date()) throws -> ParsedBilling {
        var payloads = grpcWebDataFrames(from: data)
        if payloads.isEmpty, looksLikeProtobufPayload(data) {
            payloads = [data]
        }
        guard !payloads.isEmpty else { throw BillingError.emptyResponse }

        var scan = ProtobufScan()
        for payload in payloads {
            scan.merge(scanProtobuf(payload, depth: 0))
        }

        let parsedPercent = scan.fixed32Fields
            .filter { field in
                field.path.last == 1 && field.value.isFinite && field.value >= 0 && field.value <= 100
            }
            .min { lhs, rhs in
                lhs.path.count == rhs.path.count ? lhs.order < rhs.order : lhs.path.count < rhs.path.count
            }
            .map { Double($0.value) }

        let timestampFields = scan.varintFields.compactMap { field -> (path: [UInt64], date: Date)? in
            let raw = field.value
            guard raw >= 1_700_000_000, raw <= 2_100_000_000 else { return nil }
            return (field.path, Date(timeIntervalSince1970: TimeInterval(raw)))
        }

        // Prefer documented paths: period start [1,4,1], reset/end [1,5,1].
        let periodStart = timestampFields
            .filter { $0.path == [1, 4, 1] }
            .map(\.date)
            .min()
            ?? timestampFields
            .filter { $0.date <= now }
            .map(\.date)
            .max()

        let futureResets = timestampFields.filter { $0.date > now }
        let reset = futureResets
            .filter { $0.path == [1, 5, 1] }
            .map(\.date)
            .min()
            ?? futureResets.map(\.date).min()

        let hasUsagePeriod = scan.varintFields.contains { field in
            field.path.starts(with: [1, 6]) ||
                (field.path == [1, 8, 1] && (field.value == 1 || field.value == 2))
        }
        let noUsageYet = parsedPercent == nil &&
            scan.fixed32Fields.isEmpty &&
            reset != nil &&
            hasUsagePeriod
        guard let percent = parsedPercent ?? (noUsageYet ? 0 : nil) else {
            throw BillingError.parseFailed
        }
        return ParsedBilling(usedPercent: percent, resetsAt: reset, periodStart: periodStart)
    }

    private static func looksLikeProtobufPayload(_ data: Data) -> Bool {
        guard let first = data.first else { return false }
        let fieldNumber = first >> 3
        let wireType = first & 0x07
        return fieldNumber > 0 && (wireType == 0 || wireType == 1 || wireType == 2 || wireType == 5)
    }

    private static func grpcWebDataFrames(from data: Data) -> [Data] {
        let bytes = [UInt8](data)
        var frames: [Data] = []
        var index = 0
        while index < bytes.count {
            guard index + 5 <= bytes.count else { return [] }
            let flags = bytes[index]
            let length = (Int(bytes[index + 1]) << 24)
                | (Int(bytes[index + 2]) << 16)
                | (Int(bytes[index + 3]) << 8)
                | Int(bytes[index + 4])
            let start = index + 5
            let end = start + length
            guard length >= 0, end <= bytes.count else { return [] }
            if flags & 0x80 == 0 {
                frames.append(Data(bytes[start..<end]))
            }
            index = end
        }
        return frames
    }

    private static func validateGRPCWebTrailers(_ data: Data) throws {
        try validateGRPCStatusFields(grpcWebTrailerFields(from: data))
    }

    private static func validateGRPCStatusFields(_ fields: [String: String]) throws {
        guard let rawStatus = fields["grpc-status"],
              let status = Int(rawStatus),
              status != 0
        else { return }
        throw BillingError.rpcFailed(status, fields["grpc-message"] ?? "")
    }

    private static func grpcHeaderFields(from headers: [AnyHashable: Any]) -> [String: String] {
        var fields: [String: String] = [:]
        for (key, value) in headers {
            let normalizedKey = String(describing: key)
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
            guard normalizedKey.hasPrefix("grpc-") else { continue }
            fields[normalizedKey] = String(describing: value)
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .removingPercentEncoding ?? ""
        }
        return fields
    }

    private static func grpcWebTrailerFields(from data: Data) -> [String: String] {
        let bytes = [UInt8](data)
        var fields: [String: String] = [:]
        var index = 0
        while index + 5 <= bytes.count {
            let flags = bytes[index]
            let length = (Int(bytes[index + 1]) << 24)
                | (Int(bytes[index + 2]) << 16)
                | (Int(bytes[index + 3]) << 8)
                | Int(bytes[index + 4])
            let start = index + 5
            let end = start + length
            guard length >= 0, end <= bytes.count else { break }
            if flags & 0x80 != 0, let text = String(data: Data(bytes[start..<end]), encoding: .utf8) {
                for line in text.components(separatedBy: .newlines) where !line.isEmpty {
                    guard let separator = line.firstIndex(of: ":") else { continue }
                    let key = line[..<separator]
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                        .lowercased()
                    let value = line[line.index(after: separator)...]
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                        .removingPercentEncoding ?? ""
                    fields[key] = value
                }
            }
            index = end
        }
        return fields
    }

    private struct ProtobufScan {
        struct Fixed32Field {
            var path: [UInt64]
            var value: Float
            var order: Int
        }

        struct VarintField {
            var path: [UInt64]
            var value: UInt64
        }

        var fixed32Fields: [Fixed32Field] = []
        var varintFields: [VarintField] = []

        mutating func merge(_ other: ProtobufScan) {
            fixed32Fields.append(contentsOf: other.fixed32Fields)
            varintFields.append(contentsOf: other.varintFields)
        }
    }

    private static func scanProtobuf(_ data: Data, depth: Int) -> ProtobufScan {
        scanProtobuf(data, depth: depth, path: [], order: 0).scan
    }

    private static func scanProtobuf(
        _ data: Data,
        depth: Int,
        path: [UInt64],
        order: Int
    ) -> (scan: ProtobufScan, order: Int) {
        let bytes = [UInt8](data)
        var scan = ProtobufScan()
        var index = 0
        var nextOrder = order

        while index < bytes.count {
            let fieldStart = index
            guard let key = readVarint(bytes, index: &index), key != 0 else {
                index = fieldStart + 1
                continue
            }
            let fieldNumber = key >> 3
            let wireType = key & 0x07
            let fieldPath = path + [fieldNumber]

            switch wireType {
            case 0:
                if let value = readVarint(bytes, index: &index) {
                    scan.varintFields.append(ProtobufScan.VarintField(path: fieldPath, value: value))
                } else {
                    index = fieldStart + 1
                }
            case 1:
                guard index + 8 <= bytes.count else { return (scan, nextOrder) }
                index += 8
            case 2:
                guard let length = readVarint(bytes, index: &index),
                      length <= UInt64(bytes.count - index)
                else {
                    index = fieldStart + 1
                    continue
                }
                let start = index
                let end = index + Int(length)
                if depth < 4 {
                    let nested = scanProtobuf(
                        Data(bytes[start..<end]),
                        depth: depth + 1,
                        path: fieldPath,
                        order: nextOrder
                    )
                    scan.merge(nested.scan)
                    nextOrder = nested.order
                }
                index = end
            case 5:
                guard index + 4 <= bytes.count else { return (scan, nextOrder) }
                let bitPattern = UInt32(bytes[index])
                    | (UInt32(bytes[index + 1]) << 8)
                    | (UInt32(bytes[index + 2]) << 16)
                    | (UInt32(bytes[index + 3]) << 24)
                scan.fixed32Fields.append(ProtobufScan.Fixed32Field(
                    path: fieldPath,
                    value: Float(bitPattern: bitPattern),
                    order: nextOrder
                ))
                nextOrder += 1
                index += 4
            default:
                index = fieldStart + 1
            }
        }
        return (scan, nextOrder)
    }

    private static func readVarint(_ bytes: [UInt8], index: inout Int) -> UInt64? {
        var value: UInt64 = 0
        var shift: UInt64 = 0
        while index < bytes.count, shift < 64 {
            let byte = bytes[index]
            index += 1
            value |= UInt64(byte & 0x7F) << shift
            if byte & 0x80 == 0 { return value }
            shift += 7
        }
        return nil
    }
}

// MARK: - Shared quota monitor (cache + gentle polling)

/// App-wide Grok credit usage cache. Failures are silent; last good value is kept.
/// Callers are expected on the main thread (same convention as ChatSession).
final class GrokQuotaMonitor {
    static let shared = GrokQuotaMonitor()

    private(set) var snapshot: GrokCreditsSnapshot?
    private var lastAttemptAt: Date?
    private var lastSuccessAt: Date?
    private var inFlight = false
    private var timer: Timer?
    private var activeObserver: NSObjectProtocol?
    private var listeners: [UUID: (GrokCreditsSnapshot?) -> Void] = [:]

    /// Don't hammer the network harder than once per minute.
    private let minAttemptInterval: TimeInterval = 60
    /// Consider cache stale after 3 minutes.
    private let staleAfter: TimeInterval = 3 * 60
    /// Background poll cadence.
    private let pollInterval: TimeInterval = 5 * 60

    private init() {}

    /// Register for snapshot updates. Immediately receives the cached value (if any).
    @discardableResult
    func observe(_ handler: @escaping (GrokCreditsSnapshot?) -> Void) -> UUID {
        let id = UUID()
        listeners[id] = handler
        handler(snapshot)
        ensureStarted()
        refreshIfNeeded(force: false)
        return id
    }

    func removeObserver(_ id: UUID) {
        listeners.removeValue(forKey: id)
    }

    func ensureStarted() {
        if timer == nil {
            let t = Timer(timeInterval: pollInterval, repeats: true) { [weak self] _ in
                self?.refreshIfNeeded(force: false)
            }
            RunLoop.main.add(t, forMode: .common)
            timer = t
        }
        if activeObserver == nil {
            activeObserver = NotificationCenter.default.addObserver(
                forName: NSApplication.didBecomeActiveNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.refreshIfNeeded(force: false)
            }
        }
    }

    func refreshIfNeeded(force: Bool) {
        let now = Date()
        if !force,
           let lastSuccessAt,
           now.timeIntervalSince(lastSuccessAt) < staleAfter {
            return
        }
        if !force,
           let lastAttemptAt,
           now.timeIntervalSince(lastAttemptAt) < minAttemptInterval {
            return
        }
        guard !inFlight else { return }
        guard let credentials = GrokAuthStore.load(), !credentials.isExpired else {
            // Keep last good snapshot; don't clear on missing auth.
            return
        }
        // Team principals often can't read personal credit surface — skip quietly.
        if credentials.isTeamPrincipal { return }

        inFlight = true
        lastAttemptAt = now
        Task { [weak self] in
            let result: GrokCreditsSnapshot?
            do {
                result = try await GrokWebBilling.fetch(credentials: credentials)
            } catch {
                result = nil
            }
            DispatchQueue.main.async {
                guard let self else { return }
                self.inFlight = false
                if let result {
                    self.snapshot = result
                    self.lastSuccessAt = Date()
                    self.publish()
                }
                // On failure: keep prior cache, no error UI.
            }
        }
    }

    private func publish() {
        let snap = snapshot
        for handler in listeners.values {
            handler(snap)
        }
    }
}

private extension String {
    var nilIfEmpty: String? {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self
    }
}
