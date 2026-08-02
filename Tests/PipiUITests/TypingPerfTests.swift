import XCTest
import AppKit
import SwiftUI
import Combine
@testable import PipiUI

/// Opt-in, main-thread measurements for the real AppKit composer and ChatSession stream path.
/// Run with: PIPIUI_RUN_TYPING_PERF=1 swift test --filter TypingPerfTests
@MainActor
final class TypingPerfTests: XCTestCase {
    private let iterations = 150

    func testTypingPerfReport() throws {
        guard ProcessInfo.processInfo.environment["PIPIUI_RUN_TYPING_PERF"] == "1" else {
            throw XCTSkip("Opt-in benchmark. Run PIPIUI_RUN_TYPING_PERF=1 swift test --filter TypingPerfTests")
        }

        let baselineEnglish = measureEnglish(iterations: iterations)
        let baselineIME = measureIME(iterations: iterations)
        let layout = measureDirtyLayout(iterations: iterations)
        let placeholder = measurePlaceholder(iterations: iterations)
        let draftPublish = measureDraftPublication(iterations: iterations)
        let conversion = measureStreamConversion(iterations: iterations)
        let loaded = runStreamingLoad(iterations: iterations)

        XCTAssertEqual(loaded.visible.streamingItem.map(ChatSession.plainText(of:)), longMarkdown)
        XCTAssertNil(loaded.hidden.first?.streamingItem, "hidden sessions must not convert on their 50 ms gate")
        XCTAssertEqual(loaded.draftSession.draftText.count, iterations * 2)
        XCTAssertGreaterThanOrEqual(loaded.hiddenLineSamples.count, iterations * 3)

        let rows: [(String, [Double])] = [
            ("baseline composer / English insertText + didChangeText", baselineEnglish),
            ("baseline composer / IME setMarkedText + commit", baselineIME),
            ("stream load / English insertText + didChangeText", loaded.english),
            ("stream load / IME setMarkedText + commit", loaded.ime),
            ("ComposerDraftState publish (one Combine subscriber)", draftPublish),
            ("ComposerTextViewHost.refreshLayout (dirty TextKit layout)", layout),
            ("ComposerTextViewHost.updatePlaceholder", placeholder),
            ("ChatSession.convert(long markdown)", conversion),
            ("hidden message_update handleEvent per JSONL line", loaded.hiddenLineSamples),
        ]
        print("\n=== TypingPerfTests report (ms; n=\(iterations), macOS debug XCTest) ===")
        for (name, samples) in rows {
            print(format(name, samples))
        }
        print("Top 5 by p95:")
        for (name, samples) in rows.sorted(by: { stats($0.1).p95 > stats($1.1).p95 }).prefix(5) {
            print("  " + format(name, samples))
        }
        let base = stats(baselineEnglish)
        let load = stats(loaded.english)
        print(String(format: "English load delta: median %+.3f ms, p95 %+.3f ms", load.median - base.median, load.p95 - base.p95))
        print("Backlog guide: a key stream begins to accumulate when its inter-key interval is below the observed per-key cost; compare p95 with 5 ms (200 keys/s), 10 ms (100 keys/s), and 20 ms (50 keys/s).")
        print("Visible stream timer: message_update every 3 ms; ChatSession's real 50 ms coalesced flush performs conversion. Three hidden sessions receive the same event rate and remain unconverted.")
    }

    private var longMarkdown: String {
        String(repeating: "## Streaming section\nA realistic **markdown** response with `inline code`, [a link](https://example.com), and Chinese 文本。\n\n- item one\n- item two\n\n", count: 36)
    }

    private func makeSession(_ id: String = UUID().uuidString) -> ChatSession {
        ChatSession(id: id, projectURL: URL(fileURLWithPath: "/tmp"), sessionPath: nil, blockedReason: "typing-perf")
    }

    private func makeComposer(session: ChatSession) -> (ComposerTextViewHost, ComposerTextView.Coordinator) {
        var focused = false
        var height = ComposerTextViewLayout.minimumHeight(for: .systemFont(ofSize: NSFont.systemFontSize))
        let parent = ComposerTextView(
            text: Binding(get: { session.draftText }, set: { session.draftText = $0 }),
            isFocused: Binding(get: { focused }, set: { focused = $0 }),
            height: Binding(get: { height }, set: { height = $0 }),
            sessionIdentity: ObjectIdentifier(session),
            placeholder: "输入消息…",
            onSubmit: {}
        )
        let coordinator = ComposerTextView.Coordinator(parent: parent)
        let host = ComposerTextViewHost()
        host.frame = NSRect(x: 0, y: 0, width: 720, height: height)
        host.textView.delegate = coordinator
        host.textView.onDidChangeText = { coordinator.textViewDidChangeText($0) }
        host.onHeightChange = { coordinator.receiveHeight($0) }
        coordinator.host = host
        coordinator.synchronize(host)
        host.layoutSubtreeIfNeeded()
        return (host, coordinator)
    }

    private func measureEnglish(iterations: Int) -> [Double] {
        let session = makeSession()
        let (host, _) = makeComposer(session: session)
        for _ in 0..<10 {
            host.textView.insertText("a", replacementRange: NSRange(location: NSNotFound, length: 0))
            host.textView.didChangeText()
        }
        return (0..<iterations).map { _ in
            elapsed {
                host.textView.insertText("a", replacementRange: NSRange(location: NSNotFound, length: 0))
                host.textView.didChangeText()
            }
        }
    }

