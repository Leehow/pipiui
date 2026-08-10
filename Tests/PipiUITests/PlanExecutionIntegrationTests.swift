import XCTest
@testable import PipiUI

/// End-to-end wiring for structured plan execution: ChatSession ownership,
/// production spawn handoff, bridge-shaped event reduction, persistence, routing.
final class PlanExecutionIntegrationTests: XCTestCase {

    private func repositoryRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    private func promptRequests(_ backend: FakeBackend) -> [[String: Any]] {
        backend.requested.filter { $0["type"] as? String == "prompt" }
    }

    private func seedInterruptedPlan(sessionFile: String, planID: String = "recover-1") {
        let writer = PlanStore()
        writer.attachPersistence(sessionFile: sessionFile)
        _ = writer.applyPublish(
            schemaVersion: 1,
            planId: planID,
            title: "Recover release",
            summary: "Resume after restart",
            tasks: [
                PlanTaskSnapshot(id: "done", title: "Finished", state: .completed),
                PlanTaskSnapshot(id: "interrupted", title: "Interrupted work", state: .pending),
                PlanTaskSnapshot(id: "next", title: "Verify", state: .pending),
            ]
        )
        _ = writer.approve(planId: planID)
        _ = writer.applyTaskUpdate(
            schemaVersion: 1,
            planId: planID,
            taskId: "interrupted",
            state: .running
        )
        writer.saveNow()
    }

    // MARK: - Production handoff (planRuntime must reach assemble args)

    func testProductionHandoffMountsPlanRuntimeInSpawnAssembly() {
        // Mirrors AppStore.makeSession: Paths.resolved → ChatSession.spawnPaths → assemble.
        var installed = PiPlugin.Installed()
        let planPath = "/tmp/pipiui-plan-runtime-\(UUID().uuidString).ts"
        installed.planRuntimeExtension = planPath
        installed.webviewExtension = "/tmp/webview.ts"
        installed.subagentDir = "/tmp/subagent"
        installed.agentsDir = "/tmp/agents"

        // Empty disabled set ⇒ every catalog feature enabled (missing = on).
        let features = BuiltInFeatureSettings.EnabledSet()
        let resolved = PipiSpawnAssembly.Paths.resolved(
            installed: installed,
            features: features,
            philosophyExtension: nil,
            computerUseExtension: nil
        )
        XCTAssertEqual(resolved.planRuntime, planPath)

        // ChatSession must not drop planRuntime when rebuilding Paths.
        let handedOff = ChatSession.spawnPaths(
            planRuntimeExtension: resolved.planRuntime,
            webviewExtension: resolved.webview,
            subagentDir: resolved.subagentDir,
            agentsDir: resolved.agentsDir
        )
        XCTAssertEqual(handedOff.planRuntime, planPath)

        let output = PipiSpawnAssembly.assemble(
            PipiSpawnAssembly.Input(
                sessionPath: nil,
                bridgePort: 9_999,
                bridgeRoutingKey: "bridge-key",
                computerRoutingKey: "computer-key",
                grantSessionKey: "grant",
                mainCWD: "/tmp",
                paths: handedOff,
                features: features,
                computerDescriptor: nil,
                mainModelId: nil,
                excludeToolsArgs: [],
                webSearchConfigFile: "/tmp/websearch.json",
                mcpConfigFile: "/tmp/mcp.json"
            )
        )
        XCTAssertTrue(
            output.args.contains(planPath),
            "assembled pi args must include -e plan runtime path; got \(output.args)"
        )
        if let idx = output.args.firstIndex(of: planPath), idx > 0 {
            XCTAssertEqual(output.args[idx - 1], "-e")
        } else {
            XCTFail("plan runtime path missing from args")
        }
        XCTAssertFalse(output.extraEnv.keys.contains(where: { $0.hasPrefix("PIPIUI_PLAN") }))

        // Philosophy off ⇒ resolved planRuntime nil even when installed.
        let disabled = BuiltInFeatureSettings.EnabledSet(
            disabledIDs: [BuiltInFeatureSettings.FeatureID.philosophy.rawValue]
        )
        let noPhil = PipiSpawnAssembly.Paths.resolved(
            installed: installed,
            features: disabled,
            philosophyExtension: nil,
            computerUseExtension: nil
        )
        XCTAssertNil(noPhil.planRuntime)
        let bare = PipiSpawnAssembly.assemble(
            PipiSpawnAssembly.Input(
                sessionPath: nil,
                bridgePort: 9_999,
                bridgeRoutingKey: "bridge-key",
                computerRoutingKey: "computer-key",
                grantSessionKey: "grant",
                mainCWD: "/tmp",
                paths: ChatSession.spawnPaths(planRuntimeExtension: planPath),
                features: disabled,
                computerDescriptor: nil,
                mainModelId: nil,
                excludeToolsArgs: [],
                webSearchConfigFile: "/tmp/websearch.json",
                mcpConfigFile: "/tmp/mcp.json"
            )
        )
        XCTAssertFalse(bare.args.contains(planPath), "philosophy-off must not mount plan runtime")
    }

