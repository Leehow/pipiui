import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BatchObserver, type BatchNotice } from "../agent/batch-observer.js";
import type { BatchRecord, BatchTrialState } from "../agent/batch-contract.js";

const start = Date.parse("2026-01-01T00:00:00Z");
function record(sequence = 1, states: BatchTrialState[] = ["running", "queued"]): BatchRecord {
  return {
    version: 1, id: "speed-batch", experimentId: "speed-test", revision: 1, definitionFingerprint: "fixture", state: "running", sequence,
    createdAt: new Date(start).toISOString(), deadlineAt: new Date(start + 100000).toISOString(), owner: { generation: "owner-fixture", sessionId: "main-chat" }, mode: "comparison",
    budget: { repetitions: 1, concurrency: 2, maxTrials: 2, trialTimeoutMs: 50000, totalTimeoutMs: 100000 },
    variants: [], cases: [], metricDefinitions: [],
    trials: states.map((state, index) => ({ id: `trial-${index}`, variantId: "candidate", caseId: "sample", repetition: 1, state, quality: "unknown", sequence, createdAt: new Date(start).toISOString(), checks: [], metrics: [], logBytes: 0, logTruncated: false,
      ...(state === "waiting-input" ? { inputRequest: { id: `request-${index}`, method: "input" } } : {}),
    })),
  };
}
describe("BatchObserver", () => {
  let root: string;
  const observers: BatchObserver[] = [];
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "batch-observer-")); });
  afterEach(async () => { await Promise.all(observers.splice(0).map(o => o.shutdown())); await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); });
  function observer(notify: (notice: BatchNotice, signal: AbortSignal) => void | Promise<void>, extra: Partial<ConstructorParameters<typeof BatchObserver>[1]> = {}) {
    const value = new BatchObserver(root, { notify, throttleMs: 10000, now: () => start, ...extra }); observers.push(value); return value;
  }
  it("coalesces quick failures; ignores stale updates and ordinary output/heartbeats", async () => {
    const notices: BatchNotice[] = [];
    const o = observer(n => { notices.push(n); });
    o.observe(record()); await o.flush(); notices.length = 0;
    for (let seq = 2; seq < 100; seq++) {
      const r = record(seq); r.trials[0].logBytes = seq * 10; r.trials[0].lastOutputAt = new Date(start + seq).toISOString(); o.observe(r);
    }
    await o.flush(); expect(notices).toHaveLength(0);
    o.observe(record(100, ["failed", "running"]));
    o.observe(record(101, ["failed", "timed-out"]));
    expect(o.observe(record(100)).reason).toBe("stale");
    await o.flush(); expect(notices).toHaveLength(1);
    expect(notices[0].reasons).toEqual(["failure"]);
    expect(notices[0].progress).toEqual({ planned: 2, finished: 2, failed: 2, percent: 100 });
    expect((await o.status("speed-test", "speed-batch")).state?.latest.sequence).toBe(101);
  });
  it("urgently merges input requests with exact identifiers, without per-trial spam", async () => {
    let received: () => void = () => {};
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const notices: BatchNotice[] = [];
    const o = observer(n => { notices.push(n); received(); }, { inputDelayMs: 5 });
    o.observe(record()); await o.flush(); notices.length = 0;
    const r = record(2, ["waiting-input", "waiting-input"]);
    r.trials[0].inputRequest!.id = "opaque/exact-request";
    const arrival = new Promise<void>((resolve, reject) => {
      received = resolve;
      timeout = setTimeout(() => reject(new Error("input reminder delayed")), 1000);
    });
    o.observe(r);
    try { await arrival; } finally { clearTimeout(timeout); }
    await o.flush();
    expect(notices).toHaveLength(1);
    expect(notices[0].inputRequests).toEqual([{ trialId: "trial-0", inputRequestId: "opaque/exact-request" }, { trialId: "trial-1", inputRequestId: "request-1" }]);
    expect(notices[0].text).toContain("batch_respond");
    o.observe({ ...r, sequence: 3 }); await o.flush(); expect(notices).toHaveLength(1);
  });
  it("attempts terminal once; rejects late higher sequence activity and survives reopen without replay", async () => {
    const notify = vi.fn(); const o = observer(notify);
    const final = record(8, ["succeeded", "failed"]); final.state = "completed";
    o.observe(final); expect(o.observe(record(9)).reason).toBe("stale"); await o.flush();
    expect(notify).toHaveBeenCalledTimes(1);
    const notice = notify.mock.calls[0][0] as BatchNotice;
    expect(notice.reasons).toEqual(["terminal"]);
    expect(notice.text).toContain("实验 speed-test / 批次 speed-batch");
    expect(notice.text).toContain("实际终态 2/2，成功 1");
    expect(notice.text).toContain("batch_status"); expect(notice.informational).toBe(true);
    await o.shutdown();
    const reopened = observer(notify);
    expect((await reopened.status("speed-test", "speed-batch")).state?.notification).toBe("needs-check");
    reopened.observe(final); await reopened.flush(); reopened.observe(record(20)); await reopened.flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it("failed/busy notification leaves queryable state and never retries the same terminal", async () => {
    const notify = vi.fn(() => { throw new Error("main chat busy"); });
    const o = observer(notify); const final = record(4, ["failed"]); final.state = "completed";
    o.observe(final); await expect(o.flush()).resolves.toBeUndefined();
    expect((await o.status("speed-test", "speed-batch")).state?.notification).toBe("needs-check");
    await o.shutdown(); const reopened = observer(notify); reopened.observe(final); await reopened.flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it("bounds a stalled callback, aborts its signal and releases shutdown resources", async () => {
    let signal: AbortSignal | undefined;
    const o = observer((_n, s) => { signal = s; return new Promise(() => {}); }, { notifyTimeoutMs: 10 });
    o.observe(record()); await o.shutdown();
    expect(signal?.aborted).toBe(true);
    expect((await o.status("speed-test", "speed-batch")).state?.notification).toBe("needs-check");
    expect(o.observe(record(2))).toEqual({ accepted: false, reason: "closed" });
    expect((o as unknown as { timer?: unknown }).timer).toBeUndefined();
  });
  it("coalesces updates received while notify is busy, then drains on shutdown", async () => {
    let release!: () => void; let entered!: () => void;
    const started = new Promise<void>(r => { entered = r; });
    const notices: BatchNotice[] = [];
    const o = observer(n => { notices.push(n); if (notices.length === 1) { entered(); return new Promise<void>(r => { release = r; }); } });
    o.observe(record()); const flushing = o.flush(); await started;
    for (let seq = 2; seq < 100; seq++) o.observe(record(seq, ["failed", "running"]));
    release(); await flushing; await o.shutdown();
    expect(notices).toHaveLength(2); expect(notices[1].sequence).toBe(99);
    expect((o as unknown as { timer?: unknown }).timer).toBeUndefined();
  });
  it("reports storage errors without throwing or sending unjournaled notices", async () => {
    await mkdir(join(root, ".pi", "agent"), { recursive: true }); await writeFile(join(root, ".pi", "agent", "experiments"), "blocked");
    const notify = vi.fn(); const o = observer(notify);
    o.observe(record()); await expect(o.flush()).resolves.toBeUndefined();
    const state = await o.status("speed-test", "speed-batch");
    expect(state.error).toBe("storage-unavailable"); expect(state.state?.latest.sequence).toBe(1);
    expect(notify).not.toHaveBeenCalled();
  });
  it("treats corrupted persisted delivery state conservatively", async () => {
    const dir = join(root, ".pi", "agent", "experiments", "speed-test", "observers"); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "speed-batch.json"), "{broken");
    const notify = vi.fn(); const o = observer(notify); const final = record(5); final.state = "interrupted";
    o.observe(final); await o.flush(); expect(notify).not.toHaveBeenCalled();
    expect((await o.status("speed-test", "speed-batch")).state?.notification).toBe("needs-check");
  });
  it("uses declared wall deadline for a single budget warning, never calls silence a hang", async () => {
    const notices: BatchNotice[] = []; let now = start;
    const o = observer(n => { notices.push(n); }, { now: () => now });
    o.observe(record()); await o.flush(); notices.length = 0;
    now = start + 95000; o.observe(record(2)); await o.flush();
    o.observe(record(3)); await o.flush();
    expect(notices).toHaveLength(1); expect(notices[0].reasons).toEqual(["budget"]);
    expect(notices[0].progress.percent).toBe(0); expect(notices[0].text).not.toMatch(/卡死|ETA/);
  });
  it("bounds retained batches and refuses invalid input instead of truncating request identities", async () => {
    const o = observer(() => {}, { maxBatches: 1 });
    expect(o.observe(record()).accepted).toBe(true);
    expect(o.observe({ ...record(), id: "other-batch" }).reason).toBe("capacity");
    const invalid = record(2, ["waiting-input"]); invalid.trials[0].inputRequest!.id = "a".repeat(257);
    expect(o.observe(invalid).reason).toBe("invalid-record");
    expect(o.observe({ ...record(3), id: "../outside" }).reason).toBe("invalid-record");
    await o.shutdown();
  });
  it("announces verification at most once, and no timer survives an empty shutdown", async () => {
    const notify = vi.fn(); const o = observer(notify);
    o.observe(record()); await o.flush(); notify.mockClear();
    o.observe(record(2, ["verifying", "running"])); await o.flush();
    o.observe(record(3, ["succeeded", "running"])); await o.flush();
    o.observe(record(4, ["succeeded", "verifying"])); await o.flush();
    expect(notify).toHaveBeenCalledTimes(1);
    await o.shutdown(); expect((o as unknown as { timer?: unknown }).timer).toBeUndefined();
  });
});
