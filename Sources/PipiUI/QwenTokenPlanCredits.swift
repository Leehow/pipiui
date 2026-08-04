import Foundation
import WebKit

// MARK: - Auth

/// Resolves 阿里云百炼 (Aliyun Bailian) Qwen Token Plan 个人版 session cookies from
/// the embedded browser's persistent cookie store.
///
/// The user logs into the Bailian console in pipiui's built-in WKWebView; the
/// session cookies (including httpOnly) land in `WKWebsiteDataStore.default()`.
/// We read those cookies and forward them to the usage API. No API key is used.
enum QwenTokenPlanAuthStore {
    /// Builds a `name=value; ...` Cookie header value from every cookie whose
    /// domain contains `aliyun.com` or `alibabacloud.com`. Returns nil when none
    /// are present (user hasn't logged in).
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
        guard !filtered.isEmpty else { return nil }
        let joined = filtered
            .map { "\($0.name)=\($0.value)" }
            .joined(separator: "; ")
        return joined.isEmpty ? nil : joined
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
        return try parseSnapshot(from: data)
    }

    /// Form-urlencoded body with the `params` JSON (url-encoded).
    private static func bodyData() -> String {
        let params: [String: Any] = [
            "Api": "zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage",
            "V": "1.0",
            "Data": [
                "cornerstoneParam": [
                    "feTraceId": UUID().uuidString,
                    "feURL": "https://bailian.console.aliyun.com/cn-beijing?tab=plan#/efm/subscription/token-plan/personal",
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