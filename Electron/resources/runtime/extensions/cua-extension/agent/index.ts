// PipiUI Computer Use — cua-extension agent half.
//
// The single thin computer-use surface: this extension mounts the `computer`
// and `open_application` tools in the main session. Driver calls travel
// through the versioned Host Capability API broker (`host_capability` wire
// action, `native.cua` op, one-time capability token) into the Electron core's
// CuaDriverHost and the bundled cua-driver; the desktop-grant capability rides
// inside every driver request, so its authorization semantics are unchanged.
// TCC/Accessibility, CuaDriverHost lifecycle, exact pid/window binding, and
// screenshot capture and cleanup stay in the Electron core.
//
// Coordinate/scale contract: every observation may carry a top-level
// `screenshot: { width, height, scaleX, scaleY }` block — the delivered image
// pixel dims and the scale back to driver pixels. Model coordinates are
// interpreted in the delivered screenshot pixel space; the host bounds-checks
// and maps them back. Every `computer_batch` response carries per-action
// `outcomes` (first failure stops the batch; the tail is `not_executed`).
//
// Screenshot marker pipeline: toolResults keep only an opaque
// [PIPIUI_COMPUTER_SCREENSHOT:id] marker in agent state/session JSONL; the
// provider-context hook prunes evicted inline images and injects exactly the
// retained 3-entry FIFO screenshots, so provider context never accumulates
// every screenshot forever and image bytes never hit disk.
//
// Anthropic messages replaces only computer with computer_20251124. OpenAI native computer_call is not promised.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { randomUUID } from "node:crypto";
import { createNativeCuaClient, type NativeCuaClient } from "./host-capability-client.js";

const PORT = process.env.PIPIUI_BRIDGE_PORT;
const SESSION_CAPABILITY = process.env.PIPIUI_SESSION_CAPABILITY;
const SESSION_KEY = process.env.PIPIUI_SESSION_KEY;
const COMPUTER_CAPABILITY = process.env.PIPIUI_COMPUTER_CAPABILITY;
const RUNTIME_PROTOCOL = "pipiui-computer-runtime";
const RUNTIME_VERSION = 1;
// The built-in Anthropic provider hook is synchronous and needs its typed-tool
// dimensions before the first tool call. Runtime negotiation remains
// authoritative and normal requests use its returned display descriptor.
const DISPLAY_ID = Number.parseInt(process.env.PIPIUI_COMPUTER_DISPLAY_ID || "", 10);
const DISPLAY_WIDTH = Number.parseInt(process.env.PIPIUI_COMPUTER_WIDTH || "1440", 10);
const DISPLAY_HEIGHT = Number.parseInt(process.env.PIPIUI_COMPUTER_HEIGHT || "900", 10);
const REQUEST_TIMEOUT_MS = 35_000;
// Model-context screenshot stream cap (aligns with Anthropic computer-use default N=3).
// Independent of the Swift UI transcript thumbnail cache
// (ComputerScreenshotMemoryCache.maxCount) — two separate pipelines.
const MAX_IN_MEMORY_SCREENSHOTS = 3;
/** Hard cap on AX elements serialized into model-facing toolResult text. */
export const MAX_ACCESSIBILITY_ELEMENTS_IN_CONTEXT = 48;
const SCREENSHOT_MARKER = "PIPIUI_COMPUTER_SCREENSHOT";

const screenshots = new Map<string, {
  data: string;
  mimeType: string;
}>();

type RuntimeCapabilities = {
  protocol: {
    name: string;
    version: number;
  };
  display: {
    id: number;
    width: number;
    height: number;
  };
  [key: string]: unknown;
};

let client: NativeCuaClient | null = null;
let runtimeCapabilitiesPromise: Promise<RuntimeCapabilities> | null = null;

function nativeCua(): NativeCuaClient {
  if (!client) {
    client = createNativeCuaClient({
      bridgePort: PORT!,
      sessionCapability: SESSION_CAPABILITY!,
      sessionKey: SESSION_KEY!,
      computerCapability: COMPUTER_CAPABILITY!,
    });
  }
  return client;
}

