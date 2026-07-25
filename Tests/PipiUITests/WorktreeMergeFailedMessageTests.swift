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
        XCTAssertFalse(text.contains("请你自行决策"))
        XCTAssertTrue(text.contains("general-purpose fixer"))

        let parsed = try XCTUnwrap(WorktreeMergeFailedMessage.parse(text))
        XCTAssertEqual(parsed.agentId, "a1")
        XCTAssertEqual(parsed.name, "general-purpose")
        XCTAssertTrue(parsed.error.contains("local changes would be overwritten"))
    }

    func testFormatUsesFixerDispatchDiscipline() {
        let agent = SubagentInfo(
            id: "w1",
            parentId: nil,
            name: "general-purpose",
            task: "impl",
            depth: 1,
            model: nil,
            worktreePath: "/tmp/.pi/worktrees/agent-w1",
            worktreeBranch: "pipiui/agent-w1",
            worktreeLifecycle: .pendingReview
        )
        let text = WorktreeMergeFailedMessage.format(agent: agent, error: "conflict in Foo.swift")
        // BossPrompt discipline: dispatch a fixer by default; the boss never opens
        // conflict diffs personally and only adjudicates three ways.
        XCTAssertFalse(text.contains("请你自行决策"))
        XCTAssertTrue(text.contains("general-purpose fixer"))
        XCTAssertTrue(text.contains("分支名与冲突文件清单"))
        XCTAssertTrue(text.contains("接受 fixer 结果"))
        XCTAssertTrue(text.contains("丢弃无价值 worktree"))
        XCTAssertTrue(text.contains("绝不亲自打开冲突 diff"))
        XCTAssertTrue(text.contains("不要把原始 git 报错转发给用户"))
        XCTAssertTrue(text.contains("不要把这条消息当成用户新需求"))
    }

    func testPostMergeVerifyFailedMessageFormat() {
        let agent = SubagentInfo(
            id: "p1",
            parentId: nil,
            name: "explore",
            task: "impl",
            depth: 1,
            model: nil,
            worktreeBranch: "pipiui/agent-p1",
            worktreeLifecycle: .merged
        )
        let failure = PostMergeVerifyFailure(
            command: "swift test --filter FooTests",
            exitCode: 1,
            timedOut: false,
            outputTail: "FooTests.testBar: XCTAssertEqual failed"
        )
        let text = PostMergeVerifyFailedMessage.format(agent: agent, failure: failure)
        XCTAssertTrue(text.hasPrefix("[post-merge-verify-failed]"))
        XCTAssertTrue(text.contains("agentId=p1"))
        XCTAssertTrue(text.contains("name=explore"))
        XCTAssertTrue(text.contains("branch=pipiui/agent-p1"))
        XCTAssertTrue(text.contains("verify: $ swift test --filter FooTests → exit 1"))
        XCTAssertTrue(text.contains("FooTests.testBar: XCTAssertEqual failed"))
        XCTAssertTrue(text.contains("general-purpose fixer"))
        XCTAssertTrue(text.contains("verified=pass"))
        XCTAssertTrue(text.contains("不要把这条消息当成用户新需求"))
    }

    func testPostMergeVerifyFailedMessageTimeoutExitDescription() {
        let agent = SubagentInfo(
            id: "p2", parentId: nil, name: "n", task: "t", depth: 1, model: nil)
        let failure = PostMergeVerifyFailure(
            command: "make test", exitCode: 137, timedOut: true, outputTail: "")
        let text = PostMergeVerifyFailedMessage.format(agent: agent, failure: failure)
        XCTAssertTrue(text.contains("exit 137 (timeout 120s)"))
        XCTAssertTrue(text.contains("(no output)"))
    }

    /// End event carrying verifyExit ≠ 0: the worker's own attested verify failed in
    /// the worktree, so the store must keep .pendingReview and skip auto-merge (which
    /// would knowingly break main and delete the worktree recovery needs).
    func testEndEventVerifyExitNonZeroSkipsAutoMerge() throws {
        let store = SubagentStore()
        store.bindMainProject(URL(fileURLWithPath: "/tmp"))
        store.handle(J([
            "kind": "start",
            "agentId": "v1",
            "name": "fixer",
            "task": "impl",
            "depth": 1,
            "worktreePath": "/tmp/nonexistent-pipiui-wt-v1",
            "worktreeBranch": "pipiui/v1",
        ] as [String: Any]))
        store.handle(J([
            "kind": "end",
            "agentId": "v1",
            "ok": true,
            "worktreePath": "/tmp/nonexistent-pipiui-wt-v1",
            "worktreeBranch": "pipiui/v1",
            "verifyCommand": "swift test",
            "verifyExit": 1,
        ] as [String: Any]))
        let agent = try XCTUnwrap(store.agents.first)
        XCTAssertEqual(agent.state, .ok)
        XCTAssertEqual(agent.verifyExit, 1)
        XCTAssertEqual(agent.verifyCommand, "swift test")
        // Give any (wrongly) spawned auto-merge Task time to run; nothing must happen.
        let deadline = Date().addingTimeInterval(1.5)
        while Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        XCTAssertEqual(store.agents.first?.worktreeLifecycle, .pendingReview)
        XCTAssertNil(store.worktreeActionError)
    }

    /// Control: verifyExit == 0 (or absent) keeps the old auto-merge behaviour — the
    /// end event must attempt a merge (which fails here against a nonexistent path,
    /// proving the gate let it through).
    func testEndEventVerifyExitZeroStillAttemptsAutoMerge() throws {
        let store = SubagentStore()
        store.bindMainProject(URL(fileURLWithPath: "/tmp"))
        store.handle(J([
            "kind": "start",
            "agentId": "v2",
            "name": "fixer",
            "task": "impl",
            "depth": 1,
            "worktreePath": "/tmp/nonexistent-pipiui-wt-v2",
            "worktreeBranch": "pipiui/v2",
        ] as [String: Any]))
        store.handle(J([
            "kind": "end",
            "agentId": "v2",
            "ok": true,
            "worktreePath": "/tmp/nonexistent-pipiui-wt-v2",
            "worktreeBranch": "pipiui/v2",
            "verifyCommand": "swift test",
            "verifyExit": 0,
        ] as [String: Any]))
        let deadline = Date().addingTimeInterval(15)
        while store.worktreeActionError == nil && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        // Merge was attempted and failed (nonexistent worktree) ⇒ gate allowed it.
        XCTAssertNotNil(store.worktreeActionError)
    }

    func testVerifyExitRoundTripsThroughCodable() throws {
        var agent = SubagentInfo(
            id: "c1", parentId: nil, name: "n", task: "t", depth: 1, model: nil)
        agent.verifyCommand = "swift test"
        agent.verifyExit = 3
        let data = try JSONEncoder().encode(agent)
        let decoded = try JSONDecoder().decode(SubagentInfo.self, from: data)
        XCTAssertEqual(decoded.verifyExit, 3)
        XCTAssertEqual(decoded.verifyCommand, "swift test")
        // Older payloads without verifyExit decode to nil.
        let legacy = SubagentInfo(
            id: "c2", parentId: nil, name: "n", task: "t", depth: 1, model: nil)
        let legacyData = try JSONEncoder().encode(legacy)
        let legacyDecoded = try JSONDecoder().decode(SubagentInfo.self, from: legacyData)
        XCTAssertNil(legacyDecoded.verifyExit)
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
        // The don't-bother-the-user discipline: on a failed merge the boss dispatches a
        // fixer by default and only adjudicates — accept / discard / ask the user, one
        // sentence, one concrete choice — and never forwards a raw git error. The same
        // discipline covers post-merge verify failures. (Prompt is English since the
        // token-budget pass.)
        XCTAssertTrue(text.contains("Default action: dispatch"))
        XCTAssertTrue(text.contains("a general-purpose fixer"))
        XCTAssertTrue(text.contains("one sentence, one concrete choice"))
        XCTAssertTrue(text.contains("Never forward a raw git error"))
        XCTAssertTrue(text.contains("[post-merge-verify-failed]"))
    }

    /// A `verified=fail` worker is not merged and keeps its worktree, so the fix must
    /// reuse the same agentId rather than starting a fresh worker from zero.
    func testBossPromptTellsBossToReuseAgentIdOnVerifyFail() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-boss-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let path = try XCTUnwrap(BossPrompt.install(into: dir))
        let text = try String(contentsOfFile: path, encoding: .utf8)
        XCTAssertTrue(text.contains("did NOT merge"))
        XCTAssertTrue(text.contains("re-dispatching the SAME agentId"))
    }

    /// Regression: dedup used a single slot, so in a parallel wave agent B's failure
    /// evicted agent A's key and let A's identical failure inject a second time.
    func testDedupIsPerAgentNotASingleSlot() {
        let store = SubagentStore()
        var calls: [String] = []
        store.onWorktreeMergeFailed = { agent, _ in calls.append(agent.id) }
        let a = makeAgent(id: "a1")
        let b = makeAgent(id: "b1")
        store.notifyMergeFailed(agent: a, error: "same-error")
        store.notifyMergeFailed(agent: b, error: "same-error")
        // A repeats its identical failure: must still be suppressed despite B in between.
        store.notifyMergeFailed(agent: a, error: "same-error")
        XCTAssertEqual(calls, ["a1", "b1"])
    }

    /// Merge and verify failures are different event kinds and must not evict each other.
    func testMergeAndVerifyDedupAreIndependent() {
        let store = SubagentStore()
        var merges: [String] = []
        var verifies: [String] = []
        store.onWorktreeMergeFailed = { agent, _ in merges.append(agent.id) }
        store.onPostMergeVerifyFailed = { agent, _, _ in verifies.append(agent.id) }
        let agent = makeAgent(id: "x1")
        let failure = PostMergeVerifyFailure(
            command: "swift build", exitCode: 1, timedOut: false, outputTail: "boom")
        store.notifyMergeFailed(agent: agent, error: "e")
        store.notifyPostMergeVerifyFailed(agent: agent, failure: failure)
        store.notifyMergeFailed(agent: agent, error: "e")
        store.notifyPostMergeVerifyFailed(agent: agent, failure: failure)
        XCTAssertEqual(merges, ["x1"])
        XCTAssertEqual(verifies, ["x1"])
    }

    /// A dirty main tree means the failure may be the user's own WIP; the boss must be
    /// told to establish blame before sending a fixer at uncommitted user code.
    func testPostMergeVerifyMessageFlagsDirtyMainTree() {
        let agent = makeAgent(id: "d1")
        let failure = PostMergeVerifyFailure(
            command: "swift build", exitCode: 1, timedOut: false, outputTail: "error: boom")
        let clean = PostMergeVerifyFailedMessage.format(agent: agent, failure: failure)
        XCTAssertFalse(clean.contains("mainDirty=true"))
        XCTAssertTrue(clean.contains("请立即派一个 general-purpose fixer"))

        let dirty = PostMergeVerifyFailedMessage.format(
            agent: agent, failure: failure, mainDirty: true)
        XCTAssertTrue(dirty.contains("mainDirty=true"))
        XCTAssertTrue(dirty.contains("未提交改动"))
        XCTAssertTrue(dirty.contains("不要擅自改动用户未提交的代码"))
    }

    private func makeAgent(id: String) -> SubagentInfo {
        SubagentInfo(
            id: id,
            parentId: nil,
            name: "general-purpose",
            task: "t",
            depth: 1,
            model: nil,
            state: .ok,
            worktreePath: "/tmp/wt-\(id)",
            worktreeBranch: "pipiui/\(id)",
            worktreeLifecycle: .pendingReview
        )
    }
}
