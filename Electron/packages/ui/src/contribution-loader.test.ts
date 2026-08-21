// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionDescriptor, ExtEvent, PipiHostAPI } from '@pipi/host-api'
import { resetDeclarativeContributions, syncDeclarativeContributions, useDeclarativeContributionLoader } from './contribution-loader'
import { parseSlashInvocation, slashCommandByName, listSlashCommands } from './slash-commands'
import { listPanels, listSettingsSections, listStatusBarItems } from './ui-registries'

const EXT = 'quota'

const quotaDescriptor = (state: ExtensionDescriptor['state'], extra?: Partial<ExtensionDescriptor>): ExtensionDescriptor => ({
  id: EXT,
  name: 'Quota Monitor',
  version: '1.0.0',
  state,
  source: 'app',
  contributions: {
    settings: {
      scope: 'app',
      schema: {
        type: 'object',
        title: '用量监控',
        properties: {
          'ext.quota.threshold': { type: 'number', title: '告警阈值（%）', default: 80 },
        },
      },
    },
    settingsSections: [{ id: 'quota', title: '用量监控', description: '告警阈值' }],
    slashCommands: [{ name: 'quota', description: '查看当前用量' }],
    statusBar: [{ id: 'quota-bar', text: '92%', tooltip: '当前用量' }],
  },
  ...extra,
})

afterEach(() => {
  resetDeclarativeContributions()
  cleanup()
})

describe('syncDeclarativeContributions', () => {
  it('registers slash, settings, and statusBar from an enabled descriptor', () => {
    const slashBefore = listSlashCommands().map(command => command.name)
    const settingsBefore = listSettingsSections().map(section => section.id)
    const statusBefore = listStatusBarItems().map(item => item.id)
    const panelsBefore = listPanels().map(panel => panel.id)

    syncDeclarativeContributions([quotaDescriptor('enabled')])

    expect(listSlashCommands().map(command => command.name)).toEqual([...slashBefore, 'quota'])
    expect(listSettingsSections().map(section => section.id)).toEqual([...settingsBefore, 'quota'])
    expect(listStatusBarItems().map(item => item.id)).toEqual([...statusBefore, 'quota-bar'])
    expect(listPanels().map(panel => panel.id)).toEqual(panelsBefore)
  })

  it('does not register panels that lack an entry (M3)', () => {
    const panelsBefore = listPanels().map(panel => panel.id)
    syncDeclarativeContributions([quotaDescriptor('enabled')])
    expect(listPanels().map(panel => panel.id)).toEqual(panelsBefore)
  })

  it('disable disposes the whole group with zero residue', () => {
    const slashBefore = listSlashCommands().map(command => command.name)
    const settingsBefore = listSettingsSections().map(section => section.id)
    const statusBefore = listStatusBarItems().map(item => item.id)

    syncDeclarativeContributions([quotaDescriptor('enabled')])
    expect(slashCommandByName('quota')).toBeTruthy()

    syncDeclarativeContributions([quotaDescriptor('disabled')])
    expect(listSlashCommands().map(command => command.name)).toEqual(slashBefore)
    expect(listSettingsSections().map(section => section.id)).toEqual(settingsBefore)
    expect(listStatusBarItems().map(item => item.id)).toEqual(statusBefore)
    expect(slashCommandByName('quota')).toBeUndefined()
  })

  it('slash commands from descriptors enter the registry and are executable', () => {
    syncDeclarativeContributions([quotaDescriptor('enabled')])
    const command = slashCommandByName('quota')
    expect(command).toMatchObject({
      name: 'quota',
      description: '查看当前用量',
      action: { kind: 'send-prompt' },
    })
    const draft = '/quota now'
    expect(parseSlashInvocation(draft)).toEqual({ name: 'quota', args: 'now' })
    expect(command?.action.kind).toBe('send-prompt')
    const outgoing = draft.trim() || `/${command!.name}`
    expect(outgoing).toBe('/quota now')
  })
})

describe('useDeclarativeContributionLoader', () => {
  it('loads from listExtensions and tears down on disable via subscribeExt', async () => {
    const listeners = new Map<string, Set<(event: ExtEvent) => void>>()
    let current: ExtensionDescriptor[] = [quotaDescriptor('enabled')]
    const host = {
      listExtensions: vi.fn(async () => current),
      subscribeExt: (extensionId: string, listener: (event: ExtEvent) => void) => {
        let set = listeners.get(extensionId)
        if (!set) {
          set = new Set()
          listeners.set(extensionId, set)
        }
        set.add(listener)
        return () => { set!.delete(listener) }
      },
    } as unknown as PipiHostAPI

    const { unmount } = renderHook(() => useDeclarativeContributionLoader(host))
    await vi.waitFor(() => expect(slashCommandByName('quota')).toBeTruthy())

    current = [quotaDescriptor('disabled')]
    for (const listener of listeners.get(EXT) ?? []) listener({ type: 'disabled' })
    await vi.waitFor(() => expect(slashCommandByName('quota')).toBeUndefined())

    unmount()
    expect(listeners.get(EXT)?.size ?? 0).toBe(0)
  })

  it('fills contributions from getExtensionContributions when the descriptor omits them', async () => {
    const descriptor = quotaDescriptor('enabled')
    const contributions = descriptor.contributions
    const host = {
      listExtensions: vi.fn(async () => [{ id: EXT, state: 'enabled' as const, source: 'app' as const }]),
      getExtensionContributions: vi.fn(async () => contributions),
    } as unknown as PipiHostAPI

    renderHook(() => useDeclarativeContributionLoader(host))
    await vi.waitFor(() => expect(slashCommandByName('quota')?.description).toBe('查看当前用量'))
  })
})
