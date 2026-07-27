import XCTest
@testable import PipiUI

final class ToolOutputRenderBudgetTests: XCTestCase {
    func testSmallOutputIsPreservedExactly() {
        let output = "line one\nline two"
        XCTAssertEqual(
            ToolOutputRenderBudget.preview(
                output: output,
                expanded: false
            ),
            ToolOutputRenderPreview(text: output, isTruncated: false)
        )
        XCTAssertEqual(
            ToolOutputRenderBudget.preview(
                output: output,
                expanded: true
            ),
            ToolOutputRenderPreview(text: output, isTruncated: false)
        )
    }

    func testExpandedOutputNeverExceedsHardRenderBudget() {
        let output = String(repeating: "大", count: 300_000)
        let preview = ToolOutputRenderBudget.preview(
            output: output,
            expanded: true
        )

        XCTAssertTrue(preview.isTruncated)
        XCTAssertLessThanOrEqual(
            preview.text.utf16.count,
            ToolOutputRenderBudget.expandedUTF16Limit
        )
        XCTAssertTrue(preview.text.contains("Output truncated for display"))
        XCTAssertTrue(preview.text.contains("Full result remains in session data"))
        XCTAssertEqual(output.utf16.count, 300_000)
    }

    func testCollapsedSingleLineOutputIsAlsoBounded() {
        let output = String(repeating: "x", count: 100_000)
        let preview = ToolOutputRenderBudget.preview(
            output: output,
            expanded: false
        )

        XCTAssertTrue(preview.isTruncated)
        XCTAssertLessThanOrEqual(
            preview.text.utf16.count,
            ToolOutputRenderBudget.collapsedUTF16Limit
        )
        XCTAssertTrue(preview.text.contains("Output truncated for display"))
    }

    func testCollapsedManyLongLinesRemainInsideTheSameBudget() {
        let output = (0..<100).map {
            "line-\($0)-" + String(repeating: "x", count: 800)
        }.joined(separator: "\n")
        let preview = ToolOutputRenderBudget.preview(
            output: output,
            expanded: false
        )

        XCTAssertTrue(preview.isTruncated)
        XCTAssertLessThanOrEqual(
            preview.text.utf16.count,
            ToolOutputRenderBudget.collapsedUTF16Limit
        )
    }

    func testExpandedPrefixNeverSplitsExtendedGraphemeClusters() {
        let contentBudget =
            ToolOutputRenderBudget.expandedUTF16Limit - 180
        let clusters = [
            ("e\u{301}", 1),
            ("👩‍💻", 2),
        ]

        for (cluster, remainingBudget) in clusters {
            XCTAssertGreaterThan(cluster.utf16.count, remainingBudget)
            let prefix = String(
                repeating: "a",
                count: contentBudget - remainingBudget
            )
            let output =
                prefix + cluster + String(repeating: "z", count: 1_000)
            let preview = ToolOutputRenderBudget.preview(
                output: output,
                expanded: true
            )
            let retained = preview.text.components(
                separatedBy: "\n[Output truncated for display:"
            )[0]

            XCTAssertTrue(preview.isTruncated)
            XCTAssertLessThanOrEqual(
                preview.text.utf16.count,
                ToolOutputRenderBudget.expandedUTF16Limit
            )
            XCTAssertEqual(
                retained,
                prefix,
                "prefix must omit the entire cluster \(cluster)"
            )
        }
    }

    func testCollapsedMultilineSuffixNeverSplitsExtendedGraphemeClusters() {
        let contentBudget =
            ToolOutputRenderBudget.collapsedUTF16Limit - 180
        let clusters = [
            ("e\u{301}", 1),
            ("👩‍💻", 2),
        ]

        for (cluster, remainingBudget) in clusters {
            XCTAssertGreaterThan(cluster.utf16.count, remainingBudget)
            let tail = multilineASCII(
                utf16Length: contentBudget - remainingBudget
            )
            let output =
                String(repeating: "p", count: 5_000) + cluster + tail
            let preview = ToolOutputRenderBudget.preview(
                output: output,
                expanded: false
            )

            XCTAssertTrue(preview.isTruncated)
            XCTAssertLessThanOrEqual(
                preview.text.utf16.count,
                ToolOutputRenderBudget.collapsedUTF16Limit
            )
            XCTAssertTrue(preview.text.hasSuffix(tail))
            if cluster == "e\u{301}" {
                XCTAssertFalse(preview.text.unicodeScalars.contains("\u{301}"))
            } else {
                XCTAssertFalse(preview.text.contains("👩"))
                XCTAssertFalse(preview.text.unicodeScalars.contains("\u{200D}"))
                XCTAssertFalse(preview.text.contains("💻"))
            }
        }
    }

    func testComputerImagesNeverCauseAutomaticExpansion() {
        XCTAssertFalse(ToolOutputRenderBudget.shouldAutoExpand(
            toolName: "computer",
            hasImages: true,
            hasText: true
        ))
        XCTAssertFalse(ToolOutputRenderBudget.shouldAutoExpand(
            toolName: "open_application",
            hasImages: true,
            hasText: true
        ))
        XCTAssertTrue(ToolOutputRenderBudget.shouldAutoExpand(
            toolName: "generate_image",
            hasImages: true,
            hasText: true
        ))
    }

    private func multilineASCII(utf16Length: Int) -> String {
        let prefix = "a\nb\nc\nd\n"
        precondition(utf16Length >= prefix.utf16.count)
        return prefix + String(
            repeating: "z",
            count: utf16Length - prefix.utf16.count
        )
    }
}
