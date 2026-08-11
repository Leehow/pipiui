import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Model, PipiHostAPI } from '@pipi/host-api'
import { groupByProvider, modelRef, pickerModels, pickerProviders } from './model-visibility'

export interface ModelVisibilityController {
  /** Full catalog (all credentialed models). */
  models: Model[]
  /** Full `provider/modelId` refs the user opted out of. */
  hiddenIds: ReadonlySet<string>
  loading: boolean
  error: string | null
  /** Not-hidden models (management semantics). */
  visibleModels: Model[]
  /** Quick-menu list: not hidden OR currently selected (Swift pickerModels). */
  quickModels: Model[]
  quickProviders: string[]
  quickGroups: ReturnType<typeof groupByProvider>
  refresh(): Promise<void>
  setHidden(model: Model, hidden: boolean): Promise<void>
  /** Hide/show every model of one provider in a single atomic save. */
  setProviderHidden(provider: string, hidden: boolean): Promise<void>
  dismissError(): void
}

class HostVisibilityContractError extends Error {}

function hostContractError(method: string): HostVisibilityContractError {
  return new HostVisibilityContractError(`主进程尚未更新或返回了无效响应（${method}）；请手动退出并重新打开 PipiUI。`)
}

function parseHiddenIds(value: unknown, method: string): Set<string> {
  if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) throw hostContractError(method)
  return new Set(value)
}

function hostMethod(host: PipiHostAPI, name: 'getHiddenModelIds' | 'setHiddenModelIds'): (...args: unknown[]) => Promise<unknown> {
  const method = (host as unknown as Record<string, unknown>)[name]
  if (typeof method !== 'function') throw hostContractError(name)
  return method.bind(host) as (...args: unknown[]) => Promise<unknown>
}

/**
 * Reusable visibility controller shared by the `/model` management modal, the
 * composer quick menu and future `/subagent` model pickers. Reads and writes
 * the host-persisted hiddenModelIds (atomic on the host side).
 *
 * Every host read/write shares one generation clock. Invalid/missing host
 * responses never become an empty Set: the optimistic selection stays visible
 * with an actionable error until a verified host response is available.
 */
export function useModelVisibility(host: PipiHostAPI, current?: Model | null): ModelVisibilityController {
  const [models, setModels] = useState<Model[]>([])
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const hiddenRef = useRef<ReadonlySet<string>>(hiddenIds)
  const persistedRef = useRef<ReadonlySet<string> | null>(null)
  const generationRef = useRef(0)
  const pendingSavesRef = useRef(0)
  const persistChain = useRef<Promise<void>>(Promise.resolve())

  hiddenRef.current = hiddenIds

  const applyHidden = useCallback((next: ReadonlySet<string>) => {
    const copy = new Set(next)
    hiddenRef.current = copy
    setHiddenIds(copy)
  }, [])

  const refresh = useCallback(async () => {
    // A background read must never replace an in-flight optimistic save.
    if (pendingSavesRef.current > 0) return
    const generation = ++generationRef.current
    try {
      const getHidden = hostMethod(host, 'getHiddenModelIds')
      const [list, rawHidden] = await Promise.all([host.listModels(), getHidden()])
      const persisted = parseHiddenIds(rawHidden, 'getHiddenModelIds')
      if (generation !== generationRef.current || pendingSavesRef.current > 0) return
      setModels(list)
      persistedRef.current = persisted
      applyHidden(persisted)
      setError(null)
    } catch (err) {
      if (generation !== generationRef.current || pendingSavesRef.current > 0) return
      setError(`无法加载模型可见性：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (generation === generationRef.current && pendingSavesRef.current === 0) setLoading(false)
    }
  }, [applyHidden, host])

  useEffect(() => { void refresh() }, [refresh])

  const persist = useCallback(async (next: Set<string>) => {
    const generation = ++generationRef.current
    const payload = [...next].sort()
    // This snapshot is intentionally fixed at mutation start. A stale failure
    // may never roll back a later optimistic mutation.
    const rollback = persistedRef.current ? new Set(persistedRef.current) : null
    applyHidden(new Set(payload))
    pendingSavesRef.current += 1

    const run = persistChain.current.then(async () => {
      try {
        if (generation !== generationRef.current) return
        const setHidden = hostMethod(host, 'setHiddenModelIds')
        const rawAck = await setHidden(payload)
        const acknowledged = parseHiddenIds(rawAck, 'setHiddenModelIds')
        if (generation !== generationRef.current) return
        persistedRef.current = acknowledged
        applyHidden(acknowledged)
        setError(null)
      } catch (err) {
        if (generation !== generationRef.current) return
        if (!(err instanceof HostVisibilityContractError) && rollback) {
          persistedRef.current = rollback
          applyHidden(rollback)
        }
        // An invalid/missing ack is ambiguous: do not erase the optimistic UI.
        setError(`保存模型可见性失败：${err instanceof Error ? err.message : String(err)}`)
      } finally {
        pendingSavesRef.current -= 1
        if (generation === generationRef.current) setLoading(false)
      }
    })
    persistChain.current = run.catch(() => undefined)
    await run
  }, [applyHidden, host])

  const setHidden = useCallback(async (model: Model, hidden: boolean) => {
    const next = new Set(hiddenRef.current)
    if (hidden) next.add(modelRef(model))
    else next.delete(modelRef(model))
    await persist(next)
  }, [persist])

  const setProviderHidden = useCallback(async (provider: string, hidden: boolean) => {
    const next = new Set(hiddenRef.current)
    for (const model of models) {
      if (model.provider !== provider) continue
      if (hidden) next.add(modelRef(model))
      else next.delete(modelRef(model))
    }
    await persist(next)
  }, [models, persist])

  const dismissError = useCallback(() => setError(null), [])

  const visibleModels = useMemo(() => models.filter(model => !hiddenIds.has(modelRef(model))), [models, hiddenIds])
  const quickModels = useMemo(() => pickerModels(models, hiddenIds, current), [models, hiddenIds, current])
  const quickProviders = useMemo(() => pickerProviders(models, hiddenIds, current), [models, hiddenIds, current])
  const quickGroups = useMemo(() => groupByProvider(quickModels), [quickModels])

  return { models, hiddenIds, loading, error, visibleModels, quickModels, quickProviders, quickGroups, refresh, setHidden, setProviderHidden, dismissError }
}
