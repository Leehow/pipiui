import Foundation

// MARK: - Credential reader (mirrors CodexBar CodexOAuthCredentials)

/// Resolves Codex / ChatGPT-plan credentials from `~/.codex/auth.json`.
/// Supports both shapes: `{tokens:{access_token, refresh_token, account_id}}`
/// and `{OPENAI_API_KEY: ...}`. `$CODEX_HOME` overrides the home dir.
struct CodexCredentials {
    let accessToken: String
    let accountId: String?
}

enum CodexAuthStore {
    /// Resolve `~/.codex` (honoring `$CODEX_HOME`).
    static func codexHomeURL(env: [String: String] = ProcessInfo.processInfo.environment) -> URL {
        if let custom = env["CODEX_HOME"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !custom.isEmpty {
            return URL(fileURLWithPath: (custom as NSString).expandingTildeInPath, isDirectory: true)
        }
        return URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
            .appendingPathComponent(".codex", isDirectory: true)
    }

    static func authFileURL(env: [String: String] = ProcessInfo.processInfo.environment) -> URL {
        codexHomeURL(env: env).appendingPathComponent("auth.json")
    }

    static func load(env: [String: String] = ProcessInfo.processInfo.environment) -> CodexCredentials? {
        let url = authFileURL(env: env)
        guard let data = AuthFileCache.data(for: url) else { return nil }
        return parse(data: data)
    }

    static func parse(data: Data) -> CodexCredentials? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        // Token shape.
        if let tokens = root["tokens"] as? [String: Any] {
            let access = (tokens["access_token"] as? String) ?? (tokens["accessToken"] as? String)
            guard let access, !access.isEmpty else { return nil }
            let accountId = (tokens["account_id"] as? String) ?? (tokens["accountId"] as? String)
            return CodexCredentials(accessToken: access, accountId: accountId)
        }
        // API-key shape.
        if let key = root["OPENAI_API_KEY"] as? String, !key.isEmpty {
            return CodexCredentials(accessToken: key, accountId: nil)
        }
        return nil
    }
}

// MARK: - Usage fetch + parse (mirrors CodexBar CodexOAuthUsageFetcher /wham/usage)

/// One rate-limit window from the Codex `/wham/usage` response.
struct CodexRateWindow: Equatable {
    let usedPercent: Double       // 0…100 (API gives an int 0-100)
    let resetsAt: Date?
    let windowSeconds: Int?

    var label: String {
        guard let secs = windowSeconds, secs > 0 else { return "额度" }
        let hours = Double(secs) / 3600.0
        if (4.5...5.5).contains(hours) { return "5h" }
        let days = Int((Double(secs) / 86400.0).rounded())
        if (4...12).contains(days) { return "周" }
        if (20...45).contains(days) { return "月" }
        return "额度"
    }
}

enum CodexWebBilling {
    enum BillingError: Error { case invalidCredentials, apiError(String), parseFailed(String) }

    static let defaultEndpoint = URL(string: "https://chatgpt.com/backend-api/wham/usage")!

    static func fetchUsage(
        credentials: CodexCredentials,
        endpoint: URL = defaultEndpoint,
        session: URLSession = .shared
    ) async throws -> [CodexRateWindow] {
        guard !credentials.accessToken.isEmpty else { throw BillingError.invalidCredentials }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.setValue("Bearer \(credentials.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("CodexBar", forHTTPHeaderField: "User-Agent")
        if let accountId = credentials.accountId, !accountId.isEmpty {
            request.setValue(accountId, forHTTPHeaderField: "ChatGPT-Account-Id")
        }
        request.timeoutInterval = 15

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw BillingError.apiError("no http response") }
        guard http.statusCode == 200 else {
            let body = String(data: data.prefix(200), encoding: .utf8) ?? ""
            throw BillingError.apiError("HTTP \(http.statusCode): \(body)")
        }
        return try parseWindows(from: data)
    }

    /// Extract `rate_limit.primary_window` (falling back to `secondary_window`).
    static func parsePrimaryWindow(from data: Data) throws -> CodexRateWindow? {
        try parseWindows(from: data).first
    }

    /// Parse every rate-limit window present (primary + secondary).
    static func parseWindows(from data: Data) throws -> [CodexRateWindow] {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw BillingError.parseFailed("not json")
        }
        guard let rateLimit = root["rate_limit"] as? [String: Any] else { return [] }
        var out: [CodexRateWindow] = []
        for key in ["primary_window", "secondary_window"] {
            if let dict = rateLimit[key] as? [String: Any], let w = window(from: dict) {
                out.append(w)
            }
        }
        return out
    }

    private static func window(from dict: [String: Any]) -> CodexRateWindow? {
        // used_percent: API gives an int 0-100; tolerate Double/String too.
        let used: Double? = {
            if let n = dict["used_percent"] as? Int { return Double(n) }
            if let d = dict["used_percent"] as? Double { return d }
            if let s = dict["used_percent"] as? String, let d = Double(s) { return d }
            return nil
        }()
        guard let used else { return nil }
        let resetAt: Date? = {
            if let n = dict["reset_at"] as? Int { return Date(timeIntervalSince1970: TimeInterval(n)) }
            if let s = dict["reset_at"] as? String,
               let d = ISO8601DateFormatter().date(from: s) { return d }
            return nil
        }()
        let windowSeconds = dict["limit_window_seconds"] as? Int
        return CodexRateWindow(usedPercent: used, resetsAt: resetAt, windowSeconds: windowSeconds)
    }

    /// Map all windows into a snapshot; default the capsule to the highest-usage.
    static func snapshot(from windows: [CodexRateWindow]) -> QuotaSnapshot? {
        var seen = Set<String>()
        let qw: [QuotaWindow] = windows.enumerated().compactMap { idx, w in
            let lbl = w.label
            // id distinguishes primary/secondary even if labels coincide.
            let id = windows.count > 1 ? "window\(idx)" : lbl
            guard seen.insert(id).inserted else { return nil }
            return QuotaWindow(
                id: id,
                usedPercent: min(100, max(0, w.usedPercent)),
                resetsAt: w.resetsAt,
                label: lbl,
                title: lbl == "额度" ? "额度" : "\(lbl)额度"
            )
        }
        guard !qw.isEmpty else { return nil }
        return QuotaSnapshot(windows: qw, selectedWindowId: nil)
    }
}

// MARK: - Monitor

final class CodexQuotaMonitor: QuotaMonitor {
    static let shared = CodexQuotaMonitor()
    private let core = QuotaMonitorCore()

    private init() {
        core.fetcher = { [weak self] _ in try await self?.fetchCodex() }
    }

    var snapshot: QuotaSnapshot? { core.snapshot }

    @discardableResult
    func observe(_ handler: @escaping (QuotaSnapshot?) -> Void) -> UUID {
        core.observe(handler)
    }

    func removeObserver(_ id: UUID) { core.removeObserver(id) }

    func refreshIfNeeded(force: Bool) { core.refreshIfNeeded(force: force) }

    private func fetchCodex() async throws -> QuotaSnapshot? {
        guard let creds = CodexAuthStore.load() else { return nil }
        let windows = try await CodexWebBilling.fetchUsage(credentials: creds)
        return CodexWebBilling.snapshot(from: windows)
    }
}
