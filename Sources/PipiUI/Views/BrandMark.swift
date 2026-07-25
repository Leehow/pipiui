import SwiftUI

/// Wordmark only: `Pip` + cyan second `i` + ` UI` (no icon — keeps the mark uncluttered).
struct BrandMark: View {
    enum Size {
        case sidebar
        case hero

        var font: Font {
            switch self {
            case .sidebar: return .title3.weight(.semibold)
            case .hero: return .title.weight(.semibold)
            }
        }

        var tracking: CGFloat {
            switch self {
            case .sidebar: return -0.3
            case .hero: return -0.4
            }
        }
    }

    var size: Size = .sidebar

    var body: some View {
        HStack(spacing: 0) {
            Text("Pip")
            Text("i")
                .foregroundStyle(Color.cyan)
            Text(" UI")
        }
        .font(size.font)
        .tracking(size.tracking)
        .foregroundStyle(.primary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Pipi UI")
    }
}
