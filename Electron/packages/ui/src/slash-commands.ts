/**
 * Slash command interaction semantics, mirroring Swift PipiUI's
 * SlashCommand / SlashPaletteQuery / SlashFuzzy / BuiltinCommands.parseInvocation
 * across both desktop clients.
 *
 * Command matching is pure; the live list is a reversible registry consumed by
 * the Composer and the slash palette.
 */

import { createContributionRegistry, useRegistrySnapshot } from './contribution-registry'
import { BUILTIN_EXTENSION_ID } from './builtin-extension-id'

/** Action dispatched when a slash command is executed from the composer. */
export type SlashAction =
  | { kind: 'open-model-manager' }
  /** Compact the session context now, via the host's `compact` method. */
  | { kind: 'compact' }
  /** Transform then send as a normal user prompt (formal-planning trigger). */
  | { kind: 'send-plan' }
  /** Send the raw composer text as a normal prompt (runtime /goal extension). */
  | { kind: 'send-prompt' }
  /** Reserved for future rounds: /thinking, /new … */
  | { kind: 'not-implemented' }

export interface SlashCommandDef {
  /** Command name without the leading '/'. */
  name: string
  description: string
  action: SlashAction
}

/**
 * Builtin slash commands, mirroring Swift `BuiltinCommands.all`. Extensible:
 * future rounds append e.g.
 *   { name: 'thinking', description: '调整思考级别', action: { kind: 'not-implemented' } }
 *   { name: 'new',      description: '新建会话',   action: { kind: 'not-implemented' } }
 * with their own action kinds.
 */
export const PLAN_PROMPT_WITH_ARGS =
  '请为以下目标制定正式计划并发布，等我批准后再执行：'
export const PLAN_PROMPT_BARE =
  '请把当前目标整理成正式计划并发布，等我批准后再执行。'

/** User-visible prompt that satisfies philosophy formal-planning (explicit plan request). */
export function planPromptFromArgs(args: string): string {
  const goal = args.trim()
  return goal ? `${PLAN_PROMPT_WITH_ARGS}${goal}` : PLAN_PROMPT_BARE
}

const slashCommandRegistry = createContributionRegistry<SlashCommandDef>()

export function registerSlashCommand(extId: string, contribution: SlashCommandDef) {
  return slashCommandRegistry.register(extId, contribution)
}

export function disposeSlashCommands(extId: string): void {
  slashCommandRegistry.disposeExtension(extId)
}

export function listSlashCommands(): readonly SlashCommandDef[] {
  return slashCommandRegistry.list()
}

export function useSlashCommands(): readonly SlashCommandDef[] {
  return useRegistrySnapshot(slashCommandRegistry)
}

export const BUILTIN_SLASH_COMMANDS: readonly SlashCommandDef[] = [
  { name: 'model', description: '管理模型可见性', action: { kind: 'open-model-manager' } },
  { name: 'compact', description: '压缩上下文', action: { kind: 'compact' } },
  { name: 'plan', description: '为目标制定正式计划', action: { kind: 'send-plan' } },
  { name: 'goal', description: '设定自主完成的目标', action: { kind: 'send-prompt' } }
]

for (const command of BUILTIN_SLASH_COMMANDS) {
  registerSlashCommand(BUILTIN_EXTENSION_ID, command)
}

/** Live snapshot of registered slash commands (dogfood + extensions). */
export let slashCommands: readonly SlashCommandDef[] = listSlashCommands()
slashCommandRegistry.subscribe(() => {
  slashCommands = slashCommandRegistry.list()
})

export function slashCommandByName(name: string): SlashCommandDef | undefined {
  return listSlashCommands().find(command => command.name === name)
}

/**
 * Mirrors Swift `SlashPaletteQuery.paletteQuery`: the palette is eligible only
 * while the draft is a bare `/query` (leading whitespace tolerated, no inner
 * whitespace — an argument starts hiding the palette). Returns null when the
 * palette must not show.
 */
export function slashPaletteQuery(draft: string): string | null {
  const trimmed = draft.trimStart()
  if (!trimmed.startsWith('/')) return null
  const rest = trimmed.slice(1)
  if (/\s/.test(rest)) return null
  return rest
}

function isBoundary(name: string, index: number): boolean {
  if (index <= 0) return true
  const prev = name[index - 1]
  if (prev === '-' || prev === '_' || prev === ':' || prev === '/') return true
  const cur = name[index]
  return prev >= 'a' && prev <= 'z' && cur >= 'A' && cur <= 'Z'
}

/** Mirrors Swift `SlashFuzzy.score`: subsequence match with boundary and
 *  consecutive bonuses. Higher is better; null means no match. */
export function slashFuzzyScore(query: string, name: string): number | null {
  const q = query.toLowerCase()
  const n = name.toLowerCase()
  if (!q) return 0
  let qi = 0
  let score = 0
  let prevMatched = -2
  let firstMatchIndex: number | undefined
  for (let ni = 0; ni < n.length && qi < q.length; ni++) {
    if (n[ni] !== q[qi]) continue
    score += 1
    if (ni === prevMatched + 1) score += 3
    if (firstMatchIndex === undefined) {
      firstMatchIndex = ni
      if (ni === 0) score += 5
      else if (isBoundary(name, ni)) score += 2
    }
    prevMatched = ni
    qi += 1
  }
  return qi === q.length ? score : null
}

/** Mirrors Swift `SlashFuzzy.filter`: fuzzy-ranked command list for the query. */
export function filterSlashCommands(query: string): SlashCommandDef[] {
  const commands = listSlashCommands()
  const q = query.trim()
  if (!q) return [...commands]
  return commands
    .map(command => ({ command, score: slashFuzzyScore(q, command.name) }))
    .filter((item): item is { command: SlashCommandDef; score: number } => item.score !== null)
    .sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name))
    .map(item => item.command)
}

/**
 * Mirrors Swift `BuiltinCommands.parseInvocation`: split a trimmed draft into
 * `/name args`. Returns null for non-slash text.
 */
export function parseSlashInvocation(text: string): { name: string; args: string } | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/') || trimmed.length < 2) return null
  const rest = trimmed.slice(1)
  const tokenEnd = rest.search(/\s/)
  const token = tokenEnd === -1 ? rest : rest.slice(0, tokenEnd)
  if (!token) return null
  const args = tokenEnd === -1 ? '' : rest.slice(tokenEnd).trim()
  return { name: token, args }
}
