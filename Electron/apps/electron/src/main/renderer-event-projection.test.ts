import { describe, expect, it } from 'vitest'
import { PIPI_HOST_PROTOCOL_VERSION, type HostEvent } from '@pipi/host-api'
import { normalizeEventProjectionSession, shouldForwardRendererEvent } from './renderer-event-projection'

const stream = (sessionId: string, type: string): HostEvent => ({
  protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
  channel: 'stream',
  event: type === 'status'
    ? { type: 'status', sessionId, status: 'started' }
    : type === 'session_title'
      ? { type: 'session_title', sessionId, title: 'title', source: 'model' }
      : type === 'user_message'
        ? { type: 'user_message', sessionId, content: 'prompt' }
        : type === 'secret_redact'
          ? { type: 'secret_redact', sessionId, messages: [] }
          : { type: 'text', sessionId, contentIndex: 0, delta: 'large payload' }
} as HostEvent)

describe('renderer event projection', () => {
  it('normalizes the renderer-selected session identity', () => {
    expect(normalizeEventProjectionSession('  selected  ')).toBe('selected')
    expect(normalizeEventProjectionSession('')).toBeUndefined()
    expect(normalizeEventProjectionSession(null)).toBeUndefined()
  })

  it('keeps the selected transcript and background lifecycle events', () => {
    expect(shouldForwardRendererEvent(stream('selected', 'text'), 'selected')).toBe(true)
    for (const type of ['status', 'session_title', 'user_message', 'secret_redact']) {
      expect(shouldForwardRendererEvent(stream('background', type), 'selected')).toBe(true)
    }
  })

  it('drops background transcript payloads before Electron IPC serialization', () => {
    expect(shouldForwardRendererEvent(stream('background', 'text'), 'selected')).toBe(false)
  })

  it('keeps agent summaries but drops session-scoped background log previews', () => {
    const summary = {
      protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
      channel: 'agents',
      event: { type: 'agent', agent: { agentId: 'worker', runId: 'run', sessionId: 'background', name: 'worker', task: '', state: 'running' } }
    } as HostEvent
    const log = {
      protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
      channel: 'agents',
      event: { type: 'agent_log', sessionId: 'background', agentId: 'worker', runId: 'run', itemType: 'text', text: 'large preview' }
    } as HostEvent
    expect(shouldForwardRendererEvent(summary, 'selected')).toBe(true)
    expect(shouldForwardRendererEvent(log, 'selected')).toBe(false)
  })

  it('preserves legacy behavior until a renderer selects a session', () => {
    expect(shouldForwardRendererEvent(stream('background', 'text'))).toBe(true)
  })
})
