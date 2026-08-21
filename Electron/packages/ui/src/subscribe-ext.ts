import { useEffect } from 'react'
import type { Disposer } from './contribution-registry'

/** Renderer envelope for HostEvent `channel: "ext.<id>"` (spec D4). */
export type ExtEvent = { type: string; payload?: unknown }

export type ExtHost = {
  subscribeExt?: (extensionId: string, listener: (event: ExtEvent) => void) => (() => void) | void
} | undefined

/**
 * Renderer-side D4 consumer: wrap optional `host.subscribeExt(id, cb)`.
 * The returned disposer unsubscribes once (idempotent), matching contribution-registry.
 */
export function subscribeExt(
  host: ExtHost,
  extensionId: string,
  listener: (event: ExtEvent) => void,
): Disposer {
  let disposed = false
  const unsubscribe = host?.subscribeExt?.(extensionId, event => {
    if (disposed) return
    listener(event)
  })
  return () => {
    if (disposed) return
    disposed = true
    unsubscribe?.()
  }
}

/** Subscribe for the lifetime of the calling component; unsubscribes on unmount or dep change. */
export function useSubscribeExt(
  host: ExtHost,
  extensionId: string,
  listener: (event: ExtEvent) => void,
): void {
  useEffect(() => subscribeExt(host, extensionId, listener), [host, extensionId, listener])
}
