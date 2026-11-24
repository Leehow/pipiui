// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI } from '@pipi/host-api'
import { BashDetailsProvider, BashToolDetails } from './BashToolDetails'
import { ActivityCard } from './ActivityCard'

afterEach(() => { cleanup(); vi.useRealTimers() })
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(210) }) }
function fixture(getBashDetails: ReturnType<typeof vi.fn>) {
  const host = { getBashDetails } as unknown as PipiHostAPI
  return render(<BashDetailsProvider host={host} sessionId="s"><ActivityCard kind="tool" summary="bash test"><BashToolDetails toolCallId="call" /></ActivityCard></BashDetailsProvider>)
}

describe('lazy bash details', () => {
  it('scopes worker details to the exact run and tool, and disables ambiguous history', async () => {
    vi.useFakeTimers()
    const read = vi.fn().mockResolvedValue({ state: 'completed', output: 'worker output' })
    const host = { getBashDetails: read } as unknown as PipiHostAPI
    const content = (runId: string, enabled = true) => <BashDetailsProvider host={host} sessionId="s" agentId="worker" runId={runId} enabled={enabled}><BashToolDetails toolCallId="same-call" /></BashDetailsProvider>
    const view = render(content('run-a'))
    await tick()
    expect(read.mock.calls[0][0]).toMatchObject({ sessionId: 's', agentId: 'worker', runId: 'run-a', toolCallId: 'same-call' })
    view.rerender(content('run-b'))
    await tick()
    expect(read.mock.calls[1][0].runId).toBe('run-b')
    view.rerender(content('run-b', false))
    await tick()
    expect(read).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/缺少精确运行归属/)).toBeTruthy()
  })
  it('releases the scheduler slot when an old view closes before its request finishes', async () => {
    vi.useFakeTimers()
    let finish!: (value: unknown) => void
    const read = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValue({ state: 'completed', output: 'new session' })
    const view = fixture(read)
    fireEvent.click(screen.getByRole('button', { name: /bash test/ }))
    await act(async () => { vi.advanceTimersByTime(210); await Promise.resolve() })
    view.unmount()
    fixture(read)
    fireEvent.click(screen.getByRole('button', { name: /bash test/ }))
    await tick()
    expect(screen.getByText('new session')).toBeTruthy()
    await act(async () => { finish({ state: 'running', output: 'stale' }) })
    expect(screen.queryByText('stale')).toBeNull()
  });
  it('falls back only when the old backend explicitly lacks the method', async () => {
    vi.useFakeTimers()
    const host = { getBashDetails: vi.fn().mockRejectedValue(new Error('Unknown method getBashDetails')) } as unknown as PipiHostAPI
    render(<BashDetailsProvider host={host} sessionId="old"><BashToolDetails toolCallId="c" fallbackInput="old input" fallbackOutput="old output" /></BashDetailsProvider>)
    await tick()
    expect(screen.getByText('old output')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  });
  it('does not request while closed, fetches while open and stops on close', async () => {
    vi.useFakeTimers()
    const read = vi.fn().mockResolvedValue({ state: 'running', revision: 1, input: 'test', output: 'first' })
    fixture(read)
    await tick()
    expect(read).not.toHaveBeenCalled()
    expect(screen.queryByTestId('bash-tool-details')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /bash test/ }))
    await tick()
    expect(read).toHaveBeenCalledTimes(1)
    expect(screen.getByText('first')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /bash test/ }))
    await tick()
    expect(read).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /bash test/ }))
    await tick()
    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls[1][0].sinceRevision).toBeUndefined()
  })
  it('stops after a terminal response and dismisses errors', async () => {
    vi.useFakeTimers()
    const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ state: 'completed', output: 'done' })
    fixture(read)
    fireEvent.click(screen.getByRole('button', { name: /bash test/ }))
    await tick()
    expect(screen.getByRole('alert').textContent).toContain('offline')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await tick()
    await tick()
    expect(read).toHaveBeenCalledTimes(2)
    expect(screen.getByText('done')).toBeTruthy()
  })
  it('ignores a reply arriving after unmount', async () => {
    vi.useFakeTimers()
    let resolve!: (value: unknown) => void
    const read = vi.fn().mockImplementation(() => new Promise(r => { resolve = r }))
    fixture(read)
    fireEvent.click(screen.getByRole('button', { name: /bash test/ }))
    await act(async () => { vi.advanceTimersByTime(210) })
    fireEvent.click(screen.getByRole('button', { name: /bash test/ }))
    await act(async () => { resolve({ state: 'running', output: 'late' }) })
    expect(screen.queryByText('late')).toBeNull()
    expect(screen.queryByTestId('bash-tool-details')).toBeNull()
  })
})
