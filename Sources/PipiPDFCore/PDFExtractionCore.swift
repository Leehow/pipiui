import CoreGraphics
import Foundation
import PDFKit
import Vision

/// Extraction mode shared by the attachment ingester and the local helper.
/// `auto` keeps usable PDF text and sends only weak pages to on-device Vision OCR.
public enum PDFExtractionMode: String, Codable, CaseIterable, Equatable {
    case auto
    case text
    case ocr
}

public enum PDFExtractionOrigin: String, Codable, Equatable {
    case embeddedText = "embedded-text"
    case visionOCR = "vision-ocr"

    public var displayName: String {
        switch self {
        case .embeddedText: return "PDF 内嵌文字"
        case .visionOCR: return "本机 Vision OCR"
        }
    }
}

public struct PDFOCRResult: Equatable {
    public let text: String
    public let confidence: Float?

    public init(text: String, confidence: Float? = nil) {
        self.text = text
        self.confidence = confidence
    }
}

/// Injectable so callers can test routing without invoking Vision.
public typealias PDFOCRRecognizer = (CGImage) throws -> PDFOCRResult

public enum PDFTextQualityIssue: String, Codable, CaseIterable, Equatable {
    case empty
    case lowAlphanumericRatio = "low-alphanumeric-ratio"
    case lowPrintableRatio = "low-printable-ratio"
    case suspectedGarbled = "suspected-garbled"
    case pageNumberOrHeaderOnly = "page-number-or-header-only"
    case veryShort = "very-short"
}

/// Page-local text-layer diagnostics. A short but semantically meaningful title
/// (for example `AI`, `第1`, or `123456`) may carry a nonfatal `.veryShort`
/// issue while still being usable; this preserves the prior attachment behavior.
public struct PDFTextQuality: Equatable {
    public let characterCount: Int
    public let alphanumericRatio: Double
    public let printableRatio: Double
    public let suspectedGarbled: Bool
    public let pageNumberOrHeaderOnly: Bool
    public let veryShort: Bool
    public let issues: [PDFTextQualityIssue]
    public let isUsable: Bool
}

public enum PDFExtractionError: Error, LocalizedError, Equatable {
    case invalidPDF
    case noPages
    case pageLimitExceeded(pageCount: Int, limit: Int)
    case invalidPage(Int)
    case missingPage(Int)
    case cannotRenderPage(Int)
    case recognitionFailed(page: Int, reason: String)
    case cancelled
    case ocrTimedOut

    public var errorDescription: String? {
        switch self {
        case .invalidPDF:
            return "Unable to open PDF. The file may be damaged or unsupported."
        case .noPages:
            return "The PDF has no extractable pages."
        case let .pageLimitExceeded(pageCount, limit):
            return "The PDF has \(pageCount) pages, above the \(limit)-page limit."
        case let .invalidPage(page):
            return "Requested PDF page \(page) does not exist."
        case let .missingPage(page):
            return "Unable to read PDF page \(page)."
        case let .cannotRenderPage(page):
            return "Unable to render PDF page \(page) for local OCR."
        case let .recognitionFailed(page, reason):
            return "Local OCR failed on PDF page \(page): \(reason)"
        case .cancelled:
            return "PDF extraction was cancelled."
        case .ocrTimedOut:
            return "Local OCR exceeded its time limit."
        }
    }
}

public struct PDFExtractedPage: Equatable {
    public let number: Int
    public let origin: PDFExtractionOrigin
    public let confidence: Float?
    public let text: String
    /// Present for PDF text-layer decisions. It explains an auto-mode OCR fallback.
    public let embeddedTextQuality: PDFTextQuality?

    public init(
        number: Int,
        origin: PDFExtractionOrigin,
        confidence: Float?,
        text: String,
        embeddedTextQuality: PDFTextQuality?
    ) {
        self.number = number
        self.origin = origin
        self.confidence = confidence
        self.text = text
        self.embeddedTextQuality = embeddedTextQuality
    }
}

public struct PDFExtractionDiagnostics: Equatable {
    public let pageCount: Int
    public let selectedPages: [Int]
    public let textPages: [Int]
    public let ocrPages: [Int]
    public let warnings: [String]

