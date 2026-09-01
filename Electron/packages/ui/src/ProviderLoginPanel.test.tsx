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

describe('ProviderLoginPanel OpenAI-compatible form', () => {
  function expandCompat() {
    fireEvent.click(screen.getByTestId('provider-compat-toggle'))
  }

  it('renders the custom form above official providers', async () => {
    render(<ProviderLoginPanel host={providerHost()} onAdded={vi.fn()} />)
    await screen.findByTestId('provider-row-github-copilot')
    const root = screen.getByTestId('provider-add')
    const first = root.querySelector('[data-testid]')
    expect(first?.getAttribute('data-testid')).toBe('provider-compat')
  })

  it('keeps the custom form collapsed until the header is clicked', async () => {
    render(<ProviderLoginPanel host={providerHost()} onAdded={vi.fn()} />)
    await screen.findByTestId('provider-row-github-copilot')
    expect(screen.queryByTestId('provider-compat-form')).toBeNull()
    expandCompat()
    expect(screen.getByTestId('provider-compat-form')).toBeTruthy()
    expect(screen.getByTestId('provider-compat-toggle').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByLabelText('名称')).toBeTruthy()
    expect(screen.getByLabelText('URL')).toBeTruthy()
    expect(screen.getByLabelText('Key')).toBeTruthy()
    expect(screen.getByLabelText('模型 id')).toBeTruthy()
    expect(screen.getByLabelText(/上下文窗口/)).toBeTruthy()
    fireEvent.click(screen.getByTestId('provider-compat-toggle'))
    expect(screen.queryByTestId('provider-compat-form')).toBeNull()
  })

  it('saves via host.addOpenAICompatibleProvider and notifies onAdded', async () => {
    const addOpenAICompatibleProvider = vi.fn(async () => ({ providerId: 'my-proxy' }))
    const onAdded = vi.fn()
    render(<ProviderLoginPanel host={providerHost({ addOpenAICompatibleProvider })} onAdded={onAdded} />)
    await screen.findByTestId('provider-row-github-copilot')
    expandCompat()
    fireEvent.change(screen.getByTestId('provider-compat-name'), { target: { value: 'My Proxy' } })
    fireEvent.change(screen.getByTestId('provider-compat-url'), { target: { value: 'https://proxy.example/v1' } })
    fireEvent.change(screen.getByTestId('provider-compat-key'), { target: { value: 'sk-test' } })
    fireEvent.change(screen.getByTestId('provider-compat-model'), { target: { value: 'gpt-4o-mini' } })
    fireEvent.click(screen.getByTestId('provider-compat-save'))
    await act(async () => { await Promise.resolve() })
    expect(addOpenAICompatibleProvider).toHaveBeenCalledWith({
      name: 'My Proxy',
      baseUrl: 'https://proxy.example/v1',
      apiKey: 'sk-test',
      modelId: 'gpt-4o-mini',
    })
    expect(onAdded).toHaveBeenCalledTimes(1)
  })

  it('passes contextWindow when the optional field is a positive integer', async () => {
    const addOpenAICompatibleProvider = vi.fn(async () => ({ providerId: 'my-proxy' }))
    render(<ProviderLoginPanel host={providerHost({ addOpenAICompatibleProvider })} onAdded={vi.fn()} />)
    await screen.findByTestId('provider-row-github-copilot')
    expandCompat()
    fireEvent.change(screen.getByTestId('provider-compat-name'), { target: { value: 'My Proxy' } })
    fireEvent.change(screen.getByTestId('provider-compat-url'), { target: { value: 'https://proxy.example/v1' } })
    fireEvent.change(screen.getByTestId('provider-compat-key'), { target: { value: 'sk-test' } })
    fireEvent.change(screen.getByTestId('provider-compat-model'), { target: { value: 'gpt-4o-mini' } })
    fireEvent.change(screen.getByTestId('provider-compat-context'), { target: { value: '131072' } })
    fireEvent.click(screen.getByTestId('provider-compat-save'))
    await act(async () => { await Promise.resolve() })
    expect(addOpenAICompatibleProvider).toHaveBeenCalledWith({
      name: 'My Proxy',
      baseUrl: 'https://proxy.example/v1',
      apiKey: 'sk-test',
      modelId: 'gpt-4o-mini',
      contextWindow: 131072,
    })
  })
})

