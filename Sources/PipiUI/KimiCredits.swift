import Foundation
import SQLite3

// MARK: - Models

struct KimiUsageDetail: Equatable {
    let limit: String
    let used: String?
    let remaining: String?
    let resetTime: String?
}

struct KimiMonthlyWindow: Equatable {
    let usedPercent: Double
    let resetsAt: Date?
}

struct KimiParsedUsage: Equatable {
    let weekly: KimiUsageDetail
    let rateLimit: KimiUsageDetail?
}

// MARK: - .env fallback (shared by Kimi/GLM quota modules)

/// Merges process environment with the cached `~/.pi/agent/.env` store.
/// Process env wins; `.env` entries only fill in missing keys. This lets
/// GUI launches (no shell env) still pick up keys written to the dotenv file.
/// EnvFileStore reads are lock-guarded and mtime-cached, safe from background Tasks.
enum QuotaEnvFallback {
    /// Shared default store (mtime-cached reads).
    private static let sharedStore = EnvFileStore()

    /// Injectable `.env` value source — tests override to isolate from the
    /// real user file; must be restored in tearDown.
    static var envFileValues: () -> [String: String] = { sharedStore.all() }

    /// `.env` as base layer, `env` overlaid on top (injected/process values win).
    static func merged(_ env: [String: String]) -> [String: String] {
        envFileValues().merging(env) { _, injected in injected }
    }
}

// MARK: - Auth

/// Resolves Kimi Code bearers and optional web `kimi-auth` for monthly enrichment.
/// Priority mirrors CodexBar (scheme A): pi auth.json → env → CLI credential;
/// web: env → Kimi Desktop Cookies (no browser SweetCookieKit import).
enum KimiAuthStore {
    static func defaultAuthURL() -> URL {
        URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
            .appendingPathComponent(".pi/agent/auth.json", isDirectory: false)
    }

    static func defaultKimiCodeHome(
        env: [String: String] = ProcessInfo.processInfo.environment
    ) -> URL {
        let env = QuotaEnvFallback.merged(env)
        if let raw = cleaned(env["KIMI_CODE_HOME"]) {
            return URL(fileURLWithPath: raw, isDirectory: true)
        }
        return URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
            .appendingPathComponent(".kimi-code", isDirectory: true)
    }

    /// Bearer for `GET …/coding/v1/usages`.
    static func resolveCodeBearer(
        authURL: URL = defaultAuthURL(),
        env: [String: String] = ProcessInfo.processInfo.environment,
        kimiCodeHome: URL? = nil,
        now: Date = Date()
    ) -> String? {
        let env = QuotaEnvFallback.merged(env)
        if let fromPi = loadFromPiAuth(authURL: authURL) { return fromPi }
        if let v = cleaned(env["KIMI_CODE_API_KEY"]) { return v }
        if let v = cleaned(env["KIMI_API_KEY"]) { return v }
        let home = kimiCodeHome ?? defaultKimiCodeHome(env: env)
        return loadFreshCLIAccessToken(home: home, now: now)
    }

    /// Optional `kimi-auth` for GetSubscriptionStats / web GetUsages.
    static func resolveWebAuthToken(
        env: [String: String] = ProcessInfo.processInfo.environment,
        desktopLoader: () -> String? = { KimiDesktopAuthToken.load() }
    ) -> String? {
        let env = QuotaEnvFallback.merged(env)
        if let v = cleaned(env["KIMI_AUTH_TOKEN"]) ?? cleaned(env["kimi_auth_token"]) {
            return v
        }
        return desktopLoader()
    }

    static func loadFromPiAuth(authURL: URL) -> String? {
        guard let data = AuthFileCache.data(for: authURL),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let entry = root["kimi-coding"] as? [String: Any]
        else { return nil }

        let type = (entry["type"] as? String) ?? ""
        if type == "api_key" {
            return cleaned(entry["key"] as? String)
        }
        if type == "oauth" {
            return cleaned(entry["access"] as? String)
                ?? cleaned(entry["access_token"] as? String)
        }
        // Unknown shape: try common fields.
        return cleaned(entry["key"] as? String)
            ?? cleaned(entry["access"] as? String)
            ?? cleaned(entry["access_token"] as? String)
    }

