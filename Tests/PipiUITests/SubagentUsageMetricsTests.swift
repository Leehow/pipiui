import XCTest
@testable import PipiUI

final class SubagentUsageMetricsTests: XCTestCase {
    func testApplyUsageAccumulatesTotalsAndContext() {
        var agent = SubagentInfo(
            id: "a1", parentId: nil, name: "explore", task: "t", depth: 1, model: "kimi-coding/k3-256k"
        )
        agent.applyUsage(TokenLedger.UsageSnapshot(
            input: 100, output: 50, cacheRead: 200, cacheWrite: 10, cost: 0.01, contextTokens: 1_000
        ), contextWindow: 256_000)
        agent.applyUsage(TokenLedger.UsageSnapshot(
            input: 80, output: 40, cacheRead: 300, cacheWrite: 0, cost: 0.02, contextTokens: 2_000
        ), contextWindow: 256_000)

        XCTAssertEqual(agent.totalInput, 180)
        XCTAssertEqual(agent.totalOutput, 90)
        XCTAssertEqual(agent.totalCacheRead, 500)
        XCTAssertEqual(agent.totalCacheWrite, 10)
        XCTAssertEqual(agent.contextTokens, 2_000)
        XCTAssertEqual(agent.contextWindow, 256_000)
        XCTAssertEqual(agent.totalTokens, 270)
        XCTAssertEqual(try XCTUnwrap(agent.cacheHitRate), 500.0 / 690.0, accuracy: 0.0001)
    }

    func testCacheHitRateNilWhenNoInputSideTokens() {
        let agent = SubagentInfo(
            id: "a2", parentId: nil, name: "explore", task: "t", depth: 1, model: nil
        )
        XCTAssertNil(agent.cacheHitRate)
        XCTAssertEqual(agent.totalTokens, 0)
    }

    func testMetricsLineParts() {
        var agent = SubagentInfo(
            id: "a3", parentId: nil, name: "explore",
            task: "long task body", title: "查模型列表", depth: 1, model: nil
        )
        agent.applyUsage(TokenLedger.UsageSnapshot(
            input: 100, output: 50, cacheRead: 300, cacheWrite: 100, cost: 0, contextTokens: 38_000
        ), contextWindow: 256_000)

        let parts = SubagentMetricsLine.parts(for: agent)
        XCTAssertEqual(parts.title, "查模型列表")
        XCTAssertEqual(parts.context, "38k/256k")
        XCTAssertEqual(parts.cache, "缓存 60%")
        XCTAssertEqual(parts.sum, "Σ 150")
    }

    func testMetricsLineHidesMissingMetricsAndFallsBackTitle() {
        let agent = SubagentInfo(
            id: "a4", parentId: nil, name: "explore", task: "only task", depth: 1, model: nil
        )
        let parts = SubagentMetricsLine.parts(for: agent)
        XCTAssertEqual(parts.title, "only task")
        XCTAssertNil(parts.context)
        XCTAssertNil(parts.cache)
        XCTAssertNil(parts.sum)
    }

    func testMetricsLineContextWithoutWindow() {
        var agent = SubagentInfo(
            id: "a5", parentId: nil, name: "explore", task: "t", title: "x", depth: 1, model: nil
        )
        agent.applyUsage(TokenLedger.UsageSnapshot(
            input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 38_000
        ), contextWindow: nil)
        let parts = SubagentMetricsLine.parts(for: agent)
        XCTAssertEqual(parts.context, "38k")
    }

    func testStoreUsageEventUpdatesAgent() throws {
        let store = SubagentStore()
        store.handle(J([
            "kind": "start",
            "agentId": "u1",
            "name": "explore",
            "task": "do thing",
            "title": "标题",
            "depth": 1,
            "model": "kimi-coding/k3-256k",
        ] as [String: Any]))
        store.resolveContextWindow = { _ in 256_000 }
        store.handle(J([
            "kind": "usage",
            "agentId": "u1",
            "turn": 1,
            "model": "kimi-coding/k3-256k",
            "usage": [
                "input": 10,
                "output": 5,
                "cacheRead": 20,
                "cacheWrite": 0,
                "cost": 0.1,
                "contextTokens": 999,
            ],
        ] as [String: Any]))
        let agent = try XCTUnwrap(store.agents.first)
        XCTAssertEqual(agent.totalInput, 10)
        XCTAssertEqual(agent.totalOutput, 5)
        XCTAssertEqual(agent.contextTokens, 999)
        XCTAssertEqual(agent.contextWindow, 256_000)
    }
}
