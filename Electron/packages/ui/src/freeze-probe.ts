export const FREEZE_PROBE_PREFIX = '[DEBUG-h129]'

let historyIpcInflight = 0

export function freezeProbe(kind: string, fields: Record<string, string | number | boolean | undefined> = {}): void {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, '_').slice(0, 180)}`)
  console.warn(`${FREEZE_PROBE_PREFIX} t=${Date.now()} kind=${kind}${parts.length ? ` ${parts.join(' ')}` : ''}`)
}

export function freezeProbeHistoryIpcStart(fields: Record<string, string | number | boolean | undefined>): void {
  historyIpcInflight += 1
  freezeProbe('ui_history_ipc_start', { ...fields, inflight: historyIpcInflight })
}

export function freezeProbeHistoryIpcEnd(fields: Record<string, string | number | boolean | undefined>): void {
  historyIpcInflight = Math.max(0, historyIpcInflight - 1)
  freezeProbe('ui_history_ipc_end', { ...fields, inflight: historyIpcInflight })
}
