import { app, BaseWindow, desktopCapturer, dialog, ipcMain, screen, shell, systemPreferences, WebContentsView, type OpenDialogOptions } from 'electron'
import { join } from 'node:path'
import { appendFileSync, writeFileSync } from 'node:fs'
import { createCanonicalModelsWriteQueue, createPiHostBackend, installRuntimeTree, QuotaStore } from '@pipi/pi-backend'
import {
  PIPI_HOST_IPC_CHANNEL,
  PIPI_HOST_PROTOCOL_VERSION,
  type HostBackend,
  type HostEvent,
  type HostRequest,
  type HostResponse,
  type HostWireFrame
} from '@pipi/host-api'
import { BrowserSessionHost, installBrowserNativeTrace, mountBrowserShellView, routeBrowserView, withBrowserTabsHost } from './browser-host.js'
import { installOwnedRuntimeShutdown } from './app-lifecycle.js'
import { CUA_DRIVER_VERSION, CuaDriverHost } from './cua-driver-host.js'
import { installBundledModelCapabilityOverrides, resolveElectronPiProfile, resolveStableElectronUserDataPath } from './pi-profile.js'
import { withProjectDirectoryPicker } from './project-directory-picker.js'
import { createQuotaCookieReader, createQuotaCookiePersister, readCursorAccessToken } from './quota-capabilities.js'
import { EMBEDDED_NODE_VERSION, resolveRuntimeAssets, UPDATE_CENTER_RUNTIME_PACKAGE_VERSIONS } from './runtime-assets.js'
import { createUpdateCenterService, UPDATE_CENTER_FRAMEWORK_VERSIONS, withUpdateCenter, type UpdateCatalogItem } from './update-center.js'
import { withOpenDocumentExternally } from './external-document.js'
import { withOpenExternal } from './external-url.js'
import { createElectronComputerUsePermissionHost, withComputerUsePermissions } from './computer-use-permissions.js'
import { createPtyTerminalBackend, TerminalSessionHost } from './terminal-host.js'
import { createRemoteControlService, registerRemoteControlIpc } from './remote-control.js'
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
  const window = new BaseWindow({
    width: 1280,
    height: 800,
    title: 'PipiUI',
    // Like VS Code/Notion on macOS: no system title strip, only the traffic
    // lights remain. The renderer reserves a draggable strip via
    // env(titlebar-area-*). Keep the default framed titlebar elsewhere.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default'
  })
  const shellView = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const unmountShellView = mountBrowserShellView(window as any, shellView as any)
  browser.attachToWindow((rawView, visible) => {
    routeBrowserView(rawView, visible, window as any)
  })
  window.on('closed', () => {
    onClosed()
    browser.detachWindow()
    unmountShellView()
    if (!shellView.webContents.isDestroyed()) shellView.webContents.close()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void shellView.webContents.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void shellView.webContents.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Electron's package exports no runtime app object under Vitest; keep IPC registration importable.
if (app) {
  // productName stays "PipiUI Electron" so the artifact folder does not collide
  // with the frozen Swift app. Override the process name so Dock / About / menus
  // show PipiUI. setName also changes the default userData folder, so pin it
  // back to the historical Electron profile immediately.
  app.setName('PipiUI')
  app.setPath('userData', resolveStableElectronUserDataPath(app.getPath('appData')))
  app.whenReady().then(async () => {
    const browserDebugPath = process.env.PIPIUI_BROWSER_NATIVE_DEBUG
    let browserDebugCaptureSequence = 0
    if (browserDebugPath) {
      writeFileSync(browserDebugPath, '')
      installBrowserNativeTrace(entry => appendFileSync(browserDebugPath, `${JSON.stringify(entry)}\n`))
    }
    // One BrowserTabsHost owns exactly one WebContentsView at a time. Its
    // `partition` constructor slot is reserved for future BrowserContext Spaces.
    const browser = new BrowserSessionHost(options => {
      const view = new WebContentsView(options)
      if (browserDebugPath) view.setBackgroundColor('#ff00ff')
      if (browserDebugPath) {
        view.webContents.on('did-stop-loading', () => {
          void view.webContents.capturePage(undefined, { stayHidden: true }).then(image => {
            writeFileSync(`${browserDebugPath}.capture-${++browserDebugCaptureSequence}.png`, image.toPNG())
          }).catch(error => appendFileSync(browserDebugPath, `${JSON.stringify({ timestamp: Date.now(), stage: 'capture:error', error: String(error) })}\n`))
        })
      }
      // The default UA advertises "PipiUI Electron/… Electron/…" tokens; some sites
      // (e.g. DuckDuckGo's HTML search endpoint) answer such framework UAs with
      // bot-challenge pages instead of content. Keep the standard Chrome tokens only.
      view.webContents.session.setUserAgent(
        view.webContents.getUserAgent().replace(/\s*[\w ]*Electron\/[\d.]+/g, '')
      )
      return view
    })
    const primary = screen.getPrimaryDisplay()
    const display = { displayID: primary.id, width: primary.size.width, height: primary.size.height }
    const userData = app.getPath('userData')
    const assets = resolveRuntimeAssets({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      dirname: __dirname,
      env: process.env,
      userData
    })
    const computer = new CuaDriverHost(assets.cuaDriver, display)
    // Host chrome (queues, pipiui-settings, model catalog) stays under this Electron
    // profile. Coding Pi homes are per opened project: `{project}/.pi/agent`. Never
    // import or share `~/.pi/agent`.
    const runtimeRoot = process.env.PIPIUI_RUNTIME_ROOT ?? join(userData, 'runtime')
    const piProfile = resolveElectronPiProfile(userData)
    // Bundled model-capability overrides and the runtime-tree install do not gate
    // the window or the backend's IPC wiring, so they run in the background in
    // parallel with window load instead of blocking createWindow.
    // Data-ordering: one App-owned models write queue runs capability first
    // (optional; failure degrades to the existing canonical file), then the
    // backend's deterministic project migration, then refreshModelCatalog.
    // installRuntimeTree is independently re-run per spawn (refreshRuntimeTree).
    const modelsWriteQueue = createCanonicalModelsWriteQueue()
    const profileInstall = modelsWriteQueue.enqueue(async () => {
      try {
        if (!assets.sourceRoot) throw new Error('PipiUI runtime source is unavailable for model capability initialization')
        await installBundledModelCapabilityOverrides(
          piProfile,
          join(assets.sourceRoot, 'model-capabilities', 'models-dev-reasoning-options.json')
        )
      } catch (error) {
        console.error('[pipi-install] profile/capability install failed:', error)
      }
    })
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
    const quotaStore = new QuotaStore(process.env, { agentDir: piProfile.agentDir, readCookie: createQuotaCookieReader(userData), persistCookie: createQuotaCookiePersister(userData), readCursorAuth: readCursorAccessToken })
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
      canonicalModelsWrite: modelsWriteQueue,
      profileInitialization: profileInstall,
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
      const owner = BaseWindow.getFocusedWindow() ?? BaseWindow.getAllWindows()[0]
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : result.filePaths[0] ?? null
    }
    const updateCatalog: UpdateCatalogItem[] = [
      { id: 'electron', name: 'Electron', category: 'platform', currentVersion: process.versions.electron ?? UPDATE_CENTER_FRAMEWORK_VERSIONS.electron, source: { type: 'npm', packageName: 'electron' } },
      { id: 'node', name: 'Node.js 内置 Pi 运行时', category: 'runtime', currentVersion: EMBEDDED_NODE_VERSION, source: { type: 'nodeDist' } },
      ...Object.entries(UPDATE_CENTER_RUNTIME_PACKAGE_VERSIONS).map(([packageName, currentVersion]) => ({
        id: packageName,
        name: packageName === '@earendil-works/pi-coding-agent' ? 'Pi' : packageName,
        category: packageName === '@earendil-works/pi-coding-agent' ? 'runtime' as const : 'extension' as const,
        currentVersion,
        source: { type: 'npm' as const, packageName }
      })),
      { id: 'cua-driver', name: 'Cua Driver', category: 'runtime', currentVersion: CUA_DRIVER_VERSION, source: { type: 'cuaGitHub' } },
      { id: 'vite', name: 'Vite', category: 'toolchain', currentVersion: UPDATE_CENTER_FRAMEWORK_VERSIONS.vite, source: { type: 'npm', packageName: 'vite' } },
      { id: 'electron-vite', name: 'electron-vite', category: 'toolchain', currentVersion: UPDATE_CENTER_FRAMEWORK_VERSIONS['electron-vite'], source: { type: 'npm', packageName: 'electron-vite' } }
    ]
    const backend = withUpdateCenter(withComputerUsePermissions(withProjectDirectoryPicker(withOpenDocumentExternally(withOpenExternal(withBrowserTabsHost(terminalBackend, browser), url => shell.openExternal(url)), path => shell.openPath(path)), pickProjectDirectory), createElectronComputerUsePermissionHost({
      getMediaAccessStatus: media => systemPreferences.getMediaAccessStatus(media),
      isTrustedAccessibilityClient: prompt => systemPreferences.isTrustedAccessibilityClient(prompt),
      requestScreenRecording: async () => {
        await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
      },
      openURL: url => shell.openExternal(url),
    })), createUpdateCenterService({ catalog: updateCatalog }))
    registerPipiHostIpc(ipcMain, backend)
    const remoteControl = createRemoteControlService({
      backend,
      userDataDir: userData,
      relayOrigin: process.env.PIPIUI_RELAY_ORIGIN || 'https://remote.deepwood.cn'
    })
    registerRemoteControlIpc(ipcMain, remoteControl)
    void remoteControl.restore()
    createWindow(browser, () => terminalHost.closeAll())
    // Capability is the first models-write job. Isolated backend init then migrates
    // project catalogs and refreshes the model catalog; do not refresh here or the
    // UI can observe pre-migration canonical state.
    installOwnedRuntimeShutdown(app, terminalHost, computer, piBackend)
    app.on('activate', () => {
      if (BaseWindow.getAllWindows().length === 0) createWindow(browser, () => terminalHost.closeAll())
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