function runtimeFailureMessage(json: any, fallback: string): string {
  const message = json?.runtimeError?.message || json?.error || fallback;
  // Surface the host failure code (e.g. `unsupported_action`,
  // `coordinate_out_of_bounds`) so the model can classify without parsing prose.
  const code = json?.runtimeError?.code;
  return typeof code === "string" && code.length > 0
    ? `${code}: ${message}`
    : message;
}

export async function negotiateRuntime(): Promise<RuntimeCapabilities> {
  if (runtimeCapabilitiesPromise) return runtimeCapabilitiesPromise;
  runtimeCapabilitiesPromise = (async () => {
    const json: any = await nativeCua().call({
      action: "computer_runtime_capabilities",
      protocolVersion: RUNTIME_VERSION,
    });
    if (!json.ok) {
      throw new Error(runtimeFailureMessage(
        json,
        "computer runtime capability negotiation failed",
      ));
    }
    if (
      json.protocol?.name !== RUNTIME_PROTOCOL
      || json.protocol?.version !== RUNTIME_VERSION
    ) {
      throw new Error(
        `unsupported PipiUI Computer Runtime: ${
          json.protocol?.name || "unknown"
        } v${json.protocol?.version ?? "unknown"}`,
      );
    }
    if (
      !Number.isFinite(json.display?.id)
      || !Number.isFinite(json.display?.width)
      || !Number.isFinite(json.display?.height)
    ) {
      throw new Error("computer runtime returned invalid display metadata");
    }
    if (
      json.display.id !== DISPLAY_ID
      || json.display.width !== DISPLAY_WIDTH
      || json.display.height !== DISPLAY_HEIGHT
    ) {
      throw new Error(
        "computer runtime display changed; restart the Pi session before acting",
      );
    }
    return json as RuntimeCapabilities;
  })().catch((error) => {
    runtimeCapabilitiesPromise = null;
    throw error;
  });
  return runtimeCapabilitiesPromise;
}

// The complete action set the host can execute — kept in sync with
// SUPPORTED_COMPUTER_ACTIONS in CuaDriverHost. Anything outside this set is
// rejected up-front by the host with `unsupported_action` (nothing executes).
const ActionTypeSchema = Type.Union([
  Type.Literal("screenshot"),
  Type.Literal("click"),
  Type.Literal("left_click"),
  Type.Literal("right_click"),
  Type.Literal("middle_click"),
  Type.Literal("double_click"),
  Type.Literal("triple_click"),
  Type.Literal("type"),
  Type.Literal("key"),
  Type.Literal("keypress"),
  Type.Literal("scroll"),
  Type.Literal("wait"),
  Type.Literal("invoke_menu"),
], {
    description:
      "screenshot | click | left_click | right_click | middle_click | " +
      "double_click | triple_click | type | key | keypress | scroll | wait | " +
      "invoke_menu. invoke_menu triggers an app menu item via its dot-free " +
      'menu path in the path field (e.g. "File > Save As…").',
});

// Some OpenAI-compatible providers (including xAI) reject JSON Schema's
// tuple-style `items: [{...}, {...}]`. Keep the same two-number wire value
// while expressing it as a fixed-length homogeneous array.
const CoordinateSchema = Type.Array(Type.Number(), {
  minItems: 2,
  maxItems: 2,
});

const ActionSchema = Type.Object({
  type: ActionTypeSchema,
  coordinate: Type.Optional(CoordinateSchema),
  x: Type.Optional(Type.Number()),
  y: Type.Optional(Type.Number()),
  start_coordinate: Type.Optional(CoordinateSchema),
  text: Type.Optional(Type.String()),
  keys: Type.Optional(Type.Array(Type.String())),
  scroll_direction: Type.Optional(Type.String()),
  scroll_amount: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
  duration: Type.Optional(Type.Number({ minimum: 0, maximum: 10 })),
  duration_ms: Type.Optional(Type.Number({ minimum: 0, maximum: 10_000 })),
  path: Type.Optional(Type.String({
    description:
      'Dot-free menu path for invoke_menu, e.g. "File > Save As…".',
  })),
  element_index: Type.Optional(Type.Number({
    description: "Element index from the latest AX snapshot for the selected target.",
  })),
  element_token: Type.Optional(Type.String({
    description: "Opaque element token from the latest AX snapshot.",
  })),
  delivery_mode: Type.Optional(Type.Union([
    Type.Literal("background"),
    Type.Literal("foreground"),
  ])),
});

