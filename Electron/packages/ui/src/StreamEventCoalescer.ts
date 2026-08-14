import type { StreamEvent } from '@pipi/host-api'

type DeltaEvent = Extract<StreamEvent, { type: 'text' | 'thinking' | 'tool_call' }>
export type StreamEventCoalescerMetrics = { receivedDeltas: number; emittedDeltas: number; flushes: number }
export type StreamEventCoalescerOptions = { delayMs?: number; onEvent: (event: StreamEvent) => void }

function isNonEmptyDelta(event: StreamEvent): event is DeltaEvent {
  return (event.type === 'text' || event.type === 'thinking' || event.type === 'tool_call') && Boolean(event.delta)
}

function keyFor(event: DeltaEvent): string {
  return event.type === 'tool_call'
    ? `${event.sessionId}:tool_call:${event.toolCallId}`
    : event.type === 'thinking'
      // Segment epoch is part of the key: thinking blocks from different
      // assistant messages reuse contentIndex and must never merge together.
      ? `${event.sessionId}:${event.type}:${event.segment ?? 0}:${event.contentIndex}`
      : `${event.sessionId}:${event.type}:${event.contentIndex}`
}

/**
 * Leading + trailing coalescer for renderer stream updates. It preserves event
 * order by synchronously flushing before every non-delta boundary or delta key
 * change, while avoiding a React update for every token.
 */
export class StreamEventCoalescer {
  readonly metrics: StreamEventCoalescerMetrics = { receivedDeltas: 0, emittedDeltas: 0, flushes: 0 }
  private readonly delayMs: number
  private timer: ReturnType<typeof setTimeout> | undefined
  private buffered: DeltaEvent | undefined
  private activeKey: string | undefined
  private leadingEmitted = false
  private disposed = false

  constructor(private readonly options: StreamEventCoalescerOptions) { this.delayMs = options.delayMs ?? 50 }

  push(event: StreamEvent) {
    if (this.disposed) return
    if (!isNonEmptyDelta(event)) {
      this.flush()
      this.activeKey = undefined
      this.leadingEmitted = false
      this.options.onEvent(event)
      return
    }

    this.metrics.receivedDeltas++
    const key = keyFor(event)
    if (this.activeKey !== undefined && this.activeKey !== key) this.flush()
    if (!this.leadingEmitted) {
      this.activeKey = key
      this.leadingEmitted = true
      this.emit(event)
      return
    }

    this.buffered = this.buffered ? { ...this.buffered, delta: (this.buffered.delta ?? '') + (event.delta ?? '') } : event
    this.activeKey = key
    this.scheduleFlush()
  }

  flush() {
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined }
    if (this.buffered) {
      const event = this.buffered
      this.buffered = undefined
      this.metrics.flushes++
      this.emit(event)
    }
    this.leadingEmitted = false
  }

  dispose() {
    if (this.disposed) return
    this.flush()
    this.disposed = true
  }

  private scheduleFlush() {
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (!this.buffered) return
      const event = this.buffered
      this.buffered = undefined
      this.metrics.flushes++
      this.emit(event)
      // Keep the continuous segment throttled after its trailing flush. A new
      // leading flush is only opened by a true boundary/type/session change.
      this.leadingEmitted = true
    }, this.delayMs)
  }

  private emit(event: StreamEvent) {
    if (isNonEmptyDelta(event)) this.metrics.emittedDeltas++
    this.options.onEvent(event)
  }
}

/** Small test/benchmark-friendly snapshot; no production logging. */
export function streamCoalescerMetrics(coalescer: StreamEventCoalescer): Readonly<StreamEventCoalescerMetrics> {
  return { ...coalescer.metrics }
}
