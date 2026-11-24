import { app, BaseWindow, desktopCapturer, dialog, ipcMain, nativeImage, net, powerMonitor, powerSaveBlocker, screen, shell, systemPreferences, WebContentsView, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { createOfficialUpdates, OFFICIAL_DOWNLOADS } from './official-updates.js'
import { basename, join } from 'node:path'
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { BrowserWatchCallbackRegistry, createCanonicalModelsWriteQueue, createPiHostBackend, handleBrowserWatchEvent, installRuntimeTree, projectPiAgentDir, readProjectExtensionGrants, QuotaStore, FREEZE_PROBE_FILE, FREEZE_PROBE_PREFIX, HEADROOM_ENGINE_VERSION } from '@pipi/pi-backend'

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
import { BrowserMobileWindowController } from './browser-mobile-window.js'
import { installOwnedRuntimeShutdown } from './app-lifecycle.js'
import { resolveSystemProxyEnvironment } from './system-proxy.js'
import { CUA_DRIVER_VERSION, CuaDriverHost } from './cua-driver-host.js'
import type { ComputerImagePipeline } from './computer-image-pipeline.js'
import { hasExplicitUserDataDirSwitch, installBundledModelCapabilityOverrides, resolveElectronPiProfile, resolveStableElectronUserDataPath } from './pi-profile.js'
import { withProjectDirectoryPicker } from './project-directory-picker.js'
import { withProductPackFileDialogs } from './product-pack-file-dialogs.js'
import { createQuotaCookieReader, createQuotaCookiePersister, readCursorAccessToken } from './quota-capabilities.js'
import { EMBEDDED_NODE_VERSION, resolveRuntimeAssets, UPDATE_CENTER_RUNTIME_PACKAGE_VERSIONS } from './runtime-assets.js'
import { createUpdateCenterService, extensionUpdateCatalogItems, UPDATE_CENTER_FRAMEWORK_VERSIONS, withUpdateCenter, type UpdateCatalogItem } from './update-center.js'
import { withOpenDocumentExternally } from './external-document.js'
import { withOpenExternal } from './external-url.js'
import { createElectronComputerUsePermissionHost, withComputerUsePermissions } from './computer-use-permissions.js'
import { createPtyTerminalBackend, TerminalSessionHost } from './terminal-host.js'
import { createElectronHostCapabilityBroker } from './host-capability-host.js'
import {
  bindRemoteControlPowerLifecycle,
  bindRemoteControlSleepPrevention,
  createRemoteControlService,
  PIPI_REMOTE_CONTROL_EVENT_CHANNEL,
  PIPI_REMOTE_CONTROL_IPC_CHANNEL,
  registerRemoteControlIpc
} from './remote-control.js'
import { createRemoteDebugService, resolveRemoteDebugStaticDir } from './remote-debug.js'
import { normalizeEventProjectionSession, shouldForwardRendererEvent } from './renderer-event-projection.js'
export { createPtyTerminalBackend, resolveTerminalCwd, resolveTerminalShell } from './terminal-host.js'

export interface IpcMainLike {
  handle(
    channel: string,
    listener: (
      event: { sender: RendererSender },
      request: HostRequest
    ) => Promise<HostResponse>
  ): void
}

/**
 * The renderer end of one IPC subscription.
 *
 * `send` is all the contract needs; `isDestroyed`/`once` are the Electron
 * `WebContents` extras the real main process supplies and test doubles omit.
 * They exist so a closed window can be dropped from the fan-out instead of
 * throwing `Object has been destroyed` out of an event emit.
 */
export type RendererSender = {
  send(channel: string, frame: HostWireFrame): void
  isDestroyed?(): boolean
  once?(event: 'destroyed', listener: () => void): void
}

/** Registers main-process IPC without coupling the reusable contract to Electron runtime types. */
export function registerPipiHostIpc(
  ipc: IpcMainLike,
  backend: HostBackend,
  channel = PIPI_HOST_IPC_CHANNEL
): void {
  const renderers = new Map<RendererSender, string | undefined>()
  backend.subscribe((frame) => {
    if (process.env.PIPIUI_STREAM_DEBUG) console.log(`[stream-debug] ipc-send ch=${(frame as { channel?: string }).channel} t=${Date.now()}`)
    for (const [renderer, selectedSession] of renderers) {
      if (!shouldForwardRendererEvent(frame, selectedSession)) continue
      if (renderer.isDestroyed?.()) { renderers.delete(renderer); continue }
      try {
        renderer.send(channel, { type: 'event', ...frame })
      } catch {
        // A WebContents can die between that check and this send — a window
        // closing while a pty timer flushes terminal output is the usual race.
        // Dropping the subscriber IS the recovery: this emit runs on a timer,
        // outside any promise chain, so a throw here is an uncaught exception
        // that takes down the whole main process.
        renderers.delete(renderer)
      }
    }
  })
  ipc.handle(channel, async (event, request) => {
    if (!renderers.has(event.sender)) {
      renderers.set(event.sender, undefined)
      event.sender.once?.('destroyed', () => { renderers.delete(event.sender) })
    }
    if (request.protocolVersion !== PIPI_HOST_PROTOCOL_VERSION || request.type !== 'request') {
      return { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id: request.id ?? '', type: 'response', ok: false, error: 'unsupported protocol' }
    }
    if (request.method === 'setEventProjectionSession') {
      renderers.set(event.sender, normalizeEventProjectionSession(request.params[0]))
      return { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id: request.id, type: 'response', ok: true, result: undefined }
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

function createWindow(
  browser: BrowserSessionHost,
  onClosed: () => void,
  freezeProbeFile?: string,
  isAppQuitting: () => boolean = () => false
): void {
  const window = new BaseWindow({
    width: 1280,
    height: 800,
    title: 'PipiUI',
    // Pre-paint base color: matches the shell's dark default (--bg in app.css)
    // so the window never shows the system-white behind the renderer during
    // first paint or a heavy remount (project/session switch).
    backgroundColor: '#17181c',
    // Like VS Code/Notion on macOS: no system title strip, only the traffic
    // lights remain. The renderer reserves a draggable strip via
    // env(titlebar-area-*). Keep the default framed titlebar elsewhere.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default'
  })
  const shellView = new WebContentsView({
    backgroundColor: '#17181c',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const unmountShellView = mountBrowserShellView(window as any, shellView as any)
  if (freezeProbeFile) {
    shellView.webContents.on('console-message', (...args: unknown[]) => {
      const details = args[1]
      const message = typeof details === 'object' && details && details !== null && 'message' in details
        ? String((details as { message: unknown }).message)
        : typeof args[2] === 'string' ? args[2] : ''
      if (!message.includes(FREEZE_PROBE_PREFIX)) return
      try {
        appendFileSync(freezeProbeFile, message.endsWith('\n') ? message : `${message}\n`)
      } catch {
        /* probe must not affect the window */
      }
    })
  }
  const mobileWindows = new BrowserMobileWindowController(
    window,
    options => new BaseWindow(options as any) as any,
    (sessionId, size) => browser.mobileWindowResized(sessionId, size),
    sessionId => browser.mobileWindowClosed(sessionId),
    isAppQuitting
  )
  browser.attachToWindow(
    (sessionId, rawView, placement, kind, device) => {
      if (kind === 'mobile') return mobileWindows.present(sessionId, rawView, placement, device)
      routeBrowserView(rawView, placement, window as any)
    },
    () => shellView.webContents.getZoomFactor()
  )
  window.on('close', () => {
    browser.detachWindow()
    mobileWindows.dispose()
    unmountShellView()
    if (!shellView.webContents.isDestroyed()) shellView.webContents.close()
  })
  window.on('closed', () => {
    onClosed()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void shellView.webContents.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void shellView.webContents.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Electron's package exports no runtime app object under Vitest; keep IPC registration importable.
if (app) {
  // productName stays "PipiUI" so the artifact folder does not collide
  // with the frozen Swift app. Override the process name so Dock / About / menus
  // show PipiUI. setName also changes the default userData folder, so pin it
  // back to the historical Electron profile immediately — unless the launcher
  // passed --user-data-dir, which is a deliberate relocation (the clean-room
  // script's only way to escape the real profile on macOS, where appData ignores
  // $HOME). Pinning over it would silently drag such a run back into ~/Library.
  app.setName('PipiUI')
  if (!hasExplicitUserDataDirSwitch(process.argv))
    app.setPath('userData', resolveStableElectronUserDataPath(app.getPath('appData')))
  app.whenReady().then(async () => {
    const browserDebugPath = process.env.PIPIUI_BROWSER_NATIVE_DEBUG
    let browserDebugCaptureSequence = 0
    if (browserDebugPath) {
      writeFileSync(browserDebugPath, '')
      installBrowserNativeTrace(entry => appendFileSync(browserDebugPath, `${JSON.stringify(entry)}\n`))
    }
    // Each browser session owns one real target-site WebContentsView per
    // viewport: desktop embeds in the IDE split and mobile lives in its child
    // window. Both views share the session partition and synchronized tab URL.
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
      // The default UA advertises "PipiUI/… Electron/…" tokens; some sites
      // (e.g. DuckDuckGo's HTML search endpoint) answer such framework UAs with
      // bot-challenge pages instead of content. Keep the standard Chrome tokens only.
      view.webContents.session.setUserAgent(
        view.webContents.getUserAgent().replace(/\s*[\w ]*Electron\/[\d.]+/g, '')
      )
      return view
    }, { certificateErrorApp: app })
    const watchCallbacks = new BrowserWatchCallbackRegistry()
    browser.setWatchTrigger((watch, reason, pageSummary) => {
      void watchCallbacks.deliver(watch.sessionKey, {
        watchId: watch.watchId,
        reason,
        waitedMs: Date.now() - watch.createdAt,
        url: pageSummary.url,
        title: pageSummary.title,
      })
    })
    const primary = screen.getPrimaryDisplay()
    const display = { displayID: primary.id, width: primary.size.width, height: primary.size.height }
    const userData = app.getPath('userData')
    const piProcessEnv = await resolveSystemProxyEnvironment(url => app.resolveProxy(url), process.env)
    const assets = resolveRuntimeAssets({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      dirname: __dirname,
      env: process.env,
      userData
    })
    // Screenshots delivered to the model are bounded to a 1568px long edge; the
    // host maps model coordinates back to driver pixels with these scale factors.
    const computerImagePipeline: ComputerImagePipeline = {
      prepareScreenshot(png, maxLongEdge) {
        const image = nativeImage.createFromBuffer(png)
        const size = image.getSize()
        if (!(size.width > 0) || !(size.height > 0)) throw new Error('Cua Driver screenshot is not decodable')
        const longEdge = Math.max(size.width, size.height)
        if (longEdge <= maxLongEdge) return { png, width: size.width, height: size.height, scaleX: 1, scaleY: 1 }
        const width = Math.max(1, Math.round(size.width * (maxLongEdge / longEdge)))
        const height = Math.max(1, Math.round(size.height * (maxLongEdge / longEdge)))
        const resized = image.resize({ width, height, quality: 'best' })
        return { png: resized.toPNG(), width, height, scaleX: width / size.width, scaleY: height / size.height }
      },
    }
    const computer = new CuaDriverHost(assets.cuaDriver, display, undefined, undefined, computerImagePipeline)
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
      appVersion: app.getVersion(),
      piCommand: assets.piCommand,
      env: piProcessEnv,
      managedNodeModulesRoot: assets.managedNodeModulesRoot,
      browserAction: (request, sessionId) => browser.toolAction(sessionId, request as any),
      browserWatch: (request, sessionId) => handleBrowserWatchEvent(request, sessionId, browser, watchCallbacks),
      terminalAction: (request, sessionId) => terminalHost.toolAction(sessionId, request as any),
      terminalSessionDeleted: sessionId => terminalHost.disposeSession(sessionId),
      computerDescriptor: display,
      computerUsable: () => computer.usable(),
      authHelperPath: assets.sourceRoot ? join(assets.sourceRoot, 'auth', 'pi-auth-helper.mjs') : undefined,
      runtimeRoot,
      agentDir: piProfile.agentDir,
      vaultDir: piProfile.agentDir,
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
      },
      // Versioned Host Capability API: extensions reach native hosts only through
      // this gated broker (hostApi handshake + per-project permission + one-time token).
      hostCapabilityAction: (request, sessionId) => hostCapability.dispatch(request, sessionId),
      hostCapabilityTokenAction: (request) => hostCapability.mint(request),
    })
    // Safe TDZ-forward reference: the arrow above only runs once bridge traffic
    // arrives, long after this binding. Declared permissions resolve lazily from
    // the bundled/app extension snapshot; project grants come from the project's
    // own `.pi/agent/ext-grants.json` — both fail closed.
    const hostCapability = createElectronHostCapabilityBroker({
      browser,
      browserWatch: (request, sessionId) => handleBrowserWatchEvent(request, sessionId, browser, watchCallbacks),
      computer,
      policy: {
        declaredPermissions: async (extensionId) =>
          (await piBackend.listBundledUpdateExtensions()).find(item => item.id === extensionId)?.permissions ?? [],
        projectAllows: async (extensionId, projectRoot, permission) => {
          try {
            const grants = await readProjectExtensionGrants(projectPiAgentDir(projectRoot))
            return grants[extensionId]?.grantedCapabilities.includes(permission) ?? false
          } catch {
            return false
          }
        },
        // Desktop grant: the presented computerCapability must be the one this
        // bridge session was minted (HostBridge.computers). Fail closed.
        verifyDesktopGrant: ({ sessionId, computerCapability }) =>
          piBackend.verifyDesktopGrant(sessionId, computerCapability),
      },
    })
    const terminalBackend = terminalHost.wrapBackend(piBackend)
    const pickProjectDirectory = async (): Promise<string | null> => {
      const options: OpenDialogOptions = { title: '选择项目文件夹', buttonLabel: '选择', properties: ['openDirectory', 'createDirectory'] }
      const owner = BaseWindow.getFocusedWindow() ?? BaseWindow.getAllWindows()[0]
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : result.filePaths[0] ?? null
    }
    const pickProductPackArchive = async (): Promise<string | null> => {
      const options: OpenDialogOptions = {
        title: '加载扩展包 ZIP',
        buttonLabel: '加载',
        properties: ['openFile'],
        filters: [{ name: 'PipiUI 扩展包', extensions: ['zip'] }],
      }
      const owner = BaseWindow.getFocusedWindow() ?? BaseWindow.getAllWindows()[0]
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : result.filePaths[0] ?? null
    }
    const saveProductPackArchive = async (suggestedName: string): Promise<string | null> => {
      const leaf = basename(suggestedName.trim()) || 'pipiui-extension-pack.zip'
      const defaultPath = leaf.toLowerCase().endsWith('.zip') ? leaf : `${leaf}.zip`
      const options: SaveDialogOptions = {
        title: '导出扩展包 ZIP',
        buttonLabel: '导出',
        defaultPath,
        filters: [{ name: 'PipiUI 扩展包', extensions: ['zip'] }],
      }
      const owner = BaseWindow.getFocusedWindow() ?? BaseWindow.getAllWindows()[0]
      const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
      return result.canceled ? null : result.filePath ?? null
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
      { id: 'headroom-ai', name: 'Headroom', category: 'extension', currentVersion: HEADROOM_ENGINE_VERSION, source: { type: 'pypi', packageName: 'headroom-ai' } },
      { id: 'cua-driver', name: 'Cua Driver', category: 'runtime', currentVersion: CUA_DRIVER_VERSION, source: { type: 'cuaGitHub' } },
      { id: 'vite', name: 'Vite', category: 'toolchain', currentVersion: UPDATE_CENTER_FRAMEWORK_VERSIONS.vite, source: { type: 'npm', packageName: 'vite' } },
      { id: 'electron-vite', name: 'electron-vite', category: 'toolchain', currentVersion: UPDATE_CENTER_FRAMEWORK_VERSIONS['electron-vite'], source: { type: 'npm', packageName: 'electron-vite' } }
    ]
    // Per-check discovery: bundled (builtin/app) extension manifests contribute namespaced update
    // components on top of the fixed catalog. Discovery is a read-only snapshot (never a rescan,
    // so the active project's loaded extensions and context stay untouched); checks are read-only
    // lookups at fixed registries. Discovery failures degrade to the fixed catalog and never
    // affect extension function.
    const resolveUpdateCatalog = async (): Promise<readonly UpdateCatalogItem[]> => {
      try {
        const listed = await piBackend.listBundledUpdateExtensions()
        return [...updateCatalog, ...extensionUpdateCatalogItems(listed)]
      } catch {
        return updateCatalog
      }
    }
    const format = process.platform === 'darwin' ? 'zip' : process.platform === 'win32' ? 'exe' : process.env.APPIMAGE ? 'AppImage' : 'deb'
    const edition = existsSync(join(process.resourcesPath, 'pipiui-runtime/extensions/office-extension/pipiui-extension.json')) ? 'coding' : 'base'
    const official = createOfficialUpdates({
      currentVersion: app.getVersion(),
      fetch: (url, init) => net.fetch(url, { ...init, credentials: 'omit' }),
      extensions: () => piBackend.listBundledUpdateExtensions(),
      installExtension: (id, version) => piBackend.updateOfficialExtension(id, version,
        (url, init) => net.fetch(url, { ...init, redirect: 'manual', credentials: 'omit' })),
      desktop: app.isPackaged ? async () => {
        const { MacUpdater, NsisUpdater, AppImageUpdater, DebUpdater } = await import('electron-updater')
        const Updater = { zip: MacUpdater, exe: NsisUpdater, AppImage: AppImageUpdater, deb: DebUpdater }[format]
        const feed = { provider: 'generic' as const, url: OFFICIAL_DOWNLOADS, channel: `pipiui-${edition}-${process.arch}-${format.toLowerCase()}` }
        const updater = new Updater(feed)
        // The --dir Mac distribution may omit builder's generated app-update.yml.
        if (!existsSync(join(process.resourcesPath, 'app-update.yml'))) {
          updater.updateConfigPath = join(process.resourcesPath, 'pipiui-updater.yml')
          updater.setFeedURL(feed)
        }
        updater.autoDownload = false
        updater.autoInstallOnAppQuit = false
        updater.disableDifferentialDownload = true
        updater.disableWebInstaller = true
        return {
          checkForUpdates: () => updater.checkForUpdates(),
          downloadUpdate: () => updater.downloadUpdate(),
          quitAndInstall: () => new Promise<void>((resolve, reject) => {
            const cleanup = () => {
              clearTimeout(timer)
              updater.off('error', failed)
              app.off('will-quit', quitting)
            }
            const failed = (reason: Error) => { cleanup(); reject(reason) }
            const quitting = () => { cleanup(); resolve() }
            const timer = setTimeout(() => failed(new Error('重启安装未完成，请重试')), 180_000)
            updater.once('error', failed)
            app.once('will-quit', quitting)
            try { updater.quitAndInstall(true, true) } catch (reason) {
              failed(reason instanceof Error ? reason : new Error(String(reason)))
            }
          }),
        }
      } : undefined,
    })
    const checkComponents = createUpdateCenterService({ catalog: resolveUpdateCatalog })
    const checkUpdates = async () => {
      const [snapshot, officialItems] = await Promise.all([checkComponents(), official.check()])
      return { ...snapshot, items: [...officialItems, ...snapshot.items] }
    }
    const backend = withUpdateCenter(withComputerUsePermissions(withProductPackFileDialogs(withProjectDirectoryPicker(withOpenDocumentExternally(withOpenExternal(withBrowserTabsHost(terminalBackend, browser), url => shell.openExternal(url)), path => shell.openPath(path)), pickProjectDirectory), { pickArchive: pickProductPackArchive, saveArchive: saveProductPackArchive }), createElectronComputerUsePermissionHost({
      getMediaAccessStatus: media => systemPreferences.getMediaAccessStatus(media),
      isTrustedAccessibilityClient: prompt => systemPreferences.isTrustedAccessibilityClient(prompt),
      requestScreenRecording: async () => {
        await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
      },
      openURL: url => shell.openExternal(url),
    })), checkUpdates, (extensionId, componentId) => piBackend.updateExtensionComponent(extensionId, componentId), official.apply)
    registerPipiHostIpc(ipcMain, backend)
    const remoteControl = createRemoteControlService({
      backend,
      userDataDir: userData,
      relayOrigin: process.env.PIPIUI_RELAY_ORIGIN || 'https://remote.deepwood.cn'
    })
    // Remote control keeps a relay socket alive; if the system idles to sleep
    // the socket dies and the machine becomes unreachable. Hold an idle-sleep
    // assertion while the room is enabled (the display may still sleep).
    bindRemoteControlSleepPrevention(remoteControl, powerSaveBlocker)
    // A locked Mac can strand an otherwise OPEN WebSocket. Reconnect after
    // unlock/wake so the paired browser gets a fresh host hello immediately.
    bindRemoteControlPowerLifecycle(remoteControl, powerMonitor)
    const remoteDebug = createRemoteDebugService({
      backend,
      staticDir: resolveRemoteDebugStaticDir({
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath
      })
    })
    registerRemoteControlIpc(
      ipcMain,
      remoteControl,
      PIPI_REMOTE_CONTROL_IPC_CHANNEL,
      PIPI_REMOTE_CONTROL_EVENT_CHANNEL,
      remoteDebug
    )
    void remoteControl.restore()
    let appQuitting = false
    app.on('before-quit', () => {
      appQuitting = true
      void remoteDebug.close()
    })
    createWindow(browser, () => terminalHost.closeAll(), join(piProfile.agentDir, FREEZE_PROBE_FILE), () => appQuitting)
    // Capability is the first models-write job. Isolated backend init then migrates
    // project catalogs and refreshes the model catalog; do not refresh here or the
    // UI can observe pre-migration canonical state.
    installOwnedRuntimeShutdown(app, terminalHost, computer, piBackend)
    app.on('activate', () => {
      if (BaseWindow.getAllWindows().length === 0) {
        createWindow(browser, () => terminalHost.closeAll(), join(piProfile.agentDir, FREEZE_PROBE_FILE), () => appQuitting)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