    public init(
        pageCount: Int,
        selectedPages: [Int],
        textPages: [Int],
        ocrPages: [Int],
        warnings: [String]
    ) {
        self.pageCount = pageCount
        self.selectedPages = selectedPages
        self.textPages = textPages
        self.ocrPages = ocrPages
        self.warnings = warnings
    }
}

public struct PDFExtractionResult: Equatable {
    public let pageCount: Int
    public let selectedPages: [Int]
    public let pages: [PDFExtractedPage]
    public let diagnostics: PDFExtractionDiagnostics

    public init(
        pageCount: Int,
        selectedPages: [Int],
        pages: [PDFExtractedPage],
        diagnostics: PDFExtractionDiagnostics
    ) {
        self.pageCount = pageCount
        self.selectedPages = selectedPages
        self.pages = pages
        self.diagnostics = diagnostics
    }
}

public struct PDFExtractionOptions: Equatable {
    public var mode: PDFExtractionMode
    /// `nil` means every page. Non-nil page numbers are de-duplicated and sorted.
    public var pages: [Int]?
    /// A document-level guard; `nil` intentionally leaves the caller uncapped.
    public var maximumPageCount: Int?
    /// Checked before and after each Vision request. Vision itself is synchronous,
    /// so this stops subsequent pages rather than attempting unsafe interruption.
    public var ocrDeadline: Date?

    public init(
        mode: PDFExtractionMode = .auto,
        pages: [Int]? = nil,
        maximumPageCount: Int? = nil,
        ocrDeadline: Date? = nil
    ) {
        self.mode = mode
        self.pages = pages
        self.maximumPageCount = maximumPageCount
        self.ocrDeadline = ocrDeadline
    }
}

/// macOS-native PDF page extraction. It never uploads a PDF, uses no API key,
/// and does not download an OCR model: Vision is the locally installed framework.
public enum PDFExtractionCore {
    /// Extract one PDF synchronously. Call from a worker queue rather than the UI thread.
    public static func extract(
        sourceURL: URL,
        options: PDFExtractionOptions = .init(),
        recognize: PDFOCRRecognizer? = nil,
        isCancelled: (() -> Bool)? = nil,
        progress: ((Int, Int) -> Void)? = nil
    ) throws -> PDFExtractionResult {
        guard let document = PDFDocument(url: sourceURL) else {
            throw PDFExtractionError.invalidPDF
        }
        let pageCount = document.pageCount
        guard pageCount > 0 else { throw PDFExtractionError.noPages }
        if let limit = options.maximumPageCount, pageCount > limit {
            throw PDFExtractionError.pageLimitExceeded(pageCount: pageCount, limit: limit)
        }

        let selectedPages = try resolvedPageNumbers(options.pages, pageCount: pageCount)
        let recognizer = recognize ?? recognizeWithVision
        var extracted: [PDFExtractedPage] = []
        extracted.reserveCapacity(selectedPages.count)
        var textPages: [Int] = []
        var ocrPages: [Int] = []
        var warnings: [String] = []

        for (offset, pageNumber) in selectedPages.enumerated() {
            try checkCancellation(isCancelled)
            guard let page = document.page(at: pageNumber - 1) else {
                throw PDFExtractionError.missingPage(pageNumber)
            }

            let embeddedText = normalizedText(page.string ?? "")
            let quality = assessTextQuality(embeddedText)
            let needsOCR: Bool
            switch options.mode {
            case .auto:
                needsOCR = !quality.isUsable
            case .text:
                needsOCR = false
            case .ocr:
                needsOCR = true
            }

            if needsOCR {
                try checkCancellation(isCancelled)
                try checkOCRDeadline(options.ocrDeadline)
                let image = try render(page: page, pageNumber: pageNumber)
                let recognized: PDFOCRResult
                do {
                    recognized = try recognizer(image)
                } catch {
                    throw PDFExtractionError.recognitionFailed(
                        page: pageNumber,
                        reason: error.localizedDescription
                    )
                }
                try checkCancellation(isCancelled)
                try checkOCRDeadline(options.ocrDeadline)
                let text = normalizedText(recognized.text)
                extracted.append(
                    PDFExtractedPage(
                        number: pageNumber,
                        origin: .visionOCR,
                        confidence: recognized.confidence,
                        text: text,
                        embeddedTextQuality: options.mode == .ocr ? nil : quality
                    )
                )
                ocrPages.append(pageNumber)
                if options.mode == .auto {
                    warnings.append(
                        "Page \(pageNumber): embedded text routed to local OCR (\(quality.issues.map(\.rawValue).joined(separator: ", ")))."
                    )
                }
                if text.isEmpty {
                    warnings.append("Page \(pageNumber): local OCR returned no text.")
                }
            } else {
                extracted.append(
                    PDFExtractedPage(
                        number: pageNumber,
                        origin: .embeddedText,
                        confidence: nil,
                        text: embeddedText,
                        embeddedTextQuality: quality
                    )
                )
                textPages.append(pageNumber)
                if !quality.isUsable {
                    warnings.append(
                        "Page \(pageNumber): text-only mode kept low-quality embedded text (\(quality.issues.map(\.rawValue).joined(separator: ", ")))."
                    )
                }
            }
            progress?(offset + 1, selectedPages.count)
        }

        let diagnostics = PDFExtractionDiagnostics(
            pageCount: pageCount,
            selectedPages: selectedPages,
            textPages: textPages,
            ocrPages: ocrPages,
            warnings: warnings
        )
        return PDFExtractionResult(
            pageCount: pageCount,
            selectedPages: selectedPages,
            pages: extracted,
            diagnostics: diagnostics
        )
    }

