export const PIPI_REMOTE_CONTROL_IPC_CHANNEL = 'pipi-remote-control:v1'
export const PIPI_REMOTE_CONTROL_EVENT_CHANNEL = 'pipi-remote-control:event'

export type RemoteControlStatus =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'paired'
  | 'reconnecting'
  | 'stopped'
  | 'error'

export type RemoteControlState = {
  enabled: boolean
  status: RemoteControlStatus
  pairUrl: string | null
  roomID: string | null
  relayOrigin: string | null
  hostEpoch: number | null
  generation: number | null
  error?: string
  debugEnabled?: boolean
  debugUrl?: string | null
  debugError?: string
}

export type RemoteControlCommand =
  | { type: 'getState' }
  | { type: 'start'; relayOrigin?: string }
  | { type: 'stop' }
  | { type: 'reset'; relayOrigin?: string }
  | { type: 'startDebug' }
  | { type: 'stopDebug' }
