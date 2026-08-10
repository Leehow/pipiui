import AppKit
import SwiftTerm
import SwiftUI

/// Right-panel embedded terminal: multi-tab strip (each tab an independent PTY)
/// + session-cached SwiftTerm view that survives panel collapse/expand.
struct TerminalPanel: View {
    @ObservedObject var store: TerminalTabsStore
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(spacing: 0) {
            tabStrip
            Divider()
            header
            Divider()
            // 切 tab 时重建宿主，避免一个 representable 反复搬移多个 NSView。
            TerminalViewRepresentable(store: store.active)
                .id(store.selectedTabID ?? "")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color(nsColor: .textBackgroundColor))
        .onChange(of: colorScheme) { _, _ in
            store.active.applyAppearance()
        }
        .onChange(of: store.selectedTabID) { _, _ in
            store.active.applyAppearance()
        }
    }

    // MARK: - Tab strip

    private var tabStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(store.tabs) { tab in
                    PanelTabChip(
                        icon: "terminal",
                        title: store.displayTitle(for: tab),
                        isSelected: tab.id == store.selectedTabID,
                        onSelect: { store.select(id: tab.id) },
                        onClose: { store.closeTab(id: tab.id) }
                    )
                }
                Button {
                    store.open()
                } label: {
                    Image(systemName: "plus")
                        .frame(width: 22, height: 22)
                        .contentShape(Rectangle())
                        .help("新建终端")
                }
                .buttonStyle(HoverButtonStyle())
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: - Active session header

    private var header: some View {
        let active = store.active
        return HStack(spacing: 8) {
            Image(systemName: "terminal")
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 1) {
                Text(active.title)
                    .font(.callout.weight(.medium))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(headerSubtitle(for: active))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.head)
                    .textSelection(.enabled)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
    }

    private func headerSubtitle(for session: TerminalSessionStore) -> String {
        let path = session.workingDirectory ?? session.projectURL.path
        return (path as NSString).abbreviatingWithTildeInPath
    }
}

// MARK: - NSViewRepresentable

/// Reuses the session-owned `LocalProcessTerminalView` instance (CodeEdit pattern).
private struct TerminalViewRepresentable: NSViewRepresentable {
    @ObservedObject var store: TerminalSessionStore

    func makeNSView(context: Context) -> PipiLocalTerminalView {
        let view = store.ensureTerminalView()
        store.applyAppearance()
        return view
    }

    func updateNSView(_ nsView: PipiLocalTerminalView, context: Context) {
        // Colors refresh via TerminalPanel.onChange(of: colorScheme) → store.applyAppearance().
    }
}
