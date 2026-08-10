import XCTest
import Combine
@testable import PipiUI

/// Settled transcript planning: structural versions invalidate; content updates do not.
final class TranscriptPlannerTests: XCTestCase {

    private func item(_ id: String, role: String = "user", text: String = "hi") -> ChatItem {
        ChatItem(id: id, role: role, blocks: [.text(text)])
    }

    private func assistantWithTool(_ id: String, callId: String, tool: String = "read") -> ChatItem {
        ChatItem(id: id, role: "assistant", blocks: [
            .toolCall(ToolCallBlock(id: callId, name: tool, argsSummary: "x"))
        ])
    }

    /// 同一版本 + 同一窗口身份：body 高频求值（击键/流式刷新）必须命中缓存。
    /// 窗口身份（首尾稳定 id）变化时即使 version 未 bump 也必须重算——见
    /// `testLiveAndAncientSeekSameCountDoNotReusePresentation`。
    func testSameVersionKeyHitsCache() {
        let planner = TranscriptPlanner()
        let first = planner.rows(
            items: [item("1"), item("2")], toolRuns: [:], visibleCount: 150,
            transcriptVersion: 1, toolStructureVersion: 0
        )
        // New array allocation, identical window endpoints + versions → cache hit.
        let second = planner.rows(
            items: [item("1"), item("2")], toolRuns: [:], visibleCount: 150,
            transcriptVersion: 1, toolStructureVersion: 0
        )
        XCTAssertEqual(second, first)
        XCTAssertEqual(second.count, 2)
        XCTAssertEqual(planner.computationCount, 1)
    }

    /// 追加消息（transcriptVersion bump）后计划必须更新。
    func testAppendMessageRecomputes() {
        let planner = TranscriptPlanner()
        let before = planner.rows(
            items: [item("1")], toolRuns: [:], visibleCount: 150,
            transcriptVersion: 1, toolStructureVersion: 0
        )
        let after = planner.rows(
            items: [item("1"), item("2", text: "第二條")], toolRuns: [:], visibleCount: 150,
            transcriptVersion: 2, toolStructureVersion: 0
        )
        XCTAssertEqual(before.count, 1)
        XCTAssertEqual(after.count, 2)
        XCTAssertEqual(after.last?.id, "2")
    }

    /// Image-bearing membership is structural and must invalidate the plan.
    /// generate_image 有结果图后从 finishedGroup 里拿出来单独展示。
    func testToolRunsChangeRecomputes() {
        let planner = TranscriptPlanner()
        let items = [
            item("u1"),
            assistantWithTool("a1", callId: "c1", tool: "generate_image"),
            assistantWithTool("a2", callId: "c2"),
        ]
        let before = planner.rows(
            items: items, toolRuns: [:], visibleCount: 150,
            transcriptVersion: 1, toolStructureVersion: 0
        )
        guard case .assistantRun(_, _, let segmentsBefore) = before.last else {
            return XCTFail("expected assistantRun")
        }
        // c1 是 generate_image：即使无 run 也不进 group；c2 单独 singleton。
        XCTAssertEqual(segmentsBefore.count, 2)

        let image = ImageBlock(id: "img-c2", data: Data([0x89, 0x50]), mimeType: "image/png")
        let run = ToolRun(isRunning: false, isError: false, output: "", images: [image])
        let after = planner.rows(
            items: items, toolRuns: ["c2": run], visibleCount: 150,
            transcriptVersion: 1, toolStructureVersion: 1
        )
        guard case .assistantRun(_, _, let segmentsAfter) = after.last else {
            return XCTFail("expected assistantRun")
        }
        // c2 现在带结果图 → 两个 toolCall 都不进 group。
        XCTAssertEqual(segmentsAfter.count, 2)
        XCTAssertFalse(segmentsAfter.contains {
            if case .finishedGroup = $0 { return true }
            return false
        })
        XCTAssertEqual(planner.computationCount, 2)
    }

    func testContentOnlyToolUpdatesHitStructuralCache() {
        let planner = TranscriptPlanner()
        let items = [item("u1"), assistantWithTool("a1", callId: "c1")]
        let first = planner.presentation(
            items: items,
            toolRuns: ["c1": ToolRun(isRunning: true, output: "first chunk")],
            visibleCount: 150,
            transcriptVersion: 1,
            toolStructureVersion: 1
        )
        let second = planner.presentation(
            items: items,
            toolRuns: ["c1": ToolRun(isRunning: true, output: "second chunk")],
            visibleCount: 150,
            transcriptVersion: 1,
            toolStructureVersion: 1
        )

        XCTAssertEqual(second, first)
        XCTAssertEqual(planner.computationCount, 1)
    }

