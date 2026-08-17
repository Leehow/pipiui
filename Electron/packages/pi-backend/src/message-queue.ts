/**
 * Host-owned per-session message queue (pure core).
 *
 * This module implements the product queue semantics mapped from the Swift
 * existing PipiUI queue semantics: a
 * session that is busy must NEVER surface an "already processing" error to the
 * UI — new messages are appended to a per-session FIFO instead.
 *
 * The queue has no dependency on pi or `AgentSession`: every delivery goes
 * through the injected `dispatch(sessionId, payload, behavior)` callback, so
 * the core is unit-testable against a fake host and can be wired to the real
 * RPC layer later.
 *
 * Lifecycle per session:
 * - A session is *busy* while a turn is running (`markBusy`/`notifyIdle` from
 *   the host, or right after the queue itself delivered a message) and while a
 *   queue-owned dispatch is still in flight (single-flight per session).
 * - `enqueue` while busy appends FIFO and returns a `queued` item (with its id)
 *   instead of throwing. `enqueue` while idle dispatches immediately.
 * - `notifyIdle` drains the queue: the head item is delivered with the drain
 *   behavior (default `prompt`, matching Swift's idle-after-settle follow-ups).
 *   A successful delivery marks the session busy again until the next
 *   `notifyIdle`, so the next item is never sent while a turn is streaming.
 *   A failed delivery keeps the item with its error and continues the FIFO —
 *   the failed item never reached pi, so retrying cannot double-send.
 *   Duplicate idle/completion events are harmless: the single-flight guard
 *   swallows them.
 * - `steerMessage` injects an item into a running turn (`steer` behavior) and
 *   removes it on success; failures are retained with their error.
 * - `updateMessage`/`removeMessage`/`promoteMessage`/`retryMessage` only touch
 *   items that are `queued` or `failed` — never an item already being sent.
 *
 * All stored payloads are immutable snapshots: callers can neither mutate a
 * queued item through the value they passed in nor through a returned copy.
 * Attachment objects keep every field (no field loss, mirroring
 * `PromptAttachment` plus any extras).
 */
export type QueuedMessageState = "queued" | "sending" | "failed";
/** The pi streaming behavior used for a delivery. */
export type DispatchBehavior = "prompt" | "follow_up" | "steer";
/** Image attachment carried with a queued message; mirrors `PromptAttachment` and keeps unknown fields. */
export type QueuedAttachment = {
  dataBase64: string;
  mimeType: string;
  name?: string;
  [extra: string]: unknown;
};
export type QueuedDispatchPayload = { text: string; attachments: QueuedAttachment[] };
export type QueuedMessage = {
  id: string;
  sessionId: string;
  text: string;
  attachments: QueuedAttachment[];
  createdAt: number;
  state: QueuedMessageState;
  /** Failure detail when `state === "failed"`; cleared again by retry/edit. */
  error?: string;
};
export type EnqueueInput = { text: string; attachments?: QueuedAttachment[] };
export type EnqueueResult = { outcome: "queued" | "dispatched"; message: QueuedMessage };
/** Injected delivery callback. Resolves when the message was accepted; rejects on send failure. */
export type DispatchHandler = (sessionId: string, payload: QueuedDispatchPayload, behavior: DispatchBehavior) => Promise<unknown>;
export type QueueChangeListener = (sessionId: string, items: QueuedMessage[]) => void;
export type SessionMessageQueueOptions = {
  dispatch: DispatchHandler;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  /** Behavior used when draining queued items. Defaults to `prompt` (idle-after-settle, like Swift). */
  drainBehavior?: DispatchBehavior;
  /** Called with immutable queue snapshots after every visible item change. */
  onChange?: QueueChangeListener;
};

type SessionState = {
  items: QueuedMessage[];
  /** A turn is running (marked by the host or started by a successful delivery). */
  turnActive: boolean;
  /** Monotonic id for the current turn. Stale `notifyIdle` calls must not clear a newer one. */
  turnEpoch: number;
  /** A queue-owned dispatch (drain send or steer) is in flight — single-flight guard. */
  dispatching: boolean;
  /** Current dispatch acknowledgement; exposed for legacy direct-send compatibility. */
  dispatchPromise?: Promise<void>;
};

