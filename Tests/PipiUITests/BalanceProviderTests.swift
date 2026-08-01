import XCTest
@testable import PipiUI

/// Routing + parse + format for pay-per-token balance pills (no network).
final class BalanceProviderTests: XCTestCase {

    override func setUp() {
        super.setUp()
        QuotaEnvFallback.envFileValues = { [:] }
    }

    override func tearDown() {
        QuotaEnvFallback.envFileValues = { EnvFileStore().all() }
        super.tearDown()
    }

    // MARK: - Routing

    func testBalanceProviderRoutingPositive() {
        XCTAssertEqual(balanceProvider(for: "deepseek"), .deepseek)
        XCTAssertEqual(balanceProvider(for: "deepseek-v4"), .deepseek)
        XCTAssertEqual(balanceProvider(for: "moonshot"), .moonshot)
        XCTAssertEqual(balanceProvider(for: "moonshot-cn"), .moonshot)
        XCTAssertEqual(balanceProvider(for: "siliconflow"), .siliconflow)
        XCTAssertEqual(balanceProvider(for: "openrouter"), .openrouter)

        XCTAssertEqual(
            ModelInfo(provider: "deepseek", modelId: "deepseek-chat", name: "DS", contextWindow: nil).balanceProvider,
            .deepseek
        )
        XCTAssertEqual(
            ModelInfo(provider: "moonshot", modelId: "kimi-k2", name: "Kimi", contextWindow: nil).balanceProvider,
            .moonshot
        )
        XCTAssertEqual(
            ModelInfo(provider: "siliconflow", modelId: "x", name: "x", contextWindow: nil).balanceProvider,
            .siliconflow
        )
        XCTAssertEqual(
            ModelInfo(provider: "openrouter", modelId: "meta/llama", name: "Llama", contextWindow: nil).balanceProvider,
            .openrouter
        )
    }

    func testBalanceProviderRoutingNegative() {
        // Subscription / quota-only providers → nil balance source.
        XCTAssertNil(balanceProvider(for: "kimi"))
        XCTAssertNil(balanceProvider(for: "kimi-coding"))
        XCTAssertNil(balanceProvider(for: "openai"))
        XCTAssertNil(balanceProvider(for: "openai-codex"))
        XCTAssertNil(balanceProvider(for: "anthropic"))
        XCTAssertNil(balanceProvider(for: "xai"))
        XCTAssertNil(balanceProvider(for: "zai"))
        XCTAssertNil(balanceProvider(for: "bigmodel"))
        XCTAssertNil(balanceProvider(for: "qoder"))
        XCTAssertNil(balanceProvider(for: "acme"))
        XCTAssertNil(balanceProvider(for: "relay:foo"))
        XCTAssertNil(balanceProvider(for: "deepseek-relay"))

        XCTAssertNil(ModelInfo(provider: "kimi-coding", modelId: "k", name: "k", contextWindow: nil).balanceProvider)
        XCTAssertNil(ModelInfo(provider: "acme", modelId: "x", name: "x", contextWindow: nil).balanceProvider)
        XCTAssertNil(ModelInfo(provider: "grok-relay", modelId: "g", name: "g", contextWindow: nil).balanceProvider)
    }

    func testBalanceEnvNamesFromProviderEnvMap() {
        XCTAssertEqual(BalanceProvider.deepseek.apiKeyEnvNames.first, "DEEPSEEK_API_KEY")
        XCTAssertEqual(BalanceProvider.openrouter.apiKeyEnvNames.first, "OPENROUTER_API_KEY")
        XCTAssertTrue(BalanceProvider.moonshot.apiKeyEnvNames.contains("MOONSHOT_API_KEY"))
        XCTAssertEqual(BalanceProvider.siliconflow.apiKeyEnvNames.first, "SILICONFLOW_API_KEY")
    }

    // MARK: - Key resolution (QuotaEnvFallback)

    func testBalanceKeyFallsBackToDotEnv() {
        QuotaEnvFallback.envFileValues = { ["DEEPSEEK_API_KEY": "dotenv-ds"] }
        XCTAssertEqual(BalanceAuthStore.apiKey(for: .deepseek, env: [:]), "dotenv-ds")
    }

    func testBalanceProcessEnvWinsOverDotEnv() {
        QuotaEnvFallback.envFileValues = { ["OPENROUTER_API_KEY": "dotenv-or"] }
        XCTAssertEqual(
            BalanceAuthStore.apiKey(for: .openrouter, env: ["OPENROUTER_API_KEY": "process-or"]),
            "process-or"
        )
    }

    // MARK: - Parse fixtures

