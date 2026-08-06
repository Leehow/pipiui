import XCTest
@testable import PipiUI

@MainActor
final class SubagentDormancyAndLedgerTests: XCTestCase {
    private func makeAgent(
        id: String,
        state: SubagentInfo.State = .ok,
        closeout: AgentCloseoutDisposition = .cleaned,
        lifecycle: WorktreeLifecycle = .merged,
        lastActivity: Date,
        cleanupSuggested: Bool = false
    ) -> SubagentInfo {
        SubagentInfo(
            id: id,
            parentId: nil,
            name: "worker",
            task: "task",
            depth: 1,
            model: nil,
            state: state,
            started: lastActivity.addingTimeInterval(-60),
            lastObservedAt: lastActivity,
            ended: lastActivity,
            worktreeLifecycle: lifecycle,
            closeoutDisposition: closeout,
            cleanupSuggested: cleanupSuggested
        )
    }

    func testCleanupSuggestedDefaultsFalseOnDecode() throws {
        let agent = makeAgent(id: "a1", lastActivity: Date())
        let data = try JSONEncoder().encode([agent])
        guard var root = try JSONSerialization.jsonObject(with: data) as? [[String: Any]],
              !root.isEmpty else {
            return XCTFail("expected encoded agent array")
        }
        root[0].removeValue(forKey: "cleanupSuggested")
        let stripped = try JSONSerialization.data(withJSONObject: root)
        let decoded = try JSONDecoder().decode([SubagentInfo].self, from: stripped)
        XCTAssertEqual(decoded.count, 1)
        XCTAssertFalse(decoded[0].cleanupSuggested)
    }

