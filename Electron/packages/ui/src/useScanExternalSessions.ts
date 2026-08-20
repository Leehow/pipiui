import { useCallback, useEffect, useRef, useState } from 'react'
import type { PipiHostAPI } from '@pipi/host-api'

export interface ScanExternalSessionsController {
  /** 是否扫描并展示其他 coding agent 的聊天记录。缺省为开。 */
  enabled: boolean
  available: boolean
  loading: boolean
  saving: boolean
  error: string | null
  refresh(): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
  dismissError(): void
}

export function useScanExternalSessions(host: PipiHostAPI): ScanExternalSessionsController {
  const get = host.getScanExternalSessions
  const set = host.setScanExternalSessions
  const hasSurface = typeof get === 'function' && typeof set === 'function'
  const [available, setAvailable] = useState(hasSurface)
  const [enabled, setEnabledState] = useState(true)
  const [loading, setLoading] = useState(hasSurface)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generationRef = useRef(0)
  const persistedRef = useRef(true)

  const refresh = useCallback(async () => {
    if (!hasSurface || !get) { setAvailable(false); setLoading(false); return }
    const generation = ++generationRef.current
    try {
      const next = await get()
      if (generation !== generationRef.current) return
      persistedRef.current = next !== false
      setEnabledState(persistedRef.current)
      setError(null)
    } catch (err) {
      if (generation !== generationRef.current) return
      setAvailable(false)
      setError(`读取外部会话扫描设置失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (generation === generationRef.current) setLoading(false)
    }
  }, [get, hasSurface])

  useEffect(() => { void refresh() }, [refresh])

  const setEnabled = useCallback(async (next: boolean) => {
    if (!hasSurface || !set || saving) return
    const generation = ++generationRef.current
    const rollback = persistedRef.current
    setSaving(true)
    setError(null)
    setEnabledState(next)
    try {
      const ack = await set(next)
      if (generation !== generationRef.current) return
      persistedRef.current = ack !== false
      setEnabledState(persistedRef.current)
    } catch (err) {
      if (generation !== generationRef.current) return
      persistedRef.current = rollback
      setEnabledState(rollback)
      setError(`保存外部会话扫描设置失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (generation === generationRef.current) setSaving(false)
    }
  }, [hasSurface, saving, set])

  const dismissError = useCallback(() => setError(null), [])

  return { enabled, available, loading, saving, error, refresh, setEnabled, dismissError }
}
