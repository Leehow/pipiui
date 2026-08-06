import Foundation
import WebKit

/// 阿里云百炼 Qwen Token Plan 个人版登录页。
let bailianTokenPlanURL = "https://bailian.console.aliyun.com/cn-beijing?tab=plan#/efm/subscription/token-plan/personal"

// MARK: - Auth

/// Resolves 阿里云百炼 (Aliyun Bailian) Qwen Token Plan 个人版 session cookies from
/// the embedded browser's persistent cookie store.
///
/// The user logs into the Bailian console in pipiui's built-in WKWebView; the
/// session cookies (including httpOnly) land in `WKWebsiteDataStore.default()`.
/// We read those cookies and forward them to the usage API. No API key is used.
enum QwenTokenPlanAuthStore {
    /// UserDefaults key holding the last-seen session cookie string.
    ///
    /// WebKit's `WKWebsiteDataStore.default()` does not persist cookies to disk on
    /// macOS (only LocalStorage/IndexedDB survive a restart), so we cache the cookie
    /// ourselves to survive App restarts. Plaintext UserDefaults is fine for this
    /// single-user macOS MVP; a future hardening pass could move this to the Keychain.
    private static let cookieCacheKey = "qwenTokenPlanCookie"

    /// Writes the session cookie string to the persistence cache.
    static func persistCookie(_ cookie: String) {
        UserDefaults.standard.set(cookie, forKey: cookieCacheKey)
    }

    /// Reads the cached session cookie string, if any.
    static func cachedCookie() -> String? {
        UserDefaults.standard.string(forKey: cookieCacheKey)
    }

    /// Builds a `name=value; ...` Cookie header value from every cookie whose
    /// domain contains `aliyun.com` or `alibabacloud.com`.
    ///
    /// Only a WebKit set that looks fully logged in (contains the
    /// `login_aliyunid_ticket` session ticket) is adopted; a partial set (e.g.
    /// tracking cookies like `cna`/`isg` without the ticket) is never persisted
    /// over the last-known-good cache. Persisting to the cache happens in
    /// `QwenTokenPlanBilling.fetchSnapshot` only after a response parses
    /// successfully, so a stale/expired ticket cannot clobber the good cache
    /// either. Returns nil only when neither source has a cookie (user never
    /// logged in, or the cached cookie was cleared).
    static func cookieString(
        store: WKWebsiteDataStore? = nil
    ) async -> String? {
        let cookies: [HTTPCookie] = await Task { @MainActor in
            let store = store ?? WKWebsiteDataStore.default()
            return await withCheckedContinuation { continuation in
                store.httpCookieStore.getAllCookies { continuation.resume(returning: $0) }
            }
        }.value
        let filtered = cookies.filter { cookie in
            let domain = cookie.domain.lowercased()
            return domain.contains("aliyun.com") || domain.contains("alibabacloud.com")
        }
        if !filtered.isEmpty {
            // Adopt only a logged-in session set (has the login ticket).
            let hasTicket = filtered.contains { $0.name == "login_aliyunid_ticket" }
            if hasTicket {
                let joined = filtered
                    .map { "\($0.name)=\($0.value)" }
                    .joined(separator: "; ")
                if !joined.isEmpty {
                    return joined
                }
            }
            // Partial / not-logged-in WebKit set → never adopt or persist; keep the cache.
            return cachedCookie()
        }
        // WebKit store empty (restart before WebKit loaded cookies) → fall back to cache.
        return cachedCookie()
    }
}

// MARK: - Snapshot persistence

/// Persists the last successful Qwen Token Plan quota snapshot to UserDefaults so
/// a cold start can show the last known quota immediately (before the network
/// refresh lands). Plaintext is acceptable for this single-user macOS MVP.
enum QwenTokenPlanSnapshotStore {
    static let snapshotCacheKey = "qwenTokenPlanLastSnapshot"