    func testParseDeepSeekBalance() {
        let json = """
        {"is_available":true,"balance_infos":[{"currency":"CNY","total_balance":"110.00","granted_balance":"0.00","topped_up_balance":"110.00"}]}
        """
        let snap = BalanceBilling.parseDeepSeek(from: Data(json.utf8))
        XCTAssertEqual(snap?.amount, Decimal(string: "110.00"))
        XCTAssertEqual(snap?.currency, "CNY")
    }

    func testParseDeepSeekUnavailable() {
        let json = """
        {"is_available":false,"balance_infos":[{"currency":"CNY","total_balance":"110.00"}]}
        """
        XCTAssertNil(BalanceBilling.parseDeepSeek(from: Data(json.utf8)))
    }

    func testParseMoonshotBalance() {
        let json = """
        {"code":0,"data":{"available_balance":49.58894,"voucher_balance":0,"cash_balance":49.58894}}
        """
        let snap = BalanceBilling.parseMoonshot(from: Data(json.utf8))
        XCTAssertNotNil(snap)
        XCTAssertEqual(snap?.currency, "CNY")
        // Double→Decimal path; compare via formatted string.
        XCTAssertEqual(formatBalance(amount: snap!.amount, currency: "CNY"), "¥49.59")
    }

    func testParseSiliconFlowBalance() {
        let json = """
        {"status":true,"data":{"balance":"0.88","chargeBalance":"88.00","totalBalance":"88.88"}}
        """
        let snap = BalanceBilling.parseSiliconFlow(from: Data(json.utf8))
        XCTAssertEqual(snap?.amount, Decimal(string: "88.88"))
        XCTAssertEqual(snap?.currency, "CNY")
    }

    func testParseOpenRouterRemaining() {
        let json = """
        {"data":{"total_credits":100.5,"total_usage":25.75}}
        """
        let snap = BalanceBilling.parseOpenRouter(from: Data(json.utf8))
        XCTAssertEqual(snap?.currency, "USD")
        // 100.5 - 25.75 = 74.75
        XCTAssertEqual(formatBalance(amount: snap!.amount, currency: "USD"), "$74.75")
    }

    func testParseShapeMismatchReturnsNil() {
        XCTAssertNil(BalanceBilling.parseDeepSeek(from: Data(#"{"foo":1}"#.utf8)))
        XCTAssertNil(BalanceBilling.parseMoonshot(from: Data(#"{"code":1,"data":{}}"#.utf8)))
        XCTAssertNil(BalanceBilling.parseSiliconFlow(from: Data(#"{"status":false}"#.utf8)))
        XCTAssertNil(BalanceBilling.parseOpenRouter(from: Data(#"{"data":{}}"#.utf8)))
    }

    // MARK: - Format

    func testFormatBalanceCNY() {
        XCTAssertEqual(formatBalance(amount: Decimal(110), currency: "CNY"), "¥110.00")
        XCTAssertEqual(formatBalance(amount: Decimal(string: "110.00")!, currency: "CNY"), "¥110.00")
    }

    func testFormatBalanceUSDRounding() {
        XCTAssertEqual(formatBalance(amount: Decimal(string: "74.754")!, currency: "USD"), "$74.75")
        XCTAssertEqual(formatBalance(amount: Decimal(string: "74.755")!, currency: "USD"), "$74.76")
    }

    // MARK: - Spend display (balance popover)

    func testBalanceSpendDisplayFormatsRowsInUSD() {
        let d = BalanceSpendDisplay(sessionCostUSD: 0.123456, last30DaysUSD: 12.3456, unit: .usd, rate: 6.8)
        XCTAssertEqual(d.sessionSpend, "$0.123")
        XCTAssertEqual(d.last30DaysSpend, "$12.35")
    }

    func testBalanceSpendDisplayZeroValues() {
        let d = BalanceSpendDisplay(sessionCostUSD: 0, last30DaysUSD: 0, unit: .usd, rate: 6.8)
        XCTAssertEqual(d.sessionSpend, "$0")
        XCTAssertEqual(d.last30DaysSpend, "$0")
    }

    func testBalanceSpendDisplayConvertsBothRowsToCNY() {
        let d = BalanceSpendDisplay(sessionCostUSD: 1.0, last30DaysUSD: 0.001, unit: .cny, rate: 6.8)
        XCTAssertEqual(d.sessionSpend, "¥6.80")
        XCTAssertEqual(d.last30DaysSpend, "¥0.0068")
    }

    func testBalanceSpendDisplayRoundsSubCentUSD() {
        let d = BalanceSpendDisplay(sessionCostUSD: 0.00001234, last30DaysUSD: 0.5, unit: .usd, rate: 6.8)
        XCTAssertEqual(d.sessionSpend, "$0.0000")
        XCTAssertEqual(d.last30DaysSpend, "$0.500")
    }
}
