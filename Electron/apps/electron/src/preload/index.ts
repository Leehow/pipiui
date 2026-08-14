import { contextBridge, ipcRenderer } from 'electron'
import { createIpcHost, PIPI_HOST_IPC_CHANNEL, type IpcRendererLike, type PipiHostAPI } from '@pipi/host-api'

export interface ContextBridgeLike {
  exposeInMainWorld(key: string, value: unknown): void
}

/** Electron preload entry: call with Electron's contextBridge and ipcRenderer. */
export function exposePipiHost(contextBridge: ContextBridgeLike, ipc: IpcRendererLike): PipiHostAPI {
  const host = createIpcHost(ipc, PIPI_HOST_IPC_CHANNEL, { openExternal: true, openDocumentExternally: true, projectDirectoryPicker: true, computerUsePermissions: true, updateCenter: true })
  contextBridge.exposeInMainWorld('pipiHost', host)
  return host
}

exposePipiHost(contextBridge, ipcRenderer)

declare global {
  interface Window {
    pipiHost: PipiHostAPI
  }
}
