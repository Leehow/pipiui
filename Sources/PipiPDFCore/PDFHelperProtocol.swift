import Foundation

/// Stable stdin/stdout protocol for `pipiui-pdf-helper`.
/// The helper accepts local absolute paths only; the Pi extension owns bounded
/// HTTP(S) downloading and always removes its temporary download afterward.
public struct PDFHelperRequest: Codable, Equatable {
    public let path: String
    public let mode: PDFExtractionMode
    public let pages: [Int]?
    public let maxLength: Int?

    public init(
        path: String,
        mode: PDFExtractionMode = .auto,
        pages: [Int]? = nil,
        maxLength: Int? = nil
    ) {
        self.path = path
        self.mode = mode
        self.pages = pages
        self.maxLength = maxLength
    }

    enum CodingKeys: String, CodingKey {
        case path
        case mode
        case pages
        case maxLength = "max_length"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        path = try container.decode(String.self, forKey: .path)
        mode = try container.decodeIfPresent(PDFExtractionMode.self, forKey: .mode) ?? .auto
        pages = try container.decodeIfPresent([Int].self, forKey: .pages)
        maxLength = try container.decodeIfPresent(Int.self, forKey: .maxLength)
    }
}

public struct PDFHelperMetadata: Codable, Equatable {
    public let pageCount: Int
    public let selectedPages: [Int]
    public let textPages: [Int]
    public let ocrPages: [Int]
    public let warnings: [String]
    public let truncated: Bool

    public init(
        pageCount: Int,
        selectedPages: [Int],
        textPages: [Int],
        ocrPages: [Int],
        warnings: [String],
        truncated: Bool
    ) {
        self.pageCount = pageCount
        self.selectedPages = selectedPages
        self.textPages = textPages
        self.ocrPages = ocrPages
        self.warnings = warnings
        self.truncated = truncated
    }
}

public enum PDFHelperErrorCode: String, Codable, Equatable {
    case invalidRequest = "invalid_request"
    case invalidInput = "invalid_input"
    case inputTooLarge = "input_too_large"
    case invalidPDF = "invalid_pdf"
    case pageLimitExceeded = "page_limit_exceeded"
    case extractionFailed = "extraction_failed"
    case ocrTimedOut = "ocr_timed_out"
    case cancelled
    case internalError = "internal_error"
}

public struct PDFHelperErrorPayload: Codable, Equatable {
    public let code: PDFHelperErrorCode
    public let message: String

    public init(code: PDFHelperErrorCode, message: String) {
        self.code = code
        self.message = message
    }
}

public struct PDFHelperResponse: Codable, Equatable {
    public let ok: Bool
    public let markdown: String?
    public let metadata: PDFHelperMetadata?
    public let error: PDFHelperErrorPayload?

    public static func success(markdown: String, metadata: PDFHelperMetadata) -> PDFHelperResponse {
        PDFHelperResponse(ok: true, markdown: markdown, metadata: metadata, error: nil)
    }

    public static func failure(_ error: PDFHelperErrorPayload) -> PDFHelperResponse {
        PDFHelperResponse(ok: false, markdown: nil, metadata: nil, error: error)
    }
}

/// Exit codes are deliberately narrow and stable for callers that cannot parse
/// stderr. stdout still contains one JSON response for every ordinary failure.
public enum PDFHelperExitCode: Int32, Equatable {
    case success = 0
    case invalidRequest = 2
    case invalidInput = 3
    case extractionFailed = 4
    case timedOut = 5
    case cancelled = 130
    case internalError = 70
}

public struct PDFHelperCommandResult {
    public let stdout: Data
    public let stderr: String
    public let exitCode: PDFHelperExitCode

    public init(stdout: Data, stderr: String, exitCode: PDFHelperExitCode) {
        self.stdout = stdout
        self.stderr = stderr
        self.exitCode = exitCode
    }
}

public enum PDFHelperServiceError: Error, LocalizedError, Equatable {
    case invalidRequest(String)
    case invalidInput(String)
    case invalidPDF(String)
    case inputTooLarge(limit: Int64)

    public var errorDescription: String? {
        switch self {
        case let .invalidRequest(message), let .invalidInput(message), let .invalidPDF(message):
            return message
        case let .inputTooLarge(limit):
            return "PDF exceeds the \(limit / (1024 * 1024)) MB input limit."
        }
    }
}

/// Shared implementation beneath the CLI, kept in the core target so protocol
/// tests can prove output purity without spawning a shell process.
public enum PDFHelperService {
    public static let maximumInputBytes: Int64 = 50 * 1024 * 1024
    public static let maximumPageCount = 300
    public static let defaultMaxLength = 20_000
    public static let maximumMaxLength = 100_000
    public static let defaultOCRTimeout: TimeInterval = 120

