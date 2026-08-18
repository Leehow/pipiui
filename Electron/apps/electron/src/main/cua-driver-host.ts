import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { accessSync, constants, existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { resolveCuaDriverLaunchPath } from "./runtime-assets.js";

export const CUA_DRIVER_VERSION = "0.20.0";
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

function actionSnapshotIDs(action: Record<string, unknown>): string[] {
  const ids: string[] = [];
  if (typeof action.snapshot_id === "string" && action.snapshot_id.length > 0)
    ids.push(action.snapshot_id);
  if (typeof action.element_token === "string") {
    const match = /^(.*):\d+$/.exec(action.element_token);
    if (match?.[1]) ids.push(match[1]);
  }
  return [...new Set(ids)];
}

function computerTaskOwnerKey(session: string, taskId: unknown): string {
  const task = typeof taskId === "string" ? taskId.trim() : "";
  return task ? JSON.stringify([session, task]) : session;
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
const execFileAsync = promisify(execFile);

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function commandUsesLaunchPath(command: string, launchPath: string): boolean {
  if (!launchPath) return false;
  if (command === launchPath || command.startsWith(`${launchPath} `)) return true;
  // Shebang helpers exec as `/usr/bin/env node <launchPath> ...`; still require the exact path token.
  const token = ` ${launchPath}`;
  const index = command.indexOf(token);
  if (index === -1) return false;
  const after = index + token.length;
  return after === command.length || command[after] === " ";
}

async function pidsWithExactLaunchPath(launchPath: string): Promise<number[]> {
  if (process.platform === "win32" || !launchPath || launchPath === "/") return [];
  const expected = new Set([launchPath, resolve(launchPath)]);
  try {
    const { stdout } = await execFileAsync("/bin/ps", ["-axww", "-o", "pid=,command="], {
      encoding: "utf8",
      timeout: 2_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const pids: number[] = [];
    for (const line of stdout.split("\n")) {
      const match = /^\s*(\d+)\s(.*)$/.exec(line);
      if (!match) continue;
      const pid = Number(match[1]);
      if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue;
      if (![...expected].some((path) => commandUsesLaunchPath(match[2], path))) continue;
      pids.push(pid);
    }
    return pids;
  } catch {
    return [];
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const TARGET_WINDOW_ERROR_CODES = new Set([
  "window_id_not_found",
  "window_owner_pid_mismatch",
]);
const STRUCTURED_DRIVER_ERROR_CODES = new Set([
  ...TARGET_WINDOW_ERROR_CODES,
  "desktop_already_active",
]);

function isAppSwitcherAction(action: Record<string, unknown>): boolean {
  const type = String(action.type ?? action.action ?? "").toLowerCase();
  if (type !== "key" && type !== "keypress") return false;
  const tokens = (Array.isArray(action.keys) ? action.keys : [action.key])
    .flatMap((value) => String(value ?? "").toUpperCase().split("+"))
    .map((value) => value.trim())
    .filter(Boolean);
  const keys = new Set(tokens.map((value) => value === "COMMAND" ? "CMD" : value));
  return keys.has("CMD") && keys.has("TAB");
}

export function cuaToolFailureCode(result: unknown): string | undefined {
  if (!record(result)) return undefined;
  const structured = record(result.structuredContent) ? result.structuredContent : {};
  const nested = record(structured.error) ? structured.error : {};
  for (const value of [structured.error_code, structured.code, nested.code]) {
    if (typeof value === "string" && STRUCTURED_DRIVER_ERROR_CODES.has(value)) return value;
  }
  const text = Array.isArray(result.content)
    ? result.content.filter(record).map((item) => item.text).filter((item): item is string => typeof item === "string").join("\n")
    : "";
  return [...TARGET_WINDOW_ERROR_CODES].find((code) =>
    new RegExp(`(?:^|[^A-Za-z0-9_])${code}(?:$|[^A-Za-z0-9_])`).test(text)
  );
}

export function isMissingInstalledAppError(error: unknown): boolean {
  return error instanceof Error &&
    /No installed macOS app found for name/i.test(error.message);
}

/** The driver's fixed rejection when the call's lifecycle session idled out. */
export function isDriverSessionEndedError(error: unknown): boolean {
  return error instanceof Error &&
    /has ended; tool call '[^']+' was rejected/i.test(error.message);
}

/** Fixed transient rejection while the daemon closes the preceding operation. */
export function isDriverActiveOperationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ((error as Error & { code?: unknown }).code === "desktop_already_active") return true;
  return /^Desktop session is (?:occupied by another active operation|currently held by another operation)\.?$/i
    .test(error.message.trim());
}

const ACTIVE_OPERATION_RETRY_DELAYS_MS = [20, 50, 100, 200, 400, 800, 1_000] as const;
const ACTIVE_OPERATION_RETRY_BUDGET_MS = ACTIVE_OPERATION_RETRY_DELAYS_MS
  .reduce((total, delay) => total + delay, 0);

type ActiveOperationDiagnostics = {
  code: string;
  operation: string;
  sameSession: boolean;
  attemptCount: number;
  elapsedMs: number;
  retryBudgetMs: number;
};

function activeOperationDiagnostics(error: unknown): ActiveOperationDiagnostics | undefined {
  if (!(error instanceof Error)) return undefined;
  const value = error as Error & { activeOperationDiagnostics?: unknown };
  return record(value.activeOperationDiagnostics)
    ? value.activeOperationDiagnostics as ActiveOperationDiagnostics
    : undefined;
}

export function resolveRunningAppBundleId(
  apps: unknown,
  applicationName: string,
): string | undefined {
  const needle = applicationName.trim().toLowerCase();
  if (!needle || !Array.isArray(apps)) return undefined;
  const matches = apps.filter(record).flatMap((app) => {
    const name = String(app.name ?? app.app_name ?? "").trim().toLowerCase();
    const bundle = String(app.bundle_id ?? app.bundleId ?? "").trim();
    if (name !== needle || !bundle) return [];
    return [{
      bundle,
      running: app.running === true || Number(app.pid) > 0,
    }];
  });
  return (matches.find((app) => app.running) ?? matches[0])?.bundle;
}

/** Argument construction mirrors the pinned 0.20.0 `describe` schemas. */
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
    pid: target.pid,
    window_id: target.window_id,
    ...element,
    ...(action.delivery_mode ? { delivery_mode: action.delivery_mode } : {}),
  };
  if (type === "invoke_menu")
    return {
      tool: "invoke_menu",
      arguments: {
        pid: target.pid,
        window_id: target.window_id,
        path: action.path,
      },
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
  private observations = new Map<string, { target: CuaTarget; observation: Record<string, unknown> }>();
  private applicationIdentities = new Map<string, Set<string>>();
  private sessionScopes = new Map<string, "window" | "desktop">();
  private requestTail: Promise<void> = Promise.resolve();
  private requestGeneration = 0;
  private teardowns = new Set<Promise<void>>();
  private shutdownRequested = false;
  private activeLaunchPath?: string;
  private lastGenerationPids: number[] = [];
  private leftoverSettleMs = 3_000;
  private listExactLaunchPathPids = pidsWithExactLaunchPath;

  constructor(
    readonly driverPath: string,
    readonly display: DisplayDescriptor,
    private readonly spawnDriver: SpawnDriver = spawn,
    private readonly timeoutMs = 32_000,
  ) {}

  private launchPath(): string {
    return resolveCuaDriverLaunchPath(this.driverPath);
  }

  usable(): boolean {
    try {
      accessSync(this.launchPath(), constants.X_OK);
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
    const generation = this.requestGeneration;
    const run = async () => {
      try {
        if (generation !== this.requestGeneration)
          throw new Error("computer request cancelled");
        const result = await this.handleRequest(request);
        if (generation !== this.requestGeneration)
          throw new Error("computer request cancelled");
        return result;
      } catch (error) {
        const diagnostics = activeOperationDiagnostics(error);
        if (!diagnostics) throw error;
        const message = `Cua Driver ${diagnostics.operation} remained busy after ${diagnostics.attemptCount} same-session attempts (${diagnostics.elapsedMs}ms elapsed; ${diagnostics.retryBudgetMs}ms retry budget)`;
        return this.failure(diagnostics.code, message, true, diagnostics);
      }
    };
    const operation = this.requestTail.then(run, run);
    this.requestTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async handleRequest(
    request: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
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
		  "invoke_menu",
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
      const owner = computerTaskOwnerKey(session, request.taskId);
      const identityKeys = [
        typeof request.bundle_identifier === "string" && request.bundle_identifier.trim() ? `bundle:${request.bundle_identifier.trim().toLowerCase()}` : "",
        typeof request.application_name === "string" && request.application_name.trim() ? `name:${request.application_name.trim().toLowerCase()}` : "",
      ].filter(Boolean);
      const established = this.applicationIdentities.get(owner);
      if (this.rootTargets.has(owner) && established && identityKeys.some((key) => !established.has(key)))
        return this.failure(
          "target_handoff_untrusted",
          "This Computer Task already has an exact root application; an unproven alias cannot replace it",
          false,
        );
      const launch = await this.launchApplication({
        bundle_identifier: request.bundle_identifier,
        application_name: request.application_name,
      });
      const launched = launch.result;
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
        this.targets.delete(owner);
        this.rootTargets.delete(owner);
        this.observations.delete(owner);
        return this.failure(
          "target_unavailable",
          "Cua Driver launch_app did not return an exact pid and window_id",
          true,
        );
      }
      const target = { pid, window_id: windowID, session };
      this.rootTargets.set(owner, target);
      this.targets.set(owner, target);
      const proven = new Set(identityKeys);
      for (const key of launch.provenIdentityKeys) proven.add(key);
      for (const [kind, value] of [
        ["bundle", structured.bundle_id ?? structured.bundle_identifier],
        ["name", structured.name ?? structured.application_name],
      ] as const) if (typeof value === "string" && value.trim()) proven.add(`${kind}:${value.trim().toLowerCase()}`);
      this.applicationIdentities.set(owner, proven);
      await this.call("bring_to_front", {
        pid: target.pid,
        window_id: target.window_id,
      });
      let current: { target: CuaTarget; observation: Record<string, unknown> };
      try {
        current = await this.observeSessionTarget(owner, true, true);
      } catch (error) {
        if (error instanceof CuaTargetHandoffError)
          return this.failure(error.code, "Desktop target handoff was not authoritative", false);
        throw error;
      }
      this.observations.set(owner, current);
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
      const owner = computerTaskOwnerKey(session, request.taskId);
      const mutates = actions.some(
        (raw) =>
          record(raw) &&
          !["screenshot", "wait"].includes(
            String(raw.type ?? raw.action ?? ""),
          ),
      );
      let target = this.targets.get(owner);
      if (mutates && !target)
        return this.failure(
          "target_unavailable",
          "Open an application before sending desktop input; no exact target is pinned for this session",
          false,
        );
      if (target && actions.some((raw) => record(raw) && isAppSwitcherAction(raw)))
        return this.failure(
          "target_handoff_untrusted",
          "App-switcher shortcuts cannot be used after an exact application window is pinned; observe the pinned target instead",
          false,
        );
      let observation: Record<string, unknown> | undefined;
      if (target) {
        const suppliedSnapshotIDs = actions.flatMap((raw) => {
          if (!record(raw)) return [];
          const type = String(raw.type ?? raw.action ?? "");
          const usesSnapshotElement = Number.isInteger(raw.element_index) || typeof raw.element_token === "string";
          return !["screenshot", "wait"].includes(type) && usesSnapshotElement
            ? actionSnapshotIDs(raw)
            : [];
        });
        const cached = this.observations.get(owner);
        const canReusePublicObservation = cached !== undefined
          && cached.target.pid === target.pid
          && cached.target.window_id === target.window_id
          && suppliedSnapshotIDs.length > 0
          && suppliedSnapshotIDs.every(id => id === snapshotID(cached.observation));
        if (canReusePublicObservation) {
          observation = cached.observation;
        } else {
          try {
            const current = await this.observeSessionTarget(owner);
            target = current.target;
            observation = current.observation;
            this.observations.set(owner, current);
          } catch (error) {
            if (error instanceof CuaTargetHandoffError)
              return this.failure(error.code, "Desktop target handoff was not authoritative", false);
            throw error;
          }
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
          const boundSnapshotIDs = actionSnapshotIDs(boundAction);
          const suppliedSnapshotID = boundSnapshotIDs[0];
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
          if (usesSnapshotElement && currentSnapshotID && boundSnapshotIDs.some(id => id !== currentSnapshotID)) {
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
            usesSnapshotElement && currentSnapshotID && typeof boundAction.snapshot_id !== "string"
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
            const immutableRoot = this.rootTargets.get(owner);
            const freshState = await this.observeSessionTarget(owner, true);
            target = freshState.target;
            const fresh = freshState.observation;
            this.observations.set(owner, freshState);
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
              const freshState = await this.observeSessionTarget(owner, true);
              target = freshState.target;
              observation = freshState.observation;
              this.observations.set(owner, freshState);
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
          const freshState = await this.observeSessionTarget(owner, true);
          target = freshState.target;
          observation = freshState.observation;
          this.observations.set(owner, freshState);
          continue;
        }
      }
      return {
        ok: true,
        ...(target
          ? observation ?? (await this.observeSessionTarget(owner)).observation
          : await this.observeDesktop()),
      };
    }
    return this.failure(
      "unsupported_action",
      `unsupported computer action ${String(request.action)}`,
      false,
    );
  }

  cancel(): void {
    this.requestGeneration += 1;
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
    this.observations.clear();
    this.applicationIdentities.clear();
    this.sessionScopes.clear();
    const teardown = this.terminateGeneration(proxy, daemon, socket);
    this.teardowns.add(teardown);
    void teardown.catch(() => {}).finally(() => this.teardowns.delete(teardown));
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
    details: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      ok: false,
      error: message,
      runtimeError: {
        code,
        message,
        retryable,
        requiresObservation: retryable,
        ...details,
      },
    };
  }

  private async ensureStarted(): Promise<void> {
    if (this.shutdownRequested)
      throw new Error("Cua Driver host is shutting down");
    if (this.teardowns.size > 0)
      await Promise.allSettled([...this.teardowns]);
    if (
      this.proxy && this.daemon &&
      !this.proxy.killed && !this.daemon.killed &&
      this.proxy.exitCode === null && this.daemon.exitCode === null
    )
      return;
    if (this.starting) return this.starting;
    await this.assertNoLeftoverGeneration();
    // Another caller may have completed startup while the leftover check was
    // awaiting process discovery. Re-check before creating a generation.
    if (
      this.proxy && this.daemon &&
      !this.proxy.killed && !this.daemon.killed &&
      this.proxy.exitCode === null && this.daemon.exitCode === null
    )
      return;
    if (this.starting) return this.starting;
    this.starting = this.start().catch((error) => {
      this.cancel();
      throw error;
    });
    return this.starting;
  }

  private async start(): Promise<void> {
    await this.assertNoLeftoverGeneration();
    this.socket = cuaSocketPath();
    const launchPath = this.launchPath();
    this.activeLaunchPath = launchPath;
    const daemon = this.spawnDriver(
      launchPath,
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
    this.rememberGenerationPid(daemon.pid);
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
      launchPath,
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
    this.rememberGenerationPid(proxy.pid);
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
    const ownedPids = [proxy?.pid, daemon?.pid].filter(
      (pid): pid is number => typeof pid === "number" && pid > 1,
    );
    for (const pid of ownedPids) this.rememberGenerationPid(pid);
    await Promise.all([
      this.terminateOwnedChild(proxy),
      this.terminateOwnedChild(daemon),
    ]);
    await this.reapLaunchPathLeftovers(
      this.activeLaunchPath ?? this.launchPath(),
      ownedPids,
    );
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

  private rememberGenerationPid(pid: number | undefined): void {
    if (typeof pid === "number" && pid > 1 && !this.lastGenerationPids.includes(pid)) {
      this.lastGenerationPids.push(pid);
    }
  }

  private leftoverError(pids: number[]): Error {
    return new Error(`Cua Driver previous generation is still running: ${pids.join(", ")}`);
  }

  private async collectLeftoverPids(launchPath: string, knownPids: number[]): Promise<number[]> {
    const found = new Set(await this.listExactLaunchPathPids(launchPath));
    for (const pid of knownPids) {
      if (pid > 1 && processIsAlive(pid)) found.add(pid);
    }
    found.delete(process.pid);
    return [...found];
  }

  private async assertNoLeftoverGeneration(): Promise<void> {
    const leftovers = await this.collectLeftoverPids(
      this.activeLaunchPath ?? this.launchPath(),
      this.lastGenerationPids,
    );
    if (leftovers.length) throw this.leftoverError(leftovers);
  }

  private async reapLaunchPathLeftovers(
    launchPath: string,
    knownPids: number[],
  ): Promise<void> {
    const collect = () => this.collectLeftoverPids(launchPath, knownPids);
    const signalAll = (pids: number[], signal: NodeJS.Signals) => {
      for (const pid of pids) {
        try { process.kill(pid, signal); } catch { /* already exited */ }
      }
    };
    const waitUntilGone = async (timeoutMs: number) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const leftovers = await collect();
        if (!leftovers.length) return leftovers;
        await sleep(25);
      }
      return collect();
    };
    const waitForPids = async (pids: number[], timeoutMs: number) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const live = pids.filter((pid) => pid > 1 && pid !== process.pid && processIsAlive(pid));
        if (!live.length) return live;
        await sleep(25);
      }
      return pids.filter((pid) => pid > 1 && pid !== process.pid && processIsAlive(pid));
    };
    const escalate = async (pids: number[]) => {
      const live = pids.filter((pid) => pid > 1 && pid !== process.pid && processIsAlive(pid));
      if (!live.length) return;
      signalAll(live, "SIGTERM");
      let leftovers = await waitForPids(live, 400);
      if (!leftovers.length) return;
      signalAll(leftovers, "SIGKILL");
      await waitForPids(leftovers, 1_000);
    };
    const owned = [...new Set(knownPids.filter((pid) => pid > 1))];
    await escalate(owned);
    const swept = (await this.listExactLaunchPathPids(launchPath))
      .filter((pid) => pid > 1 && pid !== process.pid && !owned.includes(pid));
    await escalate(swept);
    let leftovers = await collect();
    if (!leftovers.length) return;
    leftovers = await waitUntilGone(this.leftoverSettleMs);
    if (leftovers.length) throw this.leftoverError(leftovers);
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
    const generation = this.requestGeneration;
    await this.ensureStarted();
    try {
      return await this.invokeWithActiveOperationJoin(name, args, generation);
    } catch (error) {
      const session = typeof args.session === "string" ? args.session : "";
      if (!session || name === "start_session" || !isDriverSessionEndedError(error))
        throw error;
      // The driver ends idle lifecycle sessions and ordinary actions never
      // revive them; re-issue start_session with the same id, then retry once.
      const scope = this.sessionScopes.get(session) ??
        (session.startsWith("pipiui-desktop-") ? "desktop" : "window");
      await this.invoke("start_session", { session, capture_scope: scope });
      this.sessionScopes.set(session, scope);
      return await this.invokeWithActiveOperationJoin(name, args, generation);
    }
  }

  private async invokeWithActiveOperationJoin(
    name: string,
    args: Record<string, unknown>,
    generation: number,
  ): Promise<any> {
    const session = typeof args.session === "string" ? args.session : "";
    const startedAt = Date.now();
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.invoke(name, args);
      } catch (error) {
        const delay = ACTIVE_OPERATION_RETRY_DELAYS_MS[attempt];
        if (!isDriverActiveOperationError(error)) throw error;
        if (!session || name === "start_session" || delay === undefined) {
          if (error instanceof Error) {
            const driverCode = (error as Error & { code?: unknown }).code;
            Object.assign(error, { activeOperationDiagnostics: {
              code: typeof driverCode === "string" ? driverCode : "desktop_already_active",
              operation: /^[a-z0-9_]{1,64}$/.test(name) ? name : "unknown_operation",
              sameSession: Boolean(session),
              attemptCount: attempt + 1,
              elapsedMs: Math.max(0, Math.round(Date.now() - startedAt)),
              retryBudgetMs: name === "start_session" || !session
                ? 0
                : ACTIVE_OPERATION_RETRY_BUDGET_MS,
            } satisfies ActiveOperationDiagnostics });
          }
          throw error;
        }
        await sleep(delay);
        if (generation !== this.requestGeneration)
          throw new Error("computer request cancelled");
      }
    }
  }

  private async invoke(
    name: string,
    args: Record<string, unknown>,
  ): Promise<any> {
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

  private async launchApplication(target: {
    bundle_identifier?: unknown;
    application_name?: unknown;
  }): Promise<{ result: any; provenIdentityKeys: string[] }> {
    const bundle = typeof target.bundle_identifier === "string"
      ? target.bundle_identifier.trim()
      : "";
    const name = typeof target.application_name === "string"
      ? target.application_name.trim()
      : "";
    try {
      const result = await this.call(
        "launch_app",
        bundle ? { bundle_id: bundle } : { name },
      );
      return { result, provenIdentityKeys: [bundle ? `bundle:${bundle.toLowerCase()}` : `name:${name.toLowerCase()}`] };
    } catch (error) {
      if (bundle || !name || !isMissingInstalledAppError(error)) throw error;
      const listed = await this.call("list_apps", {});
      const structured = record(listed.structuredContent) ? listed.structuredContent : {};
      const resolved = resolveRunningAppBundleId(structured.apps, name);
      if (!resolved) throw error;
      const result = await this.call("launch_app", { bundle_id: resolved });
      return { result, provenIdentityKeys: [`name:${name.toLowerCase()}`, `bundle:${resolved.toLowerCase()}`] };
    }
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
        pid: target.pid,
        window_id: target.window_id,
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
  private async observeDesktop(): Promise<Record<string, unknown>> {
    // Pre-target observation is screenshot-only. Keep it cursor-less so it
    // cannot claim a desktop-scoped run before the owner pins a window run.
    return this.imageResult(await this.call("get_desktop_state", {}));
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
