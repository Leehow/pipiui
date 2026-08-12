import { app, BaseWindow, BrowserWindow, ipcMain, screen, shell, WebContentsView } from 'electron'
import { join } from 'node:path'
import { createPiHostBackend, installRuntimeTree } from '@pipi/pi-backend'
import {
  PIPI_HOST_IPC_CHANNEL,
  PIPI_HOST_PROTOCOL_VERSION,
  type HostBackend,
  type HostEvent,
  type HostRequest,
  type HostResponse,
  type HostWireFrame
} from '@pipi/host-api'
import { BrowserSessionHost, routeBrowserView, withBrowserTabsHost } from './browser-host.js'
import { installOwnedRuntimeShutdown } from './app-lifecycle.js'
import { CuaDriverHost } from './cua-driver-host.js'
import { resolveRuntimeAssets } from './runtime-assets.js'
import { withOpenExternal } from './external-url.js'
import { createPtyTerminalBackend, TerminalSessionHost } from './terminal-host.js'
export { createPtyTerminalBackend, resolveTerminalCwd, resolveTerminalShell } from './terminal-host.js'

export interface IpcMainLike {
  handle(
    channel: string,
    listener: (
      event: { sender: { send(channel: string, frame: HostWireFrame): void } },
      request: HostRequest
    ) => Promise<HostResponse>
  ): void
}

/** Registers main-process IPC without coupling the reusable contract to Electron runtime types. */
export function registerPipiHostIpc(
  ipc: IpcMainLike,
  backend: HostBackend,
  channel = PIPI_HOST_IPC_CHANNEL
): void {
  const renderers = new Set<{ send(channel: string, frame: HostWireFrame): void }>()
  backend.subscribe((frame) => {
    for (const renderer of renderers) renderer.send(channel, { type: 'event', ...frame })
  })
  ipc.handle(channel, async (event, request) => {
    renderers.add(event.sender)
    if (request.protocolVersion !== PIPI_HOST_PROTOCOL_VERSION || request.type !== 'request') {
      return { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id: request.id ?? '', type: 'response', ok: false, error: 'unsupported protocol' }
    }
    try {
      return { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id: request.id, type: 'response', ok: true, result: await backend.handle(request.method, request.params) }
    } catch (error) {
      return { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id: request.id, type: 'response', ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

function createWindow(browser: BrowserSessionHost, onClosed: () => void): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    // Like VS Code/Notion on macOS: no system title strip, only the traffic
    // lights remain. The renderer reserves a draggable strip via
    // env(titlebar-area-*). Keep the default framed titlebar elsewhere.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Tool-only browsing needs a real native host to retain a Chromium surface.
  // Reparent the same physical view into the main window when Browser opens.
  const hiddenBrowserHost = new BaseWindow({
    show: false,
    x: -10000,
    y: -10000,
    width: 1280,
    height: 800,
    frame: false,
    focusable: false,
    hasShadow: false,
    opacity: 0,
    skipTaskbar: true
  })
  browser.attachToWindow((rawView, visible) => {
    routeBrowserView(rawView, visible, window as any, hiddenBrowserHost as any)
  })
  window.on('closed', () => {
    onClosed()
    browser.detachWindow()
    hiddenBrowserHost.destroy()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Electron's package exports no runtime app object under Vitest; keep IPC registration importable.
if (app) {
  app.whenReady().then(() => {
    // One BrowserTabsHost owns exactly one WebContentsView at a time. Its
    // `partition` constructor slot is reserved for future BrowserContext Spaces.
    const browser = new BrowserSessionHost(options => new WebContentsView(options))
    const primary = screen.getPrimaryDisplay()
    const display = { displayID: primary.id, width: primary.size.width, height: primary.size.height }
    const assets = resolveRuntimeAssets({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      dirname: __dirname,
      env: process.env
    })
    const computer = new CuaDriverHost(assets.cuaDriver, display)
    // Installed runtime state belongs to this Electron profile on every platform. Pi sessions,
    // auth and leases intentionally remain interoperable under ~/.pi/agent.
    const runtimeRoot = process.env.PIPIUI_RUNTIME_ROOT ?? join(app.getPath('userData'), 'runtime')
    const install = installRuntimeTree(assets, runtimeRoot)
    if (install.installed.length)
      console.info(`[pipi-install] refreshed ${install.installed.length} runtime asset(s) under ${runtimeRoot}`)
    for (const failure of install.failures) console.warn(`[pipi-install] ${failure}`)
    const terminalHost = new TerminalSessionHost()
    const piBackend = createPiHostBackend({
      piCommand: assets.piCommand,
      managedNodeModulesRoot: assets.managedNodeModulesRoot,
      browserAction: (request, sessionId) => browser.toolAction(sessionId, request as any),
      terminalAction: (request, sessionId) => terminalHost.toolAction(sessionId, request as any),
      terminalSessionDeleted: sessionId => terminalHost.disposeSession(sessionId),
      computerAction: request => computer.handle(request),
      computerDescriptor: display,
      computerUsable: () => computer.usable(),
      authHelperPath: assets.sourceRoot ? join(assets.sourceRoot, 'auth', 'pi-auth-helper.mjs') : undefined,
      runtimeRoot,
      // Refreshed again before every spawn, so editing a philosophy layer or a subagent file
      // reaches the next session without relaunching the app.
      runtimeAssets: assets
    })
    const terminalBackend = terminalHost.wrapBackend(piBackend)
    registerPipiHostIpc(ipcMain, withOpenExternal(withBrowserTabsHost(terminalBackend, browser), url => shell.openExternal(url)))
    createWindow(browser, () => terminalHost.closeAll())
    installOwnedRuntimeShutdown(app, terminalHost, computer, piBackend)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(browser, () => terminalHost.closeAll())
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
