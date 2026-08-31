// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionDescriptor, PipiHostAPI } from '@pipi/host-api'
import { ExtensionsPane } from './ExtensionsPane'

afterEach(() => {
  cleanup()
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
    updateExtensionSettings: vi.fn(async (_id: string, patch: Record<string, unknown>) => ({
      ok: true as const,
      value: { ...patch },
    })),
  }
  return host as unknown as PipiHostAPI & typeof host
}

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
    expect(screen.getByTestId('extensions-packs-empty')).toBeTruthy()
    fireEvent.click(within(banner).getAllByRole('button', { name: '关闭错误提示' })[0]!)
    expect(screen.queryByText(/extensions-load-failed/)).toBeNull()
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
