import { useMemo, type ReactNode } from 'react'

import { createContributionRegistry, useRegistrySnapshot, type Disposer } from '../contribution-registry'
import { useActiveProductExtensions } from './workbench-runtime'

export type ComposerActionContext = {
  sessionId: string
  model?: {provider: string; id: string; api?: string}
  disabled: boolean
}

export type ComposerActionContribution = {
  id: string
  order?: number
  render: (context: ComposerActionContext) => ReactNode
}

const registry = createContributionRegistry<ComposerActionContribution>()

export function registerComposerAction(extensionId: string, contribution: ComposerActionContribution): Disposer {
  return registry.register(extensionId, contribution)
}

export function useComposerActions(): readonly ComposerActionContribution[] {
  const snapshot = useRegistrySnapshot(registry)
  const active = useActiveProductExtensions()
  return useMemo(() => {
    const allowed = new Set(active)
    return registry.entries()
      .filter(entry => allowed.has(entry.extId))
      .map(entry => entry.contribution)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
  }, [snapshot, active])
}

export function disposeComposerActions(extensionId: string): void {
  registry.disposeExtension(extensionId)
}

/** Test-only inspection of registered actions; visibility remains profile-controlled. */
export function listComposerActions(): readonly ComposerActionContribution[] {
  return registry.list()
}
