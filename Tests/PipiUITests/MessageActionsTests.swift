import XCTest
@testable import PipiUI

final class MessageActionsTests: XCTestCase {
    func testBranchSessionNameUsesExistingTitleAndClipsToFortyCharacters() {
        let name = AppStore.branchSessionName(
            from: "这是一个非常长的现有会话标题用于验证分支名称不会超过侧边栏允许的最大长度",
            date: Date(timeIntervalSince1970: 0)
        )

        XCTAssertEqual(name.count, 40)
        XCTAssertTrue(name.hasPrefix("分支 · 这是一个非常长的现有会话标题"))
        XCTAssertTrue(name.hasSuffix("…"))
    }

    func testBranchSessionNameFallsBackToTimestampForPlaceholder() {
        let date = Date(timeIntervalSince1970: 3_661)

        XCTAssertEqual(
            AppStore.branchSessionName(
                from: SessionTitleLogic.placeholderName,
                date: date,
                timeZone: TimeZone(secondsFromGMT: 0)!
            ),
            "分支 · 010101"
        )
    }

    func testSessionIdentityRebindUpdatesOpenKeyButKeepsBridgeRouteStable() {
        let session = ChatSession(
            id: "resume:/old.jsonl",
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: "/old.jsonl",
            blockedReason: "test"
        )
        let bridgeRoutingKey = session.bridgeRoutingKey

        session.rebindIdentity(to: "resume:/new.jsonl")

        XCTAssertEqual(session.id, "resume:/new.jsonl")
        XCTAssertEqual(session.subagents.sessionKey, "resume:/new.jsonl")
        XCTAssertEqual(session.bridgeRoutingKey, bridgeRoutingKey)
        XCTAssertNotEqual(session.bridgeRoutingKey, "resume:/old.jsonl")
    }

    func testCopyableTextUserJoinsTextOnly() {
        let item = ChatItem(
            id: "item-1",
            role: "user",
            blocks: [
                .text("hello"),
                .image(ImageBlock(id: "i", data: Data([1]), mimeType: "image/png")),
                .text("world"),
            ],
            entryId: "e1"
        )
        XCTAssertEqual(MessageActions.copyableText(from: item), "hello\nworld")
    }

    func testCopyableTextUserStripsInvisibleAttachmentFootnotes() {
        let annotated = ImageAttachment.messageWithAttachmentPaths(
            text: "hello",
            paths: [URL(fileURLWithPath: "/tmp/secret-image.png")]
        )
        let item = ChatItem(
            id: "item-with-attachment",
            role: "user",
            blocks: [.text(annotated)],
            entryId: "e1"
        )

        XCTAssertEqual(MessageActions.copyableText(from: item), "hello")
    }

    func testCopyableTextAssistantSkipsThinkingAndTools() {
        let item = ChatItem(
            id: "a",
            role: "assistant",
            blocks: [
                .thinking("secret"),
                .toolCall(ToolCallBlock(id: "t", name: "bash", argsSummary: "ls")),
                .text("visible"),
            ],
            entryId: "e2"
        )
        XCTAssertEqual(MessageActions.copyableText(from: item), "visible")
    }

    func testCopyableTextFromSegments() {
        let segments: [AssistantBlockLayout.Segment] = [
            .singleton(.thinking("x")),
            .text("A"),
            .finishedGroup([.toolCall(ToolCallBlock(id: "1", name: "read", argsSummary: "f"))]),
            .text("B"),
        ]
        XCTAssertEqual(MessageActions.copyableText(from: segments), "A\nB")
    }

    func testMutatingActionsVisibleWhenIdleEvenWithoutEntryId() {
        // Chrome shows without entryId; commit/branch sync or flash if still missing.
        XCTAssertTrue(MessageActions.showsMutatingActions(
            role: "user", entryId: nil, displayText: "hi", isWorking: false))
        XCTAssertFalse(MessageActions.showsMutatingActions(
            role: "user", entryId: "e", displayText: "hi", isWorking: true))
        XCTAssertFalse(MessageActions.showsMutatingActions(
            role: "system", entryId: "e", displayText: "hi", isWorking: false))
        XCTAssertFalse(MessageActions.showsMutatingActions(
            role: "user", entryId: "e", displayText: "[subagent-done] x", isWorking: false))
        XCTAssertFalse(MessageActions.showsMutatingActions(
            role: "user", entryId: "e", displayText: "[worktree-merge-failed] x", isWorking: false))
        XCTAssertTrue(MessageActions.showsMutatingActions(
            role: "user", entryId: "e", displayText: "hi", isWorking: false))
    }

