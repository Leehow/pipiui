import { useCallback, useEffect, useRef, useState } from 'react'
import type { PipiHostAPI, UpdateCenterSnapshot } from '@pipi/host-api'

export interface UpdateCenterController {
  available: boolean
  snapshot: UpdateCenterSnapshot | null
  loading: boolean
  error: string | null
  refresh(): Promise<void>
  dismissError(): void
}

/**
 * 更新中心缓存：App 启动时后台检查一次，结果留在内存里。
 * 切 tab / 重开设置不重复请求；只有用户点刷新才再检查。
 */
export function useUpdateCenter(host: PipiHostAPI): UpdateCenterController {
  const check = host.checkForUpdates
  const available = typeof check === 'function'
  const [snapshot, setSnapshot] = useState<UpdateCenterSnapshot | null>(null)
  const [loading, setLoading] = useState(available)
  const [error, setError] = useState<string | null>(null)
  const generationRef = useRef(0)
  const prefetchedRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!check) {
      setLoading(false)
      return
    }
    const generation = ++generationRef.current
    setLoading(true)
    setError(null)
    try {
      const next = await check()
      if (generation !== generationRef.current) return
      setSnapshot(next)
    } catch (reason) {
      if (generation !== generationRef.current) return
      setError(`检查更新失败：${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      if (generation === generationRef.current) setLoading(false)
    }
  }, [check])

  useEffect(() => {
    if (prefetchedRef.current) return
    prefetchedRef.current = true
    void refresh()
  }, [refresh])

  const dismissError = useCallback(() => setError(null), [])

  return { available, snapshot, loading, error, refresh, dismissError }
}
