import XCTest
@testable import PipiUI

/// 验证「运行中的 subagent 阻止其所属用户回合被折叠」的纯逻辑。
///
/// `UserTurnCollapseGuard` 不依赖 `SubagentStore` / SwiftUI：调用方把当前处于
/// `.running` 的 subagent 工具调用 id 集合传入，helper 据此算出哪些 group 必须
/// 强制展开，并给出最终的折叠判定。
final class UserTurnCollapseGuardTests: XCTestCase {

    private func user(_ id: String, _ text: String = "hi") -> ChatItem {
        ChatItem(id: id, role: "user", blocks: [.text(text)])
    }

    /// runtime worker signal（`[subagent-done]`）：user 角色但非用户撰写，不另起 group。
    private func doneSignal(_ id: String, agent: String = "explore") -> ChatItem {
        ChatItem(id: id, role: "user", blocks: [.text("[subagent-done] name=\(agent) ok=true")])
    }

    private func assistant(_ id: String, subagentCallId: String) -> ChatItem {
        ChatItem(id: id, role: "assistant", blocks: [
            .toolCall(ToolCallBlock(id: subagentCallId, name: "subagent", argsSummary: "派子 agent"))
        ])
    }

    /// 用 planTranscript 构造与生产环境一致的 TranscriptRow（coalesce assistant items）。
    private func rows(_ items: [ChatItem]) -> [AssistantBlockLayout.TranscriptRow] {
        AssistantBlockLayout.planTranscript(items: items)
    }

    private func groups(_ rows: [AssistantBlockLayout.TranscriptRow]) -> AssistantBlockLayout.UserTurnGroups {
        AssistantBlockLayout.userTurnGroups(rows: rows)
    }

    // MARK: - runningGuardedGroupIDs

    /// 没有任何运行中的 subagent → 任何 group 都不被保护。
    func testNoRunningAgentsYieldsNoGuardedGroups() {
        let items = [
            user("u1"), assistant("a1", subagentCallId: "c1")
        ]
        let r = rows(items)
        let g = groups(r)

        let guarded = UserTurnCollapseGuard.runningGuardedGroupIDs(
            rows: r, groups: g, runningSubagentToolCallIds: []
        )
        XCTAssertTrue(guarded.isEmpty)
    }

    /// 某回合派出的 subagent 仍在运行 → 该回合（以其 user 消息 id 为 group id）被保护。
    func testRunningSubagentGuardsItsOwnTurn() {
        let items = [
            user("u1"), assistant("a1", subagentCallId: "c1")
        ]
        let r = rows(items)
        let g = groups(r)

        let guarded = UserTurnCollapseGuard.runningGuardedGroupIDs(
            rows: r, groups: g, runningSubagentToolCallIds: ["c1"]
        )
        XCTAssertEqual(guarded, ["u1"])
    }

    /// 已结束的 subagent 不在运行集合里 → 其回合照常可折叠。
    func testFinishedSubagentDoesNotGuard() {
        let items = [
            user("u1"), assistant("a1", subagentCallId: "c1")
        ]
        let r = rows(items)
        let g = groups(r)

        let guarded = UserTurnCollapseGuard.runningGuardedGroupIDs(
            rows: r, groups: g, runningSubagentToolCallIds: [] // c1 的 agent 已 ok
        )
        XCTAssertTrue(guarded.isEmpty)
    }

    /// 多回合：只有含运行中 subagent 的那个回合被保护，其余照旧。
    func testOnlyRunningTurnIsGuardedAmongMany() {
        let items = [
            user("u1"), assistant("a1", subagentCallId: "c1"),
            user("u2"), assistant("a2", subagentCallId: "c2"),
            user("u3"), assistant("a3", subagentCallId: "c3"),
        ]
        let r = rows(items)
        let g = groups(r)

        let guarded = UserTurnCollapseGuard.runningGuardedGroupIDs(
            rows: r, groups: g, runningSubagentToolCallIds: ["c2"]
        )
        XCTAssertEqual(guarded, ["u2"])
    }

    /// 多个运行中的 subagent 分属不同回合 → 各自回合都被保护。
    func testMultipleRunningAgentsAcrossTurns() {
        let items = [
            user("u1"), assistant("a1", subagentCallId: "c1"),
            user("u2"), assistant("a2", subagentCallId: "c2"),
        ]
        let r = rows(items)
        let g = groups(r)

        let guarded = UserTurnCollapseGuard.runningGuardedGroupIDs(
            rows: r, groups: g, runningSubagentToolCallIds: ["c1", "c2"]
        )
        XCTAssertEqual(guarded, ["u1", "u2"])
    }

    /// 运行集合里的 id 不属于任何可见回合 → 不产生保护（防御未知 id）。
    func testUnknownRunningToolCallIdGuardsNothing() {
        let items = [
            user("u1"), assistant("a1", subagentCallId: "c1")
        ]
        let r = rows(items)
        let g = groups(r)

        let guarded = UserTurnCollapseGuard.runningGuardedGroupIDs(
            rows: r, groups: g, runningSubagentToolCallIds: ["c9"]
        )
        XCTAssertTrue(guarded.isEmpty)
    }