    static func persist(_ snapshot: QuotaSnapshot) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        guard let data = try? encoder.encode(snapshot) else { return }
        UserDefaults.standard.set(data, forKey: snapshotCacheKey)
    }

    static func load() -> QuotaSnapshot? {
        guard let data = UserDefaults.standard.data(forKey: snapshotCacheKey) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return try? decoder.decode(QuotaSnapshot.self, from: data)
    }
}

// MARK: - Billing / fetch

/// Queries the Aliyun Bailian Qwen Token Plan 个人版 usage endpoint.
///
/// Endpoint (cookie-authenticated, no API key):
///   POST https://bailian-cs.console.aliyun.com/data/api.json
///        ?action=BroadScopeAspnGateway&product=sfm_bailian
///        &api=zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage&_v=undefined
///
/// Response (nested): `data.DataV2.data.data.per5HourPercentage` (0=0%, 1=100%),
/// `per1WeekPercentage`, `per5HourResetTime` (epoch ms), `per1WeekResetTime`.
enum QwenTokenPlanBilling {
    enum BillingError: Error {
        case apiError(String)
        /// Gateway returned HTTP 200 with `errorCode: BailianGateway.Login.NotLogined`.
        case notLogined
        case parseFailed(String)
    }

    static let usageURL = URL(
        string: "https://bailian-cs.console.aliyun.com/data/api.json"
            + "?action=BroadScopeAspnGateway&product=sfm_bailian"
            + "&api=zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage&_v=undefined"
    )!

    // MARK: Parse

    /// Parses the nested usage response into two windows (5h + weekly).
    static func parseSnapshot(from data: Data) throws -> QuotaSnapshot {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dataContainer = root["data"] as? [String: Any],
              let dataV2 = dataContainer["DataV2"] as? [String: Any],
              let dataV2Data = dataV2["data"] as? [String: Any],
              let payload = dataV2Data["data"] as? [String: Any]
        else {
            throw BillingError.parseFailed("data.DataV2.data.data missing")
        }

        return QuotaSnapshot(
            windows: [
                QuotaWindow(
                    id: "fiveHour",
                    usedPercent: clampPercentage(payload["per5HourPercentage"]),
                    resetsAt: epochMsDate(payload["per5HourResetTime"]),
                    label: "5h",
                    title: "5小时额度"
                ),
                QuotaWindow(
                    id: "weekly",
                    usedPercent: clampPercentage(payload["per1WeekPercentage"]),
                    resetsAt: epochMsDate(payload["per1WeekResetTime"]),
                    label: "周",
                    title: "周额度"
                ),
            ],
            selectedWindowId: nil
        )
    }

    // MARK: Fetch

