import { describe, expect, it, vi } from 'vitest'
import type { BrowserViewLike } from './browser-host.js'
import { BrowserMobileWindowController, type BrowserMobileWindowLike } from './browser-mobile-window.js'

class FakeMobileWindow implements BrowserMobileWindowLike {
  readonly contentView = {
    addChildView: vi.fn<(view: BrowserViewLike) => void>(),
    removeChildView: vi.fn<(view: BrowserViewLike) => void>()
  }
  readonly listeners = new Map<string, Array<(...args: any[]) => void>>()
  bounds = { width: 393, height: 720 }
  visible = false
  destroyed = false
  show = vi.fn(() => { this.visible = true })
  hide = vi.fn(() => { this.visible = false })
  focus = vi.fn()
  destroy = vi.fn(() => { this.destroyed = true; this.emit('closed') })
  isDestroyed = vi.fn(() => this.destroyed)
  isVisible = vi.fn(() => this.visible)
  setTitle = vi.fn()
  getContentBounds = vi.fn(() => ({ x: 0, y: 0, ...this.bounds }))
  on(event: string, listener: (...args: any[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }
  off(event: string, listener: (...args: any[]) => void) {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter(item => item !== listener))
  }
  emit(event: string, ...args: any[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

function fakeView(): BrowserViewLike & {
  setBounds: ReturnType<typeof vi.fn>
  setVisible: ReturnType<typeof vi.fn>
} {
  return {
    webContents: {
      loadURL: vi.fn(),
      on: vi.fn()
    },
    setBounds: vi.fn(),
    setVisible: vi.fn()
  }
}

const iphone = { deviceId: 'iphone-14-pro', label: 'iPhone 14 Pro', width: 393, height: 852 }

describe('BrowserMobileWindowController', () => {
  it('creates and reuses one framed child window around the real mobile page', () => {
    const windows: FakeMobileWindow[] = []
    const view = fakeView()
    const createWindow = vi.fn(() => {
      const window = new FakeMobileWindow()
      windows.push(window)
      return window
    })
    const controller = new BrowserMobileWindowController({} as any, createWindow, vi.fn(), vi.fn())

    expect(controller.present('session-a', view, true, iphone)).toEqual({ x: 0, y: 0, width: 393, height: 720 })
    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({ parent: expect.anything(), frame: true, title: '手机预览 — iPhone 14 Pro' }))
    expect(windows[0].contentView.addChildView).toHaveBeenCalledWith(view)
    expect(view.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 393, height: 720 })
    expect(view.setVisible).toHaveBeenLastCalledWith(true)

    controller.present('session-a', view, false, iphone)
    expect(windows[0].hide).toHaveBeenCalledTimes(1)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    controller.present('session-a', view, true, iphone)
    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(windows[0].show).toHaveBeenCalledTimes(2)
  })

  it('turns native close into a reusable hide and keeps the mobile page attached', () => {
    const window = new FakeMobileWindow()
    const view = fakeView()
    const onClosed = vi.fn()
    const controller = new BrowserMobileWindowController({} as any, () => window, vi.fn(), onClosed)
    controller.present('session-a', view, true, iphone)
    const preventDefault = vi.fn()

    window.emit('close', { preventDefault })

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(window.hide).toHaveBeenCalledTimes(1)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    expect(window.contentView.removeChildView).not.toHaveBeenCalled()
    expect(onClosed).toHaveBeenCalledWith('session-a')
    expect(window.destroy).not.toHaveBeenCalled()
  })

  it('lays out only the mobile view on resize and destroys every child window on shutdown', () => {
    const windows: FakeMobileWindow[] = []
    const views = [fakeView(), fakeView()]
    const onResize = vi.fn()
    const controller = new BrowserMobileWindowController({} as any, () => {
      const window = new FakeMobileWindow()
      windows.push(window)
      return window
    }, onResize, vi.fn())
    controller.present('session-a', views[0], true, iphone)
    controller.present('session-b', views[1], true, { deviceId: 'pixel-7', label: 'Pixel 7', width: 412, height: 915 })
    windows[0].bounds = { width: 420, height: 680 }
    windows[0].emit('resize')
    expect(views[0].setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 420, height: 680 })
    expect(onResize).toHaveBeenCalledWith('session-a', { width: 420, height: 680 })

    controller.dispose()
    expect(windows.every(window => window.destroy.mock.calls.length === 1)).toBe(true)
    expect(windows[0].contentView.removeChildView).toHaveBeenCalledWith(views[0])
    expect(windows[1].contentView.removeChildView).toHaveBeenCalledWith(views[1])
    expect(views.every(view => view.setVisible.mock.lastCall?.[0] === false)).toBe(true)
  })
})
