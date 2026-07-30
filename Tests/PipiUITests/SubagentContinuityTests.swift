import XCTest
@testable import PipiUI

/// Named, resumable workers: the boss picks a short id, and re-dispatching that id continues
/// the same worker with its own conversation rather than a stranger with an empty head.
final class SubagentContinuityTests: XCTestCase {
    private func source() throws -> String {
        let bundled = try XCTUnwrap(PipiResourceBundle.shared.url(forResource: "PiExt", withExtension: nil))
        return try String(contentsOf: bundled.appendingPathComponent("subagent/index.ts"), encoding: .utf8)
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
        XCTAssertTrue(s.contains("const problem = validateAgentId(candidate.trim());"))
        XCTAssertTrue(s.contains("content: [{ type: \"text\", text: problem }]"))
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

    /// A report is a one-shot deliverable; yesterday's context would only bias the next one.
    func testReadOnlyRolesStayEphemeral() throws {
        let s = try source()
        XCTAssertTrue(s.contains("const sessionDir = READ_ONLY_AGENTS.has(agentName) ? undefined : agentSessionDir();"))
        XCTAssertTrue(s.contains(#"args.push("--no-session")"#), "no session dir must still mean no session")
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
        let s = try source()
        XCTAssertTrue(s.contains(#"${result.resumed ? " resumed=true" : ""}"#))
        XCTAssertTrue(s.contains("resumed?: boolean;"))
    }

    func testAgentIdAndFreshAreDispatchParameters() throws {
        let s = try source()
        XCTAssertTrue(s.contains("agentId: Type.Optional(Type.String({ description: AGENT_ID_DESCRIPTION }))"))
        XCTAssertTrue(s.contains("fresh: Type.Optional(Type.Boolean({ description: FRESH_DESCRIPTION }))"))
        XCTAssertTrue(s.contains("const agentId = t.agentId?.trim() || generatePipiuiAgentId();"),
                      "parallel tasks must be nameable too")
        XCTAssertTrue(s.contains("const agentId = params.agentId?.trim() || generatePipiuiAgentId();"))
        // Regression: the synchronous paths minted their own id, so a named worker silently
        // became an anonymous one whenever the dispatch was not backgrounded.
        XCTAssertTrue(s.contains("agentId: t.agentId?.trim(), fresh: t.fresh }"),
                      "synchronous parallel must honour the caller's name")
        XCTAssertTrue(s.contains("agentId: params.agentId?.trim(), fresh: params.fresh }"),
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
        XCTAssertTrue(s.contains("const SESSION_MAX_KEEP = 50;"))
        XCTAssertTrue(s.contains("function selectStaleSessions("), "the rule must be pure and testable")
        XCTAssertTrue(s.contains("entries.filter((e) => !opts.running.has(e.agentId))"),
                      "a running worker's conversation must never be a deletion candidate")
        XCTAssertTrue(s.contains("if (prunedThisProcess) return;"), "housekeeping runs once, not per dispatch")
        // Cleanup must never be able to fail a dispatch.
        XCTAssertTrue(s.contains("// A file we cannot remove only costs disk; never fail a dispatch over housekeeping."))
    }

    /// Background dispatch ends the boss's turn, so the session only moves again when something
    /// pushes it — and every other push fires at most once per worker. If one is missed the boss
    /// waits forever on work that is already over, so the silence itself has to be bounded.
    func testHeartbeatBoundsHowLongTheBossCanHearNothing() throws {
        let s = try source()
        XCTAssertTrue(s.contains("const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;"))
        XCTAssertTrue(s.contains("if (runningAgents.size === 0) return;"),
                      "an idle session must stay silent; a heartbeat costs the boss a turn")
        XCTAssertTrue(s.contains("[subagent-heartbeat] outstanding="))
        XCTAssertTrue(s.contains("Do not re-dispatch a worker that is still running"))
    }

    /// Idleness is not death: a worker can be quiet while thinking, and a dead one can leave a
    /// registry entry behind when its close handler never ran — exactly the case that hangs the
    /// boss. Only asking the OS separates the two.
    func testVanishedWorkersAreDetectedByLivenessNotByIdleness() throws {
        let s = try source()
        XCTAssertTrue(s.contains("function isProcessAlive(pid: number): boolean"))
        XCTAssertTrue(s.contains("process.kill(pid, 0)"))
        XCTAssertTrue(s.contains(#"=== "EPERM""#), "a process owned by someone else is still alive")
        XCTAssertTrue(s.contains("if (handle.pid !== undefined && !isProcessAlive(handle.pid))"))
        XCTAssertTrue(s.contains("runningAgents.delete(agentId);"), "report a vanished worker once")
        XCTAssertTrue(s.contains("interrupted, not failed"),
                      "a vanished worker still has its context and should be continued by name")
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
        XCTAssertTrue(s.contains("function seedBossLedger()"))
        XCTAssertTrue(s.contains("if (fs.existsSync(file)) return;"), "an existing ledger is session state")
        XCTAssertTrue(s.contains("## Closeout dispositions"), "the seeded file carries the layout")
        XCTAssertTrue(s.contains("seedBossLedger();"), "seeded at first real dispatch, matching lazy discovery")

        let t = try PhilosophyLayerFixture.normalizedBody("orchestration")
        XCTAssertTrue(t.contains("the runtime has already created your ledger"))
        XCTAssertFalse(t.contains("| ID | title | status |"), "the template must be gone from the prefix")
    }

    /// The philosophy has to teach the boss to use the mechanism, or nobody names anything.
    func testOrchestrationLayerTeachesNamedVerticalSlices() throws {
        let t = try PhilosophyLayerFixture.normalizedBody("orchestration")
        XCTAssertTrue(t.contains("One worker per vertical slice"))
        XCTAssertTrue(t.contains("Name the worker, not just the task"))
        XCTAssertTrue(t.contains("implement → verify → diagnose the failure → fix → re-verify"))
        XCTAssertTrue(t.contains("two-attempts rule outranks continuity"))
        XCTAssertTrue(t.contains("Read-only roles (plan / explore / reviewer) are always cold"))
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
