/**
 * Redaction: every tool result that bypasses the structured DOM controller
 * (eval/script/content/selector paths) is sanitized through the page-world
 * controller before it leaves the host, and capacity exhaustion becomes a
 * structured, reloadable error instead of a leaked payload.
 */
import type { BrowserToolResult } from '@pipi/host-api'
import { controllerPrelude } from './dom-bridge.js'
import type { BrowserViewportKind, ViewPane } from './types.js'

export function redactionClosed(kind: BrowserViewportKind): BrowserToolResult {
  return {
    ok: false,
    error: 'browser redaction capacity exceeded; reload the document before continuing',
    code: 'browser_redaction_capacity_exceeded',
    requiresObservation: true,
    redacted: true,
    viewportTarget: kind,
  }
}

export async function sanitizeWithController(pane: ViewPane, kind: BrowserViewportKind, payload: BrowserToolResult): Promise<BrowserToolResult> {
  const execute = pane.view?.webContents.executeJavaScript
  if (!execute) return redactionClosed(kind)
  let serialized: string
  try {
    serialized = JSON.stringify({ action: 'sanitize', value: payload })
  } catch {
    return redactionClosed(kind)
  }
  const source = `${controllerPrelude()}globalThis.__pipiBrowserDOM.dispatch(${serialized})`
  try {
    const sanitized = await execute.call(pane.view!.webContents, source)
    if (!sanitized || typeof sanitized !== 'object') return redactionClosed(kind)
    const result = sanitized as BrowserToolResult
    return result.viewportTarget == null ? { ...result, viewportTarget: kind } : result
  } catch {
    return redactionClosed(kind)
  }
}
