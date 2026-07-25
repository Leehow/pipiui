import Foundation

// MARK: - Models

/// Parsed `GET /api/v2/quota/usage` response. Credits are doubles in the API
/// (e.g. 6000.0) but display as whole numbers.
struct QoderParsedUsage: Equatable {
    let used: Double
    let total: Double
    let remaining: Double
    /// 0…1 merged usage ratio (from `totalUsagePercentage`).
    let usageFraction: Double
    let resetsAt: Date?

    var usedPercent: Double { min(100, max(0, usageFraction * 100)) }
}

// MARK: - Auth

/// Resolves Qoder credentials from pi's `auth.json` (`qoder-cn` / `qoder` entries
/// written by the pi-provider-qoder npm extension).
///
/// Entry shape (type "oauth"):
///   access:  job token (short-lived, ~2 days)
///   expires: milliseconds since epoch
///   refresh: "pat|<PAT>|<jrt>|<uid>|<mid>"  (see extension's pat.ts)
///
/// The PAT (personal access token) can be exchanged for a fresh job token via
/// `POST /api/v1/jobToken/exchange`. We never write back to auth.json — exchanged
/// tokens live in an in-memory cache only.
enum QoderAuthStore {
    enum Region: String {
        case cn = "qoder-cn"
        case international = "qoder"

        var openAPIBase: String {
            switch self {
            case .cn: return "https://openapi.qoder.com.cn"
            case .international: return "https://openapi.qoder.sh"
            }
        }
    }

    struct Credentials: Equatable {
        let region: Region
        let access: String?
        let accessExpires: Date?
        let pat: String?

        var accessValid: Bool {
            guard access != nil else { return false }
            guard let accessExpires else { return true }
            // 5-minute buffer, mirroring the extension's stored `expires`.
            return accessExpires > Date().addingTimeInterval(300)
        }
    }

    static func defaultAuthURL() -> URL {
        URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
            .appendingPathComponent(".pi/agent/auth.json", isDirectory: false)
    }

    static func load(authURL: URL = defaultAuthURL()) -> Credentials? {
        guard let data = AuthFileCache.data(for: authURL),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        // Prefer the CN entry when both exist.
        for region in [Region.cn, Region.international] {
            if let entry = root[region.rawValue] as? [String: Any],
               let creds = parse(entry: entry, region: region)
            {
                return creds
            }
        }
        return nil
    }

    private static func parse(entry: [String: Any], region: Region) -> Credentials? {
        let access = cleaned(entry["access"] as? String)
            ?? cleaned(entry["access_token"] as? String)
        let pat = patFromRefresh(entry["refresh"] as? String)

        let expiresMs: Double? = {
            if let d = entry["expires"] as? Double { return d }
            if let i = entry["expires"] as? Int { return Double(i) }
            return nil
        }()
        let expires = expiresMs.map { Date(timeIntervalSince1970: $0 / 1000) }

        guard access != nil || pat != nil else { return nil }
        return Credentials(region: region, access: access, accessExpires: expires, pat: pat)
    }

    /// `refresh` is "pat|<PAT>|<jrt>|<uid>|<mid>" — second segment is the PAT.
    static func patFromRefresh(_ refresh: String?) -> String? {
        guard let raw = cleaned(refresh) else { return nil }
        let parts = raw.split(separator: "|", omittingEmptySubsequences: false)
        guard parts.count >= 2, parts[0] == "pat" else { return nil }
        let pat = String(parts[1]).trimmingCharacters(in: .whitespacesAndNewlines)
        return pat.isEmpty ? nil : pat
    }

    private static func cleaned(_ raw: String?) -> String? {
        guard let s = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else {
            return nil
        }
        return s
    }
}

/// In-memory cache for PAT-exchanged job tokens (never persisted to auth.json).
final class QoderTokenCache {
    static let shared = QoderTokenCache()
    private let lock = NSLock()
    private var token: String?
    private var expiresAt: Date?

    func current() -> String? {
        lock.lock(); defer { lock.unlock() }
        guard let token, let expiresAt, expiresAt > Date().addingTimeInterval(300) else {
            return nil
        }
        return token
    }

    func store(_ token: String, expiresAt: Date) {
        lock.lock()
        self.token = token
        self.expiresAt = expiresAt
        lock.unlock()
    }
}

// MARK: - Billing / fetch (mirrors CodexBar QoderUsageFetcher merge logic)

enum QoderBilling {
    enum BillingError: Error {
        case unauthorized
        case apiError(String)
        case parseFailed(String)
    }

    static func usageURL(region: QoderAuthStore.Region) -> URL {
        URL(string: "\(region.openAPIBase)/api/v2/quota/usage")!
    }

    static func exchangeURL(region: QoderAuthStore.Region) -> URL {
        URL(string: "\(region.openAPIBase)/api/v1/jobToken/exchange")!
    }

    // MARK: Parse

