import { useMemo, type ReactNode } from 'react'
import type { PipiHostAPI } from '@pipi/host-api'

import { createContributionRegistry, useRegistrySnapshot, type Disposer } from '../contribution-registry'
import { useActiveProductExtensions } from './workbench-runtime'

export type HeaderActionContext = {
  host: PipiHostAPI
  workspaceId?: string
  hostCapabilities: { git: boolean }
}

export type HeaderActionContribution = {
  id: string
  order?: number
  render: (context: HeaderActionContext) => ReactNode
}

const registry = createContributionRegistry<HeaderActionContribution>()

export function registerHeaderAction(extensionId: string, contribution: HeaderActionContribution): Disposer {
  return registry.register(extensionId, contribution)
}

export function useHeaderActions(): readonly HeaderActionContribution[] {
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

export function disposeHeaderActions(extensionId: string): void {
  registry.disposeExtension(extensionId)
}

/** Test-only inspection of registered actions; visibility remains profile-controlled. */
export function listHeaderActions(): readonly HeaderActionContribution[] {
  return registry.list()
}
