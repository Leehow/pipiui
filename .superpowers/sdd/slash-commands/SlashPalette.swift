import SwiftUI

struct SlashPalette: View {
    let commands: [SlashCommand]
    let selectedIndex: Int
    let onSelect: (SlashCommand) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(commands.enumerated()), id: \.element.id) { index, cmd in
                        row(cmd, selected: index == selectedIndex)
                            .id(cmd.id)
                            .contentShape(Rectangle())
                            .onTapGesture { onSelect(cmd) }
                    }
                }
                .padding(6)
            }
            .frame(maxHeight: 220)
            .onChange(of: selectedIndex) { _, idx in
                guard commands.indices.contains(idx) else { return }
                withAnimation(.easeOut(duration: 0.1)) {
                    proxy.scrollTo(commands[idx].id, anchor: .center)
                }
            }
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.08))
        )
        .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
    }

    private func row(_ cmd: SlashCommand, selected: Bool) -> some View {
        HStack(spacing: 8) {
            Text("/\(cmd.name)")
                .font(.system(.body, design: .monospaced).weight(.medium))
                .lineLimit(1)
            if let hint = cmd.argumentHint, !hint.isEmpty {
                Text(hint)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }
            if let desc = cmd.description, !desc.isEmpty {
                Text(desc)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(badgeText(cmd.source))
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Capsule().fill(Color.primary.opacity(0.08)))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(selected ? Color.accentColor.opacity(0.14) : Color.clear)
        )
    }

    private func badgeText(_ source: SlashSource) -> String {
        switch source {
        case .builtin: return "builtin"
        case .extension_: return "ext"
        case .prompt: return "prompt"
        case .skill: return "skill"
        }
    }
}
