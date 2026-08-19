/** Page-script / wait / console helpers for the built-in browser. Keep this module Electron-free. */

export const BROWSER_DEBUG_SCHEMA_VERSION = 1
export const BROWSER_SCRIPT_MAX_INPUT = 100_000
export const BROWSER_DEBUG_MAX_OUTPUT = 20_000
export const BROWSER_SCRIPT_DEADLINE_MS = 25_000
export const BROWSER_WAIT_DEFAULT_MS = 5_000
export const BROWSER_WAIT_MAX_MS = 25_000
export const BROWSER_CONSOLE_BUFFER = 500
export const BROWSER_CONSOLE_QUERY_CAP = 200
export const BROWSER_CONSOLE_MESSAGE_MAX = 4_000
export const BROWSER_SCRIPT_STEP_CAP = 100

export const BROWSER_HOST_TOOL_ACTIONS = [
  'navigate',
  'observe',
  'wait',
  'click',
  'input',
  'type',
  'select',
  'scroll',
  'content',
  'eval',
  'script',
  'console',
  'screenshot',
  'back',
  'forward',
  'reload',
] as const

export type BrowserDebugErrorCode =
  | 'timeout'
  | 'cancelled'
  | 'script_error'
  | 'stale_snapshot'
  | 'navigation_interrupted'
  | 'view_recreated'
  | 'result_not_serializable'
  | 'unsupported_result'
  | 'invalid_input'
  | 'page_unavailable'
  | 'unknown_action'

export type BrowserDebugEnvelope = {
  schemaVersion: number
  ok: boolean
  requestId: string
  action: string
  tabId?: string
  url?: string
  elapsedMs: number
  error?: string
  code?: string
  stack?: string
  line?: number
  column?: number
  lastStep?: string
  steps?: Array<{ label: string; t: number }>
  consoleTail?: unknown[]
  truncated?: boolean
  [key: string]: unknown
}

export function requestIdOf(request: { requestID?: unknown; requestId?: unknown }): string {
  if (typeof request.requestID === 'string' && request.requestID) return request.requestID
  if (typeof request.requestId === 'string' && request.requestId) return request.requestId
  return `br-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function shouldOpenBrowserDevTools(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PIPIUI_BROWSER_DEVTOOLS === '1'
}

export function clampWaitTimeoutMs(timeoutSeconds: unknown): number {
  const seconds = typeof timeoutSeconds === 'number' && Number.isFinite(timeoutSeconds) ? timeoutSeconds : 5
  const ms = seconds * 1000
  return Math.min(BROWSER_WAIT_MAX_MS, Math.max(50, ms))
}

export function utf16Length(value: string): number {
  return value.length
}

export function truncateUtf16(value: string, max: number): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false }
  return { text: value.slice(0, max), truncated: true }
}

export function remapScriptStack(stack: string, sourceURL: string, headerLines: number): { stack: string; line?: number; column?: number } {
  if (!stack || !sourceURL) return { stack }
  const escaped = sourceURL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${escaped}:(\\d+)(?::(\\d+))?`)
  let line: number | undefined
  let column: number | undefined
  const rewritten = stack.split('\n').map(row => {
    const match = row.match(re)
    if (!match) return row
    const rawLine = Number(match[1])
    const rawCol = match[2] ? Number(match[2]) : undefined
    const userLine = rawLine - headerLines
    if (userLine >= 1) {
      if (line === undefined) {
        line = userLine
        column = rawCol
      }
      return row.replace(re, `${sourceURL}:${userLine}${rawCol != null ? `:${rawCol}` : ''}`)
    }
    return row
  }).join('\n')
  return { stack: rewritten, line, column }
}

