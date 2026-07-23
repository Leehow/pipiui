import SwiftUI

struct TypewriterText: View {
    let text: String
    /// Non-nil token means "play typewriter for this text" once per token identity.
    let animationToken: UUID?
    var charsPerSecond: Double = 28
    var font: Font = .body

    @State private var visibleCount = 0
    @State private var runningToken: UUID?
    /// Tokens that already finished typing — do not re-animate on List recycle / appear.
    @State private var completedToken: UUID?
    @State private var task: Task<Void, Never>?

    private var displayed: String {
        if animationToken == nil || animationToken == completedToken {
            return text
        }
        let n = min(visibleCount, text.count)
        guard n > 0 else { return "" }
        let idx = text.index(text.startIndex, offsetBy: n)
        return String(text[..<idx])
    }

    var body: some View {
        Text(displayed)
            .font(font)
            .lineLimit(1)
            .truncationMode(.tail)
            .onAppear { handleAppear() }
            .onChange(of: text) { _, _ in
                // Text changed under the same unfinished token — restart for new content.
                if let token = animationToken, token != completedToken {
                    startAnimation(token: token)
                } else {
                    visibleCount = text.count
                }
            }
            .onChange(of: animationToken) { _, newToken in
                handleTokenChange(newToken)
            }
            .onDisappear {
                task?.cancel()
                task = nil
            }
    }

    /// Appear / List recycle: never re-fire a completed (or nil) token.
    private func handleAppear() {
        guard let token = animationToken else {
            task?.cancel()
            task = nil
            runningToken = nil
            visibleCount = text.count
            return
        }
        if token == completedToken {
            task?.cancel()
            task = nil
            runningToken = nil
            visibleCount = text.count
            return
        }
        // Same unfinished token still running — leave it alone if already mid-animation.
        if runningToken == token, task != nil { return }
        startAnimation(token: token)
    }

    private func handleTokenChange(_ newToken: UUID?) {
        guard let token = newToken else {
            task?.cancel()
            task = nil
            runningToken = nil
            visibleCount = text.count
            return
        }
        if token == completedToken {
            visibleCount = text.count
            return
        }
        startAnimation(token: token)
    }

    private func startAnimation(token: UUID) {
        task?.cancel()
        runningToken = token
        visibleCount = 0
        let target = text
        let delayNs = UInt64(1_000_000_000 / max(charsPerSecond, 1))
        task = Task { @MainActor in
            let steps = max(target.count, 1)
            for i in 1...steps {
                if Task.isCancelled { return }
                visibleCount = min(i, target.count)
                if target.isEmpty { break }
                try? await Task.sleep(nanoseconds: delayNs)
            }
            guard !Task.isCancelled else { return }
            // Mark this token done so future appear/recycle shows full text.
            if runningToken == token {
                completedToken = token
                visibleCount = target.count
            }
        }
    }
}
