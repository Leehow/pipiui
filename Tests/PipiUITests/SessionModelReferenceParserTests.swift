import XCTest
@testable import PipiUI

final class SessionModelReferenceParserTests: XCTestCase {
    func testReturnsLatestModelChangeFromTail() {
        let jsonl = """
        {"type":"model_change","provider":"anthropic","modelId":"claude-sonnet-4-6"}
        {"type":"message","message":{"role":"assistant"}}
        {"type":"model_change","provider":"xai","modelId":"grok-4.5"}
        """

        XCTAssertEqual(
            SessionModelReferenceParser.latestModelRef(in: Data(jsonl.utf8)),
            "xai/grok-4.5"
        )
    }

    func testAcceptsNestedSetModelAndIgnoresTruncatedLine() {
        let jsonl = """
        truncated JSON prefix
        {"type":"set_model","model":{"provider":"openai","id":"gpt-5"}}
        """

        XCTAssertEqual(
            SessionModelReferenceParser.latestModelRef(in: Data(jsonl.utf8)),
            "openai/gpt-5"
        )
    }

    func testReturnsNilWithoutCompleteModelRecord() {
        let jsonl = """
        {"type":"model_change","provider":"xai"}
        {"type":"message","message":{"role":"assistant"}}
        """

        XCTAssertNil(SessionModelReferenceParser.latestModelRef(in: Data(jsonl.utf8)))
    }
}
