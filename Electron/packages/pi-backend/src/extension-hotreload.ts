/**
 * Extension hot-reload watcher (host side).
 *
 * pi's RPC mode has no reload wire command, so hot updates are delivered by
 * stopping the affected live pi child while it is IDLE: the next send respawns
 * it with fresh `-e` mounts (established respawn semantics) and the session
 * file keeps the history. This module owns the disk half of that flow:
 *
 * - watches the extension discovery roots (project / app / shared store /
 *   builtin runtime checkout),
 * - maps each changed file path to the owning extension id (nearest ancestor
 *   directory containing `pipiui-extension.json` under a known root),
 * - debounces and coalesces bursts (an install touching many files produces
 *   exactly one `changed` emission per extension id),
 *
 * and emits `changed(extensionId)` for the host to turn into graceful session
 * restarts. The host owns the instance; the watcher never touches sessions.
 */

import { existsSync, readdirSync, readFileSync, watch, type Dirent, type FSWatcher } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

export const EXTENSION_MANIFEST_FILENAME = "pipiui-extension.json";

export type HotReloadRootKind = "project" | "app" | "shared-store" | "builtin";

export type HotReloadRoot = { kind: HotReloadRootKind; path: string };

export type ManifestIdReader = (manifestPath: string) => string | null;
export type ManifestExists = (manifestPath: string) => boolean;

/** Reads the extension id out of a `pipiui-extension.json`. Null when unreadable/malformed. */
export function readExtensionManifestId(manifestPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as { id?: unknown };
    return typeof parsed?.id === "string" && parsed.id.trim() ? parsed.id.trim() : null;
  } catch {
    return null;
  }
}

function manifestExistsDefault(manifestPath: string): boolean {
  try {
    return existsSync(manifestPath);
  } catch {
    return false;
  }
}

/** True when `dir` equals `root` or lives underneath it (path-component aware, both resolved). */
export function isUnderRoot(dir: string, root: string): boolean {
  const left = resolve(dir);
  const right = resolve(root);
  if (left === right) return true;
  return left.startsWith(right.endsWith(sep) ? right : right + sep);
}

/**
 * Pure path mapping: walk up from the changed file's directory to the nearest
 * directory containing the extension manifest; the hit must sit inside (or be)
 * one of the known roots. Returns null when the change belongs to no
 * discoverable extension package (root-level temp files, paths outside roots).
 */
