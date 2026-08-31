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

export type RemoteLinkCheckStatus = 'idle' | 'checking' | 'ok' | 'failed'

export type RemoteLinkCheck = {
  status: RemoteLinkCheckStatus
  pairUrl: string | null
  reason?: string
  checkedAt?: number
}

export type RemoteControlState = {
  enabled: boolean
  status: RemoteControlStatus
  pairUrl: string | null
  roomID: string | null
  relayOrigin: string | null
  hostEpoch: number | null
  generation: number | null
  error?: string
  rotationNotice?: string | null
  debugEnabled?: boolean
  debugUrl?: string | null
  debugError?: string
  linkCheck?: RemoteLinkCheck
}

export type RemoteControlCommand =
  | { type: 'getState' }
  | { type: 'start'; relayOrigin?: string }
  | { type: 'stop' }
  | { type: 'reset'; relayOrigin?: string }
  | { type: 'startDebug' }
  | { type: 'stopDebug' }
  | { type: 'checkLink' }
