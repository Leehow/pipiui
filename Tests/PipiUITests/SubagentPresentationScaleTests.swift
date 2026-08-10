import XCTest
@testable import PipiUI

final class SubagentPresentationScaleTests: XCTestCase {
    func testEmptyPresentationHasExactZeroSummary() {
        let card = SubagentPresentationScale.cardPresentation(for: [])
        let panel = SubagentPresentationScale.panelWindow(
            for: [],
            pageFromNewest: 0,
            selectedID: nil
        )

        XCTAssertEqual(
            card.summary,
            .init(totalCount: 0, runningCount: 0, failedCount: 0, totalCost: 0, failedCleanedCount: 0, failedAttentionCount: 0)
        )
        XCTAssertTrue(card.visibleAgents.isEmpty)
        XCTAssertEqual(card.hiddenCount, 0)
        XCTAssertNil(card.panelSelectionID)
        XCTAssertTrue(panel.agents.isEmpty)
        XCTAssertEqual(panel.pageCount, 0)
    }

    func testSmallCardShowsAllAgentsAndExactAggregates() {
        let agents = [
            agent(0, state: .running, cost: 0.25),
            agent(1, state: .ok, cost: 0.5),
            agent(2, state: .failed, cost: 0.75),
        ]

        let card = SubagentPresentationScale.cardPresentation(for: agents)

        XCTAssertEqual(card.totalCount, 3)
        XCTAssertEqual(card.runningCount, 1)
        XCTAssertEqual(card.failedCount, 1)
        XCTAssertEqual(card.totalCost, 1.5, accuracy: 0.000_001)
        XCTAssertEqual(Set(card.visibleAgents.map(\.id)), Set(agents.map(\.id)))
        XCTAssertEqual(card.hiddenCount, 0)
    }

    func testTenThousandAgentCardRemainsBoundedWithoutLosingTotals() {
        let agents = (0..<10_000).map { index in
            agent(
                index,
                state: index.isMultiple(of: 10) ? .running : (index.isMultiple(of: 37) ? .failed : .ok),
                cost: 0.001
            )
        }

        let card = SubagentPresentationScale.cardPresentation(for: agents)

        XCTAssertEqual(card.totalCount, 10_000)
        XCTAssertEqual(card.runningCount, 1_000)
        XCTAssertEqual(card.failedCount, 243)
        XCTAssertEqual(card.totalCost, 10, accuracy: 0.000_001)
        XCTAssertEqual(card.visibleAgents.count, SubagentPresentationScale.cardRowLimit)
        XCTAssertEqual(card.hiddenCount, 10_000 - SubagentPresentationScale.cardRowLimit)
    }

    func testCardPrioritizesProblemsThenRunningBeforeRecentSuccesses() {
        var stalled = agent(1, state: .running)
        stalled.stalled = true
        let agents = [
            agent(0, state: .ok),
            stalled,
            agent(2, state: .failed),
            agent(3, state: .running),
            agent(4, state: .ok),
        ]

        let card = SubagentPresentationScale.cardPresentation(for: agents, rowLimit: 3)

        XCTAssertEqual(card.visibleAgents.map(\.id), ["2", "1", "3"])
        XCTAssertEqual(card.hiddenCount, 2)
    }

    func testTenThousandAgentPanelNavigationNeverExceedsHardCapAndReachesEveryRow() {
        let agents = (0..<10_000).map { agent($0, state: .ok) }
        var visited: Set<String> = []

        let first = SubagentPresentationScale.panelWindow(
            for: agents,
            pageFromNewest: 0,
            selectedID: nil
        )
        XCTAssertEqual(first.pageCount, 100)

        for page in 0..<first.pageCount {
            let window = SubagentPresentationScale.panelWindow(
                for: agents,
                pageFromNewest: page,
                selectedID: nil
            )
            XCTAssertLessThanOrEqual(window.agents.count, SubagentPresentationScale.panelRowCap)
            visited.formUnion(window.agents.map(\.id))
        }

        let clamped = SubagentPresentationScale.panelWindow(
            for: agents,
            pageFromNewest: 10_000,
            selectedID: nil
        )
        XCTAssertEqual(clamped.pageFromNewest, 99)
        XCTAssertLessThanOrEqual(clamped.agents.count, SubagentPresentationScale.panelRowCap)
        XCTAssertEqual(visited.count, 10_000)
    }