type ComputerAction = {
  type?: string;
  action?: string;
  [key: string]: unknown;
};

export function normalizeActions(params: {
  actions?: ComputerAction[];
  action?: string;
  [key: string]: unknown;
}): ComputerAction[] {
  if (Array.isArray(params.actions)) return params.actions;
  if (typeof params.action === "string") {
    // Anthropic's official typed tool sends one action at the top level.
    return [{ ...params, type: params.action }];
  }
  return [];
}

async function bridge(
  actions: ComputerAction[],
  externalSignal?: AbortSignal,
): Promise<any> {
  const runtime = await negotiateRuntime();
  const json = await nativeCua().call({
    action: "computer_batch",
    protocolVersion: RUNTIME_VERSION,
    displayID: runtime.display.id,
    displayWidth: runtime.display.width,
    displayHeight: runtime.display.height,
    actions,
  }, externalSignal);
  if (!json.ok) {
    throw new Error(runtimeFailureMessage(json, "computer bridge request failed"));
  }
  return json;
}

async function openApplicationBridge(
  target: {
    bundle_identifier?: string;
    application_name?: string;
  },
  externalSignal?: AbortSignal,
): Promise<any> {
  const runtime = await negotiateRuntime();
  const json = await nativeCua().call({
    action: "computer_open_application",
    protocolVersion: RUNTIME_VERSION,
    ...target,
    displayID: runtime.display.id,
    displayWidth: runtime.display.width,
    displayHeight: runtime.display.height,
  }, externalSignal);
  if (!json.ok) {
    throw new Error(runtimeFailureMessage(json, "open_application bridge request failed"));
  }
  return json;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function lifecycleShellBlockReason(
  toolName: string,
  input: unknown,
): string | null {
  if (toolName !== "bash" && toolName !== "shell") return null;
  if (!isRecord(input) || typeof input.command !== "string") return null;
  if (!shellCommandContainsOpen(input.command)) return null;
  return (
    "Do not use shell open for apps, folders, files, or URLs. " +
    "Call open_application to launch or activate the exact app, then use " +
    "computer AX actions or an in-app keyboard shortcut for navigation. " +
    "Prefer the browser tool for web URLs."
  );
}

function shellCommandContainsOpen(command: string, depth = 0): boolean {
  if (depth > 3) return false;
  for (const segment of command.split(/\n|&&|\|\||[;|]/)) {
    const rawTokens =
      segment.trim().match(
        /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s]+/g,
      ) || [];
    const tokens = rawTokens.map((token) => {
      const quoted =
        (token.startsWith('"') && token.endsWith('"'))
        || (token.startsWith("'") && token.endsWith("'"));
      return quoted ? token.slice(1, -1) : token;
    });
    if (shellTokensContainOpen(tokens, depth)) return true;
  }
  return false;
}

