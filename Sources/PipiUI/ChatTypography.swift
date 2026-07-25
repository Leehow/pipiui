import AppKit
import CoreGraphics
import SwiftUI

/// Chat-body typography tokens. Only `fontSize` is persisted; spacing is derived.
///
/// Rhythm targets (CJK-heavy assistant replies):
/// - body line-height ≈ 1.75× (SF natural ~1.2× + `lineSpacing`)
/// - list / hard-break gaps via `paragraphSpacing` / `listItemSpacing`
/// - markdown block gaps via `blockSpacing` (NSTextView separator line height)
struct ChatTypography: Equatable {
    var fontSize: CGFloat
    /// Extra leading for AppKit/SwiftUI (`lineSpacing`), atop ~1.2× natural.
    var lineSpacing: CGFloat
    /// Soft paragraph / hard-break gap inside prose blocks.
    var paragraphSpacing: CGFloat
    /// Gap between markdown list items (separate NS paragraphs).
    var listItemSpacing: CGFloat
    /// Tighter extra leading for headings (~1.25× total).
    var headingLineSpacing: CGFloat
    var messageSpacing: CGFloat
    var blockSpacing: CGFloat

    static let defaultFontSize: CGFloat = 15
    static let fontSizeRange: ClosedRange<CGFloat> = 12...22

    static func sanitizedFontSize(_ raw: CGFloat) -> CGFloat {
        guard raw.isFinite, raw > 0 else { return defaultFontSize }
        let rounded = raw.rounded()
        return min(max(rounded, fontSizeRange.lowerBound), fontSizeRange.upperBound)
    }

    static func make(fontSize raw: CGFloat) -> ChatTypography {
        let fontSize = sanitizedFontSize(raw)
        let lineSpacing = fontSize * 0.55
        let paragraphSpacing = max(6, (fontSize * 0.4).rounded())
        let listItemSpacing = max(4, (fontSize * 0.3).rounded())
        let headingLineSpacing = fontSize * 0.15
        let messageSpacing = min(
            28,
            max(16, 18 + (fontSize - 13) * 2)
        )
        let blockSpacing = max(12, fontSize.rounded())
        return ChatTypography(
            fontSize: fontSize,
            lineSpacing: lineSpacing,
            paragraphSpacing: paragraphSpacing,
            listItemSpacing: listItemSpacing,
            headingLineSpacing: headingLineSpacing,
            messageSpacing: messageSpacing,
            blockSpacing: blockSpacing
        )
    }

    /// Body NSFont for PathLinkedText / hit testing.
    var bodyNSFont: NSFont {
        NSFont.systemFont(ofSize: fontSize)
    }

    /// Monospaced code roughly one step below body.
    var codeNSFont: NSFont {
        NSFont.monospacedSystemFont(ofSize: max(11, fontSize - 1), weight: .regular)
    }

    func headingNSFont(level: Int) -> NSFont {
        switch level {
        case 1:
            return NSFont.systemFont(ofSize: fontSize + 5, weight: .bold)
        case 2:
            return NSFont.systemFont(ofSize: fontSize + 3, weight: .semibold)
        case 3:
            return NSFont.systemFont(ofSize: fontSize + 1, weight: .semibold)
        default:
            return NSFont.systemFont(ofSize: fontSize, weight: .semibold)
        }
    }
}

private struct ChatTypographyKey: EnvironmentKey {
    static let defaultValue = ChatTypography.make(fontSize: ChatTypography.defaultFontSize)
}

extension EnvironmentValues {
    var chatTypography: ChatTypography {
        get { self[ChatTypographyKey.self] }
        set { self[ChatTypographyKey.self] = newValue }
    }
}
