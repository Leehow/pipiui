/**
 * Shared structural types and state constants for the browser host stack.
 * Structural Electron stand-ins keep every module here unit-testable without
 * a real Electron runtime.
 */
import type { BrowserConsoleEntry } from '@pipi/host-api/browser'
import type { BrowserTab, BrowserTabsSnapshot, BrowserViewBounds } from '@pipi/host-api'

export interface BrowserWebContentsLike {
  loadURL(url: string): Promise<unknown> | unknown
  reload(): void
  stop?(): void
  getURL?(): string
  executeJavaScript?(code: string): Promise<unknown>
  capturePage?(rect?: BrowserViewBounds, options?: { stayHidden?: boolean; stayAwake?: boolean }): Promise<{ toPNG(): Uint8Array }>
  close?(options?: { waitForBeforeUnload?: boolean }): void
  isDestroyed?(): boolean
  isCrashed?(): boolean
  getOSProcessId?(): number
  session?: { clearStorageData(): Promise<void>; clearCache(): Promise<void> }
  enableDeviceEmulation?(params: BrowserDeviceEmulation): void
  disableDeviceEmulation?(): void
  setZoomFactor?(factor: number): void
  getZoomFactor?(): number
  setUserAgent?(userAgent: string): void
  getUserAgent?(): string
  on(event: string, listener: (...args: any[]) => void): unknown
  off?(event: string, listener: (...args: any[]) => void): unknown
  openDevTools?(options?: { mode?: string }): void
  isDevToolsOpened?(): boolean
}

export type BrowserDeviceEmulation = {
  screenPosition: 'desktop' | 'mobile'
  screenSize: { width: number; height: number }
  viewPosition: { x: number; y: number }
  deviceScaleFactor: number
  viewSize: { width: number; height: number }
  scale: number
}
export interface BrowserViewLike {
  webContents: BrowserWebContentsLike
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void
  getBounds?(): { x: number; y: number; width: number; height: number }
  setVisible?(visible: boolean): void
  getVisible?(): boolean
  setBackgroundColor?(color: string): void
}
export type BrowserViewFactory = (options: { webPreferences: { contextIsolation: boolean; nodeIntegration: boolean; sandbox: boolean; partition?: string } }) => BrowserViewLike
export type BrowserViewPlacement = boolean | 'detach' | 'raise'
export type BrowserViewAttach = (view: BrowserViewLike, placement: BrowserViewPlacement, kind: BrowserViewportKind, device: BrowserMobileWindowDevice) => BrowserViewBounds | void
export type BrowserSessionViewAttach = (sessionId: string, view: BrowserViewLike, placement: BrowserViewPlacement, kind: BrowserViewportKind, device: BrowserMobileWindowDevice) => BrowserViewBounds | void
export type BrowserMobileWindowDevice = BrowserMobileDevice & { deviceId: string; label: string }
export type BrowserSpaceEvent =
  | { type: 'tabs'; snapshot: BrowserTabsSnapshot }
  | { type: 'reveal' }
  | { type: 'error'; message: string }
  | { type: 'console'; entry: BrowserConsoleEntry }
  | { type: 'certificate-error'; url: string; reason: string }
  | { type: 'js-dialog'; kind: 'alert' | 'confirm' | 'prompt'; message: string; url?: string }
  | { type: 'mobile-window'; open: boolean; deviceId: string }

export interface BrowserViewNativeHostLike {
  contentView: { children?: BrowserViewLike[]; addChildView(view: BrowserViewLike): void; removeChildView(view: BrowserViewLike): void }
}

export type BrowserShellLayoutEvent = 'resize' | 'maximize' | 'unmaximize' | 'restore' | 'enter-full-screen' | 'leave-full-screen' | 'show'

export interface BrowserShellWindowLike extends BrowserViewNativeHostLike {
  getContentBounds(): { width: number; height: number }
  on(event: BrowserShellLayoutEvent, listener: () => void): unknown
  off(event: BrowserShellLayoutEvent, listener: () => void): unknown
}

export type BrowserTabRecord = BrowserTab & { history: string[]; historyIndex: number }
export type NavigationKind = 'push' | 'history' | 'restore' | 'reload'
export type PendingNavigation = { tabId: string; kind: NavigationKind; url: string; startedAt: number }

/**
 * Electron emits `certificate-error` from the `app` object, never from
 * webContents: the owning pane is recovered by matching the event's
 * webContents against the live panes.
 */
export type BrowserCertificateErrorListener = (
  event: { preventDefault(): void },
  webContents: unknown,
  url: string,
  error: string,
  certificate: unknown,
  callback: (isTrusted: boolean) => void
) => void
export interface BrowserCertificateErrorAppLike {
  on(event: 'certificate-error', listener: BrowserCertificateErrorListener): unknown
  off?(event: 'certificate-error', listener: BrowserCertificateErrorListener): unknown
}

export const hiddenBounds: BrowserViewBounds = { x: 0, y: 0, width: 0, height: 0, visible: false }
export type BrowserToolTarget = 'active' | 'desktop' | 'mobile' | 'both'
export type BrowserViewMode = 'desktop' | 'mobile' | 'compare'
export type BrowserViewportKind = 'desktop' | 'mobile'
export type BrowserMobileDevice = { width: number; height: number; deviceScaleFactor: number; userAgent?: string }
export const BROWSER_DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const
export const BROWSER_MOBILE_VIEWPORT = { width: 390, height: 844 } as const
export const DEFAULT_MOBILE_DEVICE: BrowserMobileDevice = { width: 390, height: 844, deviceScaleFactor: 2 }
export const defaultPartition = 'persist:pipiui-browser'
export const unsafeBothActions = new Set(['click', 'input', 'type', 'select', 'fill_form', 'scroll', 'eval', 'content', 'console', 'wait'])
/** Actions whose page dispatch is deferred to the caller; navigation itself may run mid-navigation. */
export const navigationExemptActions = new Set(['navigate', 'back', 'forward', 'reload', 'console'])

export type ViewPane = {
  kind: BrowserViewportKind
  view?: BrowserViewLike
  shownTabId?: string
  loadedUrl?: string
  attachedVisible?: boolean
  pending?: PendingNavigation
  /** This pane's own webContents is mid-load. Tab-level isLoading is shared by both panes, so per-pane guards must read this instead. */
  loading?: boolean
  /** When `loading` became true without a pending record (organic start-loading). */
  loadingStartedAt?: number
}
