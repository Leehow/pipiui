// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import './slash-commands'
import './tool-summary'
import './AssistantTranscriptContent'
import './ModelVisibilityModal'
import './builtin-panels'
import {
  disposeUiContributions,
  listPanels,
  listSettingsSections,
  listToolRendererNames,
  registerPanel,
  registerSettingsSection,
  registerToolRenderer,
} from './ui-registries'
import { listSlashCommands, registerSlashCommand, slashCommands } from './slash-commands'

const TEST_EXT = 'test-ui-registry'

afterEach(() => {
  disposeUiContributions(TEST_EXT)
})

describe('dogfood lists match the pre-registry hardcoded sets', () => {
  it('slash commands', () => {
    expect(listSlashCommands().map(command => command.name)).toEqual(['model', 'compact', 'plan', 'goal'])
    expect(slashCommands.map(command => command.name)).toEqual(['model', 'compact', 'plan', 'goal'])
  })

  it('tool renderer names (summarizeArgs switch + live cards)', () => {
    expect(listToolRendererNames()).toEqual([
      'write', 'edit', 'generate_image', 'image_gen', 'image_edit',
      'web_search', 'browser_search', 'fetch_content', 'browser_fetch',
      'browser', 'computer', 'find', 'grep', 'subagent', 'computer_task',
    ])
  })

  it('settings sections', () => {
    expect(listSettingsSections().map(section => section.id)).toEqual(['general', 'models', 'extensions', 'updates'])
    expect(listSettingsSections().map(section => section.label)).toEqual(['通用', '模型管理', '扩展', '更新中心'])
  })

  it('panels', () => {
    expect(listPanels().map(panel => panel.id)).toEqual(['Subagents', 'Plan', 'Browser', 'Document', 'Terminal'])
  })
})

describe('register → dispose leaves no residue', () => {
  it('slash commands restore the builtin list', () => {
    const before = listSlashCommands().map(command => command.name)
    const dispose = registerSlashCommand(TEST_EXT, { name: 'probe', description: 'test', action: { kind: 'not-implemented' } })
    expect(listSlashCommands().map(command => command.name)).toEqual([...before, 'probe'])
    dispose()
    expect(listSlashCommands().map(command => command.name)).toEqual(before)

    const again = registerSlashCommand(TEST_EXT, { name: 'probe-2', description: 'test', action: { kind: 'not-implemented' } })
    expect(listSlashCommands().some(command => command.name === 'probe-2')).toBe(true)
    disposeUiContributions(TEST_EXT)
    again()
    expect(listSlashCommands().map(command => command.name)).toEqual(before)
  })

  it('tool renderers, settings sections, and panels restore after dispose', () => {
    const toolsBefore = listToolRendererNames()
    const settingsBefore = listSettingsSections().map(section => section.id)
    const panelsBefore = listPanels().map(panel => panel.id)

    const d1 = registerToolRenderer(TEST_EXT, { toolName: 'probe_tool' })
    const d2 = registerSettingsSection(TEST_EXT, {
      id: 'probe',
      label: 'Probe',
      title: 'Probe',
      description: '',
      render: () => null,
    })
    const d3 = registerPanel(TEST_EXT, {
      id: 'Probe',
      icon: { src: '', ratio: 1 },
      render: () => null,
    })

    expect(listToolRendererNames()).toEqual([...toolsBefore, 'probe_tool'])
    expect(listSettingsSections().map(section => section.id)).toEqual([...settingsBefore, 'probe'])
    expect(listPanels().map(panel => panel.id)).toEqual([...panelsBefore, 'Probe'])

    d1(); d2(); d3()
    expect(listToolRendererNames()).toEqual(toolsBefore)
    expect(listSettingsSections().map(section => section.id)).toEqual(settingsBefore)
    expect(listPanels().map(panel => panel.id)).toEqual(panelsBefore)
  })

  it('disposeUiContributions removes a whole extension group', () => {
    const toolsBefore = listToolRendererNames()
    registerToolRenderer(TEST_EXT, { toolName: 'a' })
    registerToolRenderer(TEST_EXT, { toolName: 'b' })
    registerSlashCommand(TEST_EXT, { name: 'x', description: '', action: { kind: 'not-implemented' } })
    disposeUiContributions(TEST_EXT)
    expect(listToolRendererNames()).toEqual(toolsBefore)
    expect(listSlashCommands().some(command => command.name === 'x')).toBe(false)
  })
})