function shellTokensContainOpen(tokens: string[], depth: number): boolean {
  const isAssignment = (value: string | undefined) =>
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(value || "");
  const nestedShells = new Set([
    "sh", "bash", "zsh", "/bin/sh", "/bin/bash", "/bin/zsh",
  ]);
  let index = 0;
  const skipAssignments = () => {
    while (isAssignment(tokens[index])) index += 1;
  };
  skipAssignments();

  // Unwrap only well-known command-position prefixes. Arguments elsewhere are
  // never scanned, so `echo /usr/bin/open` and `tool --open` remain allowed.
  for (let wrappers = 0; wrappers < 8 && index < tokens.length; wrappers += 1) {
    const executable = tokens[index];
    if (executable === "open" || executable === "/usr/bin/open") return true;

    if (executable === "exec") {
      index += 1;
      if (tokens[index] === "--") index += 1;
      skipAssignments();
      continue;
    }
    if (executable === "command") {
      index += 1;
      while (tokens[index] === "-p" || tokens[index] === "--") index += 1;
      skipAssignments();
      continue;
    }
    if (
      executable === "env"
      || executable === "/usr/bin/env"
      || executable === "/bin/env"
    ) {
      index += 1;
      while (index < tokens.length) {
        const option = tokens[index];
        if (isAssignment(option)) {
          index += 1;
        } else if (option === "--") {
          index += 1;
          break;
        } else if (option === "-u" || option === "--unset") {
          index += 2;
        } else if (option.startsWith("--unset=")) {
          index += 1;
        } else if (
          ["-i", "--ignore-environment", "-0", "--null", "-v", "--debug"]
            .includes(option)
        ) {
          index += 1;
        } else {
          break;
        }
      }
      skipAssignments();
      continue;
    }
    if (nestedShells.has(executable)) {
      index += 1;
      while (index < tokens.length && tokens[index].startsWith("-")) {
        const option = tokens[index];
        if (/^-[^-]*c/.test(option)) {
          const nestedCommand = tokens[index + 1];
          return typeof nestedCommand === "string"
            && shellCommandContainsOpen(nestedCommand, depth + 1);
        }
        index += 1;
      }
    }
    return false;
  }
  return false;
}

const ANTHROPIC_20251124_MODEL_PREFIXES = [
  "claude-sonnet-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-5",
] as const;

export function isAnthropicComputer20251124Model(
  model: { provider?: string; api?: string; id?: string } | undefined,
): boolean {
  if (!model || model.api !== "anthropic-messages") return false;
  const provider = (model.provider || "").toLowerCase();
  const id = (model.id || "").toLowerCase();
  if (provider !== "anthropic" || !id) return false;
  return ANTHROPIC_20251124_MODEL_PREFIXES.some(
    (prefix) => id === prefix || id.startsWith(`${prefix}-`),
  );
}

function anthropicComputerTool() {
  return {
    type: "computer_20251124",
    name: "computer",
    display_width_px: DISPLAY_WIDTH,
    display_height_px: DISPLAY_HEIGHT,
  };
}

export function replaceComputerTool(tools: unknown): unknown {
  if (!Array.isArray(tools)) return tools;
  return tools.map((tool) => {
    if (!isRecord(tool) || tool.name !== "computer") return tool;
    return anthropicComputerTool();
  });
}

export function mergeBeta(existing: unknown, required: string): string {
  const values = typeof existing === "string"
    ? existing.split(",").map((value) => value.trim()).filter(Boolean)
    : [];
  if (!values.includes(required)) values.push(required);
  return values.join(",");
}

export function retainScreenshot(
  data: string,
  mimeType: string,
  id?: string,
): string {
  // When id is provided it must be the bridge-issued screenshotId so Swift chat
  // ToolRun can resolve the same in-memory PNG the model context injects.
  // Callers that mint agent-facing markers must require a stable bridge id;
  // randomUUID here is only for Node-local retain helpers (tests / inject).
  const screenshotId =
    typeof id === "string" && id.length > 0 ? id : randomUUID();
  screenshots.set(screenshotId, { data, mimeType });
  while (screenshots.size > MAX_IN_MEMORY_SCREENSHOTS) {
    const oldest = screenshots.keys().next().value;
    if (!oldest) break;
    screenshots.delete(oldest);
  }
  return screenshotId;
}

// Cua structured elements expose role / label / value / frame / element_token
// (see get_window_state). Prefer clickable/typeable controls; drop pure layout
// containers and static text so model context stays bounded.
const INTERACTIVE_AX_ROLES = new Set([
  "button", "textfield", "textarea", "textbox", "checkbox", "radiobutton",
  "radio", "popupbutton", "combobox", "menuitem", "menubutton", "link",
  "slider", "incrementor", "stepper", "tab", "disclosuretriangle",
  "searchfield", "securetextfield", "switch", "menubaritem", "colorwell",
  "datefield", "levelindicator", "handle", "row", "cell", "toolbarbutton",
  "sortbutton", "valueindicator", "splitter", "growarea", "menu",
]);

