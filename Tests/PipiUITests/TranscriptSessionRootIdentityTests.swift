import Foundation
import XCTest
@testable import PipiUI

final class TranscriptSessionRootIdentityTests: XCTestCase {
    private var repositoryRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    func testDifferentSessionKeysProduceDifferentScrollRoots() {
        let first = TranscriptSessionRootIdentity(
            sessionKey: "session-a"
        )
        let second = TranscriptSessionRootIdentity(
            sessionKey: "session-b"
        )

        XCTAssertNotEqual(first, second)
    }

    func testRepeatedRenderingOfOneSessionKeepsSameScrollRoot() {
        let first = TranscriptSessionRootIdentity(
            sessionKey: "session-a"
        )
        let second = TranscriptSessionRootIdentity(
            sessionKey: "session-a"
        )

        XCTAssertEqual(first, second)
        XCTAssertEqual(Set([first, second]).count, 1)
    }

    func testDistinctChatSessionObjectsCannotShareScrollRoot() {
        let first = ChatSession(
            id: "resume:/same.jsonl",
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: "/same.jsonl",
            blockedReason: "test"
        )
        let second = ChatSession(
            id: "resume:/same.jsonl",
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: "/same.jsonl",
            blockedReason: "test"
        )

        XCTAssertNotEqual(
            TranscriptSessionRootIdentity(
                sessionKey: first.bridgeRoutingKey
            ),
            TranscriptSessionRootIdentity(
                sessionKey: second.bridgeRoutingKey
            )
        )
    }

    func testPersistedIdentityRebindKeepsLogicalSessionScrollRoot() {
        let session = ChatSession(
            id: "new:temporary",
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "test"
        )
        let before = TranscriptSessionRootIdentity(
            sessionKey: session.bridgeRoutingKey
        )

        session.rebindIdentity(to: "resume:/persisted.jsonl")

        XCTAssertEqual(
            TranscriptSessionRootIdentity(
                sessionKey: session.bridgeRoutingKey
            ),
            before
        )
    }

    func testTranscriptUsesNormalChronologicalLayoutWithoutReverseFlip() throws {
        let source = try String(
            contentsOf: repositoryRoot
                .appendingPathComponent("Sources/PipiUI/Views/ChatDetailView.swift"),
            encoding: .utf8
        )
        let start = try XCTUnwrap(
            source.range(of: "private struct StreamingTranscriptRows: View")?.lowerBound
        )
        let end = try XCTUnwrap(
            source.range(
                of: "private struct TranscriptLoadingOverlay: View",
                range: start..<source.endIndex
            )?.lowerBound
        )
        let transcript = String(source[start..<end])

        XCTAssertTrue(transcript.contains("ForEach(presentation.rows"))
        XCTAssertTrue(transcript.contains("pinEdge: .documentEnd"))
        XCTAssertFalse(transcript.contains(".reversed()"))
        XCTAssertFalse(transcript.contains(".transcriptFlip()"))

        let history = try XCTUnwrap(transcript.range(of: "ForEach(presentation.rows")?.lowerBound)
        let streaming = try XCTUnwrap(
            transcript.range(of: "if let streamingItem = streaming.streamingItem")?.lowerBound
        )
        let bottom = try XCTUnwrap(
            transcript.range(of: ".id(transcriptID(\"bottom\"))")?.lowerBound
        )
        XCTAssertLessThan(history, streaming)
        XCTAssertLessThan(streaming, bottom)
    }
}
