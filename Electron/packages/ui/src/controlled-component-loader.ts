import { createElement, type ComponentType } from 'react'
import { createExtensionHostAPI, type ExtensionHostAPI } from '@pipiui/extension-api'
import type { PipiHostAPI } from '@pipi/host-api'
import type { Disposer } from './contribution-registry'
import { registerPanel, registerSettingsSection, registerToolRenderer } from './ui-registries'

const EXTENSION_PANEL_ICON = {
  src: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="#000" stroke-width="1.6"/></svg>')}`,
  ratio: 1,
}

export type ControlledUiPanel = { id: string; title?: string; slot?: string; entry?: string }
export type ControlledUiToolRenderer = { tool: string; entry?: string }
export type ControlledUiSettingsSection = { id: string; title?: string; description?: string; entry?: string }

export type LoadableExtensionDescriptor = {
  id: string
  state?: string
  capabilities?: readonly string[]
  directory?: string
  installPath?: string
  root?: string
  ui?: {
    panels?: readonly ControlledUiPanel[]
    toolRenderers?: readonly ControlledUiToolRenderer[]
    settingsSections?: readonly ControlledUiSettingsSection[]
    slashCommands?: readonly { name: string; description?: string }[]
    statusBar?: readonly { id: string; text?: string; tooltip?: string; alignment?: 'left' | 'right' }[]
  }
  contributions?: {
    panels?: readonly ControlledUiPanel[]
    toolRenderers?: readonly ControlledUiToolRenderer[]
    settingsSections?: readonly ControlledUiSettingsSection[]
  }
}

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/** Resolve a manifest `entry` against the package directory supplied by the host descriptor. */
export function resolveEntrySpecifier(directory: string | undefined, entry: string): string {
  const trimmed = entry.trim()
  if (!trimmed) throw new Error('missing entry')
  if (SCHEME.test(trimmed)) return trimmed
  if (trimmed.includes('..')) throw new Error('entry path must not contain ..')
  const root = directory?.trim()
  if (!root) throw new Error('extension directory missing for entry')
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const rel = trimmed.replace(/\\/g, '/').replace(/^\/+/, '')
  const joined = `${normalizedRoot}/${rel}`
  if (joined.startsWith('/')) return `file://${joined}`
  return joined
}

export async function importExtensionEntry(specifier: string): Promise<unknown> {
  return import(/* @vite-ignore */ specifier)
}

function componentFromModule(mod: unknown): ComponentType<Record<string, unknown>> | undefined {
  if (typeof mod === 'function') return mod as ComponentType<Record<string, unknown>>
  if (mod && typeof mod === 'object') {
    const record = mod as Record<string, unknown>
    for (const key of ['default', 'render', 'Panel', 'SettingsSection', 'ToolRenderer']) {
      if (typeof record[key] === 'function') return record[key] as ComponentType<Record<string, unknown>>
    }
  }
  return undefined
}

