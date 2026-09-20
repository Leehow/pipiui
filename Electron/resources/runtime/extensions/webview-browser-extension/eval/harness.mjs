/**
 * JSDOM host for the production browser DOM controller.
 * Layout shims exist so collect/observe/clickCenter can run; they are not a browser.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CONTROLLER_PATH = join(HERE, "../../../browser-dom/controller.js");

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const DEFAULT_BOX_W = 240;
const DEFAULT_BOX_H = 18;

export function loadJsdom(startDir = HERE) {
  let dir = startDir;
  while (true) {
    const electronPkg = join(dir, "package.json");
    if (existsSync(join(dir, "node_modules", "jsdom", "package.json")) && existsSync(electronPkg)) {
      return createRequire(electronPkg)("jsdom");
    }
    const nestedElectron = join(dir, "Electron", "package.json");
    if (existsSync(join(dir, "Electron", "node_modules", "jsdom", "package.json"))) {
      return createRequire(nestedElectron)("jsdom");
    }
    const uiPkg = join(dir, "packages", "ui", "package.json");
    if (existsSync(join(dir, "packages", "ui", "node_modules", "jsdom", "package.json"))) {
      return createRequire(uiPkg)("jsdom");
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "jsdom is not installed in this tree. This eval reuses the already-installed Electron jsdom and will not npm install.",
  );
}

let jsdomModule;
function jsdom() {
  if (!jsdomModule) jsdomModule = loadJsdom();
  return jsdomModule;
}

let controllerCache;
export function loadControllerSource() {
  if (controllerCache) return controllerCache;
  if (!existsSync(CONTROLLER_PATH)) {
    throw new Error(`production controller missing: ${CONTROLLER_PATH}`);
  }
  const source = readFileSync(CONTROLLER_PATH, "utf8");
  if (!source.includes("function observe(") || !source.includes("__pipiBrowserDOM")) {
    throw new Error("controller.js does not look like the production DOM controller");
  }
  controllerCache = {
    path: CONTROLLER_PATH,
    source,
    sha256: createHash("sha256").update(source).digest("hex"),
    bytes: Buffer.byteLength(source),
  };
  return controllerCache;
}

function toRect(box) {
  const x = box?.x || 0;
  const y = box?.y || 0;
  const width = box?.width || 0;
  const height = box?.height || 0;
  return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height };
}

function isShimHidden(el, view) {
  if (!el || el.nodeType !== 1) return true;
  if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true" || el.hasAttribute("inert")) return true;
  const style = view.getComputedStyle(el);
  if (!style) return true;
  if (style.display === "none" || style.visibility === "hidden") return true;
  if (style.opacity !== "" && Number(style.opacity) === 0) return true;
  return false;
}

function parseExplicitBox(el) {
  const raw = el.getAttribute("data-eval-box");
  if (!raw) return null;
  const parts = raw.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

function layoutNode(el, view, boxes, x, y, maxWidth) {
  if (isShimHidden(el, view)) {
    boxes.set(el, { x: 0, y: 0, width: 0, height: 0 });
    for (const child of el.children || []) layoutNode(child, view, boxes, 0, 0, maxWidth);
    return 0;
  }
  const explicit = parseExplicitBox(el);
  if (explicit) {
    boxes.set(el, explicit);
    let childY = explicit.y + 2;
    for (const child of el.children || []) {
      childY += layoutNode(child, view, boxes, explicit.x + 2, childY, Math.max(8, explicit.width - 4)) + 2;
    }
    if (el.localName === "iframe") layoutIframe(el, boxes);
    return explicit.height;
  }
  const width = Number(el.getAttribute("data-eval-w")) || Math.min(DEFAULT_BOX_W, maxWidth);
  const minH = Number(el.getAttribute("data-eval-h")) || DEFAULT_BOX_H;
  let childY = y + 2;
  let innerWidth = width;
  for (const child of el.children || []) {
    const used = layoutNode(child, view, boxes, x + 4, childY, Math.max(8, width - 8));
    childY += used + (used > 0 ? 2 : 0);
    const childBox = boxes.get(child);
    if (childBox && childBox.width > 0) innerWidth = Math.max(innerWidth, childBox.width + 8);
  }
  const height = Math.max(minH, childY - y);
  boxes.set(el, { x, y, width: innerWidth, height });
  if (el.localName === "iframe") layoutIframe(el, boxes);
  return height;
}

function layoutIframe(iframe, parentBoxes) {
  let childDoc;
  try {
    childDoc = iframe.contentDocument;
  } catch {
    return;
  }
  const childWindow = childDoc?.defaultView;
  if (!childDoc?.documentElement || !childWindow) return;
  const parentBox = parentBoxes.get(iframe) || { x: 0, y: 0, width: 320, height: 160 };
  installDomShims(childWindow, {
    width: Math.max(64, Math.round(parentBox.width) || 320),
    height: Math.max(64, Math.round(parentBox.height) || 160),
  });
  const childBoxes = childWindow.__pipiEvalLayout.boxes;
  layoutNode(childDoc.documentElement, childWindow, childBoxes, 0, 0, Math.max(64, parentBox.width));
}

export function installDomShims(view, viewport = DEFAULT_VIEWPORT) {
  const width = viewport.width || DEFAULT_VIEWPORT.width;
  const height = viewport.height || DEFAULT_VIEWPORT.height;
  if (view.__pipiEvalLayout) {
    view.__pipiEvalLayout.viewport = { width, height };
    return view.__pipiEvalLayout;
  }
  const boxes = new WeakMap();
  const layout = { boxes, viewport: { width, height } };

  Object.defineProperty(view, "innerWidth", {
    configurable: true,
    get: () => layout.viewport.width,
  });
  Object.defineProperty(view, "innerHeight", {
    configurable: true,
    get: () => layout.viewport.height,
  });

  view.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return toRect(boxes.get(this) || { x: 0, y: 0, width: 0, height: 0 });
  };
  view.Element.prototype.getClientRects = function getClientRects() {
    const rect = this.getBoundingClientRect();
    const list = [rect];
    list.item = (i) => list[i] || null;
    return list;
  };
  view.Element.prototype.checkVisibility = function checkVisibility() {
    if (isShimHidden(this, view)) return false;
    const rect = this.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  };
  view.Document.prototype.elementFromPoint = function elementFromPoint(px, py) {
    let hit = null;
    const walk = (node) => {
      if (!node || node.nodeType !== 1) return;
      const box = boxes.get(node);
      if (box && (box.width > 0 || box.height > 0)
        && px >= box.x && py >= box.y && px < box.x + box.width && py < box.y + box.height) {
        hit = node;
      }
      for (const child of node.children || []) walk(child);
    };
    walk(this.documentElement);
    return hit;
  };

  Object.defineProperty(view.HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get() {
      return boxes.get(this)?.width || 0;
    },
  });
  Object.defineProperty(view.HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return boxes.get(this)?.height || 0;
    },
  });

  view.__pipiEvalLayout = layout;
  return layout;
}

export function relayout(view) {
  const layout = view.__pipiEvalLayout;
  if (!layout) throw new Error("installDomShims before relayout");
  const root = view.document.documentElement;
  if (!root) return;
  layoutNode(root, view, layout.boxes, 0, 0, layout.viewport.width);
}

export function querySelectorDeep(view, selector) {
  if (!selector) return null;
  const top = view.document.querySelector(selector);
  if (top) return top;
  for (const iframe of view.document.querySelectorAll("iframe")) {
    try {
      const found = iframe.contentDocument?.querySelector(selector);
      if (found) return found;
    } catch {
      // cross-origin in fixtures is still a miss
    }
  }
  return null;
}

function silentVirtualConsole(JSDOM) {
  const virtualConsole = new JSDOM.VirtualConsole ? new JSDOM.VirtualConsole() : null;
  if (!virtualConsole) return undefined;
  virtualConsole.on("jsdomError", () => {});
  virtualConsole.on("error", () => {});
  virtualConsole.on("warn", () => {});
  return virtualConsole;
}

export function createSession(fixture, options = {}) {
  const { JSDOM, VirtualConsole } = jsdom();
  const viewport = {
    id: options.viewport?.id || fixture.viewport?.id || null,
    width: options.viewport?.width || fixture.viewport?.width || DEFAULT_VIEWPORT.width,
    height: options.viewport?.height || fixture.viewport?.height || DEFAULT_VIEWPORT.height,
  };
  const virtualConsole = VirtualConsole
    ? (() => {
      const console = new VirtualConsole();
      console.on("jsdomError", () => {});
      console.on("error", () => {});
      console.on("warn", () => {});
      return console;
    })()
    : silentVirtualConsole({ VirtualConsole });
  const url = options.url || fixture.url || `https://eval.pipiui.test/${fixture.id || "case"}`;
  const dom = new JSDOM(fixture.html, {
    url,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const view = dom.window;
  if (typeof fixture.init === "function") fixture.init(view, { ...options, viewport, fixture });
  installDomShims(view, viewport);
  for (const iframe of view.document.querySelectorAll("iframe")) {
    try {
      if (iframe.contentWindow) installDomShims(iframe.contentWindow, viewport);
    } catch {
      // ignore
    }
  }
  relayout(view);

  const controller = loadControllerSource();
  const prelude = `if(!globalThis.__pipiBrowserDOM){${controller.source}}\n`;
  view.eval(prelude);
  if (!view.__pipiBrowserDOM || typeof view.__pipiBrowserDOM.dispatch !== "function") {
    destroySession({ dom });
    throw new Error("controller.js did not publish __pipiBrowserDOM.dispatch");
  }
  return {
    id: fixture.id,
    fixture,
    viewport,
    url,
    dom,
    window: view,
    controller,
  };
}

export function destroySession(session) {
  try {
    session.window?.eval?.(`globalThis.__pipiBrowserDOM && globalThis.__pipiBrowserDOM.dispatch(${JSON.stringify({ action: "clear" })})`);
  } catch {
    // ignore
  }
  try {
    session.window?.close?.();
  } catch {
    // ignore
  }
  session.window = null;
  session.dom = null;
}

export function resetSession(session, options = {}) {
  const fixture = session.fixture;
  destroySession(session);
  return createSession(fixture, { ...options, viewport: session.viewport, url: session.url });
}

export function evalDispatch(session, params) {
  const json = JSON.stringify(params);
  return session.window.eval(`globalThis.__pipiBrowserDOM.dispatch(${json})`);
}

export function dispatchObserve(session, query = {}) {
  const params = {
    action: "observe",
    scope: query.scope || "viewport",
    ...(typeof query.region === "string" ? { region: query.region } : {}),
    ...(typeof query.role === "string" ? { role: query.role } : {}),
    ...(typeof query.name === "string" ? { name: query.name } : {}),
    ...(query.cursor !== undefined && query.cursor !== null ? { cursor: query.cursor } : {}),
  };
  // Intent is intentionally not sent in baseline A. Callers for B may pass it
  // once the product understands it; this helper still forwards unknown keys
  // only when explicitly requested so A cannot accidentally grow a stub path.
  if (query.includeIntent && typeof query.intent === "string") params.intent = query.intent;
  return evalDispatch(session, params);
}

export function dispatchAction(session, params) {
  return evalDispatch(session, params);
}

export function resolveShownNodes(session, envelope) {
  const tokens = [];
  for (const element of envelope?.elements || []) {
    if (element && typeof element.token === "string") tokens.push(element.token);
  }
  for (const region of envelope?.regions || []) {
    for (const preview of region?.preview || []) {
      if (preview && typeof preview.token === "string" && !tokens.includes(preview.token)) {
        tokens.push(preview.token);
      }
    }
  }
  const nodes = [];
  for (const token of tokens) {
    try {
      nodes.push({ token, node: session.window.__pipiBrowserDOM.resolveElement(token) });
    } catch {
      nodes.push({ token, node: null, unresolved: true });
    }
  }
  return nodes;
}
