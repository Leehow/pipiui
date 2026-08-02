import XCTest
@testable import PipiUI

final class ToolCallStatsTests: XCTestCase {

    // MARK: - Helpers

    /// One assistant item whose blocks are all tool calls of `name`.
    private func toolItem(_ name: String, durations: [TimeInterval?]) -> ChatItem {
        ChatItem(
            id: UUID().uuidString,
            role: "assistant",
            blocks: durations.map { duration in
                .toolCall(ToolCallBlock(
                    id: UUID().uuidString,
                    name: name,
                    argsSummary: "",
                    durationSeconds: duration
                ))
            }
        )
    }

    /// One assistant item with mixed tool calls.
    private func mixedItem(_ blocks: [(name: String, duration: TimeInterval?)]) -> ChatItem {
        ChatItem(
            id: UUID().uuidString,
            role: "assistant",
            blocks: blocks.map { block in
                .toolCall(ToolCallBlock(
                    id: UUID().uuidString,
                    name: block.name,
                    argsSummary: "",
                    durationSeconds: block.duration
                ))
            }
        )
    }

    // MARK: - Aggregation

    func testSingleToolCountTotalAverageMax() {
        let report = ToolCallStats.compute(items: [toolItem("bash", durations: [1, 2, 4])])
        XCTAssertEqual(report.rows.count, 1)
        let row = report.rows[0]
        XCTAssertEqual(row.name, "bash")
        XCTAssertEqual(row.count, 3)
        XCTAssertEqual(row.totalSeconds, 7)
        XCTAssertEqual(row.averageSeconds, 2.3, accuracy: 0.0001)
        XCTAssertEqual(row.maxSeconds, 4)
        XCTAssertEqual(report.callCount, 3)
        XCTAssertEqual(report.totalSeconds, 7)
    }

    func testMultipleToolsGroupedAndSortedByTotalDescending() {
        let items = [
            mixedItem([("read", 1), ("read", 1)]),      // read total 2
            mixedItem([("bash", 10)]),                  // bash total 10
            mixedItem([("write", 3), ("write", 3)]),    // write total 6
        ]
        let report = ToolCallStats.compute(items: items)
        XCTAssertEqual(report.rows.map(\.name), ["bash", "write", "read"])
        XCTAssertEqual(report.rows.map(\.count), [1, 2, 2])
        XCTAssertEqual(report.rows.map(\.totalSeconds), [10, 6, 2])
        XCTAssertEqual(report.rows[1].averageSeconds, 3, accuracy: 0.0001)
        XCTAssertEqual(report.rows[2].maxSeconds, 1)
        XCTAssertEqual(report.callCount, 5)
        XCTAssertEqual(report.totalSeconds, 18)
    }

    func testNilDurationsExcludedEntirely() {
        let items = [
            mixedItem([("bash", nil), ("bash", 2), ("read", nil)]),
            mixedItem([("bash", nil)]),
        ]
        let report = ToolCallStats.compute(items: items)
        XCTAssertEqual(report.rows.count, 1)
        XCTAssertEqual(report.rows[0].name, "bash")
        XCTAssertEqual(report.rows[0].count, 1)
        XCTAssertEqual(report.rows[0].totalSeconds, 2)
        XCTAssertEqual(report.callCount, 1)
        XCTAssertEqual(report.totalSeconds, 2)
    }

    func testAllNilDurationsProduceEmptyReport() {
        let items = [
            mixedItem([("bash", nil), ("read", nil)]),
            toolItem("write", durations: [nil, nil]),
        ]
        let report = ToolCallStats.compute(items: items)
        XCTAssertTrue(report.rows.isEmpty)
        XCTAssertEqual(report.callCount, 0)
        XCTAssertEqual(report.totalSeconds, 0)
    }

    func testEmptyItemsProduceZeroReport() {
        let report = ToolCallStats.compute(items: [])
        XCTAssertTrue(report.rows.isEmpty)
        XCTAssertEqual(report.callCount, 0)
        XCTAssertEqual(report.totalSeconds, 0)
    }

    func testNonToolBlocksIgnored() {
        let items = [
            ChatItem(id: "u1", role: "user", blocks: [.text("hello")]),
            ChatItem(id: "a1", role: "assistant", blocks: [.thinking("hmm"), .text("done")]),
        ]
        let report = ToolCallStats.compute(items: items)
        XCTAssertTrue(report.rows.isEmpty)
        XCTAssertEqual(report.callCount, 0)
    }

    // MARK: - Slash command wiring

    func testStatsSlashCommandDispatchesToPresenter() {
        let before = ToolStatsPresenter.shared.requestID
        let host = BuiltinHostMock()
        XCTAssertTrue(BuiltinCommands.execute(name: "stats", args: "", host: host))
        XCTAssertEqual(ToolStatsPresenter.shared.requestID, before + 1)
        XCTAssertTrue(BuiltinCommands.all.contains { $0.name == "stats" && $0.source == .builtin })
        XCTAssertEqual(BuiltinCommands.command(named: "stats")?.description, "工具耗时统计")
    }

    func testDefaultRunShowToolStatsBumpsRequestID() {
        let before = ToolStatsPresenter.shared.requestID
        let host = BuiltinHostMock()
        host.runShowToolStats()
        XCTAssertEqual(ToolStatsPresenter.shared.requestID, before + 1)
    }
}