    /// Returns a snapshot, or nil when no session cookie is present (user not
    /// logged in → no pill). Never throws for a missing cookie.
    static func fetchSnapshot(
        session: URLSession = .shared,
        cookieLoader: () async -> String? = { await QwenTokenPlanAuthStore.cookieString() }
    ) async throws -> QuotaSnapshot? {
        guard let cookie = await cookieLoader() else { return nil }

        var request = URLRequest(url: usageURL)
        request.httpMethod = "POST"
        // The cookie is set explicitly below; URLSession's own cookie storage must
        // not inject or rewrite anything on our behalf.
        request.httpShouldHandleCookies = false
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue(cookie, forHTTPHeaderField: "Cookie")
        request.setValue("XMLHttpRequest", forHTTPHeaderField: "X-Requested-With")
        request.setValue("https://bailian.console.aliyun.com", forHTTPHeaderField: "Origin")
        request.setValue("https://bailian.console.aliyun.com", forHTTPHeaderField: "Referer")
        request.setValue(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            forHTTPHeaderField: "User-Agent"
        )
        request.httpBody = bodyData().data(using: .utf8)
        request.timeoutInterval = 15

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw BillingError.apiError("no http response")
        }
        guard http.statusCode == 200 else {
            throw BillingError.apiError("HTTP \(http.statusCode)")
        }
        // The gateway reports stale/absent sessions as HTTP 200 + a NotLogined
        // errorCode body. That is a distinct, logged failure — never a successful
        // fetch, and the cookie used for it must never be persisted over the cache.
        if detectNotLogined(data) {
            Log.warn("qwen token plan: gateway NotLogined; keeping cached session and quota", category: .network)
            throw BillingError.notLogined
        }
        let snapshot = try parseSnapshot(from: data)
        // Only a genuinely successful fetch updates the persisted session cookie
        // and the last-known-good quota snapshot.
        QwenTokenPlanAuthStore.persistCookie(cookie)
        QwenTokenPlanSnapshotStore.persist(snapshot)
        return snapshot
    }

    /// Matches the gateway's NotLogined error body (HTTP 200): a JSON object with
    /// `errorCode` containing `NotLogined` (e.g. `BailianGateway.Login.NotLogined`).
    private static func detectNotLogined(_ data: Data) -> Bool {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let code = root["errorCode"] as? String else { return false }
        return code.contains("NotLogined")
    }

    /// Form-urlencoded body with the `params` JSON (url-encoded).
    private static func bodyData() -> String {
        let params: [String: Any] = [
            "Api": "zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage",
            "V": "1.0",
            "Data": [
                "cornerstoneParam": [
                    "feTraceId": UUID().uuidString,
                    "feURL": bailianTokenPlanURL,
                    "protocol": "V2",
                    "console": "ONE_CONSOLE",
                    "productCode": "p_efm",
                    "switchUserType": 3,
                    "domain": "bailian.console.aliyun.com",
                    "consoleSite": "BAILIAN_ALIYUN",
                    "userNickName": "",
                    "userPrincipalName": "",
                    "xsp_lang": "en-US",
                ]
            ],
        ]
        let json = (try? JSONSerialization.data(withJSONObject: params)) ?? Data()
        let jsonString = String(data: json, encoding: .utf8) ?? ""
        return "product=sfm_bailian&action=BroadScopeAspnGateway&region=cn-beijing"
            + "&language=en-US&params=\(formEncode(jsonString))"
    }

    /// Percent-encodes a string for `application/x-www-form-urlencoded` (keeps
    /// unreserved chars + `/` so the Api/path stay readable).
    private static func formEncode(_ s: String) -> String {
        let allowed = CharacterSet.alphanumerics
            .union(CharacterSet(charactersIn: "*+,-./_~"))
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }

    // MARK: Helpers

    private static func number(_ any: Any?) -> Double? {
        if let d = any as? Double { return d }
        if let i = any as? Int { return Double(i) }
        if let s = any as? String { return Double(s) }
        return nil
    }

    /// API gives fractions (0=0%, 1=100%); convert to percent and clamp 0…100.
    private static func clampPercentage(_ any: Any?) -> Double {
        let v = number(any) ?? 0
        return min(100, max(0, v * 100))
    }

    /// Resets are epoch milliseconds.
    private static func epochMsDate(_ any: Any?) -> Date? {
        guard let ms = number(any), ms > 0 else { return nil }
        return Date(timeIntervalSince1970: ms / 1000)
    }
}

// MARK: - Monitor

final class QwenTokenPlanQuotaMonitor: QuotaMonitor {
    static let shared = QwenTokenPlanQuotaMonitor()
    private let core = QuotaMonitorCore()

    private init() {
        // Seed the last-known-good snapshot (persisted after the previous
        // successful fetch) so the pill shows real quota immediately on cold
        // start; the normal refresh then replaces it with a fresh network value.
        core.seed(QwenTokenPlanSnapshotStore.load())
        core.fetcher = { [weak self] _ in try await self?.fetchQwen() }
    }

    var snapshot: QuotaSnapshot? { core.snapshot }

    @discardableResult
    func observe(_ handler: @escaping (QuotaSnapshot?) -> Void) -> UUID {
        core.observe(handler)
    }

    func removeObserver(_ id: UUID) { core.removeObserver(id) }

    func refreshIfNeeded(force: Bool) { core.refreshIfNeeded(force: force) }

    private func fetchQwen() async throws -> QuotaSnapshot? {
        try await QwenTokenPlanBilling.fetchSnapshot()
    }
}