// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    // The bespoke PaddleOCR row is gone; its settings render generically via the
    // pdf-extension manifest in ExtensionPackagesSection.
    expect(screen.queryByTestId('extensions-item-paddleocr')).toBeNull()
    expect(screen.getByTestId('extensions-builtin').textContent).toContain('1 项')
    expect(screen.getByTestId('extensions-user-empty').textContent).toContain('还没有额外添加')
    expect(screen.queryByTestId('extensions-add-dialog')).toBeNull()
  })

  it('lists project mcpServers from the host without secrets', async () => {
    const listUserMcpServers = vi.fn(async (): Promise<UserMcpServer[]> => [
      { name: 'sample-mcp', transport: 'stdio', summary: 'sample-mcp serve' },
    ])
    const host = { listUserMcpServers, listProjects: async () => [{ id: 'demo', name: 'demo', path: '/tmp/demo' }] } as unknown as PipiHostAPI
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} />)
    expect(await screen.findByTestId('extensions-item-mcp-sample-mcp')).toBeTruthy()
    expect(screen.getByTestId('extensions-item-mcp-sample-mcp').textContent).toContain('sample-mcp')
    expect(screen.getByTestId('extensions-item-mcp-sample-mcp').textContent).toContain('sample-mcp serve')
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

  it('renders the pdf-extension token through the generic schema settings form', async () => {
    const getExtensionSettings = vi.fn(async (_id: string) => ({ 'ext.pdf-extension.aistudioAccessToken': true }))
    const updateExtensionSettings = vi.fn(async (id: string, patch: Record<string, unknown>) => ({ ok: true, data: patch }))
    const listExtensions = vi.fn(async (): Promise<ExtensionDescriptor[]> => [{
      id: 'pdf-extension',
      name: 'PipiUI PDF',
      version: '0.1.0',
      source: 'builtin',
      state: 'enabled',
      capabilities: [],
      contributions: {
        settings: {
          scope: 'project',
          schema: { type: 'object', properties: { 'ext.pdf-extension.aistudioAccessToken': { type: 'string', format: 'secret', title: 'PaddleOCR AI Studio Access Token' } } },
        },
      },
    }])
    const host = {
      listExtensions,
      getExtensionSettings,
      updateExtensionSettings,
      listUserMcpServers: async () => [],
      listProjects: async () => [{ id: 'project-1', name: 'demo', path: '/tmp/demo' }],
    } as unknown as PipiHostAPI
    render(<ExtensionsPane host={host} projectId="project-1" addOpen={false} onCloseAdd={() => undefined} />)
    fireEvent.click(await screen.findByTestId('extensions-pkg-settings-toggle-pdf-extension'))
    expect(screen.getByTestId('ext-schema-form')).toBeTruthy()
    const input = screen.getByTestId('ext-schema-field-ext.pdf-extension.aistudioAccessToken')
    expect(input.getAttribute('type')).toBe('password')
    // Configured secret shows presence, not the value, plus a generic clear affordance.
    expect((input as HTMLInputElement).value).toBe('')
    // Defect-1 routing: the selected project id rides along to the backend.
    expect(getExtensionSettings).toHaveBeenCalledWith('pdf-extension', 'project-1')
    expect(await screen.findByTestId('ext-schema-field-ext.pdf-extension.aistudioAccessToken-clear')).toBeTruthy()
    fireEvent.click(screen.getByTestId('ext-schema-field-ext.pdf-extension.aistudioAccessToken-clear'))
    await waitFor(() => expect(updateExtensionSettings).toHaveBeenCalledWith('pdf-extension', { 'ext.pdf-extension.aistudioAccessToken': null }, 'project-1'))
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
    listExtensions: vi.fn(async (_projectId?: string) => items.map(item => ({ ...item, grantedCapabilities: grants.get(item.id) }))),
    getCapabilityGrant: vi.fn(async (id: string) => ({ capabilities: grants.get(id) ?? [] })),
    confirmCapabilityGrant: vi.fn(async (id: string, capabilities: readonly string[]) => {
      grants.set(id, [...capabilities])
      items = items.map(item => item.id === id ? { ...item, grantedCapabilities: [...capabilities] } : item)
      return { capabilities: [...capabilities] }
    }),
    setExtensionEnabled: vi.fn(async (id: string, enabled: boolean, scope: 'app' | 'project', _projectId?: string) => {
      items = items.map(item => item.id === id ? { ...item, state: enabled ? 'enabled' as const : 'disabled' as const } : item)
      return items.find(item => item.id === id)!
    }),
    uninstallExtension: vi.fn(async (id: string) => {
      items = items.filter(item => item.id !== id)
    }),
    getExtensionSettings: vi.fn(async () => ({} as Record<string, unknown>)),
    updateExtensionSettings: vi.fn(async (id: string, patch: Record<string, unknown>) => ({
      ok: true as const,
      value: { ...patch },
    })),
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

  it('lists the merged project view so a project enable overlay wins over App disable', async () => {
    const host = managementHost([pkg({ id: 'quota', state: 'disabled', source: 'app' })])
    host.listExtensions = vi.fn(async (projectId?: string) => [
      pkg({
        id: 'quota',
        name: 'Quota',
        source: 'app',
        // App-only (no projectId) stays disabled; merged project view is enabled.
        state: projectId === 'project-1' ? 'enabled' : 'disabled',
      }),
    ]) as typeof host.listExtensions
    render(<ExtensionsPane host={host} projectId="project-1" addOpen={false} onCloseAdd={() => undefined} />)
    await waitFor(() => expect(host.listExtensions).toHaveBeenCalledWith('project-1'))
    expect((await screen.findByTestId('extensions-pkg-meta-quota')).textContent).toContain('已启用')
    fireEvent.click(screen.getByTestId('extensions-pkg-toggle-quota'))
    await waitFor(() => expect(host.setExtensionEnabled).toHaveBeenCalledWith('quota', false, 'project', 'project-1'))
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

describe('ExtensionsPane descriptions and inline settings', () => {
  it('renders the manifest description under the name and no placeholder when absent', async () => {
    const host = managementHost([
      pkg({ id: 'quota', state: 'enabled', description: '用量监控示例包' }),
      pkg({ id: 'office', state: 'disabled' }),
    ])
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} />)
    expect((await screen.findByTestId('extensions-pkg-desc-quota')).textContent).toBe('用量监控示例包')
    expect(screen.queryByTestId('extensions-pkg-desc-office')).toBeNull()
  })

  it('expands an inline schema settings form for an enabled package that declares settings', async () => {
    const host = managementHost([pkg({
      id: 'quota',
      state: 'enabled',
      contributions: {
        settings: {
          scope: 'app',
          schema: {
            type: 'object',
            properties: { 'ext.quota.threshold': { type: 'number', default: 80, title: '告警阈值（%）' } },
          },
        },
        settingsSections: [{ id: 'quota', title: '用量监控' }],
      },
    })])
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} />)
    fireEvent.click(await screen.findByTestId('extensions-pkg-settings-toggle-quota'))
    expect(await screen.findByTestId('ext-schema-field-ext.quota.threshold')).toBeTruthy()
    expect(host.getExtensionSettings).toHaveBeenCalledWith('quota')
  })

  it('renders host-owned auth on an enabled package and hides schema Token/Key fields', async () => {
    const status = {
      extensionId: 'acme',
      providerId: 'acme-chat',
      loggedIn: false,
      usable: false,
      accessToken: 'tok-secret',
      refreshToken: 'ref-secret',
    }
    const host = managementHost([pkg({
      id: 'acme',
      name: 'Acme Chat',
      state: 'enabled',
      contributions: {
        auth: { provider: { id: 'acme-chat', name: 'Acme Chat', oauth: true } },
        settings: {
          scope: 'app',
          schema: {
            type: 'object',
            properties: {
              accessToken: { type: 'string', format: 'secret', title: 'Access token' },
              xaiApiBaseUrl: { type: 'string', title: 'Base URL' },
              issuer: { type: 'string', title: 'OAuth issuer' },
              clientId: { type: 'string', title: 'OAuth client ID' },
              scopes: { type: 'string', title: 'OAuth scopes' },
              tier: { type: 'string', title: 'Subscription tier' },
              compatFallback: { type: 'boolean', title: 'Compat fallback' },
              sessionId: { type: 'string', title: 'Stable session ID' },
            },
          },
        },
        settingsSections: [{ id: 'acme', title: 'Acme' }],
      },
    })])
    Object.assign(host, {
      getExtensionAuthStatus: vi.fn(async () => status),
      beginExtensionLogin: vi.fn(async () => ({ loginId: 'login-1' })),
      logoutExtension: vi.fn(async () => ({ model: { provider: 'anthropic', id: 'a1', name: 'A1' }, thinkingLevel: 'off', availableThinkingLevels: [] })),
    })
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} />)
    expect(await screen.findByTestId('extensions-pkg-auth-acme')).toBeTruthy()
    expect(screen.getByTestId('extensions-pkg-auth-login-acme')).toBeTruthy()
    expect(screen.queryByTestId('extensions-pkg-settings-toggle-acme')).toBeNull()
    const card = screen.getByTestId('extensions-pkg-acme')
    expect(card.textContent).not.toContain('tok-secret')
    expect(card.textContent).not.toContain('ref-secret')
    expect(card.textContent).not.toMatch(/Access token|Base URL|OAuth issuer|OAuth client|OAuth scopes|Subscription tier|Compat fallback|session ID/i)
  })

  it('does not show auth controls on a disabled package that declares auth', async () => {
    const host = managementHost([pkg({
      id: 'acme',
      state: 'disabled',
      contributions: { auth: { provider: { id: 'acme-chat', name: 'Acme' } } },
    })])
    const getExtensionAuthStatus = vi.fn(async () => ({ extensionId: 'acme', providerId: 'acme-chat', loggedIn: false, usable: false }))
    Object.assign(host, { getExtensionAuthStatus })
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} />)
    expect(await screen.findByTestId('extensions-pkg-acme')).toBeTruthy()
    expect(screen.queryByTestId('extensions-pkg-auth-acme')).toBeNull()
    expect(getExtensionAuthStatus).not.toHaveBeenCalled()
  })

  it('hides the inline settings entry for disabled or settings-less packages', async () => {
    const host = managementHost([
      pkg({
        id: 'off',
        state: 'disabled',
        contributions: { settings: { scope: 'app', schema: { type: 'object' } } },
      }),
      pkg({ id: 'bare', state: 'enabled' }),
    ])
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} />)
    expect(await screen.findByTestId('extensions-pkg-off')).toBeTruthy()
    expect(screen.queryByTestId('extensions-pkg-settings-toggle-off')).toBeNull()
    expect(screen.queryByTestId('extensions-pkg-settings-toggle-bare')).toBeNull()
  })
})

