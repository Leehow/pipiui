import Foundation

// MARK: - Credential reader

/// Resolves Claude OAuth credentials. pi stores them at `~/.pi/agent/auth.json`
/// under the `anthropic` scope as `{type:"oauth", refresh:<token>, access:<token>,
/// expires:<epoch ms>}`. This reader maps that shape (CodexBar does not read it
/// natively — it expects `~/.claude/.credentials.json` or the Keychain).
struct ClaudeCredentials {
    let accessToken: String
    let expiresAt: Date?
    var isExpired: Bool {
        guard let expiresAt else { return false }
        return expiresAt < Date()
    }
}

enum ClaudeAuthStore {
    static func authFileURL() -> URL {
        URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
            .appendingPathComponent(".pi/agent/auth.json", isDirectory: false)
    }

    static func load() -> ClaudeCredentials? {
        guard let data = try? Data(contentsOf: authFileURL()) else { return nil }
        return parse(data: data)
    }

    static func parse(data: Data) -> ClaudeCredentials? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        guard let entry = root["anthropic"] as? [String: Any] else { return nil }
        // OAuth shape from pi: {type:"oauth", access:<token>, refresh:<token>, expires:<ms>}.
        guard entry["type"] as? String == "oauth" else { return nil }
        let access = (entry["access"] as? String) ?? (entry["access_token"] as? String)
        guard let access, !access.isEmpty else { return nil }
        let expiresAt: Date? = {
            if let ms = entry["expires"] as? Int { return Date(timeIntervalSince1970: TimeInterval(ms) / 1000.0) }
            if let ms = entry["expires"] as? Double { return Date(timeIntervalSince1970: ms / 1000.0) }
            if let ms = entry["expires_at"] as? Double { return Date(timeIntervalSince1970: ms / 1000.0) }
            return nil
        }()
        return ClaudeCredentials(accessToken: access, expiresAt: expiresAt)
    }
}

// MARK: - Usage fetch + parse (mirrors CodexBar ClaudeOAuthUsageFetcher)

/// A Claude OAuth usage window. `utilization` is 0…100 (verified empirically:
/// the API returns e.g. `16.0` for 16%).
struct ClaudeUsageWindow: Equatable {
    let usedPercent: Double       // 0…100
    let resetsAt: Date?
    /// Approx window length: .fiveHour or .sevenDay.
    let kind: Kind
    enum Kind { case fiveHour, sevenDay }
    var label: String { kind == .fiveHour ? "5h" : "周" }
}

enum ClaudeWebBilling {
    enum BillingError: Error { case invalidCredentials, apiError(String), parseFailed(String) }

    static let defaultEndpoint = URL(string: "https://api.anthropic.com/api/oauth/usage")!

    static func fetchUsage(
        credentials: ClaudeCredentials,
        endpoint: URL = defaultEndpoint,
        session: URLSession = .shared
    ) async throws -> [ClaudeUsageWindow] {
        guard !credentials.accessToken.isEmpty else { throw BillingError.invalidCredentials }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.setValue("Bearer \(credentials.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("oauth-2025-04-20", forHTTPHeaderField: "anthropic-beta")
        request.setValue("claude-code/2.1.0", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 15

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw BillingError.apiError("no http response") }
        guard http.statusCode == 200 else {
            let body = String(data: data.prefix(200), encoding: .utf8) ?? ""
            throw BillingError.apiError("HTTP \(http.statusCode): \(body)")
        }
        return try parseWindows(from: data)
    }

    /// Parse every present window: five_hour + seven_day (each carries
    /// `utilization` 0–100 + `resets_at`). Returns them in the order they appear.
    static func parseWindows(from data: Data) throws -> [ClaudeUsageWindow] {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw BillingError.parseFailed("not json")
        }
        var out: [ClaudeUsageWindow] = []
        if let w = window(root["five_hour"] as? [String: Any], kind: .fiveHour) { out.append(w) }
        if let w = window(root["seven_day"] as? [String: Any], kind: .sevenDay) { out.append(w) }
        return out
    }

    private static func window(_ dict: [String: Any]?, kind: ClaudeUsageWindow.Kind) -> ClaudeUsageWindow? {
        guard let dict else { return nil }
        let used: Double? = {
            if let n = dict["utilization"] as? Double { return n }
            if let n = dict["utilization"] as? Int { return Double(n) }
            if let s = dict["utilization"] as? String, let d = Double(s) { return d }
            return nil
        }()
        guard let used else { return nil }
        let resetsAt: Date? = {
            if let s = dict["resets_at"] as? String,
               let d = ISO8601DateFormatter().date(from: s) { return d }
            return nil
        }()
        return ClaudeUsageWindow(usedPercent: used, resetsAt: resetsAt, kind: kind)
    }

    /// Turn all windows into a snapshot; default the capsule to the highest-usage.
    static func snapshot(from windows: [ClaudeUsageWindow]) -> QuotaSnapshot? {
        let qw: [QuotaWindow] = windows.map { w in
            let lbl = w.label
            return QuotaWindow(
                id: w.kind == .fiveHour ? "fiveHour" : "sevenDay",
                usedPercent: min(100, max(0, w.usedPercent)),
                resetsAt: w.resetsAt,
                label: lbl,
                title: "\(lbl)额度"
            )
        }
        guard !qw.isEmpty else { return nil }
        return QuotaSnapshot(windows: qw, selectedWindowId: nil)
    }
}

// MARK: - Monitor

final class ClaudeQuotaMonitor: QuotaMonitor {
    static let shared = ClaudeQuotaMonitor()
    private let core = QuotaMonitorCore()

    private init() {
        core.fetcher = { [weak self] _ in try await self?.fetchClaude() }
    }

    var snapshot: QuotaSnapshot? { core.snapshot }

    @discardableResult
    func observe(_ handler: @escaping (QuotaSnapshot?) -> Void) -> UUID {
        core.observe(handler)
    }

    func removeObserver(_ id: UUID) { core.removeObserver(id) }

    func refreshIfNeeded(force: Bool) { core.refreshIfNeeded(force: force) }

    private func fetchClaude() async throws -> QuotaSnapshot? {
        guard let creds = ClaudeAuthStore.load(), !creds.isExpired else { return nil }
        let windows = try await ClaudeWebBilling.fetchUsage(credentials: creds)
        return ClaudeWebBilling.snapshot(from: windows)
    }
}
