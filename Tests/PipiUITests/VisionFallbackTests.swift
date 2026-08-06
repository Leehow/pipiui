import XCTest
@testable import PipiUI

final class VisionFallbackTests: XCTestCase {

    // MARK: - captionBlock format

    func testCaptionBlockSingleImageOCROnly() {
        let block = VisionFallback.captionBlock(for: [
            ImageCaption(index: 1, ocrText: "Hello\n世界", description: nil),
        ])
        XCTAssertTrue(block.contains("[图片已自动转为文字，当前模型不支持直接查看图片]"))
        XCTAssertTrue(block.contains("图片1："))
        XCTAssertTrue(block.contains("[图片中的文字]"))
        XCTAssertTrue(block.contains("Hello\n世界"))
        XCTAssertFalse(block.contains("[图片描述]"))
        XCTAssertFalse(block.contains("无"))
    }

    func testCaptionBlockMultiImageNumbering() {
        let block = VisionFallback.captionBlock(for: [
            ImageCaption(index: 2, ocrText: nil, description: "a diagram"),
            ImageCaption(index: 1, ocrText: "label", description: "button"),
        ])
        XCTAssertTrue(block.contains("图片1："))
        XCTAssertTrue(block.contains("图片2："))
        // Ordering follows index, not input order.
        let i1 = block.range(of: "图片1：")!.lowerBound
        let i2 = block.range(of: "图片2：")!.lowerBound
        XCTAssertLessThan(i1, i2)
        XCTAssertTrue(block.contains("label"))
        XCTAssertTrue(block.contains("button"))
        XCTAssertTrue(block.contains("a diagram"))
        // Image 2 has no OCR subsection.
        let after2 = block[i2...]
        XCTAssertFalse(after2.contains("[图片中的文字]"))
    }

    func testCaptionBlockOmitsMissingSubsections() {
        let onlyDesc = VisionFallback.captionBlock(for: [
            ImageCaption(index: 1, ocrText: nil, description: "sky"),
        ])
        XCTAssertTrue(onlyDesc.contains("[图片描述]"))
        XCTAssertTrue(onlyDesc.contains("sky"))
        XCTAssertFalse(onlyDesc.contains("[图片中的文字]"))

        let empty = VisionFallback.captionBlock(for: [])
        XCTAssertEqual(empty, "")
    }

    // MARK: - shouldCaption gating

    func testShouldCaptionGating() {
        XCTAssertFalse(VisionFallback.shouldCaption(supportsImages: true, hasImages: true))
        XCTAssertFalse(VisionFallback.shouldCaption(supportsImages: false, hasImages: false))
        XCTAssertFalse(VisionFallback.shouldCaption(supportsImages: true, hasImages: false))
        XCTAssertTrue(VisionFallback.shouldCaption(supportsImages: false, hasImages: true))
    }

    // MARK: - mergeIntoMessage

    func testMergeIntoMessageEmptyUserText() {
        let block = "[图片已自动转为文字，当前模型不支持直接查看图片]\n图片1：\n[图片中的文字]\nhi"
        let merged = VisionFallback.mergeIntoMessage(userText: "", captionBlock: block)
        XCTAssertEqual(merged, block)
        XCTAssertFalse(merged.hasPrefix("\n"))
    }

    func testMergeIntoMessageAppendsWithBlankLine() {
        let merged = VisionFallback.mergeIntoMessage(userText: "看图", captionBlock: "BLOCK")
        XCTAssertEqual(merged, "看图\n\nBLOCK")
    }

    func testMergeIntoMessageEmptyBlockUnchanged() {
        XCTAssertEqual(VisionFallback.mergeIntoMessage(userText: "x", captionBlock: "  \n"), "x")
    }

    // MARK: - supportsImages heuristic + parse

