import AppKit
import CryptoKit
import PDFKit
import Vision

/// Builds a local, page-addressable text bundle for a user-selected PDF.
///
/// The bundle deliberately keeps OCR on the Mac: PDFKit text is used whenever a
/// page has a usable text layer, and Vision only sees a locally rendered page
/// when that layer is absent or looks like a page-number-only artifact. The
/// resulting Markdown is intended for Pi to read from disk; raster page images
/// are never sent to a model merely to transcribe the PDF.
enum NativePDFIngestion {
    static let manifestFileName = "manifest.json"
    static let documentFileName = "document.md"
    static let pagesDirectoryName = "pages"
    static let schemaVersion = 1
    /// Coordinates final cache publication inside this app process. Extraction
    /// itself stays concurrent/off-main; only the short validate/write/rename
    /// critical section is serialized.
    private static let cacheWriteLock = NSLock()

    enum ExtractionOrigin: String, Codable, Equatable {
        case embeddedText = "embedded-text"
        case visionOCR = "vision-ocr"

        var displayName: String {
            switch self {
            case .embeddedText: return "PDF 内嵌文字"
            case .visionOCR: return "本机 Vision OCR"
            }
        }
    }

    struct Page: Equatable {
        let number: Int
        let origin: ExtractionOrigin
        let confidence: Float?
        let markdownURL: URL
    }

    struct SourceBundle: Equatable {
        let sourceURL: URL
        let directoryURL: URL
        let manifestURL: URL
        let documentURL: URL
        let pagesDirectoryURL: URL
        let contentSHA256: String
        let pages: [Page]
        let reusedCache: Bool

        /// A short, explicit pointer that can be appended to the current draft.
        /// It gives Pi both the immutable parsed bundle and the original PDF
        /// without copying the entire document into the prompt body.
        func draftReference(for originalPDFURL: URL) -> String {
            """
            [本地 PDF 已解析]
            原始 PDF：\(originalPDFURL.path)
            解析目录：\(directoryURL.path)
            解析文档：\(documentURL.path)
            单页 Markdown：\(pagesDirectoryURL.path)
            内容 SHA-256：\(contentSHA256)
            """
        }
    }

    struct OCRResult {
        let text: String
        let confidence: Float?

        init(text: String, confidence: Float? = nil) {
            self.text = text
            self.confidence = confidence
        }
    }

    /// Injectable for deterministic tests and for future local recognizer tuning.
    typealias OCRRecognizer = (CGImage) throws -> OCRResult

    struct Progress: Equatable {
        enum Phase: Equatable {
            case hashing
            case extracting
            case writing
            case reusedCache
        }

        let phase: Phase
        let completedPages: Int
        let totalPages: Int

        var localizedDescription: String {
            switch phase {
            case .hashing:
                return "正在计算 PDF 内容指纹…"
            case .extracting:
                return "正在本地解析 PDF（\(completedPages)/\(totalPages) 页）…"
            case .writing:
                return "正在写入本地 PDF source bundle…"
            case .reusedCache:
                return "已复用本地 PDF source bundle（\(totalPages) 页）"
            }
        }
    }

    enum IngestionError: LocalizedError {
        case unreadableSource(String)
        case invalidPDF
        case noPages
        case missingPage(Int)
        case cannotRenderPage(Int)
        case recognitionFailed(page: Int, reason: String)
        case writeFailed(String)

        var errorDescription: String? {
            switch self {
            case .unreadableSource(let reason):
                return "无法读取 PDF：\(reason)"
            case .invalidPDF:
                return "无法打开 PDF，文件可能已损坏或不受支持"
            case .noPages:
                return "PDF 没有可解析的页面"
            case .missingPage(let number):
                return "无法读取 PDF 第 \(number) 页"
            case .cannotRenderPage(let number):
                return "无法渲染 PDF 第 \(number) 页供本机 OCR 使用"
            case .recognitionFailed(let page, let reason):
                return "本机 OCR 无法识别 PDF 第 \(page) 页：\(reason)"
            case .writeFailed(let reason):
                return "无法写入本地 PDF source bundle：\(reason)"
            }
        }
    }

