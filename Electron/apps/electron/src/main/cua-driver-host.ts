import { randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

export const CUA_DRIVER_VERSION = "0.19.2";
export type DisplayDescriptor = {
  displayID: number;
  width: number;
  height: number;
};
export type CuaTarget = { pid: number; window_id: number; session: string };

class CuaTargetHandoffError extends Error {
  readonly code = "target_handoff_untrusted";
}

export class CuaDriverRPCTimeoutError extends Error {
  readonly code = "cua_driver_rpc_timeout";
  constructor(method: string) {
    super(`Cua Driver ${method} timed out`);
    this.name = "CuaDriverRPCTimeoutError";
  }
}

const CONTEXT_ROLES = new Set(["window", "sheet", "dialog", "drawer"]);

/** Stable, deliberately narrow identity for the currently actionable window layer. */
export function actionableContext(
  observation: Record<string, unknown>,
  target: CuaTarget,
): Record<string, unknown> {
  const accessibility = record(observation.accessibility)
    ? observation.accessibility
    : {};
  const elements = Array.isArray(accessibility.elements)
    ? accessibility.elements.filter(record)
    : [];
  const layerByIndex = new Map<number, { role: string; id?: unknown }>();
  for (const [index, element] of elements.entries()) {
    const role = String(element.role ?? "")
      .trim()
      .toLowerCase()
      .replace(/^ax/, "");
    if (!CONTEXT_ROLES.has(role)) continue;
    const elementIndex = Number.isInteger(element.element_index)
      ? Number(element.element_index)
      : index;
    layerByIndex.set(elementIndex, {
      role,
      id: element.window_id ?? element.identifier ?? element.element_id,
    });
  }
  const layers = elements.flatMap((element, index) => {
    const elementIndex = Number.isInteger(element.element_index)
      ? Number(element.element_index)
      : index;
    const layer = layerByIndex.get(elementIndex);
    if (!layer) return [];
    const parentIndex = Number(element.parent_index ?? element.parentIndex);
    const parent = Number.isInteger(parentIndex)
      ? layerByIndex.get(parentIndex)
      : undefined;
    return [{
      role: layer.role,
      ...(layer.id !== undefined ? { id: layer.id } : {}),
      ...(parent ? {
        parent_role: parent.role,
        ...(parent.id !== undefined ? { parent_id: parent.id } : {}),
      } : {}),
    }];
  }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return {
    pid: observation.pid ?? target.pid,
    window_id: observation.window_id ?? target.window_id,
    focused_window_id:
      observation.focused_window_id ?? accessibility.focused_window_id,
    modal_window_id:
      observation.modal_window_id ?? accessibility.modal_window_id,
    layers,
  };
}

export function actionableContextChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  target: CuaTarget,
): boolean {
  return JSON.stringify(actionableContext(before, target)) !==
    JSON.stringify(actionableContext(after, target));
}

function snapshotID(observation: Record<string, unknown> | undefined): string | undefined {
  const accessibility = observation && record(observation.accessibility)
    ? observation.accessibility
    : undefined;
  const value = accessibility?.snapshot_id ?? observation?.snapshot_id;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function hasSamePidKeyboardAmbiguity(
  observation: Record<string, unknown> | undefined,
): boolean {
  if (!observation || !record(observation.background_input)) return false;
  const routes = observation.background_input.routes;
  return Array.isArray(routes) && routes.some((route) =>
    record(route) &&
    route.route === "pid_keyboard" &&
    route.status === "refused" &&
    route.reason === "same_pid_keyboard_ambiguity"
  );
}

function isStandardFilePanelObservation(observation: Record<string, unknown>): boolean {
  const firstLine = typeof observation.tree_markdown === "string"
    ? observation.tree_markdown.split("\n", 1)[0]
    : "";
  return /\bAXWindow\b[^\n]*\[id=(?:open-panel|save-panel)(?:\s|\])/.test(firstLine);
}

function normalizedBasename(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFC") : "";
}

function observedElements(observation: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(observation.elements) ? observation.elements.filter(record) : [];
}

function resolveObservedFileTarget(
  observation: Record<string, unknown>,
  basename: string,
): Record<string, unknown> | undefined {
  if (!isStandardFilePanelObservation(observation)) return undefined;
  const elements = observedElements(observation);
  const lists = elements.filter((element) =>
    element.role === "AXList" &&
    (
      typeof element.element_token === "string" ||
      Number.isInteger(element.element_index)
    )
  );
  if (lists.length !== 1) return undefined;
  const list = lists[0];
  const listIndex = Number.isInteger(list.element_index) ? Number(list.element_index) : undefined;
  if (listIndex === undefined) return undefined;
  const normalized = normalizedBasename(basename);
  const candidates = elements.filter((element) =>
    Number(element.parent_index) === listIndex &&
    ["AXImage", "AXRow", "AXCell"].includes(String(element.role ?? "")) &&
    normalizedBasename(element.label ?? element.name ?? element.title) === normalized &&
    (
      typeof element.element_token === "string" ||
      Number.isInteger(element.element_index)
    )
  );
  if (candidates.length !== 1) return undefined;
  const candidate = candidates[0];
  const candidateIndex = Number(candidate.element_index);
  const actionLine = String(observation.tree_markdown ?? "")
    .split("\n")
    .find((line) => new RegExp(`^\\s*- \\[${candidateIndex}\\]\\s`).test(line));
  if (!actionLine || !/\bactions=\[[^\]]*\bopen\b[^\]]*\]/.test(actionLine)) return undefined;
  const currentSnapshotID = snapshotID(observation);
  if (typeof candidate.element_token === "string") {
    return {
      element_token: candidate.element_token,
      ...(currentSnapshotID ? { snapshot_id: currentSnapshotID } : {}),
    };
  }
  if (!currentSnapshotID) return undefined;
  return { element_index: candidate.element_index, snapshot_id: currentSnapshotID };
}

