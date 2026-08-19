import { describe, expect, it } from 'vitest'
import {
  cwdMatchesProject,
  isExternalSessionId,
  makeExternalSessionId,
  normalizeProjectCwd,
  parseExternalSessionId,
  sortExternalSessions,
  type ExternalSession,
} from '../src/external-session.js'

describe('external session contract', () => {
  it('namespaces ids so they cannot be mistaken for Pi sessions', () => {
    expect(isExternalSessionId('session-1')).toBe(false)
    expect(isExternalSessionId('ext:')).toBe(false)
    const claude = makeExternalSessionId('claude', 'abc')
    expect(claude).toBe('ext:claude:abc')
    expect(parseExternalSessionId(claude)).toEqual({ source: 'claude', nativeId: 'abc' })
    const cursor = makeExternalSessionId('cursor', 'abc', 'chat')
    expect(cursor).toBe('ext:cursor:chat:abc')
    expect(parseExternalSessionId(cursor)).toEqual({ source: 'cursor', kind: 'chat', nativeId: 'abc' })
    expect(parseExternalSessionId('ext:cursor:abc')).toBeNull()
    expect(parseExternalSessionId('ext:unknown:abc')).toBeNull()
  })

  it('matches project cwd strictly and does not treat a worktree as the root', () => {
    expect(normalizeProjectCwd('/tmp/proj/')).toBe('/tmp/proj')
    expect(cwdMatchesProject('/tmp/proj/', '/tmp/proj')).toBe(true)
    expect(cwdMatchesProject('/tmp/proj/.pi/worktrees/x', '/tmp/proj')).toBe(false)
    expect(cwdMatchesProject('/tmp/other', '/tmp/proj')).toBe(false)
  })

  it('sorts list rows by updatedAt then source', () => {
    const rows: ExternalSession[] = [
      { id: 'ext:claude:a', source: 'claude', title: 'old', cwd: '/tmp/p', updatedAt: 1, historyAvailability: 'text' },
      { id: 'ext:codex:b', source: 'codex', title: 'new', cwd: '/tmp/p', updatedAt: 3, historyAvailability: 'text' },
      { id: 'ext:grok:c', source: 'grok', title: 'mid', cwd: '/tmp/p', updatedAt: 2, historyAvailability: 'summary' },
    ]
    expect(sortExternalSessions(rows).map(item => item.id)).toEqual(['ext:codex:b', 'ext:grok:c', 'ext:claude:a'])
  })
})
