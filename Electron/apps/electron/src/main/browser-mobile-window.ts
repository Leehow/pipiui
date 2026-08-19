import type { BrowserViewLike } from './browser-host.js'

export type BrowserMobileWindowOptions = {
  parent: unknown
  width: number
  height: number
  minWidth: number
  minHeight: number
  useContentSize: boolean
  frame: boolean
  resizable: boolean
  show: boolean
  title: string
}

export interface BrowserMobileWindowLike {
  contentView: {
    addChildView(view: BrowserViewLike): void
    removeChildView(view: BrowserViewLike): void
  }
  getContentBounds(): { x?: number; y?: number; width: number; height: number }
  on(event: string, listener: (...args: any[]) => void): unknown
  off(event: string, listener: (...args: any[]) => void): unknown
  show(): void
  hide(): void
  focus(): void
  destroy(): void
  isDestroyed(): boolean
  isVisible(): boolean
  setTitle(title: string): void
}

export type BrowserMobileWindowDevice = {
  deviceId: string
  label: string
  width: number
  height: number
}

type Record = {
  window: BrowserMobileWindowLike
  view: BrowserViewLike
  closing: boolean
  layout: () => void
  close: (event: { preventDefault?(): void }) => void
  closed: () => void
}

/**
 * Owns one framed child BaseWindow per browser session. Hiding a preview keeps
 * its real mobile WebContentsView attached but invisible so Chromium retains a
 * render widget for hidden mobile-target screenshots and agent operations.
 */
export class BrowserMobileWindowController {
  private readonly records = new Map<string, Record>()

  constructor(
    private readonly parent: unknown,
    private readonly createWindow: (options: BrowserMobileWindowOptions) => BrowserMobileWindowLike,
    private readonly onResize: (sessionId: string, size: { width: number; height: number }) => void,
    private readonly onUserClosed: (sessionId: string) => void
  ) {}

  present(
    sessionId: string,
    view: BrowserViewLike,
    placement: boolean | 'detach' | 'raise',
    device: BrowserMobileWindowDevice
  ): { x: number; y: number; width: number; height: number } | undefined {
    if (placement === 'detach') {
      this.destroyRecord(sessionId, view)
      return undefined
    }

    let record = this.records.get(sessionId)
    if (record?.window.isDestroyed()) {
      this.records.delete(sessionId)
      record = undefined
    }
    if (record && record.view !== view) {
      this.destroyRecord(sessionId)
      record = undefined
    }
    if (!record) record = this.createRecord(sessionId, view, device)

    record.window.setTitle(`手机预览 — ${device.label}`)
    record.layout()
    if (placement === false) {
      view.setVisible?.(false)
      record.window.hide()
    } else {
      record.window.show()
      view.setVisible?.(true)
      if (placement === 'raise') record.window.focus()
    }
    return this.contentBounds(record.window)
  }

  dispose(): void {
    for (const sessionId of [...this.records.keys()]) this.destroyRecord(sessionId)
  }

  private contentBounds(window: BrowserMobileWindowLike): { x: number; y: number; width: number; height: number } {
    const bounds = window.getContentBounds()
    return { x: 0, y: 0, width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) }
  }

  private createRecord(sessionId: string, view: BrowserViewLike, device: BrowserMobileWindowDevice): Record {
    const window = this.createWindow({
      parent: this.parent,
      width: Math.max(320, Math.min(520, Math.round(device.width))),
      height: Math.max(420, Math.min(760, Math.round(device.height))),
      minWidth: 280,
      minHeight: 360,
      useContentSize: true,
      frame: true,
      resizable: true,
      show: false,
      title: `手机预览 — ${device.label}`
    })
    const layout = () => {
      if (window.isDestroyed()) return
      const bounds = this.contentBounds(window)
      view.setBounds(bounds)
      this.onResize(sessionId, { width: bounds.width, height: bounds.height })
    }
    const close = (event: { preventDefault?(): void }) => {
      const current = this.records.get(sessionId)
      if (!current || current.closing) return
      event.preventDefault?.()
      view.setVisible?.(false)
      window.hide()
      this.onUserClosed(sessionId)
    }
    const closed = () => {
      const current = this.records.get(sessionId)
      if (current?.window === window) this.records.delete(sessionId)
    }
    const record: Record = { window, view, closing: false, layout, close, closed }
    this.records.set(sessionId, record)
    window.contentView.addChildView(view)
    window.on('resize', layout)
    window.on('close', close)
    window.on('closed', closed)
    return record
  }

  private destroyRecord(sessionId: string, expectedView?: BrowserViewLike): void {
    const record = this.records.get(sessionId)
    if (!record || (expectedView && record.view !== expectedView)) return
    this.records.delete(sessionId)
    record.closing = true
    record.window.off('resize', record.layout)
    record.window.off('close', record.close)
    record.window.off('closed', record.closed)
    record.view.setVisible?.(false)
    try { record.window.contentView.removeChildView(record.view) } catch { /* already detached */ }
    if (!record.window.isDestroyed()) record.window.destroy()
  }
}