    static func loadFreshCLIAccessToken(home: URL, now: Date) -> String? {
        let url = home
            .appendingPathComponent("credentials", isDirectory: true)
            .appendingPathComponent("kimi-code.json", isDirectory: false)
        guard let data = try? Data(contentsOf: url),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = cleaned(root["access_token"] as? String)
        else { return nil }

        let expiresAt: Double? = {
            if let d = root["expires_at"] as? Double { return d }
            if let i = root["expires_at"] as? Int { return Double(i) }
            return nil
        }()
        guard let expiresAt, expiresAt.isFinite else { return nil }
        // CodexBar: require > now + 60s.
        guard expiresAt > now.addingTimeInterval(60).timeIntervalSince1970 else { return nil }
        return token
    }

    private static func cleaned(_ raw: String?) -> String? {
        guard var s = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else {
            return nil
        }
        if (s.hasPrefix("\"") && s.hasSuffix("\"")) || (s.hasPrefix("'") && s.hasSuffix("'")) {
            s.removeFirst(); s.removeLast()
            s = s.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return s.isEmpty ? nil : s
    }
}

// MARK: - Kimi Desktop cookie (plaintext kimi-auth)

/// Reads `kimi-auth` from Kimi Desktop Electron Cookies DB (CodexBar `KimiDesktopAuthToken`).
enum KimiDesktopAuthToken {
    static func cookiesDatabaseURL(
        homeDirectory: URL = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
    ) -> URL {
        homeDirectory
            .appendingPathComponent("Library/Application Support/kimi-desktop/Cookies", isDirectory: false)
    }

    static func load(
        homeDirectory: URL = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
    ) -> String? {
        let dbURL = cookiesDatabaseURL(homeDirectory: homeDirectory)
        guard FileManager.default.isReadableFile(atPath: dbURL.path) else { return nil }

        let tempURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-kimi-desktop-cookies-\(UUID().uuidString).db")
        do {
            try FileManager.default.copyItem(at: dbURL, to: tempURL)
        } catch {
            return nil
        }
        defer { try? FileManager.default.removeItem(at: tempURL) }

        guard let token = readKimiAuth(fromSQLitePath: tempURL.path) else { return nil }
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func readKimiAuth(fromSQLitePath path: String) -> String? {
        var db: OpaquePointer?
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db else {
            return nil
        }
        defer { sqlite3_close(db) }

        let sql = """
            SELECT value, length(encrypted_value)
            FROM cookies
            WHERE name = 'kimi-auth'
              AND (host_key = 'www.kimi.com' OR host_key = '.www.kimi.com'
                   OR host_key = '.kimi.com' OR host_key = 'kimi.com')
            ORDER BY last_access_utc DESC
            LIMIT 1;
            """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            return nil
        }
        defer { sqlite3_finalize(statement) }

        guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
        if let cString = sqlite3_column_text(statement, 0) {
            let value = String(cString: cString)
            if !value.isEmpty { return value }
        }
        return nil
    }
}

// MARK: - Parse + snapshot (mirrors CodexBar KimiUsageSnapshot / fetcher)

enum KimiBilling {
    enum BillingError: Error {
        case invalidCredentials
        case apiError(String)
        case parseFailed(String)
    }

    static let codeAPIUsageURL = URL(string: "https://api.kimi.com/coding/v1/usages")!
    static let webUsagesURL = URL(
        string: "https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages"
    )!
    static let subscriptionStatsURL = URL(
        string: "https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats"
    )!

    static func parseCodeAPIUsage(_ data: Data) throws -> KimiParsedUsage {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let usageDict = root["usage"] as? [String: Any],
              let weekly = detail(from: usageDict)
        else {
            throw BillingError.parseFailed("code api usage missing")
        }
        let rate: KimiUsageDetail? = {
            guard let limits = root["limits"] as? [[String: Any]],
                  let first = limits.first,
                  let detailDict = first["detail"] as? [String: Any]
            else { return nil }
            return detail(from: detailDict)
        }()
        return KimiParsedUsage(weekly: weekly, rateLimit: rate)
    }

    static func parseWebUsages(_ data: Data) throws -> KimiParsedUsage {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let usages = root["usages"] as? [[String: Any]],
              let coding = usages.first(where: { ($0["scope"] as? String) == "FEATURE_CODING" }),
              let detailDict = coding["detail"] as? [String: Any],
              let weekly = detail(from: detailDict)
        else {
            throw BillingError.parseFailed("FEATURE_CODING missing")
        }
        let rate: KimiUsageDetail? = {
            guard let limits = coding["limits"] as? [[String: Any]],
                  let first = limits.first,
                  let d = first["detail"] as? [String: Any]
            else { return nil }
            return detail(from: d)
        }()
        return KimiParsedUsage(weekly: weekly, rateLimit: rate)
    }