    func testIsDormantPredicateAndSevenDayMarking() async throws {
        let now = Date()
        let stale = now.addingTimeInterval(-8 * 24 * 60 * 60)
        let fresh = now.addingTimeInterval(-2 * 24 * 60 * 60)

        XCTAssertTrue(SubagentStore.isDormantForCleanupSuggestion(
            makeAgent(id: "c", closeout: .cleaned, lastActivity: stale)
        ))
        XCTAssertTrue(SubagentStore.isDormantForCleanupSuggestion(
            makeAgent(
                id: "i",
                state: .interrupted,
                closeout: .retained,
                lifecycle: .pendingReview,
                lastActivity: stale
            )
        ))
        XCTAssertTrue(SubagentStore.isDormantForCleanupSuggestion(
            makeAgent(
                id: "m",
                closeout: .needsFixer,
                lifecycle: .mergedCleanupPending,
                lastActivity: stale
            )
        ))
        XCTAssertFalse(SubagentStore.isDormantForCleanupSuggestion(
            makeAgent(
                id: "r",
                state: .running,
                closeout: .unclassified,
                lifecycle: .active,
                lastActivity: stale
            )
        ))

        let leaf = "dormancy-\(UUID().uuidString)"
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI/subagents")
        try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        let url = support.appendingPathComponent("\(leaf).agents.json")
        defer { try? FileManager.default.removeItem(at: url) }

        // Do not persist `.running` rows here: attachPersistence restart-reconcile turns them
        // into `.interrupted` (correct product behavior) and would blur the dormancy assertions.
        let agents = [
            makeAgent(id: "stale-cleaned", closeout: .cleaned, lastActivity: stale),
            makeAgent(id: "fresh-cleaned", closeout: .cleaned, lastActivity: fresh),
            makeAgent(
                id: "stale-interrupted",
                state: .interrupted,
                closeout: .retained,
                lifecycle: .pendingReview,
                lastActivity: stale
            ),
            makeAgent(
                id: "fresh-failed",
                state: .failed,
                closeout: .retained,
                lifecycle: .pendingReview,
                lastActivity: fresh
            ),
        ]
        try JSONEncoder().encode(agents).write(to: url, options: .atomic)

        let store = SubagentStore()
        store.attachPersistence(sessionFile: "/tmp/\(leaf).json")
        let deadline = Date().addingTimeInterval(2)
        while Date() < deadline, store.agents.count != agents.count {
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTAssertEqual(store.agents.count, agents.count)

        // attachPersistence already reaped at wall clock; dates are relative to Date() so marks
        // match the 7-day rule without a frozen clock.
        let byId = Dictionary(uniqueKeysWithValues: store.agents.map { ($0.id, $0) })
        XCTAssertEqual(byId["stale-cleaned"]?.cleanupSuggested, true)
        XCTAssertEqual(byId["fresh-cleaned"]?.cleanupSuggested, false)
        XCTAssertEqual(byId["stale-interrupted"]?.cleanupSuggested, true)
        XCTAssertEqual(byId["fresh-failed"]?.cleanupSuggested, false)
    }

    func testBossLedgerUpsertReplacesSameAgentIdAndSkipsMissingSection() {
        let seed = """
        # Ledger
        goal

        ## Closeout dispositions
        | item | disposition | evidence/reason |
        | ---- | ----------- | --------------- |
        | agent-a | retained | old reason 2020-01-01T00:00:00Z |
        <!-- disposition: cleaned | retained | needs-fixer | needs-user -->
        """
        let updated = BossLedgerCloseoutMirror.upsertRow(
            in: seed,
            agentId: "agent-a",
            dispositionLabel: "cleaned",
            evidence: "merged ok 2026-04-01T12:00:00Z"
        )
        XCTAssertNotNil(updated)
        let text = updated!
        XCTAssertTrue(text.contains("| agent-a | cleaned | merged ok 2026-04-01T12:00:00Z |"))
        XCTAssertFalse(text.contains("old reason"))
        XCTAssertEqual(text.components(separatedBy: "| agent-a |").count - 1, 1)

        let appended = BossLedgerCloseoutMirror.upsertRow(
            in: text,
            agentId: "agent-b",
            dispositionLabel: "needs-fixer",
            evidence: "merge failed 2026-04-01T12:01:00Z"
        )
        XCTAssertNotNil(appended)
        XCTAssertTrue(appended!.contains("| agent-b | needs-fixer | merge failed 2026-04-01T12:01:00Z |"))

        let missing = BossLedgerCloseoutMirror.upsertRow(
            in: "# Ledger\n\n## Tasks\n",
            agentId: "x",
            dispositionLabel: "cleaned",
            evidence: "n/a"
        )
        XCTAssertNil(missing)

        XCTAssertEqual(BossLedgerCloseoutMirror.dispositionLabel(.needsFixer), "needs-fixer")
        XCTAssertEqual(BossLedgerCloseoutMirror.dispositionLabel(.needsUser), "needs-user")
    }

    func testPurgeOnlyMergedCleanedSessionFiles() async throws {
        let now = Date()
        let stale = now.addingTimeInterval(-10 * 24 * 60 * 60)
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-reap-\(UUID().uuidString)", isDirectory: true)
        let sessions = tmp.appendingPathComponent(".pi/agent-sessions", isDirectory: true)
        try FileManager.default.createDirectory(at: sessions, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        let keepRunning = sessions.appendingPathComponent("20260101_pipiui-live.jsonl")
        let dropCleaned = sessions.appendingPathComponent("20260101_pipiui-old.jsonl")
        try "keep".write(to: keepRunning, atomically: true, encoding: .utf8)
        try "drop".write(to: dropCleaned, atomically: true, encoding: .utf8)

        let leaf = "reap-sess-\(UUID().uuidString)"
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI/subagents")
        try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        let url = support.appendingPathComponent("\(leaf).agents.json")
        defer { try? FileManager.default.removeItem(at: url) }

        let agents = [
            makeAgent(id: "old", closeout: .cleaned, lifecycle: .merged, lastActivity: stale),
            // Fresh cleaned agent must not lose its session file.
            makeAgent(id: "live", closeout: .cleaned, lifecycle: .merged, lastActivity: now),
        ]
        try JSONEncoder().encode(agents).write(to: url, options: .atomic)

        let store = SubagentStore()
        store.bindMainProject(tmp)
        store.attachPersistence(sessionFile: "/tmp/\(leaf).json")
        let deadline = Date().addingTimeInterval(2)
        while Date() < deadline, store.agents.count != 2 {
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTAssertEqual(store.agents.count, 2)

        // Reap again after load to ensure purge uses bound main project + loaded agents.
        _ = store.reapDormantState(now: now)
        // Background purge.
        try await Task.sleep(nanoseconds: 300_000_000)

        XCTAssertFalse(FileManager.default.fileExists(atPath: dropCleaned.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: keepRunning.path))
    }

    func testMechanicalCloseoutMirrorsIntoExistingLedger() async throws {
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-ledger-mirror-\(UUID().uuidString)", isDirectory: true)
        let boss = tmp.appendingPathComponent(".pi/boss", isDirectory: true)
        try FileManager.default.createDirectory(at: boss, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        let key = "cap-\(UUID().uuidString)"
        let ledger = boss.appendingPathComponent("ledger-\(key).md")
        try """
        # Ledger
        goal

        ## Closeout dispositions
        | item | disposition | evidence/reason |
        | ---- | ----------- | --------------- |
        <!-- disposition: cleaned | retained | needs-fixer | needs-user -->
        """.write(to: ledger, atomically: true, encoding: .utf8)

        let leaf = "mirror-\(UUID().uuidString)"
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI/subagents")
        try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        let url = support.appendingPathComponent("\(leaf).agents.json")
        defer { try? FileManager.default.removeItem(at: url) }

        let agent = makeAgent(
            id: "worker-1",
            state: .failed,
            closeout: .unclassified,
            lifecycle: .pendingReview,
            lastActivity: Date()
        )
        try JSONEncoder().encode([agent]).write(to: url, options: .atomic)

        let store = SubagentStore()
        store.bindMainProject(tmp)
        store.bridgeRoutingKey = key
        store.attachPersistence(sessionFile: "/tmp/\(leaf).json")
        let deadline = Date().addingTimeInterval(2)
        while Date() < deadline, store.agents.count != 1 {
            try await Task.sleep(nanoseconds: 20_000_000)
        }

        store.markCleaned(id: "worker-1")
        try await Task.sleep(nanoseconds: 300_000_000)

        let text = try String(contentsOf: ledger, encoding: .utf8)
        XCTAssertTrue(text.contains("| worker-1 | cleaned |"))
        XCTAssertTrue(text.contains("用户标记为已处理"))
    }
}
