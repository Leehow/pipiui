import Foundation
import AppKit

// MARK: - Snapshot

/// Remaining prepaid balance for a pay-per-token provider account.
struct BalanceSnapshot: Equatable {
    /// Remaining balance amount (not total top-up).
    var amount: Decimal
    /// ISO-ish currency code; UI understands `"CNY"` and `"USD"`.
    var currency: String
    var fetchedAt: Date
}

/// Format a balance for the input-bar capsule: `¥110.00` / `$74.75`.
/// Rounds half-up to 2 decimal places.
func formatBalance(amount: Decimal, currency: String) -> String {
    var value = amount
    var rounded = Decimal()
    NSDecimalRound(&rounded, &value, 2, .plain)
    let prefix: String = {
        switch currency.uppercased() {
        case "CNY", "RMB": return "¥"
        case "USD": return "$"
        default: return "\(currency) "
        }
    }()
    let formatter = NumberFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.numberStyle = .decimal
    formatter.minimumFractionDigits = 2
    formatter.maximumFractionDigits = 2
    let body = formatter.string(from: NSDecimalNumber(decimal: rounded)) ?? "0.00"
    return prefix + body
}

// MARK: - Spend display (balance popover)

/// Pure formatting for the balance popover's two spend rows. Both inputs are
/// raw pi ledger USD (session cost + 30-day aggregate); `unit` / `rate` decide
/// the display currency for both rows.
struct BalanceSpendDisplay: Equatable {
    var sessionSpend: String
    var last30DaysSpend: String

    init(sessionCostUSD: Double, last30DaysUSD: Double, unit: PriceUnit, rate: Double) {
        sessionSpend = formatSpend(usdCost: sessionCostUSD, unit: unit, rate: rate)
        last30DaysSpend = formatSpend(usdCost: last30DaysUSD, unit: unit, rate: rate)
    }
}

// MARK: - Provider routing

/// Pay-per-token providers that expose a balance endpoint.
enum BalanceProvider: String, CaseIterable {
    case deepseek, moonshot, siliconflow, openrouter

    /// Env var names accepted for this provider (canonical first).
    /// Sourced from `ProviderEnvMap` where known; siliconflow is local.
    var apiKeyEnvNames: [String] {
        switch self {
        case .deepseek:
            let mapped = ProviderEnvMap.envVars(forProvider: "deepseek")
            return mapped.isEmpty ? ["DEEPSEEK_API_KEY"] : mapped
        case .moonshot:
            let mapped = ProviderEnvMap.envVars(forProvider: "moonshot")
            return mapped.isEmpty ? ["MOONSHOT_API_KEY", "KIMI_API_KEY"] : mapped
        case .siliconflow:
            let mapped = ProviderEnvMap.envVars(forProvider: "siliconflow")
            return mapped.isEmpty ? ["SILICONFLOW_API_KEY"] : mapped
        case .openrouter:
            let mapped = ProviderEnvMap.envVars(forProvider: "openrouter")
            return mapped.isEmpty ? ["OPENROUTER_API_KEY"] : mapped
        }
    }

    /// Pi `auth.json` provider id used as a key-resolution fallback.
    var piAuthProviderId: String { rawValue }

    /// Shared monitor singleton per provider (lazy, like `QuotaProvider.monitor`).
    var monitor: BalanceMonitor {
        switch self {
        case .deepseek: return DeepSeekBalanceMonitor.shared
        case .moonshot: return MoonshotBalanceMonitor.shared
        case .siliconflow: return SiliconFlowBalanceMonitor.shared
        case .openrouter: return OpenRouterBalanceMonitor.shared
        }
    }
}

/// Map a pi provider id string → balance source. Relay/unknown → nil.
func balanceProvider(for provider: String) -> BalanceProvider? {
    let p = provider.lowercased()
    if p.contains("relay") { return nil }
    if p.contains("deepseek") { return .deepseek }
    if p.contains("moonshot") { return .moonshot }
    if p.contains("siliconflow") { return .siliconflow }
    if p.contains("openrouter") { return .openrouter }
    return nil
}

// MARK: - Key resolution