const NON_INTERACTIVE_AX_ROLES = new Set([
  "statictext", "group", "scrollarea", "splitgroup", "toolbar", "window",
  "image", "heading", "progressindicator", "busyindicator", "layoutarea",
  "list", "outline", "table", "browser", "webarea", "application",
  "scrollbar", "ruler", "rulermarker", "relevanceindicator", "sheet",
  "drawer", "dialog", "layoutitem", "matte", "generic", "unknown",
]);

function normalizeAxRole(role: unknown): string {
  if (typeof role !== "string") return "";
  return role.trim().toLowerCase().replace(/^ax/, "");
}

function elementHasOperableActions(element: Record<string, unknown>): boolean {
  const actions = element.actions;
  if (!Array.isArray(actions)) return false;
  return actions.some((action) => {
    const name = String(action ?? "").toLowerCase();
    return /press|open|showmenu|pick|confirm|increment|decrement|cancel|raise|edit/
      .test(name);
  });
}

export function elementIsInteractive(element: unknown): boolean {
  if (!isRecord(element)) return false;
  if (elementHasOperableActions(element)) return true;
  const role = normalizeAxRole(element.role);
  if (role && INTERACTIVE_AX_ROLES.has(role)) return true;
  if (role && NON_INTERACTIVE_AX_ROLES.has(role)) return false;
  // Unknown / missing role: Cua only indexes actionable rows, so keep tokenized
  // entries rather than blanking the snapshot.
  return typeof element.element_token === "string"
    && element.element_token.length > 0;
}

export function compactAccessibility(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const elements = Array.isArray(value.elements) ? value.elements : [];
  const elementCount = elements.length;
  const interactive = elements.filter(elementIsInteractive);
  const structural = elements.filter((element) => {
    if (!isRecord(element)) return false;
    return ["window", "sheet", "dialog", "drawer"].includes(
      normalizeAxRole(element.role),
    );
  });
  // Prefer interactive controls; if none matched, fall back to the raw list so
  // the model is not left without any AX handles. Retain the modal/window spine
  // so the dedicated GUI Operator can distinguish a sheet from its blocked parent.
  const preferred = interactive.length > 0
    ? [...structural, ...interactive.filter((element) => !structural.includes(element))]
    : elements;
  const limited = preferred.slice(0, MAX_ACCESSIBILITY_ELEMENTS_IN_CONTEXT);
  const wasTrimmed = limited.length < elementCount;
  const compact: Record<string, unknown> = {
    elements: limited,
    // Always the pre-trim total so the model knows more elements exist.
    elementCount,
  };
  const sourceTruncated = value.truncated;
  const truncated = sourceTruncated === true || wasTrimmed
    ? true
    : typeof sourceTruncated === "boolean"
      ? sourceTruncated
      : undefined;
  if (truncated !== undefined) compact.truncated = truncated;
  const focused = value.focused_element_index;
  if (
    typeof focused === "boolean"
    || typeof focused === "number"
    || typeof focused === "string"
  ) compact.focused_element_index = focused;
  for (const key of [
    "snapshot_id", "focused_window_id", "modal_window_id", "windows", "hierarchy",
  ]) {
    if (value[key] !== undefined) compact[key] = value[key];
  }
  return compact;
}

