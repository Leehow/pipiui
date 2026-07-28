import Foundation
import XCTest
@testable import PipiUI

final class FinishedNonTextGroupPresentationTests: XCTestCase {
    private func tool(_ id: String, _ name: String = "browser") -> ChatBlock {
        .toolCall(
            ToolCallBlock(
                id: id,
                name: name,
                argsSummary: "navigate https://example.com"
            )
        )
    }

    func testMemberIdentityIsStableUniqueAndPreservesEveryBlock() {
        let blocks: [ChatBlock] = [
            .thinking("same reasoning"),
            .thinking("same reasoning"),
            tool("call-7"),
            tool("call-7"),
        ]

        let first = AssistantBlockLayout.finishedGroupMembers(blocks)
        let second = AssistantBlockLayout.finishedGroupMembers(blocks)

        XCTAssertEqual(first, second)
        XCTAssertEqual(first.map(\.block), blocks)
        XCTAssertEqual(Set(first.map(\.id)).count, blocks.count)
        XCTAssertTrue(first[2].id.contains("tool:call-7"))
        XCTAssertTrue(first[3].id.contains("tool:call-7"))
    }

    func testPresentationIdentityUsesSessionScopeSegmentAndMemberContent() {
        let blocks: [ChatBlock] = [.thinking("reasoning"), tool("call-1")]
        let baseline = AssistantBlockLayout.finishedGroupPresentation(
            sessionKey: "session-a",
            scopeID: "assistant-run-4",
            segmentIndex: 2,
            blocks: blocks
        )

        XCTAssertEqual(
            baseline,
            AssistantBlockLayout.finishedGroupPresentation(
                sessionKey: "session-a",
                scopeID: "assistant-run-4",
                segmentIndex: 2,
                blocks: blocks
            )
        )
        XCTAssertNotEqual(
            baseline.id,
            AssistantBlockLayout.finishedGroupPresentation(
                sessionKey: "session-b",
                scopeID: "assistant-run-4",
                segmentIndex: 2,
                blocks: blocks
            ).id
        )
        XCTAssertNotEqual(
            baseline.id,
            AssistantBlockLayout.finishedGroupPresentation(
                sessionKey: "session-a",
                scopeID: "assistant-run-5",
                segmentIndex: 2,
                blocks: blocks
            ).id
        )
        XCTAssertNotEqual(
            baseline.id,
            AssistantBlockLayout.finishedGroupPresentation(
                sessionKey: "session-a",
                scopeID: "assistant-run-4",
                segmentIndex: 3,
                blocks: blocks
            ).id
        )
        XCTAssertNotEqual(
            baseline.id,
            AssistantBlockLayout.finishedGroupPresentation(
                sessionKey: "session-a",
                scopeID: "assistant-run-4",
                segmentIndex: 2,
                blocks: [.thinking("different reasoning"), tool("call-1")]
            ).id
        )
    }

    func testPresentationSurvivesLogicalRebindButRejectsAnotherSession() {
        let session = ChatSession(
            id: "new:temporary",
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "test"
        )
        let presentation = AssistantBlockLayout.finishedGroupPresentation(
            sessionKey: session.bridgeRoutingKey,
            scopeID: "assistant-run",
            segmentIndex: 0,
            blocks: [.thinking("reasoning"), tool("call-1")]
        )

        session.rebindIdentity(to: "resume:/persisted.jsonl")

        XCTAssertTrue(presentation.belongs(to: session.bridgeRoutingKey))

        let anotherSession = ChatSession(
            id: "resume:/persisted.jsonl",
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: "/persisted.jsonl",
            blockedReason: "test"
        )
        XCTAssertFalse(presentation.belongs(to: anotherSession.bridgeRoutingKey))
    }

    func testTranscriptRowOnlyOpensStableParentPresentation() throws {
        let source = try messageViewsSource()
        let summary = try section(
            named: "struct FinishedNonTextGroupView: View",
            endingAt: "struct FinishedNonTextGroupDetailView: View",
            in: source
        )

        XCTAssertTrue(summary.contains("onOpen?(presentation)"))
        XCTAssertTrue(summary.contains("ForEach(fileChanges.files)"))
        XCTAssertTrue(summary.contains("Text(title)"))
        XCTAssertTrue(summary.contains("已编辑"))
        XCTAssertFalse(summary.contains("? title"))
        XCTAssertFalse(summary.contains("ScrollView"))
        XCTAssertFalse(summary.contains("@State private var expanded"))
        XCTAssertFalse(summary.contains("if expanded"))
    }

