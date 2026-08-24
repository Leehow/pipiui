/** Shared shape for user-role internal runtime signals rendered as compact
 *  cards instead of human bubbles: `[subagent-*]` families and
 *  `[browser-watch]` follow-up wakes (pipiui-browser-watch-v1). */
export type SubagentSignalKind = 'done' | 'heartbeat' | 'stalled' | 'interrupted-reminder' | 'blocked' | 'browser-watch' | 'unknown'
export type SubagentSignalTone = 'success' | 'running' | 'warning' | 'error' | 'neutral'
export type SubagentSignalDelivery = 'retry' | 'recovered'

export type SubagentSignal = {
  kind: SubagentSignalKind
  tone: SubagentSignalTone
  label: string
  summary: string
  meta: string
  detail: string
  raw: string
  delivery?: SubagentSignalDelivery
  fields: Record<string, string>
}

const WRAPPER_RE = /^\((re-delivery|recovered delivery)[^\n]*\)\s*\n?/i

function parseFields(header: string, prefix: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const match of header.slice(prefix.length).trim().matchAll(/([A-Za-z][\w-]*)=(.*?)(?=\s+[A-Za-z][\w-]*=|$)/g)) fields[match[1]] = match[2].trim()
  return fields
}

function lineValue(lines: string[], label: string): string | undefined {
  const line = lines.find(candidate => candidate.startsWith(`${label}:`))
  return line?.slice(label.length + 1).trim() || undefined
}

function detailAfterHeader(lines: string[]): string {
  return lines.slice(1).join('\n').trim()
}

function readableName(fields: Record<string, string>, lines: string[]): string {
  return lineValue(lines, 'Title') || fields.title || fields.name || fields.agentId || '子任务'
}

function compactMeta(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ')
}