/** Page-world safe JSON-ish clone. Also used by host tests via new Function. */
export const PAGE_SAFE_SERIALIZE_SOURCE = `function __pipiSafeSerialize(value, budget) {
  const max = typeof budget === "number" ? budget : ${BROWSER_DEBUG_MAX_OUTPUT};
  const seen = typeof WeakSet === "function" ? new WeakSet() : null;
  function walk(v, depth) {
    if (v === undefined) return { __t: "undefined" };
    if (typeof v === "bigint") return { __t: "bigint", v: String(v) };
    if (typeof v === "symbol") return { __t: "symbol", v: String(v) };
    if (typeof v === "function") return { __t: "function", name: v.name || "anonymous" };
    if (typeof v === "number") {
      if (Number.isNaN(v) || !Number.isFinite(v)) return { __t: "number", v: String(v) };
      return v;
    }
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof Node !== "undefined" && v instanceof Node) {
      return { __t: "node", nodeName: v.nodeName, nodeType: v.nodeType };
    }
    if (typeof Error !== "undefined" && v instanceof Error) {
      return { __t: "error", name: v.name, message: v.message, stack: typeof v.stack === "string" ? v.stack.slice(0, 4000) : undefined };
    }
    if (typeof v === "object") {
      if (seen) {
        if (seen.has(v)) return { __t: "circular" };
        seen.add(v);
      }
      if (Array.isArray(v)) {
        if (depth > 8) return { __t: "truncated" };
        return v.slice(0, 100).map(function (item) { return walk(item, depth + 1); });
      }
      const out = {};
      const keys = Object.keys(v).slice(0, 80);
      for (let i = 0; i < keys.length; i++) out[keys[i]] = walk(v[keys[i]], depth + 1);
      return out;
    }
    return { __t: "unsupported", type: typeof v };
  }
  try {
    const cloned = walk(value, 0);
    let text = JSON.stringify(cloned);
    if (typeof text !== "string") return { ok: false, code: "result_not_serializable", error: "script result could not be JSON.stringified" };
    let truncated = false;
    if (text.length > max) {
      text = text.slice(0, max);
      truncated = true;
    }
    return { ok: true, json: text, truncated: truncated };
  } catch (error) {
    return { ok: false, code: "result_not_serializable", error: error && error.message ? String(error.message) : "script result is not serializable" };
  }
}`

export function safeSerialize(value: unknown, budget = BROWSER_DEBUG_MAX_OUTPUT): { ok: true; json: string; truncated: boolean } | { ok: false; code: string; error: string } {
  const fn = new Function(`${PAGE_SAFE_SERIALIZE_SOURCE}; return __pipiSafeSerialize;`)() as (v: unknown, b?: number) => ReturnType<typeof safeSerialize>
  return fn(value, budget)
}

export function scriptSourceURL(requestId: string): string {
  return `pipiui-browser-script-${requestId}.js`
}

export function buildScriptWrapper(js: string, requestId: string, deadlineMs = BROWSER_SCRIPT_DEADLINE_MS): { source: string; sourceURL: string; headerLines: number } {
  const sourceURL = scriptSourceURL(requestId)
  const header = `(async function () {
  var __deadline = Date.now() + ${Math.max(1, deadlineMs)};
  var __timer = null;
  var __steps = [];
  function step(label) {
    if (__steps.length >= ${BROWSER_SCRIPT_STEP_CAP}) return;
    __steps.push({ label: String(label == null ? "" : label).slice(0, 200), t: Date.now() });
  }
  function el(token) {
    var api = globalThis.__pipiBrowserDOM;
    if (!api || typeof api.resolveElement !== "function") {
      var missing = new Error("element resolver is unavailable; observe again.");
      missing.code = "stale_snapshot";
      throw missing;
    }
    return api.resolveElement(token);
  }
  async function __pipiUser() {
`
  const headerLines = header.split('\n').length
  const source = `${header}${js}
  }
  try {
    var __timeout = new Promise(function (_, reject) {
      __timer = setTimeout(function () {
        var err = new Error("browser script timed out");
        err.code = "timeout";
        reject(err);
      }, Math.max(1, __deadline - Date.now()));
    });
    var raw = await Promise.race([__pipiUser(), __timeout]);
    ${PAGE_SAFE_SERIALIZE_SOURCE}
    var packed = __pipiSafeSerialize(raw, ${BROWSER_DEBUG_MAX_OUTPUT});
    if (!packed.ok) {
      return { ok: false, code: packed.code || "result_not_serializable", error: packed.error, steps: __steps, lastStep: __steps.length ? __steps[__steps.length - 1].label : undefined, partialSideEffects: true };
    }
    return { ok: true, resultJson: packed.json, truncated: packed.truncated === true, steps: __steps, lastStep: __steps.length ? __steps[__steps.length - 1].label : undefined };
  } catch (error) {
    var stack = error && error.stack ? String(error.stack) : "";
    var code = error && error.code ? String(error.code) : "script_error";
    if (code === "stale_browser_snapshot") code = "stale_snapshot";
    return {
      ok: false,
      code: code,
      error: error && error.message ? String(error.message) : String(error),
      stack: stack,
      sourceURL: ${JSON.stringify(sourceURL)},
      headerLines: ${headerLines},
      steps: __steps,
      lastStep: __steps.length ? __steps[__steps.length - 1].label : undefined,
      partialSideEffects: true
    };
  } finally {
    if (__timer) clearTimeout(__timer);
  }
})()
//# sourceURL=${sourceURL}
`
  return { source, sourceURL, headerLines }
}

