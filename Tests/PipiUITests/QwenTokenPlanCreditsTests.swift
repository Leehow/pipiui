import XCTest
@testable import PipiUI
import WebKit

/// Tests for the Aliyun Bailian Qwen Token Plan personal-plan quota integration.
/// All tests are offline: parsing uses a fixture, and the no-cookie path uses an
/// injected cookie loader so nothing touches `WKWebsiteDataStore` or the network.
final class QwenTokenPlanCreditsTests: XCTestCase {

    /// Real-shaped response (nested `data.DataV2.data.data`). Percentages are
    /// fractions (0=0%, 1=100%); resets are epoch milliseconds.
    private let fixtureJSON = """
    {
      "data": {
        "DataV2": {
          "data": {
            "data": {
              "per5HourPercentage": 0.42,
              "per5HourResetTime": 1785870780000,
              "per1WeekPercentage": 0.87,
              "per1WeekResetTime": 1785870780000
            }
          }
        }
      }
    }
    """

    // MARK: - Parse

    func testParseSnapshotProducesTwoWindows() throws {
        let snap = try QwenTokenPlanBilling.parseSnapshot(from: Data(fixtureJSON.utf8))

        XCTAssertEqual(snap.windows.count, 2)

        let fiveHour = try XCTUnwrap(snap.windows.first { $0.id == "fiveHour" })
        XCTAssertEqual(fiveHour.usedPercent, 42, accuracy: 0.001)
        XCTAssertEqual(fiveHour.label, "5h")
        XCTAssertEqual(fiveHour.title, "5小时额度")
        XCTAssertEqual(fiveHour.resetsAt, Date(timeIntervalSince1970: 1785870780000 / 1000))

        let weekly = try XCTUnwrap(snap.windows.first { $0.id == "weekly" })
        XCTAssertEqual(weekly.usedPercent, 87, accuracy: 0.001)
        XCTAssertEqual(weekly.label, "周")
        XCTAssertEqual(weekly.title, "周额度")
        XCTAssertEqual(weekly.resetsAt, Date(timeIntervalSince1970: 1785870780000 / 1000))

        // Default capsule = highest usage (weekly 87%).
        XCTAssertEqual(snap.capsule?.id, "weekly")
        XCTAssertEqual(snap.capsule?.usedPercent ?? -1, 87, accuracy: 0.001)
        // Selecting the 5h window reflects 42%.
        XCTAssertEqual(snap.copy(selectedWindowId: "fiveHour").capsule?.usedPercent ?? -1, 42, accuracy: 0.001)
    }

    func testParseSnapshotClampsPercentagesToZeroToOneHundred() throws {
        let json = """
        {
          "data": { "DataV2": { "data": { "data": {
            "per5HourPercentage": 1.5,
            "per1WeekPercentage": -0.2,
            "per5HourResetTime": 1785870780000,
            "per1WeekResetTime": 1785870780000
          } } } }
        }
        """
        let snap = try QwenTokenPlanBilling.parseSnapshot(from: Data(json.utf8))
        let fiveHour = try XCTUnwrap(snap.windows.first { $0.id == "fiveHour" })
        let weekly = try XCTUnwrap(snap.windows.first { $0.id == "weekly" })
        XCTAssertEqual(fiveHour.usedPercent, 100, accuracy: 0.001)
        XCTAssertEqual(weekly.usedPercent, 0, accuracy: 0.001)
    }

    func testParseSnapshotRejectsMissingNestedPayload() throws {
        XCTAssertThrowsError(try QwenTokenPlanBilling.parseSnapshot(from: Data("{}".utf8)))
    }

    // MARK: - No cookie → nil

    func testFetchSnapshotReturnsNilWithoutCookie() async throws {
        let snap = try await QwenTokenPlanBilling.fetchSnapshot(
            cookieLoader: { nil }
        )
        XCTAssertNil(snap)
    }

    // MARK: - Routing

    func testQuotaProviderRouting() {
        XCTAssertEqual(
            ModelInfo(provider: "qwen-token-plan", modelId: "qwen-max", name: "Qwen", contextWindow: nil)
                .quotaProvider, .qwenTokenPlan)
        XCTAssertEqual(
            ModelInfo(provider: "qwen-token-plan-cn", modelId: "qwen-max", name: "Qwen CN", contextWindow: nil)
                .quotaProvider, .qwenTokenPlan)

        // Vision / dashscope models must NOT map to the token-plan quota.
        XCTAssertNil(ModelInfo(provider: "qwen-vl", modelId: "qwen-vl-max", name: "Qwen VL", contextWindow: nil).quotaProvider)
        XCTAssertNil(ModelInfo(provider: "dashscope", modelId: "qwen-max", name: "Dashscope", contextWindow: nil).quotaProvider)
    }

    func testAccountLabelNonEmpty() {
        XCTAssertEqual(QuotaProvider.qwenTokenPlan.accountLabel, "Qwen Token Plan 额度")
    }

    // MARK: - Cookie persistence (offline)

