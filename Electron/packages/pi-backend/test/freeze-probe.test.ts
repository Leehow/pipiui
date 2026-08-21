import { afterEach, describe, expect, it } from "vitest";
import {
  FREEZE_PROBE_PREFIX,
  freezeProbe,
  freezeProbeHistoryIpcEnd,
  freezeProbeHistoryIpcStart,
  freezeProbeHistoryScanEnd,
  freezeProbeHistoryScanStart,
  formatFreezeProbeLine,
  historyIpcInflightCount,
  historyScanInflightCount,
  historyScanPeakCount,
  installFreezeProbe,
  resetFreezeProbeForTests,
} from "../src/freeze-probe.js";

afterEach(() => {
  resetFreezeProbeForTests();
});

describe("freeze probe", () => {
  it("formats a greppable line without changing caller fields", () => {
    expect(formatFreezeProbeLine("history_scan_start", { session: "abc", inflight: 2 }, 1000))
      .toBe(`${FREEZE_PROBE_PREFIX} t=1000 kind=history_scan_start session=abc inflight=2`);
  });

  it("records overlapping JSONL scans without dropping any start", () => {
    const lines: string[] = [];
    installFreezeProbe("/unused", line => { lines.push(line); });
    freezeProbeHistoryScanStart({ session: "s1", size: 10 });
    freezeProbeHistoryScanStart({ session: "s1", size: 10 });
    expect(historyScanInflightCount()).toBe(2);
    expect(historyScanPeakCount()).toBe(2);
    freezeProbeHistoryScanEnd({ session: "s1", ms: 5 });
    freezeProbeHistoryScanEnd({ session: "s1", ms: 8 });
    expect(historyScanInflightCount()).toBe(0);
    expect(historyScanPeakCount()).toBe(2);
    expect(lines.filter(line => line.includes("kind=history_scan_start"))).toHaveLength(2);
  });

  it("tracks IPC inflight separately from file scans", () => {
    installFreezeProbe("/unused", () => undefined);
    freezeProbeHistoryIpcStart({ session: "s1", cache: "hit" });
    expect(historyIpcInflightCount()).toBe(1);
    expect(historyScanInflightCount()).toBe(0);
    freezeProbeHistoryIpcEnd({ session: "s1", cache: "hit" });
    expect(historyIpcInflightCount()).toBe(0);
  });

  it("returns the emitted line from freezeProbe", () => {
    const line = freezeProbe("persist_logs", { stringifyMs: 12, bytes: 99 });
    expect(line.startsWith(FREEZE_PROBE_PREFIX)).toBe(true);
    expect(line).toContain("kind=persist_logs");
    expect(line).toContain("stringifyMs=12");
  });
});
