/**
 * Browser host stack — public entry point.
 *
 * The implementation lives in ./browser/*:
 *   - types.ts            shared structural types + state constants
 *   - native-view.ts      shell mount, native trace, view routing
 *   - viewport.ts         pure viewport/bounds/emulation math
 *   - tab-model.ts        URL/tab-title/history/partition helpers
 *   - dom-bridge.ts       DOM controller dispatch + request shaping
 *   - redaction.ts        page-world sanitization of bypass results
 *   - debug-envelope.ts   envelope assembly with page context
 *   - console-pipeline.ts console buffering + js-dialog notice fan-out
 *   - navigation-settle.ts loadURL/reload settle bound (hung commit must not pin the queue)
 *   - tabs-host.ts        BrowserTabsHost (tabs, panes, navigation, tools)
 *   - session-host.ts     BrowserSessionHost (per-session spaces + queues)
 *   - bridge.ts           HostBackend extension (withBrowserTabsHost)
 *
 * This module only re-exports the stable public surface so existing consumers
 * (index.ts, remote-debug, tests) keep their import paths.
 */
export { BrowserSessionHost, type BrowserSessionHostOptions } from './browser/session-host.js'
export { BrowserTabsHost } from './browser/tabs-host.js'
export { withBrowserTabsHost } from './browser/bridge.js'

export { installBrowserNativeTrace, mountBrowserShellView, routeBrowserView } from './browser/native-view.js'

export {
  browserDeviceEmulationFor,
  browserViewportPreset,
  normalizeBrowserToolTarget,
  normalizeBrowserViewMode,
  parseBrowserSnapshotTarget,
  tagBrowserSnapshotId,
} from './browser/viewport.js'

export { browserPartitionForSession, normalizeBrowserURL } from './browser/tab-model.js'

export type {
  BrowserDeviceEmulation,
  BrowserShellWindowLike,
  BrowserViewFactory,
  BrowserViewLike,
  BrowserViewNativeHostLike,
  BrowserViewPlacement,
  BrowserWebContentsLike,
} from './browser/types.js'

export { BROWSER_HOST_TOOL_ACTIONS, shouldOpenBrowserDevTools } from './browser-debug.js'
export { BROWSER_NAVIGATION_SETTLE_TIMEOUT_MS, BROWSER_RELOAD_SETTLE_TIMEOUT_MS } from './browser/navigation-settle.js'
export {
  WATCHER_DEFAULT_INTERVAL_MS,
  WatcherRegistry,
  type WatchCondition,
  type WatchPageSummary,
  type WatchRecord,
  type WatchRegisterInput,
  type WatchRegisterResult,
  type WatchTriggerHandler,
  type WatchTriggerReason,
  type WatchUnwatchResult,
  type WatchWaitCheckRequest,
} from './watcher-registry.js'