    func testAppStorePassesPlanRuntimeExtensionIntoChatSession() throws {
        let root = repositoryRoot()
        let appStore = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/AppStore.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(appStore.contains("planRuntimeExtension: paths.planRuntime"))
        let session = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/ChatSession.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(session.contains("planRuntimeExtension: String? = nil"))
        XCTAssertTrue(session.contains("planRuntimeExtension: planRuntimeExtension"))
        XCTAssertTrue(session.contains("planRuntime: planRuntimeExtension"))
    }

    // MARK: - Eager restore from sessionPath

    func testEagerPlanStoreAttachFromSessionPath() {
        let token = UUID().uuidString
        let sessionFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("eager-\(token).jsonl").path
        let planURL = PlanStore.persistenceURL(forSessionFile: sessionFile)
        defer { try? FileManager.default.removeItem(at: planURL) }

        let seed = PlanStore()
        seed.attachPersistence(sessionFile: sessionFile)
        _ = seed.applyPublish(
            schemaVersion: 1,
            planId: "eager",
            title: "Eager restore",
            summary: nil,
            tasks: [
                PlanTaskSnapshot(id: "t1", title: "One", state: .pending),
            ]
        )
        _ = seed.approve(planId: "eager")
        _ = seed.applyTaskUpdate(
            schemaVersion: 1,
            planId: "eager",
            taskId: "t1",
            state: .running
        )
        seed.saveNow()

        let session = ChatSession(
            id: "test-\(token)",
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: sessionFile,
            blockedReason: "no-spawn-for-test"
        )
        XCTAssertEqual(session.sessionFile, sessionFile)
        XCTAssertEqual(session.planStore.plan?.title, "Eager restore")
        XCTAssertEqual(session.planStore.plan?.tasks.first?.state, .blocked)
        XCTAssertEqual(
            session.planStore.plan?.tasks.first?.detail,
            PlanSnapshot.interruptionExplanation
        )
        XCTAssertNotNil(session.userPromptIndex)
    }

    func testChatSessionOwnsPlanStoreAndAttachesWithSessionFile() {
        let token = UUID().uuidString
        let project = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-plan-int-\(token)", isDirectory: true)
        try? FileManager.default.createDirectory(at: project, withIntermediateDirectories: true)
        let sessionFile = project.appendingPathComponent("sess-\(token).jsonl").path
        let forked = project.appendingPathComponent("sess-\(token)-fork.jsonl").path
        let planURL = PlanStore.persistenceURL(forSessionFile: sessionFile)
        let forkPlanURL = PlanStore.persistenceURL(forSessionFile: forked)
        defer {
            try? FileManager.default.removeItem(at: project)
            try? FileManager.default.removeItem(at: planURL)
            try? FileManager.default.removeItem(at: forkPlanURL)
        }

        let store = PlanStore()
        store.attachPersistence(sessionFile: sessionFile)

        XCTAssertNotNil(store.persistURL)
        XCTAssertEqual(store.persistURL, planURL)
        XCTAssertTrue(store.persistURL!.path.contains("PipiUI/plans/"))
        XCTAssertTrue(store.persistURL!.lastPathComponent.hasSuffix(".plan.json"))

        XCTAssertEqual(
            store.applyBridgeEvent(J([
                "event": "publish",
                "schemaVersion": 1,
                "plan": [
                    "id": "main",
                    "title": "Integration plan",
                    "tasks": [
                        ["id": "t1", "title": "One", "state": "pending"],
                        ["id": "t2", "title": "Two", "state": "pending"],
                    ],
                ] as [String: Any],
            ])),
            .applied(revision: 1)
        )
        XCTAssertEqual(store.approve(planId: "main"), .applied(revision: 2))
        XCTAssertEqual(
            store.applyBridgeEvent(J([
                "event": "task_update",
                "schemaVersion": 1,
                "planId": "main",
                "task": ["id": "t1", "state": "running"] as [String: Any],
            ])),
            .applied(revision: 3)
        )
        store.saveNow()
        XCTAssertTrue(FileManager.default.fileExists(atPath: planURL.path))

        store.attachPersistence(sessionFile: forked)
        XCTAssertEqual(store.persistURL, forkPlanURL)
        XCTAssertNil(store.plan, "rebind to empty fork must not keep the previous session plan")

        let reread = PlanStore()
        reread.attachPersistence(sessionFile: sessionFile)
        XCTAssertEqual(reread.plan?.title, "Integration plan")
        XCTAssertEqual(reread.plan?.tasks.first?.state, .blocked)
        XCTAssertEqual(reread.plan?.revision, 3)
    }