    func testIsEditDraftSendableRejectsBlank() {
        XCTAssertFalse(MessageActions.isEditDraftSendable(""))
        XCTAssertFalse(MessageActions.isEditDraftSendable("   \n  "))
        XCTAssertTrue(MessageActions.isEditDraftSendable("hi"))
        XCTAssertTrue(MessageActions.isEditDraftSendable("  hi  "))
    }

    func testBranchOpCloneWhenRunIsLeaf() {
        XCTAssertEqual(
            MessageActions.branchOp(runLastEntryId: "a3", leafId: "a3", nextUserEntryId: nil),
            .clone
        )
    }

    func testBranchOpForkNextUserWhenNotLeaf() {
        XCTAssertEqual(
            MessageActions.branchOp(runLastEntryId: "a1", leafId: "u2", nextUserEntryId: "u2"),
            .fork(nextUserEntryId: "u2")
        )
    }

    func testBranchOpNilWithoutNextUserWhenNotLeaf() {
        XCTAssertNil(
            MessageActions.branchOp(runLastEntryId: "a1", leafId: "a9", nextUserEntryId: nil)
        )
    }

    func testActiveBranchWalksParentChain() {
        let entries: [J] = [
            J(["type": "message", "id": "e1", "parentId": NSNull(),
               "message": ["role": "user", "content": "u1"]]),
            J(["type": "message", "id": "e2", "parentId": "e1",
               "message": ["role": "assistant", "content": "a1"]]),
            J(["type": "message", "id": "eX", "parentId": "e1",
               "message": ["role": "assistant", "content": "abandoned"]]),
            J(["type": "message", "id": "e3", "parentId": "e2",
               "message": ["role": "user", "content": "u2"]]),
            J(["type": "message", "id": "e4", "parentId": "e3",
               "message": ["role": "assistant", "content": "a2"]]),
        ]

        let branch = MessageActions.activeBranchMessages(entries: entries, leafId: "e4")

        XCTAssertEqual(branch.compactMap { $0["id"].string }, ["e1", "e2", "e3", "e4"])
    }

    func testApplyingEntryIdsZipsUserAssistantOnly() {
        let items = [
            ChatItem(id: "item-1", role: "user", blocks: [.text("u1")]),
            ChatItem(id: "item-2", role: "assistant", blocks: [.text("a1")]),
            ChatItem(id: "item-3", role: "system", blocks: [.text("$ ls")]),
            ChatItem(id: "item-4", role: "user", blocks: [.text("u2")]),
        ]
        let branch: [J] = [
            J(["type": "message", "id": "e1", "message": ["role": "user", "content": "u1"]]),
            J(["type": "message", "id": "e2", "message": ["role": "assistant", "content": "a1"]]),
            J(["type": "message", "id": "e3", "message": ["role": "user", "content": "u2"]]),
        ]

        let stamped = MessageActions.applyingEntryIds(items: items, branchMessages: branch)

        XCTAssertEqual(stamped[0].entryId, "e1")
        XCTAssertEqual(stamped[1].entryId, "e2")
        XCTAssertNil(stamped[2].entryId)
        XCTAssertEqual(stamped[3].entryId, "e3")
    }

    func testApplyingEntryIdsSkipsLocalOnlyAssistantWithoutDriftingLaterTurns() {
        let items = [
            ChatItem(id: "item-1", role: "user", blocks: [.text("u1")]),
            ChatItem(id: "item-2", role: "assistant", blocks: [.text("a1")]),
            ChatItem(
                id: "local-media",
                role: "assistant",
                blocks: [.text("local image")],
                isLocalOnly: true
            ),
            ChatItem(id: "item-3", role: "user", blocks: [.text("u2")]),
            ChatItem(id: "item-4", role: "assistant", blocks: [.text("a2")]),
        ]
        let branch: [J] = [
            J(["type": "message", "id": "e1", "message": ["role": "user", "content": "u1"]]),
            J(["type": "message", "id": "e2", "message": ["role": "assistant", "content": "a1"]]),
            J(["type": "message", "id": "e3", "message": ["role": "user", "content": "u2"]]),
            J(["type": "message", "id": "e4", "message": ["role": "assistant", "content": "a2"]]),
        ]

        let stamped = MessageActions.applyingEntryIds(items: items, branchMessages: branch)

        XCTAssertEqual(stamped[0].entryId, "e1")
        XCTAssertEqual(stamped[1].entryId, "e2")
        XCTAssertNil(stamped[2].entryId)
        XCTAssertEqual(stamped[3].entryId, "e3")
        XCTAssertEqual(stamped[4].entryId, "e4")
    }