    /// WebKit store empty + persisted cache present → cookieString returns the cache.
    func testCookieStringFallsBackToCacheWhenWebKitEmpty() async throws {
        let cached = "aliyun_session=abc123; aliyun_identity=xyz"
        QwenTokenPlanAuthStore.persistCookie(cached)
        defer {
            UserDefaults.standard.removeObject(forKey: "qwenTokenPlanCookie")
        }

        // An empty WKWebsiteDataStore yields no cookies → falls back to cache.
        let store = WKWebsiteDataStore.nonPersistent()
        let result = await QwenTokenPlanAuthStore.cookieString(store: store)
        XCTAssertEqual(result, cached)
    }

    /// Persist + read helpers round-trip correctly.
    func testCookieCacheRoundTrip() {
        defer {
            UserDefaults.standard.removeObject(forKey: "qwenTokenPlanCookie")
        }
        XCTAssertNil(QwenTokenPlanAuthStore.cachedCookie())
        QwenTokenPlanAuthStore.persistCookie("k=v; k2=v2")
        XCTAssertEqual(QwenTokenPlanAuthStore.cachedCookie(), "k=v; k2=v2")
    }

    /// No cache and empty WebKit store → nil.
    func testCookieStringReturnsNilWhenBothEmpty() async throws {
        UserDefaults.standard.removeObject(forKey: "qwenTokenPlanCookie")
        defer {
            UserDefaults.standard.removeObject(forKey: "qwenTokenPlanCookie")
        }
        let store = WKWebsiteDataStore.nonPersistent()
        let result = await QwenTokenPlanAuthStore.cookieString(store: store)
        XCTAssertNil(result)
    }

    /// Partial WebKit cookies (tracking-only: `cna`/`isg`, no
    /// `login_aliyunid_ticket`) must NOT overwrite a good cached session cookie;
    /// `cookieString()` returns the cached one and leaves the cache untouched.
    func testPartialWebKitCookiesDoNotClobberCachedCookie() async throws {
        let cached = "aliyun_session=good; login_aliyunid_ticket=ticket123"
        QwenTokenPlanAuthStore.persistCookie(cached)
        defer {
            UserDefaults.standard.removeObject(forKey: "qwenTokenPlanCookie")
        }

        let store = WKWebsiteDataStore.nonPersistent()
        await store.httpCookieStore.setCookie(makeCookie(name: "cna", value: "tracking"))
        await store.httpCookieStore.setCookie(makeCookie(name: "isg", value: "tracking2"))

        let result = await QwenTokenPlanAuthStore.cookieString(store: store)

        XCTAssertEqual(result, cached,
            "partial WebKit set must fall back to the cached session cookie")
        XCTAssertEqual(QwenTokenPlanAuthStore.cachedCookie(), cached,
            "partial WebKit set must never be persisted over the cache")
    }

    /// A logged-in WebKit set (contains `login_aliyunid_ticket`) IS adopted.
    func testLoggedInWebKitCookiesAreAdopted() async throws {
        defer {
            UserDefaults.standard.removeObject(forKey: "qwenTokenPlanCookie")
        }

        let store = WKWebsiteDataStore.nonPersistent()
        await store.httpCookieStore.setCookie(makeCookie(name: "cna", value: "tracking"))
        await store.httpCookieStore.setCookie(makeCookie(name: "login_aliyunid_ticket", value: "ticket456"))

        let result = await QwenTokenPlanAuthStore.cookieString(store: store)

        XCTAssertNotNil(result)
        XCTAssertTrue(result?.contains("login_aliyunid_ticket=ticket456") == true,
            "logged-in WebKit set must be adopted")
        XCTAssertTrue(result?.contains("cna=tracking") == true)
    }

    // MARK: - Fetch / persistence (offline, stubbed URLSession)

    /// A successful snapshot fetch persists BOTH the session cookie and the
    /// snapshot, so a restart can restore them.
    func testSuccessfulFetchPersistsCookieAndSnapshot() async throws {
        UserDefaults.standard.removeObject(forKey: "qwenTokenPlanCookie")
        UserDefaults.standard.removeObject(forKey: "qwenTokenPlanLastSnapshot")
        defer {
            UserDefaults.standard.removeObject(forKey: "qwenTokenPlanCookie")
            UserDefaults.standard.removeObject(forKey: "qwenTokenPlanLastSnapshot")
            StubBaseURLProtocol.handler = nil
        }

        let session = stubURLSession(status: 200, body: fixtureJSON)
        let cookie = "aliyun_session=good; login_aliyunid_ticket=ticket456"

        let result = try await QwenTokenPlanBilling.fetchSnapshot(
            session: session,
            cookieLoader: { cookie }
        )
        let snap = try XCTUnwrap(result)
        XCTAssertEqual(snap.windows.count, 2)
        XCTAssertEqual(snap.capsule?.id, "weekly")
        XCTAssertEqual(QwenTokenPlanAuthStore.cachedCookie(), cookie,
            "successful fetch must persist the session cookie")
        XCTAssertEqual(QwenTokenPlanSnapshotStore.load(), snap,
            "successful fetch must persist the quota snapshot")
    }

