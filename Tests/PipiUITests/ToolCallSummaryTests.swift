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
}