    /// `true` for a conventional PDF URL, including an uppercase extension.
    static func isPDF(_ url: URL) -> Bool {
        if url.pathExtension.caseInsensitiveCompare("pdf") == .orderedSame {
            return true
        }
        let contentType = try? url.resourceValues(forKeys: [.contentTypeKey]).contentType
        return contentType?.conforms(to: .pdf) == true
    }

    /// Synchronously parse one PDF. Call this from a worker queue, not the main
    /// actor. The InputBar integration below does exactly that.
    @discardableResult
    static func ingest(
        sourceURL: URL,
        projectURL: URL,
        progress: ((Progress) -> Void)? = nil,
        recognize: OCRRecognizer? = nil
    ) throws -> SourceBundle {
        progress?(Progress(phase: .hashing, completedPages: 0, totalPages: 0))

        let accessedSecurityScopedResource = sourceURL.startAccessingSecurityScopedResource()
        defer {
            if accessedSecurityScopedResource {
                sourceURL.stopAccessingSecurityScopedResource()
            }
        }

        let fingerprint: (hash: String, byteCount: Int64)
        do {
            fingerprint = try sha256(of: sourceURL)
        } catch {
            throw IngestionError.unreadableSource(error.localizedDescription)
        }

        let rootURL = sourceRoot(projectURL: projectURL)
        let bundleURL = rootURL.appendingPathComponent(fingerprint.hash, isDirectory: true)
        if let cached = completeBundle(
            at: bundleURL,
            sourceURL: sourceURL,
            expectedHash: fingerprint.hash
        ) {
            progress?(Progress(
                phase: .reusedCache,
                completedPages: cached.pages.count,
                totalPages: cached.pages.count
            ))
            return cached
        }

        guard let document = PDFDocument(url: sourceURL) else {
            throw IngestionError.invalidPDF
        }
        let pageCount = document.pageCount
        guard pageCount > 0 else { throw IngestionError.noPages }

        let recognizer = recognize ?? recognizeWithVision
        var extractedPages: [ExtractedPage] = []
        extractedPages.reserveCapacity(pageCount)

        for index in 0..<pageCount {
            let pageNumber = index + 1
            guard let page = document.page(at: index) else {
                throw IngestionError.missingPage(pageNumber)
            }

            let embeddedText = normalizedText(page.string ?? "")
            if isMeaningfulEmbeddedText(embeddedText) {
                extractedPages.append(
                    ExtractedPage(
                        number: pageNumber,
                        origin: .embeddedText,
                        confidence: nil,
                        text: embeddedText
                    )
                )
            } else {
                let image: CGImage
                do {
                    image = try render(page: page)
                } catch {
                    throw IngestionError.cannotRenderPage(pageNumber)
                }

                let recognized: OCRResult
                do {
                    recognized = try recognizer(image)
                } catch {
                    throw IngestionError.recognitionFailed(
                        page: pageNumber,
                        reason: error.localizedDescription
                    )
                }
                extractedPages.append(
                    ExtractedPage(
                        number: pageNumber,
                        origin: .visionOCR,
                        confidence: recognized.confidence,
                        text: normalizedText(recognized.text)
                    )
                )
            }
            progress?(Progress(
                phase: .extracting,
                completedPages: pageNumber,
                totalPages: pageCount
            ))
        }

        progress?(Progress(phase: .writing, completedPages: pageCount, totalPages: pageCount))
        return try writeBundle(
            extractedPages,
            sourceURL: sourceURL,
            sourceByteCount: fingerprint.byteCount,
            contentSHA256: fingerprint.hash,
            rootURL: rootURL,
            bundleURL: bundleURL
        )
    }

