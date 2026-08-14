import { useCallback, useEffect, useRef, useState } from 'react'
import type { PipiHostAPI } from '@pipi/host-api'

/**
 * Optional vision-routing host surface. `getVisionModel/setVisionModel` are
 * already declared on PipiHostAPI; `getVisionEnabled/setVisionEnabled` are
 * being added to host-api in parallel (another worker). Until those land, the
 * methods are reached through a local narrowing so this package compiles and
 * degrades gracefully against an older backend (all four stay optional).
 */
export interface VisionHostMethods {
  getVisionEnabled?(): Promise<boolean>
  setVisionEnabled?(enabled: boolean): Promise<boolean>
  getVisionModel?(): Promise<string | null>
  setVisionModel?(ref: string | null): Promise<string | null>
}

export interface VisionRoutingController {
  /** 识图路由开关是否开启。 */
  enabled: boolean
  /** 已选识图模型的完整 `provider/modelId` 引用；未选择时为 null。 */
  model: string | null
  /** 当前连接是否提供这套可选方法（老后端为 false，UI 显示不支持）。 */
  available: boolean
  loading: boolean
  saving: boolean
  error: string | null
  refresh(): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
  setModel(ref: string | null): Promise<void>
  dismissError(): void
}

/** Local type narrowing: host-api 的 getVisionEnabled/setVisionEnabled 尚未落地。 */
export function visionHostMethods(host: PipiHostAPI): VisionHostMethods {
  return host as unknown as VisionHostMethods
}

/**
 * 识图路由（设置 > 通用 tab）状态：开关 + 已选识图模型。挂载时读取
 * getVisionEnabled/getVisionModel，切换/选择时乐观更新、主机持久化，
 * 失败回滚（仿 ComputerUsePanel 的乐观开关模式）。关闭开关时同时清空
 * 已选识图模型（setVisionModel(null)）。Composer 的图片发送门槛与
 * 通用 tab 共享这份状态。
 */
export function useVisionRouting(host: PipiHostAPI): VisionRoutingController {
  const methods = visionHostMethods(host)
  const hasSurface = typeof methods.getVisionEnabled === 'function'
    && typeof methods.setVisionEnabled === 'function'
    && typeof methods.getVisionModel === 'function'
    && typeof methods.setVisionModel === 'function'
  const [available, setAvailable] = useState(hasSurface)
  const [enabled, setEnabledState] = useState(false)
  const [model, setModelState] = useState<string | null>(null)
  const [loading, setLoading] = useState(hasSurface)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generationRef = useRef(0)
  const persistedRef = useRef<{ enabled: boolean; model: string | null }>({ enabled: false, model: null })

  const refresh = useCallback(async () => {
    if (!hasSurface) { setAvailable(false); setLoading(false); return }
    const generation = ++generationRef.current
    try {
      const [nextEnabled, nextModel] = await Promise.all([methods.getVisionEnabled!(), methods.getVisionModel!()])
      if (generation !== generationRef.current) return
      persistedRef.current = { enabled: nextEnabled === true, model: typeof nextModel === 'string' ? nextModel : null }
      setEnabledState(persistedRef.current.enabled)
      setModelState(persistedRef.current.model)
      setError(null)
    } catch (err) {
      if (generation !== generationRef.current) return
      setAvailable(false)
      setError(`读取识图设置失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (generation === generationRef.current) setLoading(false)
    }
  }, [hasSurface, methods])

  useEffect(() => { void refresh() }, [refresh])

  const setEnabled = useCallback(async (next: boolean) => {
    if (!hasSurface || saving) return
    const generation = ++generationRef.current
    const rollback = persistedRef.current
    setSaving(true)
    setError(null)
    // 乐观更新；关闭开关时同时清空已选识图模型。
    setEnabledState(next)
    if (!next) setModelState(null)
    try {
      const ack = await methods.setVisionEnabled!(next)
      let nextModel = rollback.model
      if (!next) {
        const cleared = await methods.setVisionModel!(null)
        nextModel = typeof cleared === 'string' ? cleared : null
      }
      if (generation !== generationRef.current) return
      persistedRef.current = { enabled: ack === true, model: nextModel }
      setEnabledState(persistedRef.current.enabled)
      setModelState(persistedRef.current.model)
    } catch (err) {
      if (generation !== generationRef.current) return
      persistedRef.current = rollback
      setEnabledState(rollback.enabled)
      setModelState(rollback.model)
      setError(`保存识图设置失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (generation === generationRef.current) setSaving(false)
    }
  }, [hasSurface, methods, saving])

  const setModel = useCallback(async (ref: string | null) => {
    if (!hasSurface || !enabled || saving) return
    const generation = ++generationRef.current
    const rollback = persistedRef.current
    setSaving(true)
    setError(null)
    setModelState(ref)
    try {
      const ack = await methods.setVisionModel!(ref)
      if (generation !== generationRef.current) return
      persistedRef.current = { enabled: rollback.enabled, model: typeof ack === 'string' ? ack : null }
      setModelState(persistedRef.current.model)
    } catch (err) {
      if (generation !== generationRef.current) return
      persistedRef.current = rollback
      setModelState(rollback.model)
      setError(`保存识图模型失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (generation === generationRef.current) setSaving(false)
    }
  }, [hasSurface, methods, enabled, saving])

  const dismissError = useCallback(() => setError(null), [])

  return { enabled, model, available, loading, saving, error, refresh, setEnabled, setModel, dismissError }
}
