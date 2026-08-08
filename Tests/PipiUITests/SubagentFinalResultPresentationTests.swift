import XCTest
@testable import PipiUI

final class SubagentFinalResultPresentationTests: XCTestCase {
    private func textItem(_ id: Int, _ text: String) -> AgentLogItem {
        AgentLogItem(id: id, kind: "text", name: "", text: text, isError: false)
    }

    private func toolItem(_ id: Int, name: String = "bash") -> AgentLogItem {
        AgentLogItem(id: id, kind: "tool", name: name, text: "{}", isError: false)
    }

    // MARK: - Heading strip / display body

    func testStripLeadingOutcomeHeading() {
        let raw = """
        ## Outcome

        Compact flat top-right chrome.
        """
        XCTAssertEqual(
            SubagentFinalResultPresentation.stripLeadingResultHeading(raw),
            "Compact flat top-right chrome."
        )
        XCTAssertEqual(
            SubagentFinalResultPresentation.displayBody(from: raw),
            "Compact flat top-right chrome."
        )
    }

    func testStripFinalResultAndChineseHeadings() {
        XCTAssertEqual(
            SubagentFinalResultPresentation.stripLeadingResultHeading("# Final result\n\nDone."),
            "Done."
        )
        XCTAssertEqual(
            SubagentFinalResultPresentation.stripLeadingResultHeading("# 最终结果：\n\n完成。"),
            "完成。"
        )
        XCTAssertEqual(
            SubagentFinalResultPresentation.stripLeadingResultHeading("### Outcome:\nbody"),
            "body"
        )
    }

    func testDoesNotStripUnrelatedHeading() {
        let raw = "## Implementation\n\nDetails here."
        XCTAssertEqual(
            SubagentFinalResultPresentation.stripLeadingResultHeading(raw),
            raw.replacingOccurrences(of: "\r\n", with: "\n")
        )
    }

    // MARK: - Normalization + exact match

    func testExactMatchAfterWhitespaceNormalization() {
        let log = "  ## Outcome\n\nHello   world  \n"
        let output = "# Outcome\nHello world"
        XCTAssertTrue(
            SubagentFinalResultPresentation.isEquivalentFinalOutput(logText: log, output: output)
        )
    }

    func testExactMatchWithoutHeading() {
        XCTAssertTrue(
            SubagentFinalResultPresentation.isEquivalentFinalOutput(
                logText: "Build succeeded.",
                output: "Build succeeded."
            )
        )
    }

    // MARK: - Cap-aware containment (last text only via suppress helper)

    func testHeadCappedLogIsPrefixOfFullerOutput() {
        let head = String(repeating: "A", count: 100)
        let full = head + String(repeating: "B", count: 50)
        XCTAssertTrue(
            SubagentFinalResultPresentation.isEquivalentFinalOutput(logText: head, output: full)
        )
    }

    func testTailCappedOutputIsSuffixOfLongerLogNormalizedBody() {
        // Simulate log holding a longer normalized body whose tail matches stored output.
        let tail = String(repeating: "Z", count: 80)
        let logBody = String(repeating: "Y", count: 40) + tail
        XCTAssertTrue(
            SubagentFinalResultPresentation.isEquivalentFinalOutput(logText: logBody, output: tail)
        )
    }

    func testTinyPrefixDoesNotSuppress() {
        // Below containmentMinChars — exact mismatch must not use containment.
        XCTAssertFalse(
            SubagentFinalResultPresentation.isEquivalentFinalOutput(
                logText: "ok",
                output: "ok, here is the full report with many details"
            )
        )
    }

    func testCappedTerminalLogVsFullOutputSuppressesLastTextOnly() {
        let body = String(repeating: "M", count: 120)
        let earlierDistinct = "## Outcome\n\nEarlier draft that must stay visible."
        let terminal = "## Outcome\n\n\(body)"
        let output = "# Outcome\n\n\(body)EXTRA" // longer; log is prefix after normalize+strip
        let log = [
            textItem(1, earlierDistinct),
            toolItem(2),
            textItem(3, terminal),
        ]

        let suppress = SubagentFinalResultPresentation.terminalTextLogItemIDToSuppress(
            log: log,
            output: output
        )
        XCTAssertEqual(suppress, 3)

        // Earlier distinct Outcome text is not the suppress target.
        XCTAssertNotEqual(suppress, 1)
        XCTAssertFalse(
            SubagentFinalResultPresentation.isEquivalentFinalOutput(
                logText: earlierDistinct,
                output: output
            )
        )
    }

    func testDistinctEarlierMessageRemainsWhenTerminalDiffers() {
        let earlier = "## Outcome\n\nFirst pass notes."
        let terminal = "Still working on the summary."
        let output = "## Outcome\n\nFinal polished answer."
        let log = [
            textItem(1, earlier),
            textItem(2, terminal),
        ]
        XCTAssertNil(
            SubagentFinalResultPresentation.terminalTextLogItemIDToSuppress(
                log: log,
                output: output
            )
        )
    }

    func testEmptyOutputNeverSuppresses() {
        let log = [textItem(1, "## Outcome\n\nHello")]
        XCTAssertNil(
            SubagentFinalResultPresentation.terminalTextLogItemIDToSuppress(log: log, output: "")
        )
        XCTAssertFalse(SubagentFinalResultPresentation.shouldShowCard(output: "  \n"))
    }

    func testSuppressOnlyLastTextEvenIfEarlierMatchesOutput() {
        let shared = String(repeating: "S", count: 80)
        let output = "## Outcome\n\n\(shared)"
        let log = [
            textItem(1, output), // same content earlier
            toolItem(2),
            textItem(3, "unrelated trailing note"),
        ]
        // Last text is not equivalent → no suppress (earlier match is intentionally kept).
        XCTAssertNil(
            SubagentFinalResultPresentation.terminalTextLogItemIDToSuppress(
                log: log,
                output: output
            )
        )
    }

    func testCollapsedLineLimitIsEight() {
        XCTAssertEqual(SubagentFinalResultPresentation.collapsedLineLimit, 8)
    }
}