/// Resolves prepaid-balance API keys using the same layers as GLM/Kimi quota:
/// process env + `~/.pi/agent/.env` via `QuotaEnvFallback`, then `PiAuthStore` auth.json.
enum BalanceAuthStore {
    static func apiKey(
        for provider: BalanceProvider,
        env: [String: String] = ProcessInfo.processInfo.environment,
        authURL: URL = PiAuthStore.defaultAuthURL()
    ) -> String? {
        let env = QuotaEnvFallback.merged(env)
        for name in provider.apiKeyEnvNames {
            if let v = cleaned(env[name]) { return v }
        }
        return loadFromPiAuth(providerId: provider.piAuthProviderId, authURL: authURL)
    }

    static func loadFromPiAuth(providerId: String, authURL: URL) -> String? {
        guard let data = try? Data(contentsOf: authURL),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let entry = root[providerId] as? [String: Any]
        else { return nil }
        let type = (entry["type"] as? String) ?? ""
        if type == "api_key" {
            return cleaned(entry["key"] as? String)
        }
        // Unknown / oauth-ish shapes: try common fields without logging values.
        return cleaned(entry["key"] as? String)
            ?? cleaned(entry["access"] as? String)
            ?? cleaned(entry["access_token"] as? String)
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

// MARK: - Fetch + parse

enum BalanceBilling {
    enum BillingError: Error {
        case invalidCredentials
        case apiError(String)
        case parseFailed(String)
    }

    static let requestTimeout: TimeInterval = 10

    // MARK: DeepSeek

    /// GET https://api.deepseek.com/user/balance
    static func parseDeepSeek(from data: Data, fetchedAt: Date = Date()) -> BalanceSnapshot? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        // Require is_available == true when present; missing key is tolerated.
        if let available = root["is_available"] as? Bool, available == false {
            return nil
        }
        guard let infos = root["balance_infos"] as? [[String: Any]],
              let first = infos.first
        else { return nil }
        guard let amount = decimalValue(first["total_balance"]) else { return nil }
        let currency = (first["currency"] as? String)?.uppercased() ?? "CNY"
        return BalanceSnapshot(amount: amount, currency: currency, fetchedAt: fetchedAt)
    }

    static func fetchDeepSeek(
        apiKey: String,
        session: URLSession = .shared
    ) async throws -> BalanceSnapshot? {
        guard !apiKey.isEmpty else { throw BillingError.invalidCredentials }
        guard let url = URL(string: "https://api.deepseek.com/user/balance") else {
            throw BillingError.apiError("bad url")
        }
        let data = try await getJSON(url: url, apiKey: apiKey, session: session)
        return parseDeepSeek(from: data)
    }

    // MARK: Moonshot

    /// GET https://api.moonshot.cn/v1/users/me/balance
    static func parseMoonshot(from data: Data, fetchedAt: Date = Date()) -> BalanceSnapshot? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        // code == 0 means ok when present.
        if let code = root["code"] as? Int, code != 0 { return nil }
        if let code = root["code"] as? String, code != "0" { return nil }
        guard let dataDict = root["data"] as? [String: Any],
              let amount = decimalValue(dataDict["available_balance"])
        else { return nil }
        return BalanceSnapshot(amount: amount, currency: "CNY", fetchedAt: fetchedAt)
    }

    static func fetchMoonshot(
        apiKey: String,
        session: URLSession = .shared
    ) async throws -> BalanceSnapshot? {
        guard !apiKey.isEmpty else { throw BillingError.invalidCredentials }
        guard let url = URL(string: "https://api.moonshot.cn/v1/users/me/balance") else {
            throw BillingError.apiError("bad url")
        }
        let data = try await getJSON(url: url, apiKey: apiKey, session: session)
        return parseMoonshot(from: data)
    }

    // MARK: SiliconFlow

