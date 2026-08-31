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
 *   the host, or right after the queue itself delivered a message), while a
 *   queue-owned dispatch is still in flight (single-flight per session), and
 *   while compaction is active (`markCompacting`/`clearCompacting`). Compaction
 *   is a synchronous drain gate: it must not wait on `loadQueue` or any other
 *   async work, or a settle/enqueue can reach pi mid-compact.
 * - `enqueue` while busy appends FIFO and returns a `queued` item (with its id)
 *   instead of throwing. `enqueue` while idle dispatches immediately.
 * - `notifyIdle` drains the queue: the head item is delivered with the drain
 *   behavior (default `prompt`, matching Swift's idle-after-settle follow-ups).
 *   A successful delivery marks the session busy again until the next
 *   `notifyIdle`, so the next item is never sent while a turn is streaming.
 *   A failed delivery keeps the item with its error and continues the FIFO —
 *   the failed item never reached pi, so retrying cannot double-send.
 *   A compaction-in-progress rejection is not a user-facing failure: the item
 *   stays `queued` and drains again after `clearCompacting`.
 *   Duplicate idle/completion events are harmless: the single-flight guard
 *   swallows them.
 * - `steerMessage` injects an item into a running turn (`steer` behavior) and
 *   removes it on success; failures are retained with their error.
 * - `noteAbort` (user Stop) restores in-flight `sending` items — including a
 *   parked cut-in — to `queued` and suppresses FIFO drain for that epoch. A
 *   late dispatch ack must not swallow the restored message.
 * - `updateMessage`/`removeMessage`/`promoteMessage`/`retryMessage` only touch
 *   items that are `queued` or `failed` — never an item already being sent.
 *
 * All stored payloads are immutable snapshots: callers can neither mutate a
 * queued item through the value they passed in nor through a returned copy.
 * Attachment objects keep every field (no field loss, mirroring
 * `PromptAttachment` plus any extras).
 */
import type { TurnTelemetryRendererSample } from "@pipi/host-api";

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
export type QueuedDispatchPayload = { text: string; attachments: QueuedAttachment[]; turnTelemetry?: TurnTelemetryRendererSample };
export type QueuedMessage = {
  id: string;
  sessionId: string;
  text: string;
  attachments: QueuedAttachment[];
  createdAt: number;
  state: QueuedMessageState;
  /** In-memory only; the backend strips it from queue persistence/UI snapshots. */
  turnTelemetry?: TurnTelemetryRendererSample;
  /** Failure detail when `state === "failed"`; cleared again by retry/edit. */
  error?: string;
};
export type EnqueueInput = { text: string; attachments?: QueuedAttachment[]; turnTelemetry?: TurnTelemetryRendererSample };
export type EnqueueResult = { outcome: "queued" | "dispatched"; message: QueuedMessage };
/** Injected delivery callback. Resolves when the message was accepted; rejects on send failure. */
export type DispatchHandler = (sessionId: string, payload: QueuedDispatchPayload, behavior: DispatchBehavior, lifecycleToken?: unknown) => Promise<unknown>;
export type QueueChangeListener = (sessionId: string, items: QueuedMessage[], lifecycleToken?: unknown) => void;
export type SessionMessageQueueOptions = {
  dispatch: DispatchHandler;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  /** Behavior used when draining queued items. Defaults to `prompt` (idle-after-settle, like Swift). */
  drainBehavior?: DispatchBehavior;
  /** Called with immutable queue snapshots after every visible item change. */
  onChange?: QueueChangeListener;
  /** Host-owned lifecycle identity captured when a queue state is first created. */
  captureLifecycleToken?: (sessionId: string) => unknown;
  /** Reject async queue continuations whose captured lifecycle is no longer current. */
  isLifecycleTokenCurrent?: (sessionId: string, lifecycleToken: unknown) => boolean;
  /**
   * Returns true while automatic FIFO delivery must stay inert for the session
   * (user manual stop / archived revival guard). Checked before every drain;
   * user-initiated sends lift it on the host side, so only automatic revival
   * is blocked. Restore paths can never clear it.
   */
  isDrainSuppressed?: (sessionId: string) => boolean;
};

type SessionState = {
  /** Host lifecycle identity captured when this queue state was created. */
  lifecycleToken?: unknown;
  /** Disposal invalidates late asynchronous delivery continuations before the state leaves the registry. */
  disposed?: boolean;
  items: QueuedMessage[];
  /** Bounded receipts make a stale immediate-send click idempotent after the
   * selected row raced from queued/sending to accepted and disappeared. */
  acceptedMessages: QueuedMessage[];
  /** A turn is running (marked by the host or started by a successful delivery). */
  turnActive: boolean;
  /** Monotonic id for the current turn. Stale `notifyIdle` calls must not clear a newer one. */
  turnEpoch: number;
  /** A queue-owned dispatch (drain send or steer) is in flight — single-flight guard. */
  dispatching: boolean;
  /** Current dispatch acknowledgement; exposed for legacy direct-send compatibility. */
  dispatchPromise?: Promise<void>;
  /** Every started dispatch, including one hidden by noteAbort, until it settles. */
  inflightDispatches: Set<Promise<void>>;
  /** Cut-in waiting for the aborted turn to settle; at most one per session. */
  pendingCutIn?: QueuedMessage;
  /** Aborted turn epoch: idle for this epoch must not FIFO-drain until a new turn starts. */
  suppressDrainEpoch?: number;
  /** Bumped by `noteAbort` so a late dispatch ack cannot remove or fail the restored item. */
  deliveryEpoch: number;
  /** Host-observed compaction; blocks drain/enqueue independently of turn epochs. */
  compactionActive: boolean;
};

type DeliveryWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
};

