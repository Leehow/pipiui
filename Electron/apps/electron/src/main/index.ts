import { app, BaseWindow, BrowserWindow, desktopCapturer, dialog, ipcMain, screen, shell, systemPreferences, WebContentsView, type OpenDialogOptions } from 'electron'
import { join } from 'node:path'
import { createPiHostBackend, installRuntimeTree, QuotaStore } from '@pipi/pi-backend'
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
import { importLegacyPiProfile, installBundledModelCapabilityOverrides, resolveElectronPiProfile } from './pi-profile.js'
import { withProjectDirectoryPicker } from './project-directory-picker.js'
import { createQuotaCookieReader, createQuotaCookiePersister } from './quota-capabilities.js'
import { resolveRuntimeAssets } from './runtime-assets.js'
import { withOpenDocumentExternally } from './external-document.js'
import { withOpenExternal } from './external-url.js'
import { createElectronComputerUsePermissionHost, withComputerUsePermissions } from './computer-use-permissions.js'
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
    if (process.env.PIPIUI_STREAM_DEBUG) console.log(`[stream-debug] ipc-send ch=${(frame as { channel?: string }).channel} t=${Date.now()}`)
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
      const errorCode = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : undefined
      return { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id: request.id, type: 'response', ok: false, error: error instanceof Error ? error.message : String(error), ...(errorCode ? { errorCode } : {}) }
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
  app.whenReady().then(async () => {
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
    // Runtime and mutable Pi state both belong to this Electron profile. A bounded one-time copy
    // preserves continuity from releases that shared ~/.pi/agent, without continuing to couple
    // either installation after migration.
    const userData = app.getPath('userData')
    const runtimeRoot = process.env.PIPIUI_RUNTIME_ROOT ?? join(userData, 'runtime')
    const piProfile = resolveElectronPiProfile(userData)
    // Profile migration, bundled model-capability overrides, and the runtime-tree
    // install do not gate the window or the backend's IPC wiring, so they run in
    // the background in parallel with window load instead of blocking createWindow.
    // Data-ordering is preserved two ways: (a) installRuntimeTree is re-run per
    // session/model spawn (refreshRuntimeTree), so it never needs to finish before
    // the first list-models; (b) once the profile/capability install lands, the
    // backend's model catalog is invalidated and reloaded via refreshModelCatalog so
    // the UI's next listModels sees the bundled capability overrides.
    const profileInstall = (async () => {
      await importLegacyPiProfile(piProfile)
      if (!assets.sourceRoot) throw new Error('PipiUI runtime source is unavailable for model capability initialization')
      await installBundledModelCapabilityOverrides(
        piProfile,
        join(assets.sourceRoot, 'model-capabilities', 'models-dev-reasoning-options.json')
      )
    })()
    // Runtime tree install overlaps with window load and the first list-models load.
    // It is a warm-up only: refreshRuntimeTree re-runs it before every spawn.
    void Promise.resolve().then(() => {
      const reinstall = installRuntimeTree(assets, runtimeRoot)
      if (reinstall.installed.length)
        console.info(`[pipi-install] refreshed ${reinstall.installed.length} runtime asset(s) under ${runtimeRoot}`)
      for (const failure of reinstall.failures) console.warn(`[pipi-install] ${failure}`)
    })
    const terminalHost = new TerminalSessionHost()
    // Browser-cookie quota providers (Qwen Token Plan) read their session cookies
    // from the built-in browser partitions; everything else keeps file defaults.
    const quotaStore = new QuotaStore(process.env, { agentDir: piProfile.agentDir, readCookie: createQuotaCookieReader(userData), persistCookie: createQuotaCookiePersister(userData) })
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
      agentDir: piProfile.agentDir,
      sessionsRoot: piProfile.sessionsRoot,
      profileMode: 'isolated',
      resourceMode: 'explicit',
      quotaStore,
      // Refreshed again before every spawn, so editing a philosophy layer or a subagent file
      // reaches the next session without relaunching the app.
      runtimeAssets: assets,
      revealPath: async (path) => {
        const error = await shell.openPath(path)
        if (error.trim()) throw new Error(error)
      }
    })
    const terminalBackend = terminalHost.wrapBackend(piBackend)
    const pickProjectDirectory = async (): Promise<string | null> => {
      const options: OpenDialogOptions = { title: '选择项目文件夹', buttonLabel: '选择', properties: ['openDirectory', 'createDirectory'] }
      const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : result.filePaths[0] ?? null
    }
    const backend = withComputerUsePermissions(withProjectDirectoryPicker(withOpenDocumentExternally(withOpenExternal(withBrowserTabsHost(terminalBackend, browser), url => shell.openExternal(url)), path => shell.openPath(path)), pickProjectDirectory), createElectronComputerUsePermissionHost({
      getMediaAccessStatus: media => systemPreferences.getMediaAccessStatus(media),
      isTrustedAccessibilityClient: prompt => systemPreferences.isTrustedAccessibilityClient(prompt),
      requestScreenRecording: async () => {
        await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
      },
      openURL: url => shell.openExternal(url),
    }))
    registerPipiHostIpc(ipcMain, backend)
    createWindow(browser, () => terminalHost.closeAll())
    // Once the background profile/capability install lands, invalidate + reload the
    // backend model catalog so the UI's next listModels reflects the bundled
    // capability overrides even if the constructor's preload ran on empty models.json.
    profileInstall.then(
      () => {
        try { void piBackend.refreshModelCatalog() }
        catch (error) { console.warn(`[pipi-install] model catalog refresh failed: ${error}`) }
      },
      (error) => console.error('[pipi-install] profile/capability install failed:', error)
    )
    installOwnedRuntimeShutdown(app, terminalHost, computer, piBackend)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(browser, () => terminalHost.closeAll())
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