    /// Parse monthly from GetSubscriptionStats. Skips ratelimitCode7d (duplicates weekly).
    static func parseMonthly(from data: Data) -> KimiMonthlyWindow? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let balance = root["subscriptionBalance"] as? [String: Any]
        else { return nil }

        if let feature = balance["feature"] as? String, feature != "FEATURE_OMNI" { return nil }
        if let type = balance["type"] as? String, type != "SUBSCRIPTION" { return nil }

        let ratio: Double? = {
            if let d = balance["amountUsedRatio"] as? Double { return d }
            if let i = balance["amountUsedRatio"] as? Int { return Double(i) }
            if let s = balance["amountUsedRatio"] as? String { return Double(s) }
            return nil
        }()
        guard let ratio, ratio.isFinite else { return nil }
        return KimiMonthlyWindow(
            usedPercent: min(100, max(0, ratio * 100)),
            resetsAt: parseDate(balance["expireTime"] as? String)
        )
    }

    static func snapshot(
        weekly: KimiUsageDetail,
        rateLimit: KimiUsageDetail?,
        monthly: KimiMonthlyWindow?
    ) -> QuotaSnapshot? {
        var windows: [QuotaWindow] = []

        if let w = window(from: weekly, id: "weekly", label: "周", title: "周额度") {
            windows.append(w)
        }
        if let rateLimit,
           let w = window(from: rateLimit, id: "fiveHour", label: "5h", title: "5小时额度")
        {
            windows.append(w)
        }
        if let monthly {
            windows.append(QuotaWindow(
                id: "monthly",
                usedPercent: monthly.usedPercent,
                resetsAt: monthly.resetsAt,
                label: "月",
                title: "月额度"
            ))
        }
        guard !windows.isEmpty else { return nil }
        return QuotaSnapshot(windows: windows, selectedWindowId: nil)
    }

    // MARK: Fetch

    static func fetchSnapshot(
        session: URLSession = .shared
    ) async throws -> QuotaSnapshot? {
        let codeBearer = KimiAuthStore.resolveCodeBearer()
        let webToken = KimiAuthStore.resolveWebAuthToken()

        let parsed: KimiParsedUsage?
        if let codeBearer {
            parsed = try await fetchCodeAPI(bearer: codeBearer, session: session)
        } else if let webToken {
            parsed = try await fetchWebUsages(authToken: webToken, session: session)
        } else {
            return nil
        }
        guard let parsed else { return nil }

        var monthly: KimiMonthlyWindow?
        if let webToken {
            monthly = try? await fetchMonthly(authToken: webToken, session: session)
        }
        return snapshot(weekly: parsed.weekly, rateLimit: parsed.rateLimit, monthly: monthly)
    }

