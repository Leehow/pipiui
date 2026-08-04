import XCTest
@testable import PipiUI
import Foundation

final class EmptyStateCredentialSummaryTests: XCTestCase {
    private var tmpDir: URL!
    private var envURL: URL!
    private var authURL: URL!
    private var envStore: EnvFileStore!

    override func setUpWithError() throws {
        tmpDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("EmptyStateCred-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
        envURL = tmpDir.appendingPathComponent(".env")
        authURL = tmpDir.appendingPathComponent("auth.json")
        envStore = EnvFileStore(fileURL: envURL)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: tmpDir)
    }

    func testEmptyWhenNoEnvAndNoAuth() {
        let rows = EmptyStateCredentialSummary.load(envStore: envStore, authURL: authURL)
        XCTAssertTrue(rows.isEmpty)
    }

    func testEnvModelProviderCounts() throws {
        try envStore.setSync("sk-test", forKey: "DEEPSEEK_API_KEY")
        let ids = EmptyStateCredentialSummary.load(envStore: envStore, authURL: authURL)
            .map(\.providerId).sorted()
        XCTAssertEqual(ids, ["deepseek"])
    }

    func testSearchOnlyEnvKeyDoesNotCount() throws {
        try envStore.setSync("tvly-test", forKey: "TAVILY_API_KEY")
        let rows = EmptyStateCredentialSummary.load(envStore: envStore, authURL: authURL)
        XCTAssertTrue(rows.isEmpty, "search keys must not count as model credentials")
    }

    func testAuthJsonOauthCounts() throws {
        // Minimal oauth-shaped entry (type != api_key residue after migration).
        let json = """
        {"anthropic":{"type":"oauth","access":"x","refresh":"y"}}
        """
        try json.write(to: authURL, atomically: true, encoding: .utf8)
        let ids = EmptyStateCredentialSummary.load(envStore: envStore, authURL: authURL)
            .map(\.providerId)
        XCTAssertEqual(ids, ["anthropic"])
    }

    func testDedupesEnvAndAuthSameProvider() throws {
        try envStore.setSync("sk-ant", forKey: "ANTHROPIC_API_KEY")
        let json = """
        {"anthropic":{"type":"oauth","access":"x"}}
        """
        try json.write(to: authURL, atomically: true, encoding: .utf8)
        let ids = EmptyStateCredentialSummary.load(envStore: envStore, authURL: authURL)
            .map(\.providerId)
        XCTAssertEqual(ids, ["anthropic"])
    }

    func testSortedByProviderId() throws {
        try envStore.setSync("a", forKey: "XAI_API_KEY")
        try envStore.setSync("b", forKey: "DEEPSEEK_API_KEY")
        let ids = EmptyStateCredentialSummary.load(envStore: envStore, authURL: authURL)
            .map(\.providerId)
        XCTAssertEqual(ids, ["deepseek", "xai"])
    }

    func testStatusTextPrefersQuotaOverBalance() {
        XCTAssertEqual(
            EmptyStateCredentialSummary.statusText(quotaUsedPercent: 42, balanceText: "¥10.00"),
            "已用 42%"
        )
    }

    func testStatusTextBalanceWhenNoQuota() {
        XCTAssertEqual(
            EmptyStateCredentialSummary.statusText(quotaUsedPercent: nil, balanceText: "$1.25"),
            "$1.25"
        )
    }

    func testStatusTextConfiguredFallback() {
        XCTAssertEqual(
            EmptyStateCredentialSummary.statusText(quotaUsedPercent: nil, balanceText: nil),
            "已配置"
        )
    }

    func testStatusTextRoundsPercent() {
        XCTAssertEqual(
            EmptyStateCredentialSummary.statusText(quotaUsedPercent: 41.6, balanceText: nil),
            "已用 42%"
        )
    }

    func testQuotaProviderRoutingMatchesModelInfo() {
        XCTAssertEqual(quotaProvider(for: "xai"), .grok)
        XCTAssertEqual(quotaProvider(for: "kimi-coding"), .kimi)
        XCTAssertEqual(quotaProvider(for: "deepseek"), nil) // balance-only
        XCTAssertNil(quotaProvider(for: "openai-relay"))
    }
}
