import AppKit
import CryptoKit
import PDFKit
import XCTest
@testable import PipiUI

final class NativePDFIngestionTests: XCTestCase {
    private var temporaryURLs: [URL] = []

    override func tearDownWithError() throws {
        for url in temporaryURLs {
            try? FileManager.default.removeItem(at: url)
        }
        temporaryURLs = []
        try super.tearDownWithError()
    }

    func testScannedPDFWritesPageBundleAndUsesInjectedLocalOCR() throws {
        let projectURL = try makeTemporaryDirectory("project")
        let sourceURL = try writeScannedPDF(named: "scanned.pdf", color: .systemTeal)
        let recognizer = CountingRecognizer(text: "扫描 PDF 的本机文字\n第二行", confidence: 0.91)

        let result = try NativePDFIngestion.ingest(
            sourceURL: sourceURL,
            projectURL: projectURL,
            recognize: recognizer.callAsFunction
        )

        XCTAssertFalse(result.reusedCache)
        XCTAssertEqual(recognizer.callCount, 1, "image-only page must route to the injected OCR seam")
        XCTAssertEqual(result.pages.count, 1)
        XCTAssertEqual(result.pages.first?.origin, .visionOCR)
        XCTAssertEqual(result.pages.first?.confidence, 0.91)
        XCTAssertEqual(result.selectedSourceURL, sourceURL)
        XCTAssertEqual(result.immutablePDFURL.lastPathComponent, NativePDFIngestion.immutablePDFFileName)
        XCTAssertTrue(FileManager.default.fileExists(atPath: result.manifestURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: result.documentURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: result.pagesDirectoryURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: result.immutablePDFURL.path))
        XCTAssertEqual(sha256(try Data(contentsOf: result.immutablePDFURL)), result.contentSHA256)
        XCTAssertEqual(
            result.directoryURL.deletingLastPathComponent().lastPathComponent,
            "pdf-sources"
        )

        let pageMarkdown = try String(contentsOf: try XCTUnwrap(result.pages.first?.markdownURL))
        XCTAssertTrue(pageMarkdown.contains("# scanned.pdf — 第 1 页"))
        XCTAssertTrue(pageMarkdown.contains("本机 Vision OCR"))
        XCTAssertTrue(pageMarkdown.contains("扫描 PDF 的本机文字"))
        XCTAssertTrue(pageMarkdown.contains(result.immutablePDFURL.path))
        XCTAssertTrue(pageMarkdown.contains("选取时外部路径"))

        let documentMarkdown = try String(contentsOf: result.documentURL)
        XCTAssertTrue(documentMarkdown.contains("[第 1 页](pages/page-0001.md)"))
        XCTAssertTrue(documentMarkdown.contains("复杂表格、公式与图形未做结构化重建"))
        XCTAssertTrue(documentMarkdown.contains(result.immutablePDFURL.path))
        XCTAssertTrue(documentMarkdown.contains("选取时外部路径"))

        let manifest = try manifestDictionary(at: result.manifestURL)
        XCTAssertEqual(manifest["schemaVersion"] as? Int, NativePDFIngestion.schemaVersion)
        XCTAssertEqual(manifest["sourceContentSHA256"] as? String, result.contentSHA256)
        XCTAssertEqual(manifest["selectionTimeSourceFileName"] as? String, sourceURL.lastPathComponent)
        XCTAssertEqual(manifest["selectionTimeSourcePath"] as? String, sourceURL.path)
        XCTAssertEqual(manifest["immutablePDFRelativePath"] as? String, NativePDFIngestion.immutablePDFFileName)
        XCTAssertEqual(manifest["immutablePDFPath"] as? String, result.immutablePDFURL.path)
        XCTAssertNil(manifest["sourcePath"])
        let pages = try XCTUnwrap(manifest["pages"] as? [[String: Any]])
        XCTAssertEqual(pages.first?["origin"] as? String, "vision-ocr")

        let reference = result.draftReference()
        XCTAssertTrue(reference.contains(result.immutablePDFURL.path))
        XCTAssertTrue(reference.contains(sourceURL.path))
        XCTAssertTrue(reference.contains(result.directoryURL.path))
        XCTAssertTrue(reference.contains(result.documentURL.path))
        XCTAssertTrue(reference.contains(result.pagesDirectoryURL.path))
        XCTAssertTrue(reference.contains("本次选择路径（仅供追溯"))
        XCTAssertFalse(reference.contains("扫描 PDF 的本机文字"), "composer gets pointers, not the PDF body")
    }

