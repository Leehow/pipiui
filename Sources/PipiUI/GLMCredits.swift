import Foundation

// MARK: - Credential reader (mirrors CodexBar ZaiSettingsReader)

/// Resolves the Z.ai / GLM API key. Resolution order (first non-empty wins):
/// env vars, then the first line of a known key file. Ported from CodexBar's
/// `ZaiSettingsReader` so `~/.coding-relay/glm-api-key` works out of the box.
enum GLMAuthStore {
    private static let envKeys = [
        "Z_AI_API_KEY", "BIGMODEL_API_KEY", "ZHIPU_API_KEY",
        "ZHIPUAI_API_KEY", "ZAI_API_KEY", "GLM_API_KEY",
    ]
    private static let fileRelativePaths = [
        ".coding-relay/glm-api-key",
        ".config/bigmodel/api_key",
        ".config/zhipu/api_key",
    ]

    static func load(env: [String: String] = ProcessInfo.processInfo.environment) -> String? {
        for key in envKeys {
            if let v = cleaned(env[key]) { return v }
        }
        let home = NSHomeDirectory()
        for rel in fileRelativePaths {
            let url = URL(fileURLWithPath: (home as NSString).appendingPathComponent(rel))
            guard let data = try? Data(contentsOf: url),
                  let raw = String(data: data, encoding: .utf8) else { continue }
            if let v = cleaned(raw) { return v }
        }
        return nil
    }

    private static func cleaned(_ raw: String?) -> String? {
        guard var s = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else {
            return nil
        }
        // Strip one surrounding pair of quotes (CodexBar behaviour).
        if (s.hasPrefix("\"") && s.hasSuffix("\"")) || (s.hasPrefix("'") && s.hasSuffix("'")) {
            s.removeFirst(); s.removeLast()
            s = s.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return s.isEmpty ? nil : s
    }
}

// MARK: - Quota fetch + parse (mirrors CodexBar ZaiUsageStats)

/// Two z.ai regions. `zai-coding-cn` (coding plan, CN) uses the bigmodel host;
/// the global endpoint is the default. Endpoint/host can be overridden via env.
enum GLMAPIRegion {
    case global, bigmodelCN

    var baseHost: String {
        switch self {
        case .global: return "https://api.z.ai"
        case .bigmodelCN: return "https://open.bigmodel.cn"
        }
    }

    /// Resolve the quota host honoring env overrides (`Z_AI_API_HOST` full host).
    static func resolveHost(env: [String: String] = ProcessInfo.processInfo.environment) -> String {
        if let h = env["Z_AI_API_HOST"]?.trimmingCharacters(in: .whitespacesAndNewlines), !h.isEmpty {
            return h
        }
        // Default to the CN coding-plan endpoint: the user's `zai-coding-cn`
        // provider is the bigmodel coding plan.
        return GLMAPIRegion.bigmodelCN.baseHost
    }
}

/// One usage window from the z.ai quota response.
struct GLMRateLimit: Equatable {
    enum Kind: String { case timeLimit = "TIME_LIMIT", tokensLimit = "TOKENS_LIMIT" }
    let kind: Kind
    /// `unit` raw value: 1=days, 3=hours, 5=minutes, 6=weeks.
    let unit: Int
    let number: Int
    /// The quota/grant (confusingly named `usage` by the API).
    let limit: Int
    let currentValue: Int?
    let remaining: Int?
    let percentage: Int?
    let nextResetTime: Date?

    /// Authoritative used-percent, ported from CodexBar `ZaiLimitEntry.computedUsedPercent`.
    /// Falls back to the API's own `percentage` when the limit/remaining/currentValue
    /// math is unavailable (e.g. TIME_LIMIT windows often only carry a percentage).
    var usedPercent: Double? {
        let computed: Double? = {
            guard limit > 0 else { return nil }
            let usedRaw: Int?
            if let remaining = remaining {
                let usedFromRemaining = limit - remaining
                usedRaw = currentValue.map { max(usedFromRemaining, $0) } ?? usedFromRemaining
            } else if let currentValue = currentValue {
                usedRaw = currentValue
            } else {
                return nil
            }
            guard let usedRaw else { return nil }
            let used = max(0, min(limit, usedRaw))
            return min(100, max(0, Double(used) / Double(limit) * 100))
        }()
        if let computed { return computed }
        // Fall back to the API's own percentage field.
        if let percentage { return min(100, max(0, Double(percentage))) }
        return nil
    }

    /// Approximate window length in minutes (for label + choosing primary).
    var windowMinutes: Int? {
        switch unit {
        case 1: return number * 24 * 60      // days
        case 3: return number * 60           // hours
        case 5: return number                // minutes
        case 6: return number * 7 * 24 * 60  // weeks
        default: return nil
        }
    }
}

enum GLMWebBilling {
    enum BillingError: Error { case invalidCredentials, apiError(String), parseFailed(String) }

