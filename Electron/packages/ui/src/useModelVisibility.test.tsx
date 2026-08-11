// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Model, PipiHostAPI } from '@pipi/host-api'
import { modelRef } from './model-visibility'
import { useModelVisibility } from './useModelVisibility'

const first: Model = { provider: 'openai', id: 'gpt-5', name: 'GPT-5', reasoning: true }
const second: Model = { provider: 'openai', id: 'openai-codex', name: 'OpenAI Codex', reasoning: true }

function visibilityHost(overrides: Partial<PipiHostAPI> = {}): PipiHostAPI {
  return {
    listModels: vi.fn(async () => [first, second]),
    getHiddenModelIds: vi.fn(async () => []),
    setHiddenModelIds: vi.fn(async (ids: string[]) => ids),
    ...overrides
  } as unknown as PipiHostAPI
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function loaded(result: { current: ReturnType<typeof useModelVisibility> }) {
  await waitFor(() => expect(result.current.loading).toBe(false))
}

describe('useModelVisibility host contract and ordering', () => {
  it('does not turn an invalid get response into an empty hidden set', async () => {
    const getHiddenModelIds = vi.fn()
      .mockResolvedValueOnce([modelRef(first)])
      .mockResolvedValueOnce(undefined)
    const host = visibilityHost({ getHiddenModelIds })
    const { result } = renderHook(() => useModelVisibility(host))
    await loaded(result)
    expect(result.current.hiddenIds.has(modelRef(first))).toBe(true)

    await act(async () => { await result.current.refresh() })

    expect(result.current.hiddenIds.has(modelRef(first))).toBe(true)
    expect(result.current.error).toContain('主进程尚未更新')
    expect(result.current.error).toContain('手动退出并重新打开 PipiUI')
  })

  it('keeps the optimistic selection when save acknowledgement is undefined', async () => {
    const host = visibilityHost({ setHiddenModelIds: vi.fn(async () => undefined) as unknown as PipiHostAPI['setHiddenModelIds'] })
    const { result } = renderHook(() => useModelVisibility(host))
    await loaded(result)

    await act(async () => { await result.current.setHidden(first, true) })

    expect(result.current.hiddenIds.has(modelRef(first))).toBe(true)
    expect(result.current.error).toContain('setHiddenModelIds')
    expect(result.current.error).toContain('手动退出并重新打开 PipiUI')
    act(() => result.current.dismissError())
    expect(result.current.error).toBeNull()
  })

  it('ignores a late pre-save load rather than overwriting the saved optimistic state', async () => {
    const initialGet = deferred<string[]>()
    const host = visibilityHost({ getHiddenModelIds: vi.fn(() => initialGet.promise) })
    const { result } = renderHook(() => useModelVisibility(host))

    await act(async () => { await result.current.setHidden(first, true) })
    expect(result.current.hiddenIds.has(modelRef(first))).toBe(true)

    await act(async () => { initialGet.resolve([]) })
    await waitFor(() => expect(result.current.hiddenIds.has(modelRef(first))).toBe(true))
    expect(result.current.error).toBeNull()
  })

  it('serializes rapid mutations and finishes with the latest complete selection', async () => {
    const firstSave = deferred<string[]>()
    const setHiddenModelIds = vi.fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementation(async (ids: string[]) => ids)
    const host = visibilityHost({ setHiddenModelIds })
    const { result } = renderHook(() => useModelVisibility(host))
    await loaded(result)

    let saveOne!: Promise<void>
    await act(async () => { saveOne = result.current.setHidden(first, true) })
    await waitFor(() => expect(setHiddenModelIds).toHaveBeenCalledTimes(1))
    let saveTwo!: Promise<void>
    await act(async () => { saveTwo = result.current.setHidden(second, true) })
    await act(async () => { firstSave.resolve([modelRef(first)]) })
    await act(async () => { await Promise.all([saveOne, saveTwo]) })

    expect(result.current.hiddenIds).toEqual(new Set([modelRef(first), modelRef(second)]))
    expect(setHiddenModelIds).toHaveBeenLastCalledWith([modelRef(first), modelRef(second)])
  })

  it('rolls a rejected save back only to the verified state at mutation start', async () => {
    const host = visibilityHost({
      getHiddenModelIds: vi.fn(async () => [modelRef(first)]),
      setHiddenModelIds: vi.fn(async () => { throw new Error('disk full') })
    })
    const { result } = renderHook(() => useModelVisibility(host))
    await loaded(result)

    await act(async () => { await result.current.setHidden(second, true) })

    expect(result.current.hiddenIds).toEqual(new Set([modelRef(first)]))
    expect(result.current.error).toContain('保存模型可见性失败：disk full')
  })
})