    func testMatchingContentReusesCompleteBundleWithoutCallingOCRAgain() throws {
        let projectURL = try makeTemporaryDirectory("project")
        let sourceURL = try writeScannedPDF(named: "same-content.pdf", color: .systemIndigo)
        let firstRecognizer = CountingRecognizer(text: "第一次本机解析")

        let first = try NativePDFIngestion.ingest(
            sourceURL: sourceURL,
            projectURL: projectURL,
            recognize: firstRecognizer.callAsFunction
        )
        XCTAssertEqual(firstRecognizer.callCount, 1)

        let secondRecognizer = CountingRecognizer(text: "不应运行")
        let second = try NativePDFIngestion.ingest(
            sourceURL: sourceURL,
            projectURL: projectURL,
            recognize: secondRecognizer.callAsFunction
        )

        XCTAssertTrue(second.reusedCache)
        XCTAssertEqual(second.contentSHA256, first.contentSHA256)
        XCTAssertEqual(second.directoryURL, first.directoryURL)
        XCTAssertEqual(secondRecognizer.callCount, 0, "complete hash-matched cache must skip OCR")
    }

    func testChangedPDFContentCreatesNewBundleAndReroutesFallback() throws {
        let projectURL = try makeTemporaryDirectory("project")
        let sourceURL = try writeScannedPDF(named: "changing.pdf", color: .systemOrange)
        let recognizer = CountingRecognizer(text: "本机结果")

        let first = try NativePDFIngestion.ingest(
            sourceURL: sourceURL,
            projectURL: projectURL,
            recognize: recognizer.callAsFunction
        )
        try overwriteScannedPDF(at: sourceURL, color: .systemPurple)
        let second = try NativePDFIngestion.ingest(
            sourceURL: sourceURL,
            projectURL: projectURL,
            recognize: recognizer.callAsFunction
        )

        XCTAssertFalse(second.reusedCache)
        XCTAssertNotEqual(second.contentSHA256, first.contentSHA256)
        XCTAssertNotEqual(second.directoryURL, first.directoryURL)
        XCTAssertEqual(recognizer.callCount, 2, "content hash invalidation must run extraction again")
    }

    func testMutationAfterPrivateSnapshotKeepsHashAndPagesBoundToSnapshot() throws {
        let projectURL = try makeTemporaryDirectory("project")
        let sourceURL = try writeScannedPDF(named: "mutating.pdf", color: .systemRed)
        let originalHash = sha256(try Data(contentsOf: sourceURL))
        let recognizer = CountingRecognizer(text: "snapshot OCR result")
        var mutationError: Error?

        let result = try NativePDFIngestion.ingest(
            sourceURL: sourceURL,
            projectURL: projectURL,
            recognize: recognizer.callAsFunction,
            afterSnapshot: { _ in
                do {
                    try self.overwriteScannedPDF(at: sourceURL, color: .systemGreen)
                } catch {
                    mutationError = error
                }
            }
        )

        XCTAssertNil(mutationError)
        XCTAssertEqual(result.contentSHA256, originalHash)
        XCTAssertNotEqual(result.contentSHA256, sha256(try Data(contentsOf: sourceURL)))
        XCTAssertTrue(FileManager.default.fileExists(atPath: result.immutablePDFURL.path))
        XCTAssertEqual(sha256(try Data(contentsOf: result.immutablePDFURL)), originalHash)
        XCTAssertEqual(recognizer.callCount, 1)
        let pageMarkdown = try String(contentsOf: try XCTUnwrap(result.pages.first?.markdownURL))
        XCTAssertTrue(pageMarkdown.contains("snapshot OCR result"))
        let documentMarkdown = try String(contentsOf: result.documentURL)
        let draftReference = result.draftReference()
        let manifest = try manifestDictionary(at: result.manifestURL)
        XCTAssertEqual(manifest["sourceContentSHA256"] as? String, originalHash)
        XCTAssertEqual(manifest["selectionTimeSourcePath"] as? String, sourceURL.path)
        XCTAssertEqual(manifest["immutablePDFPath"] as? String, result.immutablePDFURL.path)

        for presentation in [draftReference, documentMarkdown, pageMarkdown] {
            let immutableLine = try XCTUnwrap(
                presentation
                    .split(separator: "\n")
                    .map(String.init)
                    .first(where: { $0.contains("不可变视觉 PDF") })
            )
            XCTAssertTrue(presentation.contains(result.immutablePDFURL.path))
            XCTAssertTrue(presentation.contains(sourceURL.path))
            XCTAssertTrue(presentation.contains("可能已变化"))
            XCTAssertTrue(immutableLine.contains(result.immutablePDFURL.path))
            XCTAssertFalse(immutableLine.contains(sourceURL.path))
            XCTAssertFalse(presentation.contains("原始 PDF：\(sourceURL.path)"))
        }
    }