function isDocumentSurfaceObservation(observation: Record<string, unknown>): boolean {
  if (isStandardFilePanelObservation(observation)) return false;
  return observedElements(observation).some((element) =>
    ["AXTextArea", "AXTextView", "AXDocument", "AXWebArea"].includes(String(element.role ?? ""))
  );
}

/** Pick the app's real content window, not a thin menu/title-bar surface. */
export function selectLaunchWindow(
  windows: Array<Record<string, unknown>>,
  pid: number,
): Record<string, unknown> | undefined {
  const candidates = windows.filter(
    (window) => Number(window.pid) === pid && Number(window.window_id) > 0,
  );
  return candidates.sort((left, right) => {
    const booleanRank = (window: Record<string, unknown>, key: string) =>
      window[key] === true ? 1 : window[key] === false ? -1 : 0;
    const currentSpace = booleanRank(right, "on_current_space") - booleanRank(left, "on_current_space");
    if (currentSpace) return currentSpace;
    const onScreen = booleanRank(right, "is_on_screen") - booleanRank(left, "is_on_screen");
    if (onScreen) return onScreen;
    const contentSurfaceRank = (window: Record<string, unknown>) => {
      const bounds = record(window.bounds) ? window.bounds : {};
      const width = Number(bounds.width);
      const height = Number(bounds.height);
      if (!(width > 0) || !(height > 0)) return 0;
      return width >= 120 && height >= 80 ? 1 : -1;
    };
    const contentSurface = contentSurfaceRank(right) - contentSurfaceRank(left);
    if (contentSurface) return contentSurface;
    const leftZ = Number.isInteger(left.z_index) ? Number(left.z_index) : Number.NEGATIVE_INFINITY;
    const rightZ = Number.isInteger(right.z_index) ? Number(right.z_index) : Number.NEGATIVE_INFINITY;
    if (leftZ !== rightZ) return rightZ - leftZ;
    const area = (window: Record<string, unknown>) => {
      const bounds = record(window.bounds) ? window.bounds : {};
      return Math.max(0, Number(bounds.width) || 0) * Math.max(0, Number(bounds.height) || 0);
    };
    return area(right) - area(left);
  })[0];
}
export type CuaCall = { tool: string; arguments: Record<string, unknown> };
type SpawnDriver = typeof spawn;

