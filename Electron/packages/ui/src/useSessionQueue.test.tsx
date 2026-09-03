// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI, QueueEnqueueResult, QueuedMessage } from '@pipi/host-api'

import { useSessionQueue } from './useSessionQueue'

afterEach(cleanup)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function QueueHarness({ host }: { host: PipiHostAPI }) {
  const queue = useSessionQueue(host, 'session-a', false)
  return <>
    <output data-testid="busy">{queue.busy ? 'busy' : 'idle'}</output>
    <button onClick={() => queue.acceptStreamEvent({
      type: 'queue_update',
      sessionId: 'session-a',
      queue: [{
        id: 'old-sending',
        sessionId: 'session-a',
        text: '旧的发送中快照',
        attachments: [],
        createdAt: 1,
        state: 'sending',
      }],
    })}>stale sending</button>
    <button onClick={() => { void queue.resync() }}>resync</button>
  </>
}

describe('useSessionQueue authoritative resync ordering', () => {
  it('does not let an older sending snapshot overwrite a newer empty terminal snapshot', async () => {
    const older = deferred<QueuedMessage[]>()
    const newer = deferred<QueuedMessage[]>()
    const listQueue = vi.fn()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)
    const host = { listQueue } as unknown as PipiHostAPI

    render(<QueueHarness host={host} />)
    await waitFor(() => expect(listQueue).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'resync' }))
    fireEvent.click(screen.getByRole('button', { name: 'resync' }))
    expect(listQueue).toHaveBeenCalledTimes(3)

    await act(async () => { newer.resolve([]); await newer.promise })
    expect(screen.getByTestId('busy').textContent).toBe('idle')

    await act(async () => {
      older.resolve([{
        id: 'old-sending',
        sessionId: 'session-a',
        text: '旧的发送中快照',
        attachments: [],
        createdAt: 1,
        state: 'sending',
      }])
      await older.promise
    })
    expect(screen.getByTestId('busy').textContent).toBe('idle')
  })

  it('clears an ephemeral sending snapshot as soon as terminal resync begins', async () => {
    const terminalSnapshot = deferred<QueuedMessage[]>()
    const listQueue = vi.fn()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(terminalSnapshot.promise)
    const host = { listQueue } as unknown as PipiHostAPI

    render(<QueueHarness host={host} />)
    await waitFor(() => expect(listQueue).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'stale sending' }))
    expect(screen.getByTestId('busy').textContent).toBe('busy')

    fireEvent.click(screen.getByRole('button', { name: 'resync' }))
    expect(screen.getByTestId('busy').textContent).toBe('idle')

    await act(async () => { terminalSnapshot.resolve([]); await terminalSnapshot.promise })
    expect(screen.getByTestId('busy').textContent).toBe('idle')
  })
})

function queuedMessageFixture(id: string, text: string): QueuedMessage {
  return { id, sessionId: 'session-a', text, attachments: [], createdAt: 1, state: 'queued' }
}

function MutateHarness({ host }: { host: PipiHostAPI }) {
  const queue = useSessionQueue(host, 'session-a', false)
  return <>
    <output data-testid="pending">{queue.pending ? 'pending' : 'idle'}</output>
    <output data-testid="error">{queue.error ?? 'none'}</output>
    <button onClick={() => { void queue.enqueue('第一条').catch(() => undefined) }}>enqueue-one</button>
    <button onClick={() => { void queue.enqueue('第二条').catch(() => undefined) }}>enqueue-two</button>
  </>
}

describe('useSessionQueue serialized mutations', () => {
  it('serializes overlapping enqueues instead of silently dropping the second', async () => {
    const first = deferred<QueueEnqueueResult>()
    const listQueue = vi.fn().mockResolvedValue([])
    const enqueueMessage = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ outcome: 'queued' as const, message: queuedMessageFixture('second', '第二条') })
    const host = { listQueue, enqueueMessage } as unknown as PipiHostAPI

    render(<MutateHarness host={host} />)
    await waitFor(() => expect(listQueue).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'enqueue-one' }))
    await waitFor(() => expect(enqueueMessage).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'enqueue-two' }))
    // The second mutation waits for the first RPC instead of being rejected.
    expect(screen.getByTestId('pending').textContent).toBe('pending')
    expect(enqueueMessage).toHaveBeenCalledTimes(1)

    await act(async () => {
      first.resolve({ outcome: 'queued', message: queuedMessageFixture('first', '第一条') })
      await first.promise
    })
    await waitFor(() => expect(enqueueMessage).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('idle'))
    expect(screen.getByTestId('error').textContent).toBe('none')
  })

  it('surfaces a failed operation and keeps the mutation chain alive', async () => {
    const listQueue = vi.fn().mockResolvedValue([])
    const enqueueMessage = vi.fn()
      .mockRejectedValueOnce(new Error('host 拒绝了'))
      .mockResolvedValue({ outcome: 'queued' as const, message: queuedMessageFixture('second', '第二条') })
    const host = { listQueue, enqueueMessage } as unknown as PipiHostAPI

    render(<MutateHarness host={host} />)
    await waitFor(() => expect(listQueue).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'enqueue-one' }))
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('队列操作失败：host 拒绝了'))
    await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('idle'))

    fireEvent.click(screen.getByRole('button', { name: 'enqueue-two' }))
    await waitFor(() => expect(enqueueMessage).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('none'))
    expect(screen.getByTestId('pending').textContent).toBe('idle')
  })
})