    func testMissingOrCorruptImmutablePDFRebuildsExactCacheEntry() throws {
        let projectURL = try makeTemporaryDirectory("project")
        let sourceURL = try writeScannedPDF(named: "cache-validation.pdf", color: .systemBrown)
        let firstRecognizer = CountingRecognizer(text: "first parse")
        let first = try NativePDFIngestion.ingest(
            sourceURL: sourceURL,
            projectURL: projectURL,
            recognize: firstRecognizer.callAsFunction
        )
        XCTAssertEqual(firstRecognizer.callCount, 1)

        try FileManager.default.removeItem(at: first.immutablePDFURL)
        let missingArtifactRecognizer = CountingRecognizer(text: "rebuilt after missing artifact")
        let rebuiltMissingArtifact = try NativePDFIngestion.ingest(
            sourceURL: sourceURL,
            projectURL: projectURL,
            recognize: missingArtifactRecognizer.callAsFunction
        )
        XCTAssertFalse(rebuiltMissingArtifact.reusedCache)
        XCTAssertEqual(missingArtifactRecognizer.callCount, 1)
        XCTAssertEqual(rebuiltMissingArtifact.directoryURL, first.directoryURL)
        XCTAssertEqual(
            sha256(try Data(contentsOf: rebuiltMissingArtifact.immutablePDFURL)),
            rebuiltMissingArtifact.contentSHA256
        )

        try Data("corrupt immutable PDF".utf8).write(to: rebuiltMissingArtifact.immutablePDFURL)
        let corruptArtifactRecognizer = CountingRecognizer(text: "rebuilt after corrupt artifact")
        let rebuiltCorruptArtifact = try NativePDFIngestion.ingest(
            sourceURL: sourceURL,
            projectURL: projectURL,
            recognize: corruptArtifactRecognizer.callAsFunction
        )
        XCTAssertFalse(rebuiltCorruptArtifact.reusedCache)
        XCTAssertEqual(corruptArtifactRecognizer.callCount, 1)
        XCTAssertEqual(
            sha256(try Data(contentsOf: rebuiltCorruptArtifact.immutablePDFURL)),
            rebuiltCorruptArtifact.contentSHA256
        )
    }

    func testEmbeddedPDFTextSkipsOCRFallback() throws {
        let projectURL = try makeTemporaryDirectory("project")
        let sourceURL = try writeTextPDF(named: "embedded.pdf", text: "Embedded PDF text 中文")
        let recognizer = CountingRecognizer(text: "OCR should not run")

        let result = try NativePDFIngestion.ingest(
            sourceURL: sourceURL,
            projectURL: projectURL,
            recognize: recognizer.callAsFunction
        )

        XCTAssertEqual(result.pages.first?.origin, .embeddedText)
        XCTAssertEqual(recognizer.callCount, 0)
        let markdown = try String(contentsOf: try XCTUnwrap(result.pages.first?.markdownURL))
        XCTAssertTrue(markdown.contains("Embedded PDF text"))
    }

    func testMeaningfulTextRejectsPageNumberOnlyArtifacts() {
        XCTAssertFalse(NativePDFIngestion.isMeaningfulEmbeddedText("  1  "))
        XCTAssertFalse(NativePDFIngestion.isMeaningfulEmbeddedText("— •"))
        XCTAssertTrue(NativePDFIngestion.isMeaningfulEmbeddedText("AI"))
        XCTAssertTrue(NativePDFIngestion.isMeaningfulEmbeddedText("第1"))
        XCTAssertTrue(NativePDFIngestion.isMeaningfulEmbeddedText("123456"))
    }

