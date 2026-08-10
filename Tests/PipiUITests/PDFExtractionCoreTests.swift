import AppKit
import CoreGraphics
import PDFKit
import XCTest
@testable import PipiPDFCore

final class PDFExtractionCoreTests: XCTestCase {
    private var temporaryURLs: [URL] = []

    override func tearDownWithError() throws {
        for url in temporaryURLs {
            try? FileManager.default.removeItem(at: url)
        }
        temporaryURLs = []
        try super.tearDownWithError()
    }

    func testTextQualityClassifiesNormalGarbledPageNumberShortNumericAndMixedText() {
        let normal = PDFExtractionCore.assessTextQuality(
            "Quarterly report\nRevenue increased 18 percent and customer retention remained strong."
        )
        XCTAssertTrue(normal.isUsable)
        XCTAssertGreaterThan(normal.alphanumericRatio, 0.5)
        XCTAssertFalse(normal.suspectedGarbled)

        let garbled = PDFExtractionCore.assessTextQuality("\u{FFFD}\u{FFFD}\u{E000}\u{E001}")
        XCTAssertFalse(garbled.isUsable)
        XCTAssertTrue(garbled.suspectedGarbled)
        XCTAssertTrue(garbled.issues.contains(.suspectedGarbled))

        let pageNumber = PDFExtractionCore.assessTextQuality("Page 12 of 42")
        XCTAssertFalse(pageNumber.isUsable)
        XCTAssertTrue(pageNumber.pageNumberOrHeaderOnly)

        let short = PDFExtractionCore.assessTextQuality("x")
        XCTAssertFalse(short.isUsable)
        XCTAssertTrue(short.veryShort)
        XCTAssertTrue(short.issues.contains(.veryShort))

        let numericTable = PDFExtractionCore.assessTextQuality(
            "2022  1234.50\n2023  1456.75\n2024  1678.90\n2025  1812.25"
        )
        XCTAssertTrue(numericTable.isUsable, "dense numeric tables must not be mistaken for a page number")
        XCTAssertFalse(numericTable.pageNumberOrHeaderOnly)

        let mixed = PDFExtractionCore.assessTextQuality(
            "Executive summary\nRevenue: 1,234.50\nMargin: 24%\nThis page mixes prose and numbers."
        )
        XCTAssertTrue(mixed.isUsable)
        XCTAssertGreaterThan(mixed.characterCount, 30)
    }

    func testAutoRoutesOnlyWeakPagesToInjectedOCR() throws {
        let pdf = try writeMixedPDF()
        let recognizer = OCRSpy(text: "OCR second page", confidence: 0.88)

        let result = try PDFExtractionCore.extract(
            sourceURL: pdf,
            options: PDFExtractionOptions(mode: .auto),
            recognize: recognizer.callAsFunction
        )

        XCTAssertEqual(result.pageCount, 2)
        XCTAssertEqual(result.selectedPages, [1, 2])
        XCTAssertEqual(result.pages.map(\.origin), [.embeddedText, .visionOCR])
        XCTAssertEqual(result.diagnostics.textPages, [1])
        XCTAssertEqual(result.diagnostics.ocrPages, [2])
        XCTAssertEqual(recognizer.callCount, 1, "auto must OCR only the weak image-only page")
        XCTAssertTrue(result.pages[0].text.contains("Embedded first page"))
        XCTAssertEqual(result.pages[1].text, "OCR second page")
        XCTAssertTrue(result.diagnostics.warnings.joined(separator: " ").contains("Page 2"))
    }

    func testTextAndOCRModesFollowExplicitRouting() throws {
        let pdf = try writeMixedPDF()

        let textRecognizer = OCRSpy(text: "must not run")
        let textResult = try PDFExtractionCore.extract(
            sourceURL: pdf,
            options: PDFExtractionOptions(mode: .text),
            recognize: textRecognizer.callAsFunction
        )
        XCTAssertEqual(textRecognizer.callCount, 0)
        XCTAssertEqual(textResult.pages.map(\.origin), [.embeddedText, .embeddedText])
        XCTAssertEqual(textResult.diagnostics.ocrPages, [])
        XCTAssertTrue(textResult.diagnostics.warnings.joined(separator: " ").contains("text-only mode"))

        let ocrRecognizer = OCRSpy(text: "forced OCR")
        let ocrResult = try PDFExtractionCore.extract(
            sourceURL: pdf,
            options: PDFExtractionOptions(mode: .ocr),
            recognize: ocrRecognizer.callAsFunction
        )
        XCTAssertEqual(ocrRecognizer.callCount, 2)
        XCTAssertEqual(ocrResult.pages.map(\.origin), [.visionOCR, .visionOCR])
        XCTAssertEqual(ocrResult.diagnostics.textPages, [])
        XCTAssertEqual(ocrResult.diagnostics.ocrPages, [1, 2])
    }

