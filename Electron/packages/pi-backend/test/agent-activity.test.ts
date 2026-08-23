import { describe, expect, it } from "vitest";
import { isActivityOnlyAgentEvent, mergeAgentActivity } from "../src/agent-activity.js";

describe("mergeAgentActivity", () => {
  const now = 1_700_000_000_000;

  it("sets a live git-diff tool on start", () => {
    expect(mergeAgentActivity({
      activity: "bash git diff HEAD -- Electron/packages/pi-backend/src/index.ts",
      activityActive: true,
      activityToolCallId: "tc-diff",
      activityStartedAt: now,
    }, undefined, { sameRun: true, terminal: false, now })).toEqual({
      listSubtitle: "bash git diff HEAD -- Electron/packages/pi-backend/src/index.ts",
      activityActive: true,
      activityEndedAt: undefined,
      activityToolCallId: "tc-diff",
    });
  });

  it("clears the live tool on explicit tool_end", () => {
    const previous = {
      listSubtitle: "bash git diff HEAD -- Electron/packages/pi-backend/src/index.ts",
      activityActive: true,
    };
    expect(mergeAgentActivity({
      activity: null,
      activityActive: false,
      activityEndedAt: now + 20,
    }, previous, { sameRun: true, terminal: false, now: now + 20 })).toEqual({
      listSubtitle: undefined,
      activityActive: false,
      activityEndedAt: now + 20,
      activityToolCallId: undefined,
    });
  });

  it("does not restore a cleared tool from a later event that omits activity", () => {
    const cleared = {
      listSubtitle: undefined,
      activityActive: false,
      activityEndedAt: now + 20,
      activityToolCallId: undefined,
    };
    expect(mergeAgentActivity({ kind: "usage", turn: 4 }, cleared, {
      sameRun: true,
      terminal: false,
      now: now + 40,
    })).toEqual(cleared);
  });

  it("treats explicit empty activity as a clear, not as a missing field", () => {
    const previous = {
      listSubtitle: "bash git diff HEAD -- a.ts",
      activityActive: true,
    };
    expect(mergeAgentActivity({ activity: "" }, previous, {
      sameRun: true,
      terminal: false,
      now: now + 5,
    })).toEqual({
      listSubtitle: undefined,
      activityActive: false,
      activityEndedAt: now + 5,
      activityToolCallId: undefined,
    });
  });

  it("replaces the previous command on a new tool_start", () => {
    const previous = {
      listSubtitle: "bash git diff HEAD -- a.ts",
      activityActive: true,
    };
    expect(mergeAgentActivity({
      activity: "bash pwd",
      activityActive: true,
    }, previous, { sameRun: true, terminal: false, now: now + 8 })).toEqual({
      listSubtitle: "bash pwd",
      activityActive: true,
      activityEndedAt: undefined,
      activityToolCallId: undefined,
    });
  });

  it("clears on abort or worker exit", () => {
    const previous = {
      listSubtitle: "bash git diff HEAD -- a.ts",
      activityActive: true,
    };
    expect(mergeAgentActivity({ kind: "end", aborted: true }, previous, {
      sameRun: true,
      terminal: true,
      now: now + 9,
    })).toEqual({
      listSubtitle: undefined,
      activityActive: false,
      activityEndedAt: now + 9,
      activityToolCallId: undefined,
    });
  });

  it("keeps the remaining tool after an overlapping git-diff ends", () => {
    const afterDiff = mergeAgentActivity({
      activity: "bash git diff HEAD -- a.ts",
      activityActive: true,
      activityToolCallId: "tc-diff",
    }, undefined, { sameRun: true, terminal: false, now });
    const afterRead = mergeAgentActivity({
      activity: "read b.ts",
      activityActive: true,
      activityToolCallId: "tc-read",
    }, afterDiff, { sameRun: true, terminal: false, now: now + 1 });
    expect(afterRead).toEqual({
      listSubtitle: "read b.ts",
      activityActive: true,
      activityEndedAt: undefined,
      activityToolCallId: "tc-read",
    });
    const afterDiffEnds = mergeAgentActivity({
      activity: "read b.ts",
      activityActive: true,
      activityToolCallId: "tc-read",
    }, afterRead, { sameRun: true, terminal: false, now: now + 2 });
    expect(afterDiffEnds).toMatchObject({
      listSubtitle: "read b.ts",
      activityActive: true,
      activityToolCallId: "tc-read",
    });
    expect(mergeAgentActivity({
      activity: null,
      activityActive: false,
      activityToolCallId: "tc-read",
      activityEndedAt: now + 3,
    }, afterDiffEnds, { sameRun: true, terminal: false, now: now + 3 })).toEqual({
      listSubtitle: undefined,
      activityActive: false,
      activityEndedAt: now + 3,
      activityToolCallId: undefined,
    });
  });

  it("clears the previous toolCallId when a new live tool arrives without one", () => {
    const previous = {
      listSubtitle: "bash git diff HEAD -- a.ts",
      activityActive: true,
      activityToolCallId: "tc-diff",
    };
    expect(mergeAgentActivity({
      activity: "write /tmp/a.ts",
      activityActive: true,
    }, previous, { sameRun: true, terminal: false, now: now + 1 })).toEqual({
      listSubtitle: "write /tmp/a.ts",
      activityActive: true,
      activityEndedAt: undefined,
      activityToolCallId: undefined,
    });
  });

  it("does not treat stall lastLine or abort text as a live tool", () => {
    const previous = {
      listSubtitle: "bash git diff HEAD -- a.ts",
      activityActive: true,
      activityToolCallId: "tc-diff",
    };
    expect(mergeAgentActivity({
      kind: "stalled",
      stalled: true,
      activity: "bash git diff HEAD -- a.ts",
    }, previous, { sameRun: true, terminal: false, now: now + 4 })).toEqual({
      listSubtitle: undefined,
      activityActive: false,
      activityEndedAt: now + 4,
      activityToolCallId: undefined,
    });
    expect(mergeAgentActivity({
      kind: "stalled",
      stalled: true,
      activity: "auto-aborted after stall: bash git diff HEAD -- a.ts",
    }, previous, { sameRun: true, terminal: false, now: now + 5 })).toEqual({
      listSubtitle: undefined,
      activityActive: false,
      activityEndedAt: now + 5,
      activityToolCallId: undefined,
    });
  });
});

describe("isActivityOnlyAgentEvent", () => {
  it("treats diagnostics and activity kinds as non-progress", () => {
    expect(isActivityOnlyAgentEvent({ kind: "diagnostics" })).toBe(true);
    expect(isActivityOnlyAgentEvent({ kind: "activity", activityActive: false })).toBe(true);
  });

  it("treats an update with only activity fields as non-progress", () => {
    expect(isActivityOnlyAgentEvent({ kind: "update", activity: null, activityActive: false })).toBe(true);
  });

  it("treats an update that also carries output as progress", () => {
    expect(isActivityOnlyAgentEvent({ kind: "update", activity: "bash pwd", output: "partial" })).toBe(false);
  });
});