    /// A real-framework smoke test is opt-in because OCR wording can change with
    /// the installed macOS Vision model. The regular tests above remain fully
    /// deterministic through the injected recognizer seam.
    func testRealVisionPipelineWhenExplicitlyEnabled() throws {
        guard ProcessInfo.processInfo.environment["PIPIUI_RUN_NATIVE_PDF_VISION_TEST"] == "1" else {
            throw XCTSkip("Set PIPIUI_RUN_NATIVE_PDF_VISION_TEST=1 for the local Vision smoke test")
        }

        let projectURL = try makeTemporaryDirectory("vision-project")
        let sourceURL = try writeScannedPDF(
            named: "vision-smoke.pdf",
            color: .systemBlue,
            rasterText: "Native Vision OCR 123"
        )
        let result = try NativePDFIngestion.ingest(sourceURL: sourceURL, projectURL: projectURL)
        let markdown = try String(contentsOf: try XCTUnwrap(result.pages.first?.markdownURL))
        let body = markdown.components(separatedBy: "\n\n").last ?? ""

        XCTAssertEqual(result.pages.first?.origin, .visionOCR)
        XCTAssertTrue(
            normalizedFixtureText(body).contains("nativevisionocr123"),
            "Vision body should transcribe the raster fixture, got: \(body)"
        )
    }

    // MARK: - Fixtures

    private func makeTemporaryDirectory(_ suffix: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(
            "pipiui-native-pdf-tests-\(suffix)-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        temporaryURLs.append(url)
        return url
    }

    private func writeScannedPDF(
        named name: String,
        color: NSColor,
        rasterText: String? = nil
    ) throws -> URL {
        let sourceDirectory = try makeTemporaryDirectory("source")
        let url = sourceDirectory.appendingPathComponent(name)
        try overwriteScannedPDF(at: url, color: color, rasterText: rasterText)
        return url
    }

    private func overwriteScannedPDF(
        at url: URL,
        color: NSColor,
        rasterText: String? = nil
    ) throws {
        let image = NSImage(size: NSSize(width: 640, height: 420))
        image.lockFocus()
        color.setFill()
        NSBezierPath(rect: NSRect(origin: .zero, size: image.size)).fill()
        NSColor.white.setFill()
        NSBezierPath(rect: NSRect(x: 24, y: 24, width: 592, height: 372)).fill()
        if let rasterText {
            rasterText.draw(
                at: NSPoint(x: 72, y: 210),
                withAttributes: [
                    .font: NSFont.systemFont(ofSize: 42, weight: .medium),
                    .foregroundColor: NSColor.black,
                ]
            )
        }
        image.unlockFocus()

        let document = PDFDocument()
        guard let page = PDFPage(image: image) else {
            throw FixtureError.cannotCreatePDF
        }
        document.insert(page, at: 0)
        guard document.write(to: url) else {
            throw FixtureError.cannotWritePDF
        }
        XCTAssertNil(PDFDocument(url: url)?.page(at: 0)?.string, "fixture must not contain a PDF text layer")
    }

    private func writeTextPDF(named name: String, text: String) throws -> URL {
        let sourceDirectory = try makeTemporaryDirectory("source")
        let url = sourceDirectory.appendingPathComponent(name)
        let view = TextPDFFixtureView(text: text, frame: NSRect(x: 0, y: 0, width: 612, height: 792))
        try view.dataWithPDF(inside: view.bounds).write(to: url, options: .atomic)
        return url
    }

    private func manifestDictionary(at url: URL) throws -> [String: Any] {
        let object = try JSONSerialization.jsonObject(with: Data(contentsOf: url))
        return try XCTUnwrap(object as? [String: Any])
    }

    private func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func normalizedFixtureText(_ text: String) -> String {
        String(String.UnicodeScalarView(text.unicodeScalars.filter {
            $0.properties.isAlphabetic || $0.properties.numericType != nil
        })).lowercased()
    }

    private enum FixtureError: Error {
        case cannotCreatePDF
        case cannotWritePDF
    }
}

private final class CountingRecognizer {
    private(set) var callCount = 0
    private let text: String
    private let confidence: Float?

    init(text: String, confidence: Float? = nil) {
        self.text = text
        self.confidence = confidence
    }

    func callAsFunction(_: CGImage) throws -> NativePDFIngestion.OCRResult {
        callCount += 1
        return NativePDFIngestion.OCRResult(text: text, confidence: confidence)
    }
}

private final class TextPDFFixtureView: NSView {
    private let text: String

    init(text: String, frame: NSRect) {
        self.text = text
        super.init(frame: frame)
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.white.setFill()
        dirtyRect.fill()
        text.draw(
            at: NSPoint(x: 48, y: 700),
            withAttributes: [
                .font: NSFont.systemFont(ofSize: 20),
                .foregroundColor: NSColor.black,
            ]
        )
    }
}