/** Deep copy used both for input snapshots and for values returned to callers. */
const snapshot = <T>(value: T): T => structuredClone(value);
const freeze = <T extends object>(value: T): T => Object.freeze(value);
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const isCompactionInProgressError = (error: unknown): boolean =>
  /compaction is in progress/i.test(errorMessage(error));

export class SessionMessageQueue {
  private readonly dispatch: DispatchHandler;
  private readonly now: () => number;
  private readonly drainBehavior: DispatchBehavior;
  private readonly onChange?: QueueChangeListener;
  private readonly captureLifecycleToken?: (sessionId: string) => unknown;
  private readonly isLifecycleTokenCurrent?: (sessionId: string, lifecycleToken: unknown) => boolean;
  private readonly isDrainSuppressed?: (sessionId: string) => boolean;
  private readonly sessions = new Map<string, SessionState>();
  /** Temporary fence while the host waits for late child/restore continuations to settle. */
  private readonly disposedSessions = new Set<string>();
  private readonly deliveryWaiters = new Map<string, Map<string, Set<DeliveryWaiter>>>();

  constructor(options: SessionMessageQueueOptions) {
    this.dispatch = options.dispatch;
    this.now = options.now ?? Date.now;
    this.drainBehavior = options.drainBehavior ?? "prompt";
    this.onChange = options.onChange;
    this.captureLifecycleToken = options.captureLifecycleToken;
    this.isLifecycleTokenCurrent = options.isLifecycleTokenCurrent;
    this.isDrainSuppressed = options.isDrainSuppressed;
  }

