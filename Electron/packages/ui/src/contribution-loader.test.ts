// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionDescriptor, ExtEvent, PipiHostAPI } from '@pipi/host-api'
import { resetDeclarativeContributions, syncDeclarativeContributions, syncExtensionContributions, useDeclarativeContributionLoader } from './contribution-loader'
import { parseSlashInvocation, slashCommandByName, listSlashCommands } from './slash-commands'
import { listPanels, listSettingsSections, listStatusBarItems } from './ui-registries'
import { listHeaderActions } from './workbench/header-actions'

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
  it('registers slash and statusBar from an enabled descriptor; schema settings stay nested under the Extensions tab', () => {
    const slashBefore = listSlashCommands().map(command => command.name)
    const settingsBefore = listSettingsSections().map(section => section.id)
    const statusBefore = listStatusBarItems().map(item => item.id)
    const panelsBefore = listPanels().map(panel => panel.id)

    syncDeclarativeContributions([quotaDescriptor('enabled')])

    expect(listSlashCommands().map(command => command.name)).toEqual([...slashBefore, 'quota'])
    expect(listSettingsSections().map(section => section.id)).toEqual(settingsBefore)
    expect(listStatusBarItems().map(item => item.id)).toEqual([...statusBefore, 'quota-bar'])
    expect(listPanels().map(panel => panel.id)).toEqual(panelsBefore)
  })

  it('does not promote grok-build-oauth or any extension settings section to a top-level tab', () => {
    const settingsBefore = listSettingsSections().map(section => section.id)

    syncDeclarativeContributions([{
      ...quotaDescriptor('enabled'),
      id: 'grok-build-oauth',
      name: 'Grok Build',
      contributions: {
        ...quotaDescriptor('enabled').contributions,
        settingsSections: [{ id: 'grok-build-oauth', title: 'Grok Build' }],
        auth: { provider: { id: 'grok-build', name: 'Grok Build' } },
      },
    }])

    expect(listSettingsSections().map(section => section.id)).toEqual(settingsBefore)
    expect(listSettingsSections().some(section => /grok/i.test(section.id) || /grok/i.test(section.label))).toBe(false)
  })

  it('does not register a right-sidebar panel or icon for grok-build-oauth', async () => {
    const panelsBefore = listPanels().map(panel => panel.id)
    await syncExtensionContributions([{
      id: 'grok-build-oauth',
      name: 'Grok Build',
      version: '0.2.0',
      state: 'enabled',
      source: 'app',
      contributions: {
        auth: { provider: { id: 'grok-build', name: 'Grok Build', oauth: true } },
      },
      ui: {
        toolRenderers: [
          { tool: 'image_gen', entry: 'app/dist/image-card.js' },
          { tool: 'image_edit', entry: 'app/dist/image-card.js' },
        ],
      },
    } as ExtensionDescriptor], {} as PipiHostAPI)
    expect(listPanels().map(panel => panel.id)).toEqual(panelsBefore)
    expect(listPanels().some(panel => /grok/i.test(panel.id))).toBe(false)
  })

  it('disposes a stale controlled header when the same extension id reloads for another project', async () => {
    let releaseProjectA!: (source: string) => void
    const projectASource = new Promise<string>(resolve => { releaseProjectA = resolve })
    const source = (marker: string) => [
      'export function createHeaderAction(React) {',
      `  return function Header() { return React.createElement('span', null, '${marker}') }`,
      '}',
    ].join('\n')
    const host = {
      getExtensionUiEntrySource: vi.fn((_id: string, _entry: string, projectId?: string) => (
        projectId === 'project-a' ? projectASource : Promise.resolve(source('PROJECT_B'))
      )),
    } as unknown as PipiHostAPI
    const descriptor = {
      ...quotaDescriptor('enabled'),
      directory: '/controlled-source-is-host-read',
      ui: { headerActions: [{ id: 'quota.aba', entry: 'app/dist/header.js' }] },
    } as ExtensionDescriptor

    const oldLoad = syncExtensionContributions([descriptor], host, 'project-a')
    await vi.waitFor(() => expect(host.getExtensionUiEntrySource).toHaveBeenCalledWith(EXT, 'app/dist/header.js', 'project-a'))
    resetDeclarativeContributions()
    await syncExtensionContributions([descriptor], host, 'project-b')
    expect(listHeaderActions().filter(item => item.id === 'quota.aba')).toHaveLength(1)

    releaseProjectA(source('PROJECT_A'))
    await oldLoad
    expect(listHeaderActions().filter(item => item.id === 'quota.aba')).toHaveLength(1)
  })

  it('does not register panels that lack an entry (M3)', () => {
    const panelsBefore = listPanels().map(panel => panel.id)
    syncDeclarativeContributions([quotaDescriptor('enabled')])
    expect(listPanels().map(panel => panel.id)).toEqual(panelsBefore)
  })

  it('uninstall (missing from list) disposes contributions with zero residue', () => {
    const slashBefore = listSlashCommands().map(command => command.name)
    const settingsBefore = listSettingsSections().map(section => section.id)
    const statusBefore = listStatusBarItems().map(item => item.id)

    syncDeclarativeContributions([quotaDescriptor('enabled')])
    expect(slashCommandByName('quota')).toBeTruthy()

    syncDeclarativeContributions([])
    expect(listSlashCommands().map(command => command.name)).toEqual(slashBefore)
    expect(listSettingsSections().map(section => section.id)).toEqual(settingsBefore)
    expect(listStatusBarItems().map(item => item.id)).toEqual(statusBefore)
    expect(slashCommandByName('quota')).toBeUndefined()
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
  it('loads the selected project overlay so project-local product extensions can contribute UI', async () => {
    const host = {
      listExtensions: vi.fn(async () => []),
    } as unknown as PipiHostAPI
    renderHook(() => useDeclarativeContributionLoader(host, 'campaign-project'))
    await vi.waitFor(() => expect(host.listExtensions).toHaveBeenCalledWith('campaign-project'))
  })

  it('does not keep a stale project subscription after a controlled load crosses project cleanup', async () => {
    let releaseProjectA!: (source: string) => void
    const projectASource = new Promise<string>(resolve => { releaseProjectA = resolve })
    const descriptorA = {
      id: 'alpha',
      name: 'Alpha',
      version: '1.0.0',
      state: 'enabled',
      source: 'project',
      directory: '/controlled-source-is-host-read',
      ui: { headerActions: [{ id: 'alpha.header', entry: 'app/dist/header.js' }] },
    } as ExtensionDescriptor
    const descriptorB = {
      id: 'beta',
      name: 'Beta',
      version: '1.0.0',
      state: 'enabled',
      source: 'project',
    } as ExtensionDescriptor
    const listeners = new Map<string, Set<(event: ExtEvent) => void>>()
    const host = {
      listExtensions: vi.fn(async (projectId?: string) => projectId === 'project-a' ? [descriptorA] : [descriptorB]),
      getExtensionUiEntrySource: vi.fn(() => projectASource),
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
    const { rerender, unmount } = renderHook(
      ({ projectId }) => useDeclarativeContributionLoader(host, projectId),
      { initialProps: { projectId: 'project-a' } },
    )
    await vi.waitFor(() => expect(host.getExtensionUiEntrySource).toHaveBeenCalled())

    rerender({ projectId: 'project-b' })
    await vi.waitFor(() => expect(listeners.get('beta')?.size ?? 0).toBe(1))
    releaseProjectA([
      'export function createHeaderAction(React) {',
      "  return function Header() { return React.createElement('span', null, 'PROJECT_A') }",
      '}',
    ].join('\n'))
    await vi.waitFor(() => expect(listeners.get('alpha')?.size ?? 0).toBe(0))
    expect(listHeaderActions().some(item => item.id === 'alpha.header')).toBe(false)

    unmount()
    expect(listeners.get('beta')?.size ?? 0).toBe(0)
  })

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

  it('re-imports the app half when the host reports the extension changed on disk', async () => {
    // 热更新原本只到 agent 半边：watcher 让空闲的 pi 子进程带新挂载重启。面板组件是
    // 每个渲染进程只 import 一次并记住的，所以改了 app/*.js 之后界面照旧显示旧模块，
    // 直到整窗重载——这条守住"改盘上的文件，界面跟着变"。
    const listeners = new Set<(event: ExtEvent) => void>()
    const source = (marker: string) => [
      'export function createHeaderAction(React) {',
      `  return function Header() { return React.createElement('span', null, '${marker}') }`,
      '}',
    ].join('\n')
    let onDisk = 'BEFORE'
    const host = {
      listExtensions: vi.fn(async () => [descriptorWithHeader]),
      getExtensionUiEntrySource: vi.fn(async () => source(onDisk)),
      subscribeExt: (_extensionId: string, listener: (event: ExtEvent) => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    } as unknown as PipiHostAPI
    const descriptorWithHeader = {
      ...quotaDescriptor('enabled'),
      directory: '/hot-reload-app-half',
      ui: { headerActions: [{ id: 'quota.hot', entry: 'app/dist/header.js' }] },
    } as ExtensionDescriptor

    renderHook(() => useDeclarativeContributionLoader(host))
    await vi.waitFor(() => expect(listHeaderActions().filter(item => item.id === 'quota.hot')).toHaveLength(1))
    expect(host.getExtensionUiEntrySource).toHaveBeenCalledTimes(1)

    // 状态变更（启用/停用/安装）不该让已经 import 的东西作废
    for (const listener of listeners) listener({ type: 'extension_updated', payload: { extensionId: EXT, source: 'state' } })
    await vi.waitFor(() => expect(host.listExtensions).toHaveBeenCalledTimes(2))
    expect(host.getExtensionUiEntrySource).toHaveBeenCalledTimes(1)

    // 盘上的文件变了才作废，并重新读一次源码
    onDisk = 'AFTER'
    for (const listener of listeners) listener({ type: 'extension_updated', payload: { extensionId: EXT, source: 'disk' } })
    await vi.waitFor(() => expect(host.getExtensionUiEntrySource).toHaveBeenCalledTimes(2))
    expect(listHeaderActions().filter(item => item.id === 'quota.hot')).toHaveLength(1)
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
