import XCTest
@testable import PipiUI

final class ToolCallSummaryTests: XCTestCase {

    func testWritePathAndContent() {
        let args = J(["path": "a.swift", "content": "hello!"])
        let r = ToolCallSummary.summarize(name: "write", args: args)
        XCTAssertEqual(r.summary, "a.swift")
        XCTAssertEqual(r.payloadChars, 6)
    }

    func testWriteMissingPathNoJSON() {
        let args = J(["content": " partial"])
        let r = ToolCallSummary.summarize(name: "write", args: args)
        XCTAssertEqual(r.summary, "…")
        XCTAssertFalse(r.summary.contains("{"))
        XCTAssertEqual(r.payloadChars, 8)
    }

    func testWriteFilePathAlias() {
        let args = J(["file_path": "b.swift", "content": "ab"])
        let r = ToolCallSummary.summarize(name: "write", args: args)
        XCTAssertEqual(r.summary, "b.swift")
        XCTAssertEqual(r.payloadChars, 2)
    }

    func testEditSumsNewText() {
        let args = J([
            "path": "f.swift",
            "edits": [
                ["oldText": "a", "newText": "ab"],
                ["oldText": "x", "newText": "xyz"],
            ] as [[String: String]],
        ])
        let r = ToolCallSummary.summarize(name: "edit", args: args)
        XCTAssertEqual(r.summary, "f.swift")
        XCTAssertEqual(r.payloadChars, 5) // "ab" + "xyz"
    }

    func testEditLegacyNewText() {
        let args = J(["path": "f.swift", "oldText": "a", "newText": "hello"])
        let r = ToolCallSummary.summarize(name: "edit", args: args)
        XCTAssertEqual(r.summary, "f.swift")
        XCTAssertEqual(r.payloadChars, 5)
    }

    func testBashUnchanged() {
        let args = J(["command": "ls"])
        let r = ToolCallSummary.summarize(name: "bash", args: args)
        XCTAssertEqual(r.summary, "ls")
        XCTAssertEqual(r.payloadChars, 0)
    }

    func testGenerateImageShowsPromptNotJSON() {
        let args = J(["prompt": "一只猫", "confirmed": true])
        let r = ToolCallSummary.summarize(name: "generate_image", args: args)
        XCTAssertEqual(r.summary, "一只猫")
        XCTAssertFalse(r.summary.contains("{"))
        XCTAssertEqual(r.payloadChars, 0)
    }

