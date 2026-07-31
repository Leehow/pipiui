import XCTest
import AppKit
import SwiftUI
@testable import PipiUI

@MainActor
final class ComposerTextViewTests: XCTestCase {
    func testNativeHostUsesFullWidthCapsAtTenLinesAndClearsStaleScroll() {
        let font = NSFont.systemFont(ofSize: NSFont.systemFontSize)
        let host = ComposerTextViewHost(font: font)
        host.frame = NSRect(
            x: 0,
            y: 0,
            width: 1_000,
            height: ComposerTextViewLayout.minimumHeight(for: font)
        )
        host.layoutSubtreeIfNeeded()

        host.textView.string = (1...14).map { "第\($0)行" }.joined(separator: "\n")
        let cappedHeight = host.refreshLayout(scrollSelection: true)

        XCTAssertGreaterThan(host.textView.textContainer?.containerSize.width ?? 0, 950)
        XCTAssertFalse(host.textView.isHorizontallyResizable)
        XCTAssertFalse(host.scrollView.hasHorizontalScroller)
        XCTAssertEqual(
            cappedHeight,
            ComposerTextViewLayout.maximumHeight(for: font),
            accuracy: 0.5
        )
        XCTAssertGreaterThan(host.documentTextHeight, cappedHeight)

        host.frame.size.height = cappedHeight
        host.layoutSubtreeIfNeeded()
        host.scrollView.contentView.scroll(to: NSPoint(x: 0, y: 40))
        host.textView.string = "第一行\n第二行"
        let twoLineHeight = host.refreshLayout(scrollSelection: false)

        XCTAssertGreaterThan(
            twoLineHeight,
            ComposerTextViewLayout.minimumHeight(for: font)
        )
        XCTAssertLessThan(twoLineHeight, cappedHeight)
        XCTAssertEqual(host.scrollView.contentView.bounds.origin.y, 0, accuracy: 0.5)
    }

    func testMarkedTextHookHidesPlaceholderAndSynchronizesBinding() {
        var boundText = ""
        var isFocused = false
        var boundHeight = ComposerTextViewLayout.minimumHeight(
            for: .systemFont(ofSize: NSFont.systemFontSize)
        )
        let identity = NSObject()
        let parent = ComposerTextView(
            text: Binding(
                get: { boundText },
                set: { boundText = $0 }
            ),
            isFocused: Binding(
                get: { isFocused },
                set: { isFocused = $0 }
            ),
            height: Binding(
                get: { boundHeight },
                set: { boundHeight = $0 }
            ),
            sessionIdentity: ObjectIdentifier(identity),
            placeholder: "输入消息…",
            onSubmit: {}
        )
        let coordinator = ComposerTextView.Coordinator(parent: parent)
        let host = ComposerTextViewHost()
        host.frame = NSRect(x: 0, y: 0, width: 1_000, height: boundHeight)
        host.textView.delegate = coordinator
        host.textView.onDidChangeText = { coordinator.textViewDidChangeText($0) }
        coordinator.host = host
        coordinator.synchronize(host)
        host.layoutSubtreeIfNeeded()

        host.updatePlaceholder("输入消息…")
        XCTAssertFalse(host.placeholderLabel.isHidden)

        // setMarkedText calls didChangeText, but AppKit does not send the normal
        // NSTextDidChangeNotification for this composition update.
        host.textView.setMarkedText(
            "zai",
            selectedRange: NSRange(location: 3, length: 0),
            replacementRange: NSRange(location: NSNotFound, length: 0)
        )

        XCTAssertTrue(host.textView.hasMarkedText())
        XCTAssertTrue(host.placeholderLabel.isHidden)
        XCTAssertEqual(boundText, "zai")
    }