    func testHelperJSONProtocolPagesMaxLengthAndPureStdout() throws {
        let pdf = try writeTextPDF(pages: [
            "First helper page has enough embedded text to avoid OCR.",
            "Second helper page is selected by the request.",
        ])
        let request = PDFHelperRequest(path: pdf.path, mode: .text, pages: [2], maxLength: 80)
        let encoded = try JSONEncoder().encode(request)
        let decoded = try JSONDecoder().decode(PDFHelperRequest.self, from: encoded)
        XCTAssertEqual(decoded, request)

        let command = PDFHelperCommand.execute(inputData: encoded)
        XCTAssertEqual(command.exitCode, .success)
        XCTAssertEqual(command.stderr, "", "success must not emit helper diagnostics")
        let stdout = try XCTUnwrap(String(data: command.stdout, encoding: .utf8))
        XCTAssertFalse(stdout.contains("pipiui-pdf-helper:"), "stdout must contain JSON only, never logs")
        let response = try JSONDecoder().decode(PDFHelperResponse.self, from: command.stdout)
        XCTAssertTrue(response.ok)
        let metadata = try XCTUnwrap(response.metadata)
        XCTAssertEqual(metadata.pageCount, 2)
        XCTAssertEqual(metadata.selectedPages, [2])
        XCTAssertEqual(metadata.textPages, [2])
        XCTAssertEqual(metadata.ocrPages, [])
        XCTAssertTrue(metadata.truncated)
        XCTAssertLessThanOrEqual(try XCTUnwrap(response.markdown).count, 80)

        let invalid = PDFHelperCommand.execute(inputData: Data("not json".utf8))
        XCTAssertEqual(invalid.exitCode, .invalidRequest)
        let invalidResponse = try JSONDecoder().decode(PDFHelperResponse.self, from: invalid.stdout)
        XCTAssertFalse(invalidResponse.ok)
        XCTAssertEqual(invalidResponse.error?.code, .invalidRequest)
        XCTAssertFalse(invalid.stderr.isEmpty, "diagnostics belong on stderr")
    }

    func testHelperRejectsInvalidPageAndHonorsPageSelectionBeforeExtraction() throws {
        let pdf = try writeTextPDF(pages: ["One", "Two with enough text to remain usable."])
        let emptyPages = PDFHelperCommand.execute(
            inputData: try JSONEncoder().encode(PDFHelperRequest(path: pdf.path, mode: .text, pages: []))
        )
        XCTAssertEqual(emptyPages.exitCode, .invalidRequest)
        let response = try JSONDecoder().decode(PDFHelperResponse.self, from: emptyPages.stdout)
        XCTAssertEqual(response.error?.code, .invalidRequest)
    }

    // MARK: - Fixtures

    private func temporaryDirectory(_ label: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(
            "pipiui-pdf-core-tests-\(label)-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        temporaryURLs.append(url)
        return url
    }

    private func writeTextPDF(pages: [String]) throws -> URL {
        let directory = try temporaryDirectory("text")
        let url = directory.appendingPathComponent("text.pdf")
        let document = PDFDocument()
        for (index, text) in pages.enumerated() {
            let view = TextPDFPageView(text: text, frame: NSRect(x: 0, y: 0, width: 612, height: 792))
            let data = view.dataWithPDF(inside: view.bounds)
            let source = try XCTUnwrap(PDFDocument(data: data))
            document.insert(try XCTUnwrap(source.page(at: 0)), at: index)
        }
        XCTAssertTrue(document.write(to: url))
        return url
    }

    private func writeMixedPDF() throws -> URL {
        let directory = try temporaryDirectory("mixed")
        let url = directory.appendingPathComponent("mixed.pdf")
        let document = PDFDocument()

        let textView = TextPDFPageView(
            text: "Embedded first page with enough text to stay on the PDF text layer.",
            frame: NSRect(x: 0, y: 0, width: 612, height: 792)
        )
        let textDocument = try XCTUnwrap(PDFDocument(data: textView.dataWithPDF(inside: textView.bounds)))
        document.insert(try XCTUnwrap(textDocument.page(at: 0)), at: 0)

        let image = NSImage(size: NSSize(width: 612, height: 792))
        image.lockFocus()
        NSColor.white.setFill()
        NSBezierPath(rect: NSRect(origin: .zero, size: image.size)).fill()
        NSColor.black.setFill()
        "Raster second page".draw(
            at: NSPoint(x: 72, y: 400),
            withAttributes: [.font: NSFont.systemFont(ofSize: 32)]
        )
        image.unlockFocus()
        document.insert(try XCTUnwrap(PDFPage(image: image)), at: 1)

        XCTAssertTrue(document.write(to: url))
        XCTAssertNil(PDFDocument(url: url)?.page(at: 1)?.string)
        return url
    }
}

private final class OCRSpy {
    private(set) var callCount = 0
    private let text: String
    private let confidence: Float?

    init(text: String, confidence: Float? = nil) {
        self.text = text
        self.confidence = confidence
    }

    func callAsFunction(_: CGImage) throws -> PDFOCRResult {
        callCount += 1
        return PDFOCRResult(text: text, confidence: confidence)
    }
}

private final class TextPDFPageView: NSView {
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
