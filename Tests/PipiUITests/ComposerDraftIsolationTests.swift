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

    func testPlanAdjustmentAppendsRevisionPromptAndRequestsFocusOnlyForOwningSession() {
        let first = makeSession("first")
        let second = makeSession("second")
        _ = first.planStore.applyPublish(
            schemaVersion: 1,
            planId: "plan-1",
            title: "迁移",
            summary: nil,
            tasks: []
        )
        first.draftText = "保留的补充"
        let initialFirstFocus = first.composerDraft.focusRequestToken
        let initialSecondFocus = second.composerDraft.focusRequestToken

        XCTAssertEqual(first.preparePlanAdjustment(planId: "plan-1"), .sent)
        XCTAssertEqual(
            first.draftText,
            "保留的补充\n\n---\n\n请调整计划（计划 ID：plan-1，标题：迁移）。请根据我的补充重新发布计划，等待我批准后再执行。"
        )
        XCTAssertEqual(first.composerDraft.focusRequestToken, initialFirstFocus + 1)
        XCTAssertEqual(second.composerDraft.focusRequestToken, initialSecondFocus)
        XCTAssertEqual(second.draftText, "")

        XCTAssertEqual(
            first.preparePlanAdjustment(planId: "wrong"),
            .rejected("计划已更新，请重试")
        )
        XCTAssertEqual(first.composerDraft.focusRequestToken, initialFirstFocus + 1)
    }

    func testInputBarObservesAndBindsDedicatedComposerState() throws {
        let source = try inputBarSource()

        XCTAssertTrue(source.contains("@ObservedObject private var draftState: ComposerDraftState"))
        XCTAssertTrue(source.contains("ObservedObject(wrappedValue: session.composerDraft)"))
        XCTAssertTrue(source.contains("text: $draftState.text"))
        XCTAssertTrue(source.contains(".onChange(of: draftState.text)"))
        XCTAssertTrue(source.contains(".onChange(of: draftState.focusRequestToken)"))
        XCTAssertTrue(source.contains("focused = true"))
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
