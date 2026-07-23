import SwiftUI

struct BrandMark: View {
    enum Size {
        case sidebar
        case hero
        var font: Font {
            switch self {
            case .sidebar: return .title3.weight(.semibold)
            case .hero: return .title2.weight(.semibold)
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
        .foregroundStyle(.primary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Pipi UI")
    }
}
