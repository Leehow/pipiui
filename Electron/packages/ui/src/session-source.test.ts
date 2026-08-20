import { describe, expect, it } from 'vitest'
import { adoptedSourceBadge, externalHistoryToMessages, loadExternalSessionsForProjects, sessionRowLabel, sessionSourceLabel } from './session-source'

describe('session source helpers', () => {
  it('labels every dedicated source including the Pi fallback', () => {
    expect(sessionSourceLabel('pi')).toBe('Pi')
    expect(sessionSourceLabel('claude')).toBe('Anthropic/Claude')
    expect(sessionSourceLabel('codex')).toBe('OpenAI/Codex')
    expect(sessionSourceLabel('grok')).toBe('xAI/Grok')
    expect(sessionSourceLabel('cursor')).toBe('Cursor')
    expect(sessionSourceLabel('opencode')).toBe('OpenCode')
    expect(sessionSourceLabel('zcode')).toBe('Z.ai/ZCode')
    expect(sessionSourceLabel('unknown')).toBe('Pi')
    expect(sessionRowLabel('设计稿', 'cursor')).toBe('Cursor · 设计稿')
    expect(adoptedSourceBadge('codex')).toBe('Codex → Pi')
    expect(sessionRowLabel('设计稿', 'pi', 'codex')).toBe('Codex → Pi · 设计稿')
  })

  it('keeps a failed source from rejecting the rest of the list', async () => {
    const listed = await loadExternalSessionsForProjects(async projectId => {
      if (projectId === 'bad') throw new Error('scanner failed')
      return [{ id: 'ext:claude:ok', source: 'claude', title: 'ok', cwd: '/tmp/ok', updatedAt: 1, historyAvailability: 'text' }]
    }, [{ id: 'bad' }, { id: 'good' }])
    expect(listed.map(item => item.id)).toEqual(['ext:claude:ok'])
  })

  it('renders text history, summaries, and metadata placeholders', () => {
    const text = externalHistoryToMessages({
      id: 'ext:claude:a',
      source: 'claude',
      availability: 'text',
      entries: [
        { id: 'u1', role: 'user', content: '你好', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: '世界', timestamp: 2 },
      ],
    })
    expect(text.map(item => item.content)).toEqual(['你好', '世界'])

    const summary = externalHistoryToMessages({
      id: 'ext:grok:b',
      source: 'grok',
      availability: 'summary',
      entries: [],
      summary: '只读摘要',
    })
    expect(summary).toHaveLength(1)
    expect(summary[0].content).toBe('只读摘要')

    const metadata = externalHistoryToMessages({
      id: 'ext:cursor:c',
      source: 'cursor',
      availability: 'metadata',
      entries: [],
    })
    expect(metadata[0].content).toContain('仅提供元数据')
  })
})
