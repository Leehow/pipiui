import CoreGraphics

/// Resolves the root window layout into a size the UI can actually be drawn at.
///
/// The root view divides the proposed size by the UI scale and then pins itself
/// to that exact size. Anything degenerate on either side of that division —
/// a zero proposal during window restoration, a scale of 0 from a corrupt
/// `UserDefaults` value — produces a zero or NaN frame, and a zero-sized root is
/// indistinguishable from a blank window to the person looking at it.
///
/// Pure and `Equatable` so the白屏 conditions can be unit-tested without a window.
public struct RootLayoutMetrics: Equatable {
    /// Scale actually applied (clamped into the supported range).
    public let scale: CGFloat
    /// Size the content is laid out at before scaling.
    public let logicalSize: CGSize
    /// False when the resolved layout cannot show anything.
    public let isUsable: Bool

    /// Range the zoom commands allow; mirrors `AppStore.setUIScale`.
    public static let scaleRange: ClosedRange<CGFloat> = 0.6...1.8
    public static let fallbackScale: CGFloat = 1.0
    /// Smallest edge that can hold visible content.
    public static let minimumUsableEdge: CGFloat = 1

    public static func resolve(available: CGSize, uiScale: Double) -> RootLayoutMetrics {
        let scale = sanitizedScale(uiScale)
        let width = available.width / scale
        let height = available.height / scale
        let size = CGSize(width: width, height: height)
        return RootLayoutMetrics(scale: scale, logicalSize: size, isUsable: isUsable(size))
    }

    public static func sanitizedScale(_ uiScale: Double) -> CGFloat {
        let value = CGFloat(uiScale)
        guard value.isFinite, value > 0 else { return fallbackScale }
        return min(max(value, scaleRange.lowerBound), scaleRange.upperBound)
    }

    public static func isUsable(_ size: CGSize) -> Bool {
        size.width.isFinite && size.height.isFinite
            && size.width >= minimumUsableEdge && size.height >= minimumUsableEdge
    }

    /// One-line description for the log.
    public var logDescription: String {
        String(
            format: "logical=%.0fx%.0f scale=%.2f usable=%@",
            logicalSize.width, logicalSize.height, scale, isUsable ? "yes" : "no"
        )
    }
}