    func testRunningStateReplansFinishedToolGrouping() {
        let planner = TranscriptPlanner()
        let items = [
            item("u1"),
            assistantWithTool("a1", callId: "c1"),
            assistantWithTool("a2", callId: "c2"),
        ]

        let initiallyFinished = planner.presentation(
            items: items,
            toolRuns: ["c1": ToolRun(output: "done")],
            visibleCount: 150,
            transcriptVersion: 1,
            toolStructureVersion: 0
        )
        let running = planner.presentation(
            items: items,
            toolRuns: ["c1": ToolRun(isRunning: true, output: "partial")],
            visibleCount: 150,
            transcriptVersion: 1,
            toolStructureVersion: 1
        )
        let finishedAgain = planner.presentation(
            items: items,
            toolRuns: ["c1": ToolRun(output: "done")],
            visibleCount: 150,
            transcriptVersion: 1,
            toolStructureVersion: 2
        )

        guard case .assistantRun(_, _, let initialSegments) = initiallyFinished.rows.last,
              case .assistantRun(_, _, let runningSegments) = running.rows.last,
              case .assistantRun(_, _, let finalSegments) = finishedAgain.rows.last else {
            return XCTFail("expected assistant runs")
        }
        XCTAssertEqual(initialSegments.count, 1)
        XCTAssertEqual(runningSegments.count, 2)
        XCTAssertEqual(finalSegments.count, 1)
        XCTAssertEqual(planner.computationCount, 3)
    }

    /// 扩大可见窗口（visibleCount 变化）后计划必须覆盖更多历史。
    func testVisibleCountChangeRecomputes() {
        let planner = TranscriptPlanner()
        let items = (1...5).map { item("\($0)") }
        let windowed = planner.rows(
            items: items, toolRuns: [:], visibleCount: 2,
            transcriptVersion: 1, toolStructureVersion: 0
        )
        XCTAssertEqual(windowed.count, 2)
        let full = planner.rows(
            items: items, toolRuns: [:], visibleCount: 150,
            transcriptVersion: 1, toolStructureVersion: 0
        )
        XCTAssertEqual(full.count, 5)
    }

    /// Live suffix(N) and ancient seek windows of the same count must not share a plan.
    /// Cache key includes first/last stable window ids, not only visibleCount.
    func testLiveAndAncientSeekSameCountDoNotReusePresentation() {
        let planner = TranscriptPlanner()
        let items = (0..<200).map { item("msg-\($0)") }
        let liveWindow = Array(items.suffix(128))
        let ancientWindow = Array(items.prefix(128))

        let live = planner.presentation(
            items: liveWindow,
            toolRuns: [:],
            visibleCount: 128,
            transcriptVersion: 7,
            toolStructureVersion: 2
        )
        let seek = planner.presentation(
            items: ancientWindow,
            toolRuns: [:],
            visibleCount: 128,
            transcriptVersion: 7,
            toolStructureVersion: 2
        )

        XCTAssertEqual(live.rows.count, 128)
        XCTAssertEqual(seek.rows.count, 128)
        XCTAssertEqual(live.rows.first?.id, "msg-72")
        XCTAssertEqual(live.rows.last?.id, "msg-199")
        XCTAssertEqual(seek.rows.first?.id, "msg-0")
        XCTAssertEqual(seek.rows.last?.id, "msg-127")
        XCTAssertNotEqual(
            live.rows.map(\.id),
            seek.rows.map(\.id),
            "live and ancient seek windows must produce distinct presentations"
        )
        XCTAssertEqual(planner.computationCount, 2)

        // Same window identity hits cache even when the caller reallocates the array.
        let liveAgain = planner.presentation(
            items: Array(items.suffix(128)),
            toolRuns: [:],
            visibleCount: 128,
            transcriptVersion: 7,
            toolStructureVersion: 2
        )
        XCTAssertEqual(liveAgain.rows.map(\.id), live.rows.map(\.id))
        // Last call was seek (count 2); liveAgain is a different window again → 3.
        XCTAssertEqual(planner.computationCount, 3)

        let seekAgain = planner.presentation(
            items: Array(items.prefix(128)),
            toolRuns: [:],
            visibleCount: 128,
            transcriptVersion: 7,
            toolStructureVersion: 2
        )
        XCTAssertEqual(seekAgain.rows.map(\.id), seek.rows.map(\.id))
        XCTAssertEqual(planner.computationCount, 4)

        // Immediate repeat of the same window must hit.
        let seekHit = planner.presentation(
            items: ancientWindow,
            toolRuns: [:],
            visibleCount: 128,
            transcriptVersion: 7,
            toolStructureVersion: 2
        )
        XCTAssertEqual(seekHit.rows.map(\.id), seek.rows.map(\.id))
        XCTAssertEqual(planner.computationCount, 4)
    }

