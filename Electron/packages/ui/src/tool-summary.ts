/**
 * Turns a raw tool payload into a compact activity summary:
 * tool-args string into the compact human-readable summary shown on folded cards —
 * `read · Sources/Foo.swift`, `bash · ls -la`, `web_search · 天气`,
 * `browser · navigate http://localhost:3000`, `find · *.swift in Sources`.
 *
 * Tool payloads are streamed as raw JSON deltas, so the input may be partial or
 * truncated at any point; every path degrades to a field scrape instead of dumping
 * raw JSON braces onto the header.
 */

const MAX_LONG = 120
const MAX_PROMPT = 80

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function pathSummary(args: Record<string, unknown>): string {
  return stringField(args, 'path') ?? stringField(args, 'file_path') ?? '…'
}

function promptSummary(args: Record<string, unknown>): string {
  const raw = typeof args['prompt'] === 'string' ? args['prompt'].trim() : ''
  if (!raw) return '…'
  return raw.length <= MAX_PROMPT ? raw : `${raw.slice(0, MAX_PROMPT)}…`
}

/** `browser` multiplexes actions behind one tool; lead the header with the action. */
function browserSummary(args: Record<string, unknown>): string {
  const action = stringField(args, 'action') ?? '…'
  const detail = stringField(args, 'url') ?? stringField(args, 'js') ?? stringField(args, 'mode')
  return detail ? `${action} ${detail}` : action
}

/** `find` → `<pattern> in <path>`; a missing/empty pattern collapses to `*`. */
function findSummary(args: Record<string, unknown>): string {
  const pattern = stringField(args, 'pattern') ?? '*'
  const path = stringField(args, 'path')
  return path ? `${pattern} in ${path}` : pattern
}

/** `grep` → `/<pattern>/ in <path>`; a missing/empty pattern collapses to `…`. */
function grepSummary(args: Record<string, unknown>): string {
  const pattern = stringField(args, 'pattern') ?? '…'
  const path = stringField(args, 'path')
  return path ? `/${pattern}/ in ${path}` : `/${pattern}/`
}

/** `subagent` → the dispatched task/title so the folded card says what the agent is doing. */
function subagentSummary(args: Record<string, unknown>): string {
  const raw = stringField(args, 'title') ?? stringField(args, 'task') ?? stringField(args, 'name')
  if (!raw) return '…'
  const compact = raw.replace(/\s+/g, ' ').trim()
  return compact.length <= MAX_PROMPT ? compact : `${compact.slice(0, MAX_PROMPT)}…`
}

function summarizeArgs(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'write':
    case 'edit':
      return pathSummary(args)
    case 'generate_image':
      return promptSummary(args)
    case 'web_search':
      return stringField(args, 'query') ?? '…'
    case 'fetch_content': {
      const url = stringField(args, 'url')
      if (url) return url
      const urls = args['urls']
      if (Array.isArray(urls) && typeof urls[0] === 'string') return urls[0]
      return '…'
    }
    case 'browser':
      return browserSummary(args)
    case 'computer': {
      const count = Array.isArray(args['actions']) ? args['actions'].length : 0
      if (count > 0) return `${count} 个桌面操作`
      return stringField(args, 'action') ?? stringField(args, 'type') ?? '桌面操作'
    }
    case 'find':
      return findSummary(args)
    case 'grep':
      return grepSummary(args)
    case 'subagent':
      return subagentSummary(args)
    default:
      return legacySummary(args)
  }
}

function legacySummary(args: Record<string, unknown>): string {
  const command = stringField(args, 'command')
  if (command) return truncate(command)
  return stringField(args, 'path')
    ?? stringField(args, 'file_path')
    ?? '…'
}

function truncate(text: string): string {
  return text.length > MAX_LONG ? `${text.slice(0, MAX_LONG)}…` : text
}

/** Extract `"key":"value"` from a partial/truncated/escaped JSON string. */
function scrapeJSONString(key: string, text: string): string | undefined {
  const needle = `"${key}"`
  const start = text.indexOf(needle)
  if (start < 0) return undefined
  let i = start + needle.length
  while (i < text.length && /\s/.test(text[i])) i += 1
  if (text[i] !== ':') return undefined
  i += 1
  while (i < text.length && /\s/.test(text[i])) i += 1
  if (text[i] !== '"') return undefined
  i += 1
  let out = ''
  while (i < text.length) {
    const c = text[i]
    if (c === '\\') {
      const next = text[i + 1]
      if (next === undefined) break
      out += next
      i += 2
      continue
    }
    if (c === '"') break
    out += c
    i += 1
  }
  return out.length > 0 ? out : undefined
}