    func testSupportsImagesHeuristic() {
        XCTAssertFalse(ModelInfo.supportsImages(modelId: "deepseek-chat", provider: "deepseek"))
        XCTAssertFalse(ModelInfo.supportsImages(modelId: "deepseek-reasoner", provider: "openai"))
        XCTAssertFalse(ModelInfo.supportsImages(modelId: "chat", provider: "DeepSeek"))

        XCTAssertTrue(ModelInfo.supportsImages(modelId: "gpt-4o", provider: "openai"))
        XCTAssertTrue(ModelInfo.supportsImages(modelId: "gpt-4o-mini", provider: "openai"))
        XCTAssertTrue(ModelInfo.supportsImages(modelId: "claude-3-5-sonnet", provider: "anthropic"))
        XCTAssertTrue(ModelInfo.supportsImages(modelId: "claude-4-opus", provider: "anthropic"))
        XCTAssertTrue(ModelInfo.supportsImages(modelId: "gemini-2.0-flash", provider: "google"))
        XCTAssertTrue(ModelInfo.supportsImages(modelId: "qwen2.5-vl", provider: "dashscope"))
        XCTAssertTrue(ModelInfo.supportsImages(modelId: "glm-4v", provider: "zhipu"))
        XCTAssertTrue(ModelInfo.supportsImages(modelId: "llava-1.6", provider: "ollama"))
        XCTAssertTrue(ModelInfo.supportsImages(modelId: "moondream2", provider: "ollama"))
        XCTAssertTrue(ModelInfo.supportsImages(modelId: "foo-vision-bar", provider: "x"))

        // Unknown → default true (preserve current behavior).
        XCTAssertTrue(ModelInfo.supportsImages(modelId: "mystery-model", provider: "acme"))
    }

    func testParseModelListRowInputField() {
        let withImage = ModelInfo.parseModelListRow([
            "provider": "openai",
            "id": "gpt-4o",
            "name": "GPT-4o",
            "input": ["text", "image"],
        ])
        XCTAssertEqual(withImage?.supportsImages, true)

        let textOnly = ModelInfo.parseModelListRow([
            "provider": "deepseek",
            "id": "deepseek-chat",
            "name": "DeepSeek Chat",
            "input": ["text"],
        ])
        XCTAssertEqual(textOnly?.supportsImages, false)

        // Absent input → heuristic (deepseek false).
        let noInput = ModelInfo.parseModelListRow([
            "provider": "deepseek",
            "id": "deepseek-chat",
            "name": "DeepSeek Chat",
        ])
        XCTAssertEqual(noInput?.supportsImages, false)

        // Absent input, unknown → true.
        let unknown = ModelInfo.parseModelListRow([
            "provider": "acme",
            "id": "mystery",
            "name": "Mystery",
        ])
        XCTAssertEqual(unknown?.supportsImages, true)

        // Null-ish / wrong type input → heuristic.
        let nullInput = ModelInfo.parseModelListRow([
            "provider": "openai",
            "id": "gpt-4o-mini",
            "name": "mini",
            "input": NSNull(),
        ])
        XCTAssertEqual(nullInput?.supportsImages, true)
    }

    // MARK: - enrichMessage (injected OCR/cloud — no real Vision/network)

    func testEnrichMessageNonVisionAddsBlock() async {
        let result = await VisionFallback.enrichMessage(
            userText: "这是什么",
            images: [(Data([0x01]), "image/png")],
            mode: .ocrOnly,
            cloudConfig: nil,
            ocr: { _ in "OCR_LINE" },
            cloudCaption: { _, _, _ in "SHOULD_NOT_RUN" }
        )
        XCTAssertTrue(result.contains("这是什么"))
        XCTAssertTrue(result.contains("[图片已自动转为文字，当前模型不支持直接查看图片]"))
        XCTAssertTrue(result.contains("OCR_LINE"))
        XCTAssertFalse(result.contains("SHOULD_NOT_RUN"))
    }

    func testEnrichMessageOffModeUnchanged() async {
        let result = await VisionFallback.enrichMessage(
            userText: "keep",
            images: [(Data([0x01]), "image/png")],
            mode: .off,
            cloudConfig: nil,
            ocr: { _ in "OCR" },
            cloudCaption: { _, _, _ in "DESC" }
        )
        XCTAssertEqual(result, "keep")
    }

