/**
 * Parsing for the mainstream "paste a JSON" MCP import (Claude / Cursor /
 * Cline style `mcpServers` configs). Output is the shape pi-mcp-extension
 * reads from `{projectRoot}/.pi/mcp.json`: `transport` + `command`/`url`,
 * never `${VAR}` interpolation.
 */

export type ParsedMcpServer = { name: string; spec: Record<string, unknown> }

export type ParsedMcpImport = {
  servers: ParsedMcpServer[]
  /** Where the server names came from; `bare` lets the UI show a name field. */
  shape: 'wrapper' | 'single' | 'bare'
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const TRANSPORT_BY_TYPE: Record<string, string> = {
  stdio: 'stdio',
  http: 'streamable-http',
  'streamable-http': 'streamable-http',
  streamable_http: 'streamable-http',
  sse: 'sse',
}

function looksLikeServerSpec(value: unknown): boolean {
  return isRecord(value) && ['command', 'url', 'type', 'transport'].some(key => typeof value[key] === 'string')
}

/** Map `type` → `transport`, infer stdio/streamable-http, default `lifecycle`; null when unusable. */
export function normalizeMcpServerSpec(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null
  const spec: Record<string, unknown> = { ...raw }
  const hasCommand = typeof spec.command === 'string' && spec.command.trim().length > 0
  const hasUrl = typeof spec.url === 'string' && spec.url.trim().length > 0
  if (!hasCommand && !hasUrl) return null
  if (typeof spec.type === 'string') {
    const declared = spec.type.trim().toLowerCase()
    if (typeof spec.transport !== 'string' || !spec.transport.trim()) {
      spec.transport = TRANSPORT_BY_TYPE[declared] ?? spec.type.trim()
    }
    delete spec.type
  }
  if (typeof spec.transport !== 'string' || !spec.transport.trim()) {
    spec.transport = hasUrl ? 'streamable-http' : 'stdio'
  }
  if (spec.lifecycle === undefined) spec.lifecycle = 'eager'
  return spec
}

function fromEntries(entries: [string, unknown][], shape: ParsedMcpImport['shape']): ParsedMcpImport {
  const servers: ParsedMcpServer[] = []
  const invalid: string[] = []
  for (const [name, rawSpec] of entries) {
    const trimmed = name.trim()
    const spec = normalizeMcpServerSpec(rawSpec)
    if (!trimmed || !spec) {
      invalid.push(trimmed || '(未命名)')
      continue
    }
    servers.push({ name: trimmed, spec })
  }
  if (servers.length === 0) {
    return { servers: [], shape, error: `这些配置缺少 command 或 url，无法导入：${invalid.join('、')}` }
  }
  if (invalid.length > 0) {
    return { servers, shape, error: `已识别 ${servers.length} 个连接，但这些配置缺少 command 或 url，已忽略：${invalid.join('、')}` }
  }
  return { servers, shape }
}

/**
 * Accepts the standard `{"mcpServers": {…}}` wrapper, the VS Code `{"servers":
 * {…}}` variant, a single named entry like `{"context7": {…}}`, or one bare
 * server spec (named via `fallbackName`).
 */
export function parseMcpServersJson(text: string, fallbackName: string): ParsedMcpImport {
  const trimmed = text.trim()
  if (!trimmed) return { servers: [], shape: 'wrapper', error: '粘贴一段 mcpServers JSON，例如 {"mcpServers": {"context7": {"command": "npx", "args": ["-y", "@upstash/context7-mcp"]}}}' }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { servers: [], shape: 'wrapper', error: '不是有效的 JSON，请检查逗号和引号后重试' }
  }
  if (!isRecord(parsed)) return { servers: [], shape: 'wrapper', error: 'JSON 需要是一个对象' }
  const wrapper = isRecord(parsed.mcpServers) ? parsed.mcpServers : isRecord(parsed.servers) ? parsed.servers : null
  if (wrapper) return fromEntries(Object.entries(wrapper), 'wrapper')
  if (!looksLikeServerSpec(parsed)) {
    const entries = Object.entries(parsed)
    if (entries.length > 0 && entries.every(([, value]) => isRecord(value))) {
      return fromEntries(entries, 'single')
    }
    return { servers: [], shape: 'bare', error: '没有找到 command 或 url，无法识别为 MCP 服务器' }
  }
  const spec = normalizeMcpServerSpec(parsed)
  if (!spec) return { servers: [], shape: 'bare', error: '没有找到 command 或 url，无法识别为 MCP 服务器' }
  const name = fallbackName.trim() || 'custom-mcp'
  return { servers: [{ name, spec }], shape: 'bare' }
}

/** Human-readable stdio command line / remote URL for previews. */
export function mcpServerSummary(spec: Record<string, unknown>): string {
  const command = typeof spec.command === 'string' ? spec.command.trim() : ''
  const url = typeof spec.url === 'string' ? spec.url.trim() : ''
  const args = Array.isArray(spec.args) ? spec.args.filter(item => typeof item === 'string').join(' ') : ''
  if (command) return [command, args].filter(Boolean).join(' ')
  if (url) return url
  return typeof spec.transport === 'string' ? spec.transport : ''
}

export function mcpServerTransport(spec: Record<string, unknown>): string {
  const declared = typeof spec.transport === 'string' ? spec.transport.trim() : ''
  if (declared) return declared
  return typeof spec.url === 'string' && spec.url.trim() ? 'http' : 'stdio'
}

export const MCP_IMPORT_EXAMPLE = `{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    },
    "notion": {
      "type": "http",
      "url": "https://mcp.notion.com/mcp"
    }
  }
}`
