// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthLoginEvent, ExtensionAuthStatus, ModelState, PipiHostAPI } from '@pipi/host-api'
import { ExtensionAuthCard } from './ExtensionAuthCard'

afterEach(() => {
  cleanup()
})

const signedOut: ExtensionAuthStatus = {
  extensionId: 'acme',
  providerId: 'acme-chat',
  loggedIn: false,
  usable: false,
}

const signedIn: ExtensionAuthStatus = {
  extensionId: 'acme',
  providerId: 'acme-chat',
  loggedIn: true,
  usable: true,
  expiresAtMs: Date.now() + 3_600_000,
}

const emptyModel: ModelState = {
  model: { provider: 'anthropic', id: 'a1', name: 'A1' },
  thinkingLevel: 'off',
  availableThinkingLevels: [],
}

function authHost(overrides: Partial<PipiHostAPI> = {}) {
  let status: ExtensionAuthStatus = { ...signedOut }
  const events: AuthLoginEvent[] = [
    { kind: 'auth_url', url: 'https://auth.example.com/acme', code: 'ABCD-1234' },
    { kind: 'completed', providerId: 'acme-chat' },
  ]
  const host = {
    getExtensionAuthStatus: vi.fn(async () => ({ ...status })),
    beginExtensionLogin: vi.fn(async () => ({ loginId: 'login-1' })),
    continueProviderLogin: vi.fn(async () => events.shift() ?? { kind: 'completed' as const, providerId: 'acme-chat' }),
    cancelProviderLogin: vi.fn(async () => undefined),
    logoutExtension: vi.fn(async () => {
      status = { ...signedOut }
      return emptyModel
    }),
    openExternal: vi.fn(async () => undefined),
    subscribeModelCatalog: vi.fn(() => () => undefined),
    ...overrides,
  }
  return Object.assign(host, {
    setStatus(next: ExtensionAuthStatus) { status = { ...next } },
  }) as unknown as PipiHostAPI & typeof host & { setStatus(next: ExtensionAuthStatus): void }
}

describe('ExtensionAuthCard', () => {
  it('shows signed-out Login and never renders tokens or infrastructure fields', async () => {
    const host = authHost({
      getExtensionAuthStatus: vi.fn(async () => ({
        ...signedOut,
        accessToken: 'tok-secret',
        refreshToken: 'ref-secret',
        apiKey: 'sk-secret',
        token: 'tok-secret',
        key: 'k-secret',
        secret: 's-secret',
        authorization: 'Bearer tok-secret',
      } as ExtensionAuthStatus)),
    })
    render(<ExtensionAuthCard host={host} extensionId="acme" />)
    expect((await screen.findByTestId('extensions-pkg-auth-status-acme')).textContent).toContain('未登录')
    expect(screen.getByTestId('extensions-pkg-auth-login-acme')).toBeTruthy()
    const card = screen.getByTestId('extensions-pkg-auth-acme')
    expect(card.textContent).not.toMatch(/tok-secret|ref-secret|sk-secret|k-secret|s-secret|Bearer/)
    expect(card.textContent).not.toMatch(/Token|Key|Base URL|issuer|client|scopes|tier|compat|session ID|sessionId/i)
    expect(host.getExtensionAuthStatus).toHaveBeenCalledWith('acme')
  })

  it('starts a generic login and shows pending, then signed-in Logout/Re-login', async () => {
    const host = authHost()
    host.getExtensionAuthStatus = vi.fn(async () => signedOut)
      .mockResolvedValueOnce(signedOut)
      .mockResolvedValue(signedIn)
    render(<ExtensionAuthCard host={host} extensionId="acme" />)
    fireEvent.click(await screen.findByTestId('extensions-pkg-auth-login-acme'))
    expect(host.beginExtensionLogin).toHaveBeenCalledWith('acme')
    expect(await screen.findByTestId('extensions-pkg-auth-url-acme')).toBeTruthy()
    expect(screen.getByTestId('extensions-pkg-auth-status-acme').textContent).toContain('正在登录')
    fireEvent.click(screen.getByRole('button', { name: '我已授权，继续' }))
    await waitFor(() => expect(screen.getByTestId('extensions-pkg-auth-status-acme').textContent).toContain('已登录'))
    expect(screen.getByTestId('extensions-pkg-auth-logout-acme')).toBeTruthy()
    expect(screen.getByTestId('extensions-pkg-auth-relogin-acme')).toBeTruthy()
    expect(screen.queryByTestId('extensions-pkg-auth-login-acme')).toBeNull()
  })

  it('logs out through the generic host API', async () => {
    const host = authHost()
    host.setStatus(signedIn)
    render(<ExtensionAuthCard host={host} extensionId="acme" />)
    fireEvent.click(await screen.findByTestId('extensions-pkg-auth-logout-acme'))
    await waitFor(() => expect(host.logoutExtension).toHaveBeenCalledWith('acme'))
    await waitFor(() => expect(screen.getByTestId('extensions-pkg-auth-login-acme')).toBeTruthy())
  })

  it('shows a dismissible error with retry after login failure', async () => {
    const host = authHost({
      beginExtensionLogin: vi.fn(async () => { throw new Error('device busy') }),
    })
    render(<ExtensionAuthCard host={host} extensionId="acme" />)
    fireEvent.click(await screen.findByTestId('extensions-pkg-auth-login-acme'))
    const error = await screen.findByTestId('extensions-pkg-auth-error-acme')
    expect(error.textContent).toContain('device busy')
    expect(screen.getByRole('button', { name: '关闭错误提示' }).textContent).toContain('×')
    fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }))
    expect(screen.queryByTestId('extensions-pkg-auth-error-acme')).toBeNull()

    host.beginExtensionLogin = vi.fn(async () => { throw new Error('still busy') })
    fireEvent.click(screen.getByTestId('extensions-pkg-auth-login-acme'))
    expect(await screen.findByTestId('extensions-pkg-auth-error-acme')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(host.beginExtensionLogin).toHaveBeenCalledTimes(2))
  })
})