const ENVELOPE_KEEP_KEYS = ['schemaVersion', 'ok', 'requestId', 'action', 'error', 'code', 'tabId', 'url', 'elapsedMs', 'truncated'] as const
const ENVELOPE_SHRINK_FIRST = ['result', 'resultJson', 'entries', 'logs', 'consoleTail', 'steps', 'stack', 'content', 'elements']

function jsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'string') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined') return undefined
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return { __t: 'circular' }
  seen.add(value)
  if (Array.isArray(value)) return value.map(item => jsonSafe(item, seen)).filter(item => item !== undefined)
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const next = jsonSafe(item, seen)
    if (next !== undefined) out[key] = next
  }
  return out
}

function jsonSize(value: unknown): number {
  try {
    return (JSON.stringify(value) ?? 'null').length
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

function shrinkJsonValue(value: unknown): { value: unknown; changed: boolean } {
  if (typeof value === 'string') {
    if (value.length <= 1) return { value: '', changed: value.length > 0 }
    return { value: value.slice(0, Math.ceil(value.length / 2)), changed: true }
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return { value, changed: false }
    return { value: value.slice(0, Math.max(0, Math.ceil(value.length / 2) - (value.length === 1 ? 1 : 0))), changed: true }
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj)
    if (keys.length === 0) return { value, changed: false }
    let best = keys[0]
    let bestSize = -1
    for (const key of keys) {
      const size = jsonSize(obj[key])
      if (size > bestSize) {
        best = key
        bestSize = size
      }
    }
    const inner = shrinkJsonValue(obj[best])
    if (inner.changed) {
      if (inner.value === '' || inner.value === undefined || (Array.isArray(inner.value) && inner.value.length === 0)) delete obj[best]
      else obj[best] = inner.value
      return { value: obj, changed: true }
    }
    delete obj[best]
    return { value: obj, changed: true }
  }
  return { value, changed: false }
}

export function truncateEnvelope(payload: Record<string, unknown>, max = BROWSER_DEBUG_MAX_OUTPUT): { value: Record<string, unknown>; truncated: boolean } {
  const safe = jsonSafe(payload) as Record<string, unknown>
  let text = ''
  try {
    text = JSON.stringify(safe) ?? ''
  } catch {
    text = ''
  }
  if (text.length <= max) return { value: safe, truncated: Boolean(safe.truncated) }

  const copy: Record<string, unknown> = { ...safe, truncated: true }
  const keep = new Set<string>(ENVELOPE_KEEP_KEYS)

  const dropOrShrink = (key: string) => {
    if (!(key in copy) || keep.has(key)) return false
    const current = copy[key]
    if (Array.isArray(current) && current.length > 1) {
      copy[key] = current.slice(-Math.max(1, Math.ceil(current.length / 2)))
      return true
    }
    const inner = shrinkJsonValue(current)
    if (inner.changed && inner.value !== '' && !(Array.isArray(inner.value) && inner.value.length === 0)) {
      copy[key] = inner.value
      return true
    }
    delete copy[key]
    return true
  }

  let guard = 0
  while (jsonSize(copy) > max && guard++ < 200) {
    let changed = false
    for (const key of ENVELOPE_SHRINK_FIRST) {
      if (jsonSize(copy) <= max) break
      if (dropOrShrink(key)) changed = true
    }
    if (jsonSize(copy) <= max) break
    const extras = Object.keys(copy).filter(key => !keep.has(key)).sort((a, b) => jsonSize(copy[b]) - jsonSize(copy[a]))
    if (extras.length) {
      dropOrShrink(extras[0])
      changed = true
    } else {
      for (const key of ['error', 'url', 'requestId', 'action', 'code']) {
        if (typeof copy[key] === 'string' && (copy[key] as string).length > 8) {
          copy[key] = (copy[key] as string).slice(0, Math.ceil((copy[key] as string).length / 2))
          changed = true
          break
        }
      }
    }
    if (!changed) break
  }

  if (jsonSize(copy) > max) {
    const minimal: Record<string, unknown> = {
      schemaVersion: copy.schemaVersion ?? 1,
      ok: copy.ok === true,
      requestId: typeof copy.requestId === 'string' ? copy.requestId.slice(0, 64) : '',
      action: typeof copy.action === 'string' ? copy.action.slice(0, 64) : '',
      truncated: true,
    }
    if (typeof copy.code === 'string') minimal.code = copy.code.slice(0, 64)
    if (typeof copy.error === 'string') minimal.error = copy.error.slice(0, 128)
    if (typeof copy.tabId === 'string') minimal.tabId = copy.tabId
    if (typeof copy.url === 'string') minimal.url = copy.url.slice(0, 256)
    if (typeof copy.elapsedMs === 'number') minimal.elapsedMs = copy.elapsedMs
    while (jsonSize(minimal) > max) {
      if (typeof minimal.error === 'string' && minimal.error.length) {
        minimal.error = minimal.error.slice(0, Math.max(0, minimal.error.length - 16))
        continue
      }
      if (typeof minimal.url === 'string' && minimal.url.length) {
        minimal.url = minimal.url.slice(0, Math.max(0, minimal.url.length - 16))
        continue
      }
      break
    }
    return { value: minimal, truncated: true }
  }
  return { value: copy, truncated: true }
}

export type ConsoleBufferEntry = {
  seq: number
  timestamp: number
  level: string
  message: string
  sourceId?: string
  line?: number
  url?: string
  tabId: string
}

export class TabConsoleBuffer {
  private readonly tabs = new Map<string, ConsoleBufferEntry[]>()
  private seq = 0
  private hooked = new WeakSet<object>()

  isHooked(contents: object): boolean {
    return this.hooked.has(contents)
  }

  markHooked(contents: object): void {
    this.hooked.add(contents)
  }

  clearAll(): void {
    this.tabs.clear()
  }

  clearTab(tabId: string): void {
    this.tabs.delete(tabId)
  }

  push(entry: Omit<ConsoleBufferEntry, 'seq'>): ConsoleBufferEntry {
    const full: ConsoleBufferEntry = {
      ...entry,
      seq: ++this.seq,
      message: entry.message.length > BROWSER_CONSOLE_MESSAGE_MAX ? entry.message.slice(0, BROWSER_CONSOLE_MESSAGE_MAX) : entry.message,
    }
    const list = this.tabs.get(entry.tabId) ?? []
    list.push(full)
    if (list.length > BROWSER_CONSOLE_BUFFER) list.splice(0, list.length - BROWSER_CONSOLE_BUFFER)
    this.tabs.set(entry.tabId, list)
    return full
  }

  query(tabId: string, options: { sinceSeq?: number; level?: string; limit?: number; clear?: boolean } = {}): { entries: ConsoleBufferEntry[]; truncated: boolean } {
    const all = this.tabs.get(tabId) ?? []
    const since = typeof options.sinceSeq === 'number' ? options.sinceSeq : 0
    const level = typeof options.level === 'string' && options.level ? options.level.toLowerCase() : ''
    let filtered = all.filter(item => item.seq > since && (!level || item.level.toLowerCase() === level))
    const limit = Math.min(BROWSER_CONSOLE_QUERY_CAP, Math.max(1, options.limit ?? BROWSER_CONSOLE_QUERY_CAP))
    const truncated = filtered.length > limit
    if (truncated) filtered = filtered.slice(filtered.length - limit)
    if (options.clear) this.tabs.set(tabId, [])
    return { entries: filtered, truncated }
  }

  tail(tabId: string, levels = ['error', 'warn'], max = 8): ConsoleBufferEntry[] {
    const all = this.tabs.get(tabId) ?? []
    const wanted = new Set(levels.map(item => item.toLowerCase()))
    return all.filter(item => wanted.has(item.level.toLowerCase())).slice(-max)
  }
}

export function formatConsoleLogs(entries: ConsoleBufferEntry[]): { logs: string[]; truncated: boolean } {
  const logs: string[] = []
  let used = 0
  let truncated = false
  for (const entry of entries) {
    const line = `[${entry.seq}] ${entry.level} ${entry.message}${entry.sourceId ? ` (${entry.sourceId}:${entry.line ?? 0})` : ''}`
    if (used + line.length > BROWSER_DEBUG_MAX_OUTPUT) {
      truncated = true
      break
    }
    logs.push(line)
    used += line.length + 1
  }
  return { logs, truncated }
}
