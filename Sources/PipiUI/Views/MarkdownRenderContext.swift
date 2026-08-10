import AppKit
import Foundation

/// Rendering policy for the shared Markdown AST/TextKit pipeline.
///
/// Chat remains the compatibility default. Documents opt into a reader-oriented visual
/// treatment plus a local-resource base URL, without creating a second parser or a second
/// selection host.
struct MarkdownRenderContext: Equatable {
    enum Surface: Equatable {
        case chat
        case document
    }

    let surface: Surface
    /// The source file being rendered, when this is a document reader.
    let documentURL: URL?
    /// Directory against which relative Markdown links and images resolve.
    let baseURL: URL?

    static let chat = MarkdownRenderContext(
        surface: .chat,
        documentURL: nil,
        baseURL: nil
    )

    static func document(documentURL: URL, baseURL: URL? = nil) -> Self {
        let normalizedDocumentURL = documentURL.isFileURL
            ? documentURL.standardizedFileURL
            : documentURL
        let defaultBaseURL = normalizedDocumentURL.deletingLastPathComponent()
        let resolvedBaseURL = baseURL ?? defaultBaseURL
        let normalizedBaseURL = resolvedBaseURL.isFileURL
            ? URL(fileURLWithPath: resolvedBaseURL.path, isDirectory: true).standardizedFileURL
            : resolvedBaseURL
        return Self(
            surface: .document,
            documentURL: normalizedDocumentURL,
            baseURL: normalizedBaseURL
        )
    }

    var isDocument: Bool {
        surface == .document
    }

    static let documentReaderMaximumMeasure: CGFloat = 760
    static let documentReaderHorizontalInset: CGFloat = 24
    static let documentReaderVerticalInset: CGFloat = 26
}

/// Concrete AppKit metrics for a Markdown surface. Chat values intentionally map one-for-one
/// to `ChatTypography`; document values are reader-oriented while still following the user's
/// configured text size.
struct MarkdownRenderStyle {
    let typography: ChatTypography
    let context: MarkdownRenderContext

    init(typography: ChatTypography, context: MarkdownRenderContext) {
        self.typography = typography
        self.context = context
    }

    var isDocument: Bool {
        context.isDocument
    }

    var fontSize: CGFloat {
        guard isDocument else { return typography.fontSize }
        return min(23, max(16, typography.fontSize))
    }

    var bodyNSFont: NSFont {
        guard isDocument else { return typography.bodyNSFont }
        return NSFont.systemFont(ofSize: fontSize)
    }

    var codeNSFont: NSFont {
        guard isDocument else { return typography.codeNSFont }
        return NSFont.monospacedSystemFont(ofSize: max(12, fontSize - 1), weight: .regular)
    }

    func headingNSFont(level: Int) -> NSFont {
        guard isDocument else { return typography.headingNSFont(level: level) }
        switch level {
        case 1:
            return NSFont.systemFont(ofSize: fontSize + 13, weight: .bold)
        case 2:
            return NSFont.systemFont(ofSize: fontSize + 8, weight: .bold)
        case 3:
            return NSFont.systemFont(ofSize: fontSize + 5, weight: .semibold)
        case 4:
            return NSFont.systemFont(ofSize: fontSize + 3, weight: .semibold)
        case 5:
            return NSFont.systemFont(ofSize: fontSize + 1, weight: .semibold)
        default:
            return NSFont.systemFont(ofSize: fontSize, weight: .semibold)
        }
    }

    var lineSpacing: CGFloat {
        isDocument ? max(5, fontSize * 0.42) : typography.lineSpacing
    }

    var paragraphSpacing: CGFloat {
        isDocument ? max(10, fontSize * 0.62) : typography.paragraphSpacing
    }

    var listItemSpacing: CGFloat {
        isDocument ? max(7, fontSize * 0.38) : typography.listItemSpacing
    }

    var headingLineSpacing: CGFloat {
        isDocument ? max(1, fontSize * 0.1) : typography.headingLineSpacing
    }

    var blockSpacing: CGFloat {
        isDocument ? max(18, fontSize * 1.35) : typography.blockSpacing
    }

    var codeBackground: NSColor {
        NSColor.labelColor.withAlphaComponent(isDocument ? 0.09 : 0.065)
    }

    var monoBackground: NSColor {
        NSColor.labelColor.withAlphaComponent(isDocument ? 0.08 : 0.06)
    }

    var quoteBackground: NSColor {
        NSColor.controlAccentColor.withAlphaComponent(isDocument ? 0.105 : 0.075)
    }

    var tableFont: NSFont {
        guard isDocument else { return bodyNSFont }
        return NSFont.monospacedSystemFont(ofSize: max(11, fontSize - 0.5), weight: .regular)
    }
}

/// Safe document-mode resource resolution. Chat deliberately keeps its historical raw-link
/// behavior; only documents receive a base URL and external-scheme filtering.
enum MarkdownDocumentResourceResolver {
    enum Target: Equatable {
        case local(URL)
        case external(URL)

        var url: URL {
            switch self {
            case .local(let url), .external(let url):
                return url
            }
        }
    }

    enum LinkAction: Equatable {
        case openDocument(URL)
        case revealInFinder(URL)
        case openExternal(URL)
        case blocked
    }

    static let allowedExternalSchemes: Set<String> = ["http", "https", "mailto"]