    /// Parse the usage response, merging `userQuota` + `addOnQuota`:
    /// used/total/remaining are summed; percentage prefers `totalUsagePercentage`
    /// (falls back to used/total); reset comes from top-level `expiresAt` (ms).
    static func parseUsage(_ data: Data) throws -> QoderParsedUsage {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let userQuota = root["userQuota"] as? [String: Any]
        else {
            throw BillingError.parseFailed("userQuota missing")
        }

        let addOn = root["addOnQuota"] as? [String: Any]
        let used = numberOrZero(userQuota["used"]) + numberOrZero(addOn?["used"])
        let total = numberOrZero(userQuota["total"]) + numberOrZero(addOn?["total"])
        let remaining = numberOrZero(userQuota["remaining"]) + numberOrZero(addOn?["remaining"])
        guard total > 0 else {
            throw BillingError.parseFailed("quota total is zero")
        }

        let fraction: Double = {
            if let f = number(root["totalUsagePercentage"]), f.isFinite { return f }
            return used / total
        }()

        let resetsAt: Date? = {
            if let ms = number(root["expiresAt"]), ms > 0 {
                return Date(timeIntervalSince1970: ms / 1000)
            }
            return nil
        }()

        return QoderParsedUsage(
            used: used, total: total, remaining: remaining,
            usageFraction: fraction, resetsAt: resetsAt
        )
    }

    static func snapshot(from usage: QoderParsedUsage) -> QuotaSnapshot {
        QuotaSnapshot(
            windows: [QuotaWindow(
                id: "credits",
                usedPercent: usage.usedPercent,
                resetsAt: usage.resetsAt,
                label: "额",
                title: "订阅额度"
            )],
            selectedWindowId: nil
        )
    }

    // MARK: Fetch

    static func fetchSnapshot(
        session: URLSession = .shared
    ) async throws -> QuotaSnapshot? {
        guard let creds = QoderAuthStore.load() else { return nil }

        // Token resolution: in-memory exchanged token → stored fresh access →
        // exchange via PAT.
        var token = QoderTokenCache.shared.current()
        if token == nil, creds.accessValid { token = creds.access }
        if token == nil, let pat = creds.pat {
            token = try await exchange(pat: pat, region: creds.region, session: session)
        }
        guard let token else { return nil }

        do {
            let usage = try await fetchUsage(token: token, region: creds.region, session: session)
            return snapshot(from: usage)
        } catch BillingError.unauthorized {
            // Job token expired/revoked: re-exchange with the PAT and retry once.
            guard let pat = creds.pat,
                  let fresh = try await exchange(pat: pat, region: creds.region, session: session)
            else { throw BillingError.unauthorized }
            let usage = try await fetchUsage(token: fresh, region: creds.region, session: session)
            return snapshot(from: usage)
        }
    }

    private static func fetchUsage(
        token: String,
        region: QoderAuthStore.Region,
        session: URLSession
    ) async throws -> QoderParsedUsage {
        var request = URLRequest(url: usageURL(region: region))
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 15

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw BillingError.apiError("no http response")
        }
        if http.statusCode == 401 || http.statusCode == 403 {
            throw BillingError.unauthorized
        }
        guard http.statusCode == 200 else {
            let body = String(data: data.prefix(200), encoding: .utf8) ?? ""
            throw BillingError.apiError("HTTP \(http.statusCode): \(body)")
        }
        return try parseUsage(data)
    }

    /// Exchange a PAT for a fresh job token. Response (per pi-provider-qoder):
    /// `{ token, refresh_token?, expires_at? (ISO string) | expires_in? (ms) }`.
    @discardableResult
    static func exchange(
        pat: String,
        region: QoderAuthStore.Region,
        session: URLSession = .shared
    ) async throws -> String? {
        var request = URLRequest(url: exchangeURL(region: region))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["personal_token": pat])
        request.timeoutInterval = 15

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = root["token"] as? String, !token.isEmpty
        else { return nil }

        let expiresAt: Date = {
            let fallback = Date().addingTimeInterval(24 * 60 * 60)
            if let iso = root["expires_at"] as? String {
                let f = ISO8601DateFormatter()
                f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                if let d = f.date(from: iso) { return d }
                f.formatOptions = [.withInternetDateTime]
                if let d = f.date(from: iso) { return d }
            }
            if let ms = number(root["expires_in"]), ms > 0 {
                return Date().addingTimeInterval(ms / 1000)
            }
            return fallback
        }()
        QoderTokenCache.shared.store(token, expiresAt: expiresAt)
        return token
    }

    // MARK: Helpers

    private static func number(_ any: Any?) -> Double? {
        if let d = any as? Double { return d }
        if let i = any as? Int { return Double(i) }
        if let s = any as? String { return Double(s) }
        return nil
    }

    private static func numberOrZero(_ any: Any?) -> Double {
        number(any) ?? 0
    }
}

// MARK: - Monitor

final class QoderQuotaMonitor: QuotaMonitor {
    static let shared = QoderQuotaMonitor()
    private let core = QuotaMonitorCore()

    private init() {
        core.fetcher = { [weak self] _ in try await self?.fetchQoder() }
    }

    var snapshot: QuotaSnapshot? { core.snapshot }

    @discardableResult
    func observe(_ handler: @escaping (QuotaSnapshot?) -> Void) -> UUID {
        core.observe(handler)
    }

    func removeObserver(_ id: UUID) { core.removeObserver(id) }

    func refreshIfNeeded(force: Bool) { core.refreshIfNeeded(force: force) }

    private func fetchQoder() async throws -> QuotaSnapshot? {
        try await QoderBilling.fetchSnapshot()
    }
}
