import { randomUUID } from 'node:crypto'
import type { BrowserWebContentsLike } from './types.js'

/** A run owns one existing WebContents. It never discovers targets or opens a port. */
export class JevBrowserAdapter {
  readonly lease = randomUUID()
  private attachedHere = false
  constructor(private contents: BrowserWebContentsLike, private current: () => boolean) {}

  async command(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.current() || this.contents.isDestroyed?.()) throw new Error('jev-page-replaced')
    if (!['Runtime.evaluate', 'Input.dispatchMouseEvent', 'Input.dispatchKeyEvent', 'Input.insertText'].includes(method)) {
      throw new Error('jev-command-denied')
    }
    const debug = this.contents.debugger
    if (!debug) throw new Error('jev-debugger-unavailable')
    let initializeFocus = false
    if (!debug.isAttached()) {
      debug.attach('1.3'); this.attachedHere = true
      initializeFocus = true
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const response = await Promise.race([
        (async () => {
          if (initializeFocus) await debug.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
          if (!this.current()) throw new Error('jev-page-replaced')
          return debug.sendCommand(method, params)
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('jev-browser-timeout')), 5000) }),
      ])
      if (!this.current()) throw new Error('jev-page-replaced')
      if (JSON.stringify(response).length > 2_000_000) throw new Error('jev-observation-budget')
      return response
    } catch (error) {
      if (method === 'Runtime.evaluate' && error instanceof Error && /context.*destroyed|cannot find context|inspected target navigated/i.test(error.message)) {
        return { exceptionDetails: { text: 'document-changed' } }
      }
      throw error
    } finally { if (timer) clearTimeout(timer) }
  }

  async sanitize(value: unknown): Promise<unknown> {
    if (!this.current()) throw new Error('jev-page-replaced')
    const observed: any = await this.command('Runtime.evaluate', { returnByValue: true,
      expression: `Array.from(document.querySelectorAll('input,textarea')).filter(e=>e.type==='password'||/password|passwd|secret|token|api.?key|one.?time|credit.?card|card.?number|security.?code/i.test([e.name,e.id,e.autocomplete,e.getAttribute('aria-label')].join(' '))).map(e=>e.value).filter(Boolean)` })
    if (observed?.exceptionDetails || !Array.isArray(observed?.result?.value)) throw new Error('jev-redaction-unavailable')
    const values = observed.result.value
    let json = JSON.stringify(value)
    for (const secret of Array.isArray(values) ? values : []) {
      if (typeof secret === 'string' && secret) json = json.split(JSON.stringify(secret).slice(1, -1)).join('[redacted]')
    }
    return JSON.parse(json)
  }

  close(): void {
    if (this.attachedHere && !this.contents.isDestroyed?.() && this.contents.debugger?.isAttached()) this.contents.debugger.detach()
    this.attachedHere = false
  }
}