    private func measureIME(iterations: Int) -> [Double] {
        let session = makeSession()
        let (host, _) = makeComposer(session: session)
        for _ in 0..<10 {
            host.textView.setMarkedText("zhong", selectedRange: NSRange(location: 5, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
            host.textView.insertText("中", replacementRange: NSRange(location: NSNotFound, length: 0))
            host.textView.didChangeText()
        }
        return (0..<iterations).map { index in
            elapsed {
                let marked = index.isMultiple(of: 2) ? "zhong" : "guo"
                host.textView.setMarkedText(marked, selectedRange: NSRange(location: (marked as NSString).length, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
                host.textView.insertText("中", replacementRange: NSRange(location: NSNotFound, length: 0))
                host.textView.didChangeText()
            }
        }
    }

    private func measureDirtyLayout(iterations: Int) -> [Double] {
        let host = ComposerTextViewHost()
        host.frame = NSRect(x: 0, y: 0, width: 420, height: 30)
        host.layoutSubtreeIfNeeded()
        for index in 0..<10 {
            host.textView.string = String(repeating: "布局中的文字 ", count: 8 + index)
            _ = host.refreshLayout(scrollSelection: false)
        }
        return (0..<iterations).map { index in
            host.textView.string = String(repeating: "布局中的文字 ", count: 8 + index % 40)
            return elapsed { _ = host.refreshLayout(scrollSelection: false) }
        }
    }

    private func measurePlaceholder(iterations: Int) -> [Double] {
        let host = ComposerTextViewHost()
        return (0..<iterations).map { index in
            elapsed { host.updatePlaceholder(index.isMultiple(of: 2) ? "输入消息…" : "正在生成时仍可输入…") }
        }
    }

    private func measureDraftPublication(iterations: Int) -> [Double] {
        let session = makeSession()
        var draftNotificationCount = 0
        var sessionNotificationCount = 0
        let draftToken = session.composerDraft.objectWillChange.sink { _ in
            draftNotificationCount += 1
        }
        let sessionToken = session.objectWillChange.sink { _ in
            sessionNotificationCount += 1
        }
        defer {
            draftToken.cancel()
            sessionToken.cancel()
        }
        let samples = (0..<iterations).map { index in elapsed { session.draftText = "draft-\(index)" } }
        XCTAssertGreaterThanOrEqual(draftNotificationCount, iterations)
        XCTAssertEqual(sessionNotificationCount, 0)
        return samples
    }

    private func measureStreamConversion(iterations: Int) -> [Double] {
        let message = J(["role": "assistant", "content": longMarkdown])
        for _ in 0..<10 { _ = ChatSession.convert(message: message, id: "streaming", allowDiskRead: false) }
        return (0..<iterations).map { _ in elapsed { _ = ChatSession.convert(message: message, id: "streaming", allowDiskRead: false) } }
    }

    private struct LoadedRun {
        let english: [Double]
        let ime: [Double]
        let hiddenLineSamples: [Double]
        let visible: ChatSession
        let hidden: [ChatSession]
        let draftSession: ChatSession
    }

    private func runStreamingLoad(iterations: Int) -> LoadedRun {
        let draftSession = makeSession("draft")
        let (host, _) = makeComposer(session: draftSession)
        let visible = makeSession("visible")
        visible.isSelectedCheck = { true }
        let hidden = (0..<3).map { makeSession("hidden-\($0)") }
        hidden.forEach { $0.isSelectedCheck = { false } }
        let event = J(["type": "message_update", "message": ["role": "assistant", "content": longMarkdown]])

        var english: [Double] = []
        var ime: [Double] = []
        var hiddenLineSamples: [Double] = []
        let streamTimer = Timer.scheduledTimer(withTimeInterval: 0.003, repeats: true) { _ in
            visible.handleEvent(event)
            for session in hidden {
                hiddenLineSamples.append(self.elapsed { session.handleEvent(event) })
            }
        }
        var step = 0
        let typingTimer = Timer.scheduledTimer(withTimeInterval: 0.005, repeats: true) { timer in
            guard step < iterations * 2 else { timer.invalidate(); return }
            if step.isMultiple(of: 2) {
                english.append(self.elapsed {
                    host.textView.insertText("a", replacementRange: NSRange(location: NSNotFound, length: 0))
                    host.textView.didChangeText()
                })
            } else {
                ime.append(self.elapsed {
                    host.textView.setMarkedText("zhong", selectedRange: NSRange(location: 5, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
                    host.textView.insertText("中", replacementRange: NSRange(location: NSNotFound, length: 0))
                    host.textView.didChangeText()
                })
            }
            step += 1
        }
        while step < iterations * 2 {
            RunLoop.main.run(mode: .default, before: Date(timeIntervalSinceNow: 0.01))
        }
        typingTimer.invalidate()
        streamTimer.invalidate()
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.12)) // let the final real 50 ms flush fire
        return LoadedRun(english: english, ime: ime, hiddenLineSamples: hiddenLineSamples, visible: visible, hidden: hidden, draftSession: draftSession)
    }

    private func elapsed(_ body: () -> Void) -> Double {
        let start = CFAbsoluteTimeGetCurrent()
        body()
        return (CFAbsoluteTimeGetCurrent() - start) * 1_000
    }

    private func stats(_ samples: [Double]) -> (median: Double, p95: Double, max: Double) {
        let sorted = samples.sorted()
        let percentile = sorted[min(sorted.count - 1, Int((Double(sorted.count - 1) * 0.95).rounded(.up)))]
        return (sorted[sorted.count / 2], percentile, sorted.last ?? 0)
    }

    private func format(_ name: String, _ samples: [Double]) -> String {
        let value = stats(samples)
        return String(format: "  %@ — median %.3f, p95 %.3f, max %.3f", name, value.median, value.p95, value.max)
    }
}
