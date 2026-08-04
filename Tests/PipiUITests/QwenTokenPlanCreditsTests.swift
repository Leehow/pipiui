import XCTest
@testable import PipiUI

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
}