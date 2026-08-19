import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HostBackend } from '@pipi/host-api'
import { createWsHostServer, type WsHostServer } from '../../../server/src/index.js'

export type RemoteDebugState = {
  debugEnabled: boolean
  debugUrl: string | null
  debugError?: string
}

export type RemoteDebugServiceOptions = {
  backend: HostBackend
  staticDir: string
}

const LOOPBACK_HOST = '127.0.0.1'

export function resolveRemoteDebugStaticDir(input: {
  packaged: boolean
  resourcesPath: string
  moduleUrl?: string
}): string {
  if (input.packaged) return join(input.resourcesPath, 'browser-ui')
  const from = input.moduleUrl ?? import.meta.url
  return join(fileURLToPath(new URL('../../../../packages/ui/dist/browser', from)))
}

function idleDebugState(error?: string): RemoteDebugState {
  return error
    ? { debugEnabled: false, debugUrl: null, debugError: error }
    : { debugEnabled: false, debugUrl: null }
}

function assertNoSecrets(state: RemoteDebugState): RemoteDebugState {
  return {
    debugEnabled: state.debugEnabled,
    debugUrl: state.debugUrl,
    ...(state.debugError ? { debugError: state.debugError } : {})
  }
}

export function createRemoteDebugService(options: RemoteDebugServiceOptions) {
  const listeners = new Set<(state: RemoteDebugState) => void>()
  let state = idleDebugState()
  let server: WsHostServer | null = null
  let starting: Promise<RemoteDebugState> | null = null

  const emit = (next: RemoteDebugState) => {
    state = assertNoSecrets(next)
    for (const listener of listeners) listener(state)
  }

  const getState = () => assertNoSecrets(state)

  const start = async (): Promise<RemoteDebugState> => {
    if (starting) return starting
    if (server && state.debugEnabled && state.debugUrl) return getState()
    starting = (async () => {
      const indexFile = join(options.staticDir, 'index.html')
      if (!existsSync(indexFile)) {
        const message = `本地 Debug 静态目录不存在：${indexFile}`
        emit(idleDebugState(message))
        return getState()
      }
      try {
        const instance = createWsHostServer({
          backend: options.backend,
          pairing: false,
          staticDir: options.staticDir,
          host: LOOPBACK_HOST,
          port: 0
        })
        const port = await instance.listen(0, LOOPBACK_HOST)
        const address = instance.server.address()
        if (!address || typeof address === 'string' || address.address !== LOOPBACK_HOST) {
          await instance.close()
          throw new Error('debug server did not bind 127.0.0.1')
        }
        server = instance
        emit({ debugEnabled: true, debugUrl: `http://${LOOPBACK_HOST}:${port}/` })
        return getState()
      } catch (error) {
        server = null
        emit(idleDebugState(error instanceof Error ? error.message : String(error)))
        return getState()
      }
    })()
    try {
      return await starting
    } finally {
      starting = null
    }
  }

  const stop = async (): Promise<RemoteDebugState> => {
    const current = server
    server = null
    if (current) await current.close()
    emit(idleDebugState())
    return getState()
  }

  const close = async (): Promise<void> => {
    await stop()
  }

  return {
    getState,
    start,
    stop,
    close,
    subscribe(listener: (next: RemoteDebugState) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }
  }
}

export type RemoteDebugService = ReturnType<typeof createRemoteDebugService>
