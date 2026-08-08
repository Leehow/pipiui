import AppKit
import SwiftTerm
import SwiftUI

/// Right-panel embedded terminal: header styled like other panels (no close-x)
/// + session-cached SwiftTerm view that survives panel collapse/expand.
struct TerminalPanel: View {
    @ObservedObject var store: TerminalSessionStore
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            TerminalViewRepresentable(store: store)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color(nsColor: .textBackgroundColor))
        .onChange(of: colorScheme) { _, _ in
            store.applyAppearance()
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "terminal")
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 1) {
                Text(store.title)
                    .font(.callout.weight(.medium))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(headerSubtitle)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.head)
                    .textSelection(.enabled)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
    }

    private var headerSubtitle: String {
        let path = store.workingDirectory ?? store.projectURL.path
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
