// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI, QueuedMessage } from '@pipi/host-api'

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
