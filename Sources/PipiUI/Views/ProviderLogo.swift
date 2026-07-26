import AppKit
import SwiftUI

/// Resolves provider / model refs to logo assets, SF Symbols, or monogram fallbacks.
enum ProviderLogoCatalog {
    enum RenderingStrategy: Equatable {
        case vector(asset: String)
        case systemSymbol(name: String)
    }

    /// Map provider (+ optional modelId) → asset basename without extension, or nil.
    static func assetName(provider: String, modelId: String? = nil) -> String? {
        let p = provider.lowercased()
        let m = (modelId ?? "").lowercased()
        let hay = p + "/" + m

        // Prefer explicit model-id hints for relays / ambiguous providers.
        if let fromModel = assetNameFromHints(m) { return fromModel }
        if p.contains("relay"), let fromHay = assetNameFromHints(hay) { return fromHay }

        if p.contains("anthropic") || p.contains("claude") { return existing("anthropic") }
        if p.contains("codex") { return existing("codex") ?? existing("openai") }
        if p == "openai" || p.contains("openai") || p.contains("gpt") { return existing("openai") }
        if p == "xai" || p.contains("grok") || p.contains("xai") { return existing("xai") }
        if p.contains("google") || p.contains("gemini") { return existing("google") }
        if p.contains("kimi") || p.contains("moonshot") { return existing("kimi") }
        if p.contains("zai") || p.contains("zhipu") || p.contains("glm") || p.contains("bigmodel") {
            return existing("zhipu")
        }
        if p.contains("deepseek") { return existing("deepseek") }
        if p.contains("qwen") || p.contains("alibaba") || p.contains("dashscope") {
            return existing("qwen")
        }
        if p.contains("mistral") { return existing("mistral") }
        if p.contains("groq") { return existing("groq") }
        if p.contains("openrouter") { return existing("openrouter") }
        if p.contains("meta") || p.contains("llama") { return existing("meta") }
        if p.contains("huggingface") || p == "hf" || p.hasPrefix("hf-") {
            return existing("huggingface")
        }
        if p.contains("minimax") { return existing("minimax") }
        if p.contains("nvidia") || p.contains("nemotron") { return existing("nvidia") }
        if p.contains("qoder") { return existing("qoder") }

        return assetNameFromHints(hay)
    }

    /// SF Symbol monogram / brand glyph — shared with usage tab.
    static func systemImage(provider: String, modelId: String? = nil) -> String {
        let k = (provider + "/" + (modelId ?? "")).lowercased()
        if k.contains("anthropic") || k.contains("claude") { return "a.circle.fill" }
        if k.contains("openai") || k.contains("gpt") || k.contains("codex") {
            return "circle.hexagongrid.fill"
        }
        if k.contains("google") || k.contains("gemini") { return "g.circle.fill" }
        if k.contains("xai") || k.contains("grok") { return "x.circle.fill" }
        if k.contains("kimi") || k.contains("moonshot")
            || k == "k3" || k.hasPrefix("k3-") || k.contains("/k3") {
            return "moon.circle.fill"
        }
        if k.contains("glm") || k.contains("zhipu") || k.contains("zai") { return "z.circle.fill" }
        if k.contains("qoder") { return "q.circle.fill" }
        if k.contains("deepseek") { return "d.circle.fill" }
        if k.contains("qwen") || k.contains("alibaba") { return "q.circle.fill" }
        if k.contains("mistral") { return "m.circle.fill" }
        if k.contains("groq") { return "hare.fill" }
        if k.contains("meta") || k.contains("llama") { return "infinity.circle.fill" }
        if k.contains("minimax") { return "m.circle.fill" }
        if k.contains("nvidia") || k.contains("nemotron") { return "n.circle.fill" }
        if k.contains("openrouter") { return "arrow.triangle.branch" }
        if k.contains("huggingface") || k.contains("/hf") { return "h.circle.fill" }
        return "cpu"
    }

    static func monogram(provider: String, modelId: String? = nil) -> String {
        let source: String
        if !provider.isEmpty {
            source = provider
        } else if let modelId, !modelId.isEmpty {
            source = modelId
        } else {
            return "?"
        }
        let trimmed = source.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let ch = trimmed.first else { return "?" }
        return String(ch).uppercased()
    }

    /// Selects the deterministic rendering route used by `ProviderLogo`.
    ///
    /// Every known provider uses a generated native SwiftUI vector path. Unknown
    /// providers retain the semantic SF Symbol fallback.
    static func renderingStrategy(provider: String, modelId: String? = nil) -> RenderingStrategy {
        guard let asset = assetName(provider: provider, modelId: modelId) else {
            return .systemSymbol(name: systemImage(provider: provider, modelId: modelId))
        }
        if GeneratedProviderLogoShapes.vectorAssetNames.contains(asset) {
            return .vector(asset: asset)
        }
        return .systemSymbol(name: systemImage(provider: provider, modelId: modelId))
    }

