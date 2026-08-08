import AppKit
import SwiftUI

/// Plain button whose label foreground shifts on hover/press.
struct HoverButtonStyle: ButtonStyle {
    var base: Color = .secondary
    var hovered: Color = .primary

    func makeBody(configuration: Configuration) -> some View {
        HoverForeground(base: base, hovered: hovered, isPressed: configuration.isPressed) {
            configuration.label
        }
    }
}

/// Flat ~28pt chrome icon button: subtle hover/press fill, max 6pt corners.
/// Used by top-trailing collapse/expand so it is not a floating blue pill.
struct ChromeIconButtonStyle: ButtonStyle {
    var isEmphasized: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        ChromeIconButtonBody(
            isEmphasized: isEmphasized,
            isPressed: configuration.isPressed,
            label: configuration.label
        )
    }
}

private struct ChromeIconButtonBody<Label: View>: View {
    let isEmphasized: Bool
    let isPressed: Bool
    let label: Label
    @State private var isHovered = false

    var body: some View {
        label
            .background {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(fillColor)
            }
            .animation(.easeInOut(duration: 0.12), value: isHovered)
            .animation(.easeInOut(duration: 0.08), value: isPressed)
            .onHover { isHovered = $0 }
            .pointingHandCursor()
    }

    private var fillColor: Color {
        if isPressed {
            return Color.primary.opacity(0.10)
        }
        if isHovered {
            return Color.primary.opacity(0.06)
        }
        if isEmphasized {
            return Color.accentColor.opacity(0.10)
        }
        return .clear
    }
}

struct HoverForeground<Content: View>: View {
    let base: Color
    let hovered: Color
    let isPressed: Bool
    @ViewBuilder var content: () -> Content
    @State private var isHovered = false

    var body: some View {
        content()
            .foregroundStyle(isPressed || isHovered ? hovered : base)
            .animation(.easeInOut(duration: 0.12), value: isHovered)
            .onHover { isHovered = $0 }
            .pointingHandCursor()
    }
}

/// Subtle list-row hover background for tappable non-Button rows.
struct HoverRowBackground: ViewModifier {
    @State private var isHovered = false
    var cornerRadius: CGFloat = 6

    func body(content: Content) -> some View {
        content
            .background {
                RoundedRectangle(cornerRadius: cornerRadius)
                    .fill(Color.primary.opacity(isHovered ? 0.06 : 0))
            }
            .onHover { isHovered = $0 }
            .animation(.easeInOut(duration: 0.12), value: isHovered)
    }
}

/// Shows the pointing-hand cursor while the pointer is over a tappable region.
struct PointingHandCursor: ViewModifier {
    var enabled: Bool = true

    func body(content: Content) -> some View {
        content.onHover { hovering in
            guard enabled else { return }
            if hovering {
                NSCursor.pointingHand.push()
            } else {
                NSCursor.pop()
            }
        }
    }
}

extension View {
    func hoverRowBackground(cornerRadius: CGFloat = 6) -> some View {
        modifier(HoverRowBackground(cornerRadius: cornerRadius))
    }

    func pointingHandCursor(_ enabled: Bool = true) -> some View {
        modifier(PointingHandCursor(enabled: enabled))
    }
}