    /// Resolve a Markdown destination only for document rendering. Relative paths stay local
    /// to the source document's directory; protocol-relative and unapproved schemes are denied.
    static func target(
        for destination: String?,
        context: MarkdownRenderContext
    ) -> Target? {
        guard context.isDocument,
              let rawDestination = destination?.trimmingCharacters(in: .whitespacesAndNewlines),
              !rawDestination.isEmpty,
              !rawDestination.hasPrefix("//") else {
            return nil
        }

        if rawDestination.hasPrefix("/") {
            return .local(URL(fileURLWithPath: decodedPath(rawDestination)).standardizedFileURL)
        }

        if let absolute = absoluteURL(from: rawDestination), let scheme = absolute.scheme?.lowercased() {
            guard allowedExternalSchemes.contains(scheme) else { return nil }
            switch scheme {
            case "file":
                guard absolute.isFileURL, !absolute.path.isEmpty else { return nil }
                return .local(URL(fileURLWithPath: absolute.path).standardizedFileURL)
            case "http", "https":
                guard absolute.host != nil else { return nil }
                return .external(absolute)
            case "mailto":
                guard !absolute.path.isEmpty else { return nil }
                return .external(absolute)
            default:
                return nil
            }
        }

        guard let baseURL = context.baseURL,
              let resolved = relativeURL(rawDestination, relativeTo: baseURL),
              resolved.isFileURL else {
            return nil
        }
        return .local(URL(fileURLWithPath: resolved.path).standardizedFileURL)
    }

    static func localImageURL(
        for source: String?,
        context: MarkdownRenderContext
    ) -> URL? {
        guard case .local(let url)? = target(for: source, context: context), url.isFileURL else {
            return nil
        }
        return url
    }

    /// Route a resolved document-mode link through the existing document/Finder policy.
    static func linkAction(for url: URL) -> LinkAction {
        if url.isFileURL {
            // Drop query/fragment before filesystem policy and tab de-duplication.
            let localURL = URL(fileURLWithPath: url.path).standardizedFileURL
            return DocumentDetector.isDocument(localURL)
                ? .openDocument(localURL)
                : .revealInFinder(localURL)
        }

        guard let scheme = url.scheme?.lowercased(),
              allowedExternalSchemes.contains(scheme) else {
            return .blocked
        }
        switch scheme {
        case "http", "https":
            return url.host == nil ? .blocked : .openExternal(url)
        case "mailto":
            return url.path.isEmpty ? .blocked : .openExternal(url)
        default:
            return .blocked
        }
    }

    private static func absoluteURL(from raw: String) -> URL? {
        if let url = URL(string: raw), url.scheme != nil {
            return url
        }
        guard let encoded = raw.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed),
              let url = URL(string: encoded),
              url.scheme != nil else {
            return nil
        }
        return url
    }

    private static func relativeURL(_ raw: String, relativeTo baseURL: URL) -> URL? {
        if let url = URL(string: raw, relativeTo: baseURL)?.absoluteURL {
            return url
        }
        guard let encoded = raw.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed) else {
            return nil
        }
        return URL(string: encoded, relativeTo: baseURL)?.absoluteURL
    }

    private static func decodedPath(_ raw: String) -> String {
        raw.removingPercentEncoding ?? raw
    }
}

/// A local document image stays inside the single NSTextView as a normal TextKit attachment.
/// It never performs network I/O, and invalid/missing assets fall back to linked alt text.
final class MarkdownDocumentImageAttachment: NSTextAttachment {
    private static let absoluteMaximumWidth: CGFloat = 560
    private static let absoluteMaximumHeight: CGFloat = 440

    let sourceURL: URL
    private let naturalSize: NSSize

    init?(sourceURL: URL) {
        guard sourceURL.isFileURL,
              let image = NSImage(contentsOf: sourceURL),
              image.size.width.isFinite,
              image.size.height.isFinite,
              image.size.width > 0,
              image.size.height > 0 else {
            return nil
        }
        self.sourceURL = sourceURL
        self.naturalSize = image.size
        super.init(data: nil, ofType: nil)
        self.image = image
        _ = resize(toMaximumWidth: Self.absoluteMaximumWidth)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    @discardableResult
    func resize(toMaximumWidth availableWidth: CGFloat) -> Bool {
        let maximumWidth = min(Self.absoluteMaximumWidth, max(1, availableWidth))
        let scale = min(
            1,
            maximumWidth / naturalSize.width,
            Self.absoluteMaximumHeight / naturalSize.height
        )
        let target = NSSize(
            width: max(1, (naturalSize.width * scale).rounded(.down)),
            height: max(1, (naturalSize.height * scale).rounded(.down))
        )
        guard bounds.size != target else { return false }
        bounds = NSRect(origin: .zero, size: target)
        return true
    }
}

enum MarkdownDocumentImageAttachments {
    static func contains(in attributed: NSAttributedString?) -> Bool {
        guard let attributed, attributed.length > 0 else { return false }
        var found = false
        attributed.enumerateAttribute(
            .attachment,
            in: NSRange(location: 0, length: attributed.length)
        ) { value, _, stop in
            if value is MarkdownDocumentImageAttachment {
                found = true
                stop.pointee = true
            }
        }
        return found
    }

    @discardableResult
    static func resize(in attributed: NSAttributedString?, maximumWidth: CGFloat) -> Bool {
        guard let attributed, attributed.length > 0 else { return false }
        var changed = false
        attributed.enumerateAttribute(
            .attachment,
            in: NSRange(location: 0, length: attributed.length)
        ) { value, _, _ in
            if let attachment = value as? MarkdownDocumentImageAttachment,
               attachment.resize(toMaximumWidth: maximumWidth) {
                changed = true
            }
        }
        return changed
    }
}
