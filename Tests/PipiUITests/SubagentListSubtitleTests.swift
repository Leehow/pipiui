import XCTest
@testable import PipiUI

final class SubagentListSubtitleTests: XCTestCase {
    func testRunningPrefersTitleOverActivityJSON() {
        var agent = SubagentInfo(
            id: "a1",
            parentId: nil,
            name: "explore",
            task: "Investigate auth flow end-to-end",
            title: "调研登录流程",
            depth: 1,
            model: nil,
            state: .running,
            activity: #"bash {"command":"rg -n auth Sources"}"#
        )
        XCTAssertEqual(agent.listSubtitle, "调研登录流程")

        agent.state = .ok
        agent.activity = ""
        XCTAssertEqual(agent.listSubtitle, "调研登录流程")
    }

    func testFallsBackToTaskWhenTitleMissing() {
        let agent = SubagentInfo(
            id: "a2",
            parentId: nil,
            name: "coder",
            task: "Fix the flaky scroll test",
            title: nil,
            depth: 1,
            model: nil,
            state: .running,
            activity: #"read {"path":"Tests/Foo.swift"}"#
        )
        XCTAssertEqual(agent.listSubtitle, "Fix the flaky scroll test")
    }

    func testEmptyTitleFallsBackToTask() {
        let agent = SubagentInfo(
            id: "a3",
            parentId: nil,
            name: "explore",
            task: "Map module boundaries",
            title: "   ",
            depth: 1,
            model: nil,
            state: .running,
            activity: "thinking…"
        )
        XCTAssertEqual(agent.listSubtitle, "Map module boundaries")
    }

    /// Main-chat subagent card running line must prefer task title, never activity JSON.
    func testCardStatusLineRunningUsesListSubtitleNotActivityJSON() {
        let agent = SubagentInfo(
            id: "a4",
            parentId: nil,
            name: "explore",
            task: "long task",
            title: "审计主线程同步 IO",
            depth: 1,
            model: nil,
            state: .running,
            activity: #"read {"path":"/tmp/Log.swift"}"#
        )
        XCTAssertEqual(SubagentToolCardStatus.line(for: agent), "审计主线程同步 IO")
        XCTAssertFalse(SubagentToolCardStatus.line(for: agent).contains("{"))
    }
}
