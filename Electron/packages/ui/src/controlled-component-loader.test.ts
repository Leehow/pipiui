// @vitest-environment jsdom
import { cleanup, render, within } from '@testing-library/react'
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

const EXT = 'quota'
const fixturesDir = '/tmp/quota-ext'

async function importFixture(specifier: string): Promise<unknown> {
  const file = specifier.slice(specifier.lastIndexOf('/') + 1)
  if (file === 'throws.ts' || file === 'throws.js') throw new Error('cannot load entry')
  if (file === 'panel.ts' || file === 'panel.js') return import('./fixtures/controlled/panel')
  if (file === 'tool-card.ts' || file === 'tool-card.js') return import('./fixtures/controlled/tool-card')
  if (file === 'settings.ts' || file === 'settings.js') return import('./fixtures/controlled/settings')
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
})
