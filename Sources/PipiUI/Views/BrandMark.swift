import AppKit
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

        /// Icon side length in points (sidebar ~22–24, hero ~40–48).
        var iconPoints: CGFloat {
            switch self {
            case .sidebar: return 22
            case .hero: return 44
            }
        }

        var spacing: CGFloat {
            switch self {
            case .sidebar: return 6
            case .hero: return 10
            }
        }
    }

    var size: Size = .sidebar

    private static let logoImage: NSImage? = {
        guard let url = Bundle.module.url(forResource: "brand-logo", withExtension: "png") else {
            return nil
        }
        return NSImage(contentsOf: url)
    }()

    var body: some View {
        HStack(spacing: size.spacing) {
            if let logo = Self.logoImage {
                Image(nsImage: logo)
                    .resizable()
                    .scaledToFit()
                    .frame(width: size.iconPoints, height: size.iconPoints)
                    .accessibilityHidden(true)
            }

            HStack(spacing: 0) {
                Text("Pip")
                Text("i")
                    .foregroundStyle(Color.cyan)
                Text(" UI")
            }
            .font(size.font)
            .foregroundStyle(.primary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Pipi UI")
    }
}
