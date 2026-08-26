/**
 * Pure viewport geometry and device-emulation math: preset sizing, bounds
 * readers, zoom clamping, and the BrowserViewBounds -> native rectangle
 * translation. No tab or pane state lives here; every function is a pure
 * mapping from the public bounds payload to layout values.
 */
import type { BrowserViewBounds } from '@pipi/host-api'
import { nativeViewUsable } from './native-view.js'
import { BROWSER_DESKTOP_VIEWPORT, DEFAULT_MOBILE_DEVICE } from './types.js'
import type { BrowserDeviceEmulation, BrowserMobileDevice, BrowserToolTarget, BrowserViewLike, BrowserViewMode, BrowserViewportKind } from './types.js'

export function browserViewportPreset(kind: BrowserViewportKind, device: BrowserMobileDevice = DEFAULT_MOBILE_DEVICE): { width: number; height: number } {
  return kind === 'mobile' ? { width: device.width, height: device.height } : BROWSER_DESKTOP_VIEWPORT
}

export function normalizeBrowserViewMode(value: unknown): BrowserViewMode {
  return value === 'mobile' || value === 'compare' ? value : 'desktop'
}

export function normalizeBrowserToolTarget(value: unknown): BrowserToolTarget {
  return value === 'desktop' || value === 'mobile' || value === 'both' ? value : 'active'
}

export function boundsMode(bounds: BrowserViewBounds): unknown {
  return (bounds as BrowserViewBounds & { mode?: unknown }).mode
}

export function boundsSlots(bounds: BrowserViewBounds): { desktop?: { x: number; y: number; width: number; height: number }; mobile?: { x: number; y: number; width: number; height: number } } | undefined {
  return (bounds as BrowserViewBounds & { slots?: { desktop?: { x: number; y: number; width: number; height: number }; mobile?: { x: number; y: number; width: number; height: number } } }).slots
}

export function boundsMobileOverlay(bounds: BrowserViewBounds): BrowserViewBounds['mobileOverlay'] {
  return (bounds as BrowserViewBounds).mobileOverlay
}

export function readMobileDevice(bounds: BrowserViewBounds, fallback: BrowserMobileDevice): BrowserMobileDevice {
  const overlay = boundsMobileOverlay(bounds)
  const viewport = overlay?.viewport
  return {
    width: Math.max(1, Math.round(viewport?.width ?? fallback.width)),
    height: Math.max(1, Math.round(viewport?.height ?? fallback.height)),
    deviceScaleFactor: overlay?.deviceScaleFactor && overlay.deviceScaleFactor > 0 ? overlay.deviceScaleFactor : fallback.deviceScaleFactor,
    userAgent: overlay?.userAgent || fallback.userAgent
  }
}

export function mobileDeviceChanged(previous: BrowserMobileDevice, next: BrowserMobileDevice): boolean {
  return previous.width !== next.width
    || previous.height !== next.height
    || previous.deviceScaleFactor !== next.deviceScaleFactor
    || previous.userAgent !== next.userAgent
}

export function parseBrowserSnapshotTarget(snapshotId: string | undefined): { kind?: BrowserViewportKind; id: string } {
  if (!snapshotId) return { id: '' }
  const match = /^(desktop|mobile):(.*)$/.exec(snapshotId)
  return match ? { kind: match[1] as BrowserViewportKind, id: match[2] } : { id: snapshotId }
}

export function tagBrowserSnapshotId(id: string, kind: BrowserViewportKind): string {
  return `${kind}:${id}`
}

export function browserDeviceEmulationFor(
  kind: BrowserViewportKind,
  visual: { width: number; height: number },
  device: BrowserMobileDevice = DEFAULT_MOBILE_DEVICE
): BrowserDeviceEmulation {
  if (kind !== 'mobile') {
    return {
      screenPosition: 'desktop',
      screenSize: { width: Math.max(1, visual.width), height: Math.max(1, visual.height) },
      viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: 1,
      viewSize: { width: Math.max(1, visual.width), height: Math.max(1, visual.height) },
      scale: 1
    }
  }
  const preset = browserViewportPreset(kind, device)
  const scale = visual.width > 0 && visual.height > 0
    ? Math.min(visual.width / preset.width, visual.height / preset.height)
    : 1
  return {
    screenPosition: 'mobile',
    screenSize: { width: preset.width, height: preset.height },
    viewPosition: { x: 0, y: 0 },
    deviceScaleFactor: device.deviceScaleFactor,
    viewSize: { width: preset.width, height: preset.height },
    scale: scale > 0 ? scale : 1
  }
}

export function hiddenPresetBounds(kind: BrowserViewportKind, device: BrowserMobileDevice = DEFAULT_MOBILE_DEVICE): BrowserViewBounds {
  const preset = browserViewportPreset(kind, device)
  return { x: 0, y: 0, width: preset.width, height: preset.height, visible: false }
}

export function roundRect(value: number): number {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0))
}

export function setNativeBounds(view: BrowserViewLike, bounds: BrowserViewBounds): void {
  // BrowserViewBounds carries API presentation state; Electron View.setBounds
  // accepts only a native Rectangle. Never leak the custom `visible` key into
  // gin's Rectangle conversion.
  view.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })
}

export function applyViewport(
  view: BrowserViewLike,
  kind: BrowserViewportKind,
  visual: { width: number; height: number },
  emulate: boolean,
  device: BrowserMobileDevice = DEFAULT_MOBILE_DEVICE,
  zoomFactor = 1
): void {
  if (!nativeViewUsable(view) || view.webContents.isCrashed?.()) return
  // Mobile uses enableDeviceEmulation scale only — never also zoom, or the page
  // is shrunk twice into the corner. Desktop page zoom is user-controlled.
  view.webContents.setZoomFactor?.(kind === 'mobile' ? 1 : clampBrowserZoom(zoomFactor))
}

const BROWSER_ZOOM_MIN = 0.25
const BROWSER_ZOOM_MAX = 5

export function clampBrowserZoom(factor: number): number {
  const next = Number.isFinite(factor) ? factor : 1
  return Math.min(BROWSER_ZOOM_MAX, Math.max(BROWSER_ZOOM_MIN, Math.round(next * 100) / 100))
}
