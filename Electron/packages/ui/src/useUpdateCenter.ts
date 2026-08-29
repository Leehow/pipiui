import { useCallback, useEffect, useRef, useState } from 'react'
import type { PipiHostAPI, UpdateCenterSnapshot } from '@pipi/host-api'

export interface UpdateCenterController {
  available: boolean
  snapshot: UpdateCenterSnapshot | null
  loading: boolean
  error: string | null
  /** Extension id currently running a one-click update, if any. */
  updatingExtensionId: string | null
  refresh(): Promise<void>
  updateComponent(extensionId: string): Promise<void>
  dismissError(): void
}

/**
 * 更新中心缓存：App 启动时后台检查一次，结果留在内存里。
 * 切 tab / 重开设置不重复请求；只有用户点刷新才再检查。
 */
export function useUpdateCenter(host: PipiHostAPI): UpdateCenterController {
  const check = host.checkForUpdates
  const updateComponentMethod = host.updateExtensionComponent
  const available = typeof check === 'function'
  const [snapshot, setSnapshot] = useState<UpdateCenterSnapshot | null>(null)
  const [loading, setLoading] = useState(available)
  const [error, setError] = useState<string | null>(null)
  const [updatingExtensionId, setUpdatingExtensionId] = useState<string | null>(null)
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

  const updateComponent = useCallback(async (extensionId: string) => {
    if (!updateComponentMethod || updatingExtensionId) return
    setUpdatingExtensionId(extensionId)
    setError(null)
    try {
      await updateComponentMethod(extensionId)
      // New versions take effect from new sessions; the catalog now reports the
      // installed store version, so refresh discovery in place.
      await refresh()
    } catch (reason) {
      setError(`一键更新失败：${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      setUpdatingExtensionId(null)
    }
  }, [updateComponentMethod, refresh, updatingExtensionId])

  return { available, snapshot, loading, error, updatingExtensionId, refresh, updateComponent, dismissError }
}