    func testExecutePlanApprovesOnlyAfterExecutionPromptIsDeliveredOrQueued() {
        let session = ChatSession(
            id: UUID().uuidString,
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "no-spawn-for-test"
        )
        let backend = FakeBackend()
        session.attachTestingBackend(backend)
        _ = session.planStore.applyPublish(
            schemaVersion: 1,
            planId: "execute-1",
            title: "Run tests",
            summary: nil,
            tasks: [PlanTaskSnapshot(id: "t1", title: "Test", state: .pending)]
        )

        XCTAssertEqual(session.executePublishedPlan(planId: "execute-1"), .sent)
        XCTAssertEqual(session.planStore.plan?.lifecycle, .running)
        let prompt = backend.requested.last?["message"] as? String
        XCTAssertTrue(prompt?.contains("[PipiUI 计划执行指令]") == true)
        XCTAssertTrue(prompt?.contains("planId: execute-1") == true)
        XCTAssertTrue(prompt?.contains("planTitle: Run tests") == true)
        XCTAssertTrue(prompt?.contains("plan_task_update") == true)
        XCTAssertEqual(session.draftText, "")
        XCTAssertTrue(session.draftImages.isEmpty)

        let unavailable = ChatSession(
            id: UUID().uuidString,
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "no-spawn-for-test"
        )
        _ = unavailable.planStore.applyPublish(
            schemaVersion: 1,
            planId: "execute-2",
            title: "Unavailable",
            summary: nil,
            tasks: []
        )
        XCTAssertEqual(
            unavailable.executePublishedPlan(planId: "execute-2"),
            .rejected("会话尚未就绪，无法执行计划")
        )
        XCTAssertEqual(unavailable.planStore.plan?.lifecycle, .awaitingApproval)

        let queued = ChatSession(
            id: UUID().uuidString,
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "no-spawn-for-test"
        )
        let queuedBackend = FakeBackend()
        queued.attachTestingBackend(queuedBackend)
        _ = queued.planStore.applyPublish(
            schemaVersion: 1,
            planId: "execute-queued",
            title: "Queued",
            summary: nil,
            tasks: []
        )
        queued.isStreaming = true
        XCTAssertEqual(queued.executePublishedPlan(planId: "execute-queued"), .queued)
        XCTAssertEqual(queued.planStore.plan?.lifecycle, .running)
        XCTAssertEqual(queued.messageQueue.count, 1)
        XCTAssertTrue(queued.messageQueue[0].text.contains("planId: execute-queued"))
        XCTAssertTrue(queuedBackend.requested.isEmpty)
    }

    func testIgnorePlanCancelsWithoutSendingPrompt() {
        let session = ChatSession(
            id: UUID().uuidString,
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "no-spawn-for-test"
        )
        let backend = FakeBackend()
        session.attachTestingBackend(backend)
        _ = session.planStore.applyPublish(
            schemaVersion: 1,
            planId: "ignore-1",
            title: "Ignore",
            summary: nil,
            tasks: []
        )

        XCTAssertEqual(session.planStore.cancel(planId: "ignore-1"), .applied(revision: 2))
        XCTAssertTrue(backend.requested.isEmpty)
        XCTAssertNil(PlanStatusPresentation.make(from: session.planStore.plan))
    }

