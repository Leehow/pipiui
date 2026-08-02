import AppKit
import SwiftUI
import XCTest
@testable import PipiUI

final class MarkdownLayoutSizingTests: XCTestCase {
    private struct RightPanelRoundTripHarness: View {
        let sources: [String]
        let totalWidth: CGFloat
        let panelWidth: CGFloat?

        var body: some View {
            HStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(Array(sources.enumerated()), id: \.offset) { _, source in
                        MarkdownTextView(text: source)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                if let panelWidth {
                    Color.clear
                        .frame(width: panelWidth)
                }
            }
            .frame(width: totalWidth)
        }
    }

    private var bodyFont: NSFont {
        ChatTypography.make(fontSize: ChatTypography.defaultFontSize).bodyNSFont
    }

    private func attributed(
        _ paragraphCount: Int,
        typography: ChatTypography = .make(fontSize: ChatTypography.defaultFontSize)
    ) -> NSAttributedString {
        let source = (0..<paragraphCount).map { index in
            "段落 \(index)：这是一段用于验证原生 Markdown 文本完整测高的长文本，" +
                "包含 selectable text、/tmp/example-\(index).md 路径以及足够多的自动换行内容。"
        }.joined(separator: "\n\n")
        return MarkdownSelectionContent.attributedString(
            for: source,
            typography: typography
        )
    }

    private func host(
        paragraphCount: Int = 24,
        lineLimit: Int? = nil,
        backingScale: CGFloat = 2
    ) -> MarkdownNativeLayoutView {
        let host = MarkdownNativeLayoutView(frame: .zero)
        host.update(
            attributedText: attributed(paragraphCount),
            bodyFont: bodyFont,
            maximumNumberOfLines: lineLimit,
            onOpenDocument: nil,
            onFlash: nil,
            backingScale: backingScale
        )
        return host
    }

    private func firstDescendant<T: NSView>(
        of type: T.Type,
        in root: NSView
    ) -> T? {
        if let match = root as? T { return match }
        for subview in root.subviews {
            if let match = firstDescendant(of: type, in: subview) {
                return match
            }
        }
        return nil
    }

    private func descendants<T: NSView>(
        of type: T.Type,
        in root: NSView
    ) -> [T] {
        var result: [T] = []
        if let match = root as? T {
            result.append(match)
        }
        for subview in root.subviews {
            result.append(contentsOf: descendants(of: type, in: subview))
        }
        return result
    }

    func testNormalizesWidthAtOneX() {
        XCTAssertEqual(
            MarkdownLayoutSizing.normalizedWidth(
                640.99,
                backingScale: 1
            ),
            640
        )
    }

    func testNormalizesWidthAtTwoX() {
        XCTAssertEqual(
            MarkdownLayoutSizing.normalizedWidth(
                640.74,
                backingScale: 2
            ),
            640.5
        )
    }

    func testNormalizesWidthAtThreeX() {
        XCTAssertEqual(
            MarkdownLayoutSizing.normalizedWidth(
                640.4,
                backingScale: 3
            ),
            640 + 1.0 / 3.0,
            accuracy: 0.000_001
        )
    }

    func testScaleTransitionUpdatesToDifferentNormalizedGrid() {
        let container = NSTextContainer()

        XCTAssertTrue(MarkdownLayoutSizing.updateContainerIfNeeded(
            container,
            proposedWidth: 640.4,
            backingScale: 2
        ))
        XCTAssertEqual(container.containerSize.width, 640)

        XCTAssertTrue(MarkdownLayoutSizing.updateContainerIfNeeded(
            container,
            proposedWidth: 640.4,
            backingScale: 3
        ))
        XCTAssertEqual(
            container.containerSize.width,
            640 + 1.0 / 3.0,
            accuracy: 0.000_001
        )
    }

    func testOneBackingPixelWidthChangeAtThreeXIsNotIgnored() {
        let container = NSTextContainer()

        XCTAssertTrue(MarkdownLayoutSizing.updateContainerIfNeeded(
            container,
            proposedWidth: 640,
            backingScale: 3
        ))
        XCTAssertTrue(MarkdownLayoutSizing.updateContainerIfNeeded(
            container,
            proposedWidth: 640.34,
            backingScale: 3
        ))
        XCTAssertEqual(
            container.containerSize.width,
            640 + 1.0 / 3.0,
            accuracy: 0.000_001
        )
    }

