/** Adds the Electron-only browser extension without changing the Pi backend. */
import {
  PIPI_HOST_PROTOCOL_VERSION,
  type BrowserEvent,
  type BrowserTabOptions,
  type BrowserViewBounds,
  type HostBackend,
  type HostEvent,
  type HostMethod,
  type Unsubscribe
} from '@pipi/host-api'
import type { BrowserSessionHost } from './session-host.js'

export function withBrowserTabsHost(backend: HostBackend, browser: BrowserSessionHost): HostBackend {
  const listeners = new Set<(event: HostEvent) => void>()
  browser.subscribe(event => {
    // Surface events (console/dialog/watch) ride the same wire envelope as
    // the root browser channel; the root union just doesn't name them yet.
    const frame: HostEvent = { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, channel: 'browser', event: event as BrowserEvent }
    listeners.forEach(listener => listener(frame))
  })

  return {
    async handle(method: HostMethod, params: unknown[]): Promise<unknown> {
      switch (method) {
        case 'browserSelectSession': return browser.selectSession(params[0] as string)
        case 'browserListTabs': return browser.listTabs(params[0] as string)
        case 'browserGetActiveTab': return browser.getActiveTab(params[0] as string)
        case 'browserNewTab': return browser.newTab(params[0] as string, params[1] as BrowserTabOptions | undefined)
        case 'browserSwitchTab': return browser.switchTab(params[0] as string, params[1] as string)
        case 'browserCloseTab': return browser.closeTab(params[0] as string, params[1] as string)
        case 'browserLoadURL': return browser.loadURL(params[0] as string, params[1] as string, params[2] as string | undefined)
        case 'browserGoBack': return browser.goBack(params[0] as string, params[1] as string | undefined)
        case 'browserGoForward': return browser.goForward(params[0] as string, params[1] as string | undefined)
        case 'browserReload': return browser.reload(params[0] as string, params[1] as string | undefined)
        case 'browserSnapshot': return browser.snapshot(params[0] as string, params[1] as string | undefined)
        case 'browserSetViewBounds': return browser.setViewBounds(params[0] as string, params[1] as BrowserViewBounds)
        case 'browserSetZoomFactor': return browser.setZoomFactor(params[0] as string, params[1] as number, params[2] as string | undefined)
        case 'deleteSession': {
          const result = await backend.handle(method, params)
          await browser.disposeSession(params[0] as string)
          return result
        }
        case 'capabilities': {
          const current = await backend.handle(method, params)
          return { ...(current && typeof current === 'object' ? current as Record<string, unknown> : {}), browser: true }
        }
        default:
          return backend.handle(method, params)
      }
    },
    subscribe(listener: (event: HostEvent) => void): Unsubscribe {
      listeners.add(listener)
      const unsubscribe = backend.subscribe(listener)
      return () => {
        listeners.delete(listener)
        unsubscribe()
      }
    }
  }
}