    static func fetchUsage(
        apiKey: String,
        env: [String: String] = ProcessInfo.processInfo.environment,
        session: URLSession = .shared
    ) async throws -> [GLMRateLimit] {
        guard !apiKey.isEmpty else { throw BillingError.invalidCredentials }
        let host = GLMAPIRegion.resolveHost(env: env)
        let urlString = "\(host)/api/monitor/usage/quota/limit"
        guard let url = URL(string: urlString) else {
            throw BillingError.apiError("bad url: \(urlString)")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.timeoutInterval = 15

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw BillingError.apiError("no http response") }
        guard http.statusCode == 200 else {
            let body = String(data: data.prefix(200), encoding: .utf8) ?? ""
            throw BillingError.apiError("HTTP \(http.statusCode): \(body)")
        }
        return try parseLimits(from: data)
    }

    /// Parse `{data:{limits:[...]}}` into `GLMRateLimit`s.
    static func parseLimits(from data: Data) throws -> [GLMRateLimit] {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw BillingError.parseFailed("not json")
        }
        let success = (root["success"] as? Bool) ?? ((root["code"] as? Int) == 200)
        guard success else {
            let msg = (root["msg"] as? String) ?? "request failed"
            throw BillingError.apiError(msg)
        }
        guard let dataDict = root["data"] as? [String: Any],
              let limitsArr = dataDict["limits"] as? [[String: Any]] else {
            throw BillingError.parseFailed("missing data.limits")
        }
        return limitsArr.compactMap { GLMWebBilling.limit(from: $0) }
    }

    private static func limit(from dict: [String: Any]) -> GLMRateLimit? {
        guard let kindStr = dict["type"] as? String,
              let kind = GLMRateLimit.Kind(rawValue: kindStr) else { return nil }
        let unit = (dict["unit"] as? Int) ?? 0
        let number = (dict["number"] as? Int) ?? 0
        // The grant is the `usage` field (API naming), or `current_value`/`limit` aliases.
        let limit = (dict["usage"] as? Int) ?? (dict["limit"] as? Int) ?? 0
        let currentValue = dict["current_value"] as? Int ?? dict["currentValue"] as? Int
        let remaining = dict["remaining"] as? Int
        let percentage = dict["percentage"] as? Int
        let resetMs = dict["nextResetTime"] as? Int ?? dict["next_reset_time"] as? Int
        let resetDate = resetMs.map { Date(timeIntervalSince1970: TimeInterval($0) / 1000.0) }
        return GLMRateLimit(kind: kind, unit: unit, number: number, limit: limit,
                            currentValue: currentValue, remaining: remaining,
                            percentage: percentage, nextResetTime: resetDate)
    }

    /// Label for a limit window, ported from the duration-based heuristic.
    static func label(for limit: GLMRateLimit) -> String {
        guard let mins = limit.windowMinutes else { return "额度" }
        let hours = Double(mins) / 60.0
        if (4.5...5.5).contains(hours) { return "5h" }
        let days = Int((Double(mins) / 60.0 / 24.0).rounded())
        if (4...12).contains(days) { return "周" }
        if (20...45).contains(days) { return "月" }
        return "额度"
    }

    /// Turn each limit into a window; default the capsule to the highest-usage one.
    static func snapshot(from limits: [GLMRateLimit]) -> QuotaSnapshot? {
        // De-duplicate by (kind, windowMinutes) keeping the first, so repeated
        // windows don't crowd the popover.
        var seen = Set<String>()
        let windows: [QuotaWindow] = limits.compactMap { limit in
            guard let pct = limit.usedPercent else { return nil }
            let key = "\(limit.kind):\(limit.windowMinutes ?? 0)"
            guard seen.insert(key).inserted else { return nil }
            let lbl = label(for: limit)
            return QuotaWindow(
                id: key,
                usedPercent: pct,
                resetsAt: limit.nextResetTime,
                label: lbl,
                title: lbl == "额度" ? "额度" : "\(lbl)额度"
            )
        }
        guard !windows.isEmpty else { return nil }
        return QuotaSnapshot(windows: windows, selectedWindowId: nil)
    }
}

// MARK: - Monitor

final class GLMQuotaMonitor: QuotaMonitor {
    static let shared = GLMQuotaMonitor()
    private let core = QuotaMonitorCore()

    private init() {
        core.fetcher = { [weak self] _ in try await self?.fetchGLM() }
    }

    var snapshot: QuotaSnapshot? { core.snapshot }

    @discardableResult
    func observe(_ handler: @escaping (QuotaSnapshot?) -> Void) -> UUID {
        core.observe(handler)
    }

    func removeObserver(_ id: UUID) { core.removeObserver(id) }

    func refreshIfNeeded(force: Bool) { core.refreshIfNeeded(force: force) }

    private func fetchGLM() async throws -> QuotaSnapshot? {
        guard let apiKey = GLMAuthStore.load() else { return nil }
        let limits = try await GLMWebBilling.fetchUsage(apiKey: apiKey)
        return GLMWebBilling.snapshot(from: limits)
    }
}
