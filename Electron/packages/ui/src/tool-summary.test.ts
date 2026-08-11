import { describe, expect, it } from 'vitest'
import { toolArgsSummary } from './tool-summary'

describe('toolArgsSummary', () => {
  it('renders write/edit as their path', () => {
    expect(toolArgsSummary('write', '{"path":"Sources/Foo.swift","content":"x"}')).toBe('Sources/Foo.swift')
    expect(toolArgsSummary('edit', '{"file_path":"App.tsx","newText":"y"}')).toBe('App.tsx')
    expect(toolArgsSummary('edit', '{}')).toBe('…')
  })

  it('renders bash as the command', () => {
    expect(toolArgsSummary('bash', '{"command":"ls -la"}')).toBe('ls -la')
    expect(toolArgsSummary('bash', `{"command":"${'x'.repeat(200)}"}`)).toBe(`${'x'.repeat(120)}…`)
  })

  it('renders web_search query', () => {
    expect(toolArgsSummary('web_search', '{"query":"SwiftUI 折叠"}')).toBe('SwiftUI 折叠')
    expect(toolArgsSummary('web_search', '{"query":""}')).toBe('…')
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
  })

  it('scrapes truncated JSON while streaming', () => {
    expect(toolArgsSummary('bash', '{"command":"ls -')).toBe('ls -')
    expect(toolArgsSummary('write', '{"path":"Src')).toBe('Src')
  })

  it('falls back to plain text and empty input', () => {
    expect(toolArgsSummary('read', 'Sources/Foo.swift')).toBe('Sources/Foo.swift')
    expect(toolArgsSummary('bash', '')).toBe('…')
  })
})
