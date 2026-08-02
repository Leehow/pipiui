import XCTest
@testable import PipiUI

/// Behavioral tests for pure high-fanout state policies plus small packaging contracts. They
/// deliberately do not launch a real high-fanout worker wave.
final class HighFanoutExtensionTests: XCTestCase {
    private func source() throws -> String {
        let bundled = try XCTUnwrap(PipiResourceBundle.shared.url(forResource: "PiExt", withExtension: nil))
        return try String(contentsOf: bundled.appendingPathComponent("subagent/index.ts"), encoding: .utf8)
    }

    private func pureRegion(_ name: String, in source: String) throws -> String {
        let begin = "// PIPIUI_PURE_\(name)_BEGIN"
        let end = "// PIPIUI_PURE_\(name)_END"
        let beginRange = try XCTUnwrap(source.range(of: begin))
        let endRange = try XCTUnwrap(source.range(of: end, range: beginRange.upperBound..<source.endIndex))
        return String(source[beginRange.upperBound..<endRange.lowerBound])
    }

    private func runNode(_ body: String, assertions: String) throws {
        let file = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("pipiui-high-fanout-\(UUID().uuidString).ts")
        defer { try? FileManager.default.removeItem(at: file) }
        let prelude = #"""
        import assert from "node:assert/strict";
        import fs from "node:fs";
        import os from "node:os";
        import path from "node:path";
        import { randomBytes } from "node:crypto";
        import { spawn, spawnSync } from "node:child_process";
        """#
        try (prelude + "\n" + body + "\n" + assertions)
            .write(to: file, atomically: true, encoding: .utf8)

        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", "--experimental-strip-types", file.path]
        process.standardOutput = output
        process.standardError = output
        try process.run()
        process.waitUntilExit()
        let diagnostic = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        XCTAssertEqual(process.terminationStatus, 0, diagnostic)
    }

    func testAdmissionCeilingsStayAtOneThousand() throws {
        let s = try source()
        XCTAssertTrue(s.contains("const MAX_PARALLEL_TASKS = 1000;"))
        XCTAssertTrue(s.contains("const MAX_CONCURRENCY = 1000;"))
    }

    func testTerminalHistoryIsBoundedWithoutPruningRunningJobs() throws {
        let s = try source()
        XCTAssertTrue(s.contains("const MAX_TERMINAL_JOB_RECORDS = 1000;"))
        XCTAssertTrue(s.contains(#".filter(([, j]) => j.state !== "running")"#))
        XCTAssertTrue(s.contains("const excess = finished.length - MAX_TERMINAL_JOB_RECORDS;"))
        XCTAssertFalse(s.contains("const all = [...jobRegistry.entries()]"),
                       "a fallback over all records could delete active jobs")
    }

    func testWritableIsolationFailsBeforeSpawnInsteadOfFallingBack() throws {
        let s = try source()
        let placement = try XCTUnwrap(s.range(of: "const placement = resolveSubagentWorktree({"))
        let failure = try XCTUnwrap(s.range(of: "if (placement.worktreeError) {", range: placement.lowerBound..<s.endIndex))
        let spawn = try XCTUnwrap(s.range(of: "const proc = spawn(invocation.command", range: placement.lowerBound..<s.endIndex))
        XCTAssertLessThan(failure.lowerBound, spawn.lowerBound, "isolation failure must settle before child spawn")
        XCTAssertTrue(s.contains("Writable subagent isolation failed before spawn:"))
        XCTAssertTrue(s.contains("worktreeError: placement.worktreeError"),
                      "the failed lifecycle must expose a clear isolation reason")
        XCTAssertTrue(s.contains("if (opts.explicitCwd) {"), "explicit cwd remains an intentional opt-out")
        XCTAssertTrue(s.contains(#"opts.readOnly || process.env.PIPIUI_WORKTREE === "0""#))
    }

    func testDoneDeliverySeparatesInflightConfirmationAndBoundedRetry() throws {
        let s = try source()
        XCTAssertTrue(s.contains("inFlight: boolean;"))
        XCTAssertTrue(s.contains("const DONE_MAX_ATTEMPTS = 5;"))
        XCTAssertTrue(s.contains("obligation.state === \"delivered\" || entry.inFlight || obligation.attempts >= DONE_MAX_ATTEMPTS"),
                      "in-flight and retry bounds belong to the exact completion obligation")
        XCTAssertTrue(s.contains("if (pendingDone.get(obligation.id) !== entry) return;"),
                      "a stale promise must not settle a different run/payload obligation")

        let durableSettle = try XCTUnwrap(
            s.range(of: "settled = doneDeliveryStore.finishAttempt(obligation.id, ok) ?? settled;")
        )
        let memoryRemoval = try XCTUnwrap(
            s.range(of: "pendingDone.delete(obligation.id);", range: durableSettle.upperBound..<s.endIndex)
        )
        XCTAssertLessThan(durableSettle.lowerBound, memoryRemoval.lowerBound,
                          "confirmed delivery must be persisted before its in-memory retry row is removed")

        XCTAssertTrue(s.contains("const obligation = createDoneObligation(agentId, runId, text);"))
        XCTAssertTrue(s.contains("runId: keepLive ?"),
                      "reusing one semantic agent id must create a distinct run identity")

        let bundled = try XCTUnwrap(PipiResourceBundle.shared.url(forResource: "PiExt", withExtension: nil))
        let obligationSource = try String(
            contentsOf: bundled.appendingPathComponent("subagent/delivery-obligation.ts"),
            encoding: .utf8
        )
        XCTAssertTrue(obligationSource.contains("const payloadHash = sha256(text);"))
        XCTAssertTrue(obligationSource.contains(#"sha256(`${this.routingKeyHash}\0${agentId}\0${runId}\0${payloadHash}`)"#),
                      "agent-id reuse cannot suppress a distinct run or payload")
    }

    func testCallerIdsRejectDuplicatesAndCrossRequestActiveCollisions() throws {
        let s = try source()
        try runNode(try pureRegion("AGENT_ID", in: s), assertions: #"""
        assert.match(selectCallerAgentIds(["same-id", "same-id"], new Set()).problem, /Duplicate agentId/);
        assert.match(selectCallerAgentIds(["live-id"], new Set(["live-id"])).problem, /already running/);
        assert.deepEqual(selectCallerAgentIds(["done-id"], new Set()), { ids: ["done-id"] });
        assert.deepEqual(selectCallerAgentIds(["first-id", undefined, "second-id"], new Set()).ids,
                         ["first-id", "second-id"]);
        const reservations = new Set();
        assert.deepEqual(selectAndReserveCallerAgentIds(["await-id"], reservations, reservations).ids,
                         ["await-id"]);
        assert.match(selectAndReserveCallerAgentIds(["await-id"], reservations, reservations).problem,
                     /already running/, "reservation must close the selector-to-await gap");
        """#)
        XCTAssertTrue(s.contains("const callerSelection = selectAndReserveCallerAgentIds("),
                      "the executable pure selector must gate real dispatch")
        XCTAssertTrue(s.contains("...runningAgents.keys()"))
        XCTAssertTrue(s.contains(#".filter((job) => job.state === "running")"#))
        XCTAssertTrue(s.contains("randomBytes(8).toString(\"hex\")"),
                      "generated ids need enough entropy for large waves")
        XCTAssertTrue(s.contains("localAgentReservations.has(candidate) ||"))
        XCTAssertTrue(s.contains("runningAgents.has(candidate) ||"))
        XCTAssertTrue(s.contains(#"jobRegistry.get(candidate)?.state === "running""#))
        XCTAssertTrue(s.contains("reserved.add(candidate);"))
    }

    func testGlobalAgentLeaseRejectsAnotherProcessAndRecoversAfterCrash() throws {
        let s = try source()
        try runNode(try pureRegion("AGENT_LEASE", in: s), assertions: #"""
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        if (process.argv[2] === "lease-child") {
          const root = process.argv[3];
          const acquired = acquireAgentLease(root, "shared-id");
          assert.ok(acquired.lease, acquired.problem);
          fs.writeFileSync(path.join(root, "child-ready"), "ready");
          setInterval(() => {}, 1000);
          await new Promise(() => {});
        } else {
          const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipiui-agent-lease-"));
          try {
            const child = spawn(process.execPath,
              ["--experimental-strip-types", process.argv[1], "lease-child", root],
              { stdio: "ignore" });
            for (let i = 0; i < 100 && !fs.existsSync(path.join(root, "child-ready")); i++) await sleep(20);
            assert.equal(fs.existsSync(path.join(root, "child-ready")), true, "child must hold the lease");
            assert.match(acquireAgentLease(root, "shared-id").problem, /already running/,
                         "another Pi process must not share the bare id");
            child.kill("SIGKILL");
            await new Promise((resolve) => child.once("exit", resolve));

            const recovered = acquireAgentLease(root, "shared-id");
            assert.ok(recovered.lease, recovered.problem);
            releaseAgentLease(recovered.lease);
            const resumed = acquireAgentLease(root, "shared-id");
            assert.ok(resumed.lease, "terminal resume must reacquire the same bare id");

            const oldLease = resumed.lease;
            releaseAgentLease(oldLease);
            const replacement = acquireAgentLease(root, "shared-id");
            assert.ok(replacement.lease);
            releaseAgentLease(oldLease);
            assert.equal(fs.existsSync(replacement.lease.filePath), true,
                         "an old token must not unlink a replacement lease");
            releaseAgentLease(replacement.lease);
          } finally {
            fs.rmSync(root, { recursive: true, force: true });
          }
        }
        """#)
        let reservation = try XCTUnwrap(s.range(of: "const callerSelection = selectAndReserveCallerAgentIds("))
        let dispatch = try XCTUnwrap(s.range(of: "recordSubagentDispatchStats(", range: reservation.lowerBound..<s.endIndex))
        XCTAssertLessThan(reservation.lowerBound, dispatch.lowerBound)
        XCTAssertTrue(s.contains("\t\t\t\tlocalAgentReservations,\n\t\t\t);"))
        XCTAssertTrue(s.contains("const leaseResult = acquireAgentLease("))
        XCTAssertTrue(s.contains("releaseAgentLease(agentLease);"))
        XCTAssertEqual(s.components(separatedBy: #"kind: "end""#).count - 1, 3,
                       "every terminal UI event must use the guarded terminal-report path")
        XCTAssertEqual(s.components(separatedBy: "postTerminalPipiuiReport({").count - 1, 3)
        XCTAssertFalse(s.contains("pipiuiReport({\n\t\tkind: \"end\""),
                       "no terminal report may remain fire-and-forget")
        let terminalDrain = try XCTUnwrap(s.range(of: "await awaitTerminalPipiuiReports(pipiuiAgentId);"))
        let leaseRelease = try XCTUnwrap(s.range(of: "releaseAgentLease(agentLease);",
                                                 range: terminalDrain.lowerBound..<s.endIndex))
        XCTAssertLessThan(terminalDrain.lowerBound, leaseRelease.lowerBound,
                          "the old run must finish terminal UI delivery before its ID lease is released")
    }

    func testSessionRetentionRunsAcrossMultipleWavesWithoutPerWorkerScans() throws {
        let s = try source()
        try runNode(try pureRegion("SESSION_RETENTION", in: s), assertions: #"""
        let state = { hasPruned: false, completionsSincePrune: 0, lastPrunedAt: 0 };
        let decision = nextSessionPruneSchedule(state, "access", 1000);
        assert.equal(decision.shouldPrune, true, "first access initializes retention");
        state = decision.state;
        for (let i = 1; i < SESSION_PRUNE_COMPLETION_INTERVAL; i++) {
          decision = nextSessionPruneSchedule(state, "completed", 1000 + i);
          assert.equal(decision.shouldPrune, false, "must not scan per completed worker");
          state = decision.state;
        }
        decision = nextSessionPruneSchedule(state, "completed", 2000);
        assert.equal(decision.shouldPrune, true, "bounded completion count triggers a scan");
        state = decision.state;
        decision = nextSessionPruneSchedule(state, "access", 2000 + SESSION_PRUNE_TIME_INTERVAL_MS);
        assert.equal(decision.shouldPrune, true, "elapsed time triggers a scan between waves");

        const running = new Set(["live-id"]);
        const entries = [{ name: "live.jsonl", agentId: "live-id", mtimeMs: 0 }];
        for (let i = 0; i < SESSION_MAX_KEEP + 2; i++) {
          entries.push({ name: `done-${i}.jsonl`, agentId: `done-${i}`, mtimeMs: i + 1 });
        }
        const stale = new Set(selectStaleSessions(entries, {
          now: SESSION_MAX_AGE_MS - 1,
          maxAgeMs: SESSION_MAX_AGE_MS,
          maxKeep: SESSION_MAX_KEEP,
          running,
        }));
        assert.equal(stale.has("live.jsonl"), false, "running sessions are never candidates");
        assert.equal(stale.size, 2, "terminal history converges to the configured cap");

        let waveState = nextSessionPruneSchedule(
          { hasPruned: false, completionsSincePrune: 0, lastPrunedAt: 0 }, "access", 1
        ).state;
        let retained = [];
        let serial = 0;
        const applyPrune = () => {
          const remove = new Set(selectStaleSessions(retained, {
            now: serial + 1,
            maxAgeMs: SESSION_MAX_AGE_MS,
            maxKeep: SESSION_MAX_KEEP,
            running: new Set(),
          }));
          retained = retained.filter((entry) => !remove.has(entry.name));
        };
        for (let wave = 0; wave < 2; wave++) {
          for (let i = 0; i < 600; i++) {
            serial++;
            retained.push({ name: `wave-${wave}-${i}.jsonl`, agentId: `wave-${wave}-${i}`, mtimeMs: serial });
            decision = nextSessionPruneSchedule(waveState, "completed", serial + 1);
            waveState = decision.state;
            if (decision.shouldPrune) applyPrune();
          }
        }
        assert.ok(retained.length <= SESSION_MAX_KEEP + SESSION_PRUNE_COMPLETION_INTERVAL - 1,
                  "overshoot is bounded between amortized scans");
        while (true) {
          serial++;
          retained.push({ name: `settle-${serial}.jsonl`, agentId: `settle-${serial}`, mtimeMs: serial });
          decision = nextSessionPruneSchedule(waveState, "completed", serial + 1);
          waveState = decision.state;
          if (decision.shouldPrune) { applyPrune(); break; }
        }
        assert.equal(retained.length, SESSION_MAX_KEEP, "the next bounded trigger converges after later waves");
        """#)
        try runNode(try pureRegion("ASYNC_BATCH", in: s), assertions: #"""
        let active = 0;
        let peak = 0;
        let yields = 0;
        const values = await mapSessionPruneBatches(
          Array.from({ length: 130 }, (_, i) => i),
          64,
          async (value) => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 1));
            active--;
            return value * 2;
          },
          async () => { yields++; },
        );
        assert.equal(peak, 64, "I/O concurrency must stay batch-bounded");
        assert.equal(yields, 3, "each batch yields the event loop");
        assert.deepEqual(values.slice(0, 3), [0, 2, 4]);
        assert.equal(values.at(-1), 258);
        """#)
        try runNode(try pureRegion("SESSION_REMOVE_GUARD", in: s), assertions: #"""
        const entry = { name: "old_pipiui-race-id.jsonl", agentId: "race-id", mtimeMs: 10 };
        let active = false;
        let released = 0;
        let removed = 0;
        const raced = await removeSessionWithLeaseGuard(
          entry,
          () => active,
          () => { active = true; return { token: "prune" }; },
          () => { released++; },
          async () => 10,
          async () => { removed++; },
        );
        assert.equal(raced, false, "activity starting after the scan must cancel deletion");
        assert.equal(released, 1, "a cancelled deletion must release its prune lease");
        assert.equal(removed, 0);

        active = false;
        const leasedElsewhere = await removeSessionWithLeaseGuard(
          entry, () => false, () => undefined, () => {}, async () => 10, async () => { removed++; }
        );
        assert.equal(leasedElsewhere, false, "another Pi process lease must block deletion");

        const changed = await removeSessionWithLeaseGuard(
          entry, () => false, () => ({ token: "prune" }), () => { released++; },
          async () => 11, async () => { removed++; }
        );
        assert.equal(changed, false, "a session modified after the scan must not be removed");

        const removedStable = await removeSessionWithLeaseGuard(
          entry, () => false, () => ({ token: "prune" }), () => { released++; },
          async () => 10, async () => { removed++; }
        );
        assert.equal(removedStable, true);
        assert.equal(removed, 1, "only an unchanged inactive session may be removed");
        """#)
        XCTAssertTrue(s.contains("pruneAgentSessions(sessionDir, \"completed\");"),
                      "later waves must advance the amortized schedule after session completion")
        XCTAssertTrue(s.contains("let sessionPruneFlight: Promise<void> | undefined;"))
        XCTAssertTrue(s.contains("const SESSION_PRUNE_IO_BATCH = 64;"))
        XCTAssertTrue(s.contains("await fs.promises.readdir(dir);"))
        XCTAssertTrue(s.contains("await removeSessionWithLeaseGuard("))
        XCTAssertTrue(s.contains("() => isAgentLocallyActiveForSessionPrune(entry.agentId)"))
        XCTAssertTrue(s.contains("() => acquireAgentLease(path.resolve(PIPIUI_MAIN_CWD), entry.agentId).lease"))
        let housekeepingStart = try XCTUnwrap(s.range(of: "async function readStoredSessions(dir: string)"))
        let housekeepingEnd = try XCTUnwrap(s.range(of: "function seedBossLedger()", range: housekeepingStart.lowerBound..<s.endIndex))
        let housekeeping = String(s[housekeepingStart.lowerBound..<housekeepingEnd.lowerBound])
        XCTAssertFalse(housekeeping.contains("readdirSync"), "housekeeping must not synchronously scan sessions")
        XCTAssertFalse(housekeeping.contains("statSync"), "housekeeping must not synchronously stat sessions")
    }

    func testBackgroundFanoutDiscardsCompletedFullResults() throws {
        let s = try source()
        XCTAssertTrue(s.contains("async function forEachWithConcurrencyLimit<TIn>("))
        XCTAssertTrue(s.contains("void forEachWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY"))
        XCTAssertTrue(s.contains("notifySubagentDone(pi, result);"))
        XCTAssertTrue(s.contains("const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY"),
                      "foreground mode still preserves ordered result aggregation")
    }

    func testAutomaticRetryBackoffUsesJitterWithoutChangingClassification() throws {
        let s = try source()
        XCTAssertTrue(s.contains("const AUTO_RESUME_JITTER_RATIO = 0.25;"))
        XCTAssertTrue(s.contains("function jitteredRetryBackoffMs(baseMs: number, random = Math.random)"))
        XCTAssertTrue(s.contains("const backoffMs = jitteredRetryBackoffMs(baseBackoffMs);"))
        XCTAssertTrue(s.contains(#""insufficient_quota""#))
        XCTAssertTrue(s.contains(#""invalid api key""#))
        XCTAssertTrue(s.contains(#""429""#))
    }
}