    /// ChatSession 侧契约：任何 transcript 写入都 bump transcriptVersion。
    func testChatSessionBumpsTranscriptVersionOnWrites() {
        let session = ChatSession(
            id: "t6-test", projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil, blockedReason: "test-only"
        )
        let v0 = session.transcriptVersion
        session.transcript.append(item("1"))
        let v1 = session.transcriptVersion
        XCTAssertGreaterThan(v1, v0)
        session.transcript[0] = item("1", text: "edited")
        XCTAssertGreaterThan(session.transcriptVersion, v1)
        session.transcript = []
        XCTAssertGreaterThan(session.transcriptVersion, v1)
    }

    func testStreamingStateForwardsWithoutPublishingChatSession() {
        let session = ChatSession(
            id: "streaming-isolation-test", projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil, blockedReason: "test-only"
        )
        var sessionChangeCount = 0
        let observer = session.objectWillChange.sink { _ in sessionChangeCount += 1 }
        defer { observer.cancel() }

        let item = ChatItem(id: "streaming", role: "assistant", blocks: [.text("partial")])
        session.streaming.streamingItem = item
        session.streaming.updateToolRun(
            ToolRun(isRunning: true, output: "partial output"),
            for: "tool-1"
        )

        XCTAssertEqual(session.streamingItem, item)
        XCTAssertEqual(session.toolRuns["tool-1"]?.output, "partial output")
        XCTAssertEqual(session.toolOutputVersion, 1)
        XCTAssertEqual(sessionChangeCount, 0)
    }

    func testStreamingStateSeparatesContentAndStructuralToolVersions() {
        let state = StreamingState()
        state.updateToolRun(ToolRun(isRunning: true, output: "one"), for: "tool-1")
        XCTAssertEqual(state.toolOutputVersion, 1)
        XCTAssertEqual(state.toolStructureVersion, 1)

        state.updateToolRun(ToolRun(isRunning: true, output: "two"), for: "tool-1")
        XCTAssertEqual(state.toolOutputVersion, 2)
        XCTAssertEqual(state.toolStructureVersion, 1)

        state.updateToolRun(ToolRun(output: "finished"), for: "tool-1")
        XCTAssertEqual(state.toolOutputVersion, 3)
        XCTAssertEqual(state.toolStructureVersion, 2)

        state.updateToolRun(ToolRun(output: "finished with more text"), for: "tool-1")
        XCTAssertEqual(state.toolOutputVersion, 4)
        XCTAssertEqual(state.toolStructureVersion, 2)

        let image = ImageBlock(
            id: "image-1",
            data: Data([0x89, 0x50]),
            mimeType: "image/png"
        )
        state.updateToolRun(ToolRun(output: "done", images: [image]), for: "tool-1")
        XCTAssertEqual(state.toolOutputVersion, 5)
        XCTAssertEqual(state.toolStructureVersion, 3)

        let backfilled = ImageBlock(
            id: "image-1",
            data: Data([0x89, 0x50, 0x4e, 0x47]),
            mimeType: "image/png"
        )
        state.updateToolRun(ToolRun(output: "done", images: [backfilled]), for: "tool-1")
        XCTAssertEqual(state.toolOutputVersion, 6)
        XCTAssertEqual(state.toolStructureVersion, 3)
    }

    func testStreamingStatePublishesFollowSignalForTokenAndToolUpdates() {
        let state = StreamingState()
        var changeCount = 0
        let observer = state.objectWillChange.sink { changeCount += 1 }
        defer { observer.cancel() }

        state.streamingItem = item("streaming", role: "assistant", text: "token")
        state.updateToolRun(ToolRun(isRunning: true, output: "chunk"), for: "tool-1")

        XCTAssertEqual(changeCount, 2)
    }

    func testReplaceToolRunsUsesRunningAndImageStructuralFingerprint() {
        let state = StreamingState()
        state.replaceToolRuns(["tool-1": ToolRun(output: "finished")])
        XCTAssertEqual(state.toolStructureVersion, 0)

        state.replaceToolRuns(["tool-1": ToolRun(isRunning: true, output: "partial")])
        XCTAssertEqual(state.toolStructureVersion, 1)

        state.replaceToolRuns(["tool-1": ToolRun(isRunning: true, output: "more")])
        XCTAssertEqual(state.toolStructureVersion, 1)

        state.replaceToolRuns(["tool-1": ToolRun(output: "finished")])
        XCTAssertEqual(state.toolStructureVersion, 2)

        let image = ImageBlock(id: "img", data: Data([1]), mimeType: "image/png")
        state.replaceToolRuns(["tool-1": ToolRun(output: "finished", images: [image])])
        XCTAssertEqual(state.toolStructureVersion, 3)

        state.replaceToolRuns([:])
        XCTAssertEqual(state.toolStructureVersion, 4)
    }

