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

        activeIdentity = ObjectIdentifier(secondIdentity)
        boundText = "新会话草稿"
        coordinator.parent = parent()
        coordinator.synchronize(host)

        XCTAssertFalse(textView.hasMarkedText())
        XCTAssertEqual(textView.string, "新会话草稿")
        XCTAssertEqual(boundText, "新会话草稿")
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

    private func spinRunLoop() {
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))
    }
}