    /// 同一回合里既有运行中 subagent，也跟了一条 `[subagent-done]` 信号：
    /// group 被保护后，该信号也会随之展开（信号共享 group id）。
    func testRunningSubagentGuardsGroupSharedWithWorkerSignal() {
        let items = [
            user("u1"), assistant("a1", subagentCallId: "c1"),
            doneSignal("sig1") // 继承 group "u1"
        ]
        let r = rows(items)
        let g = groups(r)

        // 信号行归属于 u1 组，证明信号确实落进同一折叠组。
        XCTAssertEqual(g.groupIDForRowID["sig1"], "u1")

        let guarded = UserTurnCollapseGuard.runningGuardedGroupIDs(
            rows: r, groups: g, runningSubagentToolCallIds: ["c1"]
        )
        XCTAssertEqual(guarded, ["u1"])
    }

    // MARK: - isCollapsed

    /// 折叠意图存在，但 group 被运行中 subagent 保护 → 视为未折叠（强制展开）。
    func testCollapsedIntentOverriddenByRunningGuard() {
        let folded = UserTurnCollapseGuard.isCollapsed(
            groupID: "u1",
            collapsedUserTurnIDs: ["u1"],
            guardedGroupIDs: ["u1"]
        )
        XCTAssertFalse(folded)
    }

    /// 折叠意图存在且无运行中 subagent → 正常折叠（既有体验不变）。
    func testCollapsedIntentHonouredWhenNotRunning() {
        let folded = UserTurnCollapseGuard.isCollapsed(
            groupID: "u1",
            collapsedUserTurnIDs: ["u1"],
            guardedGroupIDs: []
        )
        XCTAssertTrue(folded)
    }

    /// 无 group id（游离行）→ 永不折叠。
    func testNilGroupIDNeverCollapses() {
        let folded = UserTurnCollapseGuard.isCollapsed(
            groupID: nil,
            collapsedUserTurnIDs: ["u1"],
            guardedGroupIDs: []
        )
        XCTAssertFalse(folded)
    }

    /// 未记录折叠意图 → 即使被保护也（本就）未折叠；保护只是双保险。
    func testNoFoldIntentMeansExpandedRegardlessOfGuard() {
        XCTAssertFalse(UserTurnCollapseGuard.isCollapsed(
            groupID: "u1", collapsedUserTurnIDs: [], guardedGroupIDs: ["u1"]
        ))
        XCTAssertFalse(UserTurnCollapseGuard.isCollapsed(
            groupID: "u1", collapsedUserTurnIDs: [], guardedGroupIDs: []
        ))
    }

    /// 普通 isRunning 工具调用 id（非 subagent）同样保护其所属用户回合。
    /// 调用点把 streaming.toolRuns 里 isRunning 的 id 并入 running 集合。
    func testRunningOrdinaryToolCallGuardsItsTurn() {
        let items = [
            user("u1"),
            ChatItem(id: "a1", role: "assistant", blocks: [
                .toolCall(ToolCallBlock(id: "bash-1", name: "bash", argsSummary: "sleep 240")),
            ]),
        ]
        let r = rows(items)
        let g = groups(r)

        let guarded = UserTurnCollapseGuard.runningGuardedGroupIDs(
            rows: r, groups: g, runningSubagentToolCallIds: ["bash-1"]
        )
        XCTAssertEqual(guarded, ["u1"])
        XCTAssertFalse(UserTurnCollapseGuard.isCollapsed(
            groupID: "u1",
            collapsedUserTurnIDs: ["u1"],
            guardedGroupIDs: guarded
        ))
    }

    // MARK: - 端到端：guard 释放后沿用既有折叠

    /// 关键验收路径：运行中 → 强制展开；agent 结束（运行集合清空）→ 沿用用户既有的折叠意图。
    func testGuardReleasesAndExistingFoldAppliesAfterAgentEnds() {
        let items = [user("u1"), assistant("a1", subagentCallId: "c1")]
        let r = rows(items)
        let g = groups(r)
        var collapsedUserTurnIDs: Set<String> = ["u1"] // 用户在运行中点了折叠

        // subagent 运行中：即便有折叠意图，也强制展开。
        var runningIds: Set<String> = ["c1"]
        var guarded = UserTurnCollapseGuard.runningGuardedGroupIDs(
            rows: r, groups: g, runningSubagentToolCallIds: runningIds
        )
        XCTAssertTrue(UserTurnCollapseGuard.isCollapsed(
            groupID: "u1", collapsedUserTurnIDs: collapsedUserTurnIDs, guardedGroupIDs: guarded
        ) == false)

        // agent 完成：运行集合清空 → 保护解除，沿用既有折叠意图 → 折叠生效。
        runningIds = []
        guarded = UserTurnCollapseGuard.runningGuardedGroupIDs(
            rows: r, groups: g, runningSubagentToolCallIds: runningIds
        )
        XCTAssertTrue(UserTurnCollapseGuard.isCollapsed(
            groupID: "u1", collapsedUserTurnIDs: collapsedUserTurnIDs, guardedGroupIDs: guarded
        ))

        // 顺手验证：用户随后展开 → 又恢复展开。
        collapsedUserTurnIDs.removeAll()
        XCTAssertFalse(UserTurnCollapseGuard.isCollapsed(
            groupID: "u1", collapsedUserTurnIDs: collapsedUserTurnIDs, guardedGroupIDs: guarded
        ))
    }
}
