import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { ProductProfileDescriptor, ProjectProductActivation } from '@pipi/host-api'

import { listWorkbenchContainers, listWorkbenchViews } from './workbench-contributions'
import { createWorkbenchStore, type WorkbenchStore } from './workbench-store'

const LEGACY_CODING_EXTENSION_IDS = Object.freeze([
  'coding-workbench',
  'coding-orchestration',
  'plan-extension',
  'terminal-extension',
  'webview-browser-extension',
  'document-workbench',
  'git-capability',
])

export type ProductWorkbenchRuntime = {
  readonly store: WorkbenchStore
  activateLegacyCodingWorkbench(): () => void
  activateProductWorkbenchProfile(profile: ProductProfileDescriptor, activation?: ProjectProductActivation): () => void
  subscribeActiveProductExtensions(listener: () => void): () => void
  activeProductExtensionsSnapshot(): readonly string[]
}

/**
 * A single rendered PipiUI owns its own Workbench plan and active extensions.
 * Contributions are process-wide registrations, while this runtime is the
 * per-window projection that selects which of those contributions are visible.
 */
export function createProductWorkbenchRuntime(): ProductWorkbenchRuntime {
  const store = createWorkbenchStore()
  let activeExtensionIds: readonly string[] = Object.freeze([])
  let activeGeneration = 0
  const activeListeners = new Set<() => void>()

  const applyActiveExtensionIds = (ids: readonly string[]): (() => void) => {
    const generation = ++activeGeneration
    activeExtensionIds = Object.freeze([...new Set(ids)].sort())
    activeListeners.forEach(listener => listener())
    return () => {
      if (generation !== activeGeneration) return
      activeGeneration += 1
      activeExtensionIds = Object.freeze([])
      activeListeners.forEach(listener => listener())
    }
  }

  const activateLegacyCodingWorkbench = (): (() => void) => {
    const disposeExtensions = applyActiveExtensionIds(LEGACY_CODING_EXTENSION_IDS)
    const disposeWorkbench = store.apply({
      profileId: 'coding',
      containers: [{ id: 'coding.sessions', location: 'primarySidebar', title: '项目与会话', order: 10 }],
      views: [{ id: 'coding.sessions.tree', container: 'coding.sessions' }],
      layout: { primarySidebar: 'coding.sessions', activity: ['coding.sessions'] },
    })
    return () => { disposeWorkbench(); disposeExtensions() }
  }

  const activateProductWorkbenchProfile = (
    profile: ProductProfileDescriptor,
    activation?: ProjectProductActivation,
  ): (() => void) => {
    const layout = profile.layout ?? {}
    const requested = new Set([
      layout.primarySidebar,
      layout.center,
      layout.auxiliarySidebar,
      ...(layout.activity ?? []),
    ].filter((id): id is string => Boolean(id)))
    const containers = listWorkbenchContainers()
      .filter(container => requested.has(container.id))
      .map(({ extensionId: _extensionId, ...container }) => container)
    const known = new Set(containers.map(container => container.id))
    const views = listWorkbenchViews()
      .filter(view => known.has(view.container))
      .map(({ extensionId: _extensionId, render: _render, ...view }) => view)
    const required = new Set(profile.requiredExtensionIds ?? [])
    const active = new Set([...required, ...(profile.recommendedExtensionIds ?? [])])
    for (const [id, state] of Object.entries(activation?.overrides ?? {})) {
      if (state === 'enabled') active.add(id)
      else if (!required.has(id)) active.delete(id)
    }
    const disposeExtensions = applyActiveExtensionIds([...active])
    const disposeWorkbench = store.apply({
      profileId: profile.id,
      containers,
      views,
      layout: {
        ...(layout.primarySidebar && known.has(layout.primarySidebar) ? { primarySidebar: layout.primarySidebar } : {}),
        ...(layout.center && known.has(layout.center) ? { center: layout.center } : {}),
        ...(layout.auxiliarySidebar && known.has(layout.auxiliarySidebar) ? { auxiliarySidebar: layout.auxiliarySidebar } : {}),
        activity: (layout.activity ?? []).filter(id => known.has(id)),
      },
    })
    return () => { disposeWorkbench(); disposeExtensions() }
  }

  const runtime: ProductWorkbenchRuntime = {
    store,
    activateLegacyCodingWorkbench,
    activateProductWorkbenchProfile,
    subscribeActiveProductExtensions(listener) {
      activeListeners.add(listener)
      return () => activeListeners.delete(listener)
    },
    activeProductExtensionsSnapshot: () => activeExtensionIds,
  }

  // Preserve the legacy first paint until the project activation is available.
  runtime.activateLegacyCodingWorkbench()
  return runtime
}

const ProductWorkbenchRuntimeContext = createContext<ProductWorkbenchRuntime | null>(null)

export function ProductWorkbenchProvider({ runtime, children }: { runtime: ProductWorkbenchRuntime; children: ReactNode }) {
  return createElement(ProductWorkbenchRuntimeContext.Provider, { value: runtime }, children)
}

export function useProductWorkbenchRuntime(): ProductWorkbenchRuntime {
  const runtime = useOptionalProductWorkbenchRuntime()
  if (!runtime) throw new Error('ProductWorkbenchProvider is required')
  return runtime
}

export function useOptionalProductWorkbenchRuntime(): ProductWorkbenchRuntime | null {
  return useContext(ProductWorkbenchRuntimeContext)
}

export function useActiveProductExtensions(): readonly string[] {
  const runtime = useProductWorkbenchRuntime()
  return useSyncExternalStore(
    runtime.subscribeActiveProductExtensions,
    runtime.activeProductExtensionsSnapshot,
    runtime.activeProductExtensionsSnapshot,
  )
}

export function useProductExtensionEnabled(id: string): boolean {
  return useActiveProductExtensions().includes(id)
}

export function useActiveProductProfileId(): string {
  const runtime = useProductWorkbenchRuntime()
  return useSyncExternalStore(runtime.store.subscribe, runtime.store.snapshot, runtime.store.snapshot).profileId
}

export function useActiveWorkbenchPlan() {
  const runtime = useProductWorkbenchRuntime()
  return useSyncExternalStore(runtime.store.subscribe, runtime.store.snapshot, runtime.store.snapshot)
}
