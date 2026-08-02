import AppKit
import XCTest
@testable import PipiUI

final class MarkdownStreamingPerformanceTests: XCTestCase {
    private let typography = ChatTypography.make(fontSize: ChatTypography.defaultFontSize)

    private func applying(
        _ update: MarkdownStreamingRenderer.Update,
        to storage: NSMutableAttributedString
    ) {
        switch update {
        case .unchanged:
            break
        case .full(let attributed):
            storage.setAttributedString(attributed)
        case .replace(let range, let tail):
            XCTAssertLessThanOrEqual(NSMaxRange(range), storage.length)
            storage.replaceCharacters(in: range, with: tail)
        }
    }

    func testIncrementalAttributedOutputMatchesFullRendererAtEveryPrefix() {
        let chunks = [
            "第一段 **粗体** /tmp/demo.md",
            "\n继续第一段。\n\n",
            "| Key | Value |",
            "\n| --- | --- |\n| id | `agent` |\n\n",
            "```swift\nlet value = 1",
            "\n\n// fence 内空行不能成为稳定边界",
            "\n```\n\n",
            "- 一项\n- 二项",
            "\n\n> 引用一\n> 引用二\n\n",
            "plain line\n  aligned   value\nnext --> item",
            "\n\n最后一段",
        ]
        let renderer = MarkdownStreamingRenderer()
        let storage = NSMutableAttributedString()
        var text = ""

        for chunk in chunks {
            for character in chunk {
                text.append(character)
                applying(renderer.update(text: text, typography: typography), to: storage)
                let full = MarkdownSelectionContent.attributedString(for: text, typography: typography)
                guard storage.isEqual(to: full) else {
                    return XCTFail(
                        "incremental rendering diverged at source prefix: \(text)\n" +
                        "incremental=\(storage.string.debugDescription)\nfull=\(full.string.debugDescription)"
                    )
                }
            }
        }
    }

    func testNonAppendAndTypographyChangesFallBackToFullRenderer() {
        let renderer = MarkdownStreamingRenderer()
        let initial = "one\n\ntwo\n\nthree"
        _ = renderer.update(text: initial, typography: typography)

        let rewritten = "one changed\n\ntwo\n\nthree"
        guard case .full(let rewrittenOutput) = renderer.update(
            text: rewritten,
            typography: typography
        ) else {
            return XCTFail("non-append rewrite must use the full renderer")
        }
        XCTAssertTrue(rewrittenOutput.isEqual(to: MarkdownSelectionContent.attributedString(
            for: rewritten,
            typography: typography
        )))

        let larger = ChatTypography.make(fontSize: typography.fontSize + 2)
        guard case .full(let resizedOutput) = renderer.update(
            text: rewritten + " appended",
            typography: larger
        ) else {
            return XCTFail("typography change must use the full renderer")
        }
        XCTAssertTrue(resizedOutput.isEqual(to: MarkdownSelectionContent.attributedString(
            for: rewritten + " appended",
            typography: larger
        )))
    }

    func testStreamingHostHeightMatchesFreshFullHost() {
        let prefixes = [
            "第一段。",
            "第一段。\n\n第二段 **bold**。",
            "第一段。\n\n第二段 **bold**。\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
            "第一段。\n\n第二段 **bold**。\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```\ncode\n```",
        ]

        for width in [CGFloat(320), 600, 900] {
            let streaming = MarkdownNativeLayoutView(frame: .zero)
            for text in prefixes {
                streaming.update(
                    markdownText: text,
                    typography: typography,
                    maximumNumberOfLines: nil,
                    onOpenDocument: nil,
                    onFlash: nil,
                    backingScale: 2
                )
                let incrementalHeight = streaming.measuredHeight(for: width, backingScale: 2)

                let fresh = MarkdownNativeLayoutView(frame: .zero)
                fresh.update(
                    attributedText: MarkdownSelectionContent.attributedString(
                        for: text,
                        typography: typography
                    ),
                    bodyFont: typography.bodyNSFont,
                    maximumNumberOfLines: nil,
                    onOpenDocument: nil,
                    onFlash: nil,
                    backingScale: 2
                )
                XCTAssertEqual(
                    incrementalHeight,
                    fresh.measuredHeight(for: width, backingScale: 2),
                    accuracy: 0.000_001
                )
            }
        }
    }

    func testTailReplacementPreservesSelectionInStablePrefix() {
        let host = MarkdownNativeLayoutView(frame: .zero)
        let initial = "first selectable block\n\nsecond block\n\nstreaming tail"
        host.update(
            markdownText: initial,
            typography: typography,
            maximumNumberOfLines: nil,
            onOpenDocument: nil,
            onFlash: nil,
            backingScale: 2
        )
        host.nativeSelectedRange = NSRange(location: 6, length: 10)
        let replacementCount = host.tailReplacementCount

        host.update(
            markdownText: initial + " appended",
            typography: typography,
            maximumNumberOfLines: nil,
            onOpenDocument: nil,
            onFlash: nil,
            backingScale: 2
        )

        XCTAssertEqual(host.nativeSelectedRange, NSRange(location: 6, length: 10))
        XCTAssertGreaterThan(host.tailReplacementCount, replacementCount)
    }