  private state(sessionId: string, lifecycleToken?: unknown): SessionState {
    if (this.disposedSessions.has(sessionId)) throw new Error(`session ${sessionId} queue is disposed`);
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        lifecycleToken: lifecycleToken !== undefined
          ? lifecycleToken
          : this.captureLifecycleToken?.(sessionId),
        items: [],
        acceptedMessages: [],
        turnActive: false,
        turnEpoch: 0,
        dispatching: false,
        deliveryEpoch: 0,
        inflightDispatches: new Set(),
        compactionActive: false,
      };
      this.sessions.set(sessionId, session);
    } else if (session.lifecycleToken === undefined && lifecycleToken !== undefined) {
      session.lifecycleToken = lifecycleToken;
    } else if (lifecycleToken !== undefined && session.lifecycleToken !== undefined
      && session.lifecycleToken !== lifecycleToken) {
      throw new Error(`session ${sessionId} queue lifecycle is stale`);
    }
    if (this.isLifecycleTokenCurrent && session.lifecycleToken !== undefined
      && !this.isLifecycleTokenCurrent(sessionId, session.lifecycleToken)) {
      throw new Error(`session ${sessionId} queue lifecycle is stale`);
    }
    return session;
  }

  private currentState(sessionId: string, lifecycleToken?: unknown): SessionState | undefined {
    const session = this.sessions.get(sessionId);
    if (!session || session.disposed) return undefined;
    if (lifecycleToken !== undefined && session.lifecycleToken !== undefined && session.lifecycleToken !== lifecycleToken)
      return undefined;
    if (!this.isCurrentSession(sessionId, session)) return undefined;
    return session;
  }

  private isCurrentSession(sessionId: string, session: SessionState): boolean {
    return this.sessions.get(sessionId) === session
      && !session.disposed
      && (!this.isLifecycleTokenCurrent || session.lifecycleToken === undefined
        || this.isLifecycleTokenCurrent(sessionId, session.lifecycleToken));
  }

  private changed(sessionId: string, expected?: SessionState): void {
    // A late dispatch acknowledgement can outlive `disposeSession`. Never let
    // that acknowledgement recreate a queue or persist a deleted session.
    const session = this.sessions.get(sessionId);
    if (!session || !this.isCurrentSession(sessionId, session) || (expected && session !== expected)) return;
    const items = this.listQueue(sessionId);
    this.settleDeliveryWaiters(sessionId, items);
    this.onChange?.(sessionId, items, session.lifecycleToken);
  }

  private settleDeliveryWaiters(sessionId: string, items: QueuedMessage[]): void {
    const byMessage = this.deliveryWaiters.get(sessionId);
    if (!byMessage) return;
    for (const [messageId, waiters] of byMessage) {
      const item = items.find(candidate => candidate.id === messageId);
      if (item?.state === "sending") continue;
      byMessage.delete(messageId);
      if (!item) {
        for (const waiter of waiters) waiter.resolve();
        continue;
      }
      const reason = item.state === "failed"
        ? `immediate send failed: ${item.error ?? "delivery rejected"}`
        : "immediate send was not accepted; message remains queued";
      for (const waiter of waiters) waiter.reject(new Error(reason));
    }
    if (byMessage.size === 0) this.deliveryWaiters.delete(sessionId);
  }

  private rejectDeliveryWaiters(sessionId: string, reason: string): void {
    const byMessage = this.deliveryWaiters.get(sessionId);
    if (!byMessage) return;
    this.deliveryWaiters.delete(sessionId);
    for (const waiters of byMessage.values()) {
      for (const waiter of waiters) waiter.reject(new Error(reason));
    }
  }

  private trackDispatch(session: SessionState, delivery: Promise<unknown>): Promise<void> {
    const settled = delivery.then(() => undefined, () => undefined);
    session.inflightDispatches.add(settled);
    void settled.then(() => session.inflightDispatches.delete(settled));
    return settled;
  }

  private blocked(session: SessionState): boolean {
    return session.turnActive || session.dispatching || session.compactionActive;
  }

  /** True while a turn is running, a queue-owned delivery is in flight, or compaction is holding drain. */
  isBusy(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session ? this.blocked(session) : false;
  }

  /** True only while a turn is actually streaming (agent_start→settle); delivery and compaction gates never count. */
  isTurnActive(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session ? session.turnActive : false;
  }

  /** Sessions whose FIFO is blocked on a turn, in-flight delivery, or compaction. */
  busySessionIds(): string[] {
    return [...this.sessions.entries()]
      .filter(([, session]) => this.blocked(session))
      .map(([sessionId]) => sessionId);
  }

  /** Explicit lifecycle seam; callers never need access to the private session registry. */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Explicit lifecycle/diagnostic seam for host shutdown. */
  sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  /** Number of resident per-session queue states. */
  sessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Drop a session's transient FIFO state. Late dispatch completions retain an
   * invalidated local state only; they cannot emit a change or repopulate this
   * registry. Repeating disposal is intentionally a no-op.
   */
  disposeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    // Capture every acknowledgement before dropping the queue state. A user
    // abort may hide dispatchPromise while its underlying delivery is still
    // running, so teardown owns the independent in-flight set as well.
    const dispatches = session
      ? [...session.inflightDispatches, ...(session.dispatchPromise ? [session.dispatchPromise] : [])]
      : [];
    this.disposedSessions.add(sessionId);
    this.rejectDeliveryWaiters(sessionId, `session ${sessionId} queue is disposed`);
    if (!session) return Promise.resolve();
    session.disposed = true;
    session.deliveryEpoch += 1;
    session.items = [];
    session.acceptedMessages = [];
    session.pendingCutIn = undefined;
    session.turnActive = false;
    session.dispatching = false;
    session.dispatchPromise = undefined;
    session.compactionActive = false;
    this.sessions.delete(sessionId);
    return Promise.allSettled(dispatches).then(() => undefined);
  }

  /** Release the temporary disposal fence only after host-owned continuations have settled. */
  finalizeSessionDisposal(sessionId: string): void {
    this.disposedSessions.delete(sessionId);
  }

  /** Dispose every resident session queue without reaching into private Maps. */
  disposeAll(): void {
    for (const sessionId of [...this.sessions.keys()]) this.disposeSession(sessionId);
  }

  /** Wait only for acceptance/failure of the currently-starting pi RPC, never for turn settle. */
  async waitForDispatch(sessionId: string, lifecycleToken?: unknown): Promise<void> {
    await this.currentState(sessionId, lifecycleToken)?.dispatchPromise;
  }

  /**
   * Wait for one selected queue item to be accepted by pi. A successful queue
   * dispatch removes the item; failure or cancellation keeps a retryable row
   * and rejects instead of reporting a false immediate-send success.
   */
  async waitForMessageDelivery(sessionId: string, messageId: string, lifecycleToken?: unknown): Promise<void> {
    const session = this.state(sessionId, lifecycleToken);
    const current = this.listQueue(sessionId).find(item => item.id === messageId);
    if (!current) {
      if (session.acceptedMessages.some(item => item.id === messageId)) return;
      throw new Error(`unknown queued message ${messageId}`);
    }
    if (current.state !== "sending") {
      const reason = current.state === "failed"
        ? `immediate send failed: ${current.error ?? "delivery rejected"}`
        : "immediate send was not accepted; message remains queued";
      throw new Error(reason);
    }
    await new Promise<void>((resolve, reject) => {
      let byMessage = this.deliveryWaiters.get(sessionId);
      if (!byMessage) {
        byMessage = new Map();
        this.deliveryWaiters.set(sessionId, byMessage);
      }
      let waiters = byMessage.get(messageId);
      if (!waiters) {
        waiters = new Set();
        byMessage.set(messageId, waiters);
      }
      waiters.add({ resolve, reject });
    });
  }

  /**
   * Add a message for the session. When the session is idle the item is
   * dispatched immediately (`outcome: "dispatched"`); when busy it is appended
   * FIFO and returned as `outcome: "queued"` — never an "already processing"
   * error. Throws only for an empty message (no text and no attachments).
   */
  enqueue(sessionId: string, input: EnqueueInput, lifecycleToken?: unknown): EnqueueResult {
    const text = input.text ?? "";
    const attachments = snapshot(input.attachments ?? []);
    if (!text.trim() && attachments.length === 0) throw new Error("cannot enqueue an empty message");
    const session = this.state(sessionId, lifecycleToken);
    const message = freeze({ id: crypto.randomUUID(), sessionId, text, attachments, ...(input.turnTelemetry ? { turnTelemetry: snapshot(input.turnTelemetry) } : {}), createdAt: this.now(), state: "queued" as const });
    session.items.push(message);
    if (this.blocked(session)) {
      this.changed(sessionId, session);
      return { outcome: "queued", message: snapshot(message) };
    }
    // Restored failed items can coexist with a queued head while no turn is
    // active. Only the actual FIFO head is a direct delivery; later appends
    // remain visibly queued until their own idle drain.
    const next = session.items.find(item => item.state === "queued");
    const direct = next?.id === message.id;
    void this.drain(sessionId, session.lifecycleToken);
    const stored = session.items.find(item => item.id === message.id) ?? message;
    return { outcome: direct ? "dispatched" : "queued", message: snapshot(stored) };
  }

  /** Snapshot of the active items for the session (queued, sending, failed). */
  listQueue(sessionId: string): QueuedMessage[] {
    const session = this.sessions.get(sessionId);
    if (!session || session.disposed) return [];
    const items = session.items.map((item) => snapshot(item));
    if (session.pendingCutIn && !items.some((item) => item.id === session.pendingCutIn!.id)) {
      items.push(snapshot(session.pendingCutIn));
    }
    return items;
  }

  hasPendingCutIn(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.pendingCutIn !== undefined;
  }

  /** User-initiated stop: idles for the current turn must not FIFO-drain. */
  suppressIdleDrain(sessionId: string, lifecycleToken?: unknown): void {
    if (this.disposedSessions.has(sessionId)) return;
    const session = this.state(sessionId, lifecycleToken);
    session.suppressDrainEpoch = session.turnEpoch;
  }

  /**
   * User-initiated stop. Restore every in-flight `sending` item (drain or
   * parked cut-in) to `queued`, suppress FIFO drain for this epoch, and
   * invalidate the current delivery so a late dispatch ack cannot swallow
   * the restored message.
   */
  noteAbort(sessionId: string, lifecycleToken?: unknown): void {
    if (this.disposedSessions.has(sessionId)) return;
    const session = this.state(sessionId, lifecycleToken);
    session.suppressDrainEpoch = session.turnEpoch;
    session.deliveryEpoch += 1;
    const restore = (item: QueuedMessage) => freeze({ ...item, state: "queued" as const, error: undefined });
    if (session.pendingCutIn) {
      const item = session.pendingCutIn;
      session.pendingCutIn = undefined;
      if (!session.items.some(candidate => candidate.id === item.id)) {
        session.items.unshift(restore(item));
      }
    }
    session.items = session.items.map(item => item.state === "sending" ? restore(item) : item);
    session.dispatching = false;
    session.dispatchPromise = undefined;
    this.changed(sessionId, session);
  }

  /**
   * Restore persisted actionable items. A process restart cannot know whether a
   * previous `sending` RPC reached pi, so such entries conservatively become
   * `queued`; only `queued` and `failed` survive the restore.
   */
  restoreQueue(sessionId: string, items: QueuedMessage[], lifecycleToken?: unknown): void {
    if (this.disposedSessions.has(sessionId)) return;
    const session = this.state(sessionId, lifecycleToken);
    session.items = snapshot(items).map(item => freeze({
      ...item,
      sessionId,
      attachments: snapshot(item.attachments ?? []),
      state: item.state === "failed" ? ("failed" as const) : ("queued" as const),
      error: item.state === "failed" ? item.error : undefined,
    }));
    session.acceptedMessages = [];
    session.turnActive = false;
    session.turnEpoch = 0;
    session.dispatching = false;
    session.dispatchPromise = undefined;
    session.pendingCutIn = undefined;
    session.suppressDrainEpoch = undefined;
    session.deliveryEpoch += 1;
    // Compaction is host-observed and can outlive a process restart restore.
    // Never clear `compactionActive` here — `loadQueue` would reopen the drain race.
    this.changed(sessionId, session);
  }

  /**
   * Edit an item that has not been sent yet (`queued` or `failed`). Text and
   * attachments are replaced as given; content edits clear stale renderer
   * timing unless a fresh sample is supplied. The failure state/error survives
   * an edit until the item is retried.
   */
  updateMessage(sessionId: string, id: string, input: EnqueueInput, lifecycleToken?: unknown): QueuedMessage {
    const session = this.state(sessionId, lifecycleToken);
    const index = session.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`unknown queued message ${id}`);
    const current = session.items[index];
    if (current.state === "sending") throw new Error(`message ${id} is already sending`);
    const text = input.text ?? current.text;
    const attachmentsEdited = input.attachments !== undefined;
    const attachments = snapshot(attachmentsEdited ? (input.attachments ?? []) : current.attachments);
    if (!text.trim() && attachments.length === 0) throw new Error("cannot update to an empty message");
    const contentEdited = text !== current.text || attachmentsEdited;
    const refreshedTelemetry = input.turnTelemetry !== undefined
      ? snapshot(input.turnTelemetry)
      : contentEdited ? undefined : current.turnTelemetry;
    const updated = {
      ...current,
      text,
      attachments,
      state: current.state === "queued" ? ("queued" as const) : ("failed" as const),
      error: current.state === "failed" ? current.error : undefined,
      ...(refreshedTelemetry !== undefined ? { turnTelemetry: refreshedTelemetry } : {}),
    };
    if (refreshedTelemetry === undefined) delete (updated as Partial<QueuedMessage>).turnTelemetry;
    session.items[index] = freeze(updated);
    this.changed(sessionId);
    return snapshot(session.items[index]);
  }

  /** Remove an item that has not been sent yet (`queued` or `failed`). */
  removeMessage(sessionId: string, id: string, lifecycleToken?: unknown): QueuedMessage {
    const session = this.state(sessionId, lifecycleToken);
    const index = session.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`unknown queued message ${id}`);
    if (session.items[index].state === "sending") throw new Error(`message ${id} is already sending`);
    const [removed] = session.items.splice(index, 1);
    this.changed(sessionId);
    return snapshot(removed);
  }

  /** Move an item to the head of the FIFO so it is delivered next on drain. */
  promoteMessage(sessionId: string, id: string, lifecycleToken?: unknown): QueuedMessage {
    const session = this.state(sessionId, lifecycleToken);
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
  async steerMessage(sessionId: string, id: string, lifecycleToken?: unknown): Promise<QueuedMessage> {
    const session = this.state(sessionId, lifecycleToken);
    const index = session.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`unknown queued message ${id}`);
    const current = session.items[index];
    if (current.state === "sending") throw new Error(`message ${id} is already sending`);
    if (session.dispatching) throw new Error(`session ${sessionId} is already delivering a message`);
    if (!session.turnActive) {
      const promoted = freeze({ ...current, state: "queued" as const, error: undefined });
      session.items.splice(index, 1);
      session.items.unshift(promoted);
      if (!session.compactionActive) void this.drain(sessionId, session.lifecycleToken);
      return snapshot(session.items[0]);
    }
    session.dispatching = true;
    const deliveryEpoch = session.deliveryEpoch;
    const sending = freeze({ ...current, state: "sending" as const, error: undefined });
    session.items[index] = sending;
    this.changed(sessionId, session);
    const delivery = this.dispatch(sessionId, { text: sending.text, attachments: sending.attachments, turnTelemetry: sending.turnTelemetry }, "steer", session.lifecycleToken);
    this.trackDispatch(session, delivery);
    try {
      await delivery;
      if (!this.isCurrentSession(sessionId, session) || session.deliveryEpoch !== deliveryEpoch) return snapshot(sending);
      if (session.items[index]?.id === id) session.items.splice(index, 1); // injected into the running turn
      this.changed(sessionId, session);
      return snapshot(sending);
    } catch (error) {
      if (!this.isCurrentSession(sessionId, session) || session.deliveryEpoch !== deliveryEpoch) return snapshot(sending);
      const kept = isCompactionInProgressError(error)
        ? freeze({ ...sending, state: "queued" as const, error: undefined })
        : freeze({ ...sending, state: "failed" as const, error: errorMessage(error) });
      if (session.items[index]?.id === id) session.items[index] = kept;
      this.changed(sessionId, session);
      return snapshot(kept);
    } finally {
      if (this.isCurrentSession(sessionId, session) && session.deliveryEpoch === deliveryEpoch) {
        session.dispatching = false;
        if (!session.turnActive && !session.compactionActive) void this.drain(sessionId, session.lifecycleToken);
      }
    }
  }

  /**
   * Cut-in: send this item as the next turn. Idle sessions dispatch immediately.
   * Busy sessions park the item as `pendingCutIn` (state sending) and expect the
   * host to abort the current turn; the next `notifyIdle` sends only this item.
   * A second cut-in while one is pending is rejected and the other item stays queued.
   */
  async cutInMessage(sessionId: string, id: string, lifecycleToken?: unknown): Promise<QueuedMessage> {
    const session = this.state(sessionId, lifecycleToken);
    if (session.pendingCutIn) {
      throw new Error(`session ${sessionId} already has a cut-in in progress`);
    }
    const index = session.items.findIndex((item) => item.id === id);
    if (index < 0) {
      const accepted = session.acceptedMessages.find(item => item.id === id);
      if (accepted) return snapshot(accepted);
      throw new Error(`unknown queued message ${id}`);
    }
    const current = session.items[index];
    if (current.state === "sending") throw new Error(`message ${id} is already sending`);
    if (session.dispatching) throw new Error(`session ${sessionId} is already delivering a message`);
    if (!session.turnActive) {
      const promoted = freeze({ ...current, state: "queued" as const, error: undefined });
      session.items.splice(index, 1);
      session.items.unshift(promoted);
      if (session.compactionActive) {
        this.changed(sessionId, session);
        return snapshot(session.items[0]);
      }
      const delivery = this.send(sessionId, promoted, this.drainBehavior, session.lifecycleToken);
      session.dispatchPromise = this.trackDispatch(session, delivery);
      await delivery;
      if (this.isCurrentSession(sessionId, session) && session.dispatchPromise) session.dispatchPromise = undefined;
      const stored = session.items.find((item) => item.id === id);
      return snapshot(stored ?? { ...promoted, state: "sending" as const });
    }
    const sending = freeze({ ...current, state: "sending" as const, error: undefined });
    session.items.splice(index, 1);
    session.pendingCutIn = sending;
    this.changed(sessionId, session);
    return snapshot(sending);
  }

  /** Retry a failed item: restore it to `queued` at the head and clear its error. */
  retryMessage(sessionId: string, id: string, lifecycleToken?: unknown): QueuedMessage {
    const session = this.state(sessionId, lifecycleToken);
    const index = session.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`unknown queued message ${id}`);
    const current = session.items[index];
    if (current.state !== "failed") throw new Error(`message ${id} is ${current.state}; only failed messages can be retried`);
    const retried = freeze({ ...current, state: "queued" as const, error: undefined });
    session.items.splice(index, 1);
    session.items.unshift(retried);
    this.changed(sessionId, session);
    if (!this.blocked(session)) void this.drain(sessionId, session.lifecycleToken);
    return snapshot(retried);
  }

  /**
   * Reinsert undelivered payloads at the head of the FIFO as `queued`,
   * preserving order (the first input is delivered first). Used by the host
   * when an acknowledged steer never landed in pi's transcript; the caller
   * owns any subsequent drain — this method never dispatches.
   */
  requeueAtHead(sessionId: string, inputs: EnqueueInput[], lifecycleToken?: unknown): QueuedMessage[] {
    const session = this.state(sessionId, lifecycleToken);
    const created: QueuedMessage[] = [];
    for (const input of inputs) {
      const text = input.text ?? "";
      const attachments = snapshot(input.attachments ?? []);
      if (!text.trim() && attachments.length === 0) continue;
      created.push(freeze({ id: crypto.randomUUID(), sessionId, text, attachments, ...(input.turnTelemetry ? { turnTelemetry: snapshot(input.turnTelemetry) } : {}), createdAt: this.now(), state: "queued" as const }));
    }
    if (created.length) {
      session.items.splice(0, 0, ...created);
      this.changed(sessionId, session);
    }
    return created.map(snapshot);
  }

  /** A turn started outside the queue (host-dispatched prompt, pi agent_start). */
  markBusy(sessionId: string, lifecycleToken?: unknown): number {
    if (this.disposedSessions.has(sessionId)) return 0;
    const session = this.state(sessionId, lifecycleToken);
    session.turnActive = true;
    session.turnEpoch += 1;
    session.suppressDrainEpoch = undefined;
    return session.turnEpoch;
  }

  /**
   * Compaction started. Synchronous on purpose: an async hold (e.g. after
   * `loadQueue`) lets `enqueue`/`notifyIdle` dispatch into pi's compact window.
   */
  markCompacting(sessionId: string, lifecycleToken?: unknown): void {
    if (this.disposedSessions.has(sessionId)) return;
    this.state(sessionId, lifecycleToken).compactionActive = true;
  }

  /** Compaction finished. Releases the drain gate and delivers the next queued item. */
  clearCompacting(sessionId: string, lifecycleToken?: unknown): void {
    if (this.disposedSessions.has(sessionId)) return;
    const session = this.state(sessionId, lifecycleToken);
    session.compactionActive = false;
    if (session.turnActive || session.dispatching) return;
    // User Stop owns this epoch: a late compaction_end / writer-exit must not FIFO-drain.
    if (session.suppressDrainEpoch !== undefined && session.suppressDrainEpoch === session.turnEpoch) return;
    if (session.pendingCutIn) {
      void this.dispatchPendingCutIn(sessionId, session.lifecycleToken);
      return;
    }
    void this.drain(sessionId, session.lifecycleToken);
  }

  isCompacting(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.compactionActive === true;
  }

  /**
   * The session turned idle/settled. Clears the busy flag and delivers the next
   * queued item. Idempotent for duplicate idle/completion events: while a
   * delivery is in flight, or while the session is still marked busy, the drain
   * is a no-op. A stale settle (`epoch` older than the current turn) is ignored
   * so a follow-up `agent_start` cannot be cleared by the previous turn's idle.
   */
  async notifyIdle(sessionId: string, epoch?: number, lifecycleToken?: unknown): Promise<void> {
    if (this.disposedSessions.has(sessionId)) return;
    const session = this.currentState(sessionId, lifecycleToken);
    if (!session) return;
    if (epoch !== undefined && epoch !== session.turnEpoch) {
      // Epoch mismatch: distinguish "new epoch has taken over" (safe to ignore) from
      // "stale epoch with no active turn" (must force-clear orphaned busy and drain).
      if (session.turnActive && session.turnEpoch > epoch) {
        console.warn(`[message-queue] notifyIdle stale ignored session=${sessionId} epoch=${epoch} current=${session.turnEpoch}`);
        return;
      }
      console.warn(`[message-queue] notifyIdle stale forced session=${sessionId} epoch=${epoch} current=${session.turnEpoch} turnActive=${session.turnActive}`);
      session.turnActive = false;
    } else {
      session.turnActive = false;
    }
    if (session.compactionActive) return;
    if (session.pendingCutIn) {
      await this.dispatchPendingCutIn(sessionId, session.lifecycleToken);
      return;
    }
    if (session.suppressDrainEpoch !== undefined && session.suppressDrainEpoch === session.turnEpoch) {
      // User Stop owns this epoch: the aborted turn's late settle must not
      // auto-drain the FIFO. When the user has explicitly sent again, the host
      // lifts the suppression — a message queued behind this pin (e.g. one
      // enqueued while the stop escalation still held the turn busy) must not
      // strand here; drain re-checks the suppression gate before delivering.
      if (this.isDrainSuppressed === undefined || this.isDrainSuppressed(sessionId)) return;
    }
    await this.drain(sessionId, session.lifecycleToken);
  }

  private async dispatchPendingCutIn(sessionId: string, lifecycleToken?: unknown): Promise<void> {
    const session = this.currentState(sessionId, lifecycleToken);
    if (!session) return;
    const item = session.pendingCutIn;
    if (!item || session.dispatching || session.turnActive || session.compactionActive) return;
    session.pendingCutIn = undefined;
    session.items.unshift(freeze({ ...item, state: "queued" as const, error: undefined }));
    const delivery = this.send(sessionId, session.items[0], this.drainBehavior, session.lifecycleToken);
    const acknowledgement = this.trackDispatch(session, delivery);
    session.dispatchPromise = acknowledgement;
    await delivery;
    if (this.isCurrentSession(sessionId, session) && session.dispatchPromise === acknowledgement) session.dispatchPromise = undefined;
  }

  /**
   * Deliver the head queued item. No-op while the session is busy or while a
   * delivery is in flight. After a failed send (no turn started) the FIFO
   * continues automatically; after a successful send the next item waits for
   * the next `notifyIdle` — never dispatched while the turn is streaming.
   */
  async drain(sessionId: string, lifecycleToken?: unknown): Promise<void> {
    const session = this.currentState(sessionId, lifecycleToken);
    if (!session) return;
    if (session.dispatching || session.turnActive || session.compactionActive) return;
    // Manual-stop/archived revival gate: a suppressed session never re-sends
    // queued items from an idle/watchdog/compaction drain. Explicit user
    // sends clear the suppression host-side, then reach their own delivery.
    if (this.isDrainSuppressed?.(sessionId)) return;
    const index = session.items.findIndex((item) => item.state === "queued");
    if (index < 0) return;
    const deliveryEpoch = session.deliveryEpoch;
    const delivery = this.send(sessionId, session.items[index], this.drainBehavior, session.lifecycleToken);
    const acknowledgement = this.trackDispatch(session, delivery);
    session.dispatchPromise = acknowledgement;
    const delivered = await delivery;
    if (this.isCurrentSession(sessionId, session) && session.dispatchPromise === acknowledgement) session.dispatchPromise = undefined;
    if (!this.isCurrentSession(sessionId, session) || session.deliveryEpoch !== deliveryEpoch) return;
    if (!delivered && !session.turnActive && !session.dispatching) await this.drain(sessionId, session.lifecycleToken);
  }

  /**
   * Single-flight delivery of one item. On success the item leaves the queue
   * (delivered) and the session is marked busy — the turn is streaming until
   * the host reports idle. On failure the item is kept with its error.
   */
  private async send(sessionId: string, item: QueuedMessage, behavior: DispatchBehavior, lifecycleToken?: unknown): Promise<boolean> {
    const session = this.currentState(sessionId, lifecycleToken);
    if (!session) return false;
    session.dispatching = true;
    const deliveryEpoch = session.deliveryEpoch;
    const sending = freeze({ ...item, state: "sending" as const, error: undefined });
    const index = session.items.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) session.items[index] = sending;
    this.changed(sessionId, session);
    try {
      await this.dispatch(sessionId, { text: sending.text, attachments: sending.attachments, turnTelemetry: sending.turnTelemetry }, behavior, session.lifecycleToken);
      if (!this.isCurrentSession(sessionId, session) || session.deliveryEpoch !== deliveryEpoch) return false;
      session.acceptedMessages = [
        ...session.acceptedMessages.filter(accepted => accepted.id !== sending.id),
        sending,
      ].slice(-64);
      if (index >= 0 && session.items[index]?.id === item.id) session.items.splice(index, 1);
      // Mint an epoch only when this delivery is the thing that starts the turn.
      // A cut-in send needs one, so the aborted turn's late idle cannot clear the
      // turn it just started. But when the host already marked the session busy —
      // pi emitted agent_start before this dispatch resolved — the epoch exists and
      // the host is holding it; a second mint here would strand the host on a stale
      // epoch, its settle's notifyIdle would be rejected, and the session would stay
      // turnActive forever: no FIFO drain and no idle-time compaction ever again.
      if (!session.turnActive) session.turnEpoch += 1;
      session.turnActive = true;
      session.suppressDrainEpoch = undefined;
      this.changed(sessionId, session);
      return true;
    } catch (error) {
      if (!this.isCurrentSession(sessionId, session) || session.deliveryEpoch !== deliveryEpoch) return false;
      if (index >= 0 && session.items[index]?.id === item.id) {
        // Pi rejects prompts mid-compaction. Keep the item queued and let
        // `clearCompacting` / a later idle drain retry — never a send failure.
        session.items[index] = isCompactionInProgressError(error)
          ? freeze({ ...sending, state: "queued" as const, error: undefined })
          : freeze({ ...sending, state: "failed" as const, error: errorMessage(error) });
      }
      this.changed(sessionId, session);
      return false;
    } finally {
      if (this.isCurrentSession(sessionId, session) && session.deliveryEpoch === deliveryEpoch) session.dispatching = false;
    }
  }
}
