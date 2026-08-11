// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthProviderInfo, PipiHostAPI } from '@pipi/host-api'
import { ProviderLoginPanel } from './ProviderLoginPanel'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const provider: AuthProviderInfo = {
  id: 'github-copilot', name: 'GitHub Copilot', authTypes: ['oauth'], authenticated: false
}

function providerHost(overrides: Partial<PipiHostAPI> = {}): PipiHostAPI {
  return {
    authProviders: vi.fn(async () => [provider]),
    beginProviderLogin: vi.fn(),
    continueProviderLogin: vi.fn(),
    cancelProviderLogin: vi.fn(),
    ...overrides
  } as unknown as PipiHostAPI
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('ProviderLoginPanel provider catalog loading', () => {
  it('shows a timed-out provider catalog error with retry', async () => {
    vi.useFakeTimers()
    const never = deferred<AuthProviderInfo[]>()
    render(<ProviderLoginPanel host={providerHost({ authProviders: vi.fn(() => never.promise) })} onAdded={vi.fn()} />)

    await act(async () => { await vi.advanceTimersByTimeAsync(8_000) })

    expect(screen.getByTestId('provider-add-error').textContent).toContain('加载 provider 目录超时')
    expect(screen.getByTestId('provider-add-error').textContent).toContain('手动退出并重新打开 PipiUI')
    expect(screen.getByTestId('provider-add-retry')).toBeTruthy()
  })

  it('renders a distinct empty catalog state and retries it', async () => {
    const authProviders = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([provider])
    render(<ProviderLoginPanel host={providerHost({ authProviders })} onAdded={vi.fn()} />)

    expect((await screen.findByTestId('provider-add-empty')).textContent).toContain('未发现可登录 Provider')
    fireEvent.click(screen.getByTestId('provider-add-retry'))
    expect(await screen.findByTestId('provider-row-github-copilot')).toBeTruthy()
    expect(authProviders).toHaveBeenCalledTimes(2)
  })

  it('reports an immediately rejected provider request and offers retry', async () => {
    render(<ProviderLoginPanel host={providerHost({ authProviders: vi.fn(async () => { throw new Error('backend offline') }) })} onAdded={vi.fn()} />)

    expect((await screen.findByTestId('provider-add-error')).textContent).toContain('backend offline')
    expect(screen.getByTestId('provider-add-retry')).toBeTruthy()
  })

  it('does not let an old timed-out request overwrite a newer retry result', async () => {
    vi.useFakeTimers()
    const first = deferred<AuthProviderInfo[]>()
    const authProviders = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce([provider])
    render(<ProviderLoginPanel host={providerHost({ authProviders })} onAdded={vi.fn()} />)

    await act(async () => { await vi.advanceTimersByTimeAsync(8_000) })
    await act(async () => {
      fireEvent.click(screen.getByTestId('provider-add-retry'))
      await Promise.resolve()
    })
    expect(screen.getByTestId('provider-row-github-copilot')).toBeTruthy()

    await act(async () => { first.resolve([]); await Promise.resolve() })
    expect(screen.getByTestId('provider-row-github-copilot')).toBeTruthy()
    expect(screen.queryByTestId('provider-add-empty')).toBeNull()
  })

  it('diagnoses an old preload that omits authProviders instead of showing an empty catalog', async () => {
    const host = providerHost({ authProviders: undefined })
    render(<ProviderLoginPanel host={host} onAdded={vi.fn()} />)

    const error = await screen.findByTestId('provider-add-error')
    expect(error.textContent).toContain('authProviders')
    expect(error.textContent).toContain('主进程尚未更新')
    expect(error.textContent).toContain('手动退出并重新打开 PipiUI')
    expect(screen.queryByTestId('provider-add-empty')).toBeNull()
  })
})