    func testIdenticalLongContentDoesNoRenderOrMeasurementWork() {
        let host = MarkdownNativeLayoutView(frame: .zero)
        let text = String(repeating: "## Heading\n\nLong **markdown** paragraph with `code`.\n\n", count: 1_500)
        host.update(
            markdownText: text,
            typography: typography,
            maximumNumberOfLines: nil,
            onOpenDocument: nil,
            onFlash: nil,
            backingScale: 2
        )
        let initialHeight = host.measuredHeight(for: 640, backingScale: 2)
        let invalidations = host.measurementInvalidationCount
        let replacements = host.tailReplacementCount
        let measurementPasses = host.measurementPassCount

        XCTAssertFalse(host.update(
            markdownText: text,
            typography: typography,
            maximumNumberOfLines: nil,
            onOpenDocument: nil,
            onFlash: nil,
            backingScale: 2
        ))
        XCTAssertEqual(host.measurementInvalidationCount, invalidations)
        XCTAssertEqual(host.tailReplacementCount, replacements)
        XCTAssertEqual(host.measurementPassCount, measurementPasses)
        XCTAssertEqual(host.measuredHeight(for: 640, backingScale: 2), initialHeight)
        XCTAssertEqual(host.measurementPassCount, measurementPasses)

        XCTAssertTrue(host.update(
            markdownText: text,
            typography: typography,
            maximumNumberOfLines: 3,
            onOpenDocument: nil,
            onFlash: nil,
            backingScale: 2
        ))
        XCTAssertGreaterThan(host.measurementInvalidationCount, invalidations)
        XCTAssertEqual(host.tailReplacementCount, replacements)
    }

    func testLongStreamingMarkdownPerformance() throws {
        guard ProcessInfo.processInfo.environment["PIPIUI_RUN_MARKDOWN_STREAM_PERF"] == "1" else {
            throw XCTSkip("set PIPIUI_RUN_MARKDOWN_STREAM_PERF=1 to run the long streaming benchmark")
        }

        for byteCount in [64 * 1024, 128 * 1024] {
            let prefixes = streamingPrefixes(targetBytes: byteCount, flushes: 200)

            let parseSeconds = elapsed {
                for prefix in prefixes { _ = MarkdownTextView.parse(prefix) }
            }
            let attributedSeconds = elapsed {
                for prefix in prefixes {
                    _ = MarkdownSelectionContent.attributedString(for: prefix, typography: typography)
                }
            }

            let attributed = prefixes.map {
                MarkdownSelectionContent.attributedString(for: $0, typography: typography)
            }
            let nativeSeconds = elapsed {
                let host = MarkdownNativeLayoutView(frame: .zero)
                for value in attributed {
                    host.update(
                        attributedText: value,
                        bodyFont: typography.bodyNSFont,
                        maximumNumberOfLines: nil,
                        onOpenDocument: nil,
                        onFlash: nil,
                        backingScale: 2
                    )
                    _ = host.measuredHeight(for: 640, backingScale: 2)
                }
            }

            let optimizedSeconds = elapsed {
                let host = MarkdownNativeLayoutView(frame: .zero)
                for prefix in prefixes {
                    host.update(
                        markdownText: prefix,
                        typography: typography,
                        maximumNumberOfLines: nil,
                        onOpenDocument: nil,
                        onFlash: nil,
                        backingScale: 2
                    )
                    _ = host.measuredHeight(for: 640, backingScale: 2)
                }
            }

            print(String(
                format: "MARKDOWN_STREAM bytes=%d flushes=200 parse=%.4fs attributed=%.4fs native=%.4fs baseline_total=%.4fs optimized_total=%.4fs speedup=%.2fx",
                byteCount,
                parseSeconds,
                attributedSeconds,
                nativeSeconds,
                parseSeconds + attributedSeconds + nativeSeconds,
                optimizedSeconds,
                (parseSeconds + attributedSeconds + nativeSeconds) / optimizedSeconds
            ))
        }
    }

    private func elapsed(_ work: () -> Void) -> TimeInterval {
        let start = ProcessInfo.processInfo.systemUptime
        work()
        return ProcessInfo.processInfo.systemUptime - start
    }

    private func streamingPrefixes(targetBytes: Int, flushes: Int) -> [String] {
        let unit = """
        ## Streaming section

        A realistic paragraph with **bold**, *italic*, `code`, and /tmp/example.md links.

        | Key | Value |
        | --- | --- |
        | agent | running |

        - first item
        - second item

        > quoted status

        ```swift
        let value = 42
        ```

        """
        var target = ""
        while target.utf8.count < targetBytes { target += unit }
        target = String(target.prefix(targetBytes))
        return (1...flushes).map { step in
            String(target.prefix(target.count * step / flushes))
        }
    }
}
