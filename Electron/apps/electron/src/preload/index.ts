import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { createIpcHost, PIPI_HOST_IPC_CHANNEL, type IpcRendererLike, type PipiHostAPI } from '@pipi/host-api'
import {
  PIPI_REMOTE_CONTROL_EVENT_CHANNEL,
  PIPI_REMOTE_CONTROL_IPC_CHANNEL,
  type RemoteControlCommand,
  type RemoteControlState
} from '../main/remote-control-ipc.js'

export interface ContextBridgeLike {
  exposeInMainWorld(key: string, value: unknown): void
}

export type PipiRemoteControlAPI = {
  invoke(command: RemoteControlCommand): Promise<RemoteControlState>
  getState(): Promise<RemoteControlState>
  start(relayOrigin?: string): Promise<RemoteControlState>
  stop(): Promise<RemoteControlState>
  reset(relayOrigin?: string): Promise<RemoteControlState>
  startDebug(): Promise<RemoteControlState>
  stopDebug(): Promise<RemoteControlState>
  subscribe(listener: (state: RemoteControlState) => void): () => void
}

export interface RemoteControlIpcRendererLike {
  invoke(channel: string, command: RemoteControlCommand): Promise<RemoteControlState>
  on(channel: string, listener: (event: unknown, state: RemoteControlState) => void): void
  removeListener(channel: string, listener: (event: unknown, state: RemoteControlState) => void): void
}

/** Electron preload entry: call with Electron's contextBridge and ipcRenderer. */
export function exposePipiHost(contextBridge: ContextBridgeLike, ipc: IpcRendererLike): PipiHostAPI {
  const host = createIpcHost(ipc, PIPI_HOST_IPC_CHANNEL, { openExternal: true, openDocumentExternally: true, projectDirectoryPicker: true, computerUsePermissions: true, updateCenter: true })
  contextBridge.exposeInMainWorld('pipiHost', host)
  contextBridge.exposeInMainWorld('pipiPathForFile', (file: File) => webUtils.getPathForFile(file))
  return host
}

export function exposePipiRemoteControl(
  contextBridge: ContextBridgeLike,
  ipc: RemoteControlIpcRendererLike
): PipiRemoteControlAPI {
  const remote: PipiRemoteControlAPI = {
    invoke: command => ipc.invoke(PIPI_REMOTE_CONTROL_IPC_CHANNEL, command),
    getState: () => ipc.invoke(PIPI_REMOTE_CONTROL_IPC_CHANNEL, { type: 'getState' }),
    start: relayOrigin => ipc.invoke(PIPI_REMOTE_CONTROL_IPC_CHANNEL, { type: 'start', relayOrigin }),
    stop: () => ipc.invoke(PIPI_REMOTE_CONTROL_IPC_CHANNEL, { type: 'stop' }),
    reset: relayOrigin => ipc.invoke(PIPI_REMOTE_CONTROL_IPC_CHANNEL, { type: 'reset', relayOrigin }),
    startDebug: () => ipc.invoke(PIPI_REMOTE_CONTROL_IPC_CHANNEL, { type: 'startDebug' }),
    stopDebug: () => ipc.invoke(PIPI_REMOTE_CONTROL_IPC_CHANNEL, { type: 'stopDebug' }),
    subscribe(listener) {
      const handler = (_event: unknown, state: RemoteControlState) => listener(state)
      ipc.on(PIPI_REMOTE_CONTROL_EVENT_CHANNEL, handler)
      return () => ipc.removeListener(PIPI_REMOTE_CONTROL_EVENT_CHANNEL, handler)
    }
  }
  contextBridge.exposeInMainWorld('pipiRemoteControl', remote)
  return remote
}

exposePipiHost(contextBridge, ipcRenderer)
exposePipiRemoteControl(contextBridge, ipcRenderer)

declare global {
  interface Window {
    pipiHost: PipiHostAPI
    pipiPathForFile?: (file: File) => string
    pipiRemoteControl: PipiRemoteControlAPI
  }
}
