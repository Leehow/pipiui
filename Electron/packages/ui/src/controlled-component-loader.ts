import * as ReactRuntime from 'react'
import { createElement, type ComponentType } from 'react'
import { createExtensionHostAPI, type ExtensionHostAPI, type HeaderActionProps } from '@pipiui/extension-api'
import type { PipiHostAPI } from '@pipi/host-api'
import type { Disposer } from './contribution-registry'
import { registerDocumentRenderer, registerPanel, registerSettingsSection, registerToolRenderer } from './ui-registries'
import { registerWorkbenchContainer, registerWorkbenchView } from './workbench/workbench-contributions'
import { registerHeaderAction } from './workbench/header-actions'

const EXTENSION_PANEL_ICON = {
  src: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="#000" stroke-width="1.6"/></svg>')}`,
  ratio: 1,
}

export type ControlledUiPanel = { id: string; title?: string; slot?: string; entry?: string; icon?: string }
export type ControlledUiToolRenderer = { tool: string; entry?: string }
export type ControlledUiHeaderAction = { id: string; entry?: string; order?: number }
export type ControlledUiDocumentRenderer = {
  id: string
  entry?: string
  kinds?: readonly string[]
  extensions?: readonly string[]
  mimeTypes?: readonly string[]
  priority?: number
}
export type ControlledUiSettingsSection = { id: string; title?: string; description?: string; entry?: string }
export type ControlledUiViewContainer = {
  id: string
  location: 'primarySidebar' | 'center' | 'auxiliarySidebar' | 'statusBar' | 'overlay'
  title: string
  icon?: string
  order?: number
}
export type ControlledUiView = { id: string; container: string; entry?: string; activation?: 'visible' }

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
    documentRenderers?: readonly ControlledUiDocumentRenderer[]
    settingsSections?: readonly ControlledUiSettingsSection[]
    slashCommands?: readonly { name: string; description?: string }[]
    statusBar?: readonly { id: string; text?: string; tooltip?: string; alignment?: 'left' | 'right' }[]
    viewContainers?: readonly ControlledUiViewContainer[]
    views?: readonly ControlledUiView[]
    headerActions?: readonly ControlledUiHeaderAction[]
  }
  contributions?: {
    panels?: readonly ControlledUiPanel[]
    toolRenderers?: readonly ControlledUiToolRenderer[]
    settingsSections?: readonly ControlledUiSettingsSection[]
    viewContainers?: readonly ControlledUiViewContainer[]
    views?: readonly ControlledUiView[]
    headerActions?: readonly ControlledUiHeaderAction[]
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

/** Chromium cannot import file:// extension paths; host-read source stays within the existing RPC boundary. */
export async function importExtensionSource(source: string): Promise<unknown> {
  const specifier = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`
  return import(/* @vite-ignore */ specifier)
}

function componentFromModule(mod: unknown): ComponentType<Record<string, unknown>> | undefined {
  if (typeof mod === 'function') return mod as ComponentType<Record<string, unknown>>
  if (mod && typeof mod === 'object') {
    const record = mod as Record<string, unknown>
    for (const key of ['default', 'render', 'Panel', 'SettingsSection', 'ToolRenderer', 'DocumentRenderer', 'HeaderAction']) {
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

function registerPanelError(
  extId: string,
  panel: ControlledUiPanel,
  message: string,
  icon: { src: string; ratio: number } = EXTENSION_PANEL_ICON,
): Disposer {
  return registerPanel(extId, {
    id: panel.id,
    icon,
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

type EntryModuleLoader = (entry: string) => Promise<unknown>

/**
 * Controlled entries are imported as file:// / data: modules where a bare `react`
 * import cannot resolve (the renderer has no import map), so — like
 * `createHeaderAction` — an entry may export `createComponent(React)` and build its
 * component from the host's single React instance. A plain component export keeps
 * working for entries whose build already externalised React.
 */
async function loadComponent(
  entry: string,
  loadEntryModule: EntryModuleLoader,
): Promise<ComponentType<Record<string, unknown>>> {
  const mod = await loadEntryModule(entry)
  if (mod && typeof mod === 'object') {
    const factory = (mod as Record<string, unknown>).createComponent
    if (typeof factory === 'function') {
      const component = (factory as (react: typeof ReactRuntime) => unknown)(ReactRuntime)
      if (typeof component === 'function') return component as ComponentType<Record<string, unknown>>
      throw new Error('createComponent did not return a component')
    }
  }
  const component = componentFromModule(mod)
  if (!component) throw new Error('entry module did not export a component')
  return component
}

/**
 * A panel's rail icon, read through the same confined host RPC as an entry and inlined
 * as a data: URL (the rail masks the shape, so only geometry survives). `ratio` comes
 * from the SVG's own viewBox so a wide glyph is not squeezed into a square.
 *
 * Every failure — no host method, undeclared path, unreadable file, unparseable SVG —
 * falls back to the generic icon: an extension must never lose its panel over artwork.
 */
async function loadPanelIcon(
  extensionId: string,
  icon: string | undefined,
  readSource: ((entry: string) => Promise<string>) | undefined,
): Promise<{ src: string; ratio: number } | undefined> {
  const path = icon?.trim()
  if (!path || !readSource) return undefined
  try {
    const source = await readSource(path)
    if (!source.trim().startsWith('<')) return undefined
    return { src: `data:image/svg+xml,${encodeURIComponent(source)}`, ratio: svgRatio(source) }
  } catch {
    return undefined
  }
}

/** width/height from `viewBox`; 1 when it is absent or degenerate. */
export function svgRatio(source: string): number {
  const match = /viewBox\s*=\s*["']\s*[-\d.]+[,\s]+[-\d.]+[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(source)
  if (!match) return 1
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1
  return width / height
}

async function loadHeaderActionComponent(
  entry: string,
  loadEntryModule: EntryModuleLoader,
): Promise<ComponentType<Record<string, unknown>>> {
  const mod = await loadEntryModule(entry)
  if (mod && typeof mod === 'object') {
    const factory = (mod as Record<string, unknown>).createHeaderAction
    if (typeof factory === 'function') {
      const component = (factory as (react: typeof ReactRuntime) => unknown)(ReactRuntime)
      if (typeof component === 'function') return component as ComponentType<Record<string, unknown>>
      throw new Error('createHeaderAction did not return a component')
    }
  }
  const component = componentFromModule(mod)
  if (!component) throw new Error('header entry did not export createHeaderAction or a component')
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
  importModule?: (specifier: string) => Promise<unknown>,
  projectId?: string,
): Promise<Disposer[]> {
  const directory = packageDirectory(descriptor)
  const resolvedImportModule = importModule ?? importExtensionEntry
  const loadFileEntryModule: EntryModuleLoader = entry =>
    resolvedImportModule(resolveEntrySpecifier(directory, entry))
  // Unlike an entry, an icon has no module path to fall back to, so it uses the host
  // reader whenever there is one — including under an injected `importModule`.
  const readUiEntrySource = host.getExtensionUiEntrySource
    ? (entry: string) => host.getExtensionUiEntrySource!(descriptor.id, entry, projectId)
    : undefined
  const loadHeaderEntryModule: EntryModuleLoader = async entry => {
    if (!importModule && host.getExtensionUiEntrySource) {
      const source = await host.getExtensionUiEntrySource(descriptor.id, entry, projectId)
      return importExtensionSource(source)
    }
    return loadFileEntryModule(entry)
  }
  const ui = descriptor.ui
  const contrib = descriptor.contributions
  const panels = [...(ui?.panels ?? []), ...(contrib?.panels ?? [])]
  const renderers = [...(ui?.toolRenderers ?? []), ...(contrib?.toolRenderers ?? [])]
  const sections = [...(ui?.settingsSections ?? []), ...(contrib?.settingsSections ?? [])]
  const containers = [...(ui?.viewContainers ?? []), ...(contrib?.viewContainers ?? [])]
  const views = [...(ui?.views ?? []), ...(contrib?.views ?? [])]
  const headerActions = [...(ui?.headerActions ?? []), ...(contrib?.headerActions ?? [])]
  const disposers: Disposer[] = []
  const seenPanel = new Set<string>()
  const seenTool = new Set<string>()
  const seenSection = new Set<string>()
  const seenDocumentRenderer = new Set<string>()
  const api = createApi(descriptor, host)

  for (const action of headerActions) {
    const entry = action.entry?.trim()
    if (!entry || !action.id) continue
    try {
      const Component = await loadHeaderActionComponent(entry, loadHeaderEntryModule)
      disposers.push(registerHeaderAction(descriptor.id, {
        id: action.id,
        ...(action.order !== undefined ? { order: action.order } : {}),
        render: context => {
          const isGitProvider = descriptor.id === 'git-capability'
          const git = isGitProvider && context.hostCapabilities.git && context.workspaceId && context.host.gitStatus && context.host.gitCheckout
            ? {
                status: () => context.host.gitStatus!(context.workspaceId!),
                checkout: (branch: string) => context.host.gitCheckout!(context.workspaceId!, branch),
              }
            : undefined
          const props: HeaderActionProps = {
            ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
            ...(git ? { git } : {}),
            ...(isGitProvider && context.host.openExternal ? { openExternal: (url: string) => context.host.openExternal!(url) } : {}),
          }
          return createElement(Component, props)
        },
      }))
    } catch {
      // A broken optional header contribution must not take down the App.
    }
  }

  for (const container of containers) {
    disposers.push(registerWorkbenchContainer(descriptor.id, {
      id: container.id,
      location: container.location,
      title: container.title,
      ...(container.icon ? { icon: container.icon } : {}),
      ...(container.order !== undefined ? { order: container.order } : {}),
    }))
  }

  for (const view of views) {
    const entry = view.entry?.trim()
    if (!entry) continue
    try {
      const Component = await loadComponent(entry, loadFileEntryModule)
      disposers.push(registerWorkbenchView(descriptor.id, {
        id: view.id,
        container: view.container,
        render: context => createElement(Component, { api, id: view.id, active: context.active }),
      }))
    } catch (error) {
      disposers.push(registerWorkbenchView(descriptor.id, {
        id: view.id,
        container: view.container,
        render: () => errorPlaceholder(`扩展视图「${view.id}」加载失败：${errorMessage(error)}`),
      }))
    }
  }

  for (const panel of panels) {
    const entry = panel.entry?.trim()
    if (!entry || !panel.id || seenPanel.has(panel.id)) continue
    seenPanel.add(panel.id)
    const railIcon = (await loadPanelIcon(descriptor.id, panel.icon, readUiEntrySource)) ?? EXTENSION_PANEL_ICON
    try {
      const Component = await loadComponent(entry, loadFileEntryModule)
      const title = panel.title ?? panel.id
      disposers.push(registerPanel(descriptor.id, {
        id: panel.id,
        icon: railIcon,
        render: ctx => createElement('div', { className: 'tool-page', hidden: !ctx.active },
          createElement(Component, { api, id: panel.id, title }),
        ),
      }))
    } catch (error) {
      disposers.push(registerPanelError(descriptor.id, panel, errorMessage(error), railIcon))
    }
  }

  for (const renderer of renderers) {
    const entry = renderer.entry?.trim()
    if (!entry || !renderer.tool || seenTool.has(renderer.tool)) continue
    seenTool.add(renderer.tool)
    try {
      const Component = await loadComponent(entry, loadFileEntryModule)
      disposers.push(registerToolRenderer(descriptor.id, {
        toolName: renderer.tool,
        render: ({ content, details, images }) => createElement(Component, { content, details, images }),
      }))
    } catch {
      // No panel slot: leave the default tool card. Do not crash the host.
    }
  }

  // Document renderers receive host-prepared props only (descriptor / bytes /
  // derived text / restricted actions) — never paths, host APIs, or `window.pipiHost`.
  for (const renderer of ui?.documentRenderers ?? []) {
    const entry = renderer.entry?.trim()
    if (!entry || !renderer.id || seenDocumentRenderer.has(renderer.id)) continue
    seenDocumentRenderer.add(renderer.id)
    try {
      const Component = await loadComponent(entry, loadFileEntryModule)
      disposers.push(registerDocumentRenderer(descriptor.id, {
        id: renderer.id,
        kinds: renderer.kinds?.length ? [...renderer.kinds] : undefined,
        extensions: renderer.extensions?.length ? [...renderer.extensions] : undefined,
        mimeTypes: renderer.mimeTypes?.length ? [...renderer.mimeTypes] : undefined,
        priority: renderer.priority,
        render: props => createElement(Component, props),
      }))
    } catch {
      // No renderer slot to placeholder: the document surface keeps builtin
      // rendering. Do not crash the host over one broken or conflicting entry.
    }
  }

  for (const section of sections) {
    const entry = section.entry?.trim()
    if (!entry || !section.id || seenSection.has(section.id)) continue
    seenSection.add(section.id)
    const title = section.title ?? section.id
    try {
      const Component = await loadComponent(entry, loadFileEntryModule)
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
  return has(ui?.panels) || has(ui?.toolRenderers) || has(ui?.documentRenderers) || has(ui?.settingsSections) || has(ui?.views) || has(ui?.headerActions)
    || has(contrib?.panels) || has(contrib?.toolRenderers) || has(contrib?.settingsSections) || has(contrib?.views) || has(contrib?.headerActions)
}

export function settingsSectionHasEntry(section: unknown): boolean {
  if (!section || typeof section !== 'object') return false
  const entry = (section as { entry?: unknown }).entry
  return typeof entry === 'string' && Boolean(entry.trim())
}
