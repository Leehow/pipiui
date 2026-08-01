import Foundation

/// Vision fallback (非多模态模型看图): mode + optional cloud VLM endpoint.
/// UserDefaults only — no TS consumer / JSON mirror (unlike web search).
enum VisionFallbackSettings {
    static let modeKey = "pipiui.visionFallback.mode"
    static let baseURLKey = "pipiui.visionFallback.baseURL"
    static let apiKeyKey = "pipiui.visionFallback.apiKey"
    static let modelIdKey = "pipiui.visionFallback.modelId"
    static let promptKey = "pipiui.visionFallback.prompt"
    static let maxTokensKey = "pipiui.visionFallback.maxTokens"

    enum Mode: String, CaseIterable, Identifiable, Equatable {
        case off
        case ocrOnly
        case ocrAndCloud

        var id: String { rawValue }

        var title: String {
            switch self {
            case .off: return "关闭"
            case .ocrOnly: return "仅本地OCR"
            case .ocrAndCloud: return "OCR+云端描述"
            }
        }
    }

    struct Snapshot: Equatable {
        var mode: Mode
        var baseURL: String
        var apiKey: String
        var modelId: String
        var prompt: String
        var maxTokens: Int

        var isCloudConfigured: Bool {
            !baseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && !modelId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }

        var captionConfig: VisionCaptionConfig? {
            guard isCloudConfigured else { return nil }
            return VisionCaptionConfig(
                baseURL: baseURL.trimmingCharacters(in: .whitespacesAndNewlines),
                apiKey: apiKey,
                modelId: modelId.trimmingCharacters(in: .whitespacesAndNewlines),
                prompt: prompt,
                maxTokens: maxTokens
            )
        }
    }

    static let defaultMode: Mode = .ocrOnly
    static let defaultModelId = VisionCaptionConfig.defaultModelId
    static let defaultMaxTokens = VisionCaptionConfig.defaultMaxTokens

    static func load(defaults: UserDefaults = .standard) -> Snapshot {
        let modeRaw = defaults.string(forKey: modeKey) ?? ""
        let mode = Mode(rawValue: modeRaw) ?? defaultMode
        let modelId = defaults.string(forKey: modelIdKey) ?? ""
        let maxTokens: Int = {
            if defaults.object(forKey: maxTokensKey) == nil {
                return defaultMaxTokens
            }
            let v = defaults.integer(forKey: maxTokensKey)
            return v > 0 ? v : defaultMaxTokens
        }()
        return Snapshot(
            mode: mode,
            baseURL: defaults.string(forKey: baseURLKey) ?? "",
            apiKey: defaults.string(forKey: apiKeyKey) ?? "",
            modelId: modelId.isEmpty ? defaultModelId : modelId,
            prompt: defaults.string(forKey: promptKey) ?? "",
            maxTokens: maxTokens
        )
    }

    static func mode(defaults: UserDefaults = .standard) -> Mode {
        load(defaults: defaults).mode
    }

    static func save(_ snapshot: Snapshot, defaults: UserDefaults = .standard) {
        defaults.set(snapshot.mode.rawValue, forKey: modeKey)
        defaults.set(snapshot.baseURL, forKey: baseURLKey)
        defaults.set(snapshot.apiKey, forKey: apiKeyKey)
        defaults.set(snapshot.modelId, forKey: modelIdKey)
        defaults.set(snapshot.prompt, forKey: promptKey)
        defaults.set(snapshot.maxTokens, forKey: maxTokensKey)
    }

    static func setMode(_ mode: Mode, defaults: UserDefaults = .standard) {
        var s = load(defaults: defaults)
        s.mode = mode
        save(s, defaults: defaults)
    }

    static func setBaseURL(_ value: String, defaults: UserDefaults = .standard) {
        var s = load(defaults: defaults)
        s.baseURL = value
        save(s, defaults: defaults)
    }

    static func setApiKey(_ value: String, defaults: UserDefaults = .standard) {
        var s = load(defaults: defaults)
        s.apiKey = value
        save(s, defaults: defaults)
    }

    static func setModelId(_ value: String, defaults: UserDefaults = .standard) {
        var s = load(defaults: defaults)
        s.modelId = value
        save(s, defaults: defaults)
    }

    static func setPrompt(_ value: String, defaults: UserDefaults = .standard) {
        var s = load(defaults: defaults)
        s.prompt = value
        save(s, defaults: defaults)
    }

    static func setMaxTokens(_ value: Int, defaults: UserDefaults = .standard) {
        var s = load(defaults: defaults)
        s.maxTokens = value > 0 ? value : defaultMaxTokens
        save(s, defaults: defaults)
    }
}