    func testPanelSurfacesRecentRunningAndFailedRowsOutsideRecentWindow() {
        var agents = (0..<300).map { agent($0, state: .ok) }
        agents[5].state = .failed
        agents[5].lastObservedAt = Date(timeIntervalSince1970: 50_000)
        agents[6].state = .running
        agents[6].lastObservedAt = Date(timeIntervalSince1970: 60_000)

        let window = SubagentPresentationScale.panelWindow(
            for: agents,
            pageFromNewest: 1,
            selectedID: "7"
        )

        XCTAssertLessThanOrEqual(window.agents.count, SubagentPresentationScale.panelRowCap)
        XCTAssertTrue(window.agents.contains { $0.id == "5" })
        XCTAssertTrue(window.agents.contains { $0.id == "6" })
        XCTAssertTrue(window.agents.contains { $0.id == "7" })
        XCTAssertEqual(window.agents.map(\.id), window.agents.sorted { Int($0.id)! < Int($1.id)! }.map(\.id))

        var visited: Set<String> = []
        for page in 0..<window.pageCount {
            let pageWindow = SubagentPresentationScale.panelWindow(
                for: agents,
                pageFromNewest: page,
                selectedID: "7"
            )
            XCTAssertLessThanOrEqual(pageWindow.agents.count, SubagentPresentationScale.panelRowCap)
            XCTAssertTrue(pageWindow.agents.contains { $0.id == "5" })
            XCTAssertTrue(pageWindow.agents.contains { $0.id == "6" })
            XCTAssertTrue(pageWindow.agents.contains { $0.id == "7" })
            visited.formUnion(pageWindow.agents.map(\.id))
        }
        XCTAssertEqual(visited.count, agents.count)
    }

    func testPanelWindowResetsForShrinkAndReplacementWaveButNotStableIdentity() {
        let firstWave = (0..<10_000).map { agent($0, state: .ok) }
        let oldWindow = SubagentPresentationScale.panelWindow(
            for: firstWave,
            pageFromNewest: 73,
            selectedID: nil
        )
        XCTAssertEqual(
            SubagentPresentationScale.panelPageAfterListChange(
                currentPage: 73,
                previousIdentity: oldWindow.listIdentity,
                newIdentity: oldWindow.listIdentity
            ),
            73
        )

        let shrunk = Array(firstWave.suffix(20))
        let shrunkWindow = SubagentPresentationScale.panelWindow(
            for: shrunk,
            pageFromNewest: 73,
            selectedID: nil
        )
        XCTAssertEqual(shrunkWindow.pageFromNewest, 0)
        XCTAssertEqual(shrunkWindow.agents.count, 20)
        XCTAssertEqual(
            SubagentPresentationScale.panelPageAfterListChange(
                currentPage: 73,
                previousIdentity: oldWindow.listIdentity,
                newIdentity: shrunkWindow.listIdentity
            ),
            0
        )

        let replacementWave = (10_000..<20_000).map { agent($0, state: .ok) }
        let replacementWindow = SubagentPresentationScale.panelWindow(
            for: replacementWave,
            pageFromNewest: 73,
            selectedID: nil
        )
        XCTAssertNotEqual(replacementWindow.listIdentity, oldWindow.listIdentity)
        XCTAssertEqual(
            SubagentPresentationScale.panelPageAfterListChange(
                currentPage: 73,
                previousIdentity: oldWindow.listIdentity,
                newIdentity: replacementWindow.listIdentity
            ),
            0
        )
        XCTAssertLessThanOrEqual(replacementWindow.agents.count, SubagentPresentationScale.panelRowCap)
    }

    // MARK: - 失败处置分类（已清理 / 需关注）

