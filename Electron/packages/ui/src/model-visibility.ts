import type { Model } from '@pipi/host-api'

/**
 * Model visibility semantics mirroring Swift `ModelVisibility`
 * and the Settings model tab. Pure
 * helpers — shared by the `/model` management modal, the composer quick menu
 * and future consumers such as `/subagent`.
 */

/** Full `provider/modelId` ref — the hiddenModelIds key (Swift ModelInfo.id). */
export function modelRef(model: Pick<Model, 'provider' | 'id'>): string {
  return `${model.provider}/${model.id}`
}

/** Opt-out: everything is visible unless hidden (Swift isVisible). */
export function isModelVisible(model: Model, hiddenIds: ReadonlySet<string>): boolean {
  return !hiddenIds.has(modelRef(model))
}

/**
 * Models shown in the quick menu — mirrors Swift
 * `ModelVisibility.pickerModels`: the currently selected model stays listed
 * even when hidden so the chip never points at a missing entry.
 */
export function pickerModels(all: Model[], hiddenIds: ReadonlySet<string>, current?: Model | null): Model[] {
  return all.filter(model => {
    if (current && model.provider === current.provider && model.id === current.id) return true
    return !hiddenIds.has(modelRef(model))
  })
}

/** Providers in order of appearance (Swift pickerProviders). */
export function pickerProviders(all: Model[], hiddenIds: ReadonlySet<string>, current?: Model | null): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const model of pickerModels(all, hiddenIds, current)) {
    if (!seen.has(model.provider)) {
      seen.add(model.provider)
      result.push(model.provider)
    }
  }
  return result
}

export interface ProviderModelGroup {
  provider: string
  models: Model[]
}

/** Group by provider preserving first-appearance order. */
export function groupByProvider(models: Model[]): ProviderModelGroup[] {
  const byProvider = new Map<string, Model[]>()
  for (const model of models) {
    const list = byProvider.get(model.provider) ?? []
    list.push(model)
    byProvider.set(model.provider, list)
  }
  return [...byProvider.entries()].map(([provider, models]) => ({ provider, models }))
}
