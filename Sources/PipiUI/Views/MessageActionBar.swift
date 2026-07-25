import SwiftUI

/// Reserved hover strip: clear hit target always present; chrome fades in without layout jump.
/// Place *after* message content — ScrollView + row each `transcriptFlip()`, so flips cancel
/// and layout order matches on-screen order (bar under the message).
struct MessageActionSlot<Content: View>: View {
    var hovered: Bool
    var alignment: Alignment = .leading
    @ViewBuilder var content: () -> Content

    var body: some View {
        ZStack(alignment: alignment) {
            Color.clear
                .frame(height: 22)
                .frame(maxWidth: .infinity)
            content()
                .opacity(hovered ? 1 : 0)
                .allowsHitTesting(hovered)
                .animation(.easeOut(duration: 0.12), value: hovered)
        }
    }
}

/// Compact ghost icon row — Claude / ChatGPT style: no pill chrome, muted icons,
/// light hover wash only on the pressed control.
struct MessageActionBar: View {
    enum Alignment {
        case trailing
        case leading
    }

    var alignment: Alignment
    var showEdit: Bool = false
    var showResend: Bool = false
    var showBranch: Bool = false
    var onCopy: () -> Void
    var onResend: (() -> Void)? = nil
    var onEdit: (() -> Void)? = nil
    var onBranch: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 1) {
            iconButton("doc.on.doc", help: "复制", action: onCopy)
            if showResend, let onResend {
                iconButton("arrow.clockwise", help: "重发（撤回后重新发送）", action: onResend)
            }
            if showEdit, let onEdit {
                iconButton("square.and.pencil", help: "撤回修改", action: onEdit)
            }
            if showBranch, let onBranch {
                iconButton("arrow.triangle.branch", help: "创建分支会话", action: onBranch)
            }
        }
        .frame(
            maxWidth: .infinity,
            alignment: alignment == .trailing ? .trailing : .leading
        )
    }

    private func iconButton(
        _ systemName: String,
        help: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 11, weight: .regular))
                .frame(width: 22, height: 22)
                .contentShape(Rectangle())
        }
        .buttonStyle(MessageActionIconStyle())
        .help(help)
    }
}

/// Ghost control: secondary icon, 5pt rounded wash on hover/press (no permanent pill).
private struct MessageActionIconStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        MessageActionIconLabel(
            isPressed: configuration.isPressed,
            label: configuration.label
        )
    }
}

private struct MessageActionIconLabel<Label: View>: View {
    let isPressed: Bool
    let label: Label
    @State private var isHovered = false

    var body: some View {
        label
            .foregroundStyle(isPressed || isHovered ? Color.primary : Color.secondary)
            .background {
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(Color.primary.opacity(washOpacity))
            }
            .animation(.easeOut(duration: 0.1), value: isHovered)
            .animation(.easeOut(duration: 0.1), value: isPressed)
            .onHover { isHovered = $0 }
            .pointingHandCursor()
    }

    private var washOpacity: Double {
        if isPressed { return 0.12 }
        if isHovered { return 0.07 }
        return 0
    }
}