    func testFailedCleanedRetainsFailureBadgeAndAddsSeparateHandledBadge() {
        var cleaned = agent(0, state: .failed)
        cleaned.closeoutDisposition = .cleaned

        let summary = SubagentPresentationScale.summary(for: [cleaned])
        let row = SubagentPresentationScale.rowPresentation(for: cleaned)

        XCTAssertEqual(summary.failedCount, 1)
        XCTAssertEqual(summary.failedCleanedCount, 1)
        XCTAssertEqual(summary.failedAttentionCount, 0)
        XCTAssertEqual(row.iconName, "xmark.circle.fill")
        XCTAssertEqual(row.tone, .danger)
        XCTAssertEqual(row.terminalBadgeText, "失败·需处理")
        XCTAssertEqual(row.handledBadgeText, "已处理")
        XCTAssertEqual(row.statusText, "失败·需处理 · 已处理")
        XCTAssertFalse(row.terminalBadgeText?.contains("已处理·本次") == true)
        XCTAssertFalse(row.needsAttention)
        XCTAssertFalse(row.canMarkHandled)
        XCTAssertNil(row.lifecycleWarning)
    }

    func testFailedRetainedNeedsAttentionAndPresentsOpenFailure() {
        // retained 可能是验证失败或自动合并/清理被禁止而保留待复核，因此计入需关注。
        var retained = agent(0, state: .failed)
        retained.closeoutDisposition = .retained

        let summary = SubagentPresentationScale.summary(for: [retained])
        let row = SubagentPresentationScale.rowPresentation(for: retained)

        XCTAssertEqual(summary.failedCount, 1)
        XCTAssertEqual(summary.failedCleanedCount, 0)
        XCTAssertEqual(summary.failedAttentionCount, 1)
        XCTAssertEqual(row.iconName, "xmark.circle.fill")
        XCTAssertEqual(row.tone, .danger)
        XCTAssertEqual(row.terminalBadgeText, "失败·需处理")
        XCTAssertNil(row.handledBadgeText)
        XCTAssertTrue(row.needsAttention)
        XCTAssertTrue(row.canMarkHandled)
        XCTAssertEqual(row.lifecycleWarning?.title, "本次执行未成功")
    }

    func testCleanedAbortedAndInterruptedRetainTerminalBadgeAndAddHandledBadge() {
        let cases: [(SubagentInfo.State, String, SubagentPresentationScale.LifecycleTone, String)] = [
            (.aborted, "stop.circle.fill", .warning, "已中止·需处理"),
            (.interrupted, "bolt.slash.circle.fill", .warning, "已中断·需处理"),
        ]

        for (state, expectedIcon, expectedTone, expectedTerminalText) in cases {
            var handled = agent(0, state: state)
            handled.closeoutDisposition = .cleaned
            let row = SubagentPresentationScale.rowPresentation(for: handled)

            XCTAssertEqual(row.iconName, expectedIcon)
            XCTAssertEqual(row.tone, expectedTone)
            XCTAssertEqual(row.terminalBadgeText, expectedTerminalText)
            XCTAssertEqual(row.handledBadgeText, "已处理")
            XCTAssertEqual(row.statusText, "\(expectedTerminalText) · 已处理")
            XCTAssertFalse(row.needsAttention)
            XCTAssertFalse(row.canMarkHandled)
            XCTAssertNil(row.lifecycleWarning)
        }
    }

    func testFailedCompletedOutputStillShowsLifecycleWarning() {
        var failed = agent(0, state: .failed)
        failed.closeoutDisposition = .retained
        failed.output = "Completed: all requested work is done."

        let row = SubagentPresentationScale.rowPresentation(for: failed)

        XCTAssertEqual(failed.state, .failed)
        XCTAssertTrue(row.needsAttention)
        XCTAssertEqual(row.lifecycleWarning?.title, "本次执行未成功")
        XCTAssertTrue(row.lifecycleWarning?.message.contains("不代表任务已成功") == true)
    }

    func testFailedUnclassifiedFixerUserNeedAttention() {
        let dispositions: [AgentCloseoutDisposition] = [.unclassified, .needsFixer, .needsUser]
        let agents = dispositions.enumerated().map { index, disposition in
            var a = agent(index, state: .failed)
            a.closeoutDisposition = disposition
            return a
        }

        let summary = SubagentPresentationScale.summary(for: agents)

        XCTAssertEqual(summary.failedCount, 3)
        XCTAssertEqual(summary.failedCleanedCount, 0)
        XCTAssertEqual(summary.failedAttentionCount, 3)
    }

