/**
 * Debug envelope assembly: every tool action resolves to a BrowserDebugEnvelope
 * carrying request identity, page context, elapsed budget, and (on failure) a
 * console tail. The envelope shape/truncation contract lives in browser-debug;
 * this module adds the host-page context half.
 */
import type { BrowserConsoleEntry } from '@pipi/host-api/browser'
import type { BrowserToolRequest } from '@pipi/host-api'
import {
  BROWSER_DEBUG_SCHEMA_VERSION,
  requestIdOf,
  truncateEnvelope,
  type BrowserDebugEnvelope,
} from '../browser-debug.js'

/** Page context folded into an envelope; all fields optional and undefined-safe. */
export type BrowserDebugEnvelopeContext = {
  tabId?: string
  url?: string
  consoleTail?: BrowserConsoleEntry[]
}

export function buildBrowserDebugEnvelope(
  request: BrowserToolRequest,
  context: BrowserDebugEnvelopeContext,
  extra: Record<string, unknown> = {},
  options?: { truncate?: boolean }
): BrowserDebugEnvelope {
  const requestId = requestIdOf(request as { requestID?: unknown; requestId?: unknown })
  const startedAt = typeof extra.startedAt === 'number' ? extra.startedAt : Date.now()
  const { startedAt: _s, ...rest } = extra
  const tabId = context.tabId
  const url = context.url
  const tail = rest.ok === false && tabId ? context.consoleTail : undefined
  const payload: BrowserDebugEnvelope = {
    schemaVersion: BROWSER_DEBUG_SCHEMA_VERSION,
    ok: rest.ok !== false,
    requestId,
    action: String(request.action || ''),
    tabId,
    url,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    ...(tail && tail.length ? { consoleTail: tail } : {}),
    ...rest,
  }
  if (options?.truncate === false) return payload
  const packed = truncateEnvelope(payload)
  if (packed.truncated) packed.value.truncated = true
  return packed.value as BrowserDebugEnvelope
}
