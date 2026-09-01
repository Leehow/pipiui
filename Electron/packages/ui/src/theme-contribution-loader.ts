import { useEffect, useRef } from 'react'
import type { ExtensionDescriptor, PipiHostAPI } from '@pipi/host-api'
import type { Disposer } from './contribution-registry'
import { BUILTIN_EXTENSION_ID } from './builtin-extension-id'
import { subscribeExt } from './subscribe-ext'
import { setContributedThemes, validateThemeContribution, type ThemeDefinition } from './theme-registry'

/** Collect validated theme contributions from every enabled extension, in a
 *  stable extension-id order. Bad entries and duplicate ids are dropped with a
 *  console warning — fail-closed per theme, never throwing into the renderer. */
export function collectThemeContributions(descriptors: readonly ExtensionDescriptor[]): ThemeDefinition[] {
  const out: ThemeDefinition[] = []
  const seen = new Set<string>()
  const enabled = descriptors
    .filter(descriptor => descriptor.state === 'enabled' && descriptor.id !== BUILTIN_EXTENSION_ID)
    .sort((a, b) => a.id.localeCompare(b.id))
  for (const descriptor of enabled) {
    const themes = descriptor.ui?.themes
    if (!Array.isArray(themes)) continue
    for (const raw of themes) {
      const theme = validateThemeContribution(raw)
      if (!theme) {
        console.warn(`[themes] ${descriptor.id} 贡献了非法主题，已丢弃`, raw)
        continue
      }
      if (seen.has(theme.id)) {
        console.warn(`[themes] 主题 id 冲突 "${theme.id}"（${descriptor.id}），已丢弃后者`)
        continue
      }
      seen.add(theme.id)
      out.push(theme)
    }
  }
  return out
}

/** Sync extension-contributed themes into the theme registry: startup plus
 *  enable/disable refresh via listExtensions and per-extension subscribeExt —
 *  the same pattern as useDeclarativeContributionLoader. */
export function useExtensionThemeSync(host: PipiHostAPI | undefined, projectId?: string): void {
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
      setContributedThemes(collectThemeContributions(list))
      for (const descriptor of list) {
        if (subscribed.has(descriptor.id)) continue
        subscribed.add(descriptor.id)
        unsubs.push(subscribeExt(host, descriptor.id, () => { void refresh() }))
      }
    }
    void refresh()
    return () => {
      cancelled = true
      for (const unsub of unsubs) unsub()
    }
  }, [host, projectId])
}