    func testNonFailedAgentsDoNotEnterCleanupCounts() {
        var failedUnclassified = agent(0, state: .failed)
        failedUnclassified.closeoutDisposition = .unclassified
        var failedCleaned = agent(1, state: .failed)
        failedCleaned.closeoutDisposition = .cleaned
        var running = agent(2, state: .running)
        running.closeoutDisposition = .cleaned
        var ok = agent(3, state: .ok)
        ok.closeoutDisposition = .retained
        var aborted = agent(4, state: .aborted)
        aborted.closeoutDisposition = .needsUser

        let summary = SubagentPresentationScale.summary(
            for: [failedUnclassified, failedCleaned, running, ok, aborted]
        )

        XCTAssertEqual(summary.failedCount, 2)
        XCTAssertEqual(summary.failedCleanedCount, 1)
        XCTAssertEqual(summary.failedAttentionCount, 1)
    }

    func testCleanedPlusAttentionAlwaysEqualsFailed() {
        let dispositions: [AgentCloseoutDisposition] = [
            .cleaned, .retained, .unclassified, .needsFixer, .needsUser,
        ]
        var agents: [SubagentInfo] = []
        for (index, disposition) in dispositions.enumerated() {
            var a = agent(index, state: index.isMultiple(of: 2) ? .failed : .ok)
            a.closeoutDisposition = disposition
            agents.append(a)
        }

        let summary = SubagentPresentationScale.summary(for: agents)
        let card = SubagentPresentationScale.cardPresentation(for: agents)

        XCTAssertEqual(summary.failedCleanedCount + summary.failedAttentionCount, summary.failedCount)
        XCTAssertEqual(
            card.summary.failedCleanedCount + card.summary.failedAttentionCount,
            card.summary.failedCount
        )
    }

    func testFailureTextCoversCleanedAndAttentionCopy() {
        var cleaned = agent(0, state: .failed)
        cleaned.closeoutDisposition = .cleaned
        var retained = agent(1, state: .failed)
        retained.closeoutDisposition = .retained
        var pending = agent(2, state: .failed)
        pending.closeoutDisposition = .unclassified
        var pendingUser = agent(3, state: .failed)
        pendingUser.closeoutDisposition = .needsUser

        let allCleaned = SubagentPresentationScale.summary(for: [cleaned])
        XCTAssertEqual(SubagentPresentationScale.failureText(allCleaned), "1 失败·已处理")

        let mixed = SubagentPresentationScale.summary(for: [cleaned, retained, pending])
        XCTAssertEqual(SubagentPresentationScale.failureText(mixed), "3 失败·2 需关注")

        let allAttention = SubagentPresentationScale.summary(for: [pending, pendingUser])
        XCTAssertEqual(SubagentPresentationScale.failureText(allAttention), "2 失败·需关注")

        XCTAssertTrue(SubagentPresentationScale.failureHelp(mixed).contains("本次执行已成功"))
        XCTAssertTrue(SubagentPresentationScale.failureHelp(mixed).contains("不代表底层失败已修复或用户已确认"))
        XCTAssertTrue(SubagentPresentationScale.failureHelp(mixed).contains("已处理 1"))
        XCTAssertTrue(SubagentPresentationScale.failureHelp(mixed).contains("需关注 2"))
        XCTAssertTrue(SubagentPresentationScale.failureHelp(mixed).contains("保留待复核"))
        XCTAssertTrue(SubagentPresentationScale.failureHelp(mixed).contains("已明确处置"))
    }

    private func agent(
        _ index: Int,
        state: SubagentInfo.State,
        cost: Double = 0
    ) -> SubagentInfo {
        let date = Date(timeIntervalSince1970: TimeInterval(index))
        return SubagentInfo(
            id: String(index),
            parentId: nil,
            name: "agent-\(index)",
            task: "task-\(index)",
            depth: 1,
            model: nil,
            state: state,
            cost: cost,
            started: date,
            lastObservedAt: date
        )
    }
}
