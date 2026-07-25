import XCTest
@testable import PipiUI

final class ModelPricingTests: XCTestCase {
    func testKimiK3ChinaListPriceInCNY() {
        let catalog = ModelPricing.Catalog.shared
        // 1M input + 1M output + 1M cache read at ¥20 / ¥100 / ¥2
        let cny = catalog.estimateCNY(
            model: "k3-256k",
            input: 1_000_000,
            output: 1_000_000,
            cacheRead: 1_000_000,
            cacheWrite: 0
        )
        XCTAssertEqual(cny ?? -1, 122, accuracy: 1e-9)
    }

    func testGlm52UsdConvertedToCNY() {
        let catalog = ModelPricing.Catalog()
        catalog.setExchangeRate(6.80)
        // GLM-5.2: $1.4 / $4.4 / $0.26 per 1M
        let cny = catalog.estimateCNY(
            model: "glm-5.2",
            input: 1_000_000,
            output: 1_000_000,
            cacheRead: 1_000_000,
            cacheWrite: 0
        )
        let expected = (1.4 + 4.4 + 0.26) * 6.80
        XCTAssertEqual(cny ?? -1, expected, accuracy: 1e-6)
    }

    func testLongContextTierUsesAboveRatesForWholeRequest() {
        // gpt-5.6-sol: $5/$30 below 272k; $10/$45 above — full request at above rates.
        let card = ModelPricing.RateCard.usd(
            input: 5,
            output: 30,
            cacheRead: 0.5,
            threshold: 272_000,
            aboveInput: 10,
            aboveOutput: 45,
            aboveCacheRead: 1
        )
        let below = ModelPricing.Catalog.cost(
            card: card, input: 100_000, output: 1_000,
            cacheRead: 0, cacheWrite: 0, contextTokens: 100_000
        )
        let above = ModelPricing.Catalog.cost(
            card: card, input: 100_000, output: 1_000,
            cacheRead: 0, cacheWrite: 0, contextTokens: 300_000
        )
        let expectedBelow = Double(100_000) * 5 / 1_000_000 + Double(1_000) * 30 / 1_000_000
        let expectedAbove = Double(100_000) * 10 / 1_000_000 + Double(1_000) * 45 / 1_000_000
        XCTAssertEqual(below, expectedBelow, accuracy: 1e-12)
        XCTAssertEqual(above, expectedAbove, accuracy: 1e-12)
        XCTAssertGreaterThan(above, below)
    }

    func testFormatCNY() {
        XCTAssertEqual(ModelPricing.formatCNY(0), "¥0")
        XCTAssertTrue(ModelPricing.formatCNY(0.0012).hasPrefix("¥"))
        XCTAssertEqual(ModelPricing.formatCNY(12.3), "¥12.30")
    }

    func testAggregateEstimateCNYForK3() {
        let catalog = ModelPricing.Catalog.shared
        let rec = TokenUsageStats.Record(
            date: Date(),
            channel: "main",
            agentName: nil,
            model: "k3-256k",
            input: 1_000_000,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: 0,
            contextTokens: 0,
            tools: []
        )
        let report = TokenUsageStats.aggregate(
            records: [rec],
            period: .all,
            groupBy: .model,
            costMode: .estimateCNY,
            pricingCatalog: catalog
        )
        XCTAssertEqual(report.total.cost, 20, accuracy: 1e-9)
    }
}