export function compactToolDetails(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  for (const key of [
    "openedApplication", "batchOK", "batchError", "focusDrift",
    "foregroundApp", "windowTitle", "displayID", "width", "height",
    "target", "screenshotTarget", "outcomes",
  ]) {
    if (metadata[key] !== undefined) details[key] = metadata[key];
  }
  // Delivered-screenshot pixel dims + scale back to driver pixels only; the
  // base64 bytes themselves stay on the marker/in-memory pipeline.
  const screenshot = metadata.screenshot;
  if (isRecord(screenshot)) {
    const scale: Record<string, unknown> = {};
    for (const key of ["width", "height", "scaleX", "scaleY"]) {
      if (screenshot[key] !== undefined) scale[key] = screenshot[key];
    }
    if (Object.keys(scale).length > 0) details.screenshot = scale;
  }
  const accessibility = metadata.accessibility;
  if (isRecord(accessibility)) {
    const elements = Array.isArray(accessibility.elements)
      ? accessibility.elements
      : [];
    const elementCount =
      typeof accessibility.elementCount === "number"
      && Number.isFinite(accessibility.elementCount)
        ? accessibility.elementCount
        : elements.length;
    details.accessibility = {
      elementCount,
      ...(accessibility.truncated !== undefined
        ? { truncated: accessibility.truncated }
        : {}),
    };
  }
  return details;
}

export function screenshotToolResult(
  result: any,
  metadata: Record<string, unknown>,
) {
  // Contract: bridge success paths must advertise a stable screenshotId that Swift already retained. Minting a Node-only UUID would let the model see
  // the image (via inject) while chat ToolRun cache-misses — user never sees
  // "what AI saw". Refuse unhydratable markers instead.
  const bridgeScreenshotId =
    typeof result?.screenshotId === "string" && result.screenshotId.length > 0
      ? result.screenshotId
      : undefined;
  const base64 =
    typeof result?.base64 === "string" && result.base64.length > 0
      ? result.base64
      : undefined;
  if (!base64) {
    throw new Error(
      "computer bridge success payload missing base64 screenshot",
    );
  }
  if (!bridgeScreenshotId) {
    throw new Error(
      "computer bridge success payload missing stable screenshotId " +
        "(refusing unhydratable marker)",
    );
  }
  const screenshotID = retainScreenshot(
    base64,
    result.mimeType || "image/png",
    bridgeScreenshotId,
  );
  return {
    content: [
      {
        type: "text" as const,
        text:
          `${JSON.stringify(metadata, null, 2)}\n` +
          `[${SCREENSHOT_MARKER}:${screenshotID}]`,
      },
      {
        type: "image" as const,
        data: base64,
        mimeType: result.mimeType || "image/png",
      },
    ],
    details: compactToolDetails(metadata),
  };
}

function screenshotIDs(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const ids: string[] = [];
  const pattern = new RegExp(
    `\\[${SCREENSHOT_MARKER}:([a-fA-F0-9-]+)\\]`,
    "g",
  );
  for (const block of content) {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") continue;
    for (const match of block.text.matchAll(pattern)) ids.push(match[1]);
  }
  return ids;
}

export function injectInMemoryScreenshots(messages: any[]): any[] {
  return messages.map((message) => {
    if (!isRecord(message) || message.role !== "toolResult") return message;
    const ids = screenshotIDs(message.content);
    if (ids.length === 0) return message;
    // Prune + inject: a message carrying our markers gets image blocks equal to
    // exactly the retained FIFO entries for those marker IDs — an evicted
    // screenshot's inline image leaves the provider context instead of
    // accumulating forever. Non-image blocks (metadata text + marker) pass
    // through, and messages without our marker are untouched, so other tools'
    // images are never pruned.
    const blocks = message.content as any[];
    const withoutImages = blocks.filter(
      (block) => !(isRecord(block) && block.type === "image"),
    );
    const images = ids.flatMap((id) => {
      const screenshot = screenshots.get(id);
      return screenshot
        ? [{ type: "image", data: screenshot.data, mimeType: screenshot.mimeType }]
        : [];
    });
    return { ...message, content: [...withoutImages, ...images] };
  });
}