    func testEnrichMessageCloudFallbackOnFailure() async {
        let config = VisionCaptionConfig(
            baseURL: "https://example.com/v1",
            apiKey: "k",
            modelId: "gpt-4o-mini",
            prompt: "",
            maxTokens: 100
        )
        let result = await VisionFallback.enrichMessage(
            userText: "x",
            images: [(Data([0x01]), "image/png")],
            mode: .ocrAndCloud,
            cloudConfig: config,
            ocr: { _ in "ONLY_OCR" },
            cloudCaption: { _, _, _ in throw VisionCaptionClientError.http(500, "boom") }
        )
        XCTAssertTrue(result.contains("ONLY_OCR"))
        XCTAssertFalse(result.contains("[图片描述]"))
    }

    func testChatCompletionsURLAppending() {
        XCTAssertEqual(
            VisionCaptionClient.chatCompletionsURL(from: "https://api.openai.com/v1"),
            "https://api.openai.com/v1/chat/completions"
        )
        XCTAssertEqual(
            VisionCaptionClient.chatCompletionsURL(from: "https://api.openai.com/v1/"),
            "https://api.openai.com/v1/chat/completions"
        )
        XCTAssertEqual(
            VisionCaptionClient.chatCompletionsURL(from: "https://api.openai.com/v1/chat/completions"),
            "https://api.openai.com/v1/chat/completions"
        )
    }

    func testVisionFallbackSettingsRoundTrip() {
        let name = "pipiui.test.visionFallback.\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: name)!
        defer { suite.removePersistentDomain(forName: name) }

        var snap = VisionFallbackSettings.load(defaults: suite)
        XCTAssertEqual(snap.mode, .ocrOnly)
        XCTAssertFalse(snap.isCloudConfigured)
        // New keys default to manual / empty.
        XCTAssertEqual(snap.cloudSource, .manual)
        XCTAssertFalse(snap.hasConfiguredModel)

        snap.mode = .ocrAndCloud
        snap.baseURL = "https://example.com/v1"
        snap.apiKey = "secret"
        snap.modelId = "gpt-4o-mini"
        snap.maxTokens = 400
        VisionFallbackSettings.save(snap, defaults: suite)

        let loaded = VisionFallbackSettings.load(defaults: suite)
        XCTAssertEqual(loaded.mode, .ocrAndCloud)
        XCTAssertEqual(loaded.baseURL, "https://example.com/v1")
        XCTAssertEqual(loaded.apiKey, "secret")
        XCTAssertEqual(loaded.modelId, "gpt-4o-mini")
        XCTAssertEqual(loaded.maxTokens, 400)
        XCTAssertTrue(loaded.isCloudConfigured)
    }

    // MARK: - New keys: cloudSource + cloudModelRef (configured vision model)

    func testCloudSourceAndModelRefRoundTrip() {
        let name = "pipiui.test.visionFallback.cloud.\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: name)!
        defer { suite.removePersistentDomain(forName: name) }

        var snap = VisionFallbackSettings.load(defaults: suite)
        snap.cloudSource = .configuredModel
        snap.cloudModelRef = "xai/grok-4.3"
        VisionFallbackSettings.save(snap, defaults: suite)

        let loaded = VisionFallbackSettings.load(defaults: suite)
        XCTAssertEqual(loaded.cloudSource, .configuredModel)
        XCTAssertEqual(loaded.cloudModelRef, "xai/grok-4.3")
        XCTAssertTrue(loaded.hasConfiguredModel)

        // Independent setters.
        VisionFallbackSettings.setCloudSource(.manual, defaults: suite)
        XCTAssertEqual(VisionFallbackSettings.load(defaults: suite).cloudSource, .manual)
        VisionFallbackSettings.setCloudModelRef("openai/gpt-4o", defaults: suite)
        XCTAssertEqual(VisionFallbackSettings.load(defaults: suite).cloudModelRef, "openai/gpt-4o")
    }

    // MARK: - Configured vision model picker filtering + RPC strip decision