    private static func fetchCodeAPI(
        bearer: String,
        session: URLSession
    ) async throws -> KimiParsedUsage {
        var request = URLRequest(url: codeAPIUsageURL)
        request.httpMethod = "GET"
        request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 15

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw BillingError.apiError("no http response")
        }
        guard http.statusCode == 200 else {
            let body = String(data: data.prefix(200), encoding: .utf8) ?? ""
            throw BillingError.apiError("HTTP \(http.statusCode): \(body)")
        }
        return try parseCodeAPIUsage(data)
    }

    private static func fetchWebUsages(
        authToken: String,
        session: URLSession
    ) async throws -> KimiParsedUsage {
        var request = webRequest(url: webUsagesURL, authToken: authToken)
        request.httpBody = try JSONSerialization.data(withJSONObject: ["scope": ["FEATURE_CODING"]])

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw BillingError.apiError("GetUsages HTTP \(code)")
        }
        return try parseWebUsages(data)
    }

    private static func fetchMonthly(
        authToken: String,
        session: URLSession
    ) async throws -> KimiMonthlyWindow? {
        var request = webRequest(url: subscriptionStatsURL, authToken: authToken)
        request.httpBody = Data("{}".utf8)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            return nil
        }
        return parseMonthly(from: data)
    }

    private static func webRequest(url: URL, authToken: String) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue("kimi-auth=\(authToken)", forHTTPHeaderField: "Cookie")
        request.setValue("https://www.kimi.com", forHTTPHeaderField: "Origin")
        request.setValue("https://www.kimi.com/code/console", forHTTPHeaderField: "Referer")
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        request.setValue("en-US,en;q=0.9", forHTTPHeaderField: "Accept-Language")
        let userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("1", forHTTPHeaderField: "connect-protocol-version")
        request.setValue("en-US", forHTTPHeaderField: "x-language")
        request.setValue("web", forHTTPHeaderField: "x-msh-platform")
        request.setValue(TimeZone.current.identifier, forHTTPHeaderField: "r-timezone")
        request.timeoutInterval = 15

        if let session = decodeSessionInfo(from: authToken) {
            if let deviceId = session.deviceId {
                request.setValue(deviceId, forHTTPHeaderField: "x-msh-device-id")
            }
            if let sessionId = session.sessionId {
                request.setValue(sessionId, forHTTPHeaderField: "x-msh-session-id")
            }
            if let trafficId = session.trafficId {
                request.setValue(trafficId, forHTTPHeaderField: "x-traffic-id")
            }
        }
        return request
    }

    // MARK: Helpers

    private static func detail(from dict: [String: Any]) -> KimiUsageDetail? {
        guard let limit = stringValue(dict["limit"]) else { return nil }
        let reset = stringValue(dict["resetTime"])
            ?? stringValue(dict["resetAt"])
            ?? stringValue(dict["reset_time"])
            ?? stringValue(dict["reset_at"])
        return KimiUsageDetail(
            limit: limit,
            used: stringValue(dict["used"]),
            remaining: stringValue(dict["remaining"]),
            resetTime: reset
        )
    }

    private static func window(
        from detail: KimiUsageDetail,
        id: String,
        label: String,
        title: String
    ) -> QuotaWindow? {
        guard let limit = Int(detail.limit), limit > 0 else { return nil }
        let remaining = detail.remaining.flatMap(Int.init)
        let used: Int = {
            if let u = detail.used.flatMap(Int.init) { return u }
            if let remaining { return max(0, limit - remaining) }
            return 0
        }()
        let pct = min(100, max(0, Double(used) / Double(limit) * 100))
        return QuotaWindow(
            id: id,
            usedPercent: pct,
            resetsAt: parseDate(detail.resetTime),
            label: label,
            title: title
        )
    }

    private static func stringValue(_ any: Any?) -> String? {
        if let s = any as? String {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        }
        if let i = any as? Int { return String(i) }
        if let i = any as? Int64 { return String(i) }
        if let d = any as? Double {
            if d.rounded(.towardZero) == d,
               d >= Double(Int64.min),
               d <= Double(Int64.max)
            {
                return String(Int64(d))
            }
            return String(d)
        }
        return nil
    }

    private static func parseDate(_ dateString: String?) -> Date? {
        guard let dateString else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = fractional.date(from: dateString) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: dateString)
    }

    private struct SessionInfo {
        let deviceId: String?
        let sessionId: String?
        let trafficId: String?
    }

    private static func decodeSessionInfo(from jwt: String) -> SessionInfo? {
        let parts = jwt.split(separator: ".", maxSplits: 2)
        guard parts.count == 3 else { return nil }
        var payload = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while payload.count % 4 != 0 { payload += "=" }
        guard let payloadData = Data(base64Encoded: payload),
              let json = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any]
        else { return nil }
        return SessionInfo(
            deviceId: json["device_id"] as? String,
            sessionId: json["ssid"] as? String,
            trafficId: json["sub"] as? String
        )
    }
}

// MARK: - Monitor

final class KimiQuotaMonitor: QuotaMonitor {
    static let shared = KimiQuotaMonitor()
    private let core = QuotaMonitorCore()

    private init() {
        core.fetcher = { [weak self] _ in try await self?.fetchKimi() }
    }

    var snapshot: QuotaSnapshot? { core.snapshot }

    @discardableResult
    func observe(_ handler: @escaping (QuotaSnapshot?) -> Void) -> UUID {
        core.observe(handler)
    }

    func removeObserver(_ id: UUID) { core.removeObserver(id) }

    func refreshIfNeeded(force: Bool) { core.refreshIfNeeded(force: force) }

    private func fetchKimi() async throws -> QuotaSnapshot? {
        try await KimiBilling.fetchSnapshot()
    }
}
