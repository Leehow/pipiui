import { useEffect, useRef } from 'react'
import type { ExtensionContributions, ExtensionDescriptor, PipiHostAPI } from '@pipi/host-api'
import { BUILTIN_EXTENSION_ID } from './builtin-extension-id'
import {
  hasControlledEntry,
  loadControlledContributions,
  type LoadableExtensionDescriptor,
} from './controlled-component-loader'
import type { Disposer } from './contribution-registry'
import { registerSlashCommand } from './slash-commands'
import { subscribeExt } from './subscribe-ext'
import { registerStatusBarItem } from './ui-registries'

const loaded = new Map<string, Disposer[]>()
const controlledLoaded = new Set<string>()

function unloadDeclarative(extId: string): void {
  const disposers = loaded.get(extId)
  controlledLoaded.delete(extId)
  if (!disposers) return
  loaded.delete(extId)
  for (const dispose of disposers) dispose()
}

/** Drop every declarative contribution this loader registered (tests / unmount). */
export function resetDeclarativeContributions(): void {
  for (const extId of [...loaded.keys()]) unloadDeclarative(extId)
}

function loadDeclarative(descriptor: ExtensionDescriptor): void {
  if (descriptor.id === BUILTIN_EXTENSION_ID) return
  if (loaded.has(descriptor.id)) return
  const contrib = descriptor.contributions
  const ui = (descriptor as LoadableExtensionDescriptor).ui
  const disposers: Disposer[] = []

  // Declarative settings sections stay nested under the「扩展」tab. Never promote
  // an extension (including former Grok Build allowlist entries) to a top-level tab.

  for (const command of contrib?.slashCommands ?? ui?.slashCommands ?? []) {
    if (!command.name) continue
    disposers.push(registerSlashCommand(descriptor.id, {
      name: command.name,
      description: command.description ?? '',
      action: { kind: 'send-prompt' },
    }))
  }

  for (const item of contrib?.statusBar ?? ui?.statusBar ?? []) {
    if (!item.id) continue
    disposers.push(registerStatusBarItem(descriptor.id, {
      id: item.id,
      text: item.text,
      tooltip: item.tooltip,
      alignment: item.alignment,
    }))
  }

  loaded.set(descriptor.id, disposers)
}

async function loadControlled(descriptor: LoadableExtensionDescriptor, host: PipiHostAPI, projectId?: string): Promise<void> {
  if (descriptor.id === BUILTIN_EXTENSION_ID) return
  if (controlledLoaded.has(descriptor.id)) return
  if (!hasControlledEntry(descriptor)) return
  const bucket = loaded.get(descriptor.id)
  if (!bucket) return
  controlledLoaded.add(descriptor.id)
  try {
    const extra = await loadControlledContributions(descriptor, host, undefined, projectId)
    if (loaded.get(descriptor.id) !== bucket || !controlledLoaded.has(descriptor.id)) {
      for (const dispose of extra) dispose()
      return
    }
    bucket.push(...extra)
  } catch {
    if (loaded.get(descriptor.id) === bucket) controlledLoaded.delete(descriptor.id)
  }
}

function isEnabled(descriptor: ExtensionDescriptor): boolean {
  return descriptor.state === 'enabled'
}

/**
 * Align M1 registries with enabled descriptors. Disable/unload disposes the
 * group this loader registered (slash / schema settings / statusBar) with no residue.
 */
export function syncDeclarativeContributions(descriptors: readonly ExtensionDescriptor[]): void {
  const enabled = descriptors.filter(descriptor => isEnabled(descriptor) && descriptor.id !== BUILTIN_EXTENSION_ID)
  const wanted = new Set(enabled.map(descriptor => descriptor.id))
  for (const extId of [...loaded.keys()]) {
    if (!wanted.has(extId)) unloadDeclarative(extId)
  }
  for (const descriptor of enabled) loadDeclarative(descriptor)
}

/** L0 declarative + M3 controlled entries. Disable/unload disposes the whole group. */
export async function syncExtensionContributions(
  descriptors: readonly ExtensionDescriptor[],
  host: PipiHostAPI,
  projectId?: string,
): Promise<void> {
  syncDeclarativeContributions(descriptors)
  const enabled = descriptors.filter(descriptor => isEnabled(descriptor) && descriptor.id !== BUILTIN_EXTENSION_ID)
  await Promise.all(enabled.map(descriptor => loadControlled(descriptor as LoadableExtensionDescriptor, host, projectId)))
}

async function resolveContributions(
  host: PipiHostAPI,
  descriptor: ExtensionDescriptor,
): Promise<ExtensionDescriptor> {
  if (descriptor.contributions || descriptor.id === BUILTIN_EXTENSION_ID) return descriptor
  try {
    const extra: ExtensionContributions | undefined = await host.getExtensionContributions?.(descriptor.id)
    return extra ? { ...descriptor, contributions: extra } : descriptor
  } catch {
    return descriptor
  }
}

/** Start-up + enable/disable refresh via listExtensions and subscribeExt. */
export function useDeclarativeContributionLoader(host: PipiHostAPI | undefined, projectId?: string): void {
  const refreshGeneration = useRef(0)
  useEffect(() => {
    const generation = ++refreshGeneration.current
    if (!host) return
    let cancelled = false
    const unsubs: Disposer[] = []
    const subscribed = new Set<string>()
    const isCurrent = () => !cancelled && refreshGeneration.current === generation

    const refresh = async () => {
      let list: ExtensionDescriptor[] = []
      try {
        list = await host.listExtensions?.(projectId) ?? []
      } catch {
        list = []
      }
      if (!isCurrent()) return
      const resolved = await Promise.all(list.map(descriptor => resolveContributions(host, descriptor)))
      if (!isCurrent()) return
      await syncExtensionContributions(resolved, host, projectId)
      if (!isCurrent()) return
      for (const descriptor of list) {
        if (subscribed.has(descriptor.id)) continue
        subscribed.add(descriptor.id)
        unsubs.push(subscribeExt(host, descriptor.id, () => { void refresh() }))
      }
    }

    void refresh()
    return () => {
      cancelled = true
      if (refreshGeneration.current === generation) refreshGeneration.current += 1
      for (const unsubscribe of unsubs) unsubscribe()
      resetDeclarativeContributions()
    }
  }, [host, projectId])
}