    func testSubpixelJitterOnSameThreeXGridDoesNotUpdate() {
        let container = NSTextContainer()

        XCTAssertTrue(MarkdownLayoutSizing.updateContainerIfNeeded(
            container,
            proposedWidth: 640.34,
            backingScale: 3
        ))
        XCTAssertFalse(MarkdownLayoutSizing.updateContainerIfNeeded(
            container,
            proposedWidth: 640.65,
            backingScale: 3
        ))
    }

    func testRepeatedSameNormalizedTargetDoesNotMutateContainer() {
        let container = NSTextContainer()

        XCTAssertTrue(MarkdownLayoutSizing.updateContainerIfNeeded(
            container,
            proposedWidth: 639.99,
            backingScale: 2
        ))
        let target = container.containerSize

        for _ in 0..<100 {
            XCTAssertFalse(MarkdownLayoutSizing.updateContainerIfNeeded(
                container,
                proposedWidth: 639.91,
                backingScale: 2
            ))
            XCTAssertEqual(container.containerSize, target)
        }
    }

    func testAcceptanceSizedMarkdownKeepsUsedRectStable() {
        var lines = Array(
            repeating: "- 北京 " + String(repeating: "x", count: 40),
            count: 136
        )
        lines[0] += "xxxxxx"
        let source = lines.joined(separator: "\n")
        let attributed = MarkdownSelectionContent.attributedString(
            for: source
        )
        let storage = NSTextStorage(attributedString: attributed)
        let manager = NSLayoutManager()
        let container = NSTextContainer()
        container.widthTracksTextView = false
        storage.addLayoutManager(manager)
        manager.addTextContainer(container)

        XCTAssertEqual(source.utf8.count, 6_805)
        XCTAssertEqual(lines.count, 136)
        XCTAssertTrue(MarkdownLayoutSizing.updateContainerIfNeeded(
            container,
            proposedWidth: 640,
            backingScale: 2
        ))
        manager.ensureLayout(for: container)
        let first = manager.usedRect(for: container)

        for _ in 0..<100 {
            XCTAssertFalse(MarkdownLayoutSizing.updateContainerIfNeeded(
                container,
                proposedWidth: 640.24,
                backingScale: 2
            ))
            manager.ensureLayout(for: container)
            XCTAssertEqual(manager.usedRect(for: container), first)
        }
        XCTAssertTrue(first.height.isFinite)
        XCTAssertGreaterThan(first.height, 0)
    }

    func testNativeHostFullHeightMatchesTextKitAndGrowsAtNarrowWidth() {
        let host = host()

        let wide = host.measuredHeight(for: 620, backingScale: 2)
        let wideUsed = host.currentTextKitHeight
        let narrow = host.measuredHeight(for: 260, backingScale: 2)
        let narrowUsed = host.currentTextKitHeight

        XCTAssertEqual(wide, wideUsed, accuracy: 0.000_001)
        XCTAssertEqual(narrow, narrowUsed, accuracy: 0.000_001)
        XCTAssertGreaterThan(narrow, wide)

        host.frame = NSRect(x: 0, y: 0, width: 260, height: narrow)
        host.needsLayout = true
        host.layoutSubtreeIfNeeded()
        XCTAssertEqual(host.intrinsicContentSize.height, narrow, accuracy: 0.000_001)
        XCTAssertEqual(host.fittingSize.height, narrow, accuracy: 0.000_001)
        XCTAssertEqual(host.nativeTextFrame.height, narrow, accuracy: 0.000_001)
    }

