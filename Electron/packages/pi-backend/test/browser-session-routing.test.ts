import { afterEach, describe, expect, it } from 'vitest'
import { createPiHostBackend } from '../src/index.js'
import type { HostBridge } from '../src/bridge.js'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('PiHostBackend browser session routing', () => {
  const backends: Array<ReturnType<typeof createPiHostBackend>> = []
  afterEach(async () => {
    await Promise.all(backends.splice(0).map(backend => backend.close()))
  })

  it('passes the authenticated bridge sessionId to the browser host callback', async () => {
    const received: Array<{ sessionId: string; request: Record<string, unknown> }> = []
    const backend = createPiHostBackend({
      browserAction: async (request, sessionId) => {
        received.push({ request, sessionId })
        return { ok: true, sessionId }
      }
    })
    backends.push(backend)
    const bridge = (backend as unknown as { bridge: HostBridge }).bridge
    const port = await bridge.listen()
    const capability = bridge.register('authenticated-session-a')

    const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        sessionCapability: capability,
        action: 'browser_action',
        event: { action: 'navigate', url: 'https://example.com' }
      })
    })

    expect(await response.json()).toEqual({ ok: true, sessionId: 'authenticated-session-a' })
    expect(received).toEqual([{
      sessionId: 'authenticated-session-a',
      request: { action: 'navigate', url: 'https://example.com' }
    }])
  })

  it('revokes the browser capability immediately when its chat session is deleted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipi-browser-delete-'))
    const cwd = join(root, 'project')
    const sessionsRoot = join(root, 'sessions')
    const sessionDir = join(sessionsRoot, 'project')
    await mkdir(cwd, { recursive: true })
    await mkdir(sessionDir, { recursive: true })
    await writeFile(join(sessionDir, 'session.jsonl'), `${JSON.stringify({
      type: 'session', version: 3, id: 'session-delete', timestamp: new Date().toISOString(), cwd
    })}\n`)
    const backend = createPiHostBackend({ agentDir: join(root, 'agent'), sessionsRoot, runtimeRoot: join(root, 'runtime') })
    backends.push(backend)
    const bridge = (backend as unknown as { bridge: HostBridge }).bridge
    const port = await bridge.listen()
    const capability = bridge.register('session-delete')

    await backend.handle('deleteSession', ['session-delete'])
    const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 1, sessionCapability: capability, action: 'browser_action', event: { action: 'observe' } })
    })
    expect(response.status).toBe(403)
  })
})