    func testVisionModelsFiltersToImageCapableOnly() {
        let models = [
            ModelInfo(provider: "deepseek", modelId: "deepseek-chat", name: "DeepSeek", contextWindow: nil, supportsImages: false),
            ModelInfo(provider: "xai", modelId: "grok-4.3", name: "Grok", contextWindow: nil, supportsImages: true),
            ModelInfo(provider: "openai", modelId: "gpt-4o", name: "GPT-4o", contextWindow: nil, supportsImages: true),
            ModelInfo(provider: "acme", modelId: "mystery", name: "Mystery", contextWindow: nil, supportsImages: true),
        ]
        let vision = VisionFallback.visionModels(from: models)
        XCTAssertEqual(vision.map(\.id), ["xai/grok-4.3", "openai/gpt-4o", "acme/mystery"])
        XCTAssertFalse(vision.contains { $0.provider == "deepseek" })
    }

    // MARK: - Unified flat Picker (single selection tag ↔ snapshot)

    func testUnifiedSelectionInitialDerivation() {
        // off → "off"
        XCTAssertEqual(VisionFallback.unifiedSelection(for: snapshot(mode: .off, source: .configuredModel, ref: "xai/grok-4.3")), "off")
        // ocrOnly → "ocr"
        XCTAssertEqual(VisionFallback.unifiedSelection(for: snapshot(mode: .ocrOnly, source: .manual, ref: "")), "ocr")
        // ocrAndCloud + manual → "manual"
        XCTAssertEqual(VisionFallback.unifiedSelection(for: snapshot(mode: .ocrAndCloud, source: .manual, ref: "openai/gpt-4o")), "manual")
        // ocrAndCloud + configuredModel + ref → "model:<ref>"
        XCTAssertEqual(VisionFallback.unifiedSelection(for: snapshot(mode: .ocrAndCloud, source: .configuredModel, ref: "xai/grok-4.3")), "model:xai/grok-4.3")
        // configuredModel 但 ref 为空 → 显示为 ocr（不写盘，仅展示回退）
        XCTAssertEqual(VisionFallback.unifiedSelection(for: snapshot(mode: .ocrAndCloud, source: .configuredModel, ref: "")), "ocr")
    }

    func testApplyUnifiedSelectionPerTag() {
        // model:<id> → ocrAndCloud + configuredModel + ref
        let model = VisionFallback.applyUnifiedSelection("model:xai/grok-4.3", to: snapshot(mode: .ocrOnly, source: .manual, ref: ""))
        XCTAssertEqual(model.mode, .ocrAndCloud)
        XCTAssertEqual(model.cloudSource, .configuredModel)
        XCTAssertEqual(model.cloudModelRef, "xai/grok-4.3")

        // ocr → ocrOnly（保留原 modelRef，便于切回）
        let ocr = VisionFallback.applyUnifiedSelection("ocr", to: snapshot(mode: .ocrAndCloud, source: .configuredModel, ref: "xai/grok-4.3"))
        XCTAssertEqual(ocr.mode, .ocrOnly)
        XCTAssertEqual(ocr.cloudSource, .configuredModel)
        XCTAssertEqual(ocr.cloudModelRef, "xai/grok-4.3")

        // off → off
        let off = VisionFallback.applyUnifiedSelection("off", to: snapshot(mode: .ocrAndCloud, source: .configuredModel, ref: "xai/grok-4.3"))
        XCTAssertEqual(off.mode, .off)

        // manual → ocrAndCloud + manual
        let manual = VisionFallback.applyUnifiedSelection("manual", to: snapshot(mode: .off, source: .configuredModel, ref: ""))
        XCTAssertEqual(manual.mode, .ocrAndCloud)
        XCTAssertEqual(manual.cloudSource, .manual)
    }

    func testUnifiedSelectionRoundTrip() {
        // 每个 tag 的映射 + snapshot 各形态的初始推导互为逆过程。
        let cases: [(String, VisionFallbackSettings.Mode, VisionFallbackSettings.CloudSource, String)] = [
            ("model:xai/grok-4.3", .ocrAndCloud, .configuredModel, "xai/grok-4.3"),
            ("ocr", .ocrOnly, .manual, ""),
            ("off", .off, .manual, ""),
            ("manual", .ocrAndCloud, .manual, ""),
        ]
        for (tag, mode, source, ref) in cases {
            let applied = VisionFallback.applyUnifiedSelection(tag, to: snapshot(mode: .off, source: .manual, ref: ""))
            XCTAssertEqual(VisionFallback.unifiedSelection(for: applied), tag, "round-trip failed for tag \(tag)")
            XCTAssertEqual(applied.mode, mode)
            XCTAssertEqual(applied.cloudSource, source)
            XCTAssertEqual(applied.cloudModelRef, ref)
        }
    }

