import { scrapeJSONString, scrapeJSONStringAll } from './tool-summary'

export function estimateTokens(charCount: number): number {
  if (charCount <= 0) return 0
  return Math.max(1, Math.round(charCount / 4))
}

/** Swift `ThinkingTokenEstimate.formatCount` — not `formatCompactTokens`. */
export function formatEstimateCount(n: number): string {
  if (n < 1000) return String(n)
  const raw = (n / 1000).toFixed(1)
  if (raw.endsWith('.0')) return `${raw.slice(0, -2)}k`
  return `${raw}k`
}

export function liveTokenLabel(charCount: number): string | undefined {
  const n = estimateTokens(charCount)
  if (n <= 0) return undefined
  return `~${formatEstimateCount(n)} tokens`
}

export type FileChangeTokenStats = {
  path: string
  payloadChars: number
  addedChars: number
  removedChars: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numericField(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function pathFrom(obj: Record<string, unknown>, raw: string): string {
  const path = obj.path ?? obj.file_path
  if (typeof path === 'string' && path) return path
  return scrapeJSONString('path', raw) ?? scrapeJSONString('file_path', raw) ?? '…'
}

function sumNewText(obj: Record<string, unknown>): number {
  if (Array.isArray(obj.edits)) {
    return obj.edits.reduce((sum, item) => {
      if (!isRecord(item) || typeof item.newText !== 'string') return sum
      return sum + item.newText.length
    }, 0)
  }
  return typeof obj.newText === 'string' ? obj.newText.length : 0
}

function sumOldText(obj: Record<string, unknown>): number {
  if (Array.isArray(obj.edits)) {
    return obj.edits.reduce((sum, item) => {
      if (!isRecord(item) || typeof item.oldText !== 'string') return sum
      return sum + item.oldText.length
    }, 0)
  }
  return typeof obj.oldText === 'string' ? obj.oldText.length : 0
}

export function fileChangeTokenStats(name: string, raw: string): FileChangeTokenStats | null {
  if (name !== 'write' && name !== 'edit') return null
  const trimmed = raw.trim()
  let parsed: Record<string, unknown> | undefined
  try {
    const value = JSON.parse(trimmed) as unknown
    if (isRecord(value)) parsed = value
  } catch {
    parsed = undefined
  }

  if (parsed) {
    const compactPayload = numericField(parsed, 'payloadChars')
    const compactAdded = numericField(parsed, 'addedChars')
    const compactRemoved = numericField(parsed, 'removedChars')
    if (compactPayload !== undefined || compactAdded !== undefined || compactRemoved !== undefined) {
      const payloadChars = compactPayload ?? compactAdded ?? 0
      return {
        path: pathFrom(parsed, trimmed),
        payloadChars,
        addedChars: compactAdded ?? payloadChars,
        removedChars: compactRemoved ?? 0,
      }
    }
    if (name === 'write') {
      const content = typeof parsed.content === 'string' ? parsed.content : ''
      return {
        path: pathFrom(parsed, trimmed),
        payloadChars: content.length,
        addedChars: content.length,
        removedChars: 0,
      }
    }
    const added = sumNewText(parsed)
    return {
      path: pathFrom(parsed, trimmed),
      payloadChars: added,
      addedChars: added,
      removedChars: sumOldText(parsed),
    }
  }

  const path = scrapeJSONString('path', trimmed) ?? scrapeJSONString('file_path', trimmed) ?? '…'
  if (name === 'write') {
    const content = scrapeJSONString('content', trimmed) ?? ''
    return { path, payloadChars: content.length, addedChars: content.length, removedChars: 0 }
  }
  const newParts = scrapeJSONStringAll('newText', trimmed)
  const oldParts = scrapeJSONStringAll('oldText', trimmed)
  const added = newParts.reduce((sum, part) => sum + part.length, 0)
  const removed = oldParts.reduce((sum, part) => sum + part.length, 0)
  return { path, payloadChars: added, addedChars: added, removedChars: removed }
}

export function fileChangeDeltaLabel(addedChars: number, removedChars: number): string | undefined {
  const added = estimateTokens(addedChars)
  const removed = estimateTokens(removedChars)
  const parts: string[] = []
  if (added > 0) parts.push(`+${formatEstimateCount(added)}`)
  if (removed > 0) parts.push(`\u2212${formatEstimateCount(removed)}`)
  return parts.length > 0 ? parts.join(' ') : undefined
}
