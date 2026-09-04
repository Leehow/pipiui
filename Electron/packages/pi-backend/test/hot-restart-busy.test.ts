import { describe, expect, it } from "vitest";
import { hotRestartBusy } from "../src/extension-hotreload.js";

const idle = {
  turnActive: false,
  spawnInitializing: false,
  compactionHoldsQueue: false,
  liveBackgroundAgents: false,
};

describe("hot restart busy predicate", () => {
  it("an idle session with nothing running restarts now", () => {
    expect(hotRestartBusy(idle)).toBe(false);
  });

  it("keeps deferring for the reasons it always did", () => {
    expect(hotRestartBusy({ ...idle, turnActive: true })).toBe(true);
    expect(hotRestartBusy({ ...idle, spawnInitializing: true })).toBe(true);
    expect(hotRestartBusy({ ...idle, compactionHoldsQueue: true })).toBe(true);
  });

  it("an idle session whose background wave is still running is busy", () => {
    // The regression: workers are children of the session's Pi child, so an
    // extension write between turns stopped that child and killed a live wave
    // with no completion signal. closeQuietSessionWriter has always refused to
    // close a writer that still owns live agents; this path had no such guard.
    expect(hotRestartBusy({ ...idle, liveBackgroundAgents: true })).toBe(true);
  });
});