    public static func extract(
        request: PDFHelperRequest,
        recognize: PDFOCRRecognizer? = nil,
        isCancelled: (() -> Bool)? = nil
    ) throws -> PDFHelperResponse {
        let sourceURL = try validatedLocalPDFURL(path: request.path)
        let maxLength = try validatedMaximumLength(request.maxLength)
        if let pages = request.pages {
            guard !pages.isEmpty else {
                throw PDFHelperServiceError.invalidRequest("pages must contain at least one positive page number.")
            }
            guard pages.allSatisfy({ $0 > 0 }) else {
                throw PDFHelperServiceError.invalidRequest("pages must contain only positive page numbers.")
            }
        }

        let result = try PDFExtractionCore.extract(
            sourceURL: sourceURL,
            options: PDFExtractionOptions(
                mode: request.mode,
                pages: request.pages,
                maximumPageCount: maximumPageCount,
                ocrDeadline: Date().addingTimeInterval(defaultOCRTimeout)
            ),
            recognize: recognize,
            isCancelled: isCancelled
        )
        let provisionalMetadata = PDFHelperMetadata(
            pageCount: result.diagnostics.pageCount,
            selectedPages: result.diagnostics.selectedPages,
            textPages: result.diagnostics.textPages,
            ocrPages: result.diagnostics.ocrPages,
            warnings: result.diagnostics.warnings,
            truncated: false
        )
        let initial = truncateMarkdown(
            markdown(for: result, metadata: provisionalMetadata),
            maximumLength: maxLength
        )
        let metadata = PDFHelperMetadata(
            pageCount: provisionalMetadata.pageCount,
            selectedPages: provisionalMetadata.selectedPages,
            textPages: provisionalMetadata.textPages,
            ocrPages: provisionalMetadata.ocrPages,
            warnings: provisionalMetadata.warnings,
            truncated: initial.truncated
        )
        let markdown = initial.truncated
            ? truncateMarkdown(markdown(for: result, metadata: metadata), maximumLength: maxLength).text
            : initial.text
        return .success(markdown: markdown, metadata: metadata)
    }

    private static func validatedMaximumLength(_ requested: Int?) throws -> Int {
        let value = requested ?? defaultMaxLength
        guard value >= 1, value <= maximumMaxLength else {
            throw PDFHelperServiceError.invalidRequest(
                "max_length must be between 1 and \(maximumMaxLength)."
            )
        }
        return value
    }

    private static func validatedLocalPDFURL(path: String) throws -> URL {
        let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw PDFHelperServiceError.invalidRequest("path is required.")
        }
        guard (trimmed as NSString).isAbsolutePath else {
            throw PDFHelperServiceError.invalidInput("path must be an absolute local path; download HTTP(S) PDFs with fetch_content before supplying a local path.")
        }

        let sourceURL = URL(fileURLWithPath: trimmed)
            .standardizedFileURL
            .resolvingSymlinksInPath()
        let values: URLResourceValues
        do {
            values = try sourceURL.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        } catch {
            throw PDFHelperServiceError.invalidInput("PDF path does not exist or cannot be read.")
        }
        guard values.isRegularFile == true else {
            throw PDFHelperServiceError.invalidInput("PDF path must name a regular file.")
        }
        let size = Int64(values.fileSize ?? 0)
        guard size > 0 else {
            throw PDFHelperServiceError.invalidInput("PDF file is empty.")
        }
        guard size <= maximumInputBytes else {
            throw PDFHelperServiceError.inputTooLarge(limit: maximumInputBytes)
        }