    /// Normalizes the text layer without altering its page structure.
    public static func normalizedText(_ text: String) -> String {
        text
            .replacingOccurrences(of: "\u{00a0}", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Page-local quality assessment used by auto routing and exposed for deterministic tests.
    public static func assessTextQuality(_ rawText: String) -> PDFTextQuality {
        let text = normalizedText(rawText)
        let scalars = text.unicodeScalars.filter { !$0.properties.isWhitespace }
        guard !scalars.isEmpty else {
            return PDFTextQuality(
                characterCount: 0,
                alphanumericRatio: 0,
                printableRatio: 0,
                suspectedGarbled: false,
                pageNumberOrHeaderOnly: false,
                veryShort: true,
                issues: [.empty, .veryShort],
                isUsable: false
            )
        }

        let characterCount = scalars.count
        let letterCount = scalars.filter { $0.properties.isAlphabetic }.count
        let numberCount = scalars.filter { $0.properties.numericType != nil }.count
        let alphanumericRatio = Double(letterCount + numberCount) / Double(characterCount)
        let printableCount = scalars.filter(isPrintable).count
        let printableRatio = Double(printableCount) / Double(characterCount)
        let suspiciousCount = scalars.filter(isSuspiciousScalar).count
        let replacementCount = scalars.filter { $0.value == 0xFFFD }.count
        let suspectedGarbled = replacementCount > 0 || suspiciousCount * 5 >= characterCount
        let pageOnly = isPageNumberOrHeaderOnly(
            text,
            characterCount: characterCount,
            letterCount: letterCount,
            numberCount: numberCount
        )
        let veryShort = characterCount < 12
        let shortSemanticText =
            letterCount >= 2 ||
            (letterCount >= 1 && numberCount >= 1) ||
            numberCount >= 6
        let tooShort = veryShort && !shortSemanticText
        let numericTable = numberCount >= 8 && characterCount >= 16
        let lowAlphanumeric = alphanumericRatio < 0.20 && !numericTable
        let lowPrintable = printableRatio < 0.85

        var issues: [PDFTextQualityIssue] = []
        var blockers: [PDFTextQualityIssue] = []
        if suspectedGarbled {
            issues.append(.suspectedGarbled)
            blockers.append(.suspectedGarbled)
        }
        if lowPrintable {
            issues.append(.lowPrintableRatio)
            blockers.append(.lowPrintableRatio)
        }
        if pageOnly {
            issues.append(.pageNumberOrHeaderOnly)
            blockers.append(.pageNumberOrHeaderOnly)
        }
        if veryShort {
            issues.append(.veryShort)
            if tooShort { blockers.append(.veryShort) }
        }
        if lowAlphanumeric {
            issues.append(.lowAlphanumericRatio)
            blockers.append(.lowAlphanumericRatio)
        }

        return PDFTextQuality(
            characterCount: characterCount,
            alphanumericRatio: alphanumericRatio,
            printableRatio: printableRatio,
            suspectedGarbled: suspectedGarbled,
            pageNumberOrHeaderOnly: pageOnly,
            veryShort: veryShort,
            issues: issues,
            isUsable: blockers.isEmpty
        )
    }

    /// Compatibility convenience for the existing attachment ingestion seam.
    public static func isMeaningfulEmbeddedText(_ text: String) -> Bool {
        assessTextQuality(text).isUsable
    }

    private static func resolvedPageNumbers(_ requested: [Int]?, pageCount: Int) throws -> [Int] {
        guard let requested else { return Array(1...pageCount) }
        guard !requested.isEmpty else { throw PDFExtractionError.invalidPage(0) }
        let pages = Array(Set(requested)).sorted()
        for page in pages where page < 1 || page > pageCount {
            throw PDFExtractionError.invalidPage(page)
        }
        return pages
    }

    private static func checkCancellation(_ isCancelled: (() -> Bool)?) throws {
        if isCancelled?() == true { throw PDFExtractionError.cancelled }
    }

    private static func checkOCRDeadline(_ deadline: Date?) throws {
        if let deadline, Date() >= deadline {
            throw PDFExtractionError.ocrTimedOut
        }
    }

    private static func isPrintable(_ scalar: UnicodeScalar) -> Bool {
        scalar.value >= 0x20 && scalar.value != 0x7F
    }

    private static func isSuspiciousScalar(_ scalar: UnicodeScalar) -> Bool {
        switch scalar.value {
        case 0xFFFD,
             0xE000...0xF8FF,
             0xF0000...0xFFFFD,
             0x100000...0x10FFFD:
            return true
        default:
            return scalar.value < 0x20 && !scalar.properties.isWhitespace
        }
    }

    private static func isPageNumberOrHeaderOnly(
        _ text: String,
        characterCount: Int,
        letterCount: Int,
        numberCount: Int
    ) -> Bool {
        let compact = text
            .lowercased()
            .unicodeScalars
            .filter { !$0.properties.isWhitespace }
        guard !compact.isEmpty, compact.count <= 24 else { return false }
        let compactString = String(String.UnicodeScalarView(compact))
        let pageMarked = compactString.contains("page") || compactString.contains("页")
        if pageMarked {
            let residue = compactString
                .replacingOccurrences(of: "page", with: "")
                .replacingOccurrences(of: "of", with: "")
                .replacingOccurrences(of: "第", with: "")
                .replacingOccurrences(of: "页", with: "")
            let allowed = CharacterSet.decimalDigits.union(
                CharacterSet(charactersIn: "/-_—–:().")
            )
            return numberCount > 0 && numberCount <= 8 && residue.unicodeScalars.allSatisfy(allowed.contains)
        }

        // A standalone one-to-four digit counter is a page number. Six digits
        // remain valid per the previous implementation (often an identifier).
        let numericOnly = letterCount == 0 && numberCount > 0 && numberCount <= 4 && characterCount <= 8
        guard numericOnly else { return false }
        let allowed = CharacterSet.decimalDigits.union(CharacterSet(charactersIn: "/-_—–:()."))
        return compact.allSatisfy(allowed.contains)
    }

    /// Render at roughly 288 DPI (or the largest safe dimension) before Vision
    /// sees a page. This is a local intermediate and never becomes a model attachment.
    private static func render(page: PDFPage, pageNumber: Int) throws -> CGImage {
        let bounds = page.bounds(for: .mediaBox)
        guard bounds.width > 0, bounds.height > 0 else {
            throw PDFExtractionError.cannotRenderPage(pageNumber)
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
            throw PDFExtractionError.cannotRenderPage(pageNumber)
        }

        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.saveGState()
        // PDFPage and bitmap CGContext use Quartz's lower-left basis. Do not
        // apply an AppKit vertical flip or Vision would receive upside-down text.
        context.scaleBy(x: scale, y: scale)
        context.translateBy(x: -bounds.minX, y: -bounds.minY)
        page.draw(with: .mediaBox, to: context)
        context.restoreGState()

        guard let image = context.makeImage() else {
            throw PDFExtractionError.cannotRenderPage(pageNumber)
        }
        return image
    }

    private static func recognizeWithVision(_ image: CGImage) throws -> PDFOCRResult {
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
        return PDFOCRResult(text: text, confidence: confidence)
    }
}