/** Deep copy used both for input snapshots and for values returned to callers. */
const snapshot = <T>(value: T): T => structuredClone(value);
const freeze = <T extends object>(value: T): T => Object.freeze(value);
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class SessionMessageQueue {
  private readonly dispatch: DispatchHandler;
  private readonly now: () => number;
  private readonly drainBehavior: DispatchBehavior;
  private readonly onChange?: QueueChangeListener;
  private readonly sessions = new Map<string, SessionState>();

  constructor(options: SessionMessageQueueOptions) {
    this.dispatch = options.dispatch;
    this.now = options.now ?? Date.now;
    this.drainBehavior = options.drainBehavior ?? "prompt";
    this.onChange = options.onChange;
  }

  private state(sessionId: string): SessionState {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = { items: [], turnActive: false, turnEpoch: 0, dispatching: false }; 
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  private changed(sessionId: string): void {
    this.onChange?.(sessionId, this.listQueue(sessionId));
  }

  /** True while a turn is running or a queue-owned delivery is in flight. */
  isBusy(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session ? session.turnActive || session.dispatching : false;
  }

  /** Wait only for acceptance/failure of the currently-starting pi RPC, never for turn settle. */
  async waitForDispatch(sessionId: string): Promise<void> {
    await this.state(sessionId).dispatchPromise;
  }

  /**
   * Add a message for the session. When the session is idle the item is
   * dispatched immediately (`outcome: "dispatched"`); when busy it is appended
   * FIFO and returned as `outcome: "queued"` — never an "already processing"
   * error. Throws only for an empty message (no text and no attachments).
   */
  enqueue(sessionId: string, input: EnqueueInput): EnqueueResult {
    const text = input.text ?? "";
    const attachments = snapshot(input.attachments ?? []);
    if (!text.trim() && attachments.length === 0) throw new Error("cannot enqueue an empty message");
    const session = this.state(sessionId);
    const message = freeze({ id: crypto.randomUUID(), sessionId, text, attachments, createdAt: this.now(), state: "queued" as const });
    session.items.push(message);
    if (session.turnActive || session.dispatching) {
      this.changed(sessionId);
      return { outcome: "queued", message: snapshot(message) };
    }
    // Restored failed items can coexist with a queued head while no turn is
    // active. Only the actual FIFO head is a direct delivery; later appends
    // remain visibly queued until their own idle drain.
    const next = session.items.find(item => item.state === "queued");
    const direct = next?.id === message.id;
    void this.drain(sessionId);
    const stored = session.items.find(item => item.id === message.id) ?? message;
    return { outcome: direct ? "dispatched" : "queued", message: snapshot(stored) };
  }

  /** Snapshot of the active items for the session (queued, sending, failed). */
  listQueue(sessionId: string): QueuedMessage[] {
    return this.state(sessionId).items.map((item) => snapshot(item));
  }

  /**
   * Restore persisted actionable items. A process restart cannot know whether a
   * previous `sending` RPC reached pi, so such entries conservatively become
   * `queued`; only `queued` and `failed` survive the restore.
   */
  restoreQueue(sessionId: string, items: QueuedMessage[]): void {
    const session = this.state(sessionId);
    session.items = snapshot(items).map(item => freeze({
      ...item,
      sessionId,
      attachments: snapshot(item.attachments ?? []),
      state: item.state === "failed" ? ("failed" as const) : ("queued" as const),
      error: item.state === "failed" ? item.error : undefined,
    }));
    session.turnActive = false;
    session.turnEpoch = 0;
    session.dispatching = false;
    session.dispatchPromise = undefined;
    this.changed(sessionId);
  }

  /**
   * Edit an item that has not been sent yet (`queued` or `failed`). Text and
   * attachments are replaced as given; the failure state/error survives an
   * edit until the item is retried.
   */
  updateMessage(sessionId: string, id: string, input: EnqueueInput): QueuedMessage {
    const session = this.state(sessionId);
    const index = session.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`unknown queued message ${id}`);
    const current = session.items[index];
    if (current.state === "sending") throw new Error(`message ${id} is already sending`);
    const text = input.text ?? current.text;
    const attachments = snapshot(input.attachments !== undefined ? input.attachments : current.attachments);
    if (!text.trim() && attachments.length === 0) throw new Error("cannot update to an empty message");
    const updated = freeze({ ...current, text, attachments, state: current.state === "queued" ? ("queued" as const) : ("failed" as const), error: current.state === "failed" ? current.error : undefined });
    session.items[index] = updated;
    this.changed(sessionId);
    return snapshot(updated);
  }

  /** Remove an item that has not been sent yet (`queued` or `failed`). */
  removeMessage(sessionId: string, id: string): QueuedMessage {
    const session = this.state(sessionId);
    const index = session.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`unknown queued message ${id}`);
    if (session.items[index].state === "sending") throw new Error(`message ${id} is already sending`);
    const [removed] = session.items.splice(index, 1);
    this.changed(sessionId);
    return snapshot(removed);
  }

  /** Move an item to the head of the FIFO so it is delivered next on drain. */
  promoteMessage(sessionId: string, id: string): QueuedMessage {
    const session = this.state(sessionId);
    const index = session.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`unknown queued message ${id}`);
    const current = session.items[index];
    if (current.state === "sending") throw new Error(`message ${id} is already sending`);
    if (index === 0) return snapshot(current);
    session.items.splice(index, 1);
    session.items.unshift(current);
    this.changed(sessionId);
    return snapshot(current);
  }

  /**
   * Cut-in delivery. While the session is busy the item is injected into the
   * running turn with `steer` behavior and removed on success; on failure it is
   * retained as `failed`. While the session is idle the item is promoted to the
   * head and delivered like any other prompt. One queue-owned delivery per
   * session at a time.
   */
  async steerMessage(sessionId: string, id: string): Promise<QueuedMessage> {
    const session = this.state(sessionId);
    const index = session.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`unknown queued message ${id}`);
    const current = session.items[index];
    if (current.state === "sending") throw new Error(`message ${id} is already sending`);
    if (session.dispatching) throw new Error(`session ${sessionId} is already delivering a message`);
    if (!session.turnActive) {
      const promoted = freeze({ ...current, state: "queued" as const, error: undefined });
      session.items.splice(index, 1);
      session.items.unshift(promoted);
      void this.drain(sessionId);
      return snapshot(session.items[0]);
    }
    session.dispatching = true;
    const sending = freeze({ ...current, state: "sending" as const, error: undefined });
    session.items[index] = sending;
    this.changed(sessionId);
    try {
      await this.dispatch(sessionId, { text: sending.text, attachments: sending.attachments }, "steer");
      if (session.items[index]?.id === id) session.items.splice(index, 1); // injected into the running turn
      this.changed(sessionId);
      return snapshot(sending);
    } catch (error) {
      const failed = freeze({ ...sending, state: "failed" as const, error: errorMessage(error) });
      if (session.items[index]?.id === id) session.items[index] = failed;
      this.changed(sessionId);
      return snapshot(failed);
    } finally {
      session.dispatching = false;
      if (!session.turnActive) void this.drain(sessionId);
    }
  }

  /** Retry a failed item: restore it to `queued` at the head and clear its error. */
  retryMessage(sessionId: string, id: string): QueuedMessage {
    const session = this.state(sessionId);
    const index = session.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`unknown queued message ${id}`);
    const current = session.items[index];
    if (current.state !== "failed") throw new Error(`message ${id} is ${current.state}; only failed messages can be retried`);
    const retried = freeze({ ...current, state: "queued" as const, error: undefined });
    session.items.splice(index, 1);
    session.items.unshift(retried);
    this.changed(sessionId);
    if (!session.turnActive && !session.dispatching) void this.drain(sessionId);
    return snapshot(retried);
  }

  /** A turn started outside the queue (host-dispatched prompt, pi agent_start). */
  markBusy(sessionId: string): number {
    const session = this.state(sessionId);
    session.turnActive = true;
    session.turnEpoch += 1;
    return session.turnEpoch;
  }

  /**
   * The session turned idle/settled. Clears the busy flag and delivers the next
   * queued item. Idempotent for duplicate idle/completion events: while a
   * delivery is in flight, or while the session is still marked busy, the drain
   * is a no-op. A stale settle (`epoch` older than the current turn) is ignored
   * so a follow-up `agent_start` cannot be cleared by the previous turn's idle.
   */
  async notifyIdle(sessionId: string, epoch?: number): Promise<void> {
    const session = this.state(sessionId);
    if (epoch !== undefined && epoch !== session.turnEpoch) return;
    session.turnActive = false;
    await this.drain(sessionId);
  }

  /**
   * Deliver the head queued item. No-op while the session is busy or while a
   * delivery is in flight. After a failed send (no turn started) the FIFO
   * continues automatically; after a successful send the next item waits for
   * the next `notifyIdle` — never dispatched while the turn is streaming.
   */
  async drain(sessionId: string): Promise<void> {
    const session = this.state(sessionId);
    if (session.dispatching || session.turnActive) return;
    const index = session.items.findIndex((item) => item.state === "queued");
    if (index < 0) return;
    const delivery = this.send(sessionId, session.items[index], this.drainBehavior);
    const acknowledgement = delivery.then(() => undefined);
    session.dispatchPromise = acknowledgement;
    const delivered = await delivery;
    if (session.dispatchPromise === acknowledgement) session.dispatchPromise = undefined;
    if (!delivered && !session.turnActive && !session.dispatching) await this.drain(sessionId);
  }

  /**
   * Single-flight delivery of one item. On success the item leaves the queue
   * (delivered) and the session is marked busy — the turn is streaming until
   * the host reports idle. On failure the item is kept with its error.
   */
  private async send(sessionId: string, item: QueuedMessage, behavior: DispatchBehavior): Promise<boolean> {
    const session = this.state(sessionId);
    session.dispatching = true;
    const sending = freeze({ ...item, state: "sending" as const, error: undefined });
    const index = session.items.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) session.items[index] = sending;
    this.changed(sessionId);
    try {
      await this.dispatch(sessionId, { text: sending.text, attachments: sending.attachments }, behavior);
      if (index >= 0 && session.items[index]?.id === item.id) session.items.splice(index, 1);
      session.turnActive = true;
      this.changed(sessionId);
      return true;
    } catch (error) {
      if (index >= 0 && session.items[index]?.id === item.id) session.items[index] = freeze({ ...sending, state: "failed" as const, error: errorMessage(error) });
      this.changed(sessionId);
      return false;
    } finally {
      session.dispatching = false;
    }
  }
}
