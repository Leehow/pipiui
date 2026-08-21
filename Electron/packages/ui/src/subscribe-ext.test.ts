// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { subscribeExt, useSubscribeExt, type ExtEvent } from './subscribe-ext'

function fakeHost() {
  const listeners = new Map<string, Set<(event: ExtEvent) => void>>()
  return {
    subscribeExt: (extensionId: string, listener: (event: ExtEvent) => void) => {
      let set = listeners.get(extensionId)
      if (!set) {
        set = new Set()
        listeners.set(extensionId, set)
      }
      set.add(listener)
      return () => { set!.delete(listener) }
    },
    emit(extensionId: string, event: ExtEvent) {
      for (const listener of listeners.get(extensionId) ?? []) listener(event)
    },
    listenerCount(extensionId: string) {
      return listeners.get(extensionId)?.size ?? 0
    },
  }
}

describe('subscribeExt', () => {
  it('delivers events and unsubscribes on dispose', () => {
    const host = fakeHost()
    const listener = vi.fn()
    const dispose = subscribeExt(host, 'quota', listener)

    host.emit('quota', { type: 'warning', payload: { used: 92 } })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ type: 'warning', payload: { used: 92 } })
    expect(host.listenerCount('quota')).toBe(1)

    dispose()
    expect(host.listenerCount('quota')).toBe(0)
    host.emit('quota', { type: 'warning', payload: { used: 99 } })
    expect(listener).toHaveBeenCalledTimes(1)

    dispose()
    expect(host.listenerCount('quota')).toBe(0)
  })

  it('is a no-op when the host omits subscribeExt', () => {
    const dispose = subscribeExt({}, 'quota', vi.fn())
    expect(() => dispose()).not.toThrow()
  })
})

describe('useSubscribeExt', () => {
  it('unsubscribes when the hook unmounts', () => {
    const host = fakeHost()
    const listener = vi.fn()
    const { unmount } = renderHook(() => useSubscribeExt(host, 'quota', listener))
    host.emit('quota', { type: 'ready' })
    expect(listener).toHaveBeenCalledTimes(1)
    unmount()
    expect(host.listenerCount('quota')).toBe(0)
    host.emit('quota', { type: 'ready' })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