export function extensionRootForChangedPath(
  changedPath: string,
  roots: readonly string[],
  manifestExists: ManifestExists = manifestExistsDefault,
): string | null {
  if (!roots.length) return null;
  let dir = dirname(resolve(changedPath));
  while (roots.some((root) => isUnderRoot(dir, root))) {
    if (manifestExists(join(dir, EXTENSION_MANIFEST_FILENAME))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Pure path→extension-id mapping used by the watcher (and unit tests).
 * `readManifestId`/`manifestExists` are injectable so the walk is testable
 * without touching the real manifest files.
 */
export function extensionIdForChangedPath(
  changedPath: string,
  roots: readonly string[],
  readManifestId: ManifestIdReader = readExtensionManifestId,
  manifestExists: ManifestExists = manifestExistsDefault,
): string | null {
  const extensionRoot = extensionRootForChangedPath(changedPath, roots, manifestExists);
  if (!extensionRoot) return null;
  return readManifestId(join(extensionRoot, EXTENSION_MANIFEST_FILENAME));
}

export type HotRestartCandidate = {
  sessionId: string;
  /** The change affects this session's mounts (mounted extension changed / availability flipped). */
  affected: boolean;
  /** Session is mid-turn, spawn-initializing, or compacting — the restart must wait for idle. */
  busy: boolean;
  /** A restart for this session is already running or pending; a burst must not stack a second one. */
  restartInFlight: boolean;
};

/**
 * Pure hot-restart scheduling: unaffected sessions are untouched, already
 * in-flight restarts are not stacked, busy sessions are deferred (applied when
 * the host observes idle), everything else restarts now.
 */
export function selectHotRestartTargets(
  candidates: readonly HotRestartCandidate[],
): { restart: string[]; defer: string[] } {
  const restart: string[] = [];
  const defer: string[] = [];
  for (const candidate of candidates) {
    if (!candidate.affected || candidate.restartInFlight) continue;
    if (candidate.busy) defer.push(candidate.sessionId);
    else restart.push(candidate.sessionId);
  }
  return { restart, defer };
}

/** Set equality for mount-snapshot comparison (availability-diff mode). */
export function stringSetEquals(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

export type ExtensionHotReloaderOptions = {
  /** Watched discovery roots. Mutable later via setRoots (project roots come and go). */
  roots: readonly HotReloadRoot[];
  /** Debounce window; a continuing burst is flushed after maxWaitMs at the latest. */
  debounceMs?: number;
  /** Called once per coalesced extension id after a burst settles. */
  onChanged: (extensionId: string) => void;
  onError?: (error: Error) => void;
  /** Test seam: start watching one root, return a disposer. Defaults to fs.watch. */
  watchRoot?: (root: HotReloadRoot, notify: (changedPath: string) => void) => () => void;
  /** Test seam: path→extension-id mapping. Defaults to {@link extensionIdForChangedPath}. */
  resolveExtensionId?: (changedPath: string, roots: readonly string[]) => string | null;
};

const DEFAULT_DEBOUNCE_MS = 300;
const DEBOUNCE_MAX_WAIT_MULTIPLIER = 10;
/** Per-dir fallback recursion cap (Linux without recursive fs.watch). */
const FALLBACK_WATCH_DEPTH = 4;

function watchRootDefault(
  root: HotReloadRoot,
  notify: (changedPath: string) => void,
  onError?: (error: Error) => void,
): () => void {
  const watchers: FSWatcher[] = [];
  const handle = (_event: string, filename: string | Buffer | null): void => {
    const name = filename == null ? null : filename.toString();
    notify(name ? join(root.path, name) : root.path);
  };
  const attach = (dir: string, depth: number): void => {
    try {
      const watcher = watch(dir, { recursive: true }, handle);
      watcher.on("error", (error) => onError?.(error as Error));
      watchers.push(watcher);
      return;
    } catch {
      // Recursive unsupported (some Linux configurations): per-dir fallback.
    }
    if (depth > FALLBACK_WATCH_DEPTH) return;
    try {
      const watcher = watch(dir, handle);
      watcher.on("error", (error) => onError?.(error as Error));
      watchers.push(watcher);
    } catch (error) {
      onError?.(error as Error);
      return;
    }
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) attach(join(dir, entry.name), depth + 1);
    }
  };
  attach(root.path, 0);
  return () => {
    for (const watcher of watchers.splice(0)) {
      try {
        watcher.close();
      } catch {
        /* already closed */
      }
    }
  };
}

/**
 * Owns the fs watchers for the extension discovery roots and turns raw file
 * events into debounced, per-extension `changed` emissions.
 */
export class ExtensionHotReloader {
  private roots: readonly HotReloadRoot[];
  private readonly debounceMs: number;
  private readonly onChanged: (extensionId: string) => void;
  private readonly onError?: (error: Error) => void;
  private readonly watchRootFactory: NonNullable<ExtensionHotReloaderOptions["watchRoot"]>;
  private readonly resolveExtensionId: NonNullable<ExtensionHotReloaderOptions["resolveExtensionId"]>;
  private readonly watchers = new Map<string, () => void>();
  private readonly pending = new Map<string, true>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  constructor(options: ExtensionHotReloaderOptions) {
    this.roots = options.roots;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.onChanged = options.onChanged;
    this.onError = options.onError;
    this.watchRootFactory =
      options.watchRoot ??
      ((root, notify) => watchRootDefault(root, notify, (error) => this.reportError(error)));
    this.resolveExtensionId = options.resolveExtensionId ?? extensionIdForChangedPath;
  }

  /** Starts (or completes) watching. Idempotent. */
  start(): void {
    if (this.running) return;
    this.running = true;
    for (const root of this.roots) this.startRoot(root);
  }

  stop(): void {
    this.running = false;
    for (const dispose of this.watchers.values()) dispose();
    this.watchers.clear();
    this.clearTimers();
    this.pending.clear();
  }

  /** Reconcile watched roots (project roots appear/disappear with projects). */
  setRoots(roots: readonly HotReloadRoot[]): void {
    const next = new Map(roots.map((root) => [root.path, root]));
    for (const [path, dispose] of [...this.watchers]) {
      if (!next.has(path)) {
        dispose();
        this.watchers.delete(path);
      }
    }
    this.roots = roots;
    if (this.running) {
      for (const root of roots) {
        if (!this.watchers.has(root.path)) this.startRoot(root);
      }
    }
  }

  /**
   * Feed one raw file-change event (also the test seam: unit tests drive the
   * debounce/coalesce logic without real watchers).
   */
  handleFileChange(changedPath: string): void {
    const roots = this.roots.map((root) => root.path);
    let extensionId: string | null = null;
    try {
      extensionId = this.resolveExtensionId(changedPath, roots);
    } catch (error) {
      this.reportError(error as Error);
      return;
    }
    if (!extensionId) return;
    this.pending.set(extensionId, true);
    this.scheduleFlush();
  }

  /** Pending (debounced, not yet emitted) extension ids. Exposed for tests. */
  pendingExtensionIds(): string[] {
    return [...this.pending.keys()].sort();
  }

  private startRoot(root: HotReloadRoot): void {
    if (this.watchers.has(root.path)) return;
    try {
      const dispose = this.watchRootFactory(root, (changedPath) => this.handleFileChange(changedPath));
      this.watchers.set(root.path, dispose);
    } catch (error) {
      this.reportError(error as Error);
    }
  }

  /**
   * Trailing-edge debounce with a max wait: every new event pushes the flush
   * out by `debounceMs`, but a burst that keeps arriving cannot postpone the
   * flush past `debounceMs * 10` after its first event.
   */
  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), this.debounceMs);
    this.flushTimer.unref?.();
    if (!this.maxWaitTimer) {
      this.maxWaitTimer = setTimeout(() => this.flush(), this.debounceMs * DEBOUNCE_MAX_WAIT_MULTIPLIER);
      this.maxWaitTimer.unref?.();
    }
  }

  private flush(): void {
    this.clearTimers();
    const ids = [...this.pending.keys()].sort();
    this.pending.clear();
    for (const id of ids) {
      try {
        this.onChanged(id);
      } catch (error) {
        this.reportError(error as Error);
      }
    }
  }

  private clearTimers(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.maxWaitTimer) clearTimeout(this.maxWaitTimer);
    this.flushTimer = undefined;
    this.maxWaitTimer = undefined;
  }

  private reportError(error: Error): void {
    try {
      this.onError?.(error);
    } catch {
      /* observer errors must never break the watcher */
    }
  }
}
