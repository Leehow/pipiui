import XCTest
@testable import PipiUI

/// formatSpend / FXRateStore.parseRate / PricingSettings persistence (no network).
final class PricingSettingsTests: XCTestCase {
    private func tempSuite() -> (String, UserDefaults) {
        let name = "pipiui.test.pricing.\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: name)!
        return (name, suite)
    }

    // MARK: - formatSpend (USD)

    func testFormatSpendUSDZero() {
        XCTAssertEqual(formatSpend(usdCost: 0, unit: .usd, rate: 6.8), "$0")
        XCTAssertEqual(formatSpend(usdCost: -0.5, unit: .usd, rate: 6.8), "$0")
    }

    func testFormatSpendUSDSubCentKeepsFourDecimals() {
        XCTAssertEqual(formatSpend(usdCost: 0.00123, unit: .usd, rate: 6.8), "$0.0012")
        XCTAssertEqual(formatSpend(usdCost: 0.00001234, unit: .usd, rate: 6.8), "$0.0000")
    }

    func testFormatSpendUSDAdaptivePrecision() {
        XCTAssertEqual(formatSpend(usdCost: 0.005, unit: .usd, rate: 6.8), "$0.0050")
        XCTAssertEqual(formatSpend(usdCost: 0.5, unit: .usd, rate: 6.8), "$0.500")
        XCTAssertEqual(formatSpend(usdCost: 12.3456, unit: .usd, rate: 6.8), "$12.35")
    }

    // MARK: - formatSpend (CNY conversion)

    func testFormatSpendCNYConversion() {
        // 1.23 USD × 6.80 = 8.364 CNY → ¥8.36
        XCTAssertEqual(formatSpend(usdCost: 1.23, unit: .cny, rate: 6.80), "¥8.36")
    }

    func testFormatSpendCNYZero() {
        XCTAssertEqual(formatSpend(usdCost: 0, unit: .cny, rate: 6.8), "¥0")
    }

    func testFormatSpendCNYAdaptivePrecision() {
        // 0.0005 × 6.8 = 0.0034 (< 0.01 → 4 decimals)
        XCTAssertEqual(formatSpend(usdCost: 0.0005, unit: .cny, rate: 6.8), "¥0.0034")
        // 0.02 × 6.8 = 0.136 (< 1 → 3 decimals)
        XCTAssertEqual(formatSpend(usdCost: 0.02, unit: .cny, rate: 6.8), "¥0.136")
        // 1.5 × 6.8 = 10.2 (≥ 1 → 2 decimals)
        XCTAssertEqual(formatSpend(usdCost: 1.5, unit: .cny, rate: 6.8), "¥10.20")
    }

    func testFormatSpendCNYRounding() {
        // 1.0 / 6.8 × 6.8 = 1.0 → ¥1.00 (round-trip through the rate).
        XCTAssertEqual(formatSpend(usdCost: 1.0 / 6.8, unit: .cny, rate: 6.8), "¥1.00")
    }

    // MARK: - FXRateStore.parseRate

    func testParseRateExchangeRateAPIShape() throws {
        let json = """
        {"result":"success","base_code":"USD","time_last_update_unix":1750000000,"rates":{"CNY":6.76,"JPY":160.0}}
        """
        let rate = try XCTUnwrap(FXRateStore.parseRate(data: Data(json.utf8)))
        XCTAssertEqual(rate, 6.76, accuracy: 1e-9)
    }

    func testParseRateFrankfurterShape() throws {
        let json = """
        {"amount":1.0,"base":"USD","date":"2026-07-26","rates":{"CNY":6.7513}}
        """
        let rate = try XCTUnwrap(FXRateStore.parseRate(data: Data(json.utf8)))
        XCTAssertEqual(rate, 6.7513, accuracy: 1e-9)
    }

    func testParseRateGarbageReturnsNil() {
        XCTAssertNil(FXRateStore.parseRate(data: Data("not json".utf8)))
        XCTAssertNil(FXRateStore.parseRate(data: Data("{}".utf8)))
        XCTAssertNil(FXRateStore.parseRate(data: Data(#"{"rates":{}}"#.utf8)))
        XCTAssertNil(FXRateStore.parseRate(data: Data(#"{"rates":{"CNY":0}}"#.utf8)))
        XCTAssertNil(FXRateStore.parseRate(data: Data(#"{"result":"error","rates":{"CNY":6.7}}"#.utf8)))
    }

    // MARK: - PricingSettings unit round-trip

    func testDefaultUnitIsUSD() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        XCTAssertEqual(PricingSettings.unit(defaults: suite), .usd)
    }

    func testUnitSetAndLoadRoundTrip() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        XCTAssertEqual(PricingSettings.unit(defaults: suite), .usd)
        PricingSettings.setUnit(.cny, defaults: suite)
        XCTAssertEqual(PricingSettings.unit(defaults: suite), .cny)
        PricingSettings.setUnit(.usd, defaults: suite)
        XCTAssertEqual(PricingSettings.unit(defaults: suite), .usd)
    }

    func testUnknownStoredUnitFallsBackToUSD() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        suite.set("eur", forKey: PricingSettings.unitKey)
        XCTAssertEqual(PricingSettings.unit(defaults: suite), .usd)
    }

    // MARK: - FXRateStore persistence

    func testStoredRateNilByDefault() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        XCTAssertNil(FXRateStore.storedRate(defaults: suite))
        XCTAssertNil(FXRateStore.fetchedAt(defaults: suite))
        XCTAssertNil(FXRateStore.source(defaults: suite))
    }

    func testPersistRoundTrip() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        let date = Date(timeIntervalSince1970: 1_750_000_000)
        FXRateStore.persist(rate: 7.1234, source: "Exchange Rate API", at: date, defaults: suite)
        XCTAssertEqual(FXRateStore.storedRate(defaults: suite) ?? -1, 7.1234, accuracy: 1e-12)
        XCTAssertEqual(FXRateStore.fetchedAt(defaults: suite), date)
        XCTAssertEqual(FXRateStore.source(defaults: suite), "Exchange Rate API")
    }

    func testStoredRateIgnoresInvalidValues() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        suite.set(0.0, forKey: PricingSettings.usdToCnyKey)
        XCTAssertNil(FXRateStore.storedRate(defaults: suite))
        suite.set(-3.0, forKey: PricingSettings.usdToCnyKey)
        XCTAssertNil(FXRateStore.storedRate(defaults: suite))
    }

    // MARK: - PriceUnit labels

    func testPriceUnitLabels() {
        XCTAssertEqual(PriceUnit.usd.label, "美金")
        XCTAssertEqual(PriceUnit.cny.label, "人民币")
    }
}