    func testLiveChangeUpdatesBindingAndExternalUpdateDoesNotResetMarkedText() {
        var boundText = ""
        var isFocused = false
        var boundHeight = ComposerTextViewLayout.minimumHeight(
            for: .systemFont(ofSize: NSFont.systemFontSize)
        )
        let firstIdentity = NSObject()
        let secondIdentity = NSObject()
        var activeIdentity = ObjectIdentifier(firstIdentity)

        func parent() -> ComposerTextView {
            ComposerTextView(
                text: Binding(
                    get: { boundText },
                    set: { boundText = $0 }
                ),
                isFocused: Binding(
                    get: { isFocused },
                    set: { isFocused = $0 }
                ),
                height: Binding(
                    get: { boundHeight },
                    set: { boundHeight = $0 }
                ),
                sessionIdentity: activeIdentity,
                placeholder: "输入消息…",
                onSubmit: {}
            )
        }

        let coordinator = ComposerTextView.Coordinator(parent: parent())
        let host = ComposerTextViewHost()
        host.frame = NSRect(x: 0, y: 0, width: 1_000, height: boundHeight)
        host.textView.delegate = coordinator
        host.onHeightChange = { coordinator.receiveHeight($0) }
        coordinator.host = host
        coordinator.synchronize(host)
        host.layoutSubtreeIfNeeded()
        let textView = host.textView

        textView.string = "before"
        textView.setSelectedRange(NSRange(location: 3, length: 0))
        let marker = "[paste]"
        let insertionRange = textView.selectedRange()
        XCTAssertTrue(
            textView.shouldChangeText(in: insertionRange, replacementString: marker)
        )
        textView.replaceCharacters(in: insertionRange, with: marker)
        textView.didChangeText()
        XCTAssertEqual(boundText, "bef[paste]ore")

        let liveText = String(
            repeating: "这是一段用于验证实时输入换行高度的文字。",
            count: 16
        )
        textView.string = liveText
        textView.didChangeText()
        spinRunLoop()

        XCTAssertEqual(boundText, liveText)
        XCTAssertGreaterThan(
            boundHeight,
            ComposerTextViewLayout.minimumHeight(for: textView.font!)
        )
        XCTAssertLessThanOrEqual(
            boundHeight,
            ComposerTextViewLayout.maximumHeight(for: textView.font!)
        )

        boundText = ""
        coordinator.parent = parent()
        coordinator.synchronize(host)
        textView.setMarkedText(
            "拼",
            selectedRange: NSRange(location: 1, length: 0),
            replacementRange: NSRange(location: NSNotFound, length: 0)
        )
        textView.didChangeText()
        spinRunLoop()
        XCTAssertTrue(textView.hasMarkedText())
        XCTAssertEqual(boundText, "拼")

        boundText = "外部更新"
        coordinator.parent = parent()
        coordinator.synchronize(host)

        XCTAssertTrue(textView.hasMarkedText())
        XCTAssertNotEqual(textView.string, "外部更新")

        textView.unmarkText()
        textView.didChangeText()
        spinRunLoop()

        XCTAssertEqual(textView.string, "外部更新")
        XCTAssertEqual(boundText, "外部更新")

        textView.setMarkedText(
            "旧会话输入",
            selectedRange: NSRange(location: 5, length: 0),
            replacementRange: NSRange(location: NSNotFound, length: 0)
        )
        textView.didChangeText()
        XCTAssertTrue(textView.hasMarkedText())

        boundText = "旧会话外部更新"
        coordinator.parent = parent()
        coordinator.synchronize(host)
        textView.unmarkText()
        textView.didChangeText()

        // Rebind before the queued post-unmark replacement runs. The callback
        // from the old identity must not overwrite the new session draft.
        activeIdentity = ObjectIdentifier(secondIdentity)
        boundText = "新会话草稿"
        coordinator.parent = parent()
        coordinator.synchronize(host)
        spinRunLoop()

        XCTAssertFalse(textView.hasMarkedText())
        XCTAssertEqual(textView.string, "新会话草稿")
        XCTAssertEqual(boundText, "新会话草稿")
    }