        let header: Data
        do {
            let handle = try FileHandle(forReadingFrom: sourceURL)
            defer { try? handle.close() }
            header = try handle.read(upToCount: 5) ?? Data()
        } catch {
            throw PDFHelperServiceError.invalidInput("PDF path cannot be read.")
        }
        guard header == Data("%PDF-".utf8) else {
            throw PDFHelperServiceError.invalidPDF("Input does not start with the %PDF- signature.")
        }
        return sourceURL
    }

    private static func markdown(for result: PDFExtractionResult, metadata: PDFHelperMetadata) -> String {
        var lines = [
            "# PDF extraction",
            "",
            "<!-- pdf_metadata",
            "pageCount: \(metadata.pageCount)",
            "selectedPages: \(metadata.selectedPages)",
            "textPages: \(metadata.textPages)",
            "ocrPages: \(metadata.ocrPages)",
            "warnings: \(metadata.warnings)",
            "truncated: \(metadata.truncated)",
            "-->",
            "",
            "> Text is extracted page by page. Complex tables, formulas, charts, and layout are not reconstructed; the original PDF remains the visual source of truth.",
        ]
        for page in result.pages {
            lines += [
                "",
                "## Page \(page.number)",
                "",
                "<!-- extraction: \(page.origin.rawValue) -->",
                "",
            ]
            if page.text.isEmpty {
                lines.append("> No usable text was recognized on this page. Inspect the original PDF for its visual content.")
            } else {
                lines.append(page.text)
            }
        }
        return lines.joined(separator: "\n") + "\n"
    }

    private static func truncateMarkdown(_ text: String, maximumLength: Int) -> (text: String, truncated: Bool) {
        guard text.count > maximumLength else { return (text, false) }
        let marker = "\n\n[truncated]"
        guard maximumLength > marker.count else {
            return (String(text.prefix(maximumLength)), true)
        }
        let limit = maximumLength - marker.count
        var prefix = String(text.prefix(limit))
        if let newline = prefix.lastIndex(of: "\n"),
           prefix.distance(from: prefix.startIndex, to: newline) > limit * 3 / 4 {
            prefix = String(prefix[..<newline])
        }
        if prefix.count > limit {
            prefix = String(prefix.prefix(limit))
        }
        return (prefix + marker, true)
    }
}

public enum PDFHelperCommand {
    /// Produces exactly one JSON document for stdout. Diagnostics are returned
    /// separately so the executable can keep stdout parseable for Node callers.
    public static func execute(inputData: Data) -> PDFHelperCommandResult {
        let request: PDFHelperRequest
        do {
            request = try JSONDecoder().decode(PDFHelperRequest.self, from: inputData)
        } catch {
            return failure(
                code: .invalidRequest,
                message: "Request must be a JSON object with an absolute local path.",
                exitCode: .invalidRequest
            )
        }

        do {
            let response = try PDFHelperService.extract(request: request)
            return encoded(response: response, stderr: "", exitCode: .success)
        } catch {
            let mapped = map(error)
            return failure(code: mapped.code, message: mapped.message, exitCode: mapped.exitCode)
        }
    }

    private static func map(_ error: Error) -> (code: PDFHelperErrorCode, message: String, exitCode: PDFHelperExitCode) {
        if let error = error as? PDFHelperServiceError {
            switch error {
            case .invalidRequest:
                return (.invalidRequest, error.localizedDescription, .invalidRequest)
            case .invalidInput:
                return (.invalidInput, error.localizedDescription, .invalidInput)
            case .invalidPDF:
                return (.invalidPDF, error.localizedDescription, .invalidInput)
            case .inputTooLarge:
                return (.inputTooLarge, error.localizedDescription, .invalidInput)
            }
        }
        if let error = error as? PDFExtractionError {
            switch error {
            case .invalidPDF:
                return (.invalidPDF, error.localizedDescription, .invalidInput)
            case .noPages:
                return (.invalidPDF, error.localizedDescription, .invalidInput)
            case .pageLimitExceeded:
                return (.pageLimitExceeded, error.localizedDescription, .invalidInput)
            case .invalidPage:
                return (.invalidRequest, error.localizedDescription, .invalidRequest)
            case .cancelled:
                return (.cancelled, error.localizedDescription, .cancelled)
            case .ocrTimedOut:
                return (.ocrTimedOut, error.localizedDescription, .timedOut)
            case .missingPage, .cannotRenderPage, .recognitionFailed:
                return (.extractionFailed, error.localizedDescription, .extractionFailed)
            }
        }
        return (.internalError, "Unexpected local PDF helper failure.", .internalError)
    }

    private static func failure(
        code: PDFHelperErrorCode,
        message: String,
        exitCode: PDFHelperExitCode
    ) -> PDFHelperCommandResult {
        encoded(
            response: .failure(PDFHelperErrorPayload(code: code, message: message)),
            stderr: "pipiui-pdf-helper: \(message)\n",
            exitCode: exitCode
        )
    }

    private static func encoded(
        response: PDFHelperResponse,
        stderr: String,
        exitCode: PDFHelperExitCode
    ) -> PDFHelperCommandResult {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let stdout = try? encoder.encode(response) else {
            return PDFHelperCommandResult(
                stdout: Data(#"{"error":{"code":"internal_error","message":"Unable to encode helper response."},"ok":false}"#.utf8),
                stderr: "pipiui-pdf-helper: Unable to encode helper response.\n",
                exitCode: .internalError
            )
        }
        return PDFHelperCommandResult(stdout: stdout, stderr: stderr, exitCode: exitCode)
    }
}