export function cuaSocketPath(
  temporaryDirectory = tmpdir(),
  pid = process.pid,
  nonce = randomUUID(),
  platform = process.platform,
): string {
  const root = platform === "win32" ? temporaryDirectory : "/tmp";
  const compactNonce = nonce.replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
  return join(root, `pcua-${pid}-${compactNonce}.sock`);
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const TARGET_WINDOW_ERROR_CODES = new Set([
  "window_id_not_found",
  "window_owner_pid_mismatch",
]);

export function cuaToolFailureCode(result: unknown): string | undefined {
  if (!record(result)) return undefined;
  const structured = record(result.structuredContent) ? result.structuredContent : {};
  const nested = record(structured.error) ? structured.error : {};
  for (const value of [structured.error_code, structured.code, nested.code]) {
    if (typeof value === "string" && TARGET_WINDOW_ERROR_CODES.has(value)) return value;
  }
  const text = Array.isArray(result.content)
    ? result.content.filter(record).map((item) => item.text).filter((item): item is string => typeof item === "string").join("\n")
    : "";
  return [...TARGET_WINDOW_ERROR_CODES].find((code) =>
    new RegExp(`(?:^|[^A-Za-z0-9_])${code}(?:$|[^A-Za-z0-9_])`).test(text)
  );
}

/** Argument construction mirrors the pinned 0.19.2 `describe` schemas. */
export function buildActionCall(
  action: Record<string, unknown>,
  target: CuaTarget,
): CuaCall | null {
  const type = String(action.type ?? action.action ?? "");
  if (type === "wait" || type === "screenshot") return null;
  const coordinate = Array.isArray(action.coordinate)
    ? action.coordinate
    : [action.x, action.y];
  const point =
    Number.isFinite(Number(coordinate[0])) &&
    Number.isFinite(Number(coordinate[1]))
      ? { x: Number(coordinate[0]), y: Number(coordinate[1]) }
      : {};
  const element = {
    ...(typeof action.element_token === "string"
      ? { element_token: action.element_token }
      : {}),
    ...(Number.isInteger(action.element_index)
      ? { element_index: action.element_index }
      : {}),
    ...(typeof action.snapshot_id === "string"
      ? { snapshot_id: action.snapshot_id }
      : {}),
  };
  const base = {
    session: target.session,
    pid: target.pid,
    window_id: target.window_id,
    ...element,
    ...(action.delivery_mode ? { delivery_mode: action.delivery_mode } : {}),
  };
  if (
    [
      "click",
      "left_click",
      "right_click",
      "middle_click",
      "double_click",
      "triple_click",
    ].includes(type)
  )
    return {
      tool: "click",
      arguments: {
        ...base,
        ...point,
        button:
          type === "right_click"
            ? "right"
            : type === "middle_click"
              ? "middle"
              : "left",
        count: type === "double_click" ? 2 : type === "triple_click" ? 3 : 1,
      },
    };
  if (type === "type")
    return {
      tool: "type_text",
      arguments: { ...base, ...point, text: action.text },
    };
  if (type === "key" || type === "keypress") {
    const keys = (
      Array.isArray(action.keys) ? action.keys : [action.key]
    ).filter((key): key is string => typeof key === "string" && key.length > 0);
    if (!keys.length) throw new Error(`${type} requires keys`);
    return keys.length === 1
      ? { tool: "press_key", arguments: { ...base, key: keys[0] } }
      : {
          tool: "hotkey",
          arguments: {
            session: target.session,
            pid: target.pid,
            window_id: target.window_id,
            ...(action.delivery_mode ? { delivery_mode: action.delivery_mode } : {}),
            ...point,
            keys,
          },
        };
  }
  if (type === "scroll")
    return {
      tool: "scroll",
      arguments: {
        ...base,
        ...point,
        direction: action.scroll_direction ?? action.direction ?? "down",
        amount: action.scroll_amount ?? action.amount ?? 3,
      },
    };
  throw new Error(`unsupported computer action ${type}`);
}

/** Main-process-only owner of the embedded Cua daemon and its stdio MCP proxy. */
export class CuaDriverHost {
  private daemon?: ChildProcessWithoutNullStreams;
  private proxy?: ChildProcessWithoutNullStreams;
  private lines?: Interface;
  private socket?: string;
  private nextID = 0;
  private pending = new Map<
    number,
    {
      resolve(value: any): void;
      reject(error: Error): void;
      timer: NodeJS.Timeout;
    }
  >();
  private starting?: Promise<void>;
  private targets = new Map<string, CuaTarget>();
  private rootTargets = new Map<string, CuaTarget>();
  private sessions = new Set<string>();
  private desktopSessions = new Map<string, string>();
  private teardowns = new Set<Promise<void>>();
  private shutdownRequested = false;

  constructor(
    readonly driverPath: string,
    readonly display: DisplayDescriptor,
    private readonly spawnDriver: SpawnDriver = spawn,
    private readonly timeoutMs = 32_000,
  ) {}

  usable(): boolean {
    try {
      accessSync(this.driverPath, constants.X_OK);
      return (
        process.platform === "darwin" ||
        process.platform === "linux" ||
        process.platform === "win32"
      );
    } catch {
      return false;
    }
  }

  status(): Record<string, unknown> {
    return {
      usable: this.usable(),
      driverPath: this.driverPath,
      version: CUA_DRIVER_VERSION,
      display: this.display,
    };
  }

  async handle(
    request: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (request.protocolVersion !== 1)
      return this.failure(
        "unsupported_protocol_version",
        "Electron Computer Runtime requires protocolVersion 1",
        false,
      );
    if (request.action === "computer_cancel") {
      this.cancel();
      return { ok: true, cancelled: true };
    }
    if (!this.usable())
      return this.failure(
        "driver_unavailable",
        `Cua Driver ${CUA_DRIVER_VERSION} is missing or not executable at ${this.driverPath}`,
        false,
      );
    if (request.action === "computer_runtime_capabilities") {
      const permissions = await this.call("check_permissions", {});
      return {
        ok: true,
        protocol: { name: "pipiui-computer-runtime", version: 1 },
        operations: [
          "computer_runtime_capabilities",
          "computer_batch",
          "computer_open_application",
          "computer_cancel",
        ],
        actions: [
          "screenshot",
          "click",
          "left_click",
          "right_click",
          "double_click",
          "type",
		  "typeahead",
          "key",
          "keypress",
          "scroll",
          "wait",
        ],
        features: {
          batchActions: true,
          inMemoryScreenshots: true,
          requestCancellation: true,
        },
        display: {
          id: this.display.displayID,
          width: this.display.width,
          height: this.display.height,
        },
        permissions: permissions.structuredContent ?? {},
      };
    }
    if (request.action === "computer_open_application") {
      const session = String(request.sessionKey ?? "");
      if (!session)
        return this.failure(
          "missing_session",
          "computer runtime requires a session key",
          false,
        );
      await this.startSession(session);
      const launched = await this.call(
        "launch_app",
        request.bundle_identifier
          ? { bundle_id: request.bundle_identifier }
          : { name: request.application_name },
      );
      const structured = record(launched.structuredContent)
        ? launched.structuredContent
        : {};
      const pid = Number(structured.pid);
      const windows = Array.isArray(structured.windows)
        ? structured.windows.filter(record)
        : [];
      const windowID = Number(selectLaunchWindow(windows, pid)?.window_id);
      if (
        !Number.isInteger(pid) ||
        pid <= 0 ||
        !Number.isInteger(windowID) ||
        windowID <= 0
      ) {
        this.targets.delete(session);
        this.rootTargets.delete(session);
        return this.failure(
          "target_unavailable",
          "Cua Driver launch_app did not return an exact pid and window_id",
          true,
        );
      }
      const target = { pid, window_id: windowID, session };
      this.rootTargets.set(session, target);
      this.targets.set(session, target);
      await this.call("bring_to_front", {
        pid: target.pid,
        window_id: target.window_id,
      });
      let current: { target: CuaTarget; observation: Record<string, unknown> };
      try {
        current = await this.observeSessionTarget(session, true, true);
      } catch (error) {
        if (error instanceof CuaTargetHandoffError)
          return this.failure(error.code, "Desktop target handoff was not authoritative", false);
        throw error;
      }
      return {
        ok: true,
        ...structured,
        target: current.target,
        ...current.observation,
      };
    }
    if (request.action === "computer_batch") {
      const actions = Array.isArray(request.actions) ? request.actions : [];
      const session = String(request.sessionKey ?? "");
      if (!session)
        return this.failure(
          "missing_session",
          "computer runtime requires a session key",
          false,
        );
      const mutates = actions.some(
        (raw) =>
          record(raw) &&
          !["screenshot", "wait"].includes(
            String(raw.type ?? raw.action ?? ""),
          ),
      );
      let target = this.targets.get(session);
      if (mutates && !target)
        return this.failure(
          "target_unavailable",
          "Open an application before sending desktop input; no exact target is pinned for this session",
          false,
        );
      if (target) await this.startSession(session, "window");
      let observation: Record<string, unknown> | undefined;
      if (target) {
        try {
          ({ target, observation } = await this.observeSessionTarget(session));
        } catch (error) {
          if (error instanceof CuaTargetHandoffError)
            return this.failure(error.code, "Desktop target handoff was not authoritative", false);
          throw error;
        }
      }
      const batchSnapshotID = snapshotID(observation);
      let completedActions = 0;
      let completedMutations = 0;
      for (const raw of actions) {
        if (!record(raw)) continue;
        const type = String(raw.type ?? raw.action ?? "");
        const mutation = !["screenshot", "wait"].includes(type);
        let boundAction = raw;
        if (mutation && target && observation) {
		  if (type === "typeahead") {
			const fileTarget = resolveObservedFileTarget(observation, String(raw.text ?? ""));
			if (!fileTarget) {
			  return this.failure(
				"typeahead_target_untrusted",
				"File type-ahead requires one unique observed Open Panel file list",
				true,
			  );
			}
			boundAction = { ...raw, ...fileTarget };
		  }
          const currentSnapshotID = snapshotID(observation);
          const suppliedSnapshotID = typeof boundAction.snapshot_id === "string"
            ? boundAction.snapshot_id
            : undefined;
          const usesSnapshotElement = Number.isInteger(boundAction.element_index) ||
            typeof boundAction.element_token === "string";
          if (
            usesSnapshotElement && completedMutations > 0 &&
            currentSnapshotID && currentSnapshotID !== batchSnapshotID &&
            !suppliedSnapshotID
          ) {
            return {
              ok: true,
              batchOK: false,
              batchInterrupted: true,
              interruptionReason: "snapshot_changed",
              requiresReplan: true,
              completedActions,
              ...observation,
            };
          }
          if (usesSnapshotElement && suppliedSnapshotID && currentSnapshotID && suppliedSnapshotID !== currentSnapshotID) {
            return {
              ...this.failure(
                "stale_snapshot",
                "UI action is bound to an older accessibility snapshot; observe and locate again",
                true,
              ),
              completedActions,
              ...observation,
            };
          }
          if (
            usesSnapshotElement && currentSnapshotID && !suppliedSnapshotID
          ) {
            boundAction = { ...boundAction, snapshot_id: batchSnapshotID ?? currentSnapshotID };
          }

          if (
            ["type", "key", "keypress"].includes(type) &&
            hasSamePidKeyboardAmbiguity(observation) &&
            boundAction.delivery_mode !== "foreground"
          ) {
            // The driver has refused pid-scoped keyboard delivery because this
            // process owns multiple windows. Keep the already-proven exact
            // window target and select its only safe keyboard route.
            boundAction = { ...boundAction, delivery_mode: "foreground" };
          }

		  if (type === "typeahead") boundAction = { ...boundAction, delivery_mode: "foreground" };
        }
        try {
          await this.perform(boundAction, target);
          if (mutation && target) {
            const immutableRoot = this.rootTargets.get(session);
            const freshState = await this.observeSessionTarget(session, true);
            target = freshState.target;
            const fresh = freshState.observation;
			if (type === "typeahead" && (
			  !immutableRoot ||
			  target.pid !== immutableRoot.pid ||
			  target.window_id !== immutableRoot.window_id ||
			  !isDocumentSurfaceObservation(fresh)
			)) {
			  return this.failure(
				"typeahead_open_unverified",
				"Open Panel did not freshly return to the immutable document surface",
				true,
			  );
			}
            completedActions += 1;
            completedMutations += 1;
            if (observation && actionableContextChanged(observation, fresh, target)) {
              return {
                ok: true,
                batchOK: false,
                batchInterrupted: true,
                interruptionReason: "actionable_context_changed",
                requiresReplan: true,
                completedActions,
                ...fresh,
              };
            }
            observation = fresh;
            continue;
          }
        } catch (error) {
          // A driver timeout/error after input may mean the mutation happened.
          // Observe once, return outcome-unknown, and never execute the tail.
          if (mutation && target) {
            try {
              const freshState = await this.observeSessionTarget(session, true);
              target = freshState.target;
              observation = freshState.observation;
            } catch {
              observation = undefined;
            }
            return {
              ...this.failure(
                "mutation_outcome_unknown",
                error instanceof Error ? error.message : "Cua Driver mutation outcome is unknown",
                true,
              ),
              outcomeUnknown: true,
              completedActions,
              ...(observation ?? {}),
            };
          }
          throw error;
        }
        completedActions += 1;
        if (type === "wait" && target) {
          const freshState = await this.observeSessionTarget(session, true);
          target = freshState.target;
          observation = freshState.observation;
          continue;
        }
      }
      return {
        ok: true,
        ...(target
          ? observation ?? (await this.observeSessionTarget(session)).observation
          : await this.observeDesktop(await this.startDesktopSession(session))),
      };
    }
    return this.failure(
      "unsupported_action",
      `unsupported computer action ${String(request.action)}`,
      false,
    );
  }

  cancel(): void {
    const error = new Error("computer request cancelled");
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
    this.lines?.close();
    this.lines = undefined;
    const proxy = this.proxy;
    const daemon = this.daemon;
    const socket = this.socket;
    this.proxy = undefined;
    this.daemon = undefined;
    this.socket = undefined;
    this.starting = undefined;
    this.targets.clear();
    this.rootTargets.clear();
    this.sessions.clear();
    this.desktopSessions.clear();
    const teardown = this.terminateGeneration(proxy, daemon, socket);
    this.teardowns.add(teardown);
    void teardown.finally(() => this.teardowns.delete(teardown));
  }

  /** Final App-owner boundary: no new generation may start after this resolves. */
  async shutdown(): Promise<void> {
    this.shutdownRequested = true;
    this.cancel();
    while (this.teardowns.size > 0) {
      await Promise.all([...this.teardowns]);
    }
  }

  private failure(
    code: string,
    message: string,
    retryable: boolean,
  ): Record<string, unknown> {
    return {
      ok: false,
      error: message,
      runtimeError: {
        code,
        message,
        retryable,
        requiresObservation: retryable,
      },
    };
  }

  private async ensureStarted(): Promise<void> {
    if (this.shutdownRequested)
      throw new Error("Cua Driver host is shutting down");
    if (this.teardowns.size > 0)
      await Promise.all([...this.teardowns]);
    if (this.proxy && this.daemon && !this.proxy.killed && !this.daemon.killed)
      return;
    if (this.starting) return this.starting;
    this.starting = this.start().catch((error) => {
      this.cancel();
      throw error;
    });
    return this.starting;
  }

  private async start(): Promise<void> {
    this.socket = cuaSocketPath();
    const daemon = this.spawnDriver(
      this.driverPath,
      [
        "serve",
        "--embedded",
        "--parent-liveness-stdio",
        "--no-permissions-gate",
        "--socket",
        this.socket,
        "--host-bundle-id",
        "com.leehow.pipiui-electron",
        "--permission-mode",
        "unrestricted",
        "--dangerously-bypass-approvals",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    this.daemon = daemon;
    let stderr = "";
    daemon.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8192);
    });
    const deadline = Date.now() + 10_000;
    while (!existsSync(this.socket)) {
      if (this.shutdownRequested)
        throw new Error("Cua Driver host is shutting down");
      if (daemon.exitCode !== null)
        throw new Error(`Cua Driver daemon exited: ${stderr.trim()}`);
      if (Date.now() >= deadline)
        throw new Error(`Cua Driver startup timed out at ${this.socket}`);
      await sleep(25);
    }
    if (process.platform !== "win32") {
      const stat = statSync(this.socket);
      if (!stat.isSocket())
        throw new Error("Cua Driver did not create a private socket");
    }
    const proxy = this.spawnDriver(
      this.driverPath,
      [
        "mcp",
        "--embedded",
        "--socket",
        this.socket,
        "--host-bundle-id",
        "com.leehow.pipiui-electron",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    this.proxy = proxy;
    proxy.on("exit", () =>
      this.rejectPending(new Error("Cua Driver MCP proxy exited")),
    );
    if (this.shutdownRequested)
      throw new Error("Cua Driver host is shutting down");
    this.lines = createInterface({ input: proxy.stdout });
    this.lines.on("line", (line) => this.receive(line));
    const initialized = await this.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "PipiUI Electron", version: "0.1" },
    });
    if (
      !record(initialized?.result) ||
      typeof initialized.result.protocolVersion !== "string"
    )
      throw new Error("Cua Driver returned an invalid initialize response");
    proxy.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
        "\n",
    );
  }

  private rejectPending(error: Error): void {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
  }

  private async terminateGeneration(
    proxy: ChildProcessWithoutNullStreams | undefined,
    daemon: ChildProcessWithoutNullStreams | undefined,
    socket: string | undefined,
  ): Promise<void> {
    await Promise.all([
      this.terminateOwnedChild(proxy),
      this.terminateOwnedChild(daemon),
    ]);
    if (socket) {
      try {
        rmSync(socket, { force: true });
      } catch {
        // The child or OS may already have removed the private socket.
      }
    }
  }

  private async terminateOwnedChild(
    child: ChildProcessWithoutNullStreams | undefined,
  ): Promise<void> {
    if (!child) return;
    try { child.stdin.end(); } catch { /* already closed */ }
    const gracefulExit = this.waitForChildExit(child, 400);
    try { child.kill("SIGTERM"); } catch { /* already exited */ }
    if (await gracefulExit) return;
    const forcedExit = this.waitForChildExit(child, 1_000);
    try { child.kill("SIGKILL"); } catch { /* already exited */ }
    await forcedExit;
  }

  private waitForChildExit(
    child: ChildProcessWithoutNullStreams,
    timeoutMs: number,
  ): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    // Lightweight test doubles do not expose process events; sending SIGTERM is
    // the complete observable contract for them. Real ChildProcess instances
    // always expose once/removeListener and take the bounded escalation path.
    if (typeof child.once !== "function" || typeof child.removeListener !== "function")
      return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (exited: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener("exit", onExit);
        resolve(exited);
      };
      const onExit = () => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      child.once("exit", onExit);
      if (child.exitCode !== null || child.signalCode !== null) finish(true);
    });
  }
  private receive(line: string): void {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const id = Number(message?.id);
    const item = this.pending.get(id);
    if (!item) return;
    this.pending.delete(id);
    clearTimeout(item.timer);
    item.resolve(message);
  }
  private async rpc(
    method: string,
    params: Record<string, unknown>,
  ): Promise<any> {
    if (!this.proxy?.stdin.writable)
      throw new Error("Cua Driver MCP proxy is unavailable");
    const id = ++this.nextID;
    const response = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CuaDriverRPCTimeoutError(method));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.proxy.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
    );
    return response;
  }
  private async call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<any> {
    await this.ensureStarted();
    const response = await this.rpc("tools/call", { name, arguments: args });
    if (response.error)
      throw new Error(response.error.message ?? `Cua Driver ${name} failed`);
    const result = response.result ?? {};
    if (result.isError || result.is_error)
      throw Object.assign(new Error(
        result.content
          ?.map((x: any) => x.text)
          .filter(Boolean)
          .join("\n") || `Cua Driver ${name} failed`,
      ), { code: cuaToolFailureCode(result) });
    return result;
  }

  private async startSession(
    session: string,
    captureScope: "window" | "desktop" = "window",
  ): Promise<void> {
    if (this.sessions.has(session)) return;
    await this.call("start_session", {
      session,
      capture_scope: captureScope,
    });
    this.sessions.add(session);
  }

  private async startDesktopSession(ownerSession: string): Promise<string> {
    const existing = this.desktopSessions.get(ownerSession);
    if (existing) return existing;
    const desktopSession = `pipiui-desktop-${randomUUID()}`;
    await this.startSession(desktopSession, "desktop");
    this.desktopSessions.set(ownerSession, desktopSession);
    return desktopSession;
  }

  private async perform(
    action: Record<string, unknown>,
    target?: CuaTarget,
  ): Promise<void> {
    const type = String(action.type ?? action.action ?? "");
    if (type === "wait") {
      await sleep(
        Math.min(
          10_000,
          Number(action.duration_ms ?? Number(action.duration ?? 1) * 1000),
        ),
      );
      return;
    }
    if (type === "screenshot") return;
    if (!target) throw new Error("computer action requires an exact target");
	if (type === "typeahead") {
	  // Use only the exact AX action advertised by the Host-resolved file child.
	  await this.call("click", {
		session: target.session,
		pid: target.pid,
		window_id: target.window_id,
		...(typeof action.element_token === "string" ? { element_token: action.element_token } : {}),
		...(Number.isInteger(action.element_index) ? { element_index: action.element_index } : {}),
		...(typeof action.snapshot_id === "string" ? { snapshot_id: action.snapshot_id } : {}),
		action: "open",
	  });
	  return;
	}
    const call = buildActionCall(action, target);
    if (call) await this.call(call.tool, call.arguments);
  }

  private async observe(target: CuaTarget): Promise<Record<string, unknown>> {
    return this.imageResult(
      await this.call("get_window_state", {
        ...target,
        max_elements: 2000,
        max_depth: 25,
      }),
    );
  }

  private async observeSessionTarget(
    session: string,
    discoverNewSurface = false,
    requireStandardFilePanel = false,
  ): Promise<{ target: CuaTarget; observation: Record<string, unknown> }> {
    let root = this.rootTargets.get(session);
    let target = this.targets.get(session);
    if (!target) throw new CuaTargetHandoffError();
    if (!root) {
      root = target;
      this.rootTargets.set(session, root);
    }
    let observation: Record<string, unknown>;
    try {
      observation = await this.observe(target);
    } catch (error) {
      if (record(error) && error.code === "window_owner_pid_mismatch")
        throw new CuaTargetHandoffError();
      if (
        target.window_id === root.window_id ||
        !record(error) || error.code !== "window_id_not_found"
      ) throw error;
      target = root;
      this.targets.set(session, root);
      observation = await this.observe(root);
    }
    const visited = new Set<number>([target.window_id]);
    for (let depth = 0; depth < 4; depth += 1) {
      const accessibility = record(observation.accessibility)
        ? observation.accessibility
        : {};
      let rawWindowID = observation.modal_window_id ??
        accessibility.modal_window_id ?? observation.focused_window_id ??
        accessibility.focused_window_id;
      let requireRootOwner = false;
      if (rawWindowID === undefined && discoverNewSurface) {
        const discovered = await this.call("get_accessibility_tree", {});
        const structured = record(discovered.structuredContent)
          ? discovered.structuredContent
          : {};
        const windows = Array.isArray(structured.windows)
          ? structured.windows.filter(record)
          : [];
        const anchorIndex = windows.findIndex((window) =>
          Number(window.pid) === target.pid && Number(window.window_id) === target.window_id
        );
        const candidates = (anchorIndex < 0
          ? []
          : requireStandardFilePanel ? windows : windows.slice(0, anchorIndex)
        ).filter((window) => Number(window.pid) === root.pid
          && Number(window.window_id) !== target.window_id
          && Number(window.window_id) !== root.window_id
        ).slice(0, 8);
        if (!candidates.length) break;
        const listed = await this.call("list_windows", {});
        const listedStructured = record(listed.structuredContent) ? listed.structuredContent : {};
        const listedWindows = Array.isArray(listedStructured.windows)
          ? listedStructured.windows.filter(record)
          : [];
        let selected: { target: CuaTarget; observation: Record<string, unknown> } | undefined;
        for (const candidate of candidates) {
          const windowID = Number(candidate.window_id);
          const exact = listedWindows.filter((window) => Number(window.window_id) === windowID);
          const pid = Number(exact[0]?.pid);
          const bounds = record(exact[0]?.bounds) ? exact[0].bounds : {};
          if (exact.length !== 1 || pid !== root.pid
            || exact[0]?.is_on_screen === false || exact[0]?.on_current_space === false
            || Number(bounds.width) < 120 || Number(bounds.height) < 80) continue;
          const candidateTarget = { session, pid, window_id: windowID };
          const candidateObservation = await this.observe(candidateTarget);
          if (requireStandardFilePanel && !isStandardFilePanelObservation(candidateObservation)) continue;
          selected = { target: candidateTarget, observation: candidateObservation };
          break;
        }
        if (!selected) break;
        target = selected.target;
        this.targets.set(session, target);
        visited.add(target.window_id);
        observation = selected.observation;
        discoverNewSurface = false;
        continue;
      }
      const windowID = Number(rawWindowID);
      if (!Number.isInteger(windowID) || windowID <= 0 || windowID === target.window_id) break;
      if (visited.has(windowID)) throw new CuaTargetHandoffError();
      const listed = await this.call("list_windows", {});
      const structured = record(listed.structuredContent)
        ? listed.structuredContent
        : {};
      const windows = Array.isArray(structured.windows)
        ? structured.windows.filter(record)
        : [];
      const exact = windows.filter((window) => Number(window.window_id) === windowID);
      const pid = Number(exact[0]?.pid);
      const exactBounds = record(exact[0]?.bounds) ? exact[0].bounds : {};
      if (
        exact.length !== 1 || !Number.isInteger(pid) || pid <= 0
        || (requireRootOwner && pid !== root.pid)
        || exact[0]?.is_on_screen === false
        || exact[0]?.on_current_space === false
        || (requireRootOwner && (Number(exactBounds.width) < 120 || Number(exactBounds.height) < 80))
      )
        throw new CuaTargetHandoffError();
      target = { session, pid, window_id: windowID };
      this.targets.set(session, target);
      visited.add(windowID);
      observation = await this.observe(target);
      if (requireRootOwner) discoverNewSurface = false;
    }
    return { target, observation };
  }
  private async observeDesktop(
    session: string,
  ): Promise<Record<string, unknown>> {
    return this.imageResult(await this.call("get_desktop_state", { session }));
  }
  private imageResult(result: any): Record<string, unknown> {
    const structured = record(result.structuredContent)
      ? result.structuredContent
      : {};
    const image = Array.isArray(result.content)
      ? result.content.find((item: any) => item?.type === "image")
      : undefined;
    const base64 =
      typeof image?.data === "string" && image.data.length > 0
        ? image.data
        : typeof structured.screenshot_png_b64 === "string" &&
            structured.screenshot_png_b64.length > 0
          ? structured.screenshot_png_b64
          : undefined;
    if (!base64) throw new Error("Cua Driver screenshot returned no image");
    const metadata = { ...structured };
    delete metadata.screenshot_png_b64;
    return {
      ...metadata,
      screenshotId: randomUUID(),
      base64,
      mimeType:
        image?.mimeType ??
        image?.mime_type ??
        structured.screenshot_mime_type ??
        "image/png",
      accessibility: {
        elements: Array.isArray(structured.elements) ? structured.elements : [],
        elementCount: Array.isArray(structured.elements)
          ? structured.elements.length
          : 0,
        ...Object.fromEntries(
          [
            "snapshot_id", "focused_element_index", "focused_window_id",
            "modal_window_id", "windows", "hierarchy", "truncated",
          ].flatMap((key) => structured[key] === undefined ? [] : [[key, structured[key]]]),
        ),
      },
    };
  }
}
