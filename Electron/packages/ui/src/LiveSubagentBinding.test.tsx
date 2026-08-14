// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentSummary, PipiHostAPI } from '@pipi/host-api'
import { AssistantTranscriptContent } from './AssistantTranscriptContent'
import { LiveSubagentBindingProvider, useLiveSubagentBindings } from './LiveSubagentBinding'
import type { TranscriptTool } from './transcript-model'

afterEach(cleanup)

function BindingProbe() {
  const projection = useLiveSubagentBindings([{ id: 'call-1' }]).get('call-1')!
  return <output data-testid="binding-state">{projection.runningCount}/{projection.completedCount}/{projection.failedCount}</output>
}

describe('live subagent binding', () => {
  it('keeps a completed boss tool_result visually live through terminal child transition', async () => {
    const root: AgentSummary = { agentId: 'root', runId: 'r1', name: 'explorer', task: 'inspect', sessionId: 'A', toolCallId: 'call-1', state: 'running' }
    let listener: ((event: AgentEvent) => void) | undefined
    const host = { listAgents: vi.fn(async () => [root]), subscribeAgents: vi.fn((next: (event: AgentEvent) => void) => { listener = next; return () => undefined }) } as unknown as PipiHostAPI
    const tool: TranscriptTool = { id: 'call-1', name: 'subagent', input: '{}', result: 'Started background agent(s) (1).\n- agentId=root', startedAt: 1, finishedAt: 2, finished: true, dispatched: true }
    render(<LiveSubagentBindingProvider host={host} sessionId="A"><AssistantTranscriptContent message={{ content: '', tools: [tool] }} /></LiveSubagentBindingProvider>)
    expect((await screen.findByTestId('subagent-tool-card')).textContent).toContain('运行 1')
    act(() => listener?.({ type: 'agent', agent: { ...root, state: 'ok', turns: 3 } }))
    await screen.findByRole('button', { name: /1 个步骤/ })
    act(() => screen.getByRole('button', { name: /1 个步骤/ }).click())
    expect((await screen.findByTestId('subagent-tool-card')).textContent).toContain('运行 0')
    expect(screen.getByTestId('subagent-tool-card').textContent).toContain('3 turns')
  })

  it('does not let a delayed running snapshot downgrade a newer terminal event', async () => {
    const running: AgentSummary = { agentId: 'root', runId: 'r1', name: 'explorer', task: 'inspect', sessionId: 'A', toolCallId: 'call-1', state: 'running' }
    let listener: ((event: AgentEvent) => void) | undefined
    let resolveSnapshot!: (value: AgentSummary[]) => void
    const host = {
      listAgents: vi.fn(() => new Promise<AgentSummary[]>(resolve => { resolveSnapshot = resolve })),
      subscribeAgents: vi.fn((next: (event: AgentEvent) => void) => { listener = next; return () => undefined }),
    } as unknown as PipiHostAPI

    render(<LiveSubagentBindingProvider host={host} sessionId="A"><BindingProbe /></LiveSubagentBindingProvider>)
    act(() => listener?.({ type: 'agent', agent: { ...running, state: 'ok', updatedAt: 20 } }))
    expect(screen.getByTestId('binding-state').textContent).toBe('0/1/0')

    await act(async () => resolveSnapshot([{ ...running, updatedAt: 10 }]))
    await waitFor(() => expect(screen.getByTestId('binding-state').textContent).toBe('0/1/0'))
  })

  it('keeps event-fed state when the initial list request fails', async () => {
    const running: AgentSummary = { agentId: 'root', runId: 'r1', name: 'explorer', task: 'inspect', sessionId: 'A', toolCallId: 'call-1', state: 'running' }
    let listener: ((event: AgentEvent) => void) | undefined
    let rejectSnapshot!: (reason: Error) => void
    const host = {
      listAgents: vi.fn(() => new Promise<AgentSummary[]>((_resolve, reject) => { rejectSnapshot = reject })),
      subscribeAgents: vi.fn((next: (event: AgentEvent) => void) => { listener = next; return () => undefined }),
    } as unknown as PipiHostAPI

    render(<LiveSubagentBindingProvider host={host} sessionId="A"><BindingProbe /></LiveSubagentBindingProvider>)
    act(() => listener?.({ type: 'agent', agent: running }))
    expect(screen.getByTestId('binding-state').textContent).toBe('1/0/0')

    await act(async () => rejectSnapshot(new Error('list unavailable')))
    await waitFor(() => expect(screen.getByTestId('binding-state').textContent).toBe('1/0/0'))
  })
})
