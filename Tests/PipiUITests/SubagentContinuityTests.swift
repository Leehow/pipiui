import XCTest
@testable import PipiUI

/// Named, resumable workers: the boss picks a short id, and re-dispatching that id continues
/// the same worker with its own conversation rather than a stranger with an empty head.
final class SubagentContinuityTests: XCTestCase {
    private func source() throws -> String {
        let bundled = try XCTUnwrap(PipiResourceBundle.shared.url(forResource: "PiExt", withExtension: nil))
        return try String(contentsOf: bundled.appendingPathComponent("subagent/index.ts"), encoding: .utf8)
    }

    private func repositoryRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    /// The id is retyped by a model to continue a worker, and lands verbatim in a git branch
    /// and a session filename. Long random ids drift; a drifted id is silently a new worker.
    func testAgentIdIsShortSemanticAndValidated() throws {
        let s = try source()
        XCTAssertTrue(s.contains("const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,23}$/"))
        XCTAssertTrue(s.contains(#"RESERVED_AGENT_IDS = new Set(["root", "main", "head", "master"])"#))
        XCTAssertTrue(s.contains("function validateAgentId(id: string): string | null"))
        XCTAssertTrue(s.contains(#"id.includes("..")"#), "must not allow path traversal into a branch name")
    }

    /// Codex's pattern: a bad name is answered to the model so it renames and retries. Silently
    /// substituting a generated id would hand back a worker the boss cannot address again.
    func testInvalidAgentIdIsReportedToTheModelNotSilentlyReplaced() throws {
        let s = try source()
        XCTAssertTrue(s.contains("const invalid = validateAgentId(normalized);"))
        XCTAssertTrue(s.contains("content: [{ type: \"text\", text: callerSelection.problem }]"))
        XCTAssertTrue(s.contains("isError: true"))
    }

    /// The worker's cwd is a worktree that a successful merge deletes, so its conversation must
    /// not live there — that would discard context on exactly the runs that went well.
    func testSessionsLiveUnderTheMainProjectNotTheWorktree() throws {
        let s = try source()
        XCTAssertTrue(s.contains(#"path.join(PIPIUI_MAIN_CWD, ".pi", "agent-sessions")"#))
        XCTAssertTrue(s.contains(#"args.push("--session-id", sessionId, "--session-dir", sessionDir)"#))
        XCTAssertTrue(s.contains("const sessionId = `pipiui-${pipiuiAgentId}`"))
    }

    /// Read-only is an authority boundary, not a memory policy. Ordinary reports remain
    /// ephemeral, while an orchestrator may explicitly retain its own conversation.
    func testReadOnlyRolesStayEphemeralUnlessTheHostRetainsContext() throws {
        let s = try source()
        XCTAssertTrue(s.contains("retainContext?: boolean;"))
        XCTAssertTrue(s.contains("const sessionDir = agent.traits.readOnly && !options?.retainContext ? undefined : agentSessionDir();"))
        XCTAssertTrue(s.contains(#"args.push("--no-session")"#), "no session dir must still mean no session")
    }

    /// Restarting the Boss must not erase its ability to inspect what a previous subordinate
    /// did. History is semantic evidence for the Agent to judge, never an automatic task key.
    func testStatusSurfacesPersistedTaskAndResultHistory() throws {
        let s = try source()
        XCTAssertTrue(s.contains("resultSummary?: string;"))
        XCTAssertTrue(s.contains("function rememberAgentSliceTerminal("))
        XCTAssertTrue(s.contains("Historical workers (persisted task and result summaries"))
        XCTAssertTrue(s.contains("The Boss chooses whether this exact agentId belongs to the same semantic work"))
        XCTAssertFalse(s.contains("taskKey"), "continuity must be an Agent decision, not a program-owned task mapping")
    }

    /// Computer Use is still a subagent hierarchy: Boss selects a known Leader id, while the
    /// Host gives that Leader and its execution workers continuity without granting write power.
    func testComputerTaskCanResumeABossSelectedLeaderAndStableWorkers() throws {
        let s = try source()
        XCTAssertTrue(s.contains("selectComputerTaskLeaderAgentId(params.agentId"))
        XCTAssertTrue(s.contains("computerWorkerAgentId(taskId, \"operator\")"))
        XCTAssertTrue(s.contains("computerWorkerAgentId(taskId, \"computer-terminal\")"))
        XCTAssertTrue(s.contains("retainContext: true"))
    }

    /// Continuity must be escapable: a context that went wrong is worth throwing away.
    func testFreshDiscardsTheStoredConversation() throws {
        let s = try source()
        XCTAssertTrue(s.contains("if (sessionDir && options?.fresh)"))
        XCTAssertTrue(s.contains("for (const file of agentSessionFiles(sessionDir, sessionId))"))
        XCTAssertTrue(s.contains("fs.rmSync(file)"))
    }

    /// The boss cannot see the worker: absence of resumed=true on a name it meant to continue
    /// is the only signal that the name was typed wrong.
    func testResumedIsReportedInTheDoneHeader() throws {
        let root = repositoryRoot()
        let done = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PiExt/subagent/done-message.ts"),
            encoding: .utf8
        )
        XCTAssertTrue(done.contains(#"${result.resumed ? " resumed=true" : ""}"#))
        XCTAssertTrue(done.contains("resumed?: boolean;"))
    }

    func testAgentIdAndFreshAreDispatchParameters() throws {
        let s = try source()
        XCTAssertTrue(s.contains("agentId: Type.Optional(Type.String({ description: AGENT_ID_DESCRIPTION }))"))
        XCTAssertTrue(s.contains("fresh: Type.Optional(Type.Boolean({ description: FRESH_DESCRIPTION }))"))
        XCTAssertTrue(s.contains("const agentId = t.agentId?.trim() || generatePipiuiAgentId(requestAgentIds);"),
                      "parallel tasks must be nameable too")
        XCTAssertTrue(s.contains("const agentId = params.agentId?.trim() || generatePipiuiAgentId(requestAgentIds);"))
        // Regression: the synchronous paths minted their own id, so a named worker silently
        // became an anonymous one whenever the dispatch was not backgrounded.
        XCTAssertTrue(s.contains("agentId: t.agentId?.trim() || generatePipiuiAgentId(requestAgentIds),"),
                      "synchronous parallel must honour the caller's name")
        XCTAssertTrue(s.contains("agentId: params.agentId?.trim() || generatePipiuiAgentId(requestAgentIds),"),
                      "synchronous single must honour the caller's name")
    }

    /// The registry is memory in one process, so a restarted session forgets every worker it
    /// dispatched while their conversations are still on disk. Status has to see those, or the
    /// boss cannot establish state after a crash and will restart workers that never failed.
    func testStatusSurfacesWorkersResumableFromDisk() throws {
        let s = try source()
        XCTAssertTrue(s.contains("function resumableAgentIds()"))
        XCTAssertTrue(s.contains(#"/_pipiui-(.+)\.jsonl$/"#), "must map session filenames back to agent ids")
        XCTAssertTrue(s.contains(#"jobRegistry.get(id)?.state !== "running""#),
                      "a live worker is not a resumable one")
        XCTAssertTrue(s.contains("Resumable workers (stored context, not running)"))
        XCTAssertTrue(s.contains("This is an interruption, not a failure"))
    }

    /// Stored conversations are the whole point of naming a worker, so retention leans toward
    /// keeping them: age is the only "finished" signal trusted, because a merged slice is often
    /// continued the next day. The count cap only stops unbounded growth.
    func testSessionRetentionIsConservativeAndNeverTouchesRunningWorkers() throws {
        let s = try source()
        XCTAssertTrue(s.contains("const SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;"))
        XCTAssertTrue(s.contains("const SESSION_MAX_KEEP = 1000;"))
        XCTAssertTrue(s.contains("function selectStaleSessions("), "the rule must be pure and testable")
        XCTAssertTrue(s.contains("entries.filter((e) => !opts.running.has(e.agentId))"),
                      "a running worker's conversation must never be a deletion candidate")
        XCTAssertTrue(s.contains("const SESSION_PRUNE_COMPLETION_INTERVAL = 256;"),
                      "housekeeping must be amortized rather than scanning per worker")
        XCTAssertTrue(s.contains("pruneAgentSessions(sessionDir, \"completed\");"),
                      "later waves must keep advancing retention")
        // Cleanup must never be able to fail a dispatch.
        XCTAssertTrue(s.contains("// A file we cannot remove only costs disk; never fail a dispatch over housekeeping."))
    }

    /// Background dispatch ends the boss's turn, so the session only moves again when something
    /// pushes it — and every other push fires at most once per worker. If one is missed the boss
    /// waits forever on work that is already over, so the silence itself has to be bounded.
    func testHeartbeatBoundsHowLongTheBossCanHearNothing() throws {
        let s = try source()
        XCTAssertTrue(s.contains("const HEARTBEAT_INTERVAL_MS = envPositiveSecs(\"PIPIUI_HEARTBEAT_SECS\", 15 * 60) * 1000;"))
        XCTAssertTrue(s.contains("if (runningAgents.size === 0) {"),
                      "an idle session must stay silent; a heartbeat costs the boss a turn")
        XCTAssertTrue(s.contains("[subagent-heartbeat] outstanding="))
        XCTAssertTrue(s.contains("stalled=${stalled}"),
                      "heartbeat headers must expose the number of stalled workers")
        XCTAssertTrue(s.contains("state=${state}"),
                      "each heartbeat worker summary must expose an explicit state tag")
        XCTAssertTrue(s.contains("finalizing: boolean;"),
                      "completion bookkeeping must be distinct from a live or vanished worker")
        XCTAssertTrue(s.contains("Do not re-dispatch a worker that is still running"))
    }

    /// sendUserMessage is async: a sync try/catch around it never sees the rejection, so one
    /// failed delivery used to mean the boss never heard the done at all. Delivery must await
    /// both fallback tiers, and an unconfirmed done must be retried until the promise resolves.
    func testDoneDeliveryIsAwaitedConfirmedAndRetriedUntilAcknowledged() throws {
        let s = try source()
        XCTAssertTrue(s.contains("await pi.sendUserMessage(text, { deliverAs: \"followUp\" });"),
                      "only await turns an async rejection into a caught failure")
        XCTAssertTrue(s.contains("const pendingDone = new Map<string, PendingDoneEntry>();"),
                      "a done is unconfirmed until its promise resolves, so it must be tracked for retry")
        XCTAssertTrue(s.contains("if (pendingDone.get(obligation.id) !== entry) return;"),
                      "a stale promise must not clear replacement delivery state")
        XCTAssertTrue(s.contains("settled = doneDeliveryStore.finishAttempt(obligation.id, ok) ?? settled;"),
                      "only a confirmed resolve may clear the retry state")
        XCTAssertTrue(s.contains("if (now - entry.obligation.lastAttemptAt < DONE_RETRY_MIN_INTERVAL_MS) continue;"),
                      "retries ride the 30s scan but no more than once a minute per worker")
        XCTAssertTrue(s.contains("(re-delivery #"),
                      "a retry must say it is the same event, not a new one")
        XCTAssertTrue(s.contains("createDoneObligation(agentId, runId, text)"),
                      "the durable obligation must exist before first send")
        XCTAssertTrue(s.contains("initializeDoneDeliveryStore(pi, piSessionId);"),
                      "session_start must restore retryable obligations after Pi identity is available")
        XCTAssertTrue(s.contains("recovered delivery: this [subagent-done] may already have been delivered before restart"),
                      "ambiguous recovery must be visible to the receiving model")
        XCTAssertTrue(s.contains("return volatileObligation(agentId, runId, text);"),
                      "persistence failure must degrade to best-effort in-memory delivery")
    }

    /// A racing notify must not start a second send, but names may be reused for distinct runs.
    /// Identity is therefore completion-scoped rather than an agentId-only delivered latch.
    func testDoneIsDeliveredAtMostOncePerAgentRun() throws {
        let s = try source()
        XCTAssertFalse(s.contains("const deliveredDone = new Set<string>();"),
                       "an agentId-only latch suppresses a later distinct completion")
        XCTAssertTrue(s.contains("const episodeRunId = runId ?? DeliveryObligationStore.runId();"),
                      "each distinct dispatch gets an explicit run identity")
        XCTAssertTrue(s.contains("obligation.state === \"delivered\" || entry.inFlight || obligation.attempts >= DONE_MAX_ATTEMPTS"),
                      "an unresolved send must block duplicate concurrent sends")
        XCTAssertTrue(s.contains("if (obligation.state === \"delivered\") return;"),
                      "persisted confirmation suppresses the same completion")
    }

    /// Bridge routing credentials are regenerated with ChatSession and cannot name durable state.
    /// Recovery must bind to Pi's persisted session id, while bridge reports keep their capability.
    func testDoneDeliveryUsesStablePiSessionIdentityNotBridgeCapability() throws {
        let s = try source()
        XCTAssertTrue(s.contains(#"pi.on("session_start", (_event, ctx) => {"#))
        XCTAssertTrue(s.contains("const piSessionId = ctx.sessionManager.getSessionId().trim();"))
        XCTAssertTrue(s.contains("DeliveryObligationStore.routingDirectory(piSessionId)"))
        XCTAssertTrue(s.contains("{ routingKey: piSessionId }"))
        XCTAssertTrue(s.contains("if (doneDeliveryPiSessionId === piSessionId && doneDeliveryStore) return;"),
                      "repeated session_start/reload must not launch duplicate concurrent delivery")
        XCTAssertTrue(s.contains("pendingDone.clear();"),
                      "switching Pi sessions must leave old durable rows for their own later resume")
        XCTAssertFalse(s.contains("DeliveryObligationStore.routingDirectory(PIPIUI_SESSION)"))
        XCTAssertFalse(s.contains("{ routingKey: PIPIUI_SESSION }"))
        XCTAssertTrue(s.contains("PIPIUI_SESSION_CAPABILITY,"),
                      "the ephemeral capability is passed only to bridge request encoding")
        let bridge = try String(
            contentsOf: repositoryRoot().appendingPathComponent("Sources/PipiUI/PiExt/subagent/host-bridge.ts"),
            encoding: .utf8
        )
        XCTAssertTrue(bridge.contains("sessionCapability,"))
        XCTAssertTrue(bridge.contains("return { sessionKey, action: \"agent_event\", ...event };"),
                      "legacy bridge authorization remains separate from durable Pi session identity")
    }

    /// Drive the real persistence module in separate store instances (fresh extension processes),
    /// rather than checking only source strings. This covers crash ambiguity, acknowledgement,
    /// agent-id reuse, corruption, bounded rows, and a write-failure degradation boundary.
    func testDoneDeliveryObligationRestartStateMachine() throws {
        let node = Process()
        node.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        let module = repositoryRoot().appendingPathComponent(
            "Sources/PipiUI/PiExt/subagent/delivery-obligation.ts"
        )
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
            "pipiui-done-obligations-\(UUID().uuidString)",
            isDirectory: true
        )
        defer { try? FileManager.default.removeItem(at: directory) }

        node.arguments = [
            "node",
            "--experimental-strip-types",
            "--input-type=module",
            "--eval",
            #"""
            import assert from "node:assert/strict";
            import fs from "node:fs";
            import path from "node:path";
            const { DeliveryObligationStore } = await import(process.env.DELIVERY_MODULE);
            const dir = process.env.DELIVERY_DIR;
            let now = 1_000_000;
            const options = (pid, alive = () => false, extra = {}) => ({
              now: () => now,
              pid,
              ownerToken: `owner-${pid}`,
              processAlive: alive,
              ...extra,
            });

            // A stable Pi session id survives changing bridge capabilities; a different Pi
            // session under the same project has a disjoint directory and cannot cross-deliver.
            const routingRoot = `${dir}-routing`;
            const piSessionA = "persisted-pi-session-a";
            const piSessionB = "persisted-pi-session-b";
            const bridgeCapabilityA = "ephemeral-capability-a";
            const bridgeCapabilityB = "ephemeral-capability-b";
            assert.notEqual(bridgeCapabilityA, bridgeCapabilityB);
            const routeDir = sessionId => path.join(routingRoot, DeliveryObligationStore.routingDirectory(sessionId));
            const routeAFirst = new DeliveryObligationStore(routeDir(piSessionA), options(91, () => false, { routingKey: piSessionA }));
            const routed = routeAFirst.create("routed-worker", "run-1", "routed payload");
            const routeAAfterRestart = new DeliveryObligationStore(routeDir(piSessionA), options(92, () => false, { routingKey: piSessionA }));
            assert.deepEqual(routeAAfterRestart.recoverable().map(x => x.record.id), [routed.id]);
            const routeB = new DeliveryObligationStore(routeDir(piSessionB), options(93, () => false, { routingKey: piSessionB }));
            assert.notEqual(routeDir(piSessionA), routeDir(piSessionB));
            assert.equal(routeB.recoverable().length, 0);

            // Every cross-process recovery is conservatively ambiguity-labelled. A pending row
            // may be the residue of a failed begin-attempt write followed by best-effort send.
            const first = new DeliveryObligationStore(dir, options(101));
            const pending = first.create("worker-a", "run-1", "[subagent-done] payload one");
            assert.equal(first.read(pending.id).state, "pending");
            let fresh = new DeliveryObligationStore(dir, options(202));
            assert.deepEqual(fresh.recoverable().map(x => [x.record.id, x.ambiguous]), [[pending.id, true]]);

            // If begin-attempt persistence fails, index.ts still sends best-effort. The durable
            // pending residue must therefore recover as possibly duplicated, never as pristine.
            const beginFailDir = `${dir}-begin-fail`;
            const beginFail = new DeliveryObligationStore(beginFailDir, options(111));
            const beginFailRow = beginFail.create("begin-fail", "run-1", "payload");
            fs.chmodSync(beginFailDir, 0o500);
            assert.throws(() => beginFail.beginAttempt(beginFailRow.id));
            fs.chmodSync(beginFailDir, 0o700);
            const beginFailRecovery = new DeliveryObligationStore(beginFailDir, options(112));
            assert.deepEqual(beginFailRecovery.recoverable().map(x => x.ambiguous), [true]);

            // A crash after beginning send is ambiguous and must be visibly re-delivered.
            first.beginAttempt(pending.id);
            fresh = new DeliveryObligationStore(dir, options(202));
            assert.deepEqual(fresh.recoverable().map(x => [x.record.id, x.ambiguous]), [[pending.id, true]]);
            fresh.beginAttempt(pending.id);
            fresh.finishAttempt(pending.id, true);
            const afterAck = new DeliveryObligationStore(dir, options(303));
            assert.equal(afterAck.recoverable().length, 0);
            assert.equal(afterAck.read(pending.id).state, "delivered");

            // Same agent id with a distinct run or payload is a distinct completion.
            const runTwo = afterAck.create("worker-a", "run-2", "[subagent-done] payload one");
            const payloadTwo = afterAck.create("worker-a", "run-2", "[subagent-done] payload two");
            assert.notEqual(runTwo.id, pending.id);
            assert.notEqual(payloadTwo.id, runTwo.id);

            // A live recent owner is protected, but a reused/live PID cannot block forever once
            // the bounded claim lease expires.
            const leaseDir = `${dir}-lease`;
            const leaseOwner = new DeliveryObligationStore(leaseDir, options(303, () => true, { claimLeaseMs: 100 }));
            const leased = leaseOwner.create("leased", "run-1", "payload");
            leaseOwner.beginAttempt(leased.id);
            let observer = new DeliveryObligationStore(leaseDir, options(404, () => true, { claimLeaseMs: 100 }));
            assert.equal(observer.recoverable().length, 0);
            assert.equal(observer.beginAttempt(leased.id), undefined);
            now += 101;
            observer = new DeliveryObligationStore(leaseDir, options(404, () => true, { claimLeaseMs: 100 }));
            assert.deepEqual(observer.recoverable().map(x => x.ambiguous), [true]);
            assert.equal(observer.beginAttempt(leased.id).ownerPid, 404);

            // Corrupt rows are quarantined and never block healthy rows.
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, `${"a".repeat(64)}.json`), "{broken", "utf8");
            assert.doesNotThrow(() => afterAck.recoverable());
            assert.ok(fs.readdirSync(dir).some(name => name.includes(".corrupt-")));

            // Old auxiliary artifacts are cleaned, while a recent live claim is preserved.
            const artifactsDir = `${dir}-artifacts`;
            const artifacts = new DeliveryObligationStore(artifactsDir, options(515, pid => pid === 515, {
              claimLeaseMs: 100,
              auxiliaryMaxAgeMs: 100,
              maxAuxiliaryFiles: 4,
            }));
            const activeArtifactRow = artifacts.create("active", "run-1", "payload");
            artifacts.beginAttempt(activeArtifactRow.id);
            const liveClaim = `${activeArtifactRow.id}.claim`;
            for (const name of [
              `${"b".repeat(64)}.json.corrupt-old`,
              `${"c".repeat(64)}.claim.stale-old`,
              `${"d".repeat(64)}.json.tmp-old`,
              `${"e".repeat(64)}.claim`,
            ]) {
              const file = path.join(artifactsDir, name);
              fs.writeFileSync(file, name.endsWith(".claim")
                ? JSON.stringify({ pid: 999, ownerToken: "old", createdAt: now - 1000 })
                : "old", "utf8");
              fs.utimesSync(file, new Date(now - 1000), new Date(now - 1000));
            }
            now += 101;
            // Keep the real owner recent for this cleanup pass; age the junk relative to mtime.
            const cleanup = new DeliveryObligationStore(artifactsDir, options(616, pid => pid === 515, {
              claimLeaseMs: 1000,
              auxiliaryMaxAgeMs: 100,
              maxAuxiliaryFiles: 4,
            }));
            cleanup.recoverable();
            const auxiliaryNames = fs.readdirSync(artifactsDir).filter(name => !name.endsWith(".json"));
            assert.ok(auxiliaryNames.includes(liveClaim));
            assert.equal(auxiliaryNames.some(name => name.includes("corrupt-old") || name.includes("stale-old") || name.includes("tmp-old") || name.startsWith("e".repeat(64))), false);
            for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(artifactsDir, `${"f".repeat(64)}.json.tmp-fresh-${i}`), "fresh");
            cleanup.recoverable();
            assert.ok(fs.readdirSync(artifactsDir).filter(name => !name.endsWith(".json")).length <= 4);
            assert.ok(fs.existsSync(path.join(artifactsDir, liveClaim)));

            // Row pruning must not strand/delete a recent live attempt, even at row/attempt caps.
            const activeDir = `${dir}-active-prune`;
            const activeStore = new DeliveryObligationStore(activeDir, options(717, pid => pid === 717, {
              maxRows: 1,
              maxAttempts: 1,
              claimLeaseMs: 1000,
            }));
            const active = activeStore.create("active-prune", "run-1", "payload");
            activeStore.beginAttempt(active.id);
            activeStore.create("new-row", "run-2", "payload");
            assert.equal(activeStore.read(active.id).state, "attempting");
            assert.ok(fs.existsSync(path.join(activeDir, `${active.id}.claim`)));

            // Retention has a hard row cap.
            const boundedDir = `${dir}-bounded`;
            const bounded = new DeliveryObligationStore(boundedDir, options(505, () => false, { maxRows: 3 }));
            for (let i = 0; i < 6; i++) { now += 1; bounded.create(`w-${i}`, `r-${i}`, `payload-${i}`); }
            assert.ok(fs.readdirSync(boundedDir).filter(name => name.endsWith(".json")).length <= 3);

            // Attempt count is also bounded across fresh processes.
            const retryDir = `${dir}-retry`;
            const retrying = new DeliveryObligationStore(retryDir, options(707, () => false, { maxAttempts: 2 }));
            const retryRow = retrying.create("retry-worker", "retry-run", "retry payload");
            retrying.beginAttempt(retryRow.id); retrying.finishAttempt(retryRow.id, false);
            retrying.beginAttempt(retryRow.id); retrying.finishAttempt(retryRow.id, false);
            assert.equal(new DeliveryObligationStore(retryDir, options(808, () => false, { maxAttempts: 2 })).recoverable().length, 0);

            // A non-directory path produces a diagnosable throw; index.ts catches it and sends in-memory.
            const blocked = `${dir}-blocked`;
            fs.writeFileSync(blocked, "not a directory", "utf8");
            const degraded = new DeliveryObligationStore(path.join(blocked, "child"), options(606));
            assert.throws(() => degraded.create("w", "r", "payload"));
            """#,
        ]
        var environment = ProcessInfo.processInfo.environment
        environment["DELIVERY_MODULE"] = module.absoluteString
        environment["DELIVERY_DIR"] = directory.path
        node.environment = environment
        let stderr = Pipe()
        node.standardError = stderr
        try node.run()
        node.waitUntilExit()
        let errorText = String(
            data: stderr.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        ) ?? ""
        XCTAssertEqual(node.terminationStatus, 0, errorText)
    }

    /// A continuing stall must re-notify at most twice after its first push, then stay quiet
    /// until real activity starts a fresh idle episode.
    func testStallRenotifiesAreBoundedAndRearmedByActivity() throws {
        let s = try source()
        XCTAssertTrue(s.contains("const STALL_RENOTIFY_MAX = 3;"),
                      "one initial push plus two re-notifies bounds one idle episode")
        XCTAssertTrue(s.contains("stallNotifyCount: number;"),
                      "the running handle tracks how many pushes this idle episode used")
        XCTAssertTrue(s.contains("handle.stallNotifyCount = 0;"),
                      "new activity re-arms the stall cap for the next idle episode")
        XCTAssertTrue(s.contains("function claimStallNotification(handle: RunningAgentHandle, now: number): boolean"),
                      "the interval and cap must be claimed atomically in one helper")
        XCTAssertTrue(s.contains("if (handle.stallNotifyCount >= STALL_RENOTIFY_MAX) return false;"),
                      "a fourth spaced stall push must be rejected")
    }

    /// A worker whose pid is gone but whose close handler never ran used to wait for the
    /// heartbeat to be noticed. isProcessAlive is only signal 0, so the 30s poll can afford to
    /// check it every pass and report within half a minute — and must fully settle all ledgers.
    func testVanishedWorkersAreCaughtInTheThirtySecondPoll() throws {
        let s = try source()
        XCTAssertTrue(s.contains("if (!isHandleVanished(handle, now)) continue;"),
                      "a dead (or aged no-pid) handle must surface in the 30s poll")
        XCTAssertTrue(s.contains("function markWorkerInterrupted(agentId: string, reason: string)"),
                      "vanished path must share one full-settle helper")
        XCTAssertTrue(s.contains("if (!markWorkerInterrupted(agentId, reason)) continue;"),
                      "30s poll must settle jobRegistry + pipiuiReport end, not only delete")
        XCTAssertTrue(s.contains("if (handle.finalizing) continue;"),
                      "an observed child close must bypass watchdog vanish/stall handling during closeout")
        XCTAssertTrue(s.contains("interrupted, not failed"),
                      "a vanished worker still has its context and should be continued by name")
    }

    /// Idleness is not death: a worker can be quiet while thinking, and a dead one can leave a
    /// registry entry behind when its close handler never ran — exactly the case that hangs the
    /// boss. Only asking the OS separates the two; no-pid handles age out via NO_PID_VANISH_MS.
    func testVanishedWorkersAreDetectedByLivenessNotByIdleness() throws {
        let s = try source()
        XCTAssertTrue(s.contains("function isProcessAlive(pid: number): boolean"))
        XCTAssertTrue(s.contains("process.kill(pid, 0)"))
        XCTAssertTrue(s.contains(#"=== "EPERM""#), "a process owned by someone else is still alive")
        XCTAssertTrue(s.contains("function isHandleVanished(handle: RunningAgentHandle, now: number)"))
        XCTAssertTrue(s.contains("const NO_PID_VANISH_MS = 5 * 60 * 1000;"),
                      "handles that never attach a pid must not hang forever")
        XCTAssertTrue(s.contains("if (isHandleVanished(handle, now))"),
                      "heartbeat uses the same vanish predicate as the 30s poll")
        XCTAssertTrue(s.contains("state: \"interrupted\""),
                      "vanish settle must be interrupted, not a generic failed")
        XCTAssertTrue(s.contains("interrupted: true"),
                      "Swift panel must receive an interrupted end flag")
        XCTAssertTrue(s.contains("interrupted, not failed"),
                      "a vanished worker still has its context and should be continued by name")
    }

    /// Resume of a named worker must reopen the in-process job row so subagent_status matches
    /// the Swift start reopen (running again, not the previous terminal state).
    func testJobUpsertRunningReopensTerminalJobs() throws {
        let s = try source()
        XCTAssertFalse(s.contains("never reopen a terminal job"),
                       "terminal rows must reopen on same-agentId resume")
        XCTAssertTrue(s.contains("Every dispatch is a fresh episode"))
        XCTAssertTrue(s.contains("cancelInterruptedReminders(agentId);"),
                      "a same-agentId resume must clear old reminder state")
    }

    /// Handling that only matters when an event fires does not belong in a prefix paid for on
    /// every turn. It rides with the event instead — cheaper, and more likely to be followed
    /// sitting next to the thing it describes.
    func testSignalHandlingRidesWithTheEventNotThePrefix() throws {
        let s = try source()
        XCTAssertTrue(s.contains(#"Query it first with subagent_status({agentId:"${agentId}"})"#),
                      "a stall must arrive with its own handling")
        XCTAssertTrue(s.contains("Do not treat this message as a new user request."))

        // The layer keeps the standing facts and delegates the recipes to the messages.
        let fanout = try PhilosophyLayerFixture.normalizedBody("fanout")
        XCTAssertTrue(fanout.contains("each one carries its own handling instructions"))
        XCTAssertTrue(fanout.contains("Follow the instructions in the message you actually received"))
        for duplicated in ["you NEVER inspect conflict diffs", "Never forward a raw Git error"] {
            XCTAssertFalse(fanout.contains(PhilosophyLayerFixture.normalize(duplicated)),
                           "recipe duplicated in the prefix: \(duplicated)")
        }
    }

    /// 380 tokens of ledger template used to sit in every turn's prefix so it would be right on
    /// the few turns that write it. The file carries its own shape instead.
    func testLedgerLayoutLivesInTheFileNotThePrefix() throws {
        let s = try source()
        let root = repositoryRoot()
        let ledger = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PiExt/subagent/boss-ledger.ts"),
            encoding: .utf8
        )
        XCTAssertTrue(ledger.contains("function seedBossLedger(mainCwd: string | undefined, sessionKey: string | undefined)"))
        XCTAssertTrue(ledger.contains("if (fs.existsSync(file)) return;"), "an existing ledger is session state")
        XCTAssertTrue(ledger.contains("## Closeout dispositions"), "the seeded file carries the layout")
        XCTAssertTrue(s.contains("seedBossLedger(PIPIUI_MAIN_CWD, PIPIUI_SESSION);"), "seeded at first real dispatch, matching lazy discovery")

        let t = try PhilosophyLayerFixture.normalizedBody("orchestration")
        XCTAssertTrue(t.contains("the runtime has already created your ledger"))
        XCTAssertFalse(t.contains("| ID | title | status |"), "the template must be gone from the prefix")
    }

    /// Research is the largest raw injection there is, so the boss must be able to hand it to a
    /// worker. Provider-native web_search remains distinct, while PipiUI-owned URL/document
    /// routes are only mounted and named when the main session exported their usable path.
    func testWorkersInheritOnlyEnabledSpecialistRoutes() throws {
        let s = try source()
        for env in ["PIPIUI_WEB_ACCESS_EXT", "PIPIUI_ARXIV_EXT"] {
            XCTAssertTrue(s.contains("const \(env) = process.env.\(env);"), "worker must read \(env)")
        }
        XCTAssertTrue(s.contains("resolvePipiUIExtensionRouting({"))
        XCTAssertTrue(s.contains("availableExtensionTools: pipiuiExtensionRouting.extensionOnlyTools,"))
        XCTAssertTrue(s.contains("selectPipiUIExtensionRoutes(pipiuiExtensionRouting, toolSelection)"))

        let root = repositoryRoot()
        let assembly = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PipiSpawnAssembly.swift"),
            encoding: .utf8)
        XCTAssertTrue(assembly.contains(#"env["PIPIUI_WEB_ACCESS_EXT"] = p"#),
                      "managed web-access path is re-exported inside the webSearch feature gate")
        XCTAssertTrue(assembly.contains(#"env["PIPIUI_ARXIV_EXT"] = p"#),
                      "arXiv package path must reach workers")
    }

    func testBuiltInAgentSpecialistToolMatrixIsExplicit() throws {
        let specialist = Set(["web_search", "fetch_content", "source_check", "get_search_content", "arxiv_fetch"])
        let expected: [String: Set<String>] = [
            "explore": specialist,
            "general-purpose": specialist.subtracting(Set(["web_search"])),
            "plan": specialist.subtracting(Set(["web_search"])),
            "reviewer": specialist.subtracting(Set(["web_search"])),
            "operator": [],
            "secretary": [],
            "long-test": [],
        ]
        let agentsRoot = repositoryRoot().appendingPathComponent("Sources/PipiUI/PiExt/agents")
        for (name, tools) in expected {
            let source = try String(contentsOf: agentsRoot.appendingPathComponent("\(name)/AGENT.md"), encoding: .utf8)
            let line = try XCTUnwrap(source.split(separator: "\n").first(where: { $0.hasPrefix("tools:") }))
            let actual = Set(line.dropFirst("tools:".count).split(separator: ",").map {
                $0.trimmingCharacters(in: .whitespaces)
            })
            XCTAssertEqual(actual.intersection(specialist), tools, "\(name) specialist tools")
        }
    }

    /// The rule used to tell the boss to run every search itself, which contradicts the axiom
    /// that its context is the one non-renewable resource. Size decides now, not the fact that
    /// it is a search.
    func testMethodLayerRoutesResearchOutAndKeepsLookupsInline() throws {
        let t = try PhilosophyLayerFixture.normalizedBody("method")
        XCTAssertTrue(t.contains("Who does the searching follows your tooling first, then the size of the question"))
        XCTAssertTrue(t.contains("Native search"))
        XCTAssertTrue(t.contains("No native search: delegate first"))
        XCTAssertTrue(t.contains("Cross-validating a design you just formed is almost always the delegate-first kind"))
        XCTAssertFalse(t.contains("you may run it yourself"),
                       "the blanket permission to search personally is what this replaced")
    }

    /// pi parses agent frontmatter as real YAML, so `read-only: true` arrives as a boolean.
    /// The old `Record<string, string>` annotation made the compiler vouch for a shape the
    /// runtime never produced, and `raw?.trim()` then threw for every agent declaring a flag —
    /// explore, plan, and reviewer were all un-dispatchable while general-purpose worked.
    func testAgentFrontmatterIsCoercedNotAssumedToBeStrings() throws {
        let bundled = try XCTUnwrap(PipiResourceBundle.shared.url(forResource: "PiExt", withExtension: nil))
        let s = try String(
            contentsOf: bundled.appendingPathComponent("subagent/agents.ts"), encoding: .utf8)
        XCTAssertTrue(s.contains("function flag(raw: unknown): boolean"))
        XCTAssertTrue(s.contains(#"if (typeof raw === "boolean") return raw;"#))
        XCTAssertTrue(s.contains("function str(raw: unknown): string | undefined"))
        XCTAssertTrue(s.contains("parseFrontmatter<Record<string, unknown>>(input.content)"),
                      "the annotation must not claim every value is a string")
        XCTAssertFalse(s.contains("function flag(raw: string | undefined)"))
    }

    /// The philosophy has to teach the boss to use the mechanism, or nobody names anything.
    func testOrchestrationLayerTeachesNamedVerticalSlices() throws {
        let t = try PhilosophyLayerFixture.normalizedBody("orchestration")
        XCTAssertTrue(t.contains("Continuity within one vertical slice"))
        XCTAssertTrue(t.contains("It says nothing about how many slices run at once"),
                      "a continuity rule must not read as a cap on concurrent workers")
        XCTAssertTrue(t.contains("Name the worker, not just the task"))
        XCTAssertTrue(t.contains("implement → verify → diagnose the failure → fix → re-verify"))
        XCTAssertTrue(t.contains("two-attempts rule outranks continuity"))
        XCTAssertTrue(t.contains("Ordinary read-only roles (plan / explore / reviewer) are cold"))
        XCTAssertTrue(t.contains("Computer Use Leader may explicitly retain context"),
                      "read-only authority must not force a supervising Agent to forget its subordinates")
        XCTAssertTrue(t.contains("An interruption is not a failure"))
        XCTAssertTrue(t.contains("a *failed* worker produced a wrong answer; an *interrupted* one produced no answer yet"))
        XCTAssertTrue(t.contains("establish state rather than guessing"))

        // How to read a heartbeat travels with the heartbeat, not in every turn's prefix.
        let s = try source()
        XCTAssertTrue(s.contains("Silence is not progress"))
        XCTAssertTrue(s.contains("still thinking, died without reporting, or its report was lost"))
        XCTAssertTrue(s.contains("Do not re-dispatch a worker that is still running"))
    }
}
