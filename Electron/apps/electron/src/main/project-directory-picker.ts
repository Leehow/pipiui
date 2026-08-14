import type { HostBackend } from '@pipi/host-api'

/** Add the one narrow Electron-only folder selection method to the shared host. */
export function withProjectDirectoryPicker(backend: HostBackend, pick: () => Promise<string | null>): HostBackend {
  return {
    handle: (method, params) => method === 'pickProjectDirectory' ? pick() : backend.handle(method, params),
    subscribe: listener => backend.subscribe(listener)
  }
}
