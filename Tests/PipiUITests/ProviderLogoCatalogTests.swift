import XCTest
@testable import PipiUI

final class ProviderLogoCatalogTests: XCTestCase {

    func testAssetNameMajorProviders() {
        XCTAssertEqual(ProviderLogoCatalog.assetName(provider: "anthropic"), "anthropic")
        XCTAssertEqual(
            ProviderLogoCatalog.assetName(provider: "openai-codex"),
            "codex",
            "openai-codex should prefer codex asset when present"
        )
        XCTAssertEqual(ProviderLogoCatalog.assetName(provider: "kimi-coding"), "kimi")
        XCTAssertEqual(ProviderLogoCatalog.assetName(provider: "zai-coding-cn"), "zhipu")
        XCTAssertEqual(
            ProviderLogoCatalog.assetName(provider: "xai", modelId: "grok-4.5"),
            "xai"
        )
        XCTAssertEqual(ProviderLogoCatalog.assetName(provider: "google"), "google")
        XCTAssertEqual(ProviderLogoCatalog.assetName(provider: "deepseek"), "deepseek")
        XCTAssertEqual(ProviderLogoCatalog.assetName(provider: "qoder"), "qoder")
    }

    func testRelayUsesModelHint() {
        let name = ProviderLogoCatalog.assetName(
            provider: "coding-relay",
            modelId: "claude-sonnet-4-6"
        )
        XCTAssertEqual(name, "anthropic")
    }

    func testParseModelRef() {
        let parsed = ProviderLogoCatalog.parse(modelRef: "anthropic/claude-sonnet-4-6")
        XCTAssertEqual(parsed.provider, "anthropic")
        XCTAssertEqual(parsed.modelId, "claude-sonnet-4-6")

        let nested = ProviderLogoCatalog.parse(modelRef: "openrouter/meta/llama-3")
        XCTAssertEqual(nested.provider, "openrouter")
        XCTAssertEqual(nested.modelId, "meta/llama-3")

        let empty = ProviderLogoCatalog.parse(modelRef: nil)
        XCTAssertEqual(empty.provider, "")
        XCTAssertNil(empty.modelId)
    }

    func testUnknownProviderFallsBack() {
        XCTAssertNil(ProviderLogoCatalog.assetName(provider: "totally-unknown-xyz"))
        let symbol = ProviderLogoCatalog.systemImage(provider: "totally-unknown-xyz")
        XCTAssertFalse(symbol.isEmpty)
        XCTAssertEqual(symbol, "cpu")
        let mono = ProviderLogoCatalog.monogram(provider: "totally-unknown-xyz")
        XCTAssertEqual(mono, "T")
    }

    func testSystemImageKnownProviders() {
        XCTAssertEqual(
            ProviderLogoCatalog.systemImage(provider: "anthropic"),
            "a.circle.fill"
        )
        XCTAssertEqual(
            ProviderLogoCatalog.systemImage(provider: "xai", modelId: "grok-4"),
            "x.circle.fill"
        )
    }
}