    func testChatSessionSourceWiresPlanStoreLifecycle() throws {
        let root = repositoryRoot()
        let session = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/ChatSession.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(session.contains("let planStore = PlanStore()"))
        XCTAssertTrue(session.contains("planStore.attachPersistence(sessionFile: sessionPath)"))
        XCTAssertTrue(session.contains("planStore.attachPersistence(sessionFile: file)"))
        XCTAssertTrue(session.contains("planStore.attachPersistence(sessionFile: path)"))
        XCTAssertTrue(session.contains("planStore.saveNow()"))
        XCTAssertTrue(session.contains("let userPromptIndex = UserPromptIndex()"))
        XCTAssertTrue(session.contains("userPromptIndex.apply(transcript)"))
    }

    // MARK: - AppStore bridge routing

    func testAppStoreRoutesPlanEventToMatchedSessionPlanStore() throws {
        let root = repositoryRoot()
        let appStore = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/AppStore.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(appStore.contains("if action == \"plan_event\""))
        XCTAssertTrue(appStore.contains("session.planStore.applyBridgeEvent(request)"))
        XCTAssertTrue(appStore.contains("respond(outcome.responseBody)"))
        let agentIdx = appStore.range(of: "if action == \"agent_event\"")?.lowerBound
        let planIdx = appStore.range(of: "if action == \"plan_event\"")?.lowerBound
        let unknownIdx = appStore.range(of: "unknown session key")?.lowerBound
        XCTAssertNotNil(agentIdx)
        XCTAssertNotNil(planIdx)
        XCTAssertNotNil(unknownIdx)
        if let agentIdx, let planIdx, let unknownIdx {
            XCTAssertLessThan(unknownIdx, agentIdx)
            XCTAssertLessThan(agentIdx, planIdx)
        }
    }

    // MARK: - Full reduce pipeline

    func testPublishUpdateRevisionTransitionProgressPipeline() {
        let store = PlanStore()

        XCTAssertEqual(
            store.applyBridgeEvent(J([
                "event": "publish",
                "schemaVersion": 1,
                "plan": [
                    "id": "p1",
                    "title": "Pipeline",
                    "summary": "end to end",
                    "tasks": [
                        ["id": "design", "title": "Design"],
                        ["id": "build", "title": "Build"],
                        ["id": "test", "title": "Test"],
                    ],
                ] as [String: Any],
            ])),
            .applied(revision: 1)
        )
        XCTAssertEqual(store.plan?.progress.fraction, 0)
        XCTAssertEqual(store.plan?.aggregateState, .pending)
        XCTAssertEqual(store.approve(planId: "p1"), .applied(revision: 2))

        XCTAssertEqual(
            store.applyBridgeEvent(J([
                "event": "task_update",
                "schemaVersion": 1,
                "planId": "p1",
                "task": ["id": "design", "state": "running"],
            ])),
            .applied(revision: 3)
        )
        XCTAssertEqual(store.plan?.currentTask?.id, "design")

        // Omitted planId is a hard reject (no silent ignore).
        let missingId = store.applyBridgeEvent(J([
            "event": "task_update",
            "schemaVersion": 1,
            "task": ["id": "design", "state": "completed"],
        ]))
        XCTAssertEqual(
            missingId,
            .rejected(reason: "planId is required", currentRevision: 3)
        )
        XCTAssertEqual(missingId.responseBody["applied"] as? Bool, false)
        XCTAssertEqual(store.plan?.tasks.first?.state, .running)
        XCTAssertEqual(store.plan?.revision, 3)

        _ = store.applyBridgeEvent(J([
            "event": "task_update",
            "schemaVersion": 1,
            "planId": "p1",
            "task": ["id": "design", "state": "completed"],
        ]))
        let illegal = store.applyBridgeEvent(J([
            "event": "task_update",
            "schemaVersion": 1,
            "planId": "p1",
            "task": ["id": "design", "state": "failed"],
        ]))
        XCTAssertEqual(
            illegal,
            .rejected(reason: "illegal task transition completed → failed", currentRevision: 4)
        )
        XCTAssertEqual(store.plan?.revision, 4)

        _ = store.applyBridgeEvent(J([
            "event": "task_update",
            "schemaVersion": 1,
            "planId": "p1",
            "task": ["id": "build", "state": "completed"],
        ]))
        _ = store.applyBridgeEvent(J([
            "event": "task_update",
            "schemaVersion": 1,
            "planId": "p1",
            "task": ["id": "test", "state": "skipped"],
        ]))
        XCTAssertEqual(store.plan?.aggregateState, .completed)
        XCTAssertEqual(store.plan?.progress.doneCount, 3)
        XCTAssertEqual(store.plan?.progress.fraction ?? -1, 1.0, accuracy: 0.0001)
        XCTAssertEqual(store.plan?.revision, 6)

        let ok = PlanEventApplyOutcome.applied(revision: 7).responseBody
        XCTAssertEqual(ok["ok"] as? Bool, true)
        XCTAssertEqual(ok["applied"] as? Bool, true)
        XCTAssertEqual(ok["revision"] as? Int, 7)
        let bad = PlanEventApplyOutcome.rejected(reason: "x", currentRevision: 3).responseBody
        XCTAssertEqual(bad["ok"] as? Bool, false)
        XCTAssertEqual(bad["applied"] as? Bool, false)
        XCTAssertEqual(bad["error"] as? String, "x")
        XCTAssertEqual(bad["currentRevision"] as? Int, 3)
    }

