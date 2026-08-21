import { createElement, useEffect } from 'react'
import type { ExtensionContributions, ExtensionDescriptor, PipiHostAPI } from '@pipi/host-api'
import { BUILTIN_EXTENSION_ID } from './builtin-extension-id'
import type { Disposer } from './contribution-registry'
import { SchemaSettingsForm } from './schema-settings-form'
import { registerSlashCommand } from './slash-commands'
import { subscribeExt } from './subscribe-ext'
import { registerSettingsSection, registerStatusBarItem } from './ui-registries'

const loaded = new Map<string, Disposer[]>()

function unloadDeclarative(extId: string): void {
  const disposers = loaded.get(extId)
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
  const disposers: Disposer[] = []
  const schema = contrib?.settings?.schema

  for (const section of contrib?.settingsSections ?? []) {
    if (!section.id) continue
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

  for (const command of contrib?.slashCommands ?? []) {
    if (!command.name) continue
    disposers.push(registerSlashCommand(descriptor.id, {
      name: command.name,
      description: command.description ?? '',
      action: { kind: 'send-prompt' },
    }))
  }

  for (const item of contrib?.statusBar ?? []) {
    if (!item.id) continue
    disposers.push(registerStatusBarItem(descriptor.id, {
      id: item.id,
      text: item.text,
      tooltip: item.tooltip,
      alignment: item.alignment,
    }))
  }

  // Panels with or without entry are M3 — do not register a rail tab here.
  loaded.set(descriptor.id, disposers)
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
      syncDeclarativeContributions(resolved)
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
