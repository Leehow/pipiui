import { describe, expect, it, vi } from 'vitest'
import { createExtensionHostAPI, type ExtEvent } from '../src/index.ts'

describe('createExtensionHostAPI capability trimming', () => {
  it('omits undeclared capability services from the injected object', () => {
    const api = createExtensionHostAPI({
      extensionId: 'quota',
      capabilities: ['settings.read'],
      host: {
        getExtensionSettings: async () => ({ 'ext.quota.threshold': 80 }),
      },
    })

    expect(Object.hasOwn(api, 'settings')).toBe(true)
    expect(Object.hasOwn(api.settings ?? {}, 'get')).toBe(true)
    expect(Object.hasOwn(api.settings ?? {}, 'update')).toBe(false)
    expect(api.settings?.update).toBeUndefined()
    expect(Object.hasOwn(api, 'invoke')).toBe(false)
    expect(api.invoke).toBeUndefined()
    expect(Object.hasOwn(api, 'notify')).toBe(false)
    expect(api.notify).toBeUndefined()
    expect('listProjects' in api).toBe(false)
  })

  it('empty capabilities only keep subscribeExt (L0)', () => {
    const api = createExtensionHostAPI({
      extensionId: 'quota',
      capabilities: [],
      host: {},
    })
    expect(typeof api.subscribeExt).toBe('function')
    expect(Object.hasOwn(api, 'settings')).toBe(false)
    expect(Object.hasOwn(api, 'invoke')).toBe(false)
    expect(Object.hasOwn(api, 'notify')).toBe(false)
  })

  it('binds settings / invoke / notify to this extension id', async () => {
    const getExtensionSettings = vi.fn(async (id: string) => ({ id }))
    const updateExtensionSettings = vi.fn(async (id: string, patch: Record<string, unknown>) => ({
      ok: true as const,
      data: patch,
    }))
    const invokeExtension = vi.fn(async (id: string, method: string, params: unknown) => ({
      ok: true as const,
      data: { id, method, params },
    }))
    const notify = vi.fn()
    const listeners = new Set<(event: ExtEvent) => void>()

    const api = createExtensionHostAPI({
      extensionId: 'quota',
      capabilities: ['settings.read', 'settings.write', 'invoke.agent', 'notifications'],
      host: {
        getExtensionSettings,
        updateExtensionSettings,
        invokeExtension,
        notify,
        subscribeExt: (_id, listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
    })

    await expect(api.settings?.get?.()).resolves.toEqual({ id: 'quota' })
    expect(getExtensionSettings).toHaveBeenCalledWith('quota')

    await api.settings?.update?.({ 'ext.quota.threshold': 90 })
    expect(updateExtensionSettings).toHaveBeenCalledWith('quota', { 'ext.quota.threshold': 90 })

    await api.invoke?.('ping', { n: 1 })
    expect(invokeExtension).toHaveBeenCalledWith('quota', 'ping', { n: 1 })

    await api.notify?.('title', 'body')
    expect(notify).toHaveBeenCalledWith('title', 'body')

    const seen: ExtEvent[] = []
    const stop = api.subscribeExt(event => { seen.push(event) })
    for (const listener of listeners) listener({ type: 'warning', payload: { used: 92 } })
    expect(seen).toEqual([{ type: 'warning', payload: { used: 92 } }])
    stop()
    expect(listeners.size).toBe(0)
  })
})