    func testStreamingRenderDoesNotQueueStaleBindingDuringMarkedText() {
        var boundText = ""
        var isFocused = false
        var boundHeight = ComposerTextViewLayout.minimumHeight(
            for: .systemFont(ofSize: NSFont.systemFontSize)
        )
        let identity = NSObject()

        func parent() -> ComposerTextView {
            ComposerTextView(
                text: Binding(
                    get: { boundText },
                    set: { boundText = $0 }
                ),
                isFocused: Binding(
                    get: { isFocused },
                    set: { isFocused = $0 }
                ),
                height: Binding(
                    get: { boundHeight },
                    set: { boundHeight = $0 }
                ),
                sessionIdentity: ObjectIdentifier(identity),
                placeholder: "输入将排队，完成后发送…",
                onSubmit: {}
            )
        }

        let coordinator = ComposerTextView.Coordinator(parent: parent())
        let host = ComposerTextViewHost()
        host.textView.delegate = coordinator
        coordinator.host = host
        coordinator.synchronize(host)
        let textView = host.textView

        // Simulate an IME composition whose delegate callback has not yet updated
        // SwiftUI when a streaming-driven updateNSView render arrives.
        textView.setMarkedText(
            "ni",
            selectedRange: NSRange(location: 2, length: 0),
            replacementRange: NSRange(location: NSNotFound, length: 0)
        )
        XCTAssertTrue(textView.hasMarkedText())
        XCTAssertEqual(boundText, "")

        coordinator.parent = parent()
        coordinator.synchronize(host)

        XCTAssertEqual(boundText, "ni")
        XCTAssertTrue(textView.hasMarkedText())

        // If synchronize had queued the stale empty binding as an external update,
        // post-commit processing would replace this committed character with "".
        textView.insertText(
            "你",
            replacementRange: NSRange(location: NSNotFound, length: 0)
        )
        textView.didChangeText()
        spinRunLoop()

        XCTAssertFalse(textView.hasMarkedText())
        XCTAssertEqual(textView.string, "你")
        XCTAssertEqual(boundText, "你")
    }

