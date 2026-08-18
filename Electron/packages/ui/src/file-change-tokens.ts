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
  addedLines?: number
  removedLines?: number
}

const LINE_DIFF_INPUT_LIMIT = 4000

export function logicalLines(text: string): string[] {
  if (!text) return []
  const lines = text.split('\n')
  if (text.endsWith('\n')) lines.pop()
  return lines
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function lcsLength(oldLines: string[], newLines: string[]): number {
  const n = oldLines.length
  const m = newLines.length
  let prev = new Array<number>(m + 1).fill(0)
  let curr = new Array<number>(m + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      curr[j] = oldLines[i - 1] === newLines[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, curr[j - 1]!)
    }
    const swap = prev
    prev = curr
    curr = swap
    curr.fill(0)
  }
  return prev[m]!
}

export function hunkLineCounts(oldText: string, newText: string): { added: number; removed: number } {
  const oldL = logicalLines(oldText)
  const newL = logicalLines(newText)
  if (arraysEqual(oldL, newL)) return { added: 0, removed: 0 }
  if (oldL.length + newL.length > LINE_DIFF_INPUT_LIMIT) {
    return { added: newL.length, removed: oldL.length }
  }
  const lcs = lcsLength(oldL, newL)
  return { added: newL.length - lcs, removed: oldL.length - lcs }
}

function editLineTotalsFromArgs(obj: Record<string, unknown>): { added: number; removed: number } {
  const hunks: { oldText: string; newText: string }[] = []
  if (Array.isArray(obj.edits)) {
    for (const item of obj.edits) {
      if (!isRecord(item) || typeof item.oldText !== 'string' || typeof item.newText !== 'string') continue
      hunks.push({ oldText: item.oldText, newText: item.newText })
    }
  }
  if (hunks.length === 0 && typeof obj.oldText === 'string' && typeof obj.newText === 'string') {
    hunks.push({ oldText: obj.oldText, newText: obj.newText })
  }
  let added = 0
  let removed = 0
  for (const hunk of hunks) {
    const counts = hunkLineCounts(hunk.oldText, hunk.newText)
    added += counts.added
    removed += counts.removed
  }
  return { added, removed }
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
      const addedLines = numericField(parsed, 'addedLines')
      const removedLines = numericField(parsed, 'removedLines')
      return {
        path: pathFrom(parsed, trimmed),
        payloadChars,
        addedChars: compactAdded ?? payloadChars,
        removedChars: compactRemoved ?? 0,
        ...(addedLines !== undefined || removedLines !== undefined
          ? { addedLines: addedLines ?? 0, removedLines: removedLines ?? 0 }
          : {}),
      }
    }
    if (name === 'write') {
      const content = typeof parsed.content === 'string' ? parsed.content : ''
      return {
        path: pathFrom(parsed, trimmed),
        payloadChars: content.length,
        addedChars: content.length,
        removedChars: 0,
        addedLines: logicalLines(content).length,
        removedLines: 0,
      }
    }
    const added = sumNewText(parsed)
    const lines = editLineTotalsFromArgs(parsed)
    return {
      path: pathFrom(parsed, trimmed),
      payloadChars: added,
      addedChars: added,
      removedChars: sumOldText(parsed),
      addedLines: lines.added,
      removedLines: lines.removed,
    }
  }

  const path = scrapeJSONString('path', trimmed) ?? scrapeJSONString('file_path', trimmed) ?? '…'
  if (name === 'write') {
    const content = scrapeJSONString('content', trimmed) ?? ''
    return {
      path,
      payloadChars: content.length,
      addedChars: content.length,
      removedChars: 0,
      addedLines: logicalLines(content).length,
      removedLines: 0,
    }
  }
  const newParts = scrapeJSONStringAll('newText', trimmed)
  const oldParts = scrapeJSONStringAll('oldText', trimmed)
  const added = newParts.reduce((sum, part) => sum + part.length, 0)
  const removed = oldParts.reduce((sum, part) => sum + part.length, 0)
  const pairCount = Math.min(oldParts.length, newParts.length)
  let addedLines = 0
  let removedLines = 0
  for (let i = 0; i < pairCount; i++) {
    const counts = hunkLineCounts(oldParts[i]!, newParts[i]!)
    addedLines += counts.added
    removedLines += counts.removed
  }
  return { path, payloadChars: added, addedChars: added, removedChars: removed, addedLines, removedLines }
}

export function fileChangeDeltaLabel(addedChars: number, removedChars: number): string | undefined {
  const added = estimateTokens(addedChars)
  const removed = estimateTokens(removedChars)
  const parts: string[] = []
  if (added > 0) parts.push(`+${formatEstimateCount(added)}`)
  if (removed > 0) parts.push(`\u2212${formatEstimateCount(removed)}`)
  return parts.length > 0 ? parts.join(' ') : undefined
}

export function fileChangeLineDeltaLabel(addedLines: number, removedLines: number): string | undefined {
  const parts: string[] = []
  if (addedLines > 0) parts.push(`+${formatEstimateCount(addedLines)}`)
  if (removedLines > 0) parts.push(`\u2212${formatEstimateCount(removedLines)}`)
  return parts.length > 0 ? parts.join(' ') : undefined
}

export function finishedFileChangeDeltaLabel(stats: FileChangeTokenStats): string | undefined {
  if (stats.addedLines !== undefined || stats.removedLines !== undefined) {
    return fileChangeLineDeltaLabel(stats.addedLines ?? 0, stats.removedLines ?? 0)
  }
  return fileChangeDeltaLabel(stats.addedChars, stats.removedChars)
}
