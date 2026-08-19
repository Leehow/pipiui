import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { HostBackend } from '@pipi/host-api'
import { createRemoteDebugService, resolveRemoteDebugStaticDir } from './remote-debug.js'

function mockBackend(): HostBackend & { closed: number } {
  const backend = {
    closed: 0,
    async handle(method: string) {
      if (method === 'listProjects') return [{ id: 'project-1' }]
      if (method === 'capabilities') return { computerUse: true, terminal: true, browser: true }
      return null
    },
    subscribe() {
      return () => undefined
    },
    async close() {
      backend.closed += 1
    }
  }
  return backend
}

describe('createRemoteDebugService', () => {
  const temps: string[] = []
  const services: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    for (const service of services.splice(0)) await service.close().catch(() => undefined)
    for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  async function staticDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'pipi-remote-debug-ui-'))
    temps.push(dir)
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>debug</title>', 'utf8')
    return dir
  }

  it('binds 127.0.0.1 on a random port and serves root + /ws without pairing', async () => {
    const backend = mockBackend()
    const service = createRemoteDebugService({ backend, staticDir: await staticDir() })
    services.push(service)
    const first = service.start()
    const second = service.start()
    const state = await first
    expect(await second).toEqual(state)
    expect(state.debugEnabled).toBe(true)
    expect(state.debugUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    expect(JSON.stringify(state)).not.toMatch(/token|secret|pair/i)
    const origin = state.debugUrl!.replace(/\/$/, '')
    const page = await fetch(`${origin}/`)
    expect(page.status).toBe(200)
    const socket = new WebSocket(`${origin.replace('http', 'ws')}/ws`)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    socket.close()
    await service.stop()
    await service.stop()
    await service.close()
    expect(service.getState()).toEqual({ debugEnabled: false, debugUrl: null })
    expect(backend.closed).toBe(0)
    expect(await backend.handle('listProjects', [])).toEqual([{ id: 'project-1' }])
  })

  it('returns a clear error when the static directory is missing', async () => {
    const missing = join(await mkdtemp(join(tmpdir(), 'pipi-remote-debug-missing-')), 'nope')
    temps.push(missing)
    const service = createRemoteDebugService({ backend: mockBackend(), staticDir: missing })
    services.push(service)
    const state = await service.start()
    expect(state.debugEnabled).toBe(false)
    expect(state.debugUrl).toBeNull()
    expect(state.debugError).toContain('本地 Debug 静态目录不存在')
  })

  it('resolves packaged and development static dirs', () => {
    expect(resolveRemoteDebugStaticDir({ packaged: true, resourcesPath: '/App/Resources' })).toBe(join('/App/Resources', 'browser-ui'))
    const moduleUrl = fileURLToPath(new URL('./remote-debug.ts', import.meta.url))
    const resolved = resolveRemoteDebugStaticDir({ packaged: false, resourcesPath: '/unused', moduleUrl: `file://${moduleUrl}` })
    expect(resolved.replace(/\\/g, '/')).toMatch(/packages\/ui\/dist\/browser$/)
  })
})
