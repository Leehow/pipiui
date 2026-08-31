import type { HostBackend } from '@pipi/host-api'

export type ProductPackFileDialogs = {
  pickArchive: () => Promise<string | null>
  saveArchive: (suggestedName: string) => Promise<string | null>
}

/** Electron-only adapter: native file authority stays outside the renderer. */
export function withProductPackFileDialogs(backend: HostBackend, dialogs: ProductPackFileDialogs): HostBackend {
  return {
    handle: (method, params) => {
      if (method === 'pickProductPackArchive') return dialogs.pickArchive()
      if (method === 'saveProductPackArchive') return dialogs.saveArchive(String(params[0] ?? ''))
      return backend.handle(method, params)
    },
    subscribe: listener => backend.subscribe(listener),
    close: backend.close ? () => backend.close?.() : undefined,
  }
}
