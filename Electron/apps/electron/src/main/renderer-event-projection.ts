import type { HostEvent } from '@pipi/host-api'

const BACKGROUND_STREAM_EVENTS = new Set([
  'secret_redact',
  'session_title',
  'status',
  'user_message'
])

export function normalizeEventProjectionSession(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * The shell renderer keeps transcript state only for its selected session. Background
 * streams still owe the sidebar lifecycle/title events, but cloning their text, thinking,
 * tool payloads, and subagent previews across Electron IPC only to discard them in React
 * wastes both main- and renderer-process CPU.
 */
export function shouldForwardRendererEvent(frame: HostEvent, selectedSession?: string): boolean {
  if (!selectedSession) return true
  if (frame.channel === 'stream') {
    return frame.event.sessionId === selectedSession || BACKGROUND_STREAM_EVENTS.has(frame.event.type)
  }
  if (frame.channel === 'agents' && frame.event.type === 'agent_log') {
    // Current hosts always attach sessionId. Keep legacy field-less events visible because
    // there is no safe session identity with which to reject them.
    return !frame.event.sessionId || frame.event.sessionId === selectedSession
  }
  return true
}