    private func snapshot(
        mode: VisionFallbackSettings.Mode,
        source: VisionFallbackSettings.CloudSource,
        ref: String
    ) -> VisionFallbackSettings.Snapshot {
        VisionFallbackSettings.Snapshot(
            mode: mode,
            baseURL: "",
            apiKey: "",
            modelId: "",
            prompt: "",
            maxTokens: VisionFallbackSettings.defaultMaxTokens,
            cloudSource: source,
            cloudModelRef: ref
        )
    }

    // MARK: - caption 超时/失败仍 deliver（发送链不得静默卡死）

    func testRaceCaptionedFallsBackOnSlowCaption() async {
        let result = await VisionFallback.raceCaptioned(
            {
                try? await Task.sleep(nanoseconds: 200_000_000) // 200ms 慢 caption
                return "CAPTIONED"
            },
            fallback: "ORIGINAL",
            nanoseconds: 50_000_000 // 50ms 超时
        )
        XCTAssertEqual(result, "ORIGINAL", "超时应回退原文，保证 deliver 不等待")
    }

    func testRaceCaptionedUsesFastCaption() async {
        let result = await VisionFallback.raceCaptioned(
            { "CAPTIONED_FAST" },
            fallback: "ORIGINAL",
            nanoseconds: 5_000_000_000
        )
        XCTAssertEqual(result, "CAPTIONED_FAST")
    }

    func testStripDecisionIndependentOfCaptionResolution() {
        // 非视觉模型带图：无论云端配置能否解析、caption 是否注入，出站 RPC 一律剥图
        // （避免 DeepSeek 拒图），且发送链必须 deliver（不允许被 caption 阻塞静默）。
        for mode in [VisionFallbackSettings.Mode.ocrOnly, .ocrAndCloud] {
            XCTAssertTrue(
                VisionFallback.shouldCaptionAndStripImages(supportsImages: false, hasImages: true, mode: mode),
                "mode=\(mode) 应剥图"
            )
        }
        // 超时/失败兜底：caption 为空时原文直接作为最终消息，仍可送达。
        XCTAssertEqual(VisionFallback.mergeIntoMessage(userText: "原文", captionBlock: ""), "原文")
        // 视觉模型 / 无图 / 关闭：不剥图。
        XCTAssertFalse(VisionFallback.shouldCaptionAndStripImages(supportsImages: true, hasImages: true, mode: .ocrAndCloud))
        XCTAssertFalse(VisionFallback.shouldCaptionAndStripImages(supportsImages: false, hasImages: false, mode: .ocrAndCloud))
        XCTAssertFalse(VisionFallback.shouldCaptionAndStripImages(supportsImages: false, hasImages: true, mode: .off))
    }

    func testShouldCaptionAndStripImages() {
        // Non-vision model with images + cloud/ocr mode → caption + strip RPC images.
        XCTAssertTrue(VisionFallback.shouldCaptionAndStripImages(supportsImages: false, hasImages: true, mode: .ocrAndCloud))
        XCTAssertTrue(VisionFallback.shouldCaptionAndStripImages(supportsImages: false, hasImages: true, mode: .ocrOnly))
        // Off mode → no caption, no strip.
        XCTAssertFalse(VisionFallback.shouldCaptionAndStripImages(supportsImages: false, hasImages: true, mode: .off))
        // Vision model with images → no strip.
        XCTAssertFalse(VisionFallback.shouldCaptionAndStripImages(supportsImages: true, hasImages: true, mode: .ocrAndCloud))
        // No images → no strip.
        XCTAssertFalse(VisionFallback.shouldCaptionAndStripImages(supportsImages: false, hasImages: false, mode: .ocrAndCloud))
    }
}