    /// GET https://api.siliconflow.cn/v1/user/info
    static func parseSiliconFlow(from data: Data, fetchedAt: Date = Date()) -> BalanceSnapshot? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        if let status = root["status"] as? Bool, status == false { return nil }
        guard let dataDict = root["data"] as? [String: Any],
              let amount = decimalValue(dataDict["totalBalance"])
        else { return nil }
        return BalanceSnapshot(amount: amount, currency: "CNY", fetchedAt: fetchedAt)
    }

    static func fetchSiliconFlow(
        apiKey: String,
        session: URLSession = .shared
    ) async throws -> BalanceSnapshot? {
        guard !apiKey.isEmpty else { throw BillingError.invalidCredentials }
        guard let url = URL(string: "https://api.siliconflow.cn/v1/user/info") else {
            throw BillingError.apiError("bad url")
        }
        let data = try await getJSON(url: url, apiKey: apiKey, session: session)
        return parseSiliconFlow(from: data)
    }

    // MARK: OpenRouter

    /// GET https://openrouter.ai/api/v1/credits
    /// remaining = total_credits - total_usage (USD).
    static func parseOpenRouter(from data: Data, fetchedAt: Date = Date()) -> BalanceSnapshot? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dataDict = root["data"] as? [String: Any],
              let credits = decimalValue(dataDict["total_credits"]),
              let usage = decimalValue(dataDict["total_usage"])
        else { return nil }
        return BalanceSnapshot(
            amount: credits - usage,
            currency: "USD",
            fetchedAt: fetchedAt
        )
    }

    static func fetchOpenRouter(
        apiKey: String,
        session: URLSession = .shared
    ) async throws -> BalanceSnapshot? {
        guard !apiKey.isEmpty else { throw BillingError.invalidCredentials }
        guard let url = URL(string: "https://openrouter.ai/api/v1/credits") else {
            throw BillingError.apiError("bad url")
        }
        let data = try await getJSON(url: url, apiKey: apiKey, session: session)
        return parseOpenRouter(from: data)
    }

    // MARK: Shared HTTP

    private static func getJSON(
        url: URL,
        apiKey: String,
        session: URLSession
    ) async throws -> Data {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = requestTimeout

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw BillingError.apiError("no http response")
        }
        guard http.statusCode == 200 else {
            // Soft-fail upstream: do not embed body (may leak); status is enough.
            throw BillingError.apiError("HTTP \(http.statusCode)")
        }
        return data
    }

    /// Accept String / number JSON values as Decimal.
    static func decimalValue(_ any: Any?) -> Decimal? {
        switch any {
        case let s as String:
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !t.isEmpty else { return nil }
            return Decimal(string: t, locale: Locale(identifier: "en_US_POSIX"))
        case let d as Double:
            guard d.isFinite else { return nil }
            return Decimal(d)
        case let i as Int:
            return Decimal(i)
        case let i as Int64:
            return Decimal(i)
        case let n as NSNumber:
            return Decimal(string: n.stringValue, locale: Locale(identifier: "en_US_POSIX"))
        default:
            return nil
        }
    }

    static func fetch(
        provider: BalanceProvider,
        session: URLSession = .shared
    ) async throws -> BalanceSnapshot? {
        guard let apiKey = BalanceAuthStore.apiKey(for: provider) else { return nil }
        switch provider {
        case .deepseek: return try await fetchDeepSeek(apiKey: apiKey, session: session)
        case .moonshot: return try await fetchMoonshot(apiKey: apiKey, session: session)
        case .siliconflow: return try await fetchSiliconFlow(apiKey: apiKey, session: session)
        case .openrouter: return try await fetchOpenRouter(apiKey: apiKey, session: session)
        }
    }
}

// MARK: - Monitor protocol + core

/// Common interface for per-provider balance monitors (mirrors `QuotaMonitor`).
protocol BalanceMonitor: AnyObject {
    var snapshot: BalanceSnapshot? { get }
    func observe(_ handler: @escaping (BalanceSnapshot?) -> Void) -> UUID
    func removeObserver(_ id: UUID)
    func refreshIfNeeded(force: Bool)
}

/// Shared timer / throttle / observer fan-out for balance monitors.
/// Cadence matches `QuotaMonitorCore` so prepaid + subscription pills feel consistent.
final class BalanceMonitorCore {
    static let minAttemptInterval: TimeInterval = 60
    static let staleAfter: TimeInterval = 3 * 60
    static let pollInterval: TimeInterval = 5 * 60

    private(set) var snapshot: BalanceSnapshot?
    private var lastAttemptAt: Date?
    private var lastSuccessAt: Date?
    private var inFlight = false
    private var timer: Timer?
    private var activeObserver: NSObjectProtocol?
    private var listeners: [UUID: (BalanceSnapshot?) -> Void] = [:]