describe('ExtensionsPane agent contributions', () => {
  it('shows contributed agents, source, availability, and patch diagnostics read-only', async () => {
    const host = managementHost([pkg({
      id: 'ext-research',
      name: 'Research Pack',
      state: 'enabled',
      source: 'project',
    })])
    Object.assign(host, {
      listAgentDefinitions: vi.fn(async () => [
        { name: 'explore', description: 'Bundled research', origin: 'bundled', source: 'bundled' },
        {
          name: 'ext-researcher',
          description: 'Extension researcher',
          extensionId: 'ext-research',
          origin: 'project',
          source: 'project',
          available: true,
          availability: 'available',
          permissionSummary: 'mode:read-only, filesystem:read-only',
          catalogDiagnostics: [{
            severity: 'error' as const,
            code: 'contribution-target-missing',
            message: 'Extension `ext-research` patch target `no-such-agent` is not in the effective catalog.',
            filePath: 'ext-research',
            agentName: 'no-such-agent',
          }],
        },
      ]),
    })
    render(<ExtensionsPane host={host} projectId="proj-1" addOpen={false} onCloseAdd={() => undefined} />)
    expect(await screen.findByTestId('extensions-pkg-contrib-ext-research')).toBeTruthy()
    expect(screen.getByTestId('extensions-pkg-agent-ext-research-ext-researcher').textContent).toContain('ext-researcher')
    expect(screen.getByTestId('extensions-pkg-agent-ext-research-ext-researcher').textContent).toContain('扩展 ext-research')
    expect(screen.getByTestId('extensions-pkg-agent-ext-research-ext-researcher').textContent).toContain('filesystem:read-only')
    expect(screen.getByTestId('extensions-pkg-contrib-diag-ext-research').textContent).toContain('contribution-target-missing')
    expect(screen.queryByText(/prompt editor|编辑 Prompt|systemPrompt/i)).toBeNull()
    fireEvent.click(within(screen.getByTestId('extensions-pkg-contrib-diag-ext-research')).getByRole('button', { name: '关闭错误提示' }))
    expect(screen.queryByTestId('extensions-pkg-contrib-diag-ext-research')).toBeNull()
    expect(screen.getByTestId('extensions-pkg-agent-ext-research-ext-researcher')).toBeTruthy()
  })

  it('shows successful patch provenance on the contributing extension without prompt text', async () => {
    const host = managementHost([pkg({
      id: 'ext-research',
      name: 'Research Pack',
      state: 'enabled',
      source: 'project',
    })])
    Object.assign(host, {
      listAgentDefinitions: vi.fn(async () => [
        {
          name: 'explore',
          description: 'Bundled research',
          origin: 'bundled',
          source: 'bundled',
          patches: [{
            extensionId: 'ext-research',
            origin: 'project' as const,
            operations: ['appendPrompt' as const, 'addTools' as const],
            addTools: ['code_search'],
          }],
        },
      ]),
    })
    render(<ExtensionsPane host={host} projectId="proj-1" addOpen={false} onCloseAdd={() => undefined} />)
    expect(await screen.findByTestId('extensions-pkg-patches-ext-research')).toBeTruthy()
    expect(screen.getByTestId('extensions-pkg-patch-ext-research-explore').textContent).toContain('explore')
    expect(screen.getByTestId('extensions-pkg-patch-ext-research-explore').textContent).toContain('追加 Prompt')
    expect(screen.getByTestId('extensions-pkg-patch-ext-research-explore').textContent).toContain('code_search')
    expect(screen.queryByText(/SECRET_PROMPT|systemPrompt|explore-extra\.md/i)).toBeNull()
  })

  it('shows requested custom addTools separately from accepted patches', async () => {
    const host = managementHost([pkg({
      id: 'ext-ghost',
      name: 'Ghost Pack',
      state: 'enabled',
      source: 'project',
    })])
    Object.assign(host, {
      listAgentDefinitions: vi.fn(async () => [
        {
          name: 'explore',
          description: 'Bundled research',
          origin: 'bundled',
          source: 'bundled',
          patches: [{
            extensionId: 'ext-ghost',
            origin: 'project' as const,
            operations: ['addTools' as const],
            addTools: ['ghost_tool'],
            status: 'requested' as const,
          }],
        },
      ]),
    })
    render(<ExtensionsPane host={host} projectId="proj-1" addOpen={false} onCloseAdd={() => undefined} />)
    expect(await screen.findByTestId('extensions-pkg-requested-ext-ghost')).toBeTruthy()
    expect(screen.getByTestId('extensions-pkg-requested-ext-ghost-explore').textContent).toContain('请求添加工具 ghost_tool（待运行验证）')
    expect(screen.queryByTestId('extensions-pkg-patches-ext-ghost')).toBeNull()
    expect(screen.queryByText('应用的补丁')).toBeNull()
    expect(screen.getByText('请求的补丁')).toBeTruthy()
  })

  it('shows accepted patches and rejected operations as dismissable diagnostics', async () => {
    const host = managementHost([pkg({
      id: 'ext-research',
      name: 'Research Pack',
      state: 'enabled',
      source: 'project',
    })])
    Object.assign(host, {
      listAgentDefinitions: vi.fn(async () => [
        {
          name: 'explore',
          description: 'Bundled research',
          origin: 'bundled',
          source: 'bundled',
          patches: [{
            extensionId: 'ext-research',
            origin: 'project' as const,
            operations: ['appendPrompt' as const, 'addTools' as const],
            addTools: ['code_search'],
          }],
          catalogDiagnostics: [{
            severity: 'error' as const,
            code: 'contribution-replace-forbidden',
            message: 'Extension `ext-research` cannot replacePrompt on canonical privileged bundled role `secretary`.',
            extensionId: 'ext-research',
            agentName: 'secretary',
          }, {
            severity: 'error' as const,
            code: 'contribution-reserved-tool',
            message: 'Extension `ext-research` cannot add host-issued or reserved tool `computer` to `secretary`.',
            extensionId: 'ext-research',
            agentName: 'secretary',
          }],
        },
      ]),
    })
    render(<ExtensionsPane host={host} projectId="proj-1" addOpen={false} onCloseAdd={() => undefined} />)
    expect(await screen.findByTestId('extensions-pkg-patches-ext-research')).toBeTruthy()
    expect(screen.getByTestId('extensions-pkg-patch-ext-research-explore').textContent).toContain('追加 Prompt')
    expect(screen.getByTestId('extensions-pkg-patch-ext-research-explore').textContent).toContain('code_search')
    expect(screen.getByTestId('extensions-pkg-patch-ext-research-explore').textContent).not.toContain('替换 Prompt')
    expect(screen.getByTestId('extensions-pkg-patch-ext-research-explore').textContent).not.toContain('computer')
    expect(screen.getByTestId('extensions-pkg-contrib-diag-ext-research').textContent).toContain('contribution-replace-forbidden')
    expect(screen.getByTestId('extensions-pkg-contrib-diag-ext-research').textContent).toContain('contribution-reserved-tool')
    expect(screen.queryByText(/SECRET_PROMPT|systemPrompt|\/tmp\//)).toBeNull()
  })

  it('shows dismissable load diagnostics instead of pretending there are no contributions', async () => {
    const host = managementHost([pkg({ id: 'quota', state: 'enabled', source: 'app' })])
    Object.assign(host, {
      listExtensions: vi.fn(async () => { throw new Error('scan failed at /tmp/secret-ext') }),
      listAgentDefinitions: vi.fn(async () => { throw new Error('catalog failed at /Users/haoli/hidden') }),
    })
    render(<ExtensionsPane host={host} projectId="proj-1" addOpen={false} onCloseAdd={() => undefined} />)
    const banner = await screen.findByTestId('extensions-catalog-diagnostics')
    expect(banner.textContent).toContain('extensions-load-failed')
    expect(banner.textContent).toContain('agent-catalog-load-failed')
    expect(banner.textContent).not.toContain('/tmp/secret-ext')
    expect(banner.textContent).not.toContain('/Users/haoli/hidden')
    expect(screen.getByTestId('extensions-packages-empty')).toBeTruthy()
    fireEvent.click(within(banner).getAllByRole('button', { name: '关闭错误提示' })[0]!)
    expect(screen.queryByText(/extensions-load-failed/)).toBeNull()
  })

  it('does not treat ignored optional agent fields as extension package errors', async () => {
    const host = managementHost([pkg({ id: 'built-in-skills', name: 'Built-in Skills', state: 'enabled', source: 'builtin' })])
    Object.assign(host, {
      listAgentDefinitions: vi.fn(async () => [
        {
          name: 'steward-init',
          description: 'COC L0',
          origin: 'project',
          source: 'project',
          catalogDiagnostics: [{
            severity: 'warning' as const,
            code: 'unknown-field',
            message: 'Unknown frontmatter field `thinking`; ignored by legacy compatibility mode.',
          }],
        },
      ]),
    })
    render(<ExtensionsPane host={host} projectId="proj-1" addOpen={false} onCloseAdd={() => undefined} />)
    expect(await screen.findByTestId('extensions-pkg-built-in-skills')).toBeTruthy()
    expect(screen.queryByTestId('extensions-catalog-diagnostics')).toBeNull()
    expect(screen.queryByText(/unknown-field/)).toBeNull()
  })

  it('hides contribution summary when the host only returns name/description catalog rows', async () => {
    const host = managementHost([pkg({ id: 'quota', state: 'enabled', source: 'app' })])
    Object.assign(host, {
      listAgentDefinitions: vi.fn(async () => [
        { name: 'explore', description: 'Research' },
      ]),
    })
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} />)
    expect(await screen.findByTestId('extensions-pkg-quota')).toBeTruthy()
    expect(screen.queryByTestId('extensions-pkg-contrib-quota')).toBeNull()
  })

  it('does not add a second confirmation when enabling a package that already has grants', async () => {
    const host = managementHost([pkg({
      id: 'ext-research',
      capabilities: ['bridge.emit'],
      grantedCapabilities: ['bridge.emit'],
    })])
    Object.assign(host, {
      listAgentDefinitions: vi.fn(async () => []),
    })
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} />)
    fireEvent.click(await screen.findByTestId('extensions-pkg-toggle-ext-research'))
    await waitFor(() => expect(host.setExtensionEnabled).toHaveBeenCalledWith('ext-research', true, 'project'))
    expect(screen.queryByTestId('extensions-grant-dialog')).toBeNull()
    expect(host.confirmCapabilityGrant).not.toHaveBeenCalled()
  })
})

