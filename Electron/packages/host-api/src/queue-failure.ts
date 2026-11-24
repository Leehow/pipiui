export type QueueFailureStage = 'lease' | 'session' | 'select_model' | 'prepare_message' | 'dispatch'
export type LoginRecordStatus = 'present' | 'absent' | 'unknown'

export interface QueueFailureDetails {
  stage: QueueFailureStage
  occurredAt: number
  platform: string
  appVersion?: string
  provider?: string
  modelId?: string
  extensionId?: string
  extensionVersion?: string
  mountRequested?: boolean
  settingsSecretInjected?: boolean
  appLogin?: LoginRecordStatus
  sessionLogin?: LoginRecordStatus
}

/** Also applied to errors from older hosts and queue files before display or copy. */
export function safeQueueError(text: string): string {
  return text
    .replace(/\b((?:set-)?cookie)\s*:\s*[^\r\n]+/gi, '$1: [redacted]')
    .replace(/\b(?:https?|wss?):\/\/[^\s<>"']+/gi, '[URL]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, '[redacted]')
    .replace(/(["']?(?:api[-_]?key|access[-_]?token|refresh[-_]?token|password|cookie|authorization)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[redacted]')
    .replace(/\b(?:sk|rt|at)-[\w.-]+/gi, '[redacted]')
    .replace(/\bdata:[^\s,]+;base64,[A-Za-z\d+/=]+/gi, '[attachment]')
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|private|var|tmp)\/)[^\r\n"'<>]*/g, '[path]')
    .slice(0, 2000)
}

/** Decode only known diagnostic fields when reopening a persisted failed row. */
export function parseQueueFailure(value: unknown): QueueFailureDetails | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  if (v.stage !== 'lease' && v.stage !== 'session' && v.stage !== 'select_model'
      && v.stage !== 'prepare_message' && v.stage !== 'dispatch') return undefined
  if (typeof v.occurredAt !== 'number' || !Number.isFinite(new Date(v.occurredAt).getTime())
      || typeof v.platform !== 'string') return undefined
  const result: QueueFailureDetails = { stage: v.stage, occurredAt: v.occurredAt, platform: safeQueueError(v.platform).slice(0, 64) }
  for (const key of ['appVersion', 'provider', 'modelId', 'extensionId', 'extensionVersion'] as const) {
    if (typeof v[key] === 'string') result[key] = safeQueueError(v[key]).slice(0, 200)
  }
  if (typeof v.mountRequested === 'boolean') result.mountRequested = v.mountRequested
  if (typeof v.settingsSecretInjected === 'boolean') result.settingsSecretInjected = v.settingsSecretInjected
  for (const key of ['appLogin', 'sessionLogin'] as const) {
    if (v[key] === 'present' || v[key] === 'absent' || v[key] === 'unknown') result[key] = v[key]
  }
  return result
}