    var fetcher: ((Bool) async throws -> BalanceSnapshot?)?

    func observe(_ handler: @escaping (BalanceSnapshot?) -> Void) -> UUID {
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
            let t = Timer(timeInterval: Self.pollInterval, repeats: true) { [weak self] _ in
                self?.refreshIfNeeded(force: false)
            }
            RunLoop.main.add(t, forMode: .common)
            timer = t
        }
        if activeObserver == nil {
            activeObserver = NotificationCenter.default.addObserver(
                forName: NSApplication.didBecomeActiveNotification,
                object: nil, queue: .main
            ) { [weak self] _ in self?.refreshIfNeeded(force: false) }
        }
    }

    func refreshIfNeeded(force: Bool) {
        let now = Date()
        if !force, let lastSuccessAt, now.timeIntervalSince(lastSuccessAt) < Self.staleAfter { return }
        if !force, let lastAttemptAt, now.timeIntervalSince(lastAttemptAt) < Self.minAttemptInterval { return }
        guard !inFlight else { return }
        guard let fetcher else { return }
        inFlight = true
        lastAttemptAt = now
        Task { [weak self] in
            let result: BalanceSnapshot?
            do { result = try await fetcher(force) }
            catch { result = nil }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.inFlight = false
                // Keep last good snapshot on failure (soft-fail).
                if let result {
                    self.snapshot = result
                    self.lastSuccessAt = Date()
                    self.publish()
                }
            }
        }
    }

    private func publish() {
        let snap = snapshot
        for handler in listeners.values { handler(snap) }
    }
}

// MARK: - Per-provider monitors

final class DeepSeekBalanceMonitor: BalanceMonitor {
    static let shared = DeepSeekBalanceMonitor()
    private let core = BalanceMonitorCore()
    private init() {
        core.fetcher = { _ in try await BalanceBilling.fetch(provider: .deepseek) }
    }
    var snapshot: BalanceSnapshot? { core.snapshot }
    @discardableResult
    func observe(_ handler: @escaping (BalanceSnapshot?) -> Void) -> UUID { core.observe(handler) }
    func removeObserver(_ id: UUID) { core.removeObserver(id) }
    func refreshIfNeeded(force: Bool) { core.refreshIfNeeded(force: force) }
}

final class MoonshotBalanceMonitor: BalanceMonitor {
    static let shared = MoonshotBalanceMonitor()
    private let core = BalanceMonitorCore()
    private init() {
        core.fetcher = { _ in try await BalanceBilling.fetch(provider: .moonshot) }
    }
    var snapshot: BalanceSnapshot? { core.snapshot }
    @discardableResult
    func observe(_ handler: @escaping (BalanceSnapshot?) -> Void) -> UUID { core.observe(handler) }
    func removeObserver(_ id: UUID) { core.removeObserver(id) }
    func refreshIfNeeded(force: Bool) { core.refreshIfNeeded(force: force) }
}

final class SiliconFlowBalanceMonitor: BalanceMonitor {
    static let shared = SiliconFlowBalanceMonitor()
    private let core = BalanceMonitorCore()
    private init() {
        core.fetcher = { _ in try await BalanceBilling.fetch(provider: .siliconflow) }
    }
    var snapshot: BalanceSnapshot? { core.snapshot }
    @discardableResult
    func observe(_ handler: @escaping (BalanceSnapshot?) -> Void) -> UUID { core.observe(handler) }
    func removeObserver(_ id: UUID) { core.removeObserver(id) }
    func refreshIfNeeded(force: Bool) { core.refreshIfNeeded(force: force) }
}

final class OpenRouterBalanceMonitor: BalanceMonitor {
    static let shared = OpenRouterBalanceMonitor()
    private let core = BalanceMonitorCore()
    private init() {
        core.fetcher = { _ in try await BalanceBilling.fetch(provider: .openrouter) }
    }
    var snapshot: BalanceSnapshot? { core.snapshot }
    @discardableResult
    func observe(_ handler: @escaping (BalanceSnapshot?) -> Void) -> UUID { core.observe(handler) }
    func removeObserver(_ id: UUID) { core.removeObserver(id) }
    func refreshIfNeeded(force: Bool) { core.refreshIfNeeded(force: force) }
}
