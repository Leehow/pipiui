import AppKit
import CoreGraphics
import SwiftUI

/// Chat-body typography tokens. Only `fontSize` is persisted; spacing is derived.
struct ChatTypography: Equatable {
    var fontSize: CGFloat
    var lineSpacing: CGFloat
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
        let lineSpacing = fontSize * 0.3
        let messageSpacing = min(
            28,
            max(16, 18 + (fontSize - 13) * 2)
        )
        let blockSpacing = max(8, (fontSize * 0.65).rounded())
        return ChatTypography(
            fontSize: fontSize,
            lineSpacing: lineSpacing,
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
