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

    func testGeneratedVersionsAndAllKnownVectorMappings() {
        XCTAssertEqual(GeneratedProviderLogoShapes.simpleIconsVersion, "16.21.0")
        XCTAssertEqual(GeneratedProviderLogoShapes.lobeIconsVersion, "1.91.0")
        XCTAssertEqual(
            GeneratedProviderLogoShapes.vectorAssetNames,
            [
                "anthropic", "codex", "deepseek", "google", "groq",
                "huggingface", "kimi", "meta", "minimax", "mistral",
                "nvidia", "openai", "openrouter", "qoder", "qwen",
                "xai", "zhipu",
            ]
        )
        XCTAssertEqual(GeneratedProviderLogoShapes.assetSources.count, 17)
        XCTAssertEqual(GeneratedProviderLogoShapes.assetSources["anthropic"], "Simple Icons")
        XCTAssertEqual(GeneratedProviderLogoShapes.assetSources["codex"], "LobeHub")
        XCTAssertEqual(GeneratedProviderLogoShapes.assetSources["qoder"], "LobeHub")
    }

    func testGeneratedVectorPathsAreNonEmptyAndStayInsideViewBox() throws {
        for asset in GeneratedProviderLogoShapes.vectorAssetNames {
            XCTAssertGreaterThan(
                GeneratedProviderLogoShapes.commandCount(for: asset),
                0,
                "\(asset) should contain generated path commands"
            )
            let layers = try XCTUnwrap(GeneratedProviderLogoShapes.layers(for: asset))
            XCTAssertFalse(layers.isEmpty, "\(asset) should contain vector layers")
            for layer in layers {
                let path = GeneratedProviderLogoShapes.path(
                    for: layer,
                    in: CGRect(x: 0, y: 0, width: 24, height: 24)
                )
                let bounds = path.boundingRect
                XCTAssertFalse(bounds.isEmpty, "\(asset) should render a non-empty path")
                XCTAssertGreaterThanOrEqual(bounds.minX, -0.01, "\(asset) minX")
                XCTAssertGreaterThanOrEqual(bounds.minY, -0.01, "\(asset) minY")
                XCTAssertLessThanOrEqual(bounds.maxX, 24.01, "\(asset) maxX")
                XCTAssertLessThanOrEqual(bounds.maxY, 24.01, "\(asset) maxY")
            }
        }
    }

    func testGeneratedLayersPreserveFillRuleAndOpacity() throws {
        let codex = try XCTUnwrap(GeneratedProviderLogoShapes.layers(for: "codex"))
        XCTAssertEqual(codex.count, 1)
        XCTAssertTrue(codex[0].usesEvenOddFill)
        XCTAssertEqual(codex[0].opacity, 1)

        let kimi = try XCTUnwrap(GeneratedProviderLogoShapes.layers(for: "kimi"))
        XCTAssertEqual(kimi.count, 2)
        XCTAssertTrue(kimi.allSatisfy { $0.opacity == 1 })

        let qoder = try XCTUnwrap(GeneratedProviderLogoShapes.layers(for: "qoder"))
        XCTAssertEqual(qoder.count, 2)
        XCTAssertEqual(qoder[0].opacity, 0.5)
        XCTAssertEqual(qoder[1].opacity, 1)
    }

    func testAllKnownVectorsBridgeToCompactTemplateNSImages() throws {
        for asset in GeneratedProviderLogoShapes.vectorAssetNames {
            let image = try XCTUnwrap(
                ProviderLogoCatalog.vectorNSImage(named: asset, pointSize: 12),
                "\(asset) should bridge generated paths to NSImage"
            )
            XCTAssertEqual(image.size.width, 12, accuracy: 0.001, "\(asset) width")
            XCTAssertEqual(image.size.height, 12, accuracy: 0.001, "\(asset) height")
            XCTAssertTrue(image.isTemplate, "\(asset) must adapt to native menu tint")
            XCTAssertTrue(image.isValid, "\(asset) should be a valid generated image")
            XCTAssertFalse(
                try XCTUnwrap(image.tiffRepresentation).isEmpty,
                "\(asset) should rasterize generated vector layers"
            )
        }

        XCTAssertNil(
            ProviderLogoCatalog.vectorNSImage(named: "totally-unknown-xyz", pointSize: 12)
        )
    }

    func testRenderingStrategyUsesVectorForEveryKnownBrand() {
        let expected: [(String, String)] = [
            ("anthropic", "anthropic"), ("openai-codex", "codex"),
            ("deepseek", "deepseek"), ("google", "google"), ("groq", "groq"),
            ("huggingface", "huggingface"), ("kimi-coding", "kimi"),
            ("meta", "meta"), ("minimax", "minimax"), ("mistral", "mistral"),
            ("nvidia", "nvidia"), ("openai", "openai"),
            ("openrouter", "openrouter"), ("qoder", "qoder"), ("qwen", "qwen"),
            ("xai", "xai"), ("zai-coding-cn", "zhipu"),
        ]
        for (provider, asset) in expected {
            XCTAssertEqual(
                ProviderLogoCatalog.renderingStrategy(provider: provider),
                .vector(asset: asset),
                provider
            )
        }
        XCTAssertEqual(
            ProviderLogoCatalog.renderingStrategy(provider: "totally-unknown-xyz"),
            .systemSymbol(name: "cpu")
        )
    }
}
