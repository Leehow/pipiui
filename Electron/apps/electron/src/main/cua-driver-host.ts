import { randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, statSync } from "node:fs";
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

/** Pick the app's real content window, not a thin menu/title-bar surface. */
export function selectLaunchWindow(
  windows: Array<Record<string, unknown>>,
  pid: number,
): Record<string, unknown> | undefined {
  const candidates = windows.filter(
    (window) => Number(window.pid) === pid && Number(window.window_id) > 0,
  );
  return candidates.sort((left, right) => {
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
      : { tool: "hotkey", arguments: { ...base, keys } };
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
  private sessions = new Set<string>();
  private desktopSessions = new Map<string, string>();

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
        return this.failure(
          "target_unavailable",
          "Cua Driver launch_app did not return an exact pid and window_id",
          true,
        );
      }
      const target = { pid, window_id: windowID, session };
      this.targets.set(session, target);
      await this.call("bring_to_front", {
        pid: target.pid,
        window_id: target.window_id,
      });
      return {
        ok: true,
        ...structured,
        target,
        ...(await this.observe(target)),
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
      const target = this.targets.get(session);
      if (mutates && !target)
        return this.failure(
          "target_unavailable",
          "Open an application before sending desktop input; no exact target is pinned for this session",
          false,
        );
      if (target) await this.startSession(session, "window");
      for (const raw of actions)
        if (record(raw)) await this.perform(raw, target);
      return {
        ok: true,
        ...(target
          ? await this.observe(target)
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
    this.proxy?.kill("SIGTERM");
    this.daemon?.kill("SIGTERM");
    this.proxy = undefined;
    this.daemon = undefined;
    this.starting = undefined;
    this.targets.clear();
    this.sessions.clear();
    this.desktopSessions.clear();
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
        reject(new Error(`Cua Driver ${method} timed out`));
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
      throw new Error(
        result.content
          ?.map((x: any) => x.text)
          .filter(Boolean)
          .join("\n") || `Cua Driver ${name} failed`,
      );
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
      },
    };
  }
}
