import Combine
import XCTest
@testable import PipiUI

final class ComposerDraftIsolationTests: XCTestCase {
    private func makeSession(_ id: String = UUID().uuidString) -> ChatSession {
        ChatSession(
            id: id,
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "composer-draft-isolation-test"
        )
    }

    func testDraftMutationPublishesComposerStateWithoutPublishingSession() {
        let session = makeSession()
        var composerChanges = 0
        var sessionChanges = 0
        let composerObserver = session.composerDraft.objectWillChange.sink {
            composerChanges += 1
        }
        let sessionObserver = session.objectWillChange.sink {
            sessionChanges += 1
        }
        defer {
            composerObserver.cancel()
            sessionObserver.cancel()
        }

        session.draftText = "typed text"

        XCTAssertEqual(session.draftText, "typed text")
        XCTAssertEqual(session.composerDraft.text, "typed text")
        XCTAssertEqual(composerChanges, 1)
        XCTAssertEqual(sessionChanges, 0)
    }

    func testDirectComposerStateMutationUpdatesCompatibilityDraftAPI() {
        let session = makeSession()

        session.composerDraft.text = "restored externally"

        XCTAssertEqual(session.draftText, "restored externally")
    }

    func testInputBarObservesAndBindsDedicatedComposerState() throws {
        let source = try inputBarSource()

        XCTAssertTrue(source.contains("@ObservedObject private var draftState: ComposerDraftState"))
        XCTAssertTrue(source.contains("ObservedObject(wrappedValue: session.composerDraft)"))
        XCTAssertTrue(source.contains("text: $draftState.text"))
        XCTAssertTrue(source.contains(".onChange(of: draftState.text)"))
        XCTAssertFalse(source.contains("text: $session.draftText"))
        XCTAssertFalse(source.contains(".onChange(of: session.draftText)"))
    }

    private func inputBarSource() throws -> String {
        let repositoryRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        return try String(
            contentsOf: repositoryRoot
                .appendingPathComponent("Sources/PipiUI/Views/InputBar.swift"),
            encoding: .utf8
        )
    }
}