describe('ProviderLoginPanel model-id dropdown', () => {
  function typeUrlAndKey() {
    fireEvent.change(screen.getByTestId('provider-compat-url'), { target: { value: 'https://proxy.example/v1' } })
    fireEvent.change(screen.getByTestId('provider-compat-key'), { target: { value: 'sk-test' } })
  }

  it('auto-fetches model ids after url+key and autofills the context window on pick', async () => {
    const listOpenAICompatibleModels = vi.fn(async () => ({ models: [
      { id: 'zeta-model' },
      { id: 'gpt-4o-mini', contextWindow: 128000 },
    ] }))
    const addOpenAICompatibleProvider = vi.fn(async () => ({ providerId: 'my-proxy' }))
    render(<ProviderLoginPanel host={providerHost({ listOpenAICompatibleModels, addOpenAICompatibleProvider })} onAdded={vi.fn()} />)
    await screen.findByTestId('provider-row-github-copilot')
    vi.useFakeTimers()
    fireEvent.click(screen.getByTestId('provider-compat-toggle'))
    fireEvent.change(screen.getByTestId('provider-compat-name'), { target: { value: 'My Proxy' } })
    typeUrlAndKey()
    expect(screen.queryByTestId('provider-compat-model-select')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(listOpenAICompatibleModels).toHaveBeenCalledWith({ baseUrl: 'https://proxy.example/v1', apiKey: 'sk-test' })
    const select = screen.getByTestId('provider-compat-model-select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'gpt-4o-mini' } })
    expect((screen.getByTestId('provider-compat-context') as HTMLInputElement).value).toBe('128000')
    expect((screen.getByTestId('provider-compat-model-select') as HTMLSelectElement).value).toBe('gpt-4o-mini')
    fireEvent.click(screen.getByTestId('provider-compat-save'))
    await act(async () => { await Promise.resolve() })
    expect(addOpenAICompatibleProvider).toHaveBeenCalledWith({
      name: 'My Proxy',
      baseUrl: 'https://proxy.example/v1',
      apiKey: 'sk-test',
      modelId: 'gpt-4o-mini',
      contextWindow: 128000,
    })
  })

  it('falls back to the manual input when the catalog fetch fails', async () => {
    const listOpenAICompatibleModels = vi.fn(async () => { throw new Error('HTTP 401') })
    render(<ProviderLoginPanel host={providerHost({ listOpenAICompatibleModels })} onAdded={vi.fn()} />)
    await screen.findByTestId('provider-row-github-copilot')
    vi.useFakeTimers()
    fireEvent.click(screen.getByTestId('provider-compat-toggle'))
    typeUrlAndKey()
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(screen.getByTestId('provider-compat-models-error').textContent).toContain('HTTP 401')
    expect(screen.getByTestId('provider-compat-models-error').textContent).toContain('可手动输入')
    expect(screen.getByTestId('provider-compat-model')).toBeTruthy()
  })

  it('offers a manual input toggle when the catalog loaded', async () => {
    const listOpenAICompatibleModels = vi.fn(async () => ({ models: [{ id: 'only-model' }] }))
    render(<ProviderLoginPanel host={providerHost({ listOpenAICompatibleModels })} onAdded={vi.fn()} />)
    await screen.findByTestId('provider-row-github-copilot')
    vi.useFakeTimers()
    fireEvent.click(screen.getByTestId('provider-compat-toggle'))
    typeUrlAndKey()
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(screen.queryByTestId('provider-compat-model')).toBeNull()
    fireEvent.click(screen.getByTestId('provider-compat-manual-toggle'))
    expect(screen.getByTestId('provider-compat-model')).toBeTruthy()
  })
})

describe('ProviderLoginPanel connectivity test', () => {
  function fillForm() {
    fireEvent.change(screen.getByTestId('provider-compat-name'), { target: { value: 'My Proxy' } })
    fireEvent.change(screen.getByTestId('provider-compat-url'), { target: { value: 'https://proxy.example/v1' } })
    fireEvent.change(screen.getByTestId('provider-compat-key'), { target: { value: 'sk-test' } })
    fireEvent.change(screen.getByTestId('provider-compat-model'), { target: { value: 'gpt-4o-mini' } })
  }

  it('reports first-token latency and generation throughput', async () => {
    const testOpenAICompatibleModel = vi.fn(async () => ({ ok: true as const, firstTokenMs: 412, totalMs: 2100, tokens: 64, tokensPerSecond: 38.5, preview: 'OK' }))
    render(<ProviderLoginPanel host={providerHost({ testOpenAICompatibleModel })} onAdded={vi.fn()} />)
    await screen.findByTestId('provider-row-github-copilot')
    fireEvent.click(screen.getByTestId('provider-compat-toggle'))
    fillForm()
    fireEvent.click(screen.getByTestId('provider-compat-test'))
    expect(screen.getByTestId('provider-compat-test').textContent).toBe('测试中…')
    await act(async () => { await Promise.resolve() })
    expect(testOpenAICompatibleModel).toHaveBeenCalledWith({ baseUrl: 'https://proxy.example/v1', apiKey: 'sk-test', modelId: 'gpt-4o-mini' })
    expect(screen.getByTestId('provider-compat-test-result').textContent).toContain('首字 412 ms')
    expect(screen.getByTestId('provider-compat-test-result').textContent).toContain('生成 38.5 tok/s')
    expect(screen.getByTestId('provider-compat-test-result').textContent).toContain('共 2100 ms')
  })

  it('shows the probe error when the model is unreachable', async () => {
    const testOpenAICompatibleModel = vi.fn(async () => { throw new Error('HTTP 502：bad gateway') })
    render(<ProviderLoginPanel host={providerHost({ testOpenAICompatibleModel })} onAdded={vi.fn()} />)
    await screen.findByTestId('provider-row-github-copilot')
    fireEvent.click(screen.getByTestId('provider-compat-toggle'))
    fillForm()
    fireEvent.click(screen.getByTestId('provider-compat-test'))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByTestId('provider-compat-test-error').textContent).toContain('HTTP 502')
    expect(screen.getByTestId('provider-compat-test').textContent).toBe('测试连通性')
  })

  it('hides the test button on hosts without the capability', async () => {
    render(<ProviderLoginPanel host={providerHost()} onAdded={vi.fn()} />)
    await screen.findByTestId('provider-row-github-copilot')
    fireEvent.click(screen.getByTestId('provider-compat-toggle'))
    expect(screen.queryByTestId('provider-compat-test')).toBeNull()
  })
})
