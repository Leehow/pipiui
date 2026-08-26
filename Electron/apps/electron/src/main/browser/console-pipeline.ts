/**
 * Console pipeline: page console traffic is attributed to the pane's committed
 * owner tab, buffered for tool-side queries, and the noisy levels fan out as
 * panel notices.
 */
import type { BrowserConsoleEntry } from '@pipi/host-api/browser'
import { randomBytes } from 'node:crypto'
import type { TabConsoleBuffer } from '../browser-debug.js'
import type { BrowserSpaceEvent, BrowserWebContentsLike, ViewPane } from './types.js'

/**
 * Electron has no main-process JS-dialog event, so page dialogs are surfaced
 * through the console pipe: a page-world wrapper (installed after every
 * document commit) logs one marker line right before calling the original
 * window.alert/confirm/prompt. The marker is re-emitted as a `js-dialog`
 * event and never reaches the agent-visible console buffer.
 */
const JS_DIALOG_MARKER = '__pipiui_js_dialog__'

/** Fresh unguessable nonce for one document commit's dialog hook. */
export function newDialogNonce(): string {
  return randomBytes(16).toString('hex')
}

export function buildJsDialogHookSource(nonce: string): string {
  const marker = `${JS_DIALOG_MARKER} ${nonce}`
  return "(() => { try { if (window.__pipiuiDialogHook) return; window.__pipiuiDialogHook = true; " +
    `const report = (kind, first) => { try { console.error('${marker} ' + kind + ' ' + String(first == null ? '' : first)) } catch {} }; ` +
    "for (const kind of ['alert', 'confirm', 'prompt']) { const original = window[kind]; " +
    "try { Object.defineProperty(window, kind, { configurable: true, writable: true, value: function (...args) { " +
    "report(kind, args[0]); return typeof original === 'function' ? original.apply(window, args) : kind === 'confirm' ? false : kind === 'prompt' ? null : undefined } }) } catch {} } " +
    "} catch {} })()"
}

/** Live host state the console listener reads at event time. */
export type ConsolePipelineDeps = {
  /** Owner tab of the pane's currently committed main-frame document. */
  ownerTabId: () => string | undefined
  /** URL fallback when the emitting webContents cannot report one. */
  fallbackUrl: () => string | undefined
  /** Tool-side per-tab console buffer. */
  buffer: TabConsoleBuffer
  /** Panel notice fan-out (console / js-dialog events). */
  onNotice: (event: BrowserSpaceEvent) => void
  /** Validates a dialog marker's per-commit nonce; stale or absent nonces mark the line as forged page output. */
  isValidDialogNonce: (nonce: string) => boolean
}

export function createConsoleEntryListener(pane: ViewPane, contents: BrowserWebContentsLike, deps: ConsolePipelineDeps): (...args: any[]) => void {
  return (...args: any[]) => {
    // Ownership is per viewport: the mobile pane may still be mid-commit while
    // the desktop document has already committed, and each pane's console
    // traffic attributes to its own committed owner tab.
    const tabId = deps.ownerTabId()
    if (!tabId) return
    const first = args[0]
    const details = first && typeof first === 'object' && ('message' in first || 'level' in first) ? first : undefined
    const levelRaw = details?.level ?? args[1]
    const messageRaw = details?.message ?? args[2]
    const lineRaw = details?.lineNumber ?? details?.line ?? args[3]
    const sourceRaw = details?.sourceId ?? args[4]
    const level = typeof levelRaw === 'number'
      ? (levelRaw >= 3 ? 'error' : levelRaw === 2 ? 'warn' : levelRaw === 1 ? 'info' : 'log')
      : String(levelRaw || 'log')
    const entry: BrowserConsoleEntry = {
      timestamp: Date.now(),
      level,
      message: String(messageRaw ?? ''),
      sourceId: sourceRaw != null ? String(sourceRaw) : undefined,
      line: typeof lineRaw === 'number' ? lineRaw : undefined,
      url: contents.getURL?.() || deps.fallbackUrl(),
      tabId,
    }
    // The nonce must validate before the js-dialog event fires, so forged
    // lines stay ordinary console output instead of fabricated dialogs.
    if (entry.message.startsWith(JS_DIALOG_MARKER)) {
      const rest = entry.message.slice(JS_DIALOG_MARKER.length).trim()
      const nonceSpace = rest.indexOf(' ')
      if (nonceSpace > 0) {
        const nonce = rest.slice(0, nonceSpace)
        const afterNonce = rest.slice(nonceSpace + 1)
        const kindSpace = afterNonce.indexOf(' ')
        const kind = kindSpace < 0 ? afterNonce : afterNonce.slice(0, kindSpace)
        if ((kind === 'alert' || kind === 'confirm' || kind === 'prompt') && deps.isValidDialogNonce(nonce)) {
          deps.onNotice({ type: 'js-dialog', kind, message: kindSpace < 0 ? '' : afterNonce.slice(kindSpace + 1), url: entry.url })
          return
        }
      }
    }
    deps.buffer.push({ ...entry, tabId })
    // Only noisy levels cross IPC; info/log stay in the tool-side buffer.
    if (level === 'error' || level === 'warn') deps.onNotice({ type: 'console', entry })
  }
}

/** Best-effort page-world dialog reporter; re-installed after every commit. */
export function installJsDialogReporter(contents: BrowserWebContentsLike, nonce: string): void {
  const execute = contents.executeJavaScript
  if (!execute) return
  try {
    void Promise.resolve(execute.call(contents, buildJsDialogHookSource(nonce))).catch(() => undefined)
  } catch {
    // Visibility hook only: a failed install leaves dialogs unreported, never blocked.
  }
}
