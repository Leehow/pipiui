// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fileToLogoDataUrl, readCustomLogo, useCustomLogo, writeCustomLogo } from './custom-logo'

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

beforeEach(() => {
  localStorage.clear()
})

describe('custom logo storage', () => {
  it('reads null when nothing is stored', () => {
    expect(readCustomLogo()).toBeNull()
    expect(localStorage.getItem('pipiui.logo')).toBeNull()
  })

  it('writes a data URL and reads it back from localStorage', () => {
    writeCustomLogo(PNG_DATA_URL)
    expect(readCustomLogo()).toBe(PNG_DATA_URL)
    expect(localStorage.getItem('pipiui.logo')).toBe(PNG_DATA_URL)
  })

  it('writeCustomLogo(null) clears storage back to the default wordmark', () => {
    writeCustomLogo(PNG_DATA_URL)
    writeCustomLogo(null)
    expect(readCustomLogo()).toBeNull()
    expect(localStorage.getItem('pipiui.logo')).toBeNull()
  })

  it('dispatches pipiui:logo-changed on write and on clear', () => {
    const events: Event[] = []
    const listener = (event: Event) => events.push(event)
    window.addEventListener('pipiui:logo-changed', listener)
    try {
      writeCustomLogo(PNG_DATA_URL)
      writeCustomLogo(null)
      expect(events).toHaveLength(2)
      expect(events[0].type).toBe('pipiui:logo-changed')
    } finally {
      window.removeEventListener('pipiui:logo-changed', listener)
    }
  })
})

describe('useCustomLogo', () => {
  it('returns null initially and picks up a change event', () => {
    const { result } = renderHook(() => useCustomLogo())
    expect(result.current).toBeNull()

    act(() => {
      writeCustomLogo(PNG_DATA_URL)
    })
    expect(result.current).toBe(PNG_DATA_URL)

    act(() => {
      writeCustomLogo(null)
    })
    expect(result.current).toBeNull()
  })

  it('reads a pre-existing stored logo as its initial value', () => {
    writeCustomLogo(PNG_DATA_URL)
    const { result } = renderHook(() => useCustomLogo())
    expect(result.current).toBe(PNG_DATA_URL)
  })
})

describe('custom logo storage tolerance', () => {
  it('getItem 抛错时 readCustomLogo 返回 null 而不抛出', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    try {
      expect(readCustomLogo()).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })

  it('getItem 抛错时 useCustomLogo 初始化为 null 而非崩溃', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    try {
      const { result } = renderHook(() => useCustomLogo())
      expect(result.current).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })

  it('setItem 抛错时 writeCustomLogo 不抛出、事件仍派发且负载携带新值', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
    const events: Event[] = []
    const listener = (event: Event) => events.push(event)
    window.addEventListener('pipiui:logo-changed', listener)
    try {
      const { result } = renderHook(() => useCustomLogo())
      act(() => {
        expect(() => writeCustomLogo(PNG_DATA_URL)).not.toThrow()
      })
      expect(events).toHaveLength(1)
      // hook 经事件负载拿到新值：不依赖存储重读，内存选择不被冲掉。
      expect(result.current).toBe(PNG_DATA_URL)
    } finally {
      window.removeEventListener('pipiui:logo-changed', listener)
      spy.mockRestore()
    }
  })
})

describe('fileToLogoDataUrl', () => {
  it('rejects non-image files', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    await expect(fileToLogoDataUrl(file)).rejects.toThrow()
  })
})
