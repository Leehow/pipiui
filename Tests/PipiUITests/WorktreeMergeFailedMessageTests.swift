import XCTest
@testable import PipiUI

final class WorktreeMergeFailedMessageTests: XCTestCase {
    func testFormatAndParse() throws {
        let agent = SubagentInfo(
            id: "a1",
            parentId: nil,
            name: "general-purpose",
            task: "impl",
            title: "额度 pill",
            depth: 1,
            model: "kimi-coding/k3-256k",
            worktreePath: "/tmp/.pi/worktrees/agent-x",
            worktreeBranch: "pipiui/agent-x",
            worktreeLifecycle: .pendingReview
        )
        let text = WorktreeMergeFailedMessage.format(
            agent: agent,
            error: "合并失败（worktree 未删除）: local changes would be overwritten"
        )
        XCTAssertTrue(text.hasPrefix("[worktree-merge-failed]"))
        XCTAssertTrue(text.contains("agentId=a1"))
        XCTAssertTrue(text.contains("name=general-purpose"))
        XCTAssertTrue(text.contains("branch=pipiui/agent-x"))
        XCTAssertTrue(text.contains("自行决策并处理"))

        let parsed = try XCTUnwrap(WorktreeMergeFailedMessage.parse(text))
        XCTAssertEqual(parsed.agentId, "a1")
        XCTAssertEqual(parsed.name, "general-purpose")
        XCTAssertTrue(parsed.error.contains("local changes would be overwritten"))
    }

    func testParseRejectsOtherText() {
        XCTAssertNil(WorktreeMergeFailedMessage.parse("[subagent-done] agentId=x"))
        XCTAssertNil(WorktreeMergeFailedMessage.parse("hello"))
    }

    func testMergeFailureDedupsWithinSixtySeconds() {
        let store = SubagentStore()
        var calls: [(String, String)] = []
        store.onWorktreeMergeFailed = { agent, error in
            calls.append((agent.id, error))
        }
        let agent = SubagentInfo(
            id: "m1",
            parentId: nil,
            name: "explore",
            task: "t",
            depth: 1,
            model: nil,
            state: .ok,
            worktreePath: "/tmp/wt-m1",
            worktreeBranch: "pipiui/m1",
            worktreeLifecycle: .pendingReview
        )
        store.notifyMergeFailed(agent: agent, error: "err-a")
        store.notifyMergeFailed(agent: agent, error: "err-a")
        store.notifyMergeFailed(agent: agent, error: "err-b")
        XCTAssertEqual(calls.map(\.1), ["err-a", "err-b"])
    }

    func testBossPromptMentionsMergeFailedSelfHandle() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-boss-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let path = try XCTUnwrap(BossPrompt.install(into: dir))
        let text = try String(contentsOfFile: path, encoding: .utf8)
        XCTAssertTrue(text.contains("[worktree-merge-failed]"))
        // The don't-bother-the-user discipline: boss resolves the merge itself and never
        // forwards a raw git error. (Prompt is English since the token-budget pass.)
        XCTAssertTrue(text.contains("Ask the user only when"))
        XCTAssertTrue(text.contains("Never forward a raw git error"))
    }
}
