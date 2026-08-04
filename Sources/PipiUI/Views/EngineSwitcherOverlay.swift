import SwiftUI

/// Centered engine picker shown over the transcript when a session is empty
/// (no messages yet). Picking an engine closes the current empty session and
/// opens a fresh empty session with the chosen engine — so the selection takes
/// effect before the user types. Hidden once the session has any real message.
///
/// Visual style mirrors `SessionLoadingView` (callout/secondary on the text
/// background color) so it reads as the same "panel center" surface. The picker
/// itself is a native macOS segmented control.
struct EngineSwitcherOverlay: View {
    @EnvironmentObject var store: AppStore
    @ObservedObject var session: ChatSession

    /// Only render when the session is genuinely empty and idle. A session with
    /// any non-local-only message (real user/assistant turn) hides the switcher
    /// so history is never discarded by an accidental engine change.
    private var shouldShow: Bool {
        let hasRealMessage = session.transcript.contains(where: { !$0.isLocalOnly })
        guard !hasRealMessage,
              session.streaming.streamingItem == nil,
              !session.isWorking,
              !session.isCompacting,
              !session.mediaBusy,
              !session.isInitializing else { return false }
        return true
    }

    /// Local selection state seeded from the session's engine. Keeping a local
    /// `@State` (rather than binding straight to a session field) lets the
    /// segmented control feel immediate while the actual swap (close + recreate
    /// session) happens in `onChange`.
    @State private var selection: EngineKind = .pi

    var body: some View {
        if shouldShow {
            ZStack {
                Color(nsColor: .textBackgroundColor)
                VStack(spacing: 12) {
                    Text("选择引擎")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    Picker("引擎", selection: binding) {
                        Text("pi").tag(EngineKind.pi)
                        Text("jcode").tag(EngineKind.jcode)
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 180)
                    Text(session.engineKind == .jcode
                         ? "jcode：agent 自带 swarm，编排交给引擎"
                         : "pi：PipiUI 主导编排（Boss/worker）")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("引擎选择：当前 \(session.engineKind.rawValue)")
            // Re-seed local selection whenever the displayed session changes
            // (e.g. after a switch rebuilds a new session object).
            .onAppear { selection = session.engineKind }
        }
    }

    /// Drive the segmented control from local `selection`, but only trigger the
    /// (destructive) session swap when the user actually moves off the current
    /// engine. Guards against re-entrancy and no-op changes.
    private var binding: Binding<EngineKind> {
        Binding(
            get: { selection },
            set: { newValue in
                selection = newValue
                guard newValue != session.engineKind else { return }
                store.switchEngine(for: session, to: newValue)
            }
        )
    }
}
