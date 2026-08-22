import { describe, expect, it } from "vitest";
import { SessionMessageQueue, type DispatchBehavior, type DispatchHandler, type QueuedAttachment } from "../src/message-queue.js";

type RecordedCall = { sessionId: string; payload: { text: string; attachments: QueuedAttachment[] }; behavior: DispatchBehavior };

/** Dispatch recorder with manual per-call resolve/reject control (no auto-settle). */
function recordingHost() {
  const calls: RecordedCall[] = [];
  const pending: { resolve: (value: unknown) => void; reject: (reason: unknown) => void }[] = [];
  const dispatch: DispatchHandler = (sessionId, payload, behavior) => {
    calls.push({ sessionId, payload, behavior });
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  };
  return { dispatch, calls, pending };
}

/** Lets pending microtasks (dispatch ack / failure propagation) run to completion. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("SessionMessageQueue", () => {
  it("drains queued items in FIFO order across idle events", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    queue.enqueue("s1", { text: "A" });
    queue.enqueue("s1", { text: "B" });
    queue.enqueue("s1", { text: "C" });
    expect(host.calls).toHaveLength(0);

    const idle1 = queue.notifyIdle("s1");
    expect(host.calls.map((c) => c.payload.text)).toEqual(["A"]);
    host.pending[0].resolve(undefined);
    await idle1;

    const idle2 = queue.notifyIdle("s1");
    expect(host.calls.map((c) => c.payload.text)).toEqual(["A", "B"]);
    host.pending[1].resolve(undefined);
    await idle2;

    const idle3 = queue.notifyIdle("s1");
    expect(host.calls.map((c) => c.payload.text)).toEqual(["A", "B", "C"]);
    host.pending[2].resolve(undefined);
    await idle3;

    await queue.notifyIdle("s1");
    expect(host.calls).toHaveLength(3);
  });

  it("enqueues while busy without an already-processing error, returning queued id/state", () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch, now: () => 1000 });
    queue.markBusy("s1");
    const result = queue.enqueue("s1", { text: "later" });
    expect(result.outcome).toBe("queued");
    expect(result.message).toMatchObject({ sessionId: "s1", text: "later", state: "queued", createdAt: 1000 });
    expect(typeof result.message.id).toBe("string");
    expect(result.message.id).not.toBe("");
    expect(queue.listQueue("s1")).toHaveLength(1);
    expect(host.calls).toHaveLength(0);
  });

  it("dispatches immediately when the session is idle", () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    const result = queue.enqueue("s1", { text: "now" });
    expect(result.outcome).toBe("dispatched");
    expect(host.calls).toHaveLength(1);
    expect(host.calls[0]).toMatchObject({ sessionId: "s1", behavior: "prompt", payload: { text: "now", attachments: [] } });
    expect(queue.listQueue("s1")[0]).toMatchObject({ text: "now", state: "sending" });
  });

  it("keeps a single in-flight dispatch per session", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    queue.enqueue("s1", { text: "A" });
    queue.enqueue("s1", { text: "B" });
    queue.enqueue("s1", { text: "C" });

    const idle = queue.notifyIdle("s1");
    expect(host.calls).toHaveLength(1); // A
    await queue.notifyIdle("s1"); // duplicate/early idle while A is in flight: still no second dispatch
    expect(host.calls).toHaveLength(1);
    host.pending[0].resolve(undefined);
    await idle;
    await flush();
    expect(host.calls).toHaveLength(1); // no auto-drain after the ack: the next item needs an idle event

    const settled = queue.notifyIdle("s1"); // A's turn settled
    expect(host.calls.map((c) => c.payload.text)).toEqual(["A", "B"]);
    host.pending[1].resolve(undefined);
    await settled;
    await flush();

    const settled2 = queue.notifyIdle("s1");
    expect(host.calls.map((c) => c.payload.text)).toEqual(["A", "B", "C"]);
    host.pending[2].resolve(undefined);
    await settled2;
  });

  it("ignores duplicate idle events without double-dispatching", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    queue.enqueue("s1", { text: "A" });
    queue.enqueue("s1", { text: "B" });

    const idle1 = queue.notifyIdle("s1");
    const idle2 = queue.notifyIdle("s1"); // replay of the same settle event
    expect(host.calls).toHaveLength(1); // single dispatch despite two idle events
    host.pending[0].resolve(undefined);
    await idle1;
    await idle2;
    expect(host.calls).toHaveLength(1); // ack alone never triggers the next item

    const settled = queue.notifyIdle("s1"); // the real settle for A's turn
    expect(host.calls.map((c) => c.payload.text)).toEqual(["A", "B"]);
    host.pending[1].resolve(undefined);
    await settled;
    await flush();
    expect(host.calls).toHaveLength(2);
  });

  it("never delivers a completed item twice", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    const a = queue.enqueue("s1", { text: "A" }).message;
    queue.enqueue("s1", { text: "B" });

    const idle = queue.notifyIdle("s1");
    host.pending[0].resolve(undefined);
    await idle;
    const settled = queue.notifyIdle("s1");
    expect(host.calls.map((c) => c.payload.text)).toEqual(["A", "B"]);
    host.pending[1].resolve(undefined);
    await settled;
    await flush();
    expect(queue.listQueue("s1").map((i) => i.text)).toEqual([]); // A and B both delivered and removed

    await queue.notifyIdle("s1");
    await queue.notifyIdle("s1");
    expect(host.calls).toHaveLength(2);
    expect(a.id).not.toBe("");
  });

  it("retains a failed item with its error and keeps the FIFO moving", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    queue.enqueue("s1", { text: "A" });
    queue.enqueue("s1", { text: "B" });

    const idle = queue.notifyIdle("s1");
    expect(host.calls.map((c) => c.payload.text)).toEqual(["A"]);
    host.pending[0].reject(new Error("rpc boom"));
    await flush(); // A fails → drain auto-continues to B
    expect(host.calls.map((c) => c.payload.text)).toEqual(["A", "B"]);
    host.pending[1].resolve(undefined);
    await idle;

    const list = queue.listQueue("s1");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ text: "A", state: "failed", error: "rpc boom" });
  });

  it("retry restores a failed item to the head and clears its error", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    const a = queue.enqueue("s1", { text: "A" }).message;
    queue.enqueue("s1", { text: "B" });

    const idle = queue.notifyIdle("s1");
    host.pending[0].reject(new Error("boom"));
    await flush();
    host.pending[1].resolve(undefined);
    await idle;
    expect(queue.listQueue("s1")[0]).toMatchObject({ text: "A", state: "failed" });

    const retried = queue.retryMessage("s1", a.id);
    expect(retried).toMatchObject({ state: "queued", error: undefined, text: "A" });
    expect(queue.listQueue("s1")[0].id).toBe(a.id); // requeued at the head
    expect(host.calls).toHaveLength(2);

    const settled = queue.notifyIdle("s1");
    expect(host.calls.map((c) => c.payload.text)).toEqual(["A", "B", "A"]);
    host.pending[2].resolve(undefined);
    await settled;
  });

  it("updates the text and attachments of a queued item", () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    const original = queue.enqueue("s1", { text: "original", attachments: [{ dataBase64: "aGVsbG8=", mimeType: "image/png", name: "a.png" }] }).message;
    const updated = queue.updateMessage("s1", original.id, { text: "edited", attachments: [{ dataBase64: "d29ybGQ=", mimeType: "image/jpeg" }] });
    expect(updated).toMatchObject({ text: "edited", state: "queued" });
    expect(updated.attachments).toEqual([{ dataBase64: "d29ybGQ=", mimeType: "image/jpeg" }]);
    expect(queue.listQueue("s1")[0].text).toBe("edited");
  });

  it("keeps a failed item failed after an edit until it is retried", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    const a = queue.enqueue("s1", { text: "A" }).message;
    const idle = queue.notifyIdle("s1");
    host.pending[0].reject(new Error("boom"));
    await idle;
    const edited = queue.updateMessage("s1", a.id, { text: "A fixed" });
    expect(edited).toMatchObject({ text: "A fixed", state: "failed", error: "boom" });
  });

  it("rejects update/remove/promote/retry/steer on an item being sent", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    const a = queue.enqueue("s1", { text: "A" }).message; // idle → dispatched → sending
    expect(queue.listQueue("s1")[0].state).toBe("sending");
    expect(() => queue.updateMessage("s1", a.id, { text: "x" })).toThrow(/already sending/);
    expect(() => queue.removeMessage("s1", a.id)).toThrow(/already sending/);
    expect(() => queue.promoteMessage("s1", a.id)).toThrow(/already sending/);
    expect(() => queue.retryMessage("s1", a.id)).toThrow(/only failed/);
    await expect(queue.steerMessage("s1", a.id)).rejects.toThrow(/already sending/);
    host.pending[0].resolve(undefined);
  });

  it("removes a queued item", () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    const a = queue.enqueue("s1", { text: "A" }).message;
    const b = queue.enqueue("s1", { text: "B" }).message;
    const removed = queue.removeMessage("s1", a.id);
    expect(removed).toMatchObject({ text: "A", state: "queued" });
    expect(queue.listQueue("s1").map((i) => i.text)).toEqual(["B"]);
    expect(() => queue.removeMessage("s1", a.id)).toThrow(/unknown queued message/);
    expect(queue.removeMessage("s1", b.id).text).toBe("B");
    expect(queue.listQueue("s1")).toHaveLength(0);
  });

  it("promote moves an item to the head of the FIFO", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    queue.enqueue("s1", { text: "A" });
    const b = queue.enqueue("s1", { text: "B" }).message;
    queue.enqueue("s1", { text: "C" });
    queue.promoteMessage("s1", b.id);

    const idle = queue.notifyIdle("s1");
    expect(host.calls.map((c) => c.payload.text)).toEqual(["B"]);
    host.pending[0].resolve(undefined);
    await idle;
    const idle2 = queue.notifyIdle("s1");
    expect(host.calls.map((c) => c.payload.text)).toEqual(["B", "A"]);
    host.pending[1].resolve(undefined);
    await idle2;
    const idle3 = queue.notifyIdle("s1");
    expect(host.calls.map((c) => c.payload.text)).toEqual(["B", "A", "C"]);
    host.pending[2].resolve(undefined);
    await idle3;
  });

  it("steer injects an item into a running turn and removes it on success", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    queue.enqueue("s1", { text: "A" });
    const b = queue.enqueue("s1", { text: "B" }).message;
    const steer = queue.steerMessage("s1", b.id);
    expect(host.calls).toHaveLength(1);
    expect(host.calls[0]).toMatchObject({ sessionId: "s1", behavior: "steer", payload: { text: "B" } });
    host.pending[0].resolve(undefined);
    const delivered = await steer;
    expect(delivered.text).toBe("B");
    expect(queue.listQueue("s1").map((i) => i.text)).toEqual(["A"]); // B injected into the running turn
    expect(queue.isBusy("s1")).toBe(true); // the running turn is still active
  });

  it("keeps a steered item failed when the injection fails", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    const a = queue.enqueue("s1", { text: "A" }).message;
    const steer = queue.steerMessage("s1", a.id);
    host.pending[0].reject(new Error("steer down"));
    const failed = await steer;
    expect(failed).toMatchObject({ state: "failed", error: "steer down" });
    expect(queue.listQueue("s1")[0]).toMatchObject({ text: "A", state: "failed", error: "steer down" });
  });

  it("steer while idle delivers like a normal prompt", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    const a = queue.enqueue("s1", { text: "A" }).message;
    queue.enqueue("s1", { text: "B" });

    const idle = queue.notifyIdle("s1");
    host.pending[0].reject(new Error("boom"));
    await flush();
    host.pending[1].resolve(undefined);
    await idle;
    await queue.notifyIdle("s1"); // B's turn settled → session idle with only the failed A left
    expect(queue.isBusy("s1")).toBe(false);
    expect(queue.listQueue("s1")[0]).toMatchObject({ text: "A", state: "failed" });

    const steer = queue.steerMessage("s1", a.id);
    expect(host.calls).toHaveLength(3);
    expect(host.calls[2]).toMatchObject({ behavior: "prompt", payload: { text: "A" } });
    host.pending[2].resolve(undefined);
    await steer;
    expect(queue.listQueue("s1")).toHaveLength(0);
  });

  it("prevents concurrent steer deliveries (single-flight)", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    queue.enqueue("s1", { text: "A" });
    const b = queue.enqueue("s1", { text: "B" }).message;
    const c = queue.enqueue("s1", { text: "C" }).message;
    const steer = queue.steerMessage("s1", b.id);
    expect(host.calls).toHaveLength(1);
    await expect(queue.steerMessage("s1", c.id)).rejects.toThrow(/already delivering/);
    host.pending[0].resolve(undefined);
    await steer;
  });

  it("preserves the full attachment payload and snapshots it immutably", () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    const attachments = [{ dataBase64: "aGVsbG8=", mimeType: "image/png", name: "shot.png", width: 1200 }];
    queue.enqueue("s1", { text: "look", attachments });

    // mutating the caller's input after enqueue must not leak into the queue
    attachments[0].dataBase64 = "MUTATED";
    attachments[0].name = "changed.png";
    const stored = queue.listQueue("s1")[0];
    expect(stored.attachments).toEqual([{ dataBase64: "aGVsbG8=", mimeType: "image/png", name: "shot.png", width: 1200 }]);

    // mutating a returned snapshot must not leak either
    stored.text = "MUTATED";
    stored.attachments[0].mimeType = "image/gif";
    expect(queue.listQueue("s1")[0].text).toBe("look");
    expect(queue.listQueue("s1")[0].attachments[0].mimeType).toBe("image/png");
    expect(queue.listQueue("s1")[0].attachments[0].width).toBe(1200); // extra fields survive the round trip
  });

  it("delivers queued attachments with the message payload", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    queue.enqueue("s1", { text: "look", attachments: [{ dataBase64: "aGVsbG8=", mimeType: "image/png", name: "a.png" }] });
    queue.enqueue("s1", { text: "next" });
    const idle = queue.notifyIdle("s1");
    expect(host.calls[0].payload).toEqual({ text: "look", attachments: [{ dataBase64: "aGVsbG8=", mimeType: "image/png", name: "a.png" }] });
    host.pending[0].resolve(undefined);
    await idle;
    const settled = queue.notifyIdle("s1");
    expect(host.calls[1].payload).toEqual({ text: "next", attachments: [] });
    host.pending[1].resolve(undefined);
    await settled;
  });

  it("isolates sessions: busy in one never blocks another", () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    queue.enqueue("s1", { text: "blocked" });
    const result = queue.enqueue("s2", { text: "free" });
    expect(result.outcome).toBe("dispatched");
    expect(host.calls.map((c) => c.sessionId)).toEqual(["s2"]);
    queue.enqueue("s2", { text: "also-free" }); // s2 is now busy with its own first turn
    expect(queue.listQueue("s1").map((i) => i.text)).toEqual(["blocked"]);
    expect(queue.listQueue("s2").map((i) => i.text)).toEqual(["free", "also-free"]); // free is in flight, also-free queued
  });

  it("dispatches across sessions in parallel", () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    const a = queue.enqueue("s1", { text: "A" });
    const b = queue.enqueue("s2", { text: "B" });
    expect(a.outcome).toBe("dispatched");
    expect(b.outcome).toBe("dispatched");
    expect(host.calls.map((c) => c.sessionId).sort()).toEqual(["s1", "s2"]);
  });

  it("tracks busy across markBusy/notifyIdle and in-flight dispatch", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    expect(queue.isBusy("s1")).toBe(false);
    queue.markBusy("s1");
    expect(queue.isBusy("s1")).toBe(true);
    queue.enqueue("s1", { text: "A" });
    const idle = queue.notifyIdle("s1");
    expect(queue.isBusy("s1")).toBe(true); // in-flight dispatch
    host.pending[0].resolve(undefined);
    await idle;
    await flush();
    expect(queue.isBusy("s1")).toBe(true); // A's turn is now streaming
    await queue.notifyIdle("s1");
    expect(queue.isBusy("s1")).toBe(false);
  });

  it("rejects empty enqueue and empty update", () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    expect(() => queue.enqueue("s1", { text: "" })).toThrow(/empty message/);
    expect(() => queue.enqueue("s1", { text: "   " })).toThrow(/empty message/);
    queue.markBusy("s1");
    const a = queue.enqueue("s1", { text: "A" }).message;
    expect(() => queue.updateMessage("s1", a.id, { text: " " })).toThrow(/empty message/);
  });

  it("does not drain when a stale idle arrives after a newer turn started", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    const first = queue.markBusy("s1");
    queue.enqueue("s1", { text: "queued" });
    const second = queue.markBusy("s1");
    const stale = queue.notifyIdle("s1", first);
    expect(host.calls).toHaveLength(0);
    await flush();
    expect(host.calls).toHaveLength(0);
    await Promise.race([stale, flush()]);
    expect(queue.listQueue("s1").map((item) => item.text)).toEqual(["queued"]);
    expect(queue.isBusy("s1")).toBe(true);

    const idle = queue.notifyIdle("s1", second);
    expect(host.calls.map((call) => call.payload.text)).toEqual(["queued"]);
    host.pending[0].resolve(undefined);
    await idle;
  });

  it("cutIn while idle dispatches the chosen item, not FIFO head", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.restoreQueue("s1", [
      { id: "a", sessionId: "s1", text: "head", attachments: [], createdAt: 1, state: "queued" },
      { id: "b", sessionId: "s1", text: "chosen", attachments: [], createdAt: 2, state: "queued" },
    ]);
    const cut = queue.cutInMessage("s1", "b");
    expect(host.calls.map((call) => call.payload.text)).toEqual(["chosen"]);
    host.pending[0].resolve(undefined);
    await cut;
    expect(queue.listQueue("s1").map((item) => item.text)).toEqual(["head"]);
  });

  it("cutIn while busy parks pendingCutIn and notifyIdle sends only that item", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    queue.enqueue("s1", { text: "head" });
    const chosen = queue.enqueue("s1", { text: "chosen" }).message;
    const parked = await queue.cutInMessage("s1", chosen.id);
    expect(parked.state).toBe("sending");
    expect(host.calls).toHaveLength(0);
    const idle = queue.notifyIdle("s1");
    expect(host.calls.map((call) => call.payload.text)).toEqual(["chosen"]);
    host.pending[0].resolve(undefined);
    await idle;
    expect(queue.listQueue("s1").map((item) => item.text)).toEqual(["head"]);
  });

  it("rejects a second cutIn while one is pending and leaves the other queued", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    const a = queue.enqueue("s1", { text: "A" }).message;
    const b = queue.enqueue("s1", { text: "B" }).message;
    await queue.cutInMessage("s1", a.id);
    await expect(queue.cutInMessage("s1", b.id)).rejects.toThrow(/cut-in in progress/);
    expect(queue.listQueue("s1").some((item) => item.id === b.id && item.state === "queued")).toBe(true);
  });

  it("user suppressIdleDrain skips FIFO after abort settle", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    queue.enqueue("s1", { text: "stay" });
    queue.suppressIdleDrain("s1");
    await queue.notifyIdle("s1");
    await queue.notifyIdle("s1");
    expect(host.calls).toHaveLength(0);
    expect(queue.listQueue("s1")[0].text).toBe("stay");
    expect(queue.isBusy("s1")).toBe(false);
  });

  it("noteAbort restores a hung sending drain to queued and ignores a late dispatch ack", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    const result = queue.enqueue("s1", { text: "对啊，参数填错就是大问题啊" });
    expect(result.outcome).toBe("dispatched");
    expect(queue.listQueue("s1")[0].state).toBe("sending");
    expect(queue.isBusy("s1")).toBe(true);

    queue.noteAbort("s1");
    expect(queue.listQueue("s1")).toEqual([
      expect.objectContaining({ id: result.message.id, text: "对啊，参数填错就是大问题啊", state: "queued" }),
    ]);
    expect(queue.isBusy("s1")).toBe(false);

    host.pending[0].resolve(undefined);
    await flush();
    expect(queue.listQueue("s1")).toEqual([
      expect.objectContaining({ id: result.message.id, state: "queued" }),
    ]);
    expect(queue.isBusy("s1")).toBe(false);
  });

  it("noteAbort restores a parked cut-in to queued and does not send it on the aborted epoch", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    const aborted = queue.markBusy("s1");
    queue.enqueue("s1", { text: "fifo-head" });
    const chosen = queue.enqueue("s1", { text: "cut-in-me" }).message;
    await queue.cutInMessage("s1", chosen.id);
    expect(queue.listQueue("s1").find((item) => item.id === chosen.id)?.state).toBe("sending");

    queue.noteAbort("s1");
    expect(queue.listQueue("s1").find((item) => item.id === chosen.id)).toMatchObject({
      text: "cut-in-me",
      state: "queued",
    });
    expect(host.calls).toHaveLength(0);

    await queue.notifyIdle("s1", aborted);
    expect(host.calls).toHaveLength(0);
    expect(queue.listQueue("s1").map((item) => item.text)).toEqual(["cut-in-me", "fifo-head"]);
    expect(queue.listQueue("s1").every((item) => item.state === "queued")).toBe(true);
  });

  it("process-exit idle after cut-in send does not clear the new turn", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    const aborted = queue.markBusy("s1");
    queue.enqueue("s1", { text: "head" });
    const chosen = queue.enqueue("s1", { text: "chosen" }).message;
    await queue.cutInMessage("s1", chosen.id);
    const settle = queue.notifyIdle("s1", aborted);
    expect(host.calls.map((call) => call.payload.text)).toEqual(["chosen"]);
    host.pending[0].resolve(undefined);
    await settle;
    expect(queue.isBusy("s1")).toBe(true);
    await queue.notifyIdle("s1", aborted);
    expect(queue.isBusy("s1")).toBe(true);
    expect(queue.listQueue("s1").map((item) => item.text)).toEqual(["head"]);
    expect(host.calls).toHaveLength(1);
  });

  it("honors a custom drain behavior", () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch, drainBehavior: "follow_up" });
    queue.markBusy("s1");
    queue.enqueue("s1", { text: "A" });
    void queue.notifyIdle("s1");
    expect(host.calls[0]).toMatchObject({ behavior: "follow_up" });
  });

  it("holds enqueue and idle drain while compacting, then dispatches on clear", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markCompacting("s1");
    const result = queue.enqueue("s1", { text: "during compact" });
    expect(result.outcome).toBe("queued");
    expect(queue.isBusy("s1")).toBe(true);
    expect(queue.isCompacting("s1")).toBe(true);
    expect(host.calls).toHaveLength(0);

    await queue.notifyIdle("s1");
    expect(host.calls).toHaveLength(0);
    expect(queue.listQueue("s1")).toEqual([
      expect.objectContaining({ text: "during compact", state: "queued" }),
    ]);

    queue.clearCompacting("s1");
    expect(host.calls.map((call) => call.payload.text)).toEqual(["during compact"]);
    host.pending[0].resolve(undefined);
    await flush();
    expect(queue.listQueue("s1")).toEqual([]);
    expect(queue.isCompacting("s1")).toBe(false);
  });

  it("does not mark a compaction-in-progress rejection as a send failure", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    const result = queue.enqueue("s1", { text: "retry after compact" });
    expect(result.outcome).toBe("dispatched");
    // Compaction starts after drain already called dispatch — the historic race.
    queue.markCompacting("s1");
    host.pending[0].reject(new Error("Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry."));
    await flush();
    expect(queue.listQueue("s1")).toEqual([
      expect.objectContaining({ text: "retry after compact", state: "queued", error: undefined }),
    ]);
    expect(host.calls).toHaveLength(1);

    queue.clearCompacting("s1");
    expect(host.calls).toHaveLength(2);
    host.pending[1].resolve(undefined);
    await flush();
    expect(queue.listQueue("s1")).toEqual([]);
  });

  it("clearCompacting does not drain after user stop", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markBusy("s1");
    queue.markCompacting("s1");
    queue.enqueue("s1", { text: "stay queued" });
    queue.noteAbort("s1");
    await queue.notifyIdle("s1");
    // Writer-exit / compaction_end after Stop: turn is already idle, but this epoch must stay parked.
    queue.clearCompacting("s1");
    expect(host.calls).toHaveLength(0);
    expect(queue.listQueue("s1")).toEqual([
      expect.objectContaining({ text: "stay queued", state: "queued" }),
    ]);
  });

  it("restoreQueue does not drop an active compaction gate", async () => {
    const host = recordingHost();
    const queue = new SessionMessageQueue({ dispatch: host.dispatch });
    queue.markCompacting("s1");
    queue.restoreQueue("s1", [
      { id: "q1", sessionId: "s1", text: "kept", attachments: [], createdAt: 1, state: "queued" },
    ]);
    expect(queue.isCompacting("s1")).toBe(true);
    expect(host.calls).toHaveLength(0);
    await queue.notifyIdle("s1");
    expect(host.calls).toHaveLength(0);
    queue.clearCompacting("s1");
    expect(host.calls.map((call) => call.payload.text)).toEqual(["kept"]);
    host.pending[0].resolve(undefined);
    await flush();
  });
});
