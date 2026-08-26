/**
 * Native view composition: shell mounting, cross-window view routing, and the
 * optional native-layer trace sink. A WebContentsView has one stable native
 * owner for its whole lifetime, so routing decisions live here, isolated from
 * tab/pane state.
 */
import type { BrowserToolRequest } from '@pipi/host-api'
import { requestIdOf } from '../browser-debug.js'
import type { BrowserShellLayoutEvent, BrowserViewLike, BrowserViewNativeHostLike, BrowserViewPlacement, BrowserShellWindowLike } from './types.js'

const SHELL_LAYOUT_EVENTS: BrowserShellLayoutEvent[] = ['resize', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen', 'show']


/** BaseWindow composition: mount the renderer shell first and keep it full-size. */
export function mountBrowserShellView(window: BrowserShellWindowLike, shellView: BrowserViewLike): () => void {
  const layout = () => {
    const { width, height } = window.getContentBounds()
    shellView.setBounds({ x: 0, y: 0, width, height })
    traceBrowserNative('shell:layout', shellView, window, { requested: { x: 0, y: 0, width, height } })
  }
  window.contentView.addChildView(shellView)
  layout()
  for (const event of SHELL_LAYOUT_EVENTS) window.on(event, layout)
  return () => { for (const event of SHELL_LAYOUT_EVENTS) window.off(event, layout) }
}

const browserViewParent = new WeakMap<BrowserViewLike, BrowserViewNativeHostLike>()
const browserViewDebugIds = new WeakMap<BrowserViewLike, number>()
let browserViewDebugSequence = 0
let browserNativeTraceSink: ((entry: Record<string, unknown>) => void) | undefined

export function installBrowserNativeTrace(sink: ((entry: Record<string, unknown>) => void) | undefined): void {
  browserNativeTraceSink = sink
}

export function traceBrowserNative(stage: string, view: BrowserViewLike, host?: BrowserViewNativeHostLike, detail: Record<string, unknown> = {}): void {
  if (!browserNativeTraceSink) return
  let viewId = browserViewDebugIds.get(view)
  if (!viewId) {
    viewId = ++browserViewDebugSequence
    browserViewDebugIds.set(view, viewId)
  }
  const childIds = host?.contentView.children?.map(child => {
    let childId = browserViewDebugIds.get(child)
    if (!childId) {
      childId = ++browserViewDebugSequence
      browserViewDebugIds.set(child, childId)
    }
    return childId
  })
  browserNativeTraceSink({
    timestamp: Date.now(),
    stage,
    viewId,
    bounds: view.getBounds?.(),
    visible: view.getVisible?.(),
    childIds,
    ...detail
  })
}

export function nativeViewUsable(view: BrowserViewLike | undefined): view is BrowserViewLike {
  const contents = view?.webContents
  return Boolean(contents && typeof contents.loadURL === 'function' && !contents.isDestroyed?.())
}

export function routeBrowserView(
  view: BrowserViewLike,
  placement: BrowserViewPlacement,
  mainHost: BrowserViewNativeHostLike,
  hiddenHost?: BrowserViewNativeHostLike
): void {
  const parent = browserViewParent.get(view)
  if (placement === 'detach' || !nativeViewUsable(view)) {
    try { mainHost.contentView.removeChildView(view) } catch { /* not attached */ }
    try { hiddenHost?.contentView.removeChildView(view) } catch { /* not attached */ }
    browserViewParent.delete(view)
    view.setVisible?.(false)
    traceBrowserNative('route:detach', view, mainHost, { destroyed: !nativeViewUsable(view) })
    return
  }
  const visible = placement
  // A WebContentsView has one stable native owner for its whole lifetime.
  // Electron documents same-parent add as a reorder operation, but does not
  // guarantee that a live Chromium surface can migrate across BaseWindows.
  // Hidden tool browsing therefore stays attached to main with a real viewport
  // and setVisible(false), instead of moving through the transparent host.
  if (placement === 'raise') {
    if (parent === mainHost) {
      try { mainHost.contentView.addChildView(view) } catch { /* same-parent reorder */ }
    }
    traceBrowserNative('route:raise', view, mainHost, { placement })
    return
  }
  if (parent === mainHost) {
    if (!visible) view.setVisible?.(false)
    traceBrowserNative('route:existing-main', view, mainHost, { placement: visible })
    return
  }
  // Clean up a legacy/unknown attachment once, then establish main ownership.
  try { hiddenHost?.contentView.removeChildView(view) } catch { /* not attached */ }
  try { mainHost.contentView.removeChildView(view) } catch { /* not attached */ }
  mainHost.contentView.addChildView(view)
  browserViewParent.set(view, mainHost)
  if (!visible) view.setVisible?.(false)
  traceBrowserNative('route:add-main', view, mainHost, { placement: visible })
}

/** Action-level trace entries ride the same optional native trace sink. */
export function traceBrowserAction(stage: string, request: BrowserToolRequest, extra: Record<string, unknown> = {}): void {
  if (!browserNativeTraceSink) return
  browserNativeTraceSink({
    timestamp: Date.now(),
    stage,
    requestId: requestIdOf(request as { requestID?: unknown; requestId?: unknown }),
    action: request.action,
    ...extra,
  })
}
