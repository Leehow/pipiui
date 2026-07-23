import Foundation
import AppKit

enum MediaClientError: LocalizedError {
    case badURL
    case http(Int, String)
    case noImage
    case noVideo
    case timeout
    case decode(String)

    var errorDescription: String? {
        switch self {
        case .badURL: return "媒体 API 地址无效"
        case .http(let code, let body): return "媒体 API HTTP \(code)：\(body.prefix(200))"
        case .noImage: return "响应里没有图片数据"
        case .noVideo: return "视频任务完成但没有 URL"
        case .timeout: return "等待视频生成超时"
        case .decode(let s): return "解析失败：\(s)"
        }
    }
}

struct MediaGenerationResult {
    enum Kind {
        case image(data: Data, mimeType: String, path: URL?)
        case video(path: URL, remoteURL: String?)
    }
    let kind: Kind
    let prompt: String
    let modelId: String
}

/// Talks to local relays (grok-relay / coding-relay) the same way Grok Build's imagine tools do.
enum MediaClient {
    private static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 120
        c.timeoutIntervalForResource = 600
        return URLSession(configuration: c)
    }()

    // MARK: - Public

    static func generate(
        model: MediaModel,
        prompt: String,
        referenceImages: [DraftImage] = [],
        projectURL: URL,
        progress: ((String) -> Void)? = nil
    ) async throws -> MediaGenerationResult {
        switch model.backend {
        case .imagesREST:
            return try await imagesREST(model: model, prompt: prompt, projectURL: projectURL)
        case .chatImageSuffix:
            return try await chatImage(model: model, prompt: prompt, projectURL: projectURL)
        case .videosREST:
            return try await videosREST(
                model: model,
                prompt: prompt,
                referenceImages: referenceImages,
                projectURL: projectURL,
                progress: progress
            )
        }
    }

    // MARK: - Image REST

    private static func imagesREST(model: MediaModel, prompt: String, projectURL: URL) async throws -> MediaGenerationResult {
        guard let url = URL(string: model.baseURL + "/images/generations") else { throw MediaClientError.badURL }
        let body: [String: Any] = [
            "model": model.id,
            "prompt": prompt,
            "n": 1,
            "response_format": "b64_json"
        ]
        let json = try await postJSON(url: url, body: body)
        let dataArr = json["data"].array
        guard let first = dataArr.first else { throw MediaClientError.noImage }

        let b64 = first["b64_json"].string ?? first["b64"].string
        if let b64, let data = Data(base64Encoded: b64), !data.isEmpty {
            let path = saveImage(data, mime: "image/png", projectURL: projectURL)
            return MediaGenerationResult(kind: .image(data: data, mimeType: "image/png", path: path), prompt: prompt, modelId: model.id)
        }
        if let urlStr = first["url"].string, let u = URL(string: urlStr) {
            let (data, resp) = try await session.data(from: u)
            let mime = (resp as? HTTPURLResponse)?.mimeType ?? "image/png"
            let path = saveImage(data, mime: mime, projectURL: projectURL)
            return MediaGenerationResult(kind: .image(data: data, mimeType: mime, path: path), prompt: prompt, modelId: model.id)
        }
        throw MediaClientError.noImage
    }

    // MARK: - Chat *-image suffix

    private static func chatImage(model: MediaModel, prompt: String, projectURL: URL) async throws -> MediaGenerationResult {
        guard let url = URL(string: model.baseURL + "/chat/completions") else { throw MediaClientError.badURL }
        let body: [String: Any] = [
            "model": model.id,
            "messages": [
                ["role": "user", "content": prompt]
            ],
            "stream": false
        ]
        let json = try await postJSON(url: url, body: body)
        let content = json["choices"].array.first?["message"]["content"].string
            ?? json["choices"].array.first?["message"]["content"].array
            .compactMap { $0["text"].string }.joined(separator: "\n")
            ?? ""

        // Prefer markdown data URI: ![..](data:image/png;base64,...)
        if let data = extractDataURIImage(from: content) {
            let path = saveImage(data.data, mime: data.mime, projectURL: projectURL)
            return MediaGenerationResult(kind: .image(data: data.data, mimeType: data.mime, path: path), prompt: prompt, modelId: model.id)
        }
        // Or raw base64 blobs in JSON-ish content
        if let b64 = extractLooseBase64PNG(from: content), let data = Data(base64Encoded: b64), NSImage(data: data) != nil {
            let path = saveImage(data, mime: "image/png", projectURL: projectURL)
            return MediaGenerationResult(kind: .image(data: data, mimeType: "image/png", path: path), prompt: prompt, modelId: model.id)
        }
        throw MediaClientError.noImage
    }

    // MARK: - Video REST

    private static func videosREST(
        model: MediaModel,
        prompt: String,
        referenceImages: [DraftImage],
        projectURL: URL,
        progress: ((String) -> Void)?
    ) async throws -> MediaGenerationResult {
        guard let url = URL(string: model.baseURL + "/videos/generations") else { throw MediaClientError.badURL }

        var body: [String: Any] = [
            "model": model.id,
            "prompt": prompt,
            "duration": 6,
            "resolution": model.id.contains("1.5") ? "720p" : "480p"
        ]

        // Image-to-video when we have a reference and model is 1.5-ish
        if let first = referenceImages.first {
            let dataURI = "data:\(first.mimeType);base64,\(first.data.base64EncodedString())"
            if model.id.contains("1.5") || referenceImages.count == 1 {
                body["image"] = ["url": dataURI]
            }
        }
        if referenceImages.count >= 2, model.id == "grok-imagine-video" {
            body["reference_images"] = referenceImages.prefix(7).map {
                ["url": "data:\($0.mimeType);base64,\($0.data.base64EncodedString())"]
            }
        }

        progress?("提交视频任务…")
        let submitted = try await postJSON(url: url, body: body)
        guard let requestId = submitted["request_id"].string ?? submitted["id"].string else {
            throw MediaClientError.decode("missing request_id")
        }

        // Poll
        guard let pollBase = URL(string: model.baseURL + "/videos/\(requestId)") else { throw MediaClientError.badURL }
        let deadline = Date().addingTimeInterval(10 * 60)
        var attempt = 0
        while Date() < deadline {
            attempt += 1
            progress?("生成视频中… (\(attempt))")
            try await Task.sleep(nanoseconds: 2_500_000_000)
            let status = try await getJSON(url: pollBase)
            let st = (status["status"].string ?? "").lowercased()
            if st == "completed" || st == "succeeded" || st == "done" {
                let videoURL = status["video"]["url"].string
                    ?? status["url"].string
                    ?? status["data"]["url"].string
                guard let videoURL, let remote = URL(string: videoURL) else { throw MediaClientError.noVideo }
                progress?("下载视频…")
                let (data, _) = try await session.data(from: remote)
                let path = saveVideo(data, projectURL: projectURL)
                return MediaGenerationResult(kind: .video(path: path, remoteURL: videoURL), prompt: prompt, modelId: model.id)
            }
            if st == "failed" || st == "error" {
                let err = status["error"].string ?? status["message"].string ?? "failed"
                throw MediaClientError.http(500, err)
            }
        }
        throw MediaClientError.timeout
    }

    // MARK: - HTTP helpers

    private static func postJSON(url: URL, body: [String: Any]) async throws -> J {
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer local", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await session.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw MediaClientError.http(code, text)
        }
        guard let j = J.parse(data) else { throw MediaClientError.decode("invalid JSON") }
        return j
    }

    private static func getJSON(url: URL) async throws -> J {
        var req = URLRequest(url: url)
        req.setValue("Bearer local", forHTTPHeaderField: "Authorization")
        let (data, resp) = try await session.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw MediaClientError.http(code, text)
        }
        guard let j = J.parse(data) else { throw MediaClientError.decode("invalid JSON") }
        return j
    }

    // MARK: - Save

    private static func attachmentsDir(_ projectURL: URL) -> URL {
        let dir = projectURL.appendingPathComponent(".pi/attachments", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private static func stampName(_ ext: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: Date()).replacingOccurrences(of: ":", with: "-") + ".\(ext)"
    }

    private static func saveImage(_ data: Data, mime: String, projectURL: URL) -> URL? {
        let ext = mime.contains("jpeg") || mime.contains("jpg") ? "jpg" : "png"
        let url = attachmentsDir(projectURL).appendingPathComponent(stampName(ext))
        do {
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }

    private static func saveVideo(_ data: Data, projectURL: URL) -> URL {
        let url = attachmentsDir(projectURL).appendingPathComponent(stampName("mp4"))
        try? data.write(to: url, options: .atomic)
        return url
    }

    // MARK: - Parse helpers

    private static func extractDataURIImage(from text: String) -> (data: Data, mime: String)? {
        // data:image/png;base64,XXXX
        guard let range = text.range(of: #"data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+"#, options: .regularExpression) else {
            return nil
        }
        let token = String(text[range]).replacingOccurrences(of: "\n", with: "").replacingOccurrences(of: " ", with: "")
        guard let comma = token.firstIndex(of: ",") else { return nil }
        let header = String(token[..<comma])
        let b64 = String(token[token.index(after: comma)...])
        guard let data = Data(base64Encoded: b64), !data.isEmpty else { return nil }
        let mime: String
        if header.contains("jpeg") || header.contains("jpg") { mime = "image/jpeg" }
        else if header.contains("webp") { mime = "image/webp" }
        else if header.contains("gif") { mime = "image/gif" }
        else { mime = "image/png" }
        return (data, mime)
    }

    private static func extractLooseBase64PNG(from text: String) -> String? {
        // Find long base64 that decodes as PNG
        let pattern = #"[A-Za-z0-9+/]{200,}={0,2}"#
        guard let re = try? NSRegularExpression(pattern: pattern) else { return nil }
        let ns = text as NSString
        let matches = re.matches(in: text, range: NSRange(location: 0, length: ns.length))
        for m in matches {
            let s = ns.substring(with: m.range)
            if s.hasPrefix("iVBOR") { return s } // PNG magic in b64
        }
        return nil
    }
}
