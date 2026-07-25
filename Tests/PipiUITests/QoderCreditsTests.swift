import XCTest
@testable import PipiUI

final class QoderCreditsTests: XCTestCase {

    /// Real API response captured 2026-07-24 from
    /// `GET https://openapi.qoder.com.cn/api/v2/quota/usage`.
    private let realResponseJSON = """
    {
      "userType": "personal_professional_plus",
      "usageType": "credits",
      "totalUsagePercentage": 0.23,
      "isQuotaExceeded": false,
      "expiresAt": 1787414400000,
      "userQuota": {
        "total": 6000.0, "used": 1122.0, "remaining": 4878.0,
        "percentage": 0.19, "unit": "credits"
      },
      "addOnQuota": {
        "total": 300.0, "used": 300.0, "remaining": 0.0,
        "percentage": 1.0, "unit": "credits"
      }
    }
    """

    func testParseUsageMergesUserAndAddOnQuota() throws {
        let data = Data(realResponseJSON.utf8)
        let usage = try QoderBilling.parseUsage(data)

        // Merged: used 1122+300, total 6000+300, remaining 4878+0.
        XCTAssertEqual(usage.used, 1422, accuracy: 0.001)
        XCTAssertEqual(usage.total, 6300, accuracy: 0.001)
        XCTAssertEqual(usage.remaining, 4878, accuracy: 0.001)

        // Percentage prefers totalUsagePercentage (0.23 → 23%), not merged
        // used/total (1422/6300 ≈ 22.57%).
        XCTAssertEqual(usage.usageFraction, 0.23, accuracy: 0.0001)
        XCTAssertEqual(usage.usedPercent, 23, accuracy: 0.01)

        // Reset time = top-level expiresAt (milliseconds).
        XCTAssertEqual(usage.resetsAt, Date(timeIntervalSince1970: 1787414400000 / 1000))
    }

    func testSnapshotMapsToSingleCreditsWindow() throws {
        let usage = try QoderBilling.parseUsage(Data(realResponseJSON.utf8))
        let snapshot = QoderBilling.snapshot(from: usage)

        XCTAssertEqual(snapshot.windows.count, 1)
        let window = snapshot.windows[0]
        XCTAssertEqual(window.id, "credits")
        XCTAssertEqual(window.usedPercent, 23, accuracy: 0.01)
        XCTAssertEqual(window.resetsAt, Date(timeIntervalSince1970: 1787414400000 / 1000))
        XCTAssertEqual(snapshot.capsule?.id, "credits")
    }

    func testParseUsageFallsBackToUsedOverTotalWithoutTotalUsagePercentage() throws {
        let json = """
        {
          "expiresAt": 1787414400000,
          "userQuota": { "total": 1000.0, "used": 250.0, "remaining": 750.0 },
          "addOnQuota": { "total": 100.0, "used": 50.0, "remaining": 50.0 }
        }
        """
        let usage = try QoderBilling.parseUsage(Data(json.utf8))
        XCTAssertEqual(usage.used, 300, accuracy: 0.001)
        XCTAssertEqual(usage.total, 1100, accuracy: 0.001)
        XCTAssertEqual(usage.usedPercent, 300.0 / 1100.0 * 100, accuracy: 0.01)
    }

    func testParseUsageWorksWithoutAddOnQuota() throws {
        let json = """
        {
          "totalUsagePercentage": 0.5,
          "userQuota": { "total": 200.0, "used": 100.0, "remaining": 100.0 }
        }
        """
        let usage = try QoderBilling.parseUsage(Data(json.utf8))
        XCTAssertEqual(usage.total, 200, accuracy: 0.001)
        XCTAssertEqual(usage.used, 100, accuracy: 0.001)
        XCTAssertEqual(usage.usedPercent, 50, accuracy: 0.01)
        XCTAssertNil(usage.resetsAt)
    }

    func testParseUsageRejectsMissingUserQuota() {
        XCTAssertThrowsError(try QoderBilling.parseUsage(Data("{}".utf8)))
    }

    // MARK: - Auth / PAT parsing

    func testPatFromRefreshSplitsPipeFormat() {
        let pat = QoderAuthStore.patFromRefresh("pat|MY_PAT_VALUE|jrt-123|uid-9|mid-4")
        XCTAssertEqual(pat, "MY_PAT_VALUE")
    }

    func testPatFromRefreshRejectsNonPatFormat() {
        XCTAssertNil(QoderAuthStore.patFromRefresh(nil))
        XCTAssertNil(QoderAuthStore.patFromRefresh(""))
        XCTAssertNil(QoderAuthStore.patFromRefresh("opaque-refresh-token"))
        XCTAssertNil(QoderAuthStore.patFromRefresh("pat|"))
    }

    func testLoadPrefersCNEntryAndParsesCredentials() throws {
        let authJSON = """
        {
          "qoder-cn": {
            "refresh": "pat|CN_PAT|jrt|uid|mid",
            "access": "cn-job-token",
            "expires": 9999999999999,
            "type": "oauth"
          },
          "qoder": {
            "refresh": "pat|INTL_PAT|jrt|uid|mid",
            "access": "intl-job-token",
            "expires": 9999999999999,
            "type": "oauth"
          }
        }
        """
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-qoder-auth-\(UUID().uuidString).json")
        try Data(authJSON.utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }

        let creds = try XCTUnwrap(QoderAuthStore.load(authURL: url))
        XCTAssertEqual(creds.region, .cn)
        XCTAssertEqual(creds.access, "cn-job-token")
        XCTAssertEqual(creds.pat, "CN_PAT")
        XCTAssertTrue(creds.accessValid)
    }

    func testLoadFallsBackToInternationalEntry() throws {
        let authJSON = """
        {
          "qoder": {
            "refresh": "pat|INTL_PAT|jrt|uid|mid",
            "access": "intl-job-token",
            "expires": 0,
            "type": "oauth"
          }
        }
        """
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-qoder-auth-\(UUID().uuidString).json")
        try Data(authJSON.utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }

        let creds = try XCTUnwrap(QoderAuthStore.load(authURL: url))
        XCTAssertEqual(creds.region, .international)
        XCTAssertFalse(creds.accessValid)  // expires = 0 → long past
        XCTAssertEqual(creds.pat, "INTL_PAT")
    }

    func testLoadReturnsNilWithoutQoderEntries() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-qoder-auth-\(UUID().uuidString).json")
        try Data(#"{"kimi-coding": {"type": "oauth", "access": "x"}}"#.utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }

        XCTAssertNil(QoderAuthStore.load(authURL: url))
    }

    func testRegionURLs() {
        XCTAssertEqual(
            QoderBilling.usageURL(region: .cn).absoluteString,
            "https://openapi.qoder.com.cn/api/v2/quota/usage")
        XCTAssertEqual(
            QoderBilling.usageURL(region: .international).absoluteString,
            "https://openapi.qoder.sh/api/v2/quota/usage")
        XCTAssertEqual(
            QoderBilling.exchangeURL(region: .cn).absoluteString,
            "https://openapi.qoder.com.cn/api/v1/jobToken/exchange")
    }

    // MARK: - Provider routing

    func testQuotaProviderRoutingForQoder() {
        XCTAssertEqual(
            ModelInfo(provider: "qoder", modelId: "auto", name: "Qoder", contextWindow: nil)
                .quotaProvider, .qoder)
        XCTAssertEqual(
            ModelInfo(provider: "qoder-cn", modelId: "auto", name: "Qoder CN", contextWindow: nil)
                .quotaProvider, .qoder)
        XCTAssertEqual(QuotaProvider.qoder.accountLabel, "Qoder 账号额度")
    }
}