export default function (pi: ExtensionAPI) {
  if (
    !PORT || !SESSION_CAPABILITY || !SESSION_KEY || !COMPUTER_CAPABILITY
    || !Number.isInteger(DISPLAY_ID)
    || !Number.isInteger(DISPLAY_WIDTH)
    || !Number.isInteger(DISPLAY_HEIGHT)
  ) return;

  pi.on("tool_call", (event) => {
    const reason = lifecycleShellBlockReason(event.toolName, event.input);
    if (reason) return { block: true, reason };
  });

  pi.registerTool({
    name: "open_application",
    label: "Open Application",
    description:
      "Select or switch this session's exact macOS target through embedded Cua Driver. " +
      "Use this deterministic lifecycle tool instead of pixel clicks for app launch or activation. " +
      "For in-app navigation, first pin the app here, then use computer AX actions or a keyboard shortcut; never run shell open. " +
      "For Finder folder navigation, prefer Cmd-Shift-G, type the exact absolute path, and press Enter. " +
      "Prefer the browser tool for ordinary web tasks. If the user explicitly requests Chrome, Safari, or another external browser App, " +
      "pin it here, copy one complete percent-encoded URL with printf '%s' '<URL>' | pbcopy, then use one computer batch: " +
      "CMD+L, CMD+V, RETURN, wait. Do not use AppleScript/osascript or shell open for external-browser navigation. " +
      "Provide an exact bundle identifier when known, otherwise a human app name. " +
      "The successful result pins the returned pid and window id to the authenticated " +
      "PipiUI session; later computer batches keep using that target even if PipiUI is frontmost.",
    parameters: Type.Object({
      bundle_identifier: Type.Optional(Type.String({
        description:
          "Exact installed macOS bundle identifier, such as com.google.Chrome.",
        pattern:
          "^[A-Za-z0-9][A-Za-z0-9-]*(?:\\.[A-Za-z0-9][A-Za-z0-9-]*)+$",
        maxLength: 255,
      })),
      application_name: Type.Optional(Type.String({
        description: "Human application name, such as TextEdit or Google Chrome.",
        minLength: 1,
        maxLength: 255,
      })),
    }, {
      additionalProperties: false,
    }),
    async execute(_id, params, signal) {
      const bundleIdentifier = (params as any).bundle_identifier;
      const applicationName = (params as any).application_name;
      if (
        (typeof bundleIdentifier !== "string" || bundleIdentifier.length === 0)
        && (typeof applicationName !== "string" || applicationName.length === 0)
      ) {
        throw new Error("open_application requires bundle_identifier or application_name");
      }
      const result = await openApplicationBridge({
        ...(typeof bundleIdentifier === "string" ? { bundle_identifier: bundleIdentifier } : {}),
        ...(typeof applicationName === "string" ? { application_name: applicationName } : {}),
      }, signal);
      const accessibility = compactAccessibility(result.accessibility);
      const metadata = {
        openedApplication: result.openedApplication === true,
        foregroundApp: result.foregroundApp,
        windowTitle: result.windowTitle,
        displayID: result.displayID,
        width: result.width,
        height: result.height,
        target: result.target,
        screenshotTarget: result.screenshotTarget,
        ...(result.screenshot ? { screenshot: result.screenshot } : {}),
        ...(result.outcomes ? { outcomes: result.outcomes } : {}),
        ...(accessibility ? { accessibility } : {}),
      };
      return screenshotToolResult(result, metadata);
    },
  });

  pi.registerTool({
    name: "computer",
    label: "Computer",
    description:
      "Operate this session's pinned macOS app window through the embedded Cua Driver. " +
      "Call open_application first to pin the exact app window; PipiUI becoming frontmost never steals that target. " +
      "Routing ladder: open_application for launch or activation, then element_index/element_token AX actions or " +
      "keyboard shortcuts, and pixel coordinates only as the last resort; never shell open. " +
      "Coordinates are in the pixel space of the LATEST returned screenshot (see the `screenshot` metadata block " +
      "for its dims); the host bounds-checks and maps them back to driver pixels, so never rescale them yourself. " +
      "Batch discipline: put one coherent deterministic sequence into ONE actions[] batch (e.g. click field + type + Enter); " +
      "the batch stops at the first failure and `outcomes` marks every skipped tail action not_executed, so split " +
      "only at genuine decision points. " +
      "Failure discipline: never retry the same coordinate or element token after stale_snapshot or " +
      "coordinate_out_of_bounds — re-observe with one screenshot action and replan; after two failed verified " +
      "attempts, switch mode (AX/keyboard instead of pixels) or stop and ask. " +
      "Prefer the browser tool for ordinary web tasks; for an explicitly requested external browser, pin it with " +
      "open_application, put the URL on the clipboard via printf '%s' '<URL>' | pbcopy, then send one batch: " +
      "CMD+L, CMD+V, RETURN, wait — never open/osascript for navigation. " +
      "Use wait only to let the UI settle (duration at most 10s, duration_ms at most 10000); " +
      "scroll_amount is 1-50, so scroll in small steps and re-observe.",
    // `action` plus single-action fields remain optional so Anthropic's official
    // schema can dispatch into the same executor after the provider-side replacement.
    parameters: Type.Object({
      actions: Type.Optional(Type.Array(ActionSchema, {
        description: "Ordered batch of desktop actions (preferred for custom providers).",
        maxItems: 64,
      })),
      action: Type.Optional(ActionTypeSchema),
      coordinate: Type.Optional(CoordinateSchema),
      x: Type.Optional(Type.Number()),
      y: Type.Optional(Type.Number()),
      start_coordinate: Type.Optional(CoordinateSchema),
      text: Type.Optional(Type.String()),
      keys: Type.Optional(Type.Array(Type.String())),
      scroll_direction: Type.Optional(Type.String()),
      scroll_amount: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
      duration: Type.Optional(Type.Number({ minimum: 0, maximum: 10 })),
      duration_ms: Type.Optional(Type.Number({ minimum: 0, maximum: 10_000 })),
      element_index: Type.Optional(Type.Number()),
      element_token: Type.Optional(Type.String()),
      delivery_mode: Type.Optional(Type.Union([
        Type.Literal("background"),
        Type.Literal("foreground"),
      ])),
    }),
    async execute(_id, params, signal) {
      const actions = normalizeActions(params as any);
      if (actions.length === 0) {
        throw new Error("computer requires a non-empty actions batch or Anthropic action");
      }
      const result = await bridge(actions, signal);
      const accessibility = compactAccessibility(result.accessibility);
      const metadata = {
        batchOK: result.batchOK,
        outcomes: result.outcomes,
        foregroundApp: result.foregroundApp,
        windowTitle: result.windowTitle,
        displayID: result.displayID,
        width: result.width,
        height: result.height,
        focusDrift: result.focusDrift,
        target: result.target,
        screenshotTarget: result.screenshotTarget,
        ...(result.screenshot ? { screenshot: result.screenshot } : {}),
        ...(accessibility ? { accessibility } : {}),
        ...(result.batchError ? { batchError: result.batchError } : {}),
      };
      return screenshotToolResult(result, metadata);
    },
  });

  // Pi persists toolResult messages to JSONL. Keep only an opaque marker in agent
  // state/session history, then prune evicted inline images and inject the
  // retained PNGs into the cloned provider context. This gives every provider a
  // normal image tool result without writing screenshot bytes to disk or letting
  // old screenshots accumulate. Markers from a restarted session simply have no
  // in-memory image.
  pi.on("context", (event) => ({
    messages: injectInMemoryScreenshots(event.messages as any[]),
  }));

  pi.on("before_provider_request", (event, ctx) => {
    if (
      !isAnthropicComputer20251124Model(ctx.model)
      || !isRecord(event.payload)
    ) return;
    const payload = event.payload as Record<string, unknown>;
    return {
      ...payload,
      tools: replaceComputerTool(payload.tools),
    };
  });

  pi.on("before_provider_headers", (event, ctx) => {
    if (!isAnthropicComputer20251124Model(ctx.model)) return;
    const existingKey = Object.keys(event.headers).find(
      (key) => key.toLowerCase() === "anthropic-beta",
    );
    const key = existingKey || "anthropic-beta";
    event.headers[key] = mergeBeta(
      event.headers[key],
      "computer-use-2025-11-24",
    );
  });
}
