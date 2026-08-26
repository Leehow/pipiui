/**
 * Browser surface subpath (`@pipi/host-api/browser`).
 *
 * The root module owns the stable tab/placement contract shared by every
 * consumer; the newer page-surface additions (console notices, certificate
 * errors, JS dialogs, page watches) live here so they can evolve without
 * re-vendoring the root union each wave. Everything composes over the root
 * base types — this module never re-implements the root apiFrom/transport.
 */
import type { BrowserEvent as BrowserBaseEvent, BrowserHostAPI as BrowserBaseHostAPI, Unsubscribe } from './index.js'

/** One page console line surfaced to the panel; main filters to error/warn before emitting. */
export type BrowserConsoleEntry = { timestamp: number; level: string; message: string; sourceId?: string; line?: number; url?: string; tabId?: string };

/** Watch condition as shown in the panel; mirrors the main-side registry contract. */
export type BrowserWatchCondition =
  | { type: "selector"; selector: string; snapshotId?: string; elementIndex?: number; elementToken?: string }
  | { type: "idle"; idleMs?: number }
  | { type: "url_matches"; pattern: string }
  | { type: "expression"; expression: string }
  | { type: "timer" };

/** Active one-shot page watch. `timeoutAt` null means no deadline (the registry's Infinity is not JSON-safe). */
export type BrowserWatchInfo = { watchId: string; condition: BrowserWatchCondition; createdAt: number; timeoutAt: number | null; intervalMs: number; status: "active" | "checking" };

/** Last fired watch, for the panel's trigger banner. */
export type BrowserWatchTrigger = { watchId: string; reason: "matched" | "timeout" | "disposed" | "navigating-lost"; waitedMs: number; url: string; title: string; firedAt: number };

/** Every browser event carries the owning session id. */
type BrowserEventScope = { sessionId: string };

export type BrowserConsoleEvent = { type: "console"; entry: BrowserConsoleEntry } & BrowserEventScope;
export type BrowserCertificateErrorEvent = { type: "certificate-error"; url: string; reason: string } & BrowserEventScope;
export type BrowserJsDialogEvent = { type: "js-dialog"; kind: "alert" | "confirm" | "prompt"; message: string; url?: string } & BrowserEventScope;
/** Full active-watch list; `trigger` is set only on the firing announcement. Also the session-attach hydration snapshot. */
export type BrowserWatchSnapshotEvent = { type: "watch"; watches: BrowserWatchInfo[]; trigger?: BrowserWatchTrigger } & BrowserEventScope;

/** Root browser events plus the page-surface additions this subpath owns. */
export type BrowserSurfaceEvent =
  | BrowserBaseEvent
  | BrowserConsoleEvent
  | BrowserCertificateErrorEvent
  | BrowserJsDialogEvent
  | BrowserWatchSnapshotEvent;

/**
 * Browser host API as seen by surface-aware consumers: identical to the root
 * contract except `subscribe` delivers the widened event union. Method
 * bivariance keeps a root-typed host assignable here, so UI code can adopt
 * the surface view without a transport change.
 */
export interface BrowserSurfaceHostAPI extends Omit<BrowserBaseHostAPI, "subscribe"> {
  subscribe(listener: (event: BrowserSurfaceEvent) => void): Unsubscribe;
}

const surfaceEventTypes = new Set<string>([
  "tabs", "reveal", "error", "mobile-window",
  "console", "certificate-error", "js-dialog", "watch",
]);

/**
 * Runtime guard for the IPC boundary: a producer pushing into the
 * `channel: "browser"` envelope is structurally valid (known type tag +
 * string session id) before the frame crosses to the renderer.
 */
export function isBrowserSurfaceEvent(value: unknown): value is BrowserSurfaceEvent {
  if (value == null || typeof value !== "object") return false;
  const event = value as { type?: unknown; sessionId?: unknown };
  return typeof event.type === "string" && surfaceEventTypes.has(event.type) && typeof event.sessionId === "string";
}
