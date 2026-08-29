import {
  EXTENSION_HOST_API_VERSION,
  HostCapabilityBroker,
  type HostCapabilityDrivers,
  type HostCapabilityPolicy,
} from '@pipi/pi-backend'
import type { BrowserSessionHost } from './browser-host.js'
import type { CuaDriverHost } from './cua-driver-host.js'

/**
 * Binds the versioned Host Capability API broker to the Electron-native hosts:
 * `browser.session` ops ride the BrowserSessionHost (WebContentsView lifecycle,
 * partition, tabs, DOM bridge), `native.exec` ops ride the CuaDriverHost
 * (open_application, screenshots + redaction policy, AX/pid/window targeting).
 * Authorization inputs stay injected so the gate policy has one owner per app.
 */
export type ElectronHostCapabilityPolicy = {
  /** Manifest-declared permissions per extension id (deny by default). */
  declaredPermissions(extensionId: string): readonly string[] | Promise<readonly string[]>
  /** Per-project grant check (`{projectRoot}/.pi/agent/ext-grants.json` semantics). */
  projectAllows(extensionId: string, projectRoot: string, permission: string): boolean | Promise<boolean>
  /** Desktop-grant check: does the bridge session own the presented computerCapability? */
  verifyDesktopGrant?(input: { sessionId: string; computerCapability: string }): boolean | Promise<boolean>
}

export function createElectronHostCapabilityBroker(options: {
  browser: Pick<BrowserSessionHost, 'toolAction' | 'disposeSession'>
  /** Watch/DOM bridge events, already bound to the session's callback registry. */
  browserWatch: (request: Record<string, unknown>, sessionId: string) => Promise<Record<string, unknown>> | Record<string, unknown>
  computer: Pick<CuaDriverHost, 'handle' | 'usable'>
  policy: ElectronHostCapabilityPolicy
  tokenTtlMs?: number
}): HostCapabilityBroker {
  const drivers: HostCapabilityDrivers = {
    browser: {
      toolAction: (sessionId, request) =>
        options.browser.toolAction(sessionId, request as Parameters<BrowserSessionHost['toolAction']>[1]),
      watchAction: (sessionId, request) => options.browserWatch(request, sessionId),
      disposeSession: sessionId => options.browser.disposeSession(sessionId),
    },
    native: {
      handle: request => options.computer.handle(request),
      usable: () => options.computer.usable(),
    },
  }
  const policy: HostCapabilityPolicy = {
    declaredPermissions: extensionId => options.policy.declaredPermissions(extensionId),
    projectAllows: (extensionId, projectRoot, permission) =>
      options.policy.projectAllows(extensionId, projectRoot, permission),
    ...(options.policy.verifyDesktopGrant
      ? { verifyDesktopGrant: (input: { sessionId: string; computerCapability: string }) =>
          options.policy.verifyDesktopGrant!(input) }
      : {}),
  }
  return new HostCapabilityBroker({
    hostApiVersion: EXTENSION_HOST_API_VERSION,
    drivers,
    policy,
    tokenTtlMs: options.tokenTtlMs,
  })
}
