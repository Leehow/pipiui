// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI } from '@pipi/host-api'
import {
  loadControlledContributions,
  resolveEntrySpecifier,
} from './controlled-component-loader'
import {
  disposeUiContributions,
  getToolRenderer,
  listPanels,
  listSettingsSections,
  listToolRenderers,
  type PanelRenderContext,
  type ToolRenderProps,
} from './ui-registries'
import { listWorkbenchContainers, listWorkbenchViews } from './workbench/workbench-contributions'
import { disposeHeaderActions, listHeaderActions, type HeaderActionContext } from './workbench/header-actions'

const EXT = 'quota'
const fixturesDir = '/tmp/quota-ext'
const gitManifest = (await import('../../../resources/runtime/extensions/git-capability/pipiui-extension.json')).default
const gitExtensionDirectory = new URL('../../../resources/runtime/extensions/git-capability/', import.meta.url).pathname

const gitRepoStatus = {
  isRepo: true,
  currentBranch: 'main',
  isDetached: false,
  shortSHA: undefined,
  localBranches: ['main'],
  upstream: undefined,
  ahead: 0,
  behind: 0,
  isDirty: false,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  githubURL: undefined,
}

async function importFixture(specifier: string): Promise<unknown> {
  const file = specifier.slice(specifier.lastIndexOf('/') + 1)
  if (file === 'throws.ts' || file === 'throws.js') throw new Error('cannot load entry')
  if (file === 'panel.ts' || file === 'panel.js') return import('./fixtures/controlled/panel')
  if (file === 'tool-card.ts' || file === 'tool-card.js') return import('./fixtures/controlled/tool-card')
  if (file === 'settings.ts' || file === 'settings.js') return import('./fixtures/controlled/settings')
  if (file === 'header.ts' || file === 'header.js') return {
    default: (props: Record<string, unknown>) => createElement('div', {
      'data-testid': 'ext-controlled-header',
      'data-host': String('host' in props),
      'data-workspace': String(props.workspaceId),
      'data-git': String(Boolean(props.git)),
      'data-open-external': String(Boolean(props.openExternal)),
    }),
  }
  throw new Error(`unknown fixture ${specifier}`)
}

function hostStub(): PipiHostAPI {
  return {
    invokeExtension: vi.fn(async () => ({ ok: true, data: null })),
    getExtensionSettings: vi.fn(async () => ({})),
  } as unknown as PipiHostAPI
}

function panelCtx(): PanelRenderContext {
  return {
    host: hostStub(),
    theme: 'light',
    collapsed: false,
    active: true,
    headerSlot: null,
    onSubagentsRunningCountChange: () => {},
    onSubagentStarted: () => {},
    onManualSubagentStatusCheck: () => {},
    browserAvailable: false,
    browserOccluded: false,
    terminalAvailable: false,
    planAvailable: false,
    onPlanProgressChange: () => {},
    onHasPlansChange: () => {},
    retainedWorktreeDispositionAvailable: false,
    onOpenDocument: () => {},
  }
}

afterEach(() => {
  disposeUiContributions(EXT)
  disposeHeaderActions(EXT)
  cleanup()
  Reflect.deleteProperty(window, 'pipiHost')
})

describe('resolveEntrySpecifier', () => {
  it('joins a package directory from the host descriptor', () => {
    expect(resolveEntrySpecifier('/tmp/ext', 'app/dist/panel.js')).toBe('file:///tmp/ext/app/dist/panel.js')
  })

  it('rejects path escape', () => {
    expect(() => resolveEntrySpecifier('/tmp/ext', '../secret.js')).toThrow(/must not contain \.\./)
  })
})

