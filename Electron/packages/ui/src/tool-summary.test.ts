import { describe, expect, it } from 'vitest'
import { formatToolInput, toolActivitySummary, toolArgsSummary, toolDisplaySummary } from './tool-summary'

describe('toolArgsSummary', () => {
  it('renders write/edit as their path', () => {
    expect(toolArgsSummary('write', '{"path":"Sources/Foo.swift","content":"x"}')).toBe('Sources/Foo.swift')
    expect(toolArgsSummary('edit', '{"file_path":"App.tsx","newText":"y"}')).toBe('App.tsx')
    expect(toolArgsSummary('edit', '{}')).toBe('…')
  })

  it('renders image tool prompts (including legacy generate_image)', () => {
    expect(toolArgsSummary('image_gen', '{"prompt":"a red fox","confirmed":true}')).toBe('a red fox')
    expect(toolArgsSummary('image_edit', '{"prompt":"make it night","image":"/tmp/a.png"}')).toBe('make it night')
    expect(toolArgsSummary('generate_image', '{"prompt":"old transcript"}')).toBe('old transcript')
    expect(toolArgsSummary('image_gen', '{"prompt":"')).toBe('…')
    expect(toolArgsSummary('image_edit', '{"prompt":"cropped streaming')).toBe('cropped streaming')
  })

  it('renders bash as the command', () => {
    expect(toolArgsSummary('bash', '{"command":"ls -la"}')).toBe('ls -la')
    expect(toolArgsSummary('bash', `{"command":"${'x'.repeat(200)}"}`)).toBe(`${'x'.repeat(120)}…`)
  })

  it('renders web_search query', () => {
    expect(toolArgsSummary('web_search', '{"query":"SwiftUI 折叠"}')).toBe('SwiftUI 折叠')
    expect(toolArgsSummary('web_search', '{"query":""}')).toBe('…')
  })

  it('renders built-in browser search/fetch like their HTTP twins', () => {
    expect(toolArgsSummary('browser_search', '{"query":"Electron 打包"}')).toBe('Electron 打包')
    expect(toolArgsSummary('browser_search', '{}')).toBe('…')
    expect(toolArgsSummary('browser_fetch', '{"url":"https://example.com","mode":"text"}')).toBe('https://example.com')
    // Truncated streaming payloads still scrape the meaningful field.
    expect(toolArgsSummary('browser_search', '{"query":"Electron 打包')).toBe('Electron 打包')
    expect(toolArgsSummary('browser_fetch', '{"url":"https://example.com')).toBe('https://example.com')
  })

  it('renders fetch_content url (single and array)', () => {
    expect(toolArgsSummary('fetch_content', '{"url":"https://example.com"}')).toBe('https://example.com')
    expect(toolArgsSummary('fetch_content', '{"urls":["https://a.com","https://b.com"]}')).toBe('https://a.com')
  })

  it('renders browser as action + detail', () => {
    expect(toolArgsSummary('browser', '{"action":"navigate","url":"http://localhost:3000"}')).toBe('navigate http://localhost:3000')
    expect(toolArgsSummary('browser', '{"action":"screenshot"}')).toBe('screenshot')
  })

  it('renders computer as action count', () => {
    expect(toolArgsSummary('computer', '{"actions":[{},{}]}')).toBe('2 个桌面操作')
    expect(toolArgsSummary('computer', '{"action":"click"}')).toBe('click')
  })

  it('renders find and grep patterns with paths', () => {
    expect(toolArgsSummary('find', '{"pattern":"*.swift","path":"Sources"}')).toBe('*.swift in Sources')
    expect(toolArgsSummary('find', '{"path":"Sources"}')).toBe('* in Sources')
    expect(toolArgsSummary('grep', '{"pattern":"toolCall","path":"Sources"}')).toBe('/toolCall/ in Sources')
    expect(toolArgsSummary('grep', '{}')).toBe('/…/')
  })

  it('renders subagent task as what the agent is doing', () => {
    expect(toolArgsSummary('subagent', '{"task":"修复折叠 bug","agent":"general-purpose"}')).toBe('修复折叠 bug')
    expect(toolArgsSummary('subagent', '{"title":"调研 electron UI"}')).toBe('调研 electron UI')
    expect(toolArgsSummary('subagent', JSON.stringify({ tasks: [
      { agent: 'explore', title: '核对 Electron 生命周期', task: '读取状态桥接' },
      { agent: 'reviewer', task: '验证跨会话隔离' },
    ] }))).toBe('核对 Electron 生命周期、验证跨会话隔离')
  })

  it('scrapes truncated JSON while streaming', () => {
    expect(toolArgsSummary('bash', '{"command":"ls -')).toBe('ls -')
    expect(toolArgsSummary('write', '{"path":"Src')).toBe('Src')
  })

  it('falls back to plain text and empty input', () => {
    expect(toolArgsSummary('read', 'Sources/Foo.swift')).toBe('Sources/Foo.swift')
    expect(toolArgsSummary('bash', '')).toBe('…')
  })

  it('keeps raw JSON in details and renders a human activity summary', () => {
    expect(toolActivitySummary('bash {"command":"npm run build"}')).toBe('bash · npm run build')
    expect(toolActivitySummary('mystery {"opaque":true}')).toBe('mystery')
    expect(toolArgsSummary('mystery', '{"opaque":true}')).toBe('…')
    expect(toolArgsSummary('mystery', '{"opaque":')).toBe('…')
  })
})

describe('toolDisplaySummary', () => {
  it('renders bash as name · full command, including subagent plain-text summaries', () => {
    expect(toolDisplaySummary('bash', '{"command":"grep -r foo ."}')).toBe('bash · grep -r foo .')
    expect(toolDisplaySummary('bash', '{"command":"ls -la"}')).toBe('bash · ls -la')
    expect(toolDisplaySummary('bash', '{"command":"git status"}')).toBe('bash · git status')
    expect(toolDisplaySummary('bash', 'npm test --workspaces')).toBe('bash · npm test --workspaces')
  })

  it('falls back to bare name when command is missing or empty', () => {
    expect(toolDisplaySummary('bash', '{"command":""}')).toBe('bash')
    expect(toolDisplaySummary('bash', '')).toBe('bash')
  })

  it('keeps "name · summary" for non-bash tools', () => {
    expect(toolDisplaySummary('edit', '{"file_path":"App.tsx"}')).toBe('edit · App.tsx')
    expect(toolDisplaySummary('grep', '{"pattern":"foo","path":"src"}')).toBe('grep · /foo/ in src')
  })

  it('scrapes truncated bash JSON while streaming', () => {
    expect(toolDisplaySummary('bash', '{"command":"grep -')).toBe('bash · grep -')
  })
})

describe('formatToolInput', () => {
  it('renders bash command directly with $ prefix', () => {
    expect(formatToolInput('bash', '{"command":"grep -r foo .","cwd":"/tmp"}')).toBe('$ grep -r foo .')
  })

  it('pretty-prints JSON for non-bash tools', () => {
    expect(formatToolInput('edit', '{"file_path":"App.tsx","newText":"x"}')).toBe(
      '{\n  "file_path": "App.tsx",\n  "newText": "x"\n}'
    )
  })

  it('falls back to raw text for partial/streaming JSON', () => {
    expect(formatToolInput('bash', '{"command":"grep -')).toBe('$ grep -')
    expect(formatToolInput('edit', '{"file_path":"App')).toBe('{"file_path":"App')
  })

  it('returns empty for empty input', () => {
    expect(formatToolInput('bash', '')).toBe('')
    expect(formatToolInput('edit', '  ')).toBe('')
  })
})