    /// NotLogined comes back as HTTP 200 + `errorCode`; it must throw a distinct
    /// error and must never overwrite the cached good cookie/snapshot.
    func testNotLoginedResponseThrowsAndDoesNotPersist() async throws {
        UserDefaults.standard.removeObject(forKey: "qwenTokenPlanCookie")
        UserDefaults.standard.removeObject(forKey: "qwenTokenPlanLastSnapshot")
        let goodCookie = "aliyun_session=good; login_aliyunid_ticket=ticket123"
        let goodSnap = QuotaSnapshot(
            windows: [QuotaWindow(id: "fiveHour", usedPercent: 42, resetsAt: nil, label: "5h", title: "5小时额度")],
            selectedWindowId: nil
        )
        QwenTokenPlanAuthStore.persistCookie(goodCookie)
        QwenTokenPlanSnapshotStore.persist(goodSnap)
        defer {
            UserDefaults.standard.removeObject(forKey: "qwenTokenPlanCookie")
            UserDefaults.standard.removeObject(forKey: "qwenTokenPlanLastSnapshot")
            StubBaseURLProtocol.handler = nil
        }

        let notLoginedBody = #"{"errorCode":"BailianGateway.Login.NotLogined","message":"not logged in"}"#
        let session = stubURLSession(status: 200, body: notLoginedBody)

        do {
            let snap = try await QwenTokenPlanBilling.fetchSnapshot(
                session: session,
                cookieLoader: { "aliyun_session=stale; login_aliyunid_ticket=expired" }
            )
            XCTFail("expected a throw, got \(String(describing: snap))")
        } catch QwenTokenPlanBilling.BillingError.notLogined {
            // expected: distinct, recognizable error
        } catch {
            XCTFail("unexpected error: \(error)")
        }

        // Caches must be untouched: the stale cookie used for the failed fetch is
        // never persisted over the last-known-good ones.
        XCTAssertEqual(QwenTokenPlanAuthStore.cachedCookie(), goodCookie)
        XCTAssertEqual(QwenTokenPlanSnapshotStore.load(), goodSnap)
    }

    // MARK: - Snapshot seeding at startup

    /// The persisted snapshot round-trips through JSON, and seeding a fresh
    /// `QuotaMonitorCore` from it delivers the saved quota to observers
    /// immediately — exactly what the monitor does at startup.
    func testPersistedSnapshotSeedsMonitorAtStartup() {
        UserDefaults.standard.removeObject(forKey: "qwenTokenPlanLastSnapshot")
        defer {
            UserDefaults.standard.removeObject(forKey: "qwenTokenPlanLastSnapshot")
        }
        let saved = QuotaSnapshot(
            windows: [
                QuotaWindow(id: "fiveHour", usedPercent: 42, resetsAt: nil, label: "5h", title: "5小时额度"),
                QuotaWindow(id: "weekly", usedPercent: 87,
                            resetsAt: Date(timeIntervalSince1970: 1785870780),
                            label: "周", title: "周额度"),
            ],
            selectedWindowId: nil
        )
        QwenTokenPlanSnapshotStore.persist(saved)

        // load() round-trips the JSON encoding (including resetsAt).
        XCTAssertEqual(QwenTokenPlanSnapshotStore.load(), saved)

        // A fresh core seeded from disk behaves like the monitor at startup.
        let core = QuotaMonitorCore()
        core.seed(QwenTokenPlanSnapshotStore.load())
        var delivered: [QuotaSnapshot?] = []
        let id = core.observe { delivered.append($0) }
        defer { core.removeObserver(id) }

        XCTAssertEqual(delivered.first ?? nil, saved,
            "seeded snapshot must be delivered to observers immediately")
        XCTAssertEqual(core.snapshot, saved)
    }

    // MARK: - Test helpers

    private func makeCookie(name: String, value: String, domain: String = ".aliyun.com") -> HTTPCookie {
        HTTPCookie(properties: [
            .domain: domain,
            .path: "/",
            .name: name,
            .value: value,
            .expires: Date().addingTimeInterval(3600),
        ])!
    }

    /// Stub URLSession that answers every request with a canned status + body.
    private func stubURLSession(status: Int, body: String) -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubBaseURLProtocol.self]
        StubBaseURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url ?? QwenTokenPlanBilling.usageURL,
                statusCode: status,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data(body.utf8))
        }
        return URLSession(configuration: config)
    }

    /// Minimal URLProtocol stub: returns the canned response for any request.
    private final class StubBaseURLProtocol: URLProtocol {
        static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func startLoading() {
            guard let handler = Self.handler else {
                client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
                return
            }
            do {
                let (response, data) = try handler(request)
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data)
                client?.urlProtocolDidFinishLoading(self)
            } catch {
                client?.urlProtocol(self, didFailWithError: error)
            }
        }

        override func stopLoading() {}
    }
}