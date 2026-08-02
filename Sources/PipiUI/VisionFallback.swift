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
