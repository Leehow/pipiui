import { useSyncExternalStore } from 'react'

export type Disposer = () => void

export type ContributionEntry<T> = {
  key: number
  extId: string
  contribution: T
}

export type ContributionRegistry<T> = {
  register(extId: string, contribution: T): Disposer
  disposeExtension(extId: string): void
  list(): readonly T[]
  entries(): readonly ContributionEntry<T>[]
  subscribe(listener: () => void): Disposer
  getSnapshot(): readonly T[]
}

/**
 * Reversible in-memory contribution list. `register` returns a disposer;
 * `disposeExtension` drops every contribution for that extId. Snapshot identity
 * is stable between changes so `useSyncExternalStore` can subscribe cheaply.
 */
export function createContributionRegistry<T>(): ContributionRegistry<T> {
  let nextKey = 1
  let records: ContributionEntry<T>[] = []
  let snapshot: readonly T[] = Object.freeze([])
  const listeners = new Set<() => void>()

  const emit = () => {
    snapshot = Object.freeze(records.map(record => record.contribution))
    for (const listener of listeners) listener()
  }

  const register = (extId: string, contribution: T): Disposer => {
    const key = nextKey++
    records = [...records, { key, extId, contribution }]
    emit()
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      const next = records.filter(record => record.key !== key)
      if (next.length === records.length) return
      records = next
      emit()
    }
  }

  const disposeExtension = (extId: string): void => {
    const next = records.filter(record => record.extId !== extId)
    if (next.length === records.length) return
    records = next
    emit()
  }

  const subscribe = (listener: () => void): Disposer => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  const list = () => snapshot
  const entries = () => records
  const getSnapshot = () => snapshot

  return { register, disposeExtension, list, entries, subscribe, getSnapshot }
}

export function useRegistrySnapshot<T>(registry: ContributionRegistry<T>): readonly T[] {
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
}
