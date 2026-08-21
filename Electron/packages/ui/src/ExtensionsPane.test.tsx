// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MCP_ADD_PROMPT, PI_EXTENSION_ADD_PROMPT } from './extension-add-copy'
import type { ExtensionDescriptor, PipiHostAPI, UserMcpServer } from '@pipi/host-api'
import { ExtensionsPane } from './ExtensionsPane'
import { CAPABILITY_LABELS } from './extension-capabilities'

let originalClipboard: PropertyDescriptor | undefined

beforeEach(() => {
  originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

afterEach(() => {
  cleanup()
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
})

describe('ExtensionsPane', () => {
  it('shows the built-in MCP extension and an empty user list', () => {
    render(<ExtensionsPane addOpen={false} onCloseAdd={() => undefined} />)
    expect(screen.getByTestId('extensions-pane')).toBeTruthy()
    expect(screen.getByTestId('extensions-item-pi-mcp').textContent).toContain('pi-mcp-extension')
    expect(screen.getByTestId('extensions-item-paddleocr').textContent).toContain('PaddleOCR-VL-1.6')
    expect(screen.getByTestId('extensions-user-empty').textContent).toContain('还没有额外添加')
    expect(screen.queryByTestId('extensions-add-dialog')).toBeNull()
  })

  it('lists project mcpServers from the host without secrets', async () => {
    const listUserMcpServers = vi.fn(async (): Promise<UserMcpServer[]> => [
      { name: 'officecli', transport: 'stdio', summary: 'officecli mcp' },
    ])
    const host = { listUserMcpServers, listProjects: async () => [{ id: 'demo', name: 'demo', path: '/tmp/demo' }] } as unknown as PipiHostAPI
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} />)
    expect(await screen.findByTestId('extensions-item-mcp-officecli')).toBeTruthy()
    expect(screen.getByTestId('extensions-item-mcp-officecli').textContent).toContain('officecli')
    expect(screen.getByTestId('extensions-item-mcp-officecli').textContent).toContain('officecli mcp')
    expect(screen.queryByTestId('extensions-user-empty')).toBeNull()
    expect(listUserMcpServers).toHaveBeenCalled()
  })

  it('opens the add dialog with copy-paste prompts the main session can handle', async () => {
    const onCloseAdd = vi.fn()
    render(<ExtensionsPane addOpen={true} onCloseAdd={onCloseAdd} />)
    const dialog = screen.getByTestId('extensions-add-dialog')
    expect(dialog.textContent).toContain('不用在这里填命令、URL 或密钥')
    expect(dialog.textContent).toContain('回到主界面直接说就行')
    expect(screen.getByTestId('extensions-copy-mcp').textContent).toContain(MCP_ADD_PROMPT)
    expect(screen.getByTestId('extensions-copy-pi').textContent).toContain(PI_EXTENSION_ADD_PROMPT)
    fireEvent.click(screen.getByTestId('extensions-copy-btn-mcp'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(MCP_ADD_PROMPT))
    expect(screen.getByTestId('extensions-add-copied').textContent).toContain('贴到主界面发送即可')
    fireEvent.click(screen.getByTestId('extensions-copy-btn-pi'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(PI_EXTENSION_ADD_PROMPT))
    fireEvent.click(screen.getByRole('button', { name: '关闭添加说明' }))
    expect(onCloseAdd).toHaveBeenCalledTimes(1)
  })

  it('saves a project-scoped PaddleOCR token without echoing it and opens the apply URL', async () => {
    const getPaddleOcrStatus = vi.fn(async () => ({ hasKey: false }))
    const setPaddleOcrAccessToken = vi.fn(async (_projectId: string, token: string | null) => ({ hasKey: Boolean(token) }))
    const openExternal = vi.fn(async () => undefined)
    const host = {
      getPaddleOcrStatus,
      setPaddleOcrAccessToken,
      openExternal,
      listUserMcpServers: async () => [],
      listProjects: async () => [{ id: 'project-1', name: 'demo', path: '/tmp/demo' }],
    } as unknown as PipiHostAPI
    render(<ExtensionsPane host={host} projectId="project-1" addOpen={false} onCloseAdd={() => undefined} />)
    expect(await screen.findByTestId('paddleocr-status')).toBeTruthy()
    fireEvent.change(screen.getByTestId('paddleocr-token-input'), { target: { value: 'ast-secret-should-not-echo' } })
    fireEvent.click(screen.getByTestId('paddleocr-save'))
    await waitFor(() => expect(setPaddleOcrAccessToken).toHaveBeenCalledWith('project-1', 'ast-secret-should-not-echo'))
    expect(screen.queryByText('ast-secret-should-not-echo')).toBeNull()
    expect(screen.getByTestId('paddleocr-status').textContent).toContain('已配置')
    fireEvent.click(screen.getByTestId('paddleocr-apply'))
    expect(openExternal).toHaveBeenCalledWith('https://aistudio.baidu.com/account/accessToken')
  })

  it('closes the add dialog on Escape without bubbling to the settings modal', () => {
    const onCloseAdd = vi.fn()
    render(<ExtensionsPane addOpen={true} onCloseAdd={onCloseAdd} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCloseAdd).toHaveBeenCalledTimes(1)
  })
})

function pkg(partial: Partial<ExtensionDescriptor> & Pick<ExtensionDescriptor, 'id'>): ExtensionDescriptor {
  return {
    state: 'disabled',
    source: 'app',
    name: partial.id,
    version: '1.0.0',
    ...partial,
  }
}

function managementHost(initial: ExtensionDescriptor[]) {
  let items = initial.map(item => ({ ...item }))
  const grants = new Map<string, string[]>()
  for (const item of items) {
    if (item.grantedCapabilities) grants.set(item.id, [...item.grantedCapabilities])
  }
  const host = {
    listUserMcpServers: async () => [],
    listProjects: async () => [{ id: 'demo', name: 'demo', path: '/tmp/demo' }],
    listExtensions: vi.fn(async () => items.map(item => ({ ...item, grantedCapabilities: grants.get(item.id) }))),
    getCapabilityGrant: vi.fn(async (id: string) => ({ capabilities: grants.get(id) ?? [] })),
    confirmCapabilityGrant: vi.fn(async (id: string, capabilities: readonly string[]) => {
      grants.set(id, [...capabilities])
      items = items.map(item => item.id === id ? { ...item, grantedCapabilities: [...capabilities] } : item)
      return { capabilities: [...capabilities] }
    }),
    setExtensionEnabled: vi.fn(async (id: string, enabled: boolean, scope: 'app' | 'project') => {
      items = items.map(item => item.id === id ? { ...item, state: enabled ? 'enabled' as const : 'disabled' as const } : item)
      return items.find(item => item.id === id)!
    }),
    uninstallExtension: vi.fn(async (id: string) => {
      items = items.filter(item => item.id !== id)
    }),
  }
  return host as unknown as PipiHostAPI & typeof host
}

describe('ExtensionsPane package management', () => {
  it('renders name, version, source, state, and capability badges', async () => {
    const host = managementHost([
      pkg({ id: 'quota', name: 'Quota Monitor', version: '1.2.0', source: 'builtin', state: 'enabled', capabilities: ['bridge.emit', 'settings.read'] }),
      pkg({ id: 'office', name: 'Office', version: '0.3.0', source: 'project', state: 'disabled', capabilities: ['invoke.agent'] }),
      pkg({ id: 'broken', name: 'Broken', state: 'error', source: 'app', errorReason: 'settings migration failed' }),
    ])
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} />)
    expect(await screen.findByTestId('extensions-pkg-quota')).toBeTruthy()
    expect(screen.getByTestId('extensions-pkg-quota').textContent).toContain('Quota Monitor')
    expect(screen.getByTestId('extensions-pkg-meta-quota').textContent).toContain('1.2.0')
    expect(screen.getByTestId('extensions-pkg-meta-quota').textContent).toContain('内置')
    expect(screen.getByTestId('extensions-pkg-meta-quota').textContent).toContain('已启用')
    expect(screen.getByTestId('extensions-pkg-caps-quota').textContent).toContain('bridge.emit')
    expect(screen.getByTestId('extensions-pkg-meta-office').textContent).toContain('项目')
    expect(screen.getByTestId('extensions-pkg-meta-office').textContent).toContain('已禁用')
    expect(screen.getByTestId('extensions-pkg-error-broken').textContent).toContain('settings migration failed')
    expect(screen.queryByTestId('extensions-pkg-uninstall-quota')).toBeNull()
    expect(screen.getByTestId('extensions-pkg-uninstall-office')).toBeTruthy()
  })

  it('disables an enabled package with setExtensionEnabled project scope', async () => {
    const host = managementHost([pkg({ id: 'quota', state: 'enabled', source: 'app' })])
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} />)
    fireEvent.click(await screen.findByTestId('extensions-pkg-toggle-quota'))
    await waitFor(() => expect(host.setExtensionEnabled).toHaveBeenCalledWith('quota', false, 'project'))
    expect(host.confirmCapabilityGrant).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByTestId('extensions-pkg-meta-quota').textContent).toContain('已禁用'))
  })

  it('uninstalls a non-builtin package after a second confirmation', async () => {
    const host = managementHost([pkg({ id: 'office', source: 'app' })])
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} />)
    fireEvent.click(await screen.findByTestId('extensions-pkg-uninstall-office'))
    expect(screen.getByTestId('extensions-uninstall-dialog')).toBeTruthy()
    fireEvent.click(screen.getByTestId('extensions-uninstall-cancel'))
    expect(host.uninstallExtension).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('extensions-pkg-uninstall-office'))
    fireEvent.click(screen.getByTestId('extensions-uninstall-confirm'))
    await waitFor(() => expect(host.uninstallExtension).toHaveBeenCalledWith('office'))
    await waitFor(() => expect(screen.queryByTestId('extensions-pkg-office')).toBeNull())
  })

  it('prompts for capabilities on first L1 enable, then confirms and enables', async () => {
    const host = managementHost([pkg({ id: 'quota', capabilities: ['bridge.emit', 'settings.read'] })])
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} />)
    fireEvent.click(await screen.findByTestId('extensions-pkg-toggle-quota'))
    const dialog = await screen.findByTestId('extensions-grant-dialog')
    expect(dialog.textContent).toContain(CAPABILITY_LABELS['bridge.emit'])
    expect(dialog.textContent).toContain(CAPABILITY_LABELS['settings.read'])
    fireEvent.click(screen.getByTestId('extensions-grant-confirm'))
    await waitFor(() => expect(host.confirmCapabilityGrant).toHaveBeenCalledWith('quota', ['bridge.emit', 'settings.read']))
    expect(host.setExtensionEnabled).toHaveBeenCalledWith('quota', true, 'project')
    await waitFor(() => expect(screen.getByTestId('extensions-pkg-meta-quota').textContent).toContain('已启用'))
  })

  it('does not prompt when capabilities are already granted', async () => {
    const host = managementHost([pkg({
      id: 'quota',
      capabilities: ['bridge.emit'],
      grantedCapabilities: ['bridge.emit'],
    })])
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} />)
    fireEvent.click(await screen.findByTestId('extensions-pkg-toggle-quota'))
    await waitFor(() => expect(host.setExtensionEnabled).toHaveBeenCalledWith('quota', true, 'project'))
    expect(screen.queryByTestId('extensions-grant-dialog')).toBeNull()
    expect(host.confirmCapabilityGrant).not.toHaveBeenCalled()
  })

  it('re-prompts when the capability set grew', async () => {
    const host = managementHost([pkg({
      id: 'quota',
      capabilities: ['bridge.emit', 'notifications'],
      grantedCapabilities: ['bridge.emit'],
    })])
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} />)
    fireEvent.click(await screen.findByTestId('extensions-pkg-toggle-quota'))
    expect(await screen.findByTestId('extensions-grant-dialog')).toBeTruthy()
    expect(host.setExtensionEnabled).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('extensions-grant-confirm'))
    await waitFor(() => expect(host.confirmCapabilityGrant).toHaveBeenCalledWith('quota', ['bridge.emit', 'notifications']))
    expect(host.setExtensionEnabled).toHaveBeenCalledWith('quota', true, 'project')
  })

  it('does not enable when the grant dialog is cancelled', async () => {
    const host = managementHost([pkg({ id: 'quota', capabilities: ['bridge.emit'] })])
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} />)
    fireEvent.click(await screen.findByTestId('extensions-pkg-toggle-quota'))
    fireEvent.click(await screen.findByTestId('extensions-grant-cancel'))
    expect(screen.queryByTestId('extensions-grant-dialog')).toBeNull()
    expect(host.confirmCapabilityGrant).not.toHaveBeenCalled()
    expect(host.setExtensionEnabled).not.toHaveBeenCalled()
    expect(screen.getByTestId('extensions-pkg-meta-quota').textContent).toContain('已禁用')
  })

  it('blocks enabling a third-party L2 package', async () => {
    const host = managementHost([pkg({
      id: 'native-drive',
      source: 'app',
      capabilities: ['host.main'],
    })])
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} />)
    const toggle = await screen.findByTestId('extensions-pkg-toggle-native-drive')
    expect(toggle).toHaveProperty('disabled', true)
    expect(screen.getByTestId('extensions-pkg-l2-native-drive').textContent).toContain('该能力仅官方内置可用')
    fireEvent.click(toggle)
    expect(host.setExtensionEnabled).not.toHaveBeenCalled()
    expect(screen.queryByTestId('extensions-grant-dialog')).toBeNull()
  })

  it('shows errorReason for packages in error', async () => {
    const host = managementHost([pkg({
      id: 'broken',
      state: 'error',
      errorReason: 'migration v1 → v2 failed',
    })])
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} />)
    expect((await screen.findByTestId('extensions-pkg-error-broken')).textContent).toContain('migration v1 → v2 failed')
    expect(screen.getByTestId('extensions-pkg-toggle-broken')).toHaveProperty('disabled', true)
  })
})