/** Undo common JSON escapes (`\"` → `"`, `\\` → `\`) for doubly-escaped log args. */
function unescapeJSONString(text: string): string {
  return text.replace(/\\(["\\])/g, '$1')
}

/** `find` scrape that never fails: pattern defaults to `*`, path appended when present. */
function findScrapedSummary(text: string): string {
  let pattern = scrapeJSONString('pattern', text)
  let path = scrapeJSONString('path', text)
  if (pattern == null && path == null && text.includes('\\')) {
    const unescaped = unescapeJSONString(text)
    if (unescaped !== text) {
      pattern = scrapeJSONString('pattern', unescaped)
      path = scrapeJSONString('path', unescaped)
    }
  }
  const patternValue = pattern ?? '*'
  return path ? `${patternValue} in ${path}` : patternValue
}

/** `grep` scrape that never fails: pattern defaults to `…`, path appended when present. */
function grepScrapedSummary(text: string): string {
  let pattern = scrapeJSONString('pattern', text)
  let path = scrapeJSONString('path', text)
  if (pattern == null && path == null && text.includes('\\')) {
    const unescaped = unescapeJSONString(text)
    if (unescaped !== text) {
      pattern = scrapeJSONString('pattern', unescaped)
      path = scrapeJSONString('path', unescaped)
    }
  }
  const patternValue = pattern ?? '…'
  return path ? `/${patternValue}/ in ${path}` : `/${patternValue}/`
}

/** Best-effort field scrape for truncated / invalid tool-arg JSON. */
function scrapeFields(name: string, text: string): string | undefined {
  switch (name) {
    case 'edit':
    case 'write':
    case 'read':
    case 'ls':
      return scrapeJSONString('path', text) ?? scrapeJSONString('file_path', text)
    case 'bash':
    case 'shell': {
      const cmd = scrapeJSONString('command', text)
      return cmd == null ? undefined : truncate(cmd)
    }
    case 'web_search':
      return scrapeJSONString('query', text)
    case 'fetch_content':
      return scrapeJSONString('url', text)
    case 'generate_image': {
      const prompt = scrapeJSONString('prompt', text)
      return prompt == null ? undefined : truncate(prompt)
    }
    case 'subagent':
      return scrapeJSONString('title', text) ?? scrapeJSONString('task', text)
    default:
      return scrapeJSONString('path', text)
        ?? scrapeJSONString('file_path', text)
        ?? scrapeJSONString('command', text)
  }
}

/** Human-readable tool-args summary; `…` when nothing meaningful is present. */
export function toolArgsSummary(name: string, raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return '…'
  try {
    const parsed = JSON.parse(trimmed)
    if (isRecord(parsed)) return summarizeArgs(name, parsed)
  } catch {
    // Fall through to field scraping for truncated / non-JSON input.
  }
  if (name === 'find') return findScrapedSummary(trimmed)
  if (name === 'grep') return grepScrapedSummary(trimmed)
  const scraped = scrapeFields(name, trimmed)
  if (scraped) return scraped
  // A JSON-looking payload belongs in expanded details, never in the visible header.
  if (trimmed.includes('{') || trimmed.includes('[')) return '…'
  return trimmed
}

/** Runtime activity is commonly `toolName {args}`. Match Swift by showing the
 * meaningful argument, while leaving the raw payload to the expanded card. */
export function toolActivitySummary(activity: string): string {
  const trimmed = activity.trim()
  if (!trimmed) return ''
  const split = trimmed.indexOf(' ')
  if (split < 0) return truncate(trimmed)
  const name = trimmed.slice(0, split)
  const raw = trimmed.slice(split + 1).trim()
  if (!raw.startsWith('{')) return truncate(trimmed)
  const summary = toolArgsSummary(name, raw)
  return summary === '…' ? name : `${name} · ${summary}`
}

/** Extract the `command` field from a bash/shell tool-args payload (JSON or
 *  truncated scrape). Returns undefined when no command is present. */
function bashCommand(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  try {
    const parsed = JSON.parse(trimmed)
    if (isRecord(parsed) && typeof parsed.command === 'string') return parsed.command
  } catch { /* fall through to scrape */ }
  return scrapeJSONString('command', trimmed)
}

/**
 * Collapsed-header display name for a tool call. For bash/shell, leads with
 * `bash <first-command-word>` (e.g. `bash grep`, `bash ls`) so the user can
 * tell at a glance what the command does. Other tools keep the existing
 * `name · summary` pattern.
 */
export function toolDisplaySummary(name: string, raw: string): string {
  if (name === 'bash' || name === 'shell') {
    const command = bashCommand(raw)
    if (command) {
      const firstWord = command.trim().split(/\s+/)[0]
      if (firstWord) return `${name} ${firstWord}`
    }
    return name
  }
  const argsSummary = toolArgsSummary(name, raw)
  return argsSummary !== '…' ? `${name} · ${argsSummary}` : name
}

/**
 * Human-readable tool input for the expanded card. For bash/shell, renders the
 * command directly as `$ <command>` instead of raw JSON. Other tools are
 * pretty-printed as 2-space-indented JSON; partial/streaming input falls back
 * to the raw string.
 */
export function formatToolInput(name: string, raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (name === 'bash' || name === 'shell') {
    const command = bashCommand(raw)
    if (command) return `$ ${command}`
  }
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return trimmed
  }
}
