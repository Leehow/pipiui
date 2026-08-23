import { describe, expect, it } from "vitest";
import { enrichHostDiagnostics, markPersistedRunningReconciliation, sanitizeAgentDiagnostics } from "../src/agent-diagnostics.js";

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
});