    func testWrongSessionKeyIsRejectedBeforePlanRouting() throws {
        let root = repositoryRoot()
        let appStore = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/AppStore.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(appStore.contains("respond([\"ok\": false, \"error\": \"unknown session key\"])"))
        let planBlock = appStore.components(separatedBy: "if action == \"plan_event\"").last ?? ""
        let planHandler = planBlock.components(separatedBy: "if action ==").first ?? planBlock
        XCTAssertFalse(planHandler.contains("selectedSession"))
        XCTAssertTrue(planHandler.contains("session.planStore"))
    }

    // MARK: - Abnormal-exit plan recovery

    func testIdleInterruptedPlanOpenDoesNotPromptUntilContinueThenContinuesOnce() {
        let sessionFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("plan-recover-\(UUID().uuidString).jsonl").path
        let planURL = PlanStore.persistenceURL(forSessionFile: sessionFile)
        defer { try? FileManager.default.removeItem(at: planURL) }
        seedInterruptedPlan(sessionFile: sessionFile)

        let session = ChatSession(
            id: UUID().uuidString,
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: sessionFile,
            blockedReason: "no-spawn-for-test"
        )
        XCTAssertTrue(session.planStore.hasPendingInterruptionRecovery)
        XCTAssertEqual(session.planStore.plan?.tasks[1].state, .blocked)
        XCTAssertEqual(session.planStore.plan?.tasks[1].detail, PlanSnapshot.interruptionExplanation)

        let backend = FakeBackend()
        session.attachTestingBackend(backend)
        XCTAssertTrue(backend.requested.isEmpty, "idle session open must not auto-prompt")
        XCTAssertTrue(session.messageQueue.isEmpty)

        XCTAssertEqual(session.continueInterruptedPlan(planId: "recover-1"), .sent)
        let prompts = promptRequests(backend)
        XCTAssertEqual(prompts.count, 1)
        let instruction = prompts[0]["message"] as? String
        XCTAssertTrue(instruction?.contains("[PipiUI 计划恢复同步]") == true)
        XCTAssertTrue(instruction?.contains("planId: recover-1") == true)
        XCTAssertTrue(instruction?.contains("planTitle: Recover release") == true)
        XCTAssertTrue(instruction?.contains("completed: done — Finished") == true)
        XCTAssertTrue(instruction?.contains("interrupted: interrupted — Interrupted work") == true)
        XCTAssertTrue(instruction?.contains("nextPending: next — Verify") == true)
        XCTAssertTrue(instruction?.contains("plan_task_update") == true)
        XCTAssertFalse(session.planStore.hasPendingInterruptionRecovery)
        XCTAssertEqual(session.planStore.plan?.tasks[1].state, .running)
        XCTAssertNil(session.planStore.plan?.tasks[1].detail)

        XCTAssertEqual(
            session.continueInterruptedPlan(planId: "recover-1"),
            .rejected("没有待恢复的中断计划")
        )
        XCTAssertEqual(promptRequests(backend).count, 1, "duplicate Continue must not send another resync")
    }

