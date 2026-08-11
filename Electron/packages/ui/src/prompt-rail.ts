/**
 * User-prompt navigation rail projection.
 *
 * Mirrors Swift `MessageActions.isNavigationEligibleHumanPrompt` +
 * `UserPromptIndex` semantics: rail items must come from *real human user
 * input* only. Runtime/system injections that reuse the user role (subagent
 * heartbeats / done / stalled / interrupted-reminder, worktree + post-merge
 * notifications, session sentinels, git status snapshots, delivery wrappers)
 * are excluded, as are every non-user role (assistant, tool, system, …).
 *
 * The current host protocol (`HistoryEntry`) exposes only `role` + `content`,
 * so there is no structured kind/source metadata to prefer today. The
 * classifier is still written against an optional `kind`/`source` input so a
 * metadata path can slot in when the host adds one; without it, it falls back
 * to the same conservative content-prefix rules Swift uses.
 */

export type RailPromptInput = {
  id: string
  role: string
  content: string
  /** Optional structured kind (e.g. 'subagent-done'); when set, drives classification. */
  kind?: string
  /** Optional source tag (e.g. 'host' | 'system'); when set, drives classification. */
  source?: string
}

export type RailPrompt = {
  /** Stable message id (ChatMessage.id). */
  id: string
  /** Index of the message inside the transcript (used for scroll-to). */
  index: number
  /** Plain-text hover summary (markdown stripped, whitespace collapsed, truncated). */
  summary: string
}

/** Max grapheme length for rail hover/focus summaries (Swift uses 72; 80–120 requested). */
export const RAIL_TOOLTIP_MAX_LENGTH = 96

/**
 * Family prefixes for runtime/system content stored or streamed with the user
 * role but not authored by the human. Mirrors Swift's
 * `isRuntimeOrSystemInjectedUserText` exactly.
 */
export const RUNTIME_INJECTION_PREFIXES = [
  '[subagent-', // heartbeat / done / stalled / interrupted-reminder / …
  '[worktree-', // worktree merge notifications
  '[post-merge-', // post-merge verify notifications
  '[PipiUI', // session sentinels: skill policy, isolation, internal title jobs
  '## Git (Pipi UI)', // git extension status snapshot leaked into user role
  '(re-delivery', // done-message delivery wrappers
  '(recovered delivery'
] as const

export function isRuntimeOrSystemInjectedUserText(text: string): boolean {
  if (!text) return false
  return RUNTIME_INJECTION_PREFIXES.some(prefix => text.startsWith(prefix))
}

/**
 * Single reusable predicate: real human user input eligible for the prompt
 * rail. Role gate first (assistant/tool/system excluded), then structured
 * metadata when present, then the conservative content-prefix fallback.
 */
export function isNavigationEligibleUserPrompt(message: RailPromptInput): boolean {
  if (message.role !== 'user') return false
  const kind = message.kind?.trim().toLowerCase()
  const source = message.source?.trim().toLowerCase()
  if (kind && kind !== 'user' && kind !== 'prompt') return false
  if (source && source !== 'user' && source !== 'human') return false
  // Empty content stays eligible (image-only prompts), matching Swift.
  return !isRuntimeOrSystemInjectedUserText(message.content ?? '')
}

/** Project transcript messages → rail nodes (oldest → newest), eligible users only. */
export function buildRailPrompts(messages: RailPromptInput[]): RailPrompt[] {
  return messages.flatMap((message, index) =>
    isNavigationEligibleUserPrompt(message)
      ? [{ id: message.id, index, summary: promptSummaryText(message.content) }]
      : []
  )
}

/**
 * Plain-text hover summary: strip markdown syntax, collapse whitespace, and
 * lightly truncate. Never renders markup.
 */
export function promptSummaryText(content: string, maxLength = RAIL_TOOLTIP_MAX_LENGTH): string {
  const collapsed = stripMarkdown(content ?? '').replace(/\s+/g, ' ').trim()
  if (!collapsed) return ''
  return truncateText(collapsed, maxLength)
}

/**
 * Conservative markdown stripping for summaries. Deliberately regex-only and
 * non-destructive: strips fences, inline code, links/images, headings,
 * blockquotes, bullets, bold and strikethrough. Single `*`/`_` italics are
 * left alone so code-ish text like `foo_bar` is not mangled.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
}

/** Grapheme-safe truncation with ellipsis (Swift `truncate` semantics). */
export function truncateText(text: string, maxLength: number): string {
  if (maxLength <= 0) return ''
  const chars = Array.from(text)
  if (chars.length <= maxLength) return text
  return chars.slice(0, maxLength).join('') + '…'
}
