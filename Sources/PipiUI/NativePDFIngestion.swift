import CryptoKit
import Foundation
import PipiPDFCore

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
    /// Byte-identical visual companion retained inside every complete bundle.
    /// Pi must use this file—not the mutable path selected by the user—when
    /// tables, formulas, charts, or other page visuals matter.
    static let immutablePDFFileName = "source.pdf"
    static let schemaVersion = 3
    /// Coordinates final cache publication inside this app process. Extraction
    /// itself stays concurrent/off-main; only the short validate/write/rename
    /// critical section is serialized.
    private static let cacheWriteLock = NSLock()

    typealias ExtractionOrigin = PDFExtractionOrigin

    struct Page: Equatable {
        let number: Int
        let origin: ExtractionOrigin
        let confidence: Float?
        let markdownURL: URL
    }

    struct SourceBundle: Equatable {
        /// The path selected for this ingest invocation. It is provenance only:
        /// another process may later replace its bytes.
        let selectedSourceURL: URL
        /// The byte-identical PDF retained in the content-addressed bundle.
        let immutablePDFURL: URL
        let directoryURL: URL
        let manifestURL: URL
        let documentURL: URL
        let pagesDirectoryURL: URL
        let contentSHA256: String
        let pages: [Page]
        let reusedCache: Bool

        /// A short, explicit pointer that can be appended to the current draft.
        /// It gives Pi the immutable parsed bundle and byte-identical visual PDF
        /// without copying the document body into the prompt.
        func draftReference() -> String {
            """
            [本地 PDF 已解析]
            不可变视觉 PDF（与内容 SHA-256 完全一致；表格、公式、图形请读取此文件）：\(immutablePDFURL.path)
            解析目录：\(directoryURL.path)
            解析文档：\(documentURL.path)
            单页 Markdown：\(pagesDirectoryURL.path)
            本次选择路径（仅供追溯，外部文件可能已变化，不代表内容 SHA-256）：\(selectedSourceURL.path)
            内容 SHA-256：\(contentSHA256)
            """
        }
    }

    typealias OCRResult = PDFOCRResult

    /// Injectable for deterministic tests and for future local recognizer tuning.
    typealias OCRRecognizer = PDFOCRRecognizer

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
        case snapshotFailed(String)
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
            case .snapshotFailed(let reason):
                return "无法创建 PDF 本地解析快照：\(reason)"
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
        recognize: OCRRecognizer? = nil,
        afterSnapshot: ((URL) -> Void)? = nil
    ) throws -> SourceBundle {
        progress?(Progress(phase: .hashing, completedPages: 0, totalPages: 0))

        let accessedSecurityScopedResource = sourceURL.startAccessingSecurityScopedResource()
        defer {
            if accessedSecurityScopedResource {
                sourceURL.stopAccessingSecurityScopedResource()
            }
        }

        let snapshotURL: URL
        do {
            snapshotURL = try makeSnapshot(of: sourceURL)
        } catch {
            throw IngestionError.snapshotFailed(error.localizedDescription)
        }
        defer { try? FileManager.default.removeItem(at: snapshotURL) }

        // The snapshot is private and immutable for this ingest. A selected file
        // can be replaced by a sync client while this runs, but the hash, PDFKit
        // pages, and eventual cache publication all now refer to these same bytes.
        afterSnapshot?(snapshotURL)

        let fingerprint: (hash: String, byteCount: Int64)
        do {
            fingerprint = try sha256(of: snapshotURL)
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

        let extraction: PDFExtractionResult
        do {
            extraction = try PDFExtractionCore.extract(
                sourceURL: snapshotURL,
                options: PDFExtractionOptions(mode: .auto),
                recognize: recognize,
                progress: { completedPages, totalPages in
                    progress?(Progress(
                        phase: .extracting,
                        completedPages: completedPages,
                        totalPages: totalPages
                    ))
                }
            )
        } catch let error as PDFExtractionError {
            // Preserve the attachment-ingestion errors that existing UI callers
            // understand while allowing new core-only cancellation/timeout errors
            // to propagate if this caller ever opts into those controls.
            switch error {
            case .invalidPDF:
                throw IngestionError.invalidPDF
            case .noPages:
                throw IngestionError.noPages
            case let .missingPage(number):
                throw IngestionError.missingPage(number)
            case let .cannotRenderPage(number):
                throw IngestionError.cannotRenderPage(number)
            case let .recognitionFailed(page, reason):
                throw IngestionError.recognitionFailed(page: page, reason: reason)
            default:
                throw error
            }
        }
        let pageCount = extraction.pageCount
        let extractedPages = extraction.pages.map { page in
            ExtractedPage(
                number: page.number,
                origin: page.origin,
                confidence: page.confidence,
                text: page.text
            )
        }

        progress?(Progress(phase: .writing, completedPages: pageCount, totalPages: pageCount))
        return try writeBundle(
            extractedPages,
            selectedSourceURL: sourceURL,
            snapshotURL: snapshotURL,
            sourceByteCount: fingerprint.byteCount,
            contentSHA256: fingerprint.hash,
            rootURL: rootURL,
            bundleURL: bundleURL
        )
    }

    /// Compatibility seam for existing attachment tests and callers. The reusable
    /// core adds printable/garbled/header/short-page diagnostics to this decision.
    static func isMeaningfulEmbeddedText(_ text: String) -> Bool {
        PDFExtractionCore.isMeaningfulEmbeddedText(text)
    }

    // MARK: - Cache validation and writing

    private struct Manifest: Codable {
        let schemaVersion: Int
        let sourceContentSHA256: String
        /// Historical path when the bundle was first created. This is not a
        /// claim that the external file still has `sourceContentSHA256`.
        let selectionTimeSourceFileName: String
        let selectionTimeSourcePath: String
        /// The final bundle's byte-identical visual artifact. Both fields make
        /// the distinction explicit for readers and cache validation.
        let immutablePDFRelativePath: String
        let immutablePDFPath: String
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
        let immutablePDFURL = bundleURL.appendingPathComponent(immutablePDFFileName)
        guard fileManager.fileExists(atPath: manifestURL.path),
              fileManager.fileExists(atPath: documentURL.path),
              let data = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONDecoder().decode(Manifest.self, from: data),
              manifest.schemaVersion == schemaVersion,
              manifest.sourceContentSHA256 == expectedHash,
              manifest.immutablePDFRelativePath == immutablePDFFileName,
              manifest.immutablePDFPath == immutablePDFURL.path,
              manifest.pageCount > 0,
              manifest.pages.count == manifest.pageCount,
              fileManager.fileExists(atPath: immutablePDFURL.path),
              let immutableFingerprint = try? sha256(of: immutablePDFURL),
              immutableFingerprint.hash == expectedHash,
              immutableFingerprint.byteCount == manifest.sourceByteCount
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
            selectedSourceURL: sourceURL,
            immutablePDFURL: immutablePDFURL,
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
        selectedSourceURL: URL,
        snapshotURL: URL,
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
                sourceURL: selectedSourceURL,
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
            let immutablePDFURL = bundleURL.appendingPathComponent(immutablePDFFileName)
            let stagingImmutablePDFURL = stagingURL.appendingPathComponent(immutablePDFFileName)
            try fileManager.copyItem(at: snapshotURL, to: stagingImmutablePDFURL)
            let persistedFingerprint = try sha256(of: stagingImmutablePDFURL)
            guard persistedFingerprint.hash == contentSHA256,
                  persistedFingerprint.byteCount == sourceByteCount
            else {
                throw IngestionError.writeFailed("不可变 PDF 快照内容校验失败")
            }

            let manifestPages = try pages.map { page -> ManifestPage in
                let relativePath = pageRelativePath(number: page.number)
                let pageURL = stagingURL.appendingPathComponent(relativePath)
                try pageMarkdown(
                    selectedSourceURL: selectedSourceURL,
                    immutablePDFURL: immutablePDFURL,
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
                selectionTimeSourceFileName: selectedSourceURL.lastPathComponent,
                selectionTimeSourcePath: selectedSourceURL.path,
                immutablePDFRelativePath: immutablePDFFileName,
                immutablePDFPath: immutablePDFURL.path,
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
                selectedSourceURL: selectedSourceURL,
                immutablePDFURL: immutablePDFURL,
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
                    sourceURL: selectedSourceURL,
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
            selectedSourceURL: selectedSourceURL,
            immutablePDFURL: bundleURL.appendingPathComponent(immutablePDFFileName),
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
        selectedSourceURL: URL,
        immutablePDFURL: URL,
        contentSHA256: String,
        page: ExtractedPage
    ) -> String {
        var lines = [
            "# \(selectedSourceURL.lastPathComponent) — 第 \(page.number) 页",
            "",
            "- 不可变视觉 PDF（与内容 SHA-256 一致；表格、公式、图形请读取此文件）：\(immutablePDFURL.path)",
            "- 选取时外部路径（仅供追溯，可能已变化，不代表内容 SHA-256）：\(selectedSourceURL.path)",
            "- 内容 SHA-256：\(contentSHA256)",
            "- 提取来源：\(page.origin.displayName)",
        ]
        if let confidence = page.confidence {
            lines.append(String(format: "- Vision OCR 置信度：%.3f", confidence))
        }
        lines.append("")
        if page.text.isEmpty {
            lines.append("> 此页未识别到可用文字。请直接查看上述不可变视觉 PDF；复杂表格、公式与图形保持原页视觉结构。")
        } else {
            lines.append(page.text)
        }
        return lines.joined(separator: "\n") + "\n"
    }

    private static func documentMarkdown(
        selectedSourceURL: URL,
        immutablePDFURL: URL,
        contentSHA256: String,
        pages: [ManifestPage]
    ) -> String {
        var lines = [
            "# \(selectedSourceURL.lastPathComponent)",
            "",
            "- 不可变视觉 PDF（与内容 SHA-256 一致；表格、公式、图形请读取此文件）：\(immutablePDFURL.path)",
            "- 选取时外部路径（仅供追溯，可能已变化，不代表内容 SHA-256）：\(selectedSourceURL.path)",
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

    private static func makeSnapshot(of sourceURL: URL) throws -> URL {
        let fileManager = FileManager.default
        let rootURL = fileManager.temporaryDirectory
            .appendingPathComponent("pipiui-native-pdf-snapshots", isDirectory: true)
        try fileManager.createDirectory(at: rootURL, withIntermediateDirectories: true)
        let snapshotURL = rootURL.appendingPathComponent("\(UUID().uuidString).pdf")
        do {
            try fileManager.copyItem(at: sourceURL, to: snapshotURL)
        } catch {
            try? fileManager.removeItem(at: snapshotURL)
            throw error
        }
        return snapshotURL
    }

}
