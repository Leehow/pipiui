import XCTest
@testable import PipiUI

final class ThinkingChunkTests: XCTestCase {

    // MARK: - chunks(for:)

    /// Short text fits one chunk and is returned untouched (and never touches the cache).
    func testShortTextIsSingleChunkUntouched() {
        let text = "只言片语，不用切块。"
        let chunks = ThinkingChunkCache.chunks(for: text)
        XCTAssertEqual(chunks, [text])
    }

    /// Exactly at the budget (single line): still one chunk. Boundary is inclusive
    /// on the char budget — `<= maxChars` fits, `maxChars + 1` splits.
    func testAtBudgetIsSingleChunk() {
        let budget = ThinkingChunkBudget.maxChars
        let text = String(repeating: "a", count: budget)
        XCTAssertEqual(text.count, budget)
        let chunks = ThinkingChunkCache.chunks(for: text)
        XCTAssertEqual(chunks, [text])
    }

    /// One char over the budget on a single line → hard-sliced (no newline to break on).
    func testOverBudgetSingleLineHardSlices() {
        let budget = ThinkingChunkBudget.maxChars
        let text = String(repeating: "a", count: budget + 1)
        let chunks = ThinkingChunkCache.chunks(for: text)
        XCTAssertEqual(chunks.count, 2)
        // Hard-sliced chunks concatenate (no inserted separator) back to the input.
        XCTAssertEqual(chunks.joined(), text)
        XCTAssertEqual(chunks[0].count, budget)
        XCTAssertEqual(chunks[1].count, 1)
    }

    /// Crossing the budget splits on a newline boundary — never mid-line.
    func testSplitBreaksOnNewlineNotMidLine() {
        // Each line ~1/4 budget → 5 lines overflows the char budget after line 4.
        let quarter = String(repeating: "x", count: ThinkingChunkBudget.maxChars / 4)
        let lines = (0..<5).map { _ in quarter }
        let text = lines.joined(separator: "\n")
        let chunks = ThinkingChunkCache.chunks(for: text)

        XCTAssertGreaterThan(chunks.count, 1, "5 quarter-budget lines must split")
        // Round-trip: joining chunks with "\n" reproduces the input exactly.
        XCTAssertEqual(chunks.joined(separator: "\n"), text)
        // No chunk contains a partial line: each chunk's lines are all `quarter`.
        for chunk in chunks {
            for line in chunk.split(separator: "\n", omittingEmptySubsequences: false) {
                XCTAssertEqual(String(line), quarter, "a line got sliced mid-way")
            }
        }
    }

    /// The line-count budget also forces a split even when chars are sparse.
    func testLineCountBudgetForcesSplit() {
        let many = Int(ThinkingChunkBudget.maxLines) + 5
        let text = (0..<many).map { _ in "ok" }.joined(separator: "\n")
        let chunks = ThinkingChunkCache.chunks(for: text)
        XCTAssertGreaterThan(chunks.count, 1)
        XCTAssertEqual(chunks.joined(separator: "\n"), text)
        for chunk in chunks {
            let n = chunk.split(separator: "\n", omittingEmptySubsequences: false).count
            XCTAssertLessThanOrEqual(n, ThinkingChunkBudget.maxLines)
        }
    }

    /// Empty lines are preserved (not dropped) across the split.
    func testEmptyLinesPreserved() {
        let line = String(repeating: "a", count: ThinkingChunkBudget.maxChars / 2 + 10)
        // line, "", line, "", line → pushes over budget; blank lines must survive.
        let text = [line, "", line, "", line].joined(separator: "\n")
        let chunks = ThinkingChunkCache.chunks(for: text)
        XCTAssertEqual(chunks.joined(separator: "\n"), text, "blank lines dropped")
    }

    /// Caching: the same text returns a structurally-equal split on the second call.
    func testCacheReusesForSameText() {
        let line = String(repeating: "b", count: ThinkingChunkBudget.maxChars / 2)
        let text = [line, line, line].joined(separator: "\n")
        let first = ThinkingChunkCache.chunks(for: text)
        let second = ThinkingChunkCache.chunks(for: text)
        XCTAssertEqual(first, second)
    }

    // MARK: - tailWindow(of:)

    func testTailWindowReturnsWholeTextWhenUnderLimit() {
        let text = "短文本"
        XCTAssertEqual(ThinkingChunkCache.tailWindow(of: text), text)
    }

    func testTailWindowStartsAtLineBoundary() {
        // line1=AAA... (< limit so it dominates), line2 pushes over limit.
        let max = ThinkingChunkBudget.streamingTailChars
        let line1 = String(repeating: "A", count: max + 50)
        let line2 = String(repeating: "B", count: 100)
        let text = line1 + "\n" + line2
        let tail = ThinkingChunkCache.tailWindow(of: text)
        // Window never starts mid-line: it begins at "B..." (after the newline).
        XCTAssertTrue(tail.hasPrefix("B"), "tail sliced mid-line: \(tail.prefix(20))")
        XCTAssertEqual(tail, line2)
    }

    func testTailWindowLengthBounded() {
        let text = String(repeating: "Z", count: ThinkingChunkBudget.streamingTailChars * 4)
        let tail = ThinkingChunkCache.tailWindow(of: text)
        // One long line → window trims to the budget from the start.
        XCTAssertLessThanOrEqual(tail.count, ThinkingChunkBudget.streamingTailChars)
        XCTAssertGreaterThan(tail.count, 0)
    }

    /// Grapheme safety: a multi-byte tail must not slice a character.
    func testTailWindowIsGraphemeSafe() {
        // Each "é" is 2 UTF-8 bytes; ensure the window boundary doesn't corrupt one.
        let unit = "é"
        let max = ThinkingChunkBudget.streamingTailChars
        let count = max * 3
        let text = String(repeating: unit, count: count)
        let tail = ThinkingChunkCache.tailWindow(of: text)
        // Every char of the window is still "é" — no partial byte sequence.
        XCTAssertTrue(tail.allSatisfy { String($0) == unit })
    }

    // MARK: - Scaling

    /// Regression guard mirroring `LineFramerTests.testLargeSingleLineIsLinearAndFast`:
    /// a ~12 MB single-line thinking blob must split in well under a second. This
    /// is the worst case for the splitter (no newline to break on → hard-slice),
    /// and guards against the O(n²) `index(offsetBy:)`/`distance` regression that
    /// turned a 12 MB slice into a 60+ s hang on the first attempt.
    func testLargeSingleLineSplitsFast() {
        let size = 12 * 1024 * 1024
        let text = String(repeating: "A", count: size)

        let start = DispatchTime.now()
        let chunks = ThinkingChunkCache.chunks(for: text)
        let ms = Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000

        XCTAssertGreaterThan(chunks.count, 1, "12MB should split into many chunks")
        // Round-trip: hard-sliced chunks concatenate (no separator) back to input,
        // verifying no bytes were dropped or duplicated.
        XCTAssertEqual(chunks.joined(), text)
        XCTAssertLessThan(ms, 1000, "chunking 12MB took \(ms)ms — likely quadratic")
    }
}