    func testReturnSubmitsAndExplicitLineBreakCommandStillInsertsNewline() {
        let textView = ComposerNSTextView(frame: .zero)
        var submitCount = 0
        textView.onSubmit = { submitCount += 1 }
        textView.string = "draft"
        textView.setSelectedRange(NSRange(location: 5, length: 0))

        textView.doCommand(by: #selector(NSTextView.insertNewline(_:)))

        XCTAssertEqual(submitCount, 1)
        XCTAssertEqual(textView.string, "draft")

        textView.doCommand(
            by: #selector(NSTextView.insertNewlineIgnoringFieldEditor(_:))
        )

        XCTAssertEqual(submitCount, 1)
        XCTAssertEqual(textView.string, "draft\n")
    }

    func testReturnDuringMarkedTextDoesNotSubmitOrReplaceCompositionWithNewline() {
        let textView = ComposerNSTextView(frame: .zero)
        var submitCount = 0
        textView.onSubmit = { submitCount += 1 }
        textView.setMarkedText(
            "拼",
            selectedRange: NSRange(location: 1, length: 0),
            replacementRange: NSRange(location: NSNotFound, length: 0)
        )

        XCTAssertTrue(textView.hasMarkedText())
        textView.doCommand(by: #selector(NSTextView.insertNewline(_:)))

        XCTAssertEqual(submitCount, 0)
        XCTAssertTrue(textView.hasMarkedText())
        XCTAssertEqual(textView.string, "拼")
    }

    func testExternalClearResetsTypingUndoBoundary() {
        var boundText = ""
        var isFocused = false
        var boundHeight = ComposerTextViewLayout.minimumHeight(
            for: .systemFont(ofSize: NSFont.systemFontSize)
        )
        let identity = NSObject()

        func parent() -> ComposerTextView {
            ComposerTextView(
                text: Binding(
                    get: { boundText },
                    set: { boundText = $0 }
                ),
                isFocused: Binding(
                    get: { isFocused },
                    set: { isFocused = $0 }
                ),
                height: Binding(
                    get: { boundHeight },
                    set: { boundHeight = $0 }
                ),
                sessionIdentity: ObjectIdentifier(identity),
                placeholder: "输入消息…",
                onSubmit: {}
            )
        }

        let coordinator = ComposerTextView.Coordinator(parent: parent())
        let host = ComposerTextViewHost()
        host.textView.delegate = coordinator
        coordinator.host = host
        coordinator.synchronize(host)

        host.textView.insertText(
            "abc",
            replacementRange: NSRange(location: NSNotFound, length: 0)
        )
        host.textView.didChangeText()
        let undoManager = coordinator.undoManager(for: host.textView)!

        XCTAssertEqual(boundText, "abc")
        XCTAssertTrue(undoManager.canUndo)

        undoManager.undo()
        spinRunLoop()
        XCTAssertEqual(host.textView.string, "")
        XCTAssertEqual(boundText, "")
        undoManager.redo()
        spinRunLoop()
        XCTAssertEqual(host.textView.string, "abc")
        XCTAssertEqual(boundText, "abc")

        boundText = ""
        coordinator.parent = parent()
        coordinator.synchronize(host)

        XCTAssertFalse(undoManager.canUndo)
        undoManager.undo()
        XCTAssertEqual(host.textView.string, "")
        XCTAssertEqual(boundText, "")
    }

    func testSessionRebindResetsOldSessionTypingUndoBoundary() {
        var boundText = ""
        var isFocused = false
        var boundHeight = ComposerTextViewLayout.minimumHeight(
            for: .systemFont(ofSize: NSFont.systemFontSize)
        )
        let firstIdentity = NSObject()
        let secondIdentity = NSObject()
        var activeIdentity = ObjectIdentifier(firstIdentity)

        func parent() -> ComposerTextView {
            ComposerTextView(
                text: Binding(
                    get: { boundText },
                    set: { boundText = $0 }
                ),
                isFocused: Binding(
                    get: { isFocused },
                    set: { isFocused = $0 }
                ),
                height: Binding(
                    get: { boundHeight },
                    set: { boundHeight = $0 }
                ),
                sessionIdentity: activeIdentity,
                placeholder: "输入消息…",
                onSubmit: {}
            )
        }

        let coordinator = ComposerTextView.Coordinator(parent: parent())
        let host = ComposerTextViewHost()
        host.textView.delegate = coordinator
        coordinator.host = host
        coordinator.synchronize(host)
        host.textView.insertText(
            "old",
            replacementRange: NSRange(location: NSNotFound, length: 0)
        )
        host.textView.didChangeText()
        let undoManager = coordinator.undoManager(for: host.textView)!

        XCTAssertEqual(boundText, "old")
        XCTAssertTrue(undoManager.canUndo)

        activeIdentity = ObjectIdentifier(secondIdentity)
        // Use the same visible text to prove that the session boundary itself,
        // not merely a string assignment, invalidates the old range operation.
        boundText = "old"
        coordinator.parent = parent()
        coordinator.synchronize(host)

        XCTAssertFalse(undoManager.canUndo)
        undoManager.undo()
        XCTAssertEqual(host.textView.string, "old")
        XCTAssertEqual(boundText, "old")
    }

    func testExternalCompletionMapsCaretAtOldEndToNewEnd() {
        var boundText = "/na"
        var isFocused = false
        var boundHeight = ComposerTextViewLayout.minimumHeight(
            for: .systemFont(ofSize: NSFont.systemFontSize)
        )
        let identity = NSObject()

        func parent() -> ComposerTextView {
            ComposerTextView(
                text: Binding(
                    get: { boundText },
                    set: { boundText = $0 }
                ),
                isFocused: Binding(
                    get: { isFocused },
                    set: { isFocused = $0 }
                ),
                height: Binding(
                    get: { boundHeight },
                    set: { boundHeight = $0 }
                ),
                sessionIdentity: ObjectIdentifier(identity),
                placeholder: "输入消息…",
                onSubmit: {}
            )
        }

        let coordinator = ComposerTextView.Coordinator(parent: parent())
        let host = ComposerTextViewHost()
        host.textView.delegate = coordinator
        coordinator.host = host
        coordinator.synchronize(host)
        host.textView.setSelectedRange(NSRange(location: 3, length: 0))

        boundText = "/name "
        coordinator.parent = parent()
        coordinator.synchronize(host)

        XCTAssertEqual(host.textView.string, "/name ")
        XCTAssertEqual(
            host.textView.selectedRange(),
            NSRange(location: 6, length: 0)
        )

        host.textView.setSelectedRange(NSRange(location: 1, length: 2))
        boundText = "/other "
        coordinator.parent = parent()
        coordinator.synchronize(host)

        XCTAssertEqual(
            host.textView.selectedRange(),
            NSRange(location: 1, length: 2)
        )
    }

    func testFocusedWidthOnlyRelayoutKeepsEndSelectionVisiblePastTenLineCap() {
        let font = NSFont.systemFont(ofSize: NSFont.systemFontSize)
        let maximumHeight = ComposerTextViewLayout.maximumHeight(for: font)
        let host = FocusedComposerTextViewHost(font: font)
        host.frame = NSRect(
            x: 0,
            y: 0,
            width: 1_000,
            height: maximumHeight
        )

        host.textView.string = String(
            repeating: "这是用于验证窗口缩窄时插入点仍然可见的连续文本。",
            count: 6
        )
        let end = (host.textView.string as NSString).length
        host.textView.setSelectedRange(NSRange(location: end, length: 0))
        host.layoutSubtreeIfNeeded()
        XCTAssertLessThanOrEqual(host.documentTextHeight, maximumHeight)

        host.frame.size.width = 160
        host.needsLayout = true
        host.layoutSubtreeIfNeeded()

        XCTAssertGreaterThan(host.documentTextHeight, maximumHeight)
        XCTAssertGreaterThan(
            host.scrollView.contentView.bounds.origin.y,
            0,
            "A width-only relayout must scroll the active end selection into view"
        )
    }

    func testFocusSynchronizationNeverStealsFocusFromInactiveOrNonKeyWindow() {
        var boundText = ""
        var isFocused = true
        var boundHeight = ComposerTextViewLayout.minimumHeight(
            for: .systemFont(ofSize: NSFont.systemFontSize)
        )
        let identity = NSObject()
        let parent = ComposerTextView(
            text: Binding(
                get: { boundText },
                set: { boundText = $0 }
            ),
            isFocused: Binding(
                get: { isFocused },
                set: { isFocused = $0 }
            ),
            height: Binding(
                get: { boundHeight },
                set: { boundHeight = $0 }
            ),
            sessionIdentity: ObjectIdentifier(identity),
            placeholder: "输入消息…",
            onSubmit: {}
        )
        let coordinator = ComposerTextView.Coordinator(parent: parent)
        let host = ComposerTextViewHost()
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 500, height: 120),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        window.contentView = host
        var responderRequests = 0
        coordinator.makeFirstResponder = { _, _ in responderRequests += 1 }
        coordinator.appIsActiveProvider = { false }
        coordinator.windowIsKeyProvider = { _ in true }
        coordinator.synchronize(host)
        spinRunLoop()
        XCTAssertEqual(responderRequests, 0)

        coordinator.appIsActiveProvider = { true }
        coordinator.windowIsKeyProvider = { _ in false }
        coordinator.synchronizeFocus(host)
        spinRunLoop()
        XCTAssertEqual(responderRequests, 0)

        coordinator.windowIsKeyProvider = { _ in true }
        coordinator.synchronizeFocus(host)
        spinRunLoop()
        XCTAssertEqual(responderRequests, 1)
        withExtendedLifetime(window) {}
    }

    private final class FocusedComposerTextViewHost: ComposerTextViewHost {
        override var shouldScrollSelectionDuringLayout: Bool { true }
    }

    private func spinRunLoop() {
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))
    }
}