    func testSwiftUIHostReservesMeasuredNativeMarkdownHeight() throws {
        let source = (0..<24).map { index in
            "## 标题 \(index)\n长段落用于验证 SwiftUI 外层实际保留 TextKit 的完整高度，" +
                "并继续包含多行文字和 /tmp/hosted-\(index).md 路径。"
        }.joined(separator: "\n\n")
        let hosting = NSHostingView(
            rootView: MarkdownTextView(text: source).frame(width: 420)
        )

        let fitting = hosting.fittingSize
        XCTAssertEqual(fitting.width, 420, accuracy: 0.5)
        XCTAssertGreaterThan(fitting.height, 100)

        hosting.frame = NSRect(x: 0, y: 0, width: fitting.width, height: fitting.height)
        hosting.needsLayout = true
        hosting.layoutSubtreeIfNeeded()
        let native = try XCTUnwrap(
            firstDescendant(of: MarkdownNativeLayoutView.self, in: hosting)
        )

        XCTAssertEqual(native.bounds.height, fitting.height, accuracy: 0.5)
        XCTAssertEqual(native.bounds.height, native.currentTextKitHeight, accuracy: 0.5)
        XCTAssertEqual(native.nativeTextFrame, native.bounds)
    }

    func testSwiftUIHostRecomputesNativeHeightAcrossRightPanelWidthRoundTrip() throws {
        let sources = (0..<16).map { index in
            "## 宽度往返消息 \(index)\n" +
                String(
                    repeating: "打开右侧栏后聊天列变窄，关闭后恢复；每次都必须重新保留完整 TextKit 高度，",
                    count: 3 + index % 4
                ) +
                "不能沿用上一轮布局的 stale height。/tmp/sidebar-\(index).md"
        }
        let totalWidth: CGFloat = 780
        let panelWidth: CGFloat = 360
        let hosting = NSHostingView(
            rootView: RightPanelRoundTripHarness(
                sources: sources,
                totalWidth: totalWidth,
                panelWidth: nil
            )
        )

        func settle(panelWidth: CGFloat?) throws -> ([MarkdownNativeLayoutView], CGFloat) {
            hosting.rootView = RightPanelRoundTripHarness(
                sources: sources,
                totalWidth: totalWidth,
                panelWidth: panelWidth
            )
            hosting.needsLayout = true
            hosting.layoutSubtreeIfNeeded()
            let fitting = hosting.fittingSize
            hosting.frame = NSRect(
                x: 0,
                y: 0,
                width: fitting.width,
                height: fitting.height
            )
            hosting.needsLayout = true
            hosting.layoutSubtreeIfNeeded()
            let nativeRows = descendants(of: MarkdownNativeLayoutView.self, in: hosting)
            XCTAssertEqual(nativeRows.count, sources.count)
            for native in nativeRows {
                XCTAssertEqual(native.bounds.height, native.currentTextKitHeight, accuracy: 0.5)
                XCTAssertEqual(native.bounds.height, native.displayedTextKitHeight, accuracy: 0.5)
                XCTAssertEqual(native.nativeTextFrame, native.bounds)
            }
            let rowFrames = nativeRows
                .map { hosting.convert($0.bounds, from: $0) }
                .sorted { $0.minY < $1.minY }
            for (first, second) in zip(rowFrames, rowFrames.dropFirst()) {
                XCTAssertLessThanOrEqual(
                    first.maxY,
                    second.minY + 0.5,
                    "Native Markdown sibling frames must not overlap after width reflow"
                )
            }
            return (nativeRows, fitting.height)
        }

        let (wideBefore, wideHeightBefore) = try settle(panelWidth: nil)
        let wideWidthsBefore = wideBefore.map(\.bounds.width)
        let initialInvalidations = wideBefore.map(\.intrinsicInvalidationCount)

        for _ in 0..<4 {
            let (narrowRows, narrowHeight) = try settle(panelWidth: panelWidth)
            XCTAssertGreaterThan(narrowHeight, wideHeightBefore)
            XCTAssertTrue(zip(narrowRows, wideWidthsBefore).allSatisfy { row, wideWidth in
                row.bounds.width < wideWidth
            })

            let (wideRows, wideHeight) = try settle(panelWidth: nil)
            XCTAssertEqual(wideHeight, wideHeightBefore, accuracy: 0.5)
            for (index, row) in wideRows.enumerated() {
                XCTAssertTrue(row === wideBefore[index])
                XCTAssertEqual(row.bounds.width, wideWidthsBefore[index], accuracy: 0.5)
            }
        }

        XCTAssertEqual(
            wideBefore.map(\.intrinsicInvalidationCount),
            initialInvalidations,
            "Pure width/layout transactions must not feed intrinsic invalidation back into SwiftUI"
        )
    }