function packageDirectory(descriptor: LoadableExtensionDescriptor): string | undefined {
  return descriptor.directory ?? descriptor.installPath ?? descriptor.root
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorPlaceholder(message: string) {
  return createElement('div', {
    className: 'empty-panel',
    'data-testid': 'ext-contribution-error',
    role: 'alert',
  }, message)
}

function registerPanelError(extId: string, panel: ControlledUiPanel, message: string): Disposer {
  return registerPanel(extId, {
    id: panel.id,
    icon: EXTENSION_PANEL_ICON,
    render: ctx => createElement('div', { className: 'tool-page', hidden: !ctx.active },
      errorPlaceholder(`扩展面板「${panel.title ?? panel.id}」加载失败：${message}`),
    ),
  })
}

function registerSettingsError(extId: string, section: ControlledUiSettingsSection, message: string): Disposer {
  const title = section.title ?? section.id
  return registerSettingsSection(extId, {
    id: section.id,
    label: title,
    title,
    description: section.description ?? '',
    render: () => errorPlaceholder(`扩展设置「${title}」加载失败：${message}`),
  })
}

async function loadComponent(
  directory: string | undefined,
  entry: string,
  importModule: (specifier: string) => Promise<unknown>,
): Promise<ComponentType<Record<string, unknown>>> {
  const specifier = resolveEntrySpecifier(directory, entry)
  const mod = await importModule(specifier)
  const component = componentFromModule(mod)
  if (!component) throw new Error('entry module did not export a component')
  return component
}

function createApi(descriptor: LoadableExtensionDescriptor, host: PipiHostAPI): ExtensionHostAPI {
  return createExtensionHostAPI({
    extensionId: descriptor.id,
    capabilities: descriptor.capabilities ?? [],
    host,
  })
}

/**
 * Load controlled React entries (panel / toolRenderer / settingsSection with `entry`)
 * and register them into the M1 registries. Failures become readable placeholders.
 */
export async function loadControlledContributions(
  descriptor: LoadableExtensionDescriptor,
  host: PipiHostAPI,
  importModule: (specifier: string) => Promise<unknown> = importExtensionEntry,
): Promise<Disposer[]> {
  const directory = packageDirectory(descriptor)
  const ui = descriptor.ui
  const contrib = descriptor.contributions
  const panels = [...(ui?.panels ?? []), ...(contrib?.panels ?? [])]
  const renderers = [...(ui?.toolRenderers ?? []), ...(contrib?.toolRenderers ?? [])]
  const sections = [...(ui?.settingsSections ?? []), ...(contrib?.settingsSections ?? [])]
  const disposers: Disposer[] = []
  const seenPanel = new Set<string>()
  const seenTool = new Set<string>()
  const seenSection = new Set<string>()
  const api = createApi(descriptor, host)

  for (const panel of panels) {
    const entry = panel.entry?.trim()
    if (!entry || !panel.id || seenPanel.has(panel.id)) continue
    seenPanel.add(panel.id)
    try {
      const Component = await loadComponent(directory, entry, importModule)
      const title = panel.title ?? panel.id
      disposers.push(registerPanel(descriptor.id, {
        id: panel.id,
        icon: EXTENSION_PANEL_ICON,
        render: ctx => createElement('div', { className: 'tool-page', hidden: !ctx.active },
          createElement(Component, { api, id: panel.id, title }),
        ),
      }))
    } catch (error) {
      disposers.push(registerPanelError(descriptor.id, panel, errorMessage(error)))
    }
  }

  for (const renderer of renderers) {
    const entry = renderer.entry?.trim()
    if (!entry || !renderer.tool || seenTool.has(renderer.tool)) continue
    seenTool.add(renderer.tool)
    try {
      const Component = await loadComponent(directory, entry, importModule)
      disposers.push(registerToolRenderer(descriptor.id, {
        toolName: renderer.tool,
        render: ({ content, details }) => createElement(Component, { content, details }),
      }))
    } catch {
      // No panel slot: leave the default tool card. Do not crash the host.
    }
  }

  for (const section of sections) {
    const entry = section.entry?.trim()
    if (!entry || !section.id || seenSection.has(section.id)) continue
    seenSection.add(section.id)
    const title = section.title ?? section.id
    try {
      const Component = await loadComponent(directory, entry, importModule)
      disposers.push(registerSettingsSection(descriptor.id, {
        id: section.id,
        label: title,
        title,
        description: section.description ?? '',
        render: () => createElement(Component, { api, id: section.id, title }),
      }))
    } catch (error) {
      disposers.push(registerSettingsError(descriptor.id, section, errorMessage(error)))
    }
  }

  return disposers
}

export function hasControlledEntry(descriptor: LoadableExtensionDescriptor): boolean {
  const ui = descriptor.ui
  const contrib = descriptor.contributions
  const has = (items: ReadonlyArray<{ entry?: string }> | undefined) =>
    (items ?? []).some(item => Boolean(item.entry?.trim()))
  return has(ui?.panels) || has(ui?.toolRenderers) || has(ui?.settingsSections)
    || has(contrib?.panels) || has(contrib?.toolRenderers) || has(contrib?.settingsSections)
}

export function settingsSectionHasEntry(section: unknown): boolean {
  if (!section || typeof section !== 'object') return false
  const entry = (section as { entry?: unknown }).entry
  return typeof entry === 'string' && Boolean(entry.trim())
}