describe('loadControlledContributions', () => {
  it('registers panel / toolRenderer / settingsSection from entry modules and disposes with zero residue', async () => {
    const panelsBefore = listPanels().map(panel => panel.id)
    const settingsBefore = listSettingsSections().map(section => section.id)
    const toolsBefore = listToolRenderers().map(renderer => renderer.toolName)

    const disposers = await loadControlledContributions({
      id: EXT,
      directory: fixturesDir,
      capabilities: ['invoke.agent', 'stream.render'],
      ui: {
        panels: [{ id: 'quota', title: '用量', entry: 'panel.ts' }],
        toolRenderers: [{ tool: 'get_quota', entry: 'tool-card.ts' }],
        settingsSections: [{ id: 'quota-settings', title: '用量监控', entry: 'settings.ts' }],
      },
    }, hostStub(), importFixture)

    expect(listPanels().map(panel => panel.id)).toEqual([...panelsBefore, 'quota'])
    expect(listSettingsSections().map(section => section.id)).toEqual([...settingsBefore, 'quota-settings'])
    expect(listToolRenderers().map(renderer => renderer.toolName)).toEqual([...toolsBefore, 'get_quota'])

    const panel = listPanels().find(item => item.id === 'quota')
    const { container } = render(panel!.render(panelCtx()))
    const node = container.querySelector('[data-testid="ext-controlled-panel"]')
    expect(node).toBeTruthy()
    expect(node?.getAttribute('data-pipi-host')).toBe('undefined')
    expect(node?.getAttribute('data-has-invoke')).toBe('1')
    expect(node?.getAttribute('data-has-list-projects')).toBe('0')

    const renderer = getToolRenderer('get_quota')
    const card = render(renderer!.render!({
      tool: { id: 't', name: 'get_quota', input: '{}' },
      elapsed: () => '',
      content: 'ok',
      details: { used: 1 },
    } as unknown as ToolRenderProps))
    expect(card.getByTestId('ext-controlled-tool').textContent).toBe('ok:{"used":1}:')

    // Typed images forwarded to the controlled component (typed image chain).
    const cardWithImages = render(renderer!.render!({
      tool: { id: 't2', name: 'get_quota', input: '{}' },
      elapsed: () => '',
      content: 'ok',
      details: { used: 2 },
      images: [{ data: 'aGk=', mimeType: 'image/png' }],
    } as unknown as ToolRenderProps))
    expect(within(cardWithImages.container).getByTestId('ext-controlled-tool').textContent).toBe('ok:{"used":2}:image/png:aGk=')

    for (const dispose of disposers) dispose()
    expect(listPanels().map(panel => panel.id)).toEqual(panelsBefore)
    expect(listSettingsSections().map(section => section.id)).toEqual(settingsBefore)
    expect(listToolRenderers().map(renderer => renderer.toolName)).toEqual(toolsBefore)
  })

  it('registers lazy Workbench containers and views as one disposable extension group', async () => {
    const containersBefore = listWorkbenchContainers()
    const viewsBefore = listWorkbenchViews()
    const disposers = await loadControlledContributions({
      id: EXT,
      directory: fixturesDir,
      capabilities: ['invoke.agent'],
      ui: {
        viewContainers: [{ id: 'quota.navigator', location: 'primarySidebar', title: 'Quota' }],
        views: [{ id: 'quota.navigator.main', container: 'quota.navigator', entry: 'panel.ts', activation: 'visible' }],
      },
    }, hostStub(), importFixture)

    expect(listWorkbenchContainers()).toEqual([
      ...containersBefore,
      { id: 'quota.navigator', location: 'primarySidebar', title: 'Quota', extensionId: EXT },
    ])
    expect(listWorkbenchViews().map(view => ({ id: view.id, container: view.container, extensionId: view.extensionId }))).toEqual([
      ...viewsBefore.map(view => ({ id: view.id, container: view.container, extensionId: view.extensionId })),
      { id: 'quota.navigator.main', container: 'quota.navigator', extensionId: EXT },
    ])
    const view = listWorkbenchViews().find(item => item.id === 'quota.navigator.main')!
    const rendered = render(view.render({ active: true }))
    expect(rendered.getByTestId('ext-controlled-panel')).toBeTruthy()

    for (const dispose of disposers) dispose()
    expect(listWorkbenchContainers()).toEqual(containersBefore)
    expect(listWorkbenchViews()).toEqual(viewsBefore)
  })

  it('registers a restricted header action and disposes it with the extension', async () => {
    const disposers = await loadControlledContributions({
      id: EXT,
      directory: fixturesDir,
      ui: { headerActions: [{ id: 'quota.header', entry: 'header.ts', order: 2 }] },
    }, hostStub(), importFixture)
    const action = listHeaderActions().find(item => item.id === 'quota.header')
    expect(action?.order).toBe(2)
    const context: HeaderActionContext = {
      host: { gitStatus: vi.fn(), gitCheckout: vi.fn(), openExternal: vi.fn() } as unknown as PipiHostAPI,
      workspaceId: 'workspace-a',
      hostCapabilities: { git: true },
    }
    const rendered = render(action!.render(context))
    const header = rendered.getByTestId('ext-controlled-header')
    expect(header.getAttribute('data-host')).toBe('false')
    expect(header.getAttribute('data-workspace')).toBe('workspace-a')
    expect(header.getAttribute('data-git')).toBe('false')
    expect(header.getAttribute('data-open-external')).toBe('false')
    for (const dispose of disposers) dispose()
    expect(listHeaderActions().some(item => item.id === 'quota.header')).toBe(false)
  })

  it('loads a controlled header from host-read source instead of a file URL', async () => {
    const readExtensionUiEntrySource = vi.fn(async () => [
      'export function createHeaderAction(React) {',
      '  return function Header({ workspaceId }) {',
      "    return React.createElement('div', { 'data-testid': 'host-source-header' }, workspaceId)",
      '  }',
      '}',
    ].join('\n'))
    const host = hostStub()
    host.getExtensionUiEntrySource = readExtensionUiEntrySource
    expect(host.getExtensionUiEntrySource).toBe(readExtensionUiEntrySource)
    const disposers = await loadControlledContributions({
      id: EXT,
      directory: '/filesystem-path-chromium-cannot-import',
      ui: { headerActions: [{ id: 'quota.host-source', entry: 'app/dist/header.js' }] },
    }, host, undefined, 'project-a')

    expect(readExtensionUiEntrySource).toHaveBeenCalledWith(EXT, 'app/dist/header.js', 'project-a')
    const action = listHeaderActions().find(item => item.id === 'quota.host-source')
    const rendered = render(action!.render({
      host,
      workspaceId: 'workspace-a',
      hostCapabilities: { git: false },
    }))
    expect(rendered.getByTestId('host-source-header').textContent).toBe('workspace-a')

    for (const dispose of disposers) dispose()
  })

  it('shows a readable panel placeholder when entry import fails and does not throw', async () => {
    const panelsBefore = listPanels().map(panel => panel.id)
    await loadControlledContributions({
      id: EXT,
      directory: fixturesDir,
      capabilities: ['invoke.agent'],
      ui: {
        panels: [{ id: 'broken', title: '坏面板', entry: 'throws.ts' }],
      },
    }, hostStub(), importFixture)

    expect(listPanels().map(panel => panel.id)).toEqual([...panelsBefore, 'broken'])
    const panel = listPanels().find(item => item.id === 'broken')
    const { getByTestId } = render(panel!.render(panelCtx()))
    expect(getByTestId('ext-contribution-error').textContent).toMatch(/加载失败/)
    expect(getByTestId('ext-contribution-error').textContent).toMatch(/cannot load entry/)
  })

  it('does not inject window.pipiHost for controlled components', async () => {
    Reflect.deleteProperty(window, 'pipiHost')
    await loadControlledContributions({
      id: EXT,
      directory: fixturesDir,
      capabilities: [],
      ui: { panels: [{ id: 'quota', title: '用量', entry: 'panel.ts' }] },
    }, hostStub(), importFixture)
    const panel = listPanels().find(item => item.id === 'quota')
    const { container } = render(panel!.render(panelCtx()))
    expect(window.pipiHost).toBeUndefined()
    expect(container.querySelector('[data-testid="ext-controlled-panel"]')?.getAttribute('data-pipi-host')).toBe('undefined')
  })

  it('loads the real git-capability manifest header action and removes it on dispose', async () => {
    const disposers = await loadControlledContributions({
      id: gitManifest.id,
      directory: gitExtensionDirectory,
      ui: gitManifest.app.ui,
    }, hostStub(), async specifier => {
      expect(specifier).toBe(resolveEntrySpecifier(gitExtensionDirectory, 'app/dist/branch-menu.js'))
      return import('../../../resources/runtime/extensions/git-capability/app/branch-menu')
    })

    const action = listHeaderActions().find(item => item.id === 'git.branch')
    expect(action?.order).toBe(20)
    render(action!.render({
      host: {
        gitStatus: vi.fn(async () => gitRepoStatus),
        gitCheckout: vi.fn(),
        openExternal: vi.fn(),
      } as unknown as PipiHostAPI,
      workspaceId: 'git-workspace',
      hostCapabilities: { git: true },
    }))
    await waitFor(() => expect(screen.getByTestId('git-branch-button')).toBeTruthy())

    for (const dispose of disposers) dispose()
    expect(listHeaderActions().some(item => item.id === 'git.branch')).toBe(false)
  })

  it('fails soft when the real git-capability header entry cannot import', async () => {
    await expect(loadControlledContributions({
      id: gitManifest.id,
      directory: gitExtensionDirectory,
      ui: gitManifest.app.ui,
    }, hostStub(), async () => { throw new Error('missing Git entry') })).resolves.toEqual([])
    expect(listHeaderActions().some(item => item.id === 'git.branch')).toBe(false)
  })

  it('keeps legacy Git UI and coding-workbench header registration out of core UI', async () => {
    const [index, adapter] = await Promise.all([
      readFile('packages/ui/src/index.ts', 'utf8'),
      readFile('packages/ui/src/coding-workbench-adapter.tsx', 'utf8'),
    ])
    expect(index).not.toContain('GitBranchMenu')
    expect(adapter).not.toContain('registerHeaderAction')
  })
})