    func testApplyingEntryIdsAbortsAllStampingWhenContentDoesNotMatch() {
        let items = [
            ChatItem(id: "item-1", role: "user", blocks: [.text("different")]),
            ChatItem(id: "item-2", role: "assistant", blocks: [.text("a1")]),
        ]
        let branch: [J] = [
            J(["type": "message", "id": "e1", "message": ["role": "user", "content": "u1"]]),
            J(["type": "message", "id": "e2", "message": ["role": "assistant", "content": "a1"]]),
        ]

        let stamped = MessageActions.applyingEntryIds(items: items, branchMessages: branch)

        XCTAssertTrue(stamped.allSatisfy { $0.entryId == nil })
    }

    func testApplyingEntryIdsSkipsHistoricalGhostTitleTurn() {
        let entries: [J] = [
            J(["type": "message", "id": "ghost-user", "parentId": NSNull(),
               "message": [
                   "role": "user",
                   "content": "\(ChatSession.sessionTitleJobMarker) generate title",
               ]]),
            J(["type": "message", "id": "ghost-assistant", "parentId": "ghost-user",
               "message": ["role": "assistant", "content": "Hidden title"]]),
            J(["type": "message", "id": "visible-user", "parentId": "ghost-assistant",
               "message": ["role": "user", "content": "Visible question"]]),
            J(["type": "message", "id": "visible-assistant", "parentId": "visible-user",
               "message": ["role": "assistant", "content": "Visible answer"]]),
        ]
        let items = [
            ChatItem(id: "item-1", role: "user", blocks: [.text("Visible question")]),
            ChatItem(id: "item-2", role: "assistant", blocks: [.text("Visible answer")]),
        ]

        let branch = MessageActions.activeBranchMessages(
            entries: entries,
            leafId: "visible-assistant"
        )
        let stamped = MessageActions.applyingEntryIds(items: items, branchMessages: branch)

        XCTAssertEqual(stamped[0].entryId, "visible-user")
        XCTAssertEqual(stamped[1].entryId, "visible-assistant")
    }

    func testApplyingEntryIdsSkipsEmptyUserBeforeLaterVisibleTurn() {
        let entries: [J] = [
            J(["type": "message", "id": "user-1", "parentId": NSNull(),
               "message": ["role": "user", "content": "First question"]]),
            J(["type": "message", "id": "assistant-1", "parentId": "user-1",
               "message": ["role": "assistant", "content": "First answer"]]),
            J(["type": "message", "id": "empty-user", "parentId": "assistant-1",
               "message": ["role": "user", "content": ""]]),
            J(["type": "message", "id": "user-2", "parentId": "empty-user",
               "message": ["role": "user", "content": "Second question"]]),
            J(["type": "message", "id": "assistant-2", "parentId": "user-2",
               "message": ["role": "assistant", "content": "Second answer"]]),
        ]
        let items = ChatSession.buildTranscript(
            from: entries.map { $0["message"] }
        ).items

        let branch = MessageActions.activeBranchMessages(
            entries: entries,
            leafId: "assistant-2"
        )
        let stamped = MessageActions.applyingEntryIds(items: items, branchMessages: branch)

        XCTAssertEqual(
            stamped.compactMap(\.entryId),
            ["user-1", "assistant-1", "user-2", "assistant-2"]
        )
    }

    func testNextUserEntryId() {
        let branch: [J] = [
            J(["id": "e1", "message": ["role": "user"]]),
            J(["id": "e2", "message": ["role": "assistant"]]),
            J(["id": "e3", "message": ["role": "user"]]),
        ]

        XCTAssertEqual(MessageActions.nextUserEntryId(after: "e2", branchMessages: branch), "e3")
        XCTAssertNil(MessageActions.nextUserEntryId(after: "e3", branchMessages: branch))
    }

    func testEditNoOpOnlyWhenTextIsUnchangedAndMessageEndsBranch() {
        let branch: [J] = [
            J(["id": "e1", "message": ["role": "user"]]),
            J(["id": "e2", "message": ["role": "assistant"]]),
            J(["id": "e3", "message": ["role": "user"]]),
        ]

        XCTAssertTrue(MessageActions.shouldNoOpEdit(
            originalText: "hi",
            newText: "hi",
            itemEntryId: "e3",
            branchMessages: branch
        ))
        XCTAssertFalse(MessageActions.shouldNoOpEdit(
            originalText: "hi",
            newText: "hi",
            itemEntryId: "e1",
            branchMessages: branch
        ))
        XCTAssertFalse(MessageActions.shouldNoOpEdit(
            originalText: "hi",
            newText: "hey",
            itemEntryId: "e3",
            branchMessages: branch
        ))
    }
}
