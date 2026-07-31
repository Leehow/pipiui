import XCTest
import Combine
@testable import PipiUI

/// T6 transcript 布局记忆化：版本 key 驱动失效，输入版本未变不重算。
final class TranscriptPlannerTests: XCTestCase {

    private func item(_ id: String, role: String = "user", text: String = "hi") -> ChatItem {
        ChatItem(id: id, role: role, blocks: [.text(text)])
    }

    private func assistantWithTool(_ id: String, callId: String, tool: String = "read") -> ChatItem {
        ChatItem(id: id, role: "assistant", blocks: [
            .toolCall(ToolCallBlock(id: callId, name: tool, argsSummary: "x"))
        ])
    }

    /// 同一版本 key：即使传入的 items 数组内容不同，也必须命中缓存不重算。
    /// （这证明 body 高频求值——击键/流式刷新——退化为一次数值比较。）
    func testSameVersionKeyHitsCache() {
        let planner = TranscriptPlanner()
        let first = planner.rows(
            items: [item("1")], toolRuns: [:], visibleCount: 150,
            transcriptVersion: 1, toolOutputVersion: 0
        )
        // 内容变了但版本没 bump —— 调用方契约不允许，但这里用来证明确实走了缓存。
        let second = planner.rows(
            items: [item("1"), item("2")], toolRuns: [:], visibleCount: 150,
            transcriptVersion: 1, toolOutputVersion: 0
        )
        XCTAssertEqual(second, first)
        XCTAssertEqual(second.count, 1)
    }

    /// 追加消息（transcriptVersion bump）后计划必须更新。
    func testAppendMessageRecomputes() {
        let planner = TranscriptPlanner()
        let before = planner.rows(
            items: [item("1")], toolRuns: [:], visibleCount: 150,
            transcriptVersion: 1, toolOutputVersion: 0
        )
        let after = planner.rows(
            items: [item("1"), item("2", text: "第二條")], toolRuns: [:], visibleCount: 150,
            transcriptVersion: 2, toolOutputVersion: 0
        )
        XCTAssertEqual(before.count, 1)
        XCTAssertEqual(after.count, 2)
        XCTAssertEqual(after.last?.id, "2")
    }

    /// toolRuns 变化（toolOutputVersion bump）后计划必须反映新 run。
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
            transcriptVersion: 1, toolOutputVersion: 0
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
            transcriptVersion: 1, toolOutputVersion: 1
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
    }

    /// 扩大可见窗口（visibleCount 变化）后计划必须覆盖更多历史。
    func testVisibleCountChangeRecomputes() {
        let planner = TranscriptPlanner()
        let items = (1...5).map { item("\($0)") }
        let windowed = planner.rows(
            items: items, toolRuns: [:], visibleCount: 2,
            transcriptVersion: 1, toolOutputVersion: 0
        )
        XCTAssertEqual(windowed.count, 2)
        let full = planner.rows(
            items: items, toolRuns: [:], visibleCount: 150,
            transcriptVersion: 1, toolOutputVersion: 0
        )
        XCTAssertEqual(full.count, 5)
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
        session.streaming.toolRuns["tool-1"] = ToolRun(isRunning: true, output: "partial output")
        session.streaming.toolOutputVersion &+= 1

        XCTAssertEqual(session.streamingItem, item)
        XCTAssertEqual(session.toolRuns["tool-1"]?.output, "partial output")
        XCTAssertEqual(session.toolOutputVersion, 1)
        XCTAssertEqual(sessionChangeCount, 0)
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
