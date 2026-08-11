import type { HostBackend } from '@pipi/host-api'

/** Validate and normalize the sole renderer-requested external navigation. */
export function safeExternalHttpURL(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('invalid URL')
  let parsed: URL
  try { parsed = new URL(raw) } catch { throw new Error('invalid URL') }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('only http/https URLs may be opened')
  }
  return parsed.toString()
}

/** Add the one narrow Electron-only host method without exposing shell access. */
export function withOpenExternal(backend: HostBackend, open: (url: string) => Promise<unknown>): HostBackend {
  return {
    async handle(method, params) {
      if (method === 'openExternal') {
        await open(safeExternalHttpURL(params[0]))
        return
      }
      return backend.handle(method, params)
    },
    subscribe: listener => backend.subscribe(listener)
  }
}