function waitedLabel(waitedMs: string | undefined): string | undefined {
  const ms = Number(waitedMs)
  if (!Number.isFinite(ms) || ms < 0) return undefined
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return `等待 ${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `等待 ${minutes}min${String(seconds % 60).padStart(2, '0')}s`
  return `等待 ${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}min${String(seconds % 60).padStart(2, '0')}s`
}

/** Parses user-role runtime signals without treating ordinary user text as protocol. */
export function parseSubagentSignal(content: string): SubagentSignal | null {
  const raw = content.replace(/\r\n?/g, '\n')
  let payload = raw
  let delivery: SubagentSignalDelivery | undefined
  let deliveryDetail: string | undefined
  const wrapper = payload.match(WRAPPER_RE)
  if (wrapper) {
    delivery = wrapper[1].toLowerCase().startsWith('recovered') ? 'recovered' : 'retry'
    deliveryDetail = wrapper[0].trim()
    payload = payload.slice(wrapper[0].length)
  }
  if (!payload.startsWith('[subagent-')) {
    if (!delivery) return null
    return { kind: 'unknown', tone: 'neutral', label: '子任务', summary: '子任务送达通知', meta: delivery === 'retry' ? '重投' : '恢复送达', detail: raw, raw, delivery, fields: {} }
  }

  const lines = payload.split('\n')
  const header = lines[0]
  const family = header.match(/^\[subagent-([^\]]+)\]/)?.[1]?.toLowerCase()
  const kind: SubagentSignalKind = family === 'done' || family === 'heartbeat' || family === 'stalled' || family === 'interrupted-reminder' || family === 'blocked' ? family : 'unknown'
  const prefix = family ? `[subagent-${family}]` : '[subagent-'
  const fields = parseFields(header, prefix)
  if (kind === 'blocked') fields.title = header.match(/\btitle=(.*?)\s+is held:/)?.[1]?.trim() || fields.title
  const deliveryMeta = delivery === 'retry' ? '重投' : delivery === 'recovered' ? '恢复送达' : undefined

  if (kind === 'done') {
    const aborted = fields.aborted === 'true' || /\baborted\b/i.test(fields.state ?? '')
    const ok = fields.ok === 'true' && !aborted
    const verified = fields.verified
    const outcome = aborted ? '已中止' : ok ? '已完成' : '失败'
    const tone: SubagentSignalTone = aborted || (ok && verified === 'fail') ? 'warning' : ok ? 'success' : 'error'
    const body = detailAfterHeader(lines)
    const detail = [deliveryDetail, body].filter(Boolean).join('\n')
    return {
      kind, tone, label: '子任务', summary: `${outcome} · ${readableName(fields, lines)}`,
      meta: compactMeta([
        verified === 'pass' ? '验证通过' : verified === 'fail' ? '验证失败' : verified === 'none' ? '未验证' : undefined,
        fields.cost ? `cost ${fields.cost}` : undefined,
        fields.turns ? `${fields.turns} turns` : undefined,
        fields.resumed === 'true' ? '已续跑' : undefined,
        deliveryMeta,
      ]),
      detail: detail || raw,
      raw, delivery, fields,
    }
  }

  if (kind === 'heartbeat') {
    const vanished = Number(fields.vanished ?? 0)
    const stalled = Number(fields.stalled ?? 0)
    const tone: SubagentSignalTone = vanished > 0 || stalled > 0 ? 'warning' : 'running'
    return {
      kind, tone, label: '子任务', summary: `运行中 ${fields.outstanding ?? '?'}${vanished > 0 ? ` · 失联 ${vanished}` : ''}${stalled > 0 ? ` · 停滞 ${stalled}` : ''}`,
      meta: compactMeta(['心跳', deliveryMeta]), detail: detailAfterHeader(lines) || raw, raw, delivery, fields,
    }
  }

  if (kind === 'stalled') return {
    kind, tone: 'warning', label: '子任务', summary: `停滞 · ${readableName(fields, lines)}`,
    meta: compactMeta([fields.idle ? `空闲 ${fields.idle}` : undefined, deliveryMeta]), detail: detailAfterHeader(lines) || raw, raw, delivery, fields,
  }

  if (kind === 'interrupted-reminder') return {
    kind, tone: fields.state === 'failed' ? 'error' : 'warning', label: '子任务', summary: `待处理 · ${readableName(fields, lines)}`,
    meta: compactMeta([fields.state, fields.idle ? `空闲 ${fields.idle}` : undefined, fields.nudge ? `提醒 ${fields.nudge}` : undefined, deliveryMeta]), detail: detailAfterHeader(lines) || raw, raw, delivery, fields,
  }

  if (kind === 'blocked') return {
    kind, tone: 'warning', label: '子任务', summary: `已阻塞 · ${readableName(fields, lines)}`,
    meta: compactMeta([deliveryMeta]), detail: detailAfterHeader(lines) || header.slice(prefix.length).trim() || raw, raw, delivery, fields,
  }

  return {
    kind, tone: 'neutral', label: '子任务', summary: `子任务通知 · ${family || '未知类型'}`,
    meta: compactMeta([deliveryMeta]), detail: raw, raw, delivery, fields,
  }
}

const BROWSER_WATCH_MARKER = '[browser-watch]'

type BrowserWatchHeader = {
  watchId: string
  reason: string
  waitedMs: number
  url?: string
  title?: string
}

/** Sequential parser for the canonical producer header (formatBrowserWatchMessage):
 *  `[browser-watch] watchId=<token> reason=<token> waitedMs=<digits>[ url=<url-tail>][ title=<rest of line>]`
 *  — fixed field order, single-space separators. `title` is the tail of the
 *  line, so it may contain spaces and field-lookalike text (` reason=` /
 *  ` waitedMs=` …) without being mistaken for header fields. `url` is
 *  producer-controlled free text too (oneLine() only collapses whitespace, so
 *  it may contain spaces AND ` reason=`/` foo=` lookalikes): it is taken as
 *  the whole tail, split from an optional title at the LAST ` title=` whose
 *  right side is non-empty (canonical last-trailer — the producer always
 *  appends title after url, so the real separator is the last one). This is
 *  inherently ambiguous when the url itself ends in ` title=…`-like text and
 *  no title exists: the last segment then displays as the title. Classification
 *  is unaffected (all required fields precede the tail). Anything else —
 *  unknown leading keys, missing/duplicated required fields in wrong order,
 *  non-digit or non-safe waitedMs, garbage where url=/title= literals must
 *  follow — fails (null), so malformed text stays a user message. */
function parseBrowserWatchHeaderLine(line: string): BrowserWatchHeader | null {
  let rest = line.slice(BROWSER_WATCH_MARKER.length)
  const space = () => {
    if (!rest.startsWith(' ')) return false
    rest = rest.slice(1)
    return true
  }
  const literal = (text: string) => {
    if (!rest.startsWith(text)) return false
    rest = rest.slice(text.length)
    return true
  }
  const token = () => {
    const match = rest.match(/^\S+/)
    if (!match) return undefined
    rest = rest.slice(match[0].length)
    return match[0]
  }
  if (!space()) return null
  if (!literal('watchId=')) return null
  const watchId = token()
  if (!watchId) return null
  if (!space() || !literal('reason=')) return null
  const reason = token()
  if (!reason) return null
  if (!space() || !literal('waitedMs=')) return null
  const waitedRaw = token()
  if (!waitedRaw || !/^\d+$/.test(waitedRaw)) return null
  const waitedMs = Number(waitedRaw)
  if (!Number.isSafeInteger(waitedMs) || waitedMs < 0) return null
  const header: BrowserWatchHeader = { watchId, reason, waitedMs }
  if (rest === '') return header
  if (!space()) return null
  if (literal('title=')) {
    const title = rest.trim()
    return title ? { ...header, title } : null
  }
  if (!literal('url=')) return null
  // url is the producer's free-text tail (may contain spaces and lookalike
  // `key=value` fragments); split an optional title at the last ` title=`
  // with a non-empty right side.
  const tail = rest
  if (!tail) return null
  const separator = tail.lastIndexOf(' title=')
  if (separator > 0) {
    const title = tail.slice(separator + ' title='.length).trim()
    if (title) return { ...header, url: tail.slice(0, separator), title }
  }
  return { ...header, url: tail }
}

/** Parses `[browser-watch]` follow-up wakes (pipiui-browser-watch-v1). Unlike
 *  parseSubagentSignal's prefix families, the canonical producer header is
 *  validated by the exact sequential grammar of formatBrowserWatchMessage
 *  (see parseBrowserWatchHeaderLine): unknown leading/trailing keys, duplicate
 *  fields, trailing garbage, and non-digit or non-safe waitedMs return null so
 *  the message stays an ordinary user bubble. Structurally valid future
 *  reasons degrade to a neutral card with the raw text, matching
 *  `[subagent-future]` handling. Shared delivery wrappers (re-delivery /
 *  recovered) are recognized like the subagent parser. */
export function parseBrowserWatchSignal(content: string): SubagentSignal | null {
  const raw = content.replace(/\r\n?/g, '\n')
  let payload = raw
  let delivery: SubagentSignalDelivery | undefined
  let deliveryDetail: string | undefined
  const wrapper = payload.match(WRAPPER_RE)
  if (wrapper) {
    delivery = wrapper[1].toLowerCase().startsWith('recovered') ? 'recovered' : 'retry'
    deliveryDetail = wrapper[0].trim()
    payload = payload.slice(wrapper[0].length)
  }
  if (!payload.startsWith(BROWSER_WATCH_MARKER)) return null

  const lines = payload.split('\n')
  const header = parseBrowserWatchHeaderLine(lines[0])
  if (!header) return null
  const fields: Record<string, string> = {
    watchId: header.watchId,
    reason: header.reason,
    waitedMs: String(header.waitedMs),
    ...(header.url ? { url: header.url } : {}),
    ...(header.title ? { title: header.title } : {}),
  }
  const target = header.title || header.url || header.watchId || 'watch'
  const waited = waitedLabel(fields.waitedMs)
  const deliveryMeta = delivery === 'retry' ? '重投' : delivery === 'recovered' ? '恢复送达' : undefined
  const body = detailAfterHeader(lines)
  const detail = [deliveryDetail, body].filter(Boolean).join('\n')
  const meta = compactMeta([fields.watchId, waited, deliveryMeta])

  if (fields.reason === 'matched') return {
    kind: 'browser-watch', tone: 'success', label: '浏览器监听', summary: `条件命中 · ${target}`, meta,
    detail: detail || raw, raw, delivery, fields,
  }
  if (fields.reason === 'timeout') return {
    kind: 'browser-watch', tone: 'warning', label: '浏览器监听', summary: `等待超时 · ${target}`, meta,
    detail: detail || raw, raw, delivery, fields,
  }
  if (fields.reason === 'disposed') return {
    kind: 'browser-watch', tone: 'warning', label: '浏览器监听', summary: `页面已释放 · ${target}`, meta,
    detail: detail || raw, raw, delivery, fields,
  }
  return {
    kind: 'browser-watch', tone: 'neutral', label: '浏览器监听',
    summary: `浏览器监听通知 · ${fields.reason}`,
    meta: compactMeta([fields.watchId, deliveryMeta]), detail: raw, raw, delivery, fields,
  }
}

/** Shared strict predicate: only structurally canonical watch wakes count as
 *  internal signals. Reused by prompt-rail so a malformed exact-marker
 *  message stays an ordinary human prompt instead of a blind prefix match. */
export function isBrowserWatchSignalText(content: string): boolean {
  return parseBrowserWatchSignal(content) !== null
}

/** Single dispatch for user-role internal runtime signals. Browser-watch is
 *  tried first so a wrapped `(re-delivery …)\n[browser-watch] …` wake is never
 * swallowed by parseSubagentSignal's wrapper-only fallback card. */
export function parseInternalUserSignal(content: string): SubagentSignal | null {
  return parseBrowserWatchSignal(content) ?? parseSubagentSignal(content)
}
