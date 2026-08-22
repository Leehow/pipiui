import { createElement, useEffect } from 'react'
import type { ExtensionContributions, ExtensionDescriptor, PipiHostAPI } from '@pipi/host-api'
import { BUILTIN_EXTENSION_ID } from './builtin-extension-id'
import {
  hasControlledEntry,
  loadControlledContributions,
  settingsSectionHasEntry,
  type LoadableExtensionDescriptor,
} from './controlled-component-loader'
import type { Disposer } from './contribution-registry'
import { SchemaSettingsForm } from './schema-settings-form'
import { registerSlashCommand } from './slash-commands'
import { subscribeExt } from './subscribe-ext'
import { registerSettingsSection, registerStatusBarItem } from './ui-registries'

const loaded = new Map<string, Disposer[]>()
const controlledLoaded = new Set<string>()

/** Extension ids whose declarative settings sections stay as top-level settings tabs.
 *  Everything else nests inside the「扩展」tab (ExtensionsPane inline schema forms). */
const TOP_LEVEL_SETTINGS_SECTION_EXTENSION_IDS = new Set(['grok-build-oauth'])

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

function uniqueBy<T>(items: readonly T[], key: (item: T) => string | undefined): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const id = key(item)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(item)
  }
  return out
}

function loadDeclarative(descriptor: ExtensionDescriptor): void {
  if (descriptor.id === BUILTIN_EXTENSION_ID) return
  if (loaded.has(descriptor.id)) return
  const contrib = descriptor.contributions
  const ui = (descriptor as LoadableExtensionDescriptor).ui
  const disposers: Disposer[] = []
  const schema = contrib?.settings?.schema

  const settingsSections = uniqueBy(
    [...(ui?.settingsSections ?? []), ...(contrib?.settingsSections ?? [])],
    section => section.id,
  )
  for (const section of settingsSections) {
    if (!section.id || settingsSectionHasEntry(section)) continue
    // Extension-declared schema sections nest under the「扩展」tab instead of the
    // top-level settings dialog; only allowlisted core tabs keep top-level registration.
    if (!TOP_LEVEL_SETTINGS_SECTION_EXTENSION_IDS.has(descriptor.id)) continue
    const title = section.title ?? section.id
    disposers.push(registerSettingsSection(descriptor.id, {
      id: section.id,
      label: title,
      title,
      description: section.description ?? schema?.description ?? '',
      render: ctx => createElement(SchemaSettingsForm, {
        host: ctx.host,
        extensionId: descriptor.id,
        schema,
      }),
    }))
  }

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

async function loadControlled(descriptor: LoadableExtensionDescriptor, host: PipiHostAPI): Promise<void> {
  if (descriptor.id === BUILTIN_EXTENSION_ID) return
  if (controlledLoaded.has(descriptor.id)) return
  if (!hasControlledEntry(descriptor)) return
  const bucket = loaded.get(descriptor.id)
  if (!bucket) return
  controlledLoaded.add(descriptor.id)
  try {
    const extra = await loadControlledContributions(descriptor, host)
    if (!loaded.has(descriptor.id) || !controlledLoaded.has(descriptor.id)) {
      for (const dispose of extra) dispose()
      return
    }
    bucket.push(...extra)
  } catch {
    controlledLoaded.delete(descriptor.id)
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
): Promise<void> {
  syncDeclarativeContributions(descriptors)
  const enabled = descriptors.filter(descriptor => isEnabled(descriptor) && descriptor.id !== BUILTIN_EXTENSION_ID)
  await Promise.all(enabled.map(descriptor => loadControlled(descriptor as LoadableExtensionDescriptor, host)))
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
export function useDeclarativeContributionLoader(host: PipiHostAPI | undefined): void {
  useEffect(() => {
    if (!host) return
    let cancelled = false
    const unsubs: Disposer[] = []
    const subscribed = new Set<string>()

    const refresh = async () => {
      let list: ExtensionDescriptor[] = []
      try {
        list = await host.listExtensions?.() ?? []
      } catch {
        list = []
      }
      if (cancelled) return
      const resolved = await Promise.all(list.map(descriptor => resolveContributions(host, descriptor)))
      if (cancelled) return
      await syncExtensionContributions(resolved, host)
      for (const descriptor of list) {
        if (subscribed.has(descriptor.id)) continue
        subscribed.add(descriptor.id)
        unsubs.push(subscribeExt(host, descriptor.id, () => { void refresh() }))
      }
    }

    void refresh()
    return () => {
      cancelled = true
      for (const unsubscribe of unsubs) unsubscribe()
      resetDeclarativeContributions()
    }
  }, [host])
}
