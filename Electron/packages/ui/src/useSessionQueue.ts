import { useCallback, useEffect, useRef, useState } from 'react'
import type { PipiHostAPI, PromptAttachment, QueueEnqueueResult, QueuedMessage, StreamEvent } from '@pipi/host-api'
import type { MessageQueueItem } from './MessageQueue'

function queueError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function queueItem(message: QueuedMessage): MessageQueueItem {
  return {
    id: message.id,
    text: message.text,
    // Queue payloads deliberately remain host-owned. The compact UI retains
    // attachment count/name without rehydrating base64 image payloads.
    images: message.attachments.map(attachment => ({ name: attachment.name })),
    status: message.state,
    error: message.error
  }
}

export type UseSessionQueueResult = {
  items: MessageQueueItem[]
  expanded: boolean
  pending: boolean
  error: string | null
  busy: boolean
  setExpanded: (expanded: boolean) => void
  dismissError: () => void
  acceptStreamEvent: (event: StreamEvent) => void
  /** Re-pulls the authoritative queue snapshot (e.g. after settled) so a missed
   *  queue_update can never strand the composer in a busy state. */
  resync: () => Promise<void>
  enqueue: (text: string, attachments?: PromptAttachment[]) => Promise<QueueEnqueueResult>
  edit: (messageId: string, text: string) => Promise<void>
  remove: (messageId: string) => Promise<void>
  promote: (messageId: string) => Promise<void>
  steer: (messageId: string) => Promise<void>
  retry: (messageId: string) => Promise<void>
}

/**
 * Renderer adapter for the host-owned session queue. `queue_update` snapshots
 * are authoritative; the hook only protects them from stale session loads and
 * invokes the existing queue API for mutations.
 */
export function useSessionQueue(host: PipiHostAPI, sessionId: string, streaming: boolean): UseSessionQueueResult {
  const [queue, setQueue] = useState<QueuedMessage[]>([])
  const [expanded, setExpanded] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sessionRef = useRef(sessionId)
  const queueRef = useRef<QueuedMessage[]>(queue)
  const pendingRef = useRef(false)
  const loadGenerationRef = useRef(0)
  const resyncGenerationRef = useRef(0)
  const snapshotGenerationRef = useRef(0)
  sessionRef.current = sessionId
  queueRef.current = queue

  useEffect(() => {
    const generation = ++loadGenerationRef.current
    resyncGenerationRef.current += 1
    const snapshotGeneration = snapshotGenerationRef.current
    pendingRef.current = false
    setPending(false)
    setError(null)
    setExpanded(false)
    setQueue([])
    if (!sessionId) return

    let disposed = false
    void host.listQueue(sessionId).then(items => {
      // A queue_update observed after this load started is newer than this
      // request, and a selection change must never repopulate another session.
      if (!disposed && loadGenerationRef.current === generation && sessionRef.current === sessionId && snapshotGenerationRef.current === snapshotGeneration) setQueue(items)
    }).catch(error => {
      if (!disposed && loadGenerationRef.current === generation && sessionRef.current === sessionId) setError(`加载队列失败：${queueError(error)}`)
    })
    return () => { disposed = true }
  }, [host, sessionId])

  const acceptStreamEvent = useCallback((event: StreamEvent) => {
    if (event.type !== 'queue_update' || event.sessionId !== sessionRef.current) return
    snapshotGenerationRef.current += 1
    setQueue(event.queue)
  }, [])

  const resync = useCallback(async () => {
    const activeSessionId = sessionRef.current
    if (!activeSessionId) return
    const generation = ++resyncGenerationRef.current
    // `resync` is invoked at the terminal turn boundary. A `sending` item is
    // only the transient RPC-acceptance state and cannot remain authoritative
    // once that turn has settled; clear it synchronously so a delayed pull
    // cannot strand the composer. Queued/failed work remains visible, and the
    // host response below may still report a genuinely newer sending item.
    snapshotGenerationRef.current += 1
    const snapshotGeneration = snapshotGenerationRef.current
    setQueue(current => current.filter(item => item.state !== 'sending'))
    try {
      const items = await host.listQueue(activeSessionId)
      // A newer resync or queue_update wins even when this request returns last.
      if (
        sessionRef.current === activeSessionId
        && resyncGenerationRef.current === generation
        && snapshotGenerationRef.current === snapshotGeneration
      ) {
        snapshotGenerationRef.current += 1
        setQueue(items)
      }
    } catch { /* best-effort: snapshots keep flowing via queue_update */ }
  }, [host])

  const mutate = useCallback(async <T,>(operation: (activeSessionId: string) => Promise<T>): Promise<T> => {
    const activeSessionId = sessionRef.current
    if (!activeSessionId) throw new Error('未选择会话')
    if (pendingRef.current) throw new Error('队列操作进行中')
    pendingRef.current = true
    setPending(true)
    setError(null)
    try {
      return await operation(activeSessionId)
    } catch (error) {
      if (sessionRef.current === activeSessionId) setError(`队列操作失败：${queueError(error)}`)
      throw error
    } finally {
      if (sessionRef.current === activeSessionId) {
        pendingRef.current = false
        setPending(false)
      }
    }
  }, [])

  const enqueue = useCallback((text: string, attachments?: PromptAttachment[]) => mutate(activeSessionId => host.enqueueMessage(activeSessionId, text, attachments)), [host, mutate])
  const edit = useCallback(async (messageId: string, text: string) => {
    const attachments = queueRef.current.find(item => item.id === messageId)?.attachments
    await mutate(activeSessionId => host.updateQueuedMessage(activeSessionId, messageId, text, attachments))
  }, [host, mutate])
  const remove = useCallback(async (messageId: string) => { await mutate(activeSessionId => host.removeQueuedMessage(activeSessionId, messageId)) }, [host, mutate])
  const promote = useCallback(async (messageId: string) => { await mutate(activeSessionId => host.promoteQueuedMessage(activeSessionId, messageId)) }, [host, mutate])
  const steer = useCallback(async (messageId: string) => { await mutate(activeSessionId => host.steerQueuedMessage(activeSessionId, messageId)) }, [host, mutate])
  const retry = useCallback(async (messageId: string) => { await mutate(activeSessionId => host.retryQueuedMessage(activeSessionId, messageId)) }, [host, mutate])

  return {
    items: queue.map(queueItem),
    expanded,
    pending,
    error,
    busy: streaming || queue.some(item => item.state === 'sending'),
    setExpanded,
    dismissError: () => setError(null),
    acceptStreamEvent,
    resync,
    enqueue,
    edit,
    remove,
    promote,
    steer,
    retry
  }
}
