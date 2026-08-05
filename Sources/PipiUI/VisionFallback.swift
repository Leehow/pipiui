import Foundation

struct ImageCaption: Equatable {
    let index: Int
    let ocrText: String?
    let description: String?
}

/// Pure helpers + orchestration for turning attached images into text when the
/// active chat model cannot accept image input.
enum VisionFallback {
    static func shouldCaption(supportsImages: Bool, hasImages: Bool) -> Bool {
        !supportsImages && hasImages
    }

    /// 仅列出支持图片输入的已配置模型，作为图像识别模型选择器的候选。
    static func visionModels(from models: [ModelInfo]) -> [ModelInfo] {
        models.filter { $0.supportsImages }
    }

    /// 扁平化单 Picker 的选中 tag ↔ 设置快照映射。
    /// tag 取值：`model:<id>`（已配置多模态模型）/ `"ocr"` / `"off"` / `"manual"`。
    static func unifiedSelection(for snapshot: VisionFallbackSettings.Snapshot) -> String {
        switch snapshot.mode {
        case .off: return "off"
        case .ocrOnly: return "ocr"
        case .ocrAndCloud:
            switch snapshot.cloudSource {
            case .manual: return "manual"
            case .configuredModel:
                // configuredModel 但 ref 为空 → 显示为 ocr（只影响显示，不写盘）。
                guard snapshot.hasConfiguredModel else { return "ocr" }
                return "model:\(snapshot.cloudModelRef)"
            }
        }
    }

    /// 把单 Picker 的 tag 应用到快照（返回新快照），供 onChange 持久化与单测。
    /// `model:` 之外的 `ocr`/`off` 只改 mode；`manual` 改 mode+source。
    /// 不清理已选 modelRef（切回模型列表时仍保留上次选择）。
    static func applyUnifiedSelection(
        _ tag: String,
        to snapshot: VisionFallbackSettings.Snapshot
    ) -> VisionFallbackSettings.Snapshot {
        var s = snapshot
        if tag.hasPrefix("model:") {
            s.mode = .ocrAndCloud
            s.cloudSource = .configuredModel
            s.cloudModelRef = String(tag.dropFirst("model:".count))
        } else {
            switch tag {
            case "ocr":
                s.mode = .ocrOnly
            case "off":
                s.mode = .off
            case "manual":
                s.mode = .ocrAndCloud
                s.cloudSource = .manual
            default:
                break
            }
        }
        return s
    }

    /// 是否需要在 caption 注入后，把出站 RPC 的 `images` 字段剥掉（避免
    /// DeepSeek 等拒图 provider 硬失败）。尽管 transcript 缩略图保留，RPC 只发文字。
    static func shouldCaptionAndStripImages(
        supportsImages: Bool,
        hasImages: Bool,
        mode: VisionFallbackSettings.Mode
    ) -> Bool {
        shouldCaption(supportsImages: supportsImages, hasImages: hasImages) && mode != .off
    }

    /// 从选中的已配置模型（`provider/modelId`）解析 OpenAI 兼容 endpoint 并构造
    /// caption 配置。解析失败（无 baseUrl / 无 key / 非 OpenAI 兼容）返回 nil，
    /// 调用方据此降级到 OCR-only，绝不 crash。
    static func configuredModelConfig(modelRef: String, maxTokens: Int) async -> VisionCaptionConfig? {
        guard let slash = modelRef.firstIndex(of: "/") else { return nil }
        let provider = String(modelRef[..<slash]).trimmingCharacters(in: .whitespacesAndNewlines)
        let modelId = String(modelRef[modelRef.index(after: slash)...])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !provider.isEmpty, !modelId.isEmpty else { return nil }
        guard let ep = try? await PiAuthHelper.providerEndpoint(provider: provider, modelId: modelId),
              !ep.baseURL.isEmpty else {
            return nil
        }
        return VisionCaptionConfig(
            baseURL: ep.baseURL,
            apiKey: ep.apiKey,
            modelId: modelId,
            prompt: "",
            maxTokens: maxTokens
        )
    }

    /// Chinese caption block injected into the user message. Omits empty subsections.
    static func captionBlock(for captions: [ImageCaption]) -> String {
        let sorted = captions.sorted { $0.index < $1.index }
        guard !sorted.isEmpty else { return "" }

        var lines: [String] = [
            "[图片已自动转为文字，当前模型不支持直接查看图片]",
        ]
        for cap in sorted {
            lines.append("图片\(cap.index)：")
            if let ocr = normalized(cap.ocrText) {
                lines.append("[图片中的文字]")
                lines.append(ocr)
            }
            if let desc = normalized(cap.description) {
                lines.append("[图片描述]")
                lines.append(desc)
            }
        }
        return lines.joined(separator: "\n")
    }

    static func mergeIntoMessage(userText: String, captionBlock: String) -> String {
        let block = captionBlock.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !block.isEmpty else { return userText }
        let text = userText
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return block
        }
        if text.hasSuffix("\n") {
            return text + "\n" + block
        }
        return text + "\n\n" + block
    }

    /// Run OCR (± cloud VLM) per image and merge a caption block into `userText`.
    /// Failures degrade per-image (OCR-only / VLM-only / omit). Does not throw.
    static func enrichMessage(
        userText: String,
        images: [(data: Data, mimeType: String)],
        mode: VisionFallbackSettings.Mode,
        cloudConfig: VisionCaptionConfig?,
        ocr: @escaping (Data) async -> String? = { await ImageVisionOCR.recognizedText(data: $0) },
        cloudCaption: @escaping (Data, String, VisionCaptionConfig) async throws -> String = {
            try await VisionCaptionClient.caption(imageData: $0, mimeType: $1, config: $2)
        }
    ) async -> String {
        guard mode != .off, !images.isEmpty else { return userText }

        let wantCloud = mode == .ocrAndCloud && cloudConfig != nil
        let config = cloudConfig

        let captions: [ImageCaption] = await withTaskGroup(of: ImageCaption?.self) { group in
            for (idx, image) in images.enumerated() {
                group.addTask {
                    let oneBased = idx + 1
                    async let ocrTask: String? = ocr(image.data)
                    var description: String? = nil
                    if wantCloud, let config {
                        do {
                            let raw = try await cloudCaption(image.data, image.mimeType, config)
                            description = normalized(raw)
                        } catch {
                            description = nil
                        }
                    }
                    let ocrText = normalized(await ocrTask)
                    // Both failed → omit this image's caption entry.
                    if ocrText == nil && description == nil {
                        return nil
                    }
                    return ImageCaption(index: oneBased, ocrText: ocrText, description: description)
                }
            }
            var collected: [ImageCaption] = []
            for await item in group {
                if let item { collected.append(item) }
            }
            return collected.sorted { $0.index < $1.index }
        }

        let block = captionBlock(for: captions)
        return mergeIntoMessage(userText: userText, captionBlock: block)
    }

    private static func normalized(_ s: String?) -> String? {
        guard let s else { return nil }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
}
