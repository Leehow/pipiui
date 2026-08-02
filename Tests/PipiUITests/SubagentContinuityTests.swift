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

    /// A report is a one-shot deliverable; yesterday's context would only bias the next one.
    func testReadOnlyRolesStayEphemeral() throws {
        let s = try source()
        XCTAssertTrue(s.contains("const sessionDir = agent.traits.readOnly ? undefined : agentSessionDir();"))
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
        XCTAssertTrue(s.contains("const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;"))
        XCTAssertTrue(s.contains("if (runningAgents.size === 0) return;"),
                      "an idle session must stay silent; a heartbeat costs the boss a turn")
        XCTAssertTrue(s.contains("[subagent-heartbeat] outstanding="))
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
        XCTAssertTrue(s.contains("if (pendingDone.get(agentId) !== entry) return;"),
                      "a stale promise must not clear replacement delivery state")
        XCTAssertTrue(s.contains("if (ok) {\n\t\t\tdeliveredDone.add(agentId);\n\t\t\tpendingDone.delete(agentId);"),
                      "only a confirmed resolve may clear the retry state")
        XCTAssertTrue(s.contains("if (now - entry.lastAttemptAt < DONE_RETRY_MIN_INTERVAL_MS) continue;"),
                      "retries ride the 30s scan but no more than once a minute per worker")
        XCTAssertTrue(s.contains("(re-delivery #"),
                      "a retry must say it is the same event, not a new one")
    }

    /// A racing notify must not start a second send, but a failed first send must remain retryable.
    /// The delivered latch therefore arms only after confirmation, separately from in-flight state.
    func testDoneIsDeliveredAtMostOncePerAgentRun() throws {
        let s = try source()
        XCTAssertTrue(s.contains("const deliveredDone = new Set<string>();"),
                      "confirmed delivery needs a per-agent latch")
        XCTAssertTrue(s.contains("if (deliveredDone.has(agentId)) return;"),
                      "confirmed delivery must intercept every later attempt")
        XCTAssertTrue(s.contains("if (entry.inFlight || entry.attempts >= DONE_MAX_ATTEMPTS) return;"),
                      "an unresolved send must block duplicate concurrent sends")
        XCTAssertTrue(s.contains("if (ok) {\n\t\t\tdeliveredDone.add(agentId);"),
                      "only a successful send may arm the delivered latch")
        XCTAssertTrue(s.contains("deliveredDone.add(agentId);"),
                      "confirmed delivery arms the latch")
        XCTAssertTrue(s.contains("deliveredDone.delete(agentId);"),
                      "re-dispatching/resuming the same agentId opens a new run, so its own done may deliver again")
    }

    /// A boolean stallNotified pushed once and then went silent until the 15-minute heartbeat.
    /// A boss that chose to keep waiting must hear again: the handle now stamps the last push
    /// and re-pushes once five more minutes of idleness have passed.
    func testStallRenotifiesOnATimestampNotABoolean() throws {
        let s = try source()
        XCTAssertTrue(s.contains("lastStallNotifyAt: number;"),
                      "a timestamp, not a boolean, so a continuing stall can be re-pushed")
        XCTAssertTrue(s.contains("handle.lastStallNotifyAt = 0;"),
                      "new activity re-arms the stall push for the next idle episode")
        XCTAssertTrue(s.contains("if (handle.lastStallNotifyAt > 0 && now - handle.lastStallNotifyAt < STALL_RENOTIFY_INTERVAL_MS) continue;"),
                      "re-push is gated at five minutes, not swallowed until the heartbeat")
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
        XCTAssertTrue(s.contains("markWorkerInterrupted(agentId, reason);"),
                      "30s poll must settle jobRegistry + pipiuiReport end, not only delete")
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
        XCTAssertTrue(s.contains("Resume of the same agentId must reopen a terminal row as running"))
        XCTAssertTrue(s.contains("const keepLive = existing?.state === \"running\";"))
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

    /// Research is the largest raw injection there is, so the boss must be able to hand it to a
    /// worker. Provider-hosted search already reaches workers through pi's own discovery, but
    /// only for models whose provider ships it — the generic tools are the fallback that makes
    /// delegating research work whatever model the worker runs.
    func testWorkersCanSearchTheWebSoResearchIsDelegable() throws {
        let s = try source()
        XCTAssertTrue(s.contains("const PIPIUI_WEBSEARCH_EXT = process.env.PIPIUI_WEBSEARCH_EXT;"))
        XCTAssertTrue(s.contains(#"if (PIPIUI_WEBSEARCH_EXT) args.push("-e", PIPIUI_WEBSEARCH_EXT);"#))

        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let assembly = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PipiSpawnAssembly.swift"),
            encoding: .utf8)
        XCTAssertTrue(assembly.contains(#"env["PIPIUI_WEBSEARCH_EXT"] = p"#),
                      "re-exported only inside the webSearch feature gate")

        // The allowlist filters registered tools, so explore needs them named explicitly.
        let explore = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PiExt/agents/explore.md"),
            encoding: .utf8)
        XCTAssertTrue(explore.contains("web_search"))
        XCTAssertTrue(explore.contains("web_fetch"))
    }

    /// The rule used to tell the boss to run every search itself, which contradicts the axiom
    /// that its context is the one non-renewable resource. Size decides now, not the fact that
    /// it is a search.
    func testMethodLayerRoutesResearchOutAndKeepsLookupsInline() throws {
        let t = try PhilosophyLayerFixture.normalizedBody("method")
        XCTAssertTrue(t.contains("Who does the searching follows the size of the question"))
        XCTAssertTrue(t.contains("retrieving a fact you can already name"))
        XCTAssertTrue(t.contains("Delegate to research"))
        XCTAssertTrue(t.contains("Cross-validating a design you just formed is almost always the second kind"))
        XCTAssertFalse(t.contains("you may run it yourself"),
                       "the blanket permission to search personally is what this replaced")
    }

    /// pi parses agent frontmatter as real YAML, so `read-only: true` arrives as a boolean.
    /// The old `Record<string, string>` annotation made the compiler vouch for a shape the
    /// runtime never produced, and `raw?.trim()` then threw for every agent declaring a flag —
    /// explore, plan, reviewer and lead were all un-dispatchable while general-purpose worked.
    func testAgentFrontmatterIsCoercedNotAssumedToBeStrings() throws {
        let bundled = try XCTUnwrap(PipiResourceBundle.shared.url(forResource: "PiExt", withExtension: nil))
        let s = try String(
            contentsOf: bundled.appendingPathComponent("subagent/agents.ts"), encoding: .utf8)
        XCTAssertTrue(s.contains("function flag(raw: unknown): boolean"))
        XCTAssertTrue(s.contains(#"if (typeof raw === "boolean") return raw;"#))
        XCTAssertTrue(s.contains("function str(raw: unknown): string | undefined"))
        XCTAssertTrue(s.contains("parseFrontmatter<Record<string, unknown>>(content)"),
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
