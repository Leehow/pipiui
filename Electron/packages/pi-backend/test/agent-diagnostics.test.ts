import { describe, expect, it } from "vitest";
import { applyTerminalHostReceipt, enrichHostDiagnostics, explicitNullDiagnosticKeys, markPersistedRunningReconciliation, sanitizeAgentDiagnostics } from "../src/agent-diagnostics.js";

describe("agent diagnostics host projection", () => {
  it("keeps runtime metadata and records receive/seq continuity", () => {
    const incoming = sanitizeAgentDiagnostics({
      agentId: "builder",
      runId: "r1",
      eventSeq: 4,
      processGeneration: "11:100",
      supervisorPid: 11,
      childPid: 99,
      toolWaitName: "bash",
      cpuVerdict: "working",
      watchdogDecision: "cpu-progress",
      prompt: "SECRET PROMPT",
      output: "SECRET STDOUT",
    });
    expect(incoming).toMatchObject({ eventSeq: 4, toolWaitName: "bash", cpuVerdict: "working" });
    expect(incoming).not.toHaveProperty("prompt");
    expect(incoming).not.toHaveProperty("output");

    const enriched = enrichHostDiagnostics(incoming, { eventSeq: 3, processGeneration: "11:100", hostGeneration: "host:1" }, {
      receivedAt: 50_000,
      generation: "host:1",
    });
    expect(enriched).toMatchObject({
      hostReceivedAt: 50_000,
      hostEventSeq: 4,
      lastHostEventSeq: 3,
      seqGap: 1,
      generationMatch: true,
    });
  });

  it("marks persisted running after a process generation change as reconciliation", () => {
    const marked = markPersistedRunningReconciliation({
      agentId: "builder",
      runId: "r1",
      name: "general-purpose",
      task: "pack",
      state: "interrupted",
      diagnostics: { eventSeq: 9, processGeneration: "old:1", watchdogDecision: "cpu-progress" },
    }, { receivedAt: 9, generation: "new:2" });
    expect(marked).toMatchObject({
      persistedRunning: true,
      generationMatch: false,
      reconciliation: "interrupted",
      hostGeneration: "new:2",
    });
  });

  it("clears persisted interrupted reconciliation after a trusted live probe", () => {
    const marked = markPersistedRunningReconciliation({
      agentId: "builder",
      runId: "r1",
      name: "general-purpose",
      task: "pack",
      state: "interrupted",
      diagnostics: { eventSeq: 9, processGeneration: "old:1", watchdogDecision: "cpu-progress" },
    }, { receivedAt: 9, generation: "new:2" });
    const live = sanitizeAgentDiagnostics({
      eventSeq: 10,
      processGeneration: "old:1",
      watchdogDecision: "cpu-progress",
      cpuVerdict: "working",
    });
    const enriched = enrichHostDiagnostics(live, marked, { receivedAt: 50, generation: "new:2" });
    expect(enriched?.reconciliation).toBeUndefined();
    expect(enriched?.persistedRunning).toBeUndefined();
    expect(enriched?.lastPhaseError).toBeUndefined();
    expect(enriched?.generationMatch).toBe(true);
    expect(enriched?.eventSeq).toBe(10);
  });

  it("does not refresh hostReceivedAt unless a real diagnostics snapshot arrived", () => {
    const previous = {
      eventSeq: 4,
      cpuVerdict: "working" as const,
      watchdogDecision: "cpu-progress",
      hostReceivedAt: 10_000,
      hostGeneration: "host:1",
    };
    const withoutIncoming = enrichHostDiagnostics(undefined, previous, {
      receivedAt: 80_000,
      generation: "host:1",
    });
    expect(withoutIncoming?.hostReceivedAt).toBe(10_000);
    expect(withoutIncoming?.cpuVerdict).toBe("working");

    const withIncoming = enrichHostDiagnostics({
      eventSeq: 5,
      cpuVerdict: "working",
      watchdogDecision: "cpu-progress",
    }, previous, { receivedAt: 80_000, generation: "host:1" });
    expect(withIncoming?.hostReceivedAt).toBe(80_000);
    expect(withIncoming?.eventSeq).toBe(5);
  });

  it("keeps missing finalization fields missing and treats explicit null as clear", () => {
    const legacy = sanitizeAgentDiagnostics({ eventSeq: 2, cpuVerdict: "working" });
    expect(legacy).not.toHaveProperty("finalizationPhase");
    expect(legacy).not.toHaveProperty("verifyPid");
    const previous = {
      finalizationPhase: "verifying" as const,
      phaseSince: 10,
      verifyPid: 88,
      eventSeq: 2,
    };
    const kept = enrichHostDiagnostics(legacy, previous, { receivedAt: 20, generation: "h" });
    expect(kept?.finalizationPhase).toBe("verifying");
    expect(kept?.verifyPid).toBe(88);
    expect(explicitNullDiagnosticKeys({ finalizationPhase: null, verifyPid: null })).toEqual([
      "verifyPid",
      "finalizationPhase",
    ]);
    const cleared = enrichHostDiagnostics(
      sanitizeAgentDiagnostics({ eventSeq: 3, finalizationPhase: null, verifyPid: null }),
      previous,
      { receivedAt: 30, generation: "h" },
      explicitNullDiagnosticKeys({ eventSeq: 3, finalizationPhase: null, verifyPid: null }),
    );
    expect(cleared?.finalizationPhase).toBeUndefined();
    expect(cleared?.verifyPid).toBeUndefined();
    expect(cleared?.eventSeq).toBe(3);
  });

  it("marks vanished persisted-running as process-missing reconciliation", () => {
    const marked = markPersistedRunningReconciliation({
      agentId: "builder",
      runId: "r1",
      name: "general-purpose",
      task: "pack",
      state: "running",
      diagnostics: { finalizationPhase: "verifying", phaseSince: 1 },
    }, { receivedAt: 9, generation: "new:2" });
    expect(marked.lastPhaseError).toBe("process-missing");
    expect(marked.reconciliation).toBe("interrupted");
    expect(marked.finalizationPhase).toBe("verifying");
  });

  it("does not let a late older phase overwrite a newer phase", () => {
    const previous = {
      eventSeq: 8,
      processGeneration: "11:100",
      finalizationPhase: "cleaning" as const,
      phaseSince: 40,
      mergeElapsedMs: 12,
    };
    const lateOldPhase = enrichHostDiagnostics({
      eventSeq: 9,
      processGeneration: "11:100",
      finalizationPhase: "merging",
      phaseSince: 20,
    }, previous, { receivedAt: 80, generation: "h" });
    expect(lateOldPhase).toEqual(previous);
    expect(lateOldPhase?.finalizationPhase).toBe("cleaning");
    expect(lateOldPhase?.phaseSince).toBe(40);
    expect(lateOldPhase?.eventSeq).toBe(8);

    const laterPostVerify = enrichHostDiagnostics({
      eventSeq: 10,
      processGeneration: "11:100",
      finalizationPhase: "post-verify",
      phaseSince: 55,
    }, lateOldPhase, { receivedAt: 85, generation: "h" });
    expect(laterPostVerify?.finalizationPhase).toBe("post-verify");
    expect(laterPostVerify?.phaseSince).toBe(55);

    const lateOldSeq = enrichHostDiagnostics({
      eventSeq: 4,
      processGeneration: "11:100",
      finalizationPhase: "merging",
      phaseSince: 10,
      mergeElapsedMs: 1,
    }, previous, { receivedAt: 90, generation: "h" });
    expect(lateOldSeq?.finalizationPhase).toBe("cleaning");
    expect(lateOldSeq?.phaseSince).toBe(40);
    expect(lateOldSeq?.eventSeq).toBe(8);
    expect(lateOldSeq?.mergeElapsedMs).toBe(12);

    const otherGenReplay = enrichHostDiagnostics({
      eventSeq: 1,
      processGeneration: "99:1",
      finalizationPhase: "merging",
      phaseSince: 5,
    }, previous, { receivedAt: 100, generation: "h" });
    expect(otherGenReplay?.finalizationPhase).toBe("cleaning");
    expect(otherGenReplay?.phaseSince).toBe(40);

    const legacyMissing = enrichHostDiagnostics({
      eventSeq: 10,
      processGeneration: "11:100",
      cpuVerdict: "working",
    }, previous, { receivedAt: 110, generation: "h" });
    expect(legacyMissing?.finalizationPhase).toBe("cleaning");
    expect(legacyMissing?.phaseSince).toBe(40);
    expect(legacyMissing?.eventSeq).toBe(10);
  });

  it("rejects every event from an older process generation even with a higher seq",
    () => {
      const previous = {
        eventSeq: 5,
        processGeneration: "11:200",
        finalizationPhase: "cleaning" as const,
        phaseSince: 40,
        mergeElapsedMs: 12,
        cpuVerdict: "working" as const,
        hostReceivedAt: 70,
        persistedRunning: true,
        reconciliation: "interrupted" as const,
        lastPhaseError: "process-missing",
      };
      const rejected = enrichHostDiagnostics({
        eventSeq: 99,
        processGeneration: "11:100",
        finalizationPhase: "generating",
        phaseSince: 90,
        cpuVerdict: "gone",
        lastOutputAt: 88,
        watchdogDecision: "process-exited",
        exitReason: "child-close:0",
        hostReceivedAt: 500,
        persistedRunning: false,
        reconciliation: "none",
        lastPhaseError: null as unknown as string,
      }, previous, { receivedAt: 500, generation: "h" });
      expect(rejected).toEqual(previous);
    });

  it("lets a trusted newer generation restart from a low-rank live phase",
    () => {
      const previous = {
        eventSeq: 20,
        processGeneration: "11:100",
        finalizationPhase: "cleaning" as const,
        phaseSince: 40,
        mergeElapsedMs: 12,
        verifyPid: 88,
        lastPhaseError: "process-missing",
        persistedRunning: true,
        reconciliation: "interrupted" as const,
        hostReceivedAt: 70,
        hostGeneration: "h",
      };
      const restarted = enrichHostDiagnostics({
        eventSeq: 1,
        processGeneration: "11:500",
        finalizationPhase: "generating",
        phaseSince: 5,
        cpuVerdict: "working",
        watchdogDecision: "cpu-progress",
      }, previous, { receivedAt: 80, generation: "h" });
      expect(restarted).toMatchObject({
        eventSeq: 1,
        processGeneration: "11:500",
        finalizationPhase: "generating",
        phaseSince: 5,
        cpuVerdict: "working",
        hostReceivedAt: 80,
        generationMatch: true,
      });
      expect(restarted?.mergeElapsedMs).toBeUndefined();
      expect(restarted?.verifyPid).toBeUndefined();
      expect(restarted?.lastPhaseError).toBeUndefined();
      expect(restarted?.persistedRunning).toBeUndefined();
      expect(restarted?.reconciliation).toBeUndefined();

      const toolActive = enrichHostDiagnostics({
        eventSeq: 2,
        processGeneration: "11:500",
        finalizationPhase: "tool-active",
        phaseSince: 9,
      }, restarted, { receivedAt: 85, generation: "h" });
      expect(toolActive?.finalizationPhase).toBe("tool-active");
      expect(toolActive?.eventSeq).toBe(2);
    });

  it("accepts same-generation high seq and rejects a later low-seq replay wholesale",
    () => {
      const previous = {
        eventSeq: 8,
        processGeneration: "11:100",
        finalizationPhase: "cleaning" as const,
        phaseSince: 40,
        mergeElapsedMs: 12,
        cpuVerdict: "working" as const,
        hostReceivedAt: 70,
      };
      const highSeq = enrichHostDiagnostics({
        eventSeq: 10,
        processGeneration: "11:100",
        finalizationPhase: "post-verify",
        phaseSince: 60,
        cpuVerdict: "no-progress",
      }, previous, { receivedAt: 90, generation: "h" });
      expect(highSeq).toMatchObject({
        eventSeq: 10,
        finalizationPhase: "post-verify",
        phaseSince: 60,
        cpuVerdict: "no-progress",
        mergeElapsedMs: 12,
        hostReceivedAt: 90,
      });
      const lowSeqReplay = enrichHostDiagnostics({
        eventSeq: 9,
        processGeneration: "11:100",
        finalizationPhase: "merging",
        phaseSince: 20,
        cpuVerdict: "gone",
        lastOutputAt: 1,
      }, highSeq, { receivedAt: 120, generation: "h" });
      expect(lowSeqReplay).toEqual(highSeq);
    });

  it("does not let a stale packet change cpu/output/receipt or clear vanished marks",
    () => {
      const previous = {
        eventSeq: 8,
        processGeneration: "11:100",
        finalizationPhase: "verifying" as const,
        phaseSince: 40,
        cpuVerdict: "working" as const,
        lastOutputAt: 30,
        watchdogDecision: "cpu-progress",
        exitReason: undefined,
        hostReceivedAt: 70,
        persistedRunning: true,
        reconciliation: "interrupted" as const,
        lastPhaseError: "process-missing",
        generationMatch: false,
      };
      const stale = enrichHostDiagnostics({
        eventSeq: 3,
        processGeneration: "11:100",
        finalizationPhase: "merging",
        phaseSince: 10,
        cpuVerdict: "gone",
        lastOutputAt: 99,
        lastStdoutAt: 99,
        watchdogDecision: "process-exited",
        exitReason: "child-close:1",
        hostReceivedAt: 500,
        persistedRunning: false,
        reconciliation: "none",
        lastPhaseError: undefined,
      }, previous, { receivedAt: 500, generation: "h-new" });
      expect(stale).toEqual(previous);
      expect(stale?.hostReceivedAt).toBe(70);
      expect(stale?.persistedRunning).toBe(true);
      expect(stale?.reconciliation).toBe("interrupted");
      expect(stale?.lastPhaseError).toBe("process-missing");
      expect(stale?.cpuVerdict).toBe("working");
      expect(stale?.lastOutputAt).toBe(30);
    });

  it("clears vanished marks only on an accepted same-generation live event",
    () => {
      const vanished = {
        eventSeq: 8,
        processGeneration: "11:100",
        finalizationPhase: "verifying" as const,
        phaseSince: 40,
        persistedRunning: true,
        reconciliation: "interrupted" as const,
        lastPhaseError: "process-missing",
        hostReceivedAt: 70,
        hostGeneration: "h",
      };
      const staleClear = enrichHostDiagnostics({
        eventSeq: 4,
        processGeneration: "11:100",
        finalizationPhase: "generating",
        persistedRunning: false,
        reconciliation: "none",
      }, vanished, { receivedAt: 80, generation: "h" }, ["persistedRunning", "reconciliation", "lastPhaseError"]);
      expect(staleClear?.persistedRunning).toBe(true);
      expect(staleClear?.reconciliation).toBe("interrupted");
      expect(staleClear?.lastPhaseError).toBe("process-missing");

      const live = enrichHostDiagnostics({
        eventSeq: 9,
        processGeneration: "11:100",
        finalizationPhase: "verifying",
        phaseSince: 40,
        cpuVerdict: "working",
        watchdogDecision: "cpu-progress",
      }, vanished, { receivedAt: 90, generation: "h" });
      expect(live?.persistedRunning).toBeUndefined();
      expect(live?.reconciliation).toBeUndefined();
      expect(live?.lastPhaseError).toBeUndefined();
      expect(live?.eventSeq).toBe(9);
      expect(live?.finalizationPhase).toBe("verifying");
      expect(live?.generationMatch).toBe(true);
    });

  it("keeps a real non-vanished lastPhaseError on an accepted live event",
    () => {
      const previous = {
        eventSeq: 8,
        processGeneration: "11:100",
        finalizationPhase: "verifying" as const,
        phaseSince: 40,
        lastPhaseError: "verify-failed",
        hostReceivedAt: 70,
        hostGeneration: "h",
      };
      const live = enrichHostDiagnostics({
        eventSeq: 9,
        processGeneration: "11:100",
        finalizationPhase: "verifying",
        phaseSince: 40,
        cpuVerdict: "working",
      }, previous, { receivedAt: 90, generation: "h" });
      expect(live?.lastPhaseError).toBe("verify-failed");
      expect(live?.eventSeq).toBe(9);
    });

  it("rejects a same-generation high-seq lower-phase rewind wholesale",
    () => {
      const previous = {
        eventSeq: 8,
        processGeneration: "11:100",
        finalizationPhase: "cleaning" as const,
        phaseSince: 40,
        mergeElapsedMs: 12,
        cpuVerdict: "working" as const,
        lastOutputAt: 30,
        watchdogDecision: "cpu-progress",
        hostReceivedAt: 70,
        persistedRunning: true,
        reconciliation: "interrupted" as const,
        lastPhaseError: "process-missing",
      };
      const rewind = enrichHostDiagnostics({
        eventSeq: 11,
        processGeneration: "11:100",
        finalizationPhase: "merging",
        phaseSince: 20,
        cpuVerdict: "gone",
        lastOutputAt: 99,
        lastStdoutAt: 99,
        watchdogDecision: "process-exited",
        exitReason: "child-close:1",
        hostReceivedAt: 500,
        persistedRunning: false,
        reconciliation: "none",
        lastPhaseError: undefined,
      }, previous, { receivedAt: 500, generation: "h" });
      expect(rewind).toEqual(previous);
      expect(rewind?.hostReceivedAt).toBe(70);
      expect(rewind?.cpuVerdict).toBe("working");
      expect(rewind?.lastOutputAt).toBe(30);
      expect(rewind?.exitReason).toBeUndefined();
      expect(rewind?.persistedRunning).toBe(true);
      expect(rewind?.reconciliation).toBe("interrupted");
      expect(rewind?.lastPhaseError).toBe("process-missing");
    });

  it("orders processGeneration by numeric startedAt, not string compare",
    () => {
      const newer = {
        eventSeq: 5,
        processGeneration: "11:100",
        finalizationPhase: "cleaning" as const,
        phaseSince: 40,
        mergeElapsedMs: 12,
        cpuVerdict: "working" as const,
        hostReceivedAt: 70,
      };
      // Lexicographic "11:100" < "11:99" because '0' < '9' after the shared "11:1".
      const olderSuffix = enrichHostDiagnostics({
        eventSeq: 99,
        processGeneration: "11:99",
        finalizationPhase: "generating",
        phaseSince: 90,
        cpuVerdict: "gone",
        lastOutputAt: 88,
        hostReceivedAt: 500,
      }, newer, { receivedAt: 500, generation: "h" });
      expect(olderSuffix).toEqual(newer);

      const restarted = enrichHostDiagnostics({
        eventSeq: 1,
        processGeneration: "11:100",
        finalizationPhase: "generating",
        phaseSince: 5,
        cpuVerdict: "working",
      }, {
        eventSeq: 8,
        processGeneration: "11:99",
        finalizationPhase: "cleaning" as const,
        phaseSince: 40,
        mergeElapsedMs: 12,
        lastPhaseError: "process-missing",
        persistedRunning: true,
        reconciliation: "interrupted" as const,
        hostReceivedAt: 70,
        hostGeneration: "h",
      }, { receivedAt: 80, generation: "h" });
      expect(restarted).toMatchObject({
        eventSeq: 1,
        processGeneration: "11:100",
        finalizationPhase: "generating",
        phaseSince: 5,
        cpuVerdict: "working",
        hostReceivedAt: 80,
      });
      expect(restarted?.mergeElapsedMs).toBeUndefined();
      expect(restarted?.lastPhaseError).toBeUndefined();

      // Different identity: full-string order would rank "99:1" after "11:100".
      const otherIdentity = enrichHostDiagnostics({
        eventSeq: 1,
        processGeneration: "99:1",
        finalizationPhase: "generating",
        phaseSince: 5,
        cpuVerdict: "working",
      }, newer, { receivedAt: 90, generation: "h" });
      expect(otherIdentity).toEqual(newer);
    });

  it("terminal receipt uses the host clock and keeps elapsed", () => {
    const receipt = applyTerminalHostReceipt({
      finalizationPhase: "done-await-host",
      verifyElapsedMs: 1200,
      eventSeq: 8,
      hostReceivedAt: 1,
    }, { receivedAt: 99_000, generation: "host:9" });
    expect(receipt.hostReceivedAt).toBe(99_000);
    expect(receipt.doneEventSeq).toBe(8);
    expect(receipt.verifyElapsedMs).toBe(1200);
    expect(receipt.finalizationPhase).toBe("done-await-host");
  });
});