describe('ExtensionsPane host-owned feature panes', () => {
  const vision = {
    enabled: false,
    model: null as string | null,
    available: true,
    loading: false,
    saving: false,
    error: null as string | null,
    refresh: async () => undefined,
    setEnabled: async () => undefined,
    setModel: async () => undefined,
    dismissError: () => undefined,
  }
  const visibility = {
    models: [],
    quickModels: [],
    visibleModels: [],
    hiddenIds: new Set<string>(),
    loading: false,
    error: null,
    refresh: async () => undefined,
    toggle: async () => undefined,
    toggleProvider: async () => undefined,
    dismissError: () => undefined,
  }
  const scan = {
    enabled: true,
    available: true,
    loading: false,
    saving: false,
    error: null,
    refresh: async () => undefined,
    setEnabled: async () => undefined,
    dismissError: () => undefined,
  }

  it('renders vision, web-search, and scan panes for enabled builtins and hides schema toggles', async () => {
    const host = managementHost([
      pkg({
        id: 'vision-routing',
        name: '识图模型',
        state: 'enabled',
        source: 'builtin',
        contributions: {
          settings: { scope: 'project', schema: { type: 'object', properties: { 'ext.vision-routing.enabled': { type: 'boolean' } } } },
          settingsSections: [{ id: 'vision-routing', title: '识图模型' }],
        },
      }),
      pkg({
        id: 'web-search-keys',
        name: 'Web 搜索密钥',
        state: 'enabled',
        source: 'builtin',
        contributions: {
          settings: { scope: 'project', schema: { type: 'object', properties: {} } },
          settingsSections: [{ id: 'web-search-keys', title: 'Web 搜索密钥' }],
        },
      }),
      pkg({
        id: 'external-session-scan',
        name: '自动扫描外部会话',
        state: 'enabled',
        source: 'builtin',
        contributions: {
          settings: { scope: 'project', schema: { type: 'object', properties: {} } },
          settingsSections: [{ id: 'external-session-scan', title: '自动扫描外部会话' }],
        },
      }),
    ])
    Object.assign(host, {
      getWebSearchKeys: vi.fn(async () => ({})),
      setWebSearchKeys: vi.fn(async () => []),
    })
    render(<ExtensionsPane host={host} projectId="demo" addOpen={false} onCloseAdd={() => undefined} vision={vision as never} visibility={visibility as never} scan={scan as never} />)
    expect(await screen.findByTestId('vision-picker')).toBeTruthy()
    expect(screen.getByTestId('web-search-keys-pane')).toBeTruthy()
    expect(screen.getByTestId('scan-external-pane')).toBeTruthy()
    expect(screen.queryByTestId('extensions-pkg-settings-toggle-vision-routing')).toBeNull()
    expect(screen.queryByTestId('extensions-pkg-settings-toggle-web-search-keys')).toBeNull()
    expect(screen.queryByTestId('extensions-pkg-settings-toggle-external-session-scan')).toBeNull()
  })

  it('hides the vision pane when the extension is disabled', async () => {
    const host = managementHost([pkg({
      id: 'vision-routing',
      name: '识图模型',
      state: 'disabled',
      source: 'builtin',
      contributions: { settingsSections: [{ id: 'vision-routing', title: '识图模型' }] },
    })])
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} vision={vision as never} visibility={visibility as never} />)
    expect(await screen.findByTestId('extensions-pkg-vision-routing')).toBeTruthy()
    expect(screen.queryByTestId('vision-picker')).toBeNull()
  })

  it('renders the external-session scan switch and persists the toggle', async () => {
    const host = managementHost([pkg({
      id: 'external-session-scan',
      name: '自动扫描外部会话',
      state: 'enabled',
      source: 'builtin',
      contributions: { settingsSections: [{ id: 'external-session-scan', title: '自动扫描外部会话' }] },
    })])
    const setEnabled = vi.fn(async (enabled: boolean) => enabled)
    render(<ExtensionsPane host={host} projectId="demo" addOpen={false} onCloseAdd={() => undefined} scan={{ ...scan, setEnabled } as never} />)
    const pane = await screen.findByTestId('scan-external-pane')
    const toggle = screen.getByTestId('scan-external-sessions-switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(within(pane).getByText('自动扫描其他 coding agent 聊天记录')).toBeTruthy()
    fireEvent.click(toggle)
    expect(setEnabled).toHaveBeenCalledWith(false)
  })

  it('hides the external-session scan pane when the extension is disabled', async () => {
    const host = managementHost([pkg({
      id: 'external-session-scan',
      name: '自动扫描外部会话',
      state: 'disabled',
      source: 'builtin',
      contributions: { settingsSections: [{ id: 'external-session-scan', title: '自动扫描外部会话' }] },
    })])
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} scan={scan as never} />)
    expect(await screen.findByTestId('extensions-pkg-external-session-scan')).toBeTruthy()
    expect(screen.queryByTestId('scan-external-pane')).toBeNull()
  })
})