    func testPresentationCachesGroupingJumpAuthorshipAndToolOwnership() {
        let planner = TranscriptPlanner()
        let internalSignal = item(
            "signal", role: "user", text: "[subagent-done] agentId=worker-1"
        )
        let presentation = planner.presentation(
            items: [
                item("u1", text: "first"),
                assistantWithTool("a1", callId: "c1", tool: "subagent"),
                internalSignal,
                item("u2", text: "second"),
                assistantWithTool("a2", callId: "c2"),
            ],
            toolRuns: [:],
            visibleCount: 150,
            transcriptVersion: 1,
            toolStructureVersion: 0
        )

        XCTAssertEqual(presentation.userTurnGroups.groupIDForRowID["a1"], "u1")
        XCTAssertEqual(presentation.userTurnGroups.groupIDForRowID["signal"], "u1")
        XCTAssertEqual(presentation.jumpTargetForAssistantRunID["a1"], "u1")
        XCTAssertEqual(presentation.jumpTargetForAssistantRunID["a2"], "u2")
        XCTAssertEqual(presentation.userAuthoredLeafIDs, ["u1", "u2"])
        XCTAssertEqual(presentation.groupIDForToolCallID["c1"], "u1")
        XCTAssertEqual(presentation.groupIDForToolCallID["c2"], "u2")
        XCTAssertEqual(presentation.toolCallIDsForRowID["a1"], ["c1"])
        XCTAssertEqual(presentation.toolCallIDsForRowID["a2"], ["c2"])
        XCTAssertEqual(presentation.lastAssistantRunID, "a2")
        XCTAssertEqual(
            UserTurnCollapseGuard.runningGuardedGroupIDs(
                groupIDForToolCallID: presentation.groupIDForToolCallID,
                runningSubagentToolCallIds: ["c1"]
            ),
            ["u1"]
        )
    }
}

/// T6 subagent 查询索引：toolCallId → agent（含子孙），O(结果数)。
final class SubagentToolCallIndexTests: XCTestCase {

    private func start(
        _ store: SubagentStore, id: String,
        parentId: String? = nil, toolCallId: String? = nil
    ) {
        var dict: [String: Any] = [
            "kind": "start", "agentId": id, "name": "explore", "task": "t", "depth": 1,
        ]
        if let parentId { dict["parentId"] = parentId }
        if let toolCallId { dict["toolCallId"] = toolCallId }
        store.handle(J(dict))
    }

    func testLookupIncludesDescendantsInOriginalOrder() {
        let store = SubagentStore()
        start(store, id: "root", toolCallId: "call-1")
        start(store, id: "other", toolCallId: "call-9")
        start(store, id: "child", parentId: "root")
        start(store, id: "grandchild", parentId: "child")

        let result = store.agents(forToolCallIds: ["call-1"])
        // 保持 agents 数组原顺序（root < child < grandchild），不含无关 agent。
        XCTAssertEqual(result.map(\.id), ["root", "child", "grandchild"])
    }

    func testIndexRebuildsAfterAgentsChange() {
        let store = SubagentStore()
        start(store, id: "root", toolCallId: "call-1")
        XCTAssertEqual(store.agents(forToolCallIds: ["call-1"]).map(\.id), ["root"])

        // agents 变化后索引必须惰性重建，新子孙立即可查。
        start(store, id: "late-child", parentId: "root")
        XCTAssertEqual(
            store.agents(forToolCallIds: ["call-1"]).map(\.id),
            ["root", "late-child"]
        )
    }

    func testEmptyAndUnknownCallIds() {
        let store = SubagentStore()
        start(store, id: "root", toolCallId: "call-1")
        XCTAssertTrue(store.agents(forToolCallIds: []).isEmpty)
        XCTAssertTrue(store.agents(forToolCallIds: ["nope"]).isEmpty)
    }

    func testGenerationBumpsOnElementMutation() {
        let store = SubagentStore()
        start(store, id: "root", toolCallId: "call-1")
        let v0 = store.agentsGeneration
        store.handle(J([
            "kind": "update", "agentId": "root", "activity": "working",
        ] as [String: Any]))
        XCTAssertGreaterThan(store.agentsGeneration, v0)
    }
}
