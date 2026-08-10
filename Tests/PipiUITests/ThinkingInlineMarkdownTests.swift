import AppKit
import XCTest
@testable import PipiUI

/// Regression tests for the GPT 5.6 "Thinking" card markdown-delimiter leak.
///
/// Root cause being guarded: `ThinkingBlockView`/subagent thinking rows rendered raw
/// thinking text with plain `Text(...)` + `.italic()`, so model output like
/// `**Assessing ...**` showed the literal `**` delimiters. The display layer now routes
/// through `MarkdownTextView.thinkingInline(_:)`, which parses inline markdown (so paired
/// `**...**` becomes bold and the delimiters are consumed) and bakes italic into every run.
/// Storage and streaming raw text are intentionally untouched — only the rendered
/// `AttributedString` changes.
final class ThinkingInlineMarkdownTests: XCTestCase {

    override func setUp() {
        super.setUp()
        MarkdownTextView.clearThinkingInlineCache()
    }

    // MARK: - Delimiter leak (the reported bug)

    /// `**Title**` must not leave any bare `*` in the rendered characters, and "Title"
    /// must carry bold intent. This is the core regression: previously the whole chunk
    /// was shown verbatim, so the user saw `**Title**`.
    func testBoldTitleDoesNotLeakDelimiters() {
        let result = MarkdownTextView.thinkingInline("**Title**")

        XCTAssertEqual(String(result.characters), "Title", "paired ** delimiters must be consumed")
        XCTAssertFalse(
            String(result.characters).contains("*"),
            "rendered thinking text must not leak any '*' delimiter"
        )

        let boldRun = result.runs.first { run in
            run.inlinePresentationIntent?.contains(.stronglyEmphasized) == true
        }
        XCTAssertNotNil(boldRun, "**Title** must render as a bold run")
        XCTAssertEqual(String(result[boldRun!.range].characters), "Title")
    }

    /// The model's actual phrasing — `**Assessing …**` followed by prose — renders bold
    /// on the heading and plain on the rest, with no stray `*` anywhere.
    func testAssessingHeaderPlusProseNoLeak() {
        let result = MarkdownTextView.thinkingInline("**Assessing the request** then planning steps")

        let rendered = String(result.characters)
        XCTAssertFalse(rendered.contains("*"), "leaked delimiter: \(rendered)")
        XCTAssertEqual(rendered, "Assessing the request then planning steps")

        let bold = result.runs.contains { run in
            run.inlinePresentationIntent?.contains(.stronglyEmphasized) == true
        }
        XCTAssertTrue(bold, "the **Assessing the request** span must be bold")
    }

    // MARK: - Plain text invariance

    /// Plain thinking text (no markdown markers) must come through character-for-character
    /// identical — only display attributes (italic) are added.
    func testPlainTextCharactersUnchanged() {
        let plain = "考虑用户的需求，然后规划步骤。No markup here."
        let result = MarkdownTextView.thinkingInline(plain)
        XCTAssertEqual(String(result.characters), plain)
    }

    /// Empty / whitespace-only thinking text is handled without crashing or inventing content.
    func testEmptyAndWhitespaceUnchanged() {
        XCTAssertEqual(String(MarkdownTextView.thinkingInline("").characters), "")
        let spaces = "   \n  "
        XCTAssertEqual(String(MarkdownTextView.thinkingInline(spaces).characters), spaces)
    }

    // MARK: - Italic semantic preserved

    /// Every run must carry `.emphasized` (italic) so the block still reads as reasoning,
    /// and bold spans additionally keep `.stronglyEmphasized` (bold-italic, not clobbered).
    func testItalicBakedIntoEveryRunAndBoldPreserved() {
        let result = MarkdownTextView.thinkingInline("plain **bold** plain")

        XCTAssertFalse(result.runs.isEmpty)
        for run in result.runs {
            let intent = run.inlinePresentationIntent ?? []
            XCTAssertTrue(
                intent.contains(.emphasized),
                "every thinking run must be italic; run was \(String(result[run.range].characters))"
            )
        }

        let boldItalic = result.runs.first { run in
            let intent = run.inlinePresentationIntent ?? []
            return intent.contains(.stronglyEmphasized) && intent.contains(.emphasized)
        }
        XCTAssertNotNil(boldItalic, "bold span must remain bold AND become italic")
        XCTAssertEqual(String(result[boldItalic!.range].characters), "bold")
    }

    // MARK: - Streaming-partial robustness

    /// While streaming, a `**` whose closing pair has not arrived yet is genuinely unpaired.
    /// Foundation renders it literally — no crash, no swallowed content — and the moment the
    /// pair completes it becomes bold. This guards that we never drop user-visible bytes.
    func testUnpairedAsterisksRenderedLiterally() {
        let partial = MarkdownTextView.thinkingInline("**Assessing")
        XCTAssertEqual(String(partial.characters), "**Assessing")

        let completed = MarkdownTextView.thinkingInline("**Assessing**")
        XCTAssertEqual(String(completed.characters), "Assessing")
    }

    /// Inline code spans (common in reasoning) render without backticks leaking.
    func testInlineCodeBackticksConsumed() {
        let result = MarkdownTextView.thinkingInline("see `foo()` in the plan")
        XCTAssertEqual(String(result.characters), "see foo() in the plan")
        XCTAssertFalse(String(result.characters).contains("`"))
    }

    // MARK: - Cache

    /// Same input returns an equal rendered result on the cache hit.
    func testCacheReturnsEqualResult() {
        let text = "**x** and prose"
        let first = MarkdownTextView.thinkingInline(text)
        let second = MarkdownTextView.thinkingInline(text)
        XCTAssertEqual(String(first.characters), String(second.characters))
        XCTAssertTrue(
            first.runs.elementsEqual(second.runs, by: { $0.attributes == $1.attributes }),
            "cache hit must preserve run attributes"
        )
    }

    /// Clearing the cache forces a recompute that is still correct.
    func testClearCacheForcesReparse() {
        let text = "**Title**"
        let first = MarkdownTextView.thinkingInline(text)
        MarkdownTextView.clearThinkingInlineCache()
        let second = MarkdownTextView.thinkingInline(text)
        XCTAssertEqual(String(first.characters), String(second.characters))
        XCTAssertFalse(String(second.characters).contains("*"))
    }
}