    /// A text layer consisting of only whitespace/punctuation or a single page
    /// number should not suppress OCR. Short real headings such as `AI` or `第1`
    /// remain usable PDF text and therefore do not need a lossy second pass.
    static func isMeaningfulEmbeddedText(_ text: String) -> Bool {
        let scalars = text.unicodeScalars.filter { !$0.properties.isWhitespace }
        guard !scalars.isEmpty else { return false }

        let letterCount = scalars.filter { $0.properties.isAlphabetic }.count
        let numberCount = scalars.filter { $0.properties.numericType != nil }.count
        return letterCount >= 2 || (letterCount >= 1 && numberCount >= 1) || numberCount >= 6
    }

    // MARK: - Cache validation and writing

    private struct Manifest: Codable {
        let schemaVersion: Int
        let sourceContentSHA256: String
        let sourceFileName: String
        let sourcePath: String
        let sourceByteCount: Int64
        let pageCount: Int
        let pages: [ManifestPage]
    }

    private struct ManifestPage: Codable {
        let number: Int
        let origin: ExtractionOrigin
        let confidence: Float?
        let markdownPath: String
    }

    private struct ExtractedPage {
        let number: Int
        let origin: ExtractionOrigin
        let confidence: Float?
        let text: String
    }

    private static func sourceRoot(projectURL: URL) -> URL {
        projectURL
            .appendingPathComponent(".pi", isDirectory: true)
            .appendingPathComponent("pdf-sources", isDirectory: true)
    }

    private static func completeBundle(
        at bundleURL: URL,
        sourceURL: URL,
        expectedHash: String
    ) -> SourceBundle? {
        let fileManager = FileManager.default
        let manifestURL = bundleURL.appendingPathComponent(manifestFileName)
        let documentURL = bundleURL.appendingPathComponent(documentFileName)
        guard fileManager.fileExists(atPath: manifestURL.path),
              fileManager.fileExists(atPath: documentURL.path),
              let data = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONDecoder().decode(Manifest.self, from: data),
              manifest.schemaVersion == schemaVersion,
              manifest.sourceContentSHA256 == expectedHash,
              manifest.pageCount > 0,
              manifest.pages.count == manifest.pageCount
        else {
            return nil
        }

        let pagesURL = bundleURL.appendingPathComponent(pagesDirectoryName, isDirectory: true)
        let parsedPages: [Page] = manifest.pages.compactMap { entry in
            guard entry.number > 0,
                  entry.markdownPath == pageRelativePath(number: entry.number)
            else {
                return nil
            }
            let pageURL = bundleURL.appendingPathComponent(entry.markdownPath)
            guard fileManager.fileExists(atPath: pageURL.path) else { return nil }
            return Page(
                number: entry.number,
                origin: entry.origin,
                confidence: entry.confidence,
                markdownURL: pageURL
            )
        }
        guard parsedPages.count == manifest.pageCount,
              Set(parsedPages.map(\.number)) == Set(1...manifest.pageCount)
        else {
            return nil
        }

        return SourceBundle(
            sourceURL: sourceURL,
            directoryURL: bundleURL,
            manifestURL: manifestURL,
            documentURL: documentURL,
            pagesDirectoryURL: pagesURL,
            contentSHA256: expectedHash,
            pages: parsedPages,
            reusedCache: true
        )
    }