    func testInterruptedContinueQueuesOnceWhenAgentIsBusy() {
        let sessionFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("plan-recover-queued-\(UUID().uuidString).jsonl").path
        let planURL = PlanStore.persistenceURL(forSessionFile: sessionFile)
        defer { try? FileManager.default.removeItem(at: planURL) }
        seedInterruptedPlan(sessionFile: sessionFile)

        let session = ChatSession(
            id: UUID().uuidString,
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: sessionFile,
            blockedReason: "no-spawn-for-test"
        )
        let backend = FakeBackend()
        session.attachTestingBackend(backend)
        session.isStreaming = true

        XCTAssertEqual(session.continueInterruptedPlan(planId: "recover-1"), .queued)
        XCTAssertTrue(promptRequests(backend).isEmpty)
        XCTAssertEqual(session.messageQueue.count, 1)
        XCTAssertTrue(session.messageQueue[0].text.contains("[PipiUI 计划恢复同步]"))
        XCTAssertFalse(session.planStore.hasPendingInterruptionRecovery)
        XCTAssertEqual(
            session.continueInterruptedPlan(planId: "recover-1"),
            .rejected("没有待恢复的中断计划")
        )
        XCTAssertEqual(session.messageQueue.count, 1)
    }

    func testFirstNormalPromptQueuesExactlyOneRecoveryContextAndReattachDoesNotRepeat() {
        let sessionFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("plan-auto-recover-\(UUID().uuidString).jsonl").path
        let planURL = PlanStore.persistenceURL(forSessionFile: sessionFile)
        defer { try? FileManager.default.removeItem(at: planURL) }
        seedInterruptedPlan(sessionFile: sessionFile)

        let session = ChatSession(
            id: UUID().uuidString,
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: sessionFile,
            blockedReason: "no-spawn-for-test"
        )
        let backend = FakeBackend()
        session.attachTestingBackend(backend)

        session.sendPrompt("Please continue with verification")
        XCTAssertEqual(promptRequests(backend).count, 1)
        XCTAssertTrue((promptRequests(backend)[0]["message"] as? String)?.contains("[PipiUI 计划恢复同步]") == true)
        XCTAssertEqual(session.messageQueue.count, 1)
        XCTAssertEqual(session.messageQueue[0].text, "Please continue with verification")
        XCTAssertFalse(session.planStore.hasPendingInterruptionRecovery)

        // A same-session reattach (get_state/session-file rebind) must preserve the
        // consumed latch rather than turn the first normal prompt into a duplicate resync.
        session.applyState(J(["sessionFile": sessionFile]))
        session.sendPrompt("Then summarize the result")
        XCTAssertEqual(promptRequests(backend).count, 1)
        XCTAssertEqual(session.messageQueue.count, 2)
        let allPromptTexts = promptRequests(backend).compactMap { $0["message"] as? String }
            + session.messageQueue.map(\.text)
        XCTAssertEqual(
            allPromptTexts.filter { $0.contains("[PipiUI 计划恢复同步]") }.count,
            1
        )
    }

    func testGenuineBlockedPlanDoesNotAutoResyncAndIgnoreCancelsWithoutPrompt() {
        let session = ChatSession(
            id: UUID().uuidString,
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "no-spawn-for-test"
        )
        let backend = FakeBackend()
        session.attachTestingBackend(backend)
        _ = session.planStore.applyPublish(
            schemaVersion: 1,
            planId: "business-block",
            title: "Needs decision",
            summary: nil,
            tasks: [PlanTaskSnapshot(
                id: "wait",
                title: "Await user",
                state: .blocked,
                detail: "Choose a deployment target"
            )]
        )
        _ = session.planStore.approve(planId: "business-block")

        XCTAssertFalse(session.planStore.hasPendingInterruptionRecovery)
        session.sendPrompt("I choose staging")
        XCTAssertEqual(promptRequests(backend).count, 1)
        XCTAssertFalse((promptRequests(backend)[0]["message"] as? String)?.contains("计划恢复同步") == true)
        XCTAssertEqual(
            session.continueInterruptedPlan(planId: "business-block"),
            .rejected("没有待恢复的中断计划")
        )

        XCTAssertEqual(session.planStore.cancel(planId: "business-block"), .applied(revision: 3))
        XCTAssertEqual(promptRequests(backend).count, 1, "Ignore/cancel itself must not send a prompt")
        XCTAssertNil(
            PlanStatusPresentation.make(
                from: session.planStore.plan,
                hasPendingInterruptionRecovery: session.planStore.hasPendingInterruptionRecovery
            )
        )
    }
}
