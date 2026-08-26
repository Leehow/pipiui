/**
 * DOM bridge dispatch: request shaping for the page-world DOM controller.
 * Snapshots/element tokens are namespaced per viewport (`desktop:`/`mobile:`)
 * before crossing the bridge and re-tagged on the way out; the controller
 * source prelude guarantees `globalThis.__pipiBrowserDOM` exists.
 */
import browserDOMControllerSource from '../../../../../resources/runtime/browser-dom/controller.js?raw'
import type { BrowserToolRequest, BrowserToolResult } from '@pipi/host-api'
import type { BrowserViewportKind } from './types.js'
import { parseBrowserSnapshotTarget, tagBrowserSnapshotId } from './viewport.js'

export function requestTarget(request: BrowserToolRequest): unknown {
  return (request as BrowserToolRequest & { target?: unknown }).target
}

export function requestElementToken(request: BrowserToolRequest): string | undefined {
  const token = (request as BrowserToolRequest & { element_token?: unknown }).element_token
  return typeof token === 'string' ? token : undefined
}

export function hasStructuredLocator(request: BrowserToolRequest): boolean {
  const locator = (request as BrowserToolRequest & { locator?: unknown }).locator
  return Boolean(locator) && typeof locator === 'object' && !Array.isArray(locator)
}

export function untaggedRequest(request: Record<string, unknown>, kind: BrowserViewportKind): Record<string, unknown> {
  const snapshot = parseBrowserSnapshotTarget(typeof request.snapshot_id === 'string' ? request.snapshot_id : undefined)
  const token = parseBrowserSnapshotTarget(typeof request.element_token === 'string' ? request.element_token : undefined)
  const next = { ...request }
  if (snapshot.kind === kind) next.snapshot_id = snapshot.id
  if (token.kind === kind) next.element_token = token.id
  if (Array.isArray(request.fields)) {
    next.fields = request.fields.map(field => {
      if (!field || typeof field !== 'object') return field
      const record = field as Record<string, unknown>
      const fieldToken = parseBrowserSnapshotTarget(typeof record.element_token === 'string' ? record.element_token : undefined)
      return fieldToken.kind === kind ? { ...record, element_token: fieldToken.id } : field
    })
  }
  return next
}

export function tagObservationTokens(value: unknown, kind: BrowserViewportKind): unknown {
  if (Array.isArray(value)) return value.map(item => tagObservationTokens(item, kind))
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const next: Record<string, unknown> = { ...record }
  if (typeof next.token === 'string') next.token = tagBrowserSnapshotId(next.token, kind)
  if (Array.isArray(next.elements)) next.elements = tagObservationTokens(next.elements, kind) as unknown[]
  if (Array.isArray(next.preview)) next.preview = tagObservationTokens(next.preview, kind) as unknown[]
  if (Array.isArray(next.regions)) next.regions = tagObservationTokens(next.regions, kind) as unknown[]
  return next
}

export function observePayload(request: Record<string, unknown> | { scope?: string }): Record<string, unknown> {
  const record = request as Record<string, unknown>
  return {
    action: 'observe',
    scope: typeof record.scope === 'string' ? record.scope : 'viewport',
    ...(typeof record.region === 'string' ? { region: record.region } : {}),
    ...(typeof record.role === 'string' ? { role: record.role } : {}),
    ...(typeof record.name === 'string' ? { name: record.name } : {}),
    ...(record.cursor !== undefined && record.cursor !== null ? { cursor: record.cursor } : {}),
  }
}

export function tagObservation(result: BrowserToolResult, kind: BrowserViewportKind): BrowserToolResult {
  const tagged = tagObservationTokens(result, kind) as BrowserToolResult
  const snapshotID = typeof tagged.snapshotID === 'string' ? tagBrowserSnapshotId(tagged.snapshotID, kind) : tagged.snapshotID
  return { ...tagged, snapshotID, viewportTarget: kind }
}

export function controllerPrelude(): string {
  return `if(!globalThis.__pipiBrowserDOM||typeof globalThis.__pipiBrowserDOM.resolveElement!=="function"){${browserDOMControllerSource}}\n`
}
