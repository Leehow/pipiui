// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App, createMockHost } from './App'

afterEach(() => cleanup())

describe('App Product Profile projection', () => {
  it('keeps a generic primary sidebar and Kernel settings in the base Profile without Coding surfaces', async () => {
    const host = createMockHost()
    host.newSession = vi.fn(host.newSession)
    host.listProductProfiles = vi.fn(async () => [{
      id: 'base',
      name: '基础版',
      state: 'available' as const,
      layout: { primarySidebar: 'pipi.sessions', center: 'pipi.conversation', activity: ['pipi.sessions'] },
      requiredExtensionIds: ['skill-loader-extension'],
    }])
    host.getProductProfile = vi.fn(async () => ({ schemaVersion: 2 as const, profile: 'base', overrides: {} }))
    host.setProductProfile = vi.fn(async () => ({ schemaVersion: 2 as const, profile: 'base', overrides: {} }))

    const rendered = render(<App host={host} />)
    await waitFor(() => expect(rendered.container.querySelector('[data-workbench-container="pipi.sessions"]')).toBeTruthy())
    expect(rendered.getByTestId('sidebar')).toBeTruthy()
    expect(rendered.getByTestId('open-settings-header')).toBeTruthy()
    expect(rendered.queryByTestId('git-branch-button')).toBeNull()
    expect(rendered.queryByTestId('tool-quick-rail')).toBeNull()
    expect(rendered.container.querySelector('.pipiui-shell')?.className).not.toContain('sidebar-collapsed')
    expect(rendered.queryByRole('separator', { name: '调整左栏宽度' })).toBeTruthy()
    expect(rendered.queryByText('Subagents')).toBeNull()
    expect(rendered.getByTestId('sidebar-footer')).toBeTruthy()
    expect(rendered.getByTestId('composer-read-only').textContent).toContain('此会话使用 coding Profile')
    rendered.getByTestId('new-conversation-header').click()
    await waitFor(() => expect(host.newSession).toHaveBeenCalled())
  })
})
