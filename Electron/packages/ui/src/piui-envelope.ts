const ENVELOPE_KEY = 'piui:v1'
const ENVELOPE_PREFIX = /^\s*\{\s*"piui:v1"\s*:/

export type PiuiV1ParseResult =
  | { kind: 'ok'; content: string; details: unknown }
  | { kind: 'none'; content: string }
  | { kind: 'invalid'; content: string }

export type ToolRenderPayload =
  | { fallback: true }
  | { fallback: false; content: string; details?: unknown }

/**
 * Parse a leading `{ "piui:v1": {…} }` envelope from tool_result content (spec D5).
 * Trailing prose after the JSON object becomes `content`; the envelope value is `details`.
 */
export function parsePiuiV1Envelope(raw: string | undefined | null): PiuiV1ParseResult {
  const content = stripBom(raw ?? '')
  if (!ENVELOPE_PREFIX.test(content)) return { kind: 'none', content: raw ?? '' }

  const extracted = extractLeadingJsonObject(content)
  if (!extracted || typeof extracted.value !== 'object' || extracted.value === null || Array.isArray(extracted.value)) {
    return { kind: 'invalid', content: raw ?? '' }
  }
  if (!Object.prototype.hasOwnProperty.call(extracted.value, ENVELOPE_KEY)) {
    return { kind: 'invalid', content: raw ?? '' }
  }
  return {
    kind: 'ok',
    content: extracted.rest.trim(),
    details: (extracted.value as Record<string, unknown>)[ENVELOPE_KEY],
  }
}

/** Dispatch payload: invalid envelope → default TranscriptToolCard; otherwise `{ content, details? }`. */
export function toToolRenderPayload(raw: string | undefined | null): ToolRenderPayload {
  const parsed = parsePiuiV1Envelope(raw)
  if (parsed.kind === 'invalid') return { fallback: true }
  if (parsed.kind === 'ok') return { fallback: false, content: parsed.content, details: parsed.details }
  return { fallback: false, content: parsed.content }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function extractLeadingJsonObject(text: string): { value: unknown; rest: string } | null {
  const start = text.search(/\S/)
  if (start < 0 || text[start] !== '{') return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return { value: JSON.parse(text.slice(start, i + 1)), rest: text.slice(i + 1) }
        } catch {
          return null
        }
      }
    }
  }
  return null
}
