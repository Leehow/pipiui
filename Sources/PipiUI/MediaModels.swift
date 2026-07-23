import Foundation

/// Composer mode for the + menu (chat vs media generation).
enum ComposerMode: String, Equatable {
    case chat
    case generateImage
    case generateVideo

    var label: String {
        switch self {
        case .chat: return "对话"
        case .generateImage: return "生成图像"
        case .generateVideo: return "生成视频"
        }
    }

    var placeholder: String {
        switch self {
        case .chat: return "输入消息…"
        case .generateImage: return "描述要生成的图像…"
        case .generateVideo: return "描述要生成的视频…"
        }
    }
}

enum MediaBackend: String, Equatable {
    /// POST /v1/images/generations (Grok Imagine REST)
    case imagesREST
    /// POST /v1/chat/completions with *-image model (relay injects image_generation tool)
    case chatImageSuffix
    /// POST /v1/videos/generations + poll
    case videosREST
}

struct MediaModel: Identifiable, Hashable {
    let id: String
    /// Display name
    let name: String
    /// One-line explanation shown under the name in the picker
    let detail: String
    let backend: MediaBackend
    /// Relay base, e.g. http://127.0.0.1:18891/v1
    let baseURL: String
    /// Kind this model is for
    let kind: Kind

    enum Kind: String { case image, video }

    var baseURLObject: URL? { URL(string: baseURL) }
}

enum MediaModelCatalog {
    static let grokRelayV1 = "http://127.0.0.1:18891/v1"
    static let codingRelayV1 = "http://127.0.0.1:18888/v1"

    static let imageModels: [MediaModel] = [
        MediaModel(
            id: "grok-imagine-image-quality",
            name: "Grok Imagine",
            detail: "Imagine REST · 文生图 · 同步返回（推荐）",
            backend: .imagesREST,
            baseURL: grokRelayV1,
            kind: .image
        ),
        MediaModel(
            id: "grok-4.5-high-image",
            name: "Grok 4.5 High + 图",
            detail: "对话后缀 -image · 挂 image_generation 工具",
            backend: .chatImageSuffix,
            baseURL: grokRelayV1,
            kind: .image
        ),
        MediaModel(
            id: "grok-4.5-image",
            name: "Grok 4.5 + 图",
            detail: "对话后缀 -image · 默认力度",
            backend: .chatImageSuffix,
            baseURL: grokRelayV1,
            kind: .image
        ),
        MediaModel(
            id: "gpt-5.4-high-image",
            name: "GPT-5.4 High + 图",
            detail: "Coding Relay · Codex 托管 image_generation",
            backend: .chatImageSuffix,
            baseURL: codingRelayV1,
            kind: .image
        ),
        MediaModel(
            id: "gpt-5.6-high-image",
            name: "GPT-5.6 High + 图",
            detail: "Coding Relay · Codex 托管 image_generation",
            backend: .chatImageSuffix,
            baseURL: codingRelayV1,
            kind: .image
        ),
    ]

    static let videoModels: [MediaModel] = [
        MediaModel(
            id: "grok-imagine-video",
            name: "Grok Imagine Video",
            detail: "文生视频 / 多参考图 · 异步轮询",
            backend: .videosREST,
            baseURL: grokRelayV1,
            kind: .video
        ),
        MediaModel(
            id: "grok-imagine-video-1.5",
            name: "Grok Imagine Video 1.5",
            detail: "图生视频优先 · 用输入区附图作首帧",
            backend: .videosREST,
            baseURL: grokRelayV1,
            kind: .video
        ),
    ]

    static func models(for mode: ComposerMode) -> [MediaModel] {
        switch mode {
        case .generateImage: return imageModels
        case .generateVideo: return videoModels
        case .chat: return []
        }
    }

    static func defaultModel(for mode: ComposerMode) -> MediaModel? {
        models(for: mode).first
    }
}
