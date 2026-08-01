import Foundation

struct VisionCaptionConfig: Equatable {
    var baseURL: String
    var apiKey: String
    var modelId: String
    /// Empty → client uses `defaultPrompt`.
    var prompt: String
    var maxTokens: Int

    static let defaultPrompt = """
        You convert images to text for a text-only assistant. Describe objectively what is visible. 1) If text is present, transcribe it accurately preserving structure. 2) Describe layout, UI controls, diagrams and salient objects. 3) Do not invent details; if unsure say "unclear". 4) Be concise but complete. No preamble.
        """

    static let defaultMaxTokens = 800
    static let defaultModelId = "gpt-4o-mini"
}

enum VisionCaptionClientError: LocalizedError {
    case badURL
    case http(Int, String)
    case emptyContent
    case decode(String)

    var errorDescription: String? {
        switch self {
        case .badURL: return "图片描述 API 地址无效"
        case .http(let code, let body): return "图片描述 API HTTP \(code)：\(body.prefix(200))"
        case .emptyContent: return "图片描述 API 返回空内容"
        case .decode(let s): return "图片描述解析失败：\(s)"
        }
    }
}

/// OpenAI-compatible chat/completions vision captioner (same shape as relay `/chat/completions`).
enum VisionCaptionClient {
    private static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 30
        c.timeoutIntervalForResource = 45
        return URLSession(configuration: c)
    }()

    static func caption(imageData: Data, mimeType: String, config: VisionCaptionConfig) async throws -> String {
        let endpoint = chatCompletionsURL(from: config.baseURL)
        guard let url = URL(string: endpoint) else { throw VisionCaptionClientError.badURL }

        let prompt = config.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? VisionCaptionConfig.defaultPrompt
            : config.prompt
        let mime = mimeType.isEmpty ? "image/png" : mimeType
        let dataURI = "data:\(mime);base64,\(imageData.base64EncodedString())"

        let body: [String: Any] = [
            "model": config.modelId,
            "max_tokens": config.maxTokens,
            "messages": [
                [
                    "role": "user",
                    "content": [
                        ["type": "text", "text": prompt],
                        ["type": "image_url", "image_url": ["url": dataURI]],
                    ],
                ],
            ],
        ]

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let key = config.apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if !key.isEmpty {
            req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, resp) = try await session.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw VisionCaptionClientError.http(code, text)
        }

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw VisionCaptionClientError.decode("invalid JSON")
        }
        let content = extractContent(from: json)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let content, !content.isEmpty else {
            throw VisionCaptionClientError.emptyContent
        }
        return content
    }

    /// Append `/chat/completions` unless the base URL already ends with it.
    static func chatCompletionsURL(from baseURL: String) -> String {
        var base = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        while base.hasSuffix("/") {
            base.removeLast()
        }
        if base.lowercased().hasSuffix("/chat/completions") {
            return base
        }
        return base + "/chat/completions"
    }

    private static func extractContent(from json: [String: Any]) -> String? {
        guard let choices = json["choices"] as? [[String: Any]],
              let first = choices.first,
              let message = first["message"] as? [String: Any]
        else {
            return nil
        }
        if let s = message["content"] as? String {
            return s
        }
        // Some providers return content as an array of parts.
        if let parts = message["content"] as? [[String: Any]] {
            let texts = parts.compactMap { $0["text"] as? String }
            if !texts.isEmpty {
                return texts.joined(separator: "\n")
            }
        }
        return nil
    }
}
