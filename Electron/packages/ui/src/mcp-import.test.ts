import { describe, expect, it } from 'vitest'
import { mcpServerSummary, mcpServerTransport, normalizeMcpServerSpec, parseMcpServersJson } from './mcp-import'

describe('parseMcpServersJson', () => {
  it('parses the standard mcpServers wrapper', () => {
    const parsed = parseMcpServersJson(JSON.stringify({
      mcpServers: {
        context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
        notion: { type: 'http', url: 'https://mcp.notion.com/mcp' },
      },
    }), 'custom-mcp')
    expect(parsed.error).toBeUndefined()
    expect(parsed.shape).toBe('wrapper')
    expect(parsed.servers).toHaveLength(2)
    expect(parsed.servers[0]).toEqual({
      name: 'context7',
      spec: { command: 'npx', args: ['-y', '@upstash/context7-mcp'], transport: 'stdio', lifecycle: 'eager' },
    })
    expect(parsed.servers[1]?.spec).toEqual({
      transport: 'streamable-http',
      url: 'https://mcp.notion.com/mcp',
      lifecycle: 'eager',
    })
  })

  it('accepts the VS Code servers wrapper and single named entries', () => {
    const vscode = parseMcpServersJson(JSON.stringify({ servers: { deepwiki: { url: 'https://mcp.deepwiki.com/mcp' } } }), 'x')
    expect(vscode.servers).toEqual([{
      name: 'deepwiki',
      spec: { transport: 'streamable-http', url: 'https://mcp.deepwiki.com/mcp', lifecycle: 'eager' },
    }])
    const single = parseMcpServersJson(JSON.stringify({ playwright: { command: 'npx', args: ['@playwright/mcp'] } }), 'x')
    expect(single.shape).toBe('single')
    expect(single.servers[0]?.name).toBe('playwright')
  })

  it('treats a bare server spec as one server named by the caller', () => {
    const parsed = parseMcpServersJson(JSON.stringify({ type: 'sse', url: 'https://mcp.example.com/sse' }), 'my-mcp')
    expect(parsed.shape).toBe('bare')
    expect(parsed.servers).toEqual([{
      name: 'my-mcp',
      spec: { transport: 'sse', url: 'https://mcp.example.com/sse', lifecycle: 'eager' },
    }])
    const unnamed = parseMcpServersJson('{"command": "npx"}', '  ')
    expect(unnamed.servers[0]?.name).toBe('custom-mcp')
  })

  it('keeps env values so they can be written to the local config file', () => {
    const parsed = parseMcpServersJson(JSON.stringify({
      mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'secret' } } },
    }), 'x')
    expect(parsed.servers[0]?.spec.env).toEqual({ GITHUB_TOKEN: 'secret' })
  })

  it('reports invalid JSON and specs without command/url', () => {
    expect(parseMcpServersJson('not json', 'x').error).toContain('不是有效的 JSON')
    expect(parseMcpServersJson('[]', 'x').error).toContain('对象')
    const missing = parseMcpServersJson(JSON.stringify({ mcpServers: { broken: { args: ['x'] } } }), 'x')
    expect(missing.servers).toEqual([])
    expect(missing.error).toContain('broken')
    const mixed = parseMcpServersJson(JSON.stringify({ mcpServers: { ok: { command: 'a' }, bad: {} } }), 'x')
    expect(mixed.servers.map(server => server.name)).toEqual(['ok'])
    expect(mixed.error).toContain('bad')
    expect(parseMcpServersJson('', 'x').error).toContain('mcpServers')
  })
})

describe('normalizeMcpServerSpec', () => {
  it('maps known type aliases and keeps existing transport untouched', () => {
    expect(normalizeMcpServerSpec({ type: 'http', url: 'https://a' })?.transport).toBe('streamable-http')
    expect(normalizeMcpServerSpec({ type: 'sse', url: 'https://a' })?.transport).toBe('sse')
    expect(normalizeMcpServerSpec({ type: 'stdio', command: 'a' })?.transport).toBe('stdio')
    const both = normalizeMcpServerSpec({ type: 'http', transport: 'sse', url: 'https://a' })
    expect(both?.transport).toBe('sse')
    expect(both && 'type' in both).toBe(false)
  })

  it('returns null for non-objects and specs without an endpoint', () => {
    expect(normalizeMcpServerSpec('npx')).toBeNull()
    expect(normalizeMcpServerSpec({ args: ['x'] })).toBeNull()
  })
})

describe('preview helpers', () => {
  it('summarizes stdio command lines and remote urls', () => {
    expect(mcpServerSummary({ command: 'npx', args: ['-y', '@upstash/context7-mcp'] })).toBe('npx -y @upstash/context7-mcp')
    expect(mcpServerSummary({ url: 'https://mcp.notion.com/mcp' })).toBe('https://mcp.notion.com/mcp')
    expect(mcpServerTransport({ command: 'npx' })).toBe('stdio')
    expect(mcpServerTransport({ url: 'https://a' })).toBe('http')
    expect(mcpServerTransport({ transport: 'sse', url: 'https://a' })).toBe('sse')
  })
})
