import { describe, expect, it } from "vitest";
import { SessionMessageQueue } from "../src/message-queue.js";

function recordingHost() {
  const calls: { sessionId: string; payload: { text: string } }[] = [];
  const pending: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
  const dispatch = (sessionId: string, payload: { text: string }, _behavior: string) => {
    calls.push({ sessionId, payload: { text: payload.text } });
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  };
  return { dispatch: dispatch as any, calls, pending };
}

describe("queue epoch race (fix 2)", () => {
  it("stale notifyIdle with no newer turn does not leave turnActive stuck — forces clear and drains FIFO", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    queue.enqueue("s1", { text: "queued" });
    // No second markBusy (no newer turn). Call notifyIdle with a non-matching epoch (e.g., 999).
    // Old code returned early and left turnActive=true, so drain never happened.
    const idle = queue.notifyIdle("s1", 999);
    // Should have forced clear and drained the queued item (single-flight dispatch started)
    expect(host.calls.map(c => c.payload.text)).toEqual(["queued"]);
    host.pending[0].resolve(undefined);
    await idle;
    // After drain, queue should be empty (delivered) and not stuck busy via stale flag
    expect(queue.listQueue("s1")).toHaveLength(0);
    expect(queue.isBusy("s1")).toBe(true); // drain's successful send marks busy again
    const idle2 = queue.notifyIdle("s1");
    await idle2;
    expect(queue.isBusy("s1")).toBe(false);
  });

  it("stale notifyIdle when newer epoch has taken over is safely ignored (no drain)", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    const first = queue.markBusy("s1");
    queue.enqueue("s1", { text: "queued" });
    const second = queue.markBusy("s1");
    // Newer turn (second) has taken over, stale first should be ignored
    await queue.notifyIdle("s1", first);
    expect(host.calls).toHaveLength(0);
    expect(queue.listQueue("s1").map(i => i.text)).toEqual(["queued"]);
    expect(queue.isBusy("s1")).toBe(true);
    // Correct idle for second drains
    const idle = queue.notifyIdle("s1", second);
    expect(host.calls.map(c => c.payload.text)).toEqual(["queued"]);
    host.pending[0].resolve(undefined);
    await idle;
  });
});