    /// Bridges generated SwiftUI vector paths into the `NSImage` representation
    /// required by native macOS `Menu` / `Picker` rows.
    ///
    /// The bundled PNG files are deliberately not consulted. Each layer is
    /// composited from `GeneratedProviderLogoShapes`, including even-odd fill
    /// and opacity, then marked as a template for semantic menu-row tinting.
    static func vectorNSImage(named asset: String, pointSize: CGFloat) -> NSImage? {
        guard GeneratedProviderLogoShapes.vectorAssetNames.contains(asset),
              let layers = GeneratedProviderLogoShapes.layers(for: asset),
              !layers.isEmpty else {
            return nil
        }
        let boundedPointSize = max(1, pointSize)
        let cacheKey = "\(asset)@\(boundedPointSize)" as NSString
        if let cached = vectorImageCache.object(forKey: cacheKey) {
            return cached
        }

        let imageSize = NSSize(width: boundedPointSize, height: boundedPointSize)
        let image = NSImage(size: imageSize, flipped: false) { rect in
            guard let context = NSGraphicsContext.current?.cgContext else { return false }
            context.saveGState()
            defer { context.restoreGState() }

            // SVG / SwiftUI coordinates run top-to-bottom; AppKit drawing runs
            // bottom-to-top. Flip once before drawing the generated 24×24 paths.
            context.translateBy(x: 0, y: rect.height)
            context.scaleBy(x: 1, y: -1)
            context.setFillColor(NSColor.black.cgColor)

            for layer in layers {
                context.saveGState()
                context.setAlpha(CGFloat(layer.opacity))
                let path = GeneratedProviderLogoShapes.path(
                    for: layer,
                    in: CGRect(origin: .zero, size: rect.size)
                )
                context.addPath(path.cgPath)
                context.drawPath(using: layer.usesEvenOddFill ? .eoFill : .fill)
                context.restoreGState()
            }
            return true
        }
        image.isTemplate = true
        vectorImageCache.setObject(image, forKey: cacheKey)
        return image
    }

    /// Parse `"provider/modelId"` (modelId may contain `/`).
    static func parse(modelRef: String?) -> (provider: String, modelId: String?) {
        guard let raw = modelRef?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty else {
            return ("", nil)
        }
        guard let slash = raw.firstIndex(of: "/") else {
            return (raw, nil)
        }
        let provider = String(raw[..<slash])
        let rest = String(raw[raw.index(after: slash)...])
        return (provider, rest.isEmpty ? nil : rest)
    }

    // MARK: - Private

    private static let knownAssets: Set<String> = [
        "openai", "anthropic", "xai", "google", "kimi", "zhipu", "deepseek",
        "qwen", "mistral", "groq", "openrouter", "meta", "huggingface",
        "minimax", "nvidia", "qoder", "codex",
    ]

    private static let vectorImageCache = NSCache<NSString, NSImage>()

    private static func existing(_ name: String) -> String? {
        knownAssets.contains(name) ? name : nil
    }

    private static func assetNameFromHints(_ text: String) -> String? {
        let t = text.lowercased()
        if t.contains("claude") || t.contains("anthropic") { return existing("anthropic") }
        if t.contains("codex") { return existing("codex") ?? existing("openai") }
        if t.contains("gpt") || t.contains("openai") || t.contains("o1") || t.contains("o3") || t.contains("o4") {
            return existing("openai")
        }
        if t.contains("grok") || t.contains("xai") { return existing("xai") }
        if t.contains("gemini") || t.contains("google") { return existing("google") }
        if t.contains("kimi") || t.contains("moonshot") || t.contains("k2") { return existing("kimi") }
        if t.contains("glm") || t.contains("zhipu") || t.contains("zai") { return existing("zhipu") }
        if t.contains("deepseek") { return existing("deepseek") }
        if t.contains("qwen") || t.contains("alibaba") { return existing("qwen") }
        if t.contains("mistral") || t.contains("mixtral") { return existing("mistral") }
        if t.contains("groq") { return existing("groq") }
        if t.contains("openrouter") { return existing("openrouter") }
        if t.contains("llama") || t.contains("meta") { return existing("meta") }
        if t.contains("huggingface") { return existing("huggingface") }
        if t.contains("minimax") { return existing("minimax") }
        if t.contains("nvidia") || t.contains("nemotron") { return existing("nvidia") }
        if t.contains("qoder") { return existing("qoder") }
        return nil
    }

}

/// Compact provider / model logo with asset → SF Symbol → monogram fallback.
struct ProviderLogo: View, Equatable {
    let provider: String
    var modelId: String? = nil
    var size: CGFloat = 14

    init(provider: String, modelId: String? = nil, size: CGFloat = 14) {
        self.provider = provider
        self.modelId = modelId
        self.size = size
    }

    init(model: ModelInfo, size: CGFloat = 14) {
        self.provider = model.provider
        self.modelId = model.modelId
        self.size = size
    }

    /// `provider/modelId` ref (e.g. subagent `agent.model`).
    init(modelRef: String?, size: CGFloat = 14) {
        let parsed = ProviderLogoCatalog.parse(modelRef: modelRef)
        self.provider = parsed.provider
        self.modelId = parsed.modelId
        self.size = size
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.provider == rhs.provider
            && lhs.modelId == rhs.modelId
            && lhs.size == rhs.size
    }

    var body: some View {
        Group {
            switch ProviderLogoCatalog.renderingStrategy(provider: provider, modelId: modelId) {
            case let .vector(asset):
                if let image = ProviderLogoCatalog.vectorNSImage(named: asset, pointSize: size) {
                    Image(nsImage: image)
                        .renderingMode(.template)
                        .resizable()
                        .interpolation(.high)
                        .aspectRatio(contentMode: .fit)
                        .foregroundStyle(.primary)
                } else {
                    Image(systemName: ProviderLogoCatalog.systemImage(
                        provider: provider,
                        modelId: modelId
                    ))
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .foregroundStyle(.secondary)
                }
            case let .systemSymbol(name):
                Image(systemName: name)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: size, height: size)
        .clipped()
        .accessibilityHidden(true)
    }
}