    func testSummarizeArgsJSONString() {
        let r = ToolCallSummary.summarize(name: "read", argsJSON: #"{"path":"Sources/Foo.swift"}"#)
        XCTAssertEqual(r.summary, "Sources/Foo.swift")
        XCTAssertFalse(r.summary.contains("{"))
    }

    /// Subagent log truncates edit args at 400 chars — JSON becomes invalid; still show path.
    func testSummarizeTruncatedEditJSONShowsPath() {
        let truncated = #"{"path":"Sources/PipiUI/Logging/TokenUsageStats.swift","edits":[{"oldText":"func foo() {\n    return 1\n}\n","newText":"func foo() {\n    return 2\n}\n"#
        let r = ToolCallSummary.summarize(name: "edit", argsJSON: truncated)
        XCTAssertEqual(r.summary, "Sources/PipiUI/Logging/TokenUsageStats.swift")
        XCTAssertFalse(r.summary.contains("{"))
    }

    func testSummarizeTruncatedBashJSONShowsCommand() {
        let truncated = #"{"command":"swift test 2>&1 | tee /tmp/pipiui_test.log | grep -i fail | head -40; echo \"---TAIL"#
        let r = ToolCallSummary.summarize(name: "bash", argsJSON: truncated)
        XCTAssertTrue(r.summary.hasPrefix("swift test 2>&1"))
        XCTAssertFalse(r.summary.hasPrefix("{"))
    }

    func testSummarizePlainPathPassthrough() {
        let r = ToolCallSummary.summarize(name: "edit", argsJSON: "Sources/PipiUI/App.swift")
        XCTAssertEqual(r.summary, "Sources/PipiUI/App.swift")
    }

    func testSummarizeActivityStripsJSON() {
        let s = ToolCallSummary.summarizeActivity(
            #"read {"path":"/Users/haoli/leehow/code/pipiui/Sources/PipiUI/Logging/Log.swift"}"#
        )
        XCTAssertEqual(s, "/Users/haoli/leehow/code/pipiui/Sources/PipiUI/Logging/Log.swift")
        XCTAssertFalse(s.contains("{"))
    }

    func testSummarizeActivityBashCommand() {
        let s = ToolCallSummary.summarizeActivity(#"bash {"command":"ls -la"}"#)
        XCTAssertEqual(s, "ls -la")
    }

    func testSummarizeActivityTruncatedEdit() {
        let s = ToolCallSummary.summarizeActivity(
            #"edit {"path":"Sources/PipiUI/Foo.swift","edits":[{"oldText":"a","newText":"bb"#
        )
        XCTAssertEqual(s, "Sources/PipiUI/Foo.swift")
        XCTAssertFalse(s.contains("{"))
    }

    func testSummarizeActivityEmpty() {
        XCTAssertEqual(ToolCallSummary.summarizeActivity(""), "")
        XCTAssertEqual(ToolCallSummary.summarizeActivity("   "), "")
    }

    func testLabelSuffixFromCharCount() {
        XCTAssertNil(ThinkingTokenEstimate.labelSuffix(charCount: 0))
        XCTAssertEqual(
            ThinkingTokenEstimate.labelSuffix(charCount: 4800),
            "~1.2k tokens"
        )
    }

    func testConvertWritePopulatesPayloadChars() {
        let message = J([
            "role": "assistant",
            "content": [
                [
                    "type": "toolCall",
                    "id": "t1",
                    "name": "write",
                    "arguments": ["path": "x.py", "content": "abcd"],
                ] as [String: Any],
            ] as [[String: Any]],
        ])
        let item = ChatSession.convert(message: message, id: "i1")
        guard case .toolCall(let call)? = item?.blocks.first else {
            return XCTFail("expected toolCall")
        }
        XCTAssertEqual(call.argsSummary, "x.py")
        XCTAssertEqual(call.payloadChars, 4)
    }

    // MARK: - find

    func testFindPatternAndPath() {
        let args = J(["pattern": "*.swift", "path": "Sources"])
        let r = ToolCallSummary.summarize(name: "find", args: args)
        XCTAssertEqual(r.summary, "*.swift in Sources")
        XCTAssertEqual(r.payloadChars, 0)
        XCTAssertFalse(r.summary.contains("{"))
    }

    func testFindPatternOnly() {
        let args = J(["pattern": "*.md"])
        let r = ToolCallSummary.summarize(name: "find", args: args)
        XCTAssertEqual(r.summary, "*.md")
        XCTAssertEqual(r.payloadChars, 0)
        XCTAssertFalse(r.summary.contains("{"))
    }

    func testFindMissingPatternWithPathDefaultsToStar() {
        let args = J(["path": "Sources"])
        let r = ToolCallSummary.summarize(name: "find", args: args)
        XCTAssertEqual(r.summary, "* in Sources")
        XCTAssertEqual(r.payloadChars, 0)
        XCTAssertFalse(r.summary.contains("{"))
    }

    func testFindEmptyPatternWithNoPathDefaultsToStar() {
        let args = J(["pattern": ""])
        let r = ToolCallSummary.summarize(name: "find", args: args)
        XCTAssertEqual(r.summary, "*")
        XCTAssertEqual(r.payloadChars, 0)
    }

    func testFindEmptyArgsDefaultsToStar() {
        let args = J([String: String]())
        let r = ToolCallSummary.summarize(name: "find", args: args)
        XCTAssertEqual(r.summary, "*")
        XCTAssertEqual(r.payloadChars, 0)
    }

    func testFindMalformedArgsJSONScrapesPatternAndPath() {
        // Missing closing brace → invalid JSON; both fields still scrapable.
        let malformed = #"{"pattern":"*.swift","path":"Sources""#
        let r = ToolCallSummary.summarize(name: "find", argsJSON: malformed)
        XCTAssertEqual(r.summary, "*.swift in Sources")
        XCTAssertEqual(r.payloadChars, 0)
        XCTAssertFalse(r.summary.contains("{"))
    }

    func testFindTruncatedArgsJSONPatternOnly() {
        let truncated = #"{"pattern":"*.md""#
        let r = ToolCallSummary.summarize(name: "find", argsJSON: truncated)
        XCTAssertEqual(r.summary, "*.md")
        XCTAssertEqual(r.payloadChars, 0)
        XCTAssertFalse(r.summary.contains("{"))
    }

    func testSummarizeActivityFindEscapedQuotes() {
        // Subagent activity logs embed tool args as a JSON string, so quotes are
        // escaped. Must still render the readable summary, never raw `{…}`.
        let s = ToolCallSummary.summarizeActivity(
            #"find {\"pattern\":\"*.swift\",\"path\":\"Sources\"}"#
        )
        XCTAssertEqual(s, "*.swift in Sources")
        XCTAssertFalse(s.contains("{"))
    }

    // MARK: - find malformed/truncated must never expose `{` (critical fix 1)

    func testFindMinimalBraceNeverExposed() {
        // Minimal malformed `{` must collapse to the readable find fallback.
        let r = ToolCallSummary.summarize(name: "find", argsJSON: "{")
        XCTAssertEqual(r.summary, "*")
        XCTAssertFalse(r.summary.contains("{"))
        XCTAssertEqual(r.payloadChars, 0)
    }

    func testFindTruncatedEscapedPatternKeyNeverExposed() {
        // Doubly-escaped, truncated pattern key (activity-log style) with no
        // complete value and no path → readable `*` fallback, never raw `{…}`.
        let r = ToolCallSummary.summarize(name: "find", argsJSON: #"{\"pattern\":\""#)
        XCTAssertEqual(r.summary, "*")
        XCTAssertFalse(r.summary.contains("{"))
        XCTAssertEqual(r.payloadChars, 0)
    }

    func testSummarizeActivityFindMinimalBraceNeverExposed() {
        // `find {` activity payload must collapse to the find fallback, not `{`.
        let s = ToolCallSummary.summarizeActivity("find {")
        XCTAssertEqual(s, "*")
        XCTAssertFalse(s.contains("{"))
    }

    // MARK: - escaped-JSON unescape is find-only (critical fix 2)

    func testNonFindEscapedMalformedDoesNotUnescape() {
        // Doubly-escaped tool-arg JSON is unescaped only on find's path; bash and
        // other tools keep their prior behavior (no find-specific rescrape), so the
        // raw escaped text is returned as-is — NOT the scraped "ls".
        let escaped = #"{\"command\":\"ls"#
        let r = ToolCallSummary.summarize(name: "bash", argsJSON: escaped)
        XCTAssertEqual(r.summary, escaped)
        XCTAssertEqual(r.payloadChars, 0)
    }

    // MARK: - grep

    func testGrepPatternAndPath() {
        let args = J(["pattern": "foo", "path": "Sources"])
        let r = ToolCallSummary.summarize(name: "grep", args: args)
        XCTAssertEqual(r.summary, "/foo/ in Sources")
        XCTAssertEqual(r.payloadChars, 0)
        XCTAssertFalse(r.summary.contains("{"))
    }

    func testGrepPatternOnly() {
        let args = J(["pattern": "foo"])
        let r = ToolCallSummary.summarize(name: "grep", args: args)
        XCTAssertEqual(r.summary, "/foo/")
        XCTAssertEqual(r.payloadChars, 0)
        XCTAssertFalse(r.summary.contains("{"))
    }

    func testGrepMissingPatternWithPathDefaultsToEllipsis() {
        let args = J(["path": "Sources"])
        let r = ToolCallSummary.summarize(name: "grep", args: args)
        XCTAssertEqual(r.summary, "/…/ in Sources")
        XCTAssertEqual(r.payloadChars, 0)
        XCTAssertFalse(r.summary.contains("{"))
    }

    func testGrepEmptyPatternWithNoPathDefaultsToEllipsis() {
        let args = J(["pattern": ""])
        let r = ToolCallSummary.summarize(name: "grep", args: args)
        XCTAssertEqual(r.summary, "/…/")
        XCTAssertEqual(r.payloadChars, 0)
    }

    func testGrepEmptyArgsDefaultsToEllipsis() {
        let args = J([String: String]())
        let r = ToolCallSummary.summarize(name: "grep", args: args)
        XCTAssertEqual(r.summary, "/…/")
        XCTAssertEqual(r.payloadChars, 0)
    }

    func testGrepMalformedArgsJSONScrapesPatternAndPath() {
        // Missing closing brace → invalid JSON; both fields still scrapable.
        let malformed = #"{"pattern":"foo","path":"Sources""#
        let r = ToolCallSummary.summarize(name: "grep", argsJSON: malformed)
        XCTAssertEqual(r.summary, "/foo/ in Sources")
        XCTAssertEqual(r.payloadChars, 0)
        XCTAssertFalse(r.summary.contains("{"))
    }

    func testGrepTruncatedArgsJSONPatternOnly() {
        let truncated = #"{"pattern":"foo""#
        let r = ToolCallSummary.summarize(name: "grep", argsJSON: truncated)
        XCTAssertEqual(r.summary, "/foo/")
        XCTAssertEqual(r.payloadChars, 0)
        XCTAssertFalse(r.summary.contains("{"))
    }

    // MARK: - grep malformed/truncated must never expose `{` (critical fix 1)

    func testGrepMinimalBraceNeverExposed() {
        // Minimal malformed `{` must collapse to the readable grep fallback.
        let r = ToolCallSummary.summarize(name: "grep", argsJSON: "{")
        XCTAssertEqual(r.summary, "/…/")
        XCTAssertFalse(r.summary.contains("{"))
        XCTAssertEqual(r.payloadChars, 0)
    }

    func testGrepTruncatedEscapedPatternKeyNeverExposed() {
        // Doubly-escaped, truncated pattern key (activity-log style) with no
        // complete value and no path → readable `/…/` fallback, never raw `{…}`.
        let r = ToolCallSummary.summarize(name: "grep", argsJSON: #"{\"pattern\":""#)
        XCTAssertEqual(r.summary, "/…/")
        XCTAssertFalse(r.summary.contains("{"))
        XCTAssertEqual(r.payloadChars, 0)
    }

    // MARK: - grep activity (regular + escaped) must be readable, no `{`

    func testSummarizeActivityGrepRegular() {
        let s = ToolCallSummary.summarizeActivity(#"grep {\"pattern\":\"foo\",\"path\":\"Sources\"}"#)
        XCTAssertEqual(s, "/foo/ in Sources")
        XCTAssertFalse(s.contains("{"))
    }

    func testSummarizeActivityGrepEscapedQuotes() {
        // Subagent activity logs embed tool args as a JSON string, so quotes are
        // escaped. Must still render the readable summary, never raw `{…}`.
        let s = ToolCallSummary.summarizeActivity(
            #"grep {\"pattern\":\"foo\",\"path\":\"Sources\"}"#
        )
        XCTAssertEqual(s, "/foo/ in Sources")
        XCTAssertFalse(s.contains("{"))
    }

    func testSummarizeActivityGrepMinimalBraceNeverExposed() {
        // `grep {` activity payload must collapse to the grep fallback, not `{`.
        let s = ToolCallSummary.summarizeActivity("grep {")
        XCTAssertEqual(s, "/…/")
        XCTAssertFalse(s.contains("{"))
    }
}