    func testNativeHostRepeatedSameWidthUsesStableMeasurement() {
        let host = host()
        let first = host.measuredHeight(for: 480.24, backingScale: 2)
        let passCount = host.measurementPassCount

        for _ in 0..<100 {
            XCTAssertEqual(
                host.measuredHeight(for: 480.49, backingScale: 2),
                first,
                accuracy: 0.000_001
            )
        }
        XCTAssertEqual(host.measurementPassCount, passCount)
    }

    func testNativeHostContentUpdateInvalidatesAndRecomputesSameWidth() {
        let host = host(paragraphCount: 1)
        host.frame = NSRect(x: 0, y: 0, width: 420, height: 1)
        let short = host.measuredHeight(for: 420, backingScale: 2)
        let passCount = host.measurementPassCount
        let invalidationCount = host.measurementInvalidationCount

        XCTAssertTrue(host.update(
            attributedText: attributed(30),
            bodyFont: bodyFont,
            maximumNumberOfLines: nil,
            onOpenDocument: nil,
            onFlash: nil,
            backingScale: 2
        ))
        let long = host.intrinsicContentSize.height

        XCTAssertGreaterThan(long, short)
        XCTAssertGreaterThan(host.measurementPassCount, passCount)
        XCTAssertGreaterThan(host.measurementInvalidationCount, invalidationCount)
        XCTAssertEqual(long, host.currentTextKitHeight, accuracy: 0.000_001)
    }

    func testNativeHostTypographyUpdateInvalidatesAndRecomputes() {
        let host = host(paragraphCount: 16)
        host.frame = NSRect(x: 0, y: 0, width: 420, height: 1)
        let normal = host.measuredHeight(for: 420, backingScale: 2)
        let invalidationCount = host.measurementInvalidationCount
        let largeTypography = ChatTypography.make(fontSize: 22)

        XCTAssertTrue(host.update(
            attributedText: attributed(16, typography: largeTypography),
            bodyFont: largeTypography.bodyNSFont,
            maximumNumberOfLines: nil,
            onOpenDocument: nil,
            onFlash: nil,
            backingScale: 2
        ))
        let large = host.intrinsicContentSize.height

        XCTAssertGreaterThan(large, normal)
        XCTAssertGreaterThan(host.measurementInvalidationCount, invalidationCount)
        XCTAssertEqual(large, host.currentTextKitHeight, accuracy: 0.000_001)
    }

    func testNativeHostLineLimitInvalidatesAndRestoresUnlimitedHeight() {
        let host = host(paragraphCount: 30)
        host.frame = NSRect(x: 0, y: 0, width: 360, height: 1)
        let unlimited = host.measuredHeight(for: 360, backingScale: 2)

        XCTAssertTrue(host.update(
            attributedText: attributed(30),
            bodyFont: bodyFont,
            maximumNumberOfLines: 3,
            onOpenDocument: nil,
            onFlash: nil,
            backingScale: 2
        ))
        let limited = host.intrinsicContentSize.height
        XCTAssertEqual(host.maximumNumberOfLines, 3)
        XCTAssertLessThan(limited, unlimited)
        XCTAssertEqual(limited, host.currentTextKitHeight, accuracy: 0.000_001)

        XCTAssertTrue(host.update(
            attributedText: attributed(30),
            bodyFont: bodyFont,
            maximumNumberOfLines: nil,
            onOpenDocument: nil,
            onFlash: nil,
            backingScale: 2
        ))
        XCTAssertEqual(host.maximumNumberOfLines, 0)
        XCTAssertEqual(
            host.intrinsicContentSize.height,
            unlimited,
            accuracy: 0.000_001
        )
    }

    func testNativeHostBoundsContainTextViewAsSecondaryGuard() {
        let host = host(paragraphCount: 30)
        let fullHeight = host.measuredHeight(for: 320, backingScale: 2)
        host.frame = NSRect(x: 0, y: 0, width: 320, height: 24)
        host.needsLayout = true
        host.layoutSubtreeIfNeeded()

        XCTAssertGreaterThan(fullHeight, host.bounds.height)
        XCTAssertTrue(host.wantsDefaultClipping)
        XCTAssertFalse(host.nativeTextIsVerticallyResizable)
        XCTAssertEqual(host.nativeTextFrame, host.bounds)
    }
}