    private static func writeBundle(
        _ pages: [ExtractedPage],
        sourceURL: URL,
        sourceByteCount: Int64,
        contentSHA256: String,
        rootURL: URL,
        bundleURL: URL
    ) throws -> SourceBundle {
        cacheWriteLock.lock()
        defer { cacheWriteLock.unlock() }

        let fileManager = FileManager.default
        let stagingURL = rootURL.appendingPathComponent(
            ".\(contentSHA256).in-progress-\(UUID().uuidString)",
            isDirectory: true
        )

        do {
            try fileManager.createDirectory(at: rootURL, withIntermediateDirectories: true)
            if let cached = completeBundle(
                at: bundleURL,
                sourceURL: sourceURL,
                expectedHash: contentSHA256
            ) {
                return cached
            }
            if fileManager.fileExists(atPath: bundleURL.path) {
                // A missing/corrupt manifest is not a reusable bundle. This is a
                // precise, app-owned cache entry, never a broad project cleanup.
                try fileManager.removeItem(at: bundleURL)
            }
            try fileManager.createDirectory(at: stagingURL, withIntermediateDirectories: true)
            let stagingPagesURL = stagingURL.appendingPathComponent(pagesDirectoryName, isDirectory: true)
            try fileManager.createDirectory(at: stagingPagesURL, withIntermediateDirectories: true)

            let manifestPages = try pages.map { page -> ManifestPage in
                let relativePath = pageRelativePath(number: page.number)
                let pageURL = stagingURL.appendingPathComponent(relativePath)
                try pageMarkdown(
                    sourceURL: sourceURL,
                    contentSHA256: contentSHA256,
                    page: page
                ).write(to: pageURL, atomically: true, encoding: .utf8)
                return ManifestPage(
                    number: page.number,
                    origin: page.origin,
                    confidence: page.confidence,
                    markdownPath: relativePath
                )
            }

            let manifest = Manifest(
                schemaVersion: schemaVersion,
                sourceContentSHA256: contentSHA256,
                sourceFileName: sourceURL.lastPathComponent,
                sourcePath: sourceURL.path,
                sourceByteCount: sourceByteCount,
                pageCount: pages.count,
                pages: manifestPages
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            try encoder.encode(manifest).write(
                to: stagingURL.appendingPathComponent(manifestFileName),
                options: .atomic
            )
            try documentMarkdown(
                sourceURL: sourceURL,
                contentSHA256: contentSHA256,
                pages: manifestPages
            ).write(
                to: stagingURL.appendingPathComponent(documentFileName),
                atomically: true,
                encoding: .utf8
            )

            do {
                try fileManager.moveItem(at: stagingURL, to: bundleURL)
            } catch {
                // A concurrent writer may have completed the exact same
                // content-addressed bundle. Reuse it if it is intact.
                if let cached = completeBundle(
                    at: bundleURL,
                    sourceURL: sourceURL,
                    expectedHash: contentSHA256
                ) {
                    try? fileManager.removeItem(at: stagingURL)
                    return cached
                }
                throw error
            }
        } catch {
            try? fileManager.removeItem(at: stagingURL)
            throw IngestionError.writeFailed(error.localizedDescription)
        }

        let pagesURL = bundleURL.appendingPathComponent(pagesDirectoryName, isDirectory: true)
        return SourceBundle(
            sourceURL: sourceURL,
            directoryURL: bundleURL,
            manifestURL: bundleURL.appendingPathComponent(manifestFileName),
            documentURL: bundleURL.appendingPathComponent(documentFileName),
            pagesDirectoryURL: pagesURL,
            contentSHA256: contentSHA256,
            pages: pages.map { page in
                Page(
                    number: page.number,
                    origin: page.origin,
                    confidence: page.confidence,
                    markdownURL: bundleURL.appendingPathComponent(pageRelativePath(number: page.number))
                )
            },
            reusedCache: false
        )
    }

    private static func pageRelativePath(number: Int) -> String {
        "\(pagesDirectoryName)/page-\(String(format: "%04d", number)).md"
    }

    private static func pageMarkdown(
        sourceURL: URL,
        contentSHA256: String,
        page: ExtractedPage
    ) -> String {
        var lines = [
            "# \(sourceURL.lastPathComponent) — 第 \(page.number) 页",
            "",
            "- 原始 PDF：\(sourceURL.path)",
            "- 内容 SHA-256：\(contentSHA256)",
            "- 提取来源：\(page.origin.displayName)",
        ]
        if let confidence = page.confidence {
            lines.append(String(format: "- Vision OCR 置信度：%.3f", confidence))
        }
        lines.append("")
        if page.text.isEmpty {
            lines.append("> 此页未识别到可用文字。请直接查看原 PDF；复杂表格、公式与图形保持原页视觉结构。")
        } else {
            lines.append(page.text)
        }
        return lines.joined(separator: "\n") + "\n"
    }

    private static func documentMarkdown(
        sourceURL: URL,
        contentSHA256: String,
        pages: [ManifestPage]
    ) -> String {
        var lines = [
            "# \(sourceURL.lastPathComponent)",
            "",
            "- 原始 PDF：\(sourceURL.path)",
            "- 内容 SHA-256：\(contentSHA256)",
            "- 页数：\(pages.count)",
            "- 说明：优先使用 PDF 内嵌文字；缺失或无意义文字层的页面使用本机 Vision OCR。复杂表格、公式与图形未做结构化重建。",
            "",
            "## 页面",
            "",
        ]
        lines.append(contentsOf: pages.map { page in
            let confidence: String
            if let value = page.confidence {
                confidence = String(format: "，Vision 置信度 %.3f", value)
            } else {
                confidence = ""
            }
            return "- [第 \(page.number) 页](\(page.markdownPath))（\(page.origin.displayName)\(confidence)）"
        })
        return lines.joined(separator: "\n") + "\n"
    }

    // MARK: - Local PDF / Vision work

    private static func sha256(of sourceURL: URL) throws -> (hash: String, byteCount: Int64) {
        let handle = try FileHandle(forReadingFrom: sourceURL)
        defer { try? handle.close() }

        var hasher = SHA256()
        var byteCount: Int64 = 0
        while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty {
            hasher.update(data: chunk)
            byteCount += Int64(chunk.count)
        }
        let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
        return (digest, byteCount)
    }

    private static func normalizedText(_ text: String) -> String {
        text
            .replacingOccurrences(of: "\u{00a0}", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Render at roughly 288 DPI (or the largest safe dimension) before Vision
    /// sees the page. This is intentionally a local intermediate, not an LLM
    /// attachment.
    private static func render(page: PDFPage) throws -> CGImage {
        let bounds = page.bounds(for: .mediaBox)
        guard bounds.width > 0, bounds.height > 0 else {
            throw IngestionError.cannotRenderPage(0)
        }

        let targetScale: CGFloat = 4 // 72 pt × 4 ≈ 288 DPI
        let maxDimension: CGFloat = 4_096
        let scale = min(targetScale, maxDimension / max(bounds.width, bounds.height))
        let width = max(1, Int((bounds.width * scale).rounded(.up)))
        let height = max(1, Int((bounds.height * scale).rounded(.up)))
        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            throw IngestionError.cannotRenderPage(0)
        }

        context.setFillColor(NSColor.white.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.saveGState()
        context.translateBy(x: 0, y: CGFloat(height))
        context.scaleBy(x: scale, y: -scale)
        context.translateBy(x: -bounds.minX, y: -bounds.minY)
        page.draw(with: .mediaBox, to: context)
        context.restoreGState()

        guard let image = context.makeImage() else {
            throw IngestionError.cannotRenderPage(0)
        }
        return image
    }

    private static func recognizeWithVision(_ image: CGImage) throws -> OCRResult {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US", "ja-JP"]

        let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
        try handler.perform([request])

        let lines = (request.results ?? []).compactMap { observation -> (text: String, top: CGFloat, left: CGFloat, confidence: Float)? in
            guard let candidate = observation.topCandidates(1).first,
                  !candidate.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else {
                return nil
            }
            return (
                text: candidate.string,
                top: observation.boundingBox.maxY,
                left: observation.boundingBox.minX,
                confidence: candidate.confidence
            )
        }.sorted { lhs, rhs in
            // Group observations in the same approximate line, then order left
            // to right. Vision bounding boxes use a lower-left origin.
            if abs(lhs.top - rhs.top) < 0.02 {
                return lhs.left < rhs.left
            }
            return lhs.top > rhs.top
        }

        let text = lines.map(\.text).joined(separator: "\n")
        let confidence: Float?
        if lines.isEmpty {
            confidence = nil
        } else {
            confidence = lines.map(\.confidence).reduce(0, +) / Float(lines.count)
        }
        return OCRResult(text: text, confidence: confidence)
    }
}