    func testDetachedDetailUsesIndependentTimelineAndDiffScrollers() throws {
        let source = try messageViewsSource()
        let detail = try section(
            named: "struct FinishedNonTextGroupDetailView: View",
            endingAt: "struct WaitingPlaceholderView: View",
            in: source
        )

        XCTAssertEqual(detail.components(separatedBy: "ScrollView {").count - 1, 1)
        XCTAssertEqual(detail.components(separatedBy: "ScrollView([").count - 1, 1)
        XCTAssertTrue(detail.contains("ScrollViewReader"))
        XCTAssertTrue(detail.contains("ForEach(presentation.members)"))
        XCTAssertTrue(detail.contains("LazyVStack"))
        XCTAssertTrue(detail.contains("ThinkingBlockView(text: text, isStreaming: false)"))
        XCTAssertTrue(detail.contains("ToolCardView("))
        XCTAssertTrue(detail.contains("FileChangeDiffInspector"))
        XCTAssertTrue(detail.contains("selectedFileID"))
        XCTAssertTrue(detail.contains("selectedOperationID = callID"))
        XCTAssertTrue(detail.contains("selectedOperationID = nil"))
        XCTAssertTrue(detail.contains("targetOperationID: selectedOperationID"))
        XCTAssertTrue(detail.contains("targetOperationID ?? file.operations.first?.id"))
        XCTAssertTrue(detail.contains("ForEach(Array(file.operations.enumerated())"))
        XCTAssertTrue(detail.contains("已编辑"))

        let thinking = try section(
            named: "struct ThinkingBlockView: View",
            endingAt: "private extension View",
            in: source
        )
        let toolCard = try section(
            named: "struct ToolCardView: View",
            endingAt: "// MARK: - Generated video",
            in: source
        )
        XCTAssertTrue(thinking.contains("@State private var expanded = false"))
        XCTAssertTrue(toolCard.contains("@State private var expanded = false"))
    }

    func testSheetIsHostedAboveLazyTranscriptAndClearedByBridgeKeyOnly() throws {
        let source = try String(
            contentsOf: repositoryRoot
                .appendingPathComponent("Sources/PipiUI/Views/ChatDetailView.swift"),
            encoding: .utf8
        )

        XCTAssertTrue(source.contains(
            "@State private var finishedGroupPresentation: "
                + "AssistantBlockLayout.FinishedGroupPresentation?"
        ))
        XCTAssertTrue(source.contains(".sheet(item: $finishedGroupPresentation)"))
        let bridgeKeyChange = try section(
            named: ".onChange(of: session.bridgeRoutingKey)",
            endingAt: ".onChange(of: session.id)",
            in: source
        )
        XCTAssertTrue(bridgeKeyChange.contains("finishedGroupPresentation = nil"))
        let sessionIDChange = try section(
            named: ".onChange(of: session.id)",
            endingAt: ".environment(\\.openDocument",
            in: source
        )
        XCTAssertFalse(sessionIDChange.contains("finishedGroupPresentation = nil"))
        XCTAssertTrue(source.contains(
            "guard presentation.belongs(to: session.bridgeRoutingKey) else { return }"
        ))
    }

    private var repositoryRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    private func messageViewsSource() throws -> String {
        try String(
            contentsOf: repositoryRoot
                .appendingPathComponent("Sources/PipiUI/Views/MessageViews.swift"),
            encoding: .utf8
        )
    }

    private func section(
        named startMarker: String,
        endingAt endMarker: String,
        in source: String
    ) throws -> String {
        let start = try XCTUnwrap(source.range(of: startMarker)?.lowerBound)
        let end = try XCTUnwrap(
            source.range(
                of: endMarker,
                range: start..<source.endIndex
            )?.lowerBound
        )
        return String(source[start..<end])
    }
}
