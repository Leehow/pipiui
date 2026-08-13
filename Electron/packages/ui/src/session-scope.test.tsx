// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentSummary, PipiHostAPI, TerminalSession } from '@pipi/host-api'
// xterm needs a real layout engine; jsdom has none, so the panel logic is tested without it.
vi.mock('@xterm/xterm', () => ({ Terminal: class { buffer = { active: { viewportY: 0, baseY: 0 } }; options = {}; open = vi.fn(); write = vi.fn(); clear = vi.fn(); focus = vi.fn(); scrollToBottom = vi.fn(); dispose = vi.fn(); loadAddon = vi.fn(); onData() { return { dispose: vi.fn() } } onScroll() { return { dispose: vi.fn() } } } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

import { SubagentPanel } from './SubagentPanel'
import { DocumentPanel } from './DocumentPanel'
import { TerminalPanel } from './TerminalPanel'

afterEach(cleanup)

function agent(agentId: string, sessionId: string): AgentSummary {
  return { agentId, runId: `${agentId}-run`, name: 'general-purpose', task: `task ${agentId}`, state: 'running', sessionId, depth: 1, createdAt: Date.now() }
}

describe('right panel session scoping', () => {
  it('asks the host for one session and ignores another session\'s agents', async () => {
    let push: ((event: AgentEvent) => void) | undefined
    const listAgents = vi.fn(async (sessionId?: string) => [agent('mine', sessionId ?? 'unknown')])
    const host = { listAgents, subscribeAgents: (listener: (event: AgentEvent) => void) => { push = listener; return () => undefined }, subscribeAgentLog: () => () => undefined, abortAgent: vi.fn(), resolveAgent: vi.fn(), checkAgent: vi.fn(), getWorktreeStatus: vi.fn() } as unknown as PipiHostAPI

    render(<SubagentPanel host={host} sessionId="session-a" />)
    await screen.findByTestId('agent-row-mine')
    expect(listAgents).toHaveBeenCalledWith('session-a')

    push?.({ type: 'agent', agent: agent('theirs', 'session-b') })
    push?.({ type: 'agent', agent: agent('also-mine', 'session-a') })
    await screen.findByTestId('agent-row-also-mine')
    expect(screen.queryByTestId('agent-row-theirs')).toBeNull()
  })

  it('drops log and worktree events addressed to an agent it does not own', async () => {
    let push: ((event: AgentEvent) => void) | undefined
    const host = { listAgents: async () => [agent('mine', 'session-a')], subscribeAgents: (listener: (event: AgentEvent) => void) => { push = listener; return () => undefined }, subscribeAgentLog: () => () => undefined, abortAgent: vi.fn(), resolveAgent: vi.fn(), checkAgent: vi.fn(), getWorktreeStatus: vi.fn() } as unknown as PipiHostAPI
    render(<SubagentPanel host={host} sessionId="session-a" />)
    await screen.findByTestId('agent-row-mine')
    // Neither event names an agent in this tree, so neither may create or mutate a row.
    push?.({ type: 'worktree', status: { agentId: 'theirs', lifecycle: 'active', merge: 'unavailable', discard: 'unavailable' } })
    push?.({ type: 'agent_log', agentId: 'theirs', itemType: 'text', text: 'leaked' })
    await waitFor(() => expect(screen.queryByText('leaked')).toBeNull())
    expect(screen.queryByTestId('agent-row-theirs')).toBeNull()
  })

  it('reloads the agent tree when the session changes', async () => {
    const listAgents = vi.fn(async (sessionId?: string) => [agent(`agent-${sessionId}`, sessionId ?? '')])
    const host = { listAgents, subscribeAgents: () => () => undefined, subscribeAgentLog: () => () => undefined, abortAgent: vi.fn(), resolveAgent: vi.fn(), checkAgent: vi.fn(), getWorktreeStatus: vi.fn() } as unknown as PipiHostAPI
    const { rerender } = render(<SubagentPanel host={host} sessionId="session-a" />)
    await screen.findByTestId('agent-row-agent-session-a')
    rerender(<SubagentPanel host={host} sessionId="session-b" />)
    await screen.findByTestId('agent-row-agent-session-b')
    expect(screen.queryByTestId('agent-row-agent-session-a')).toBeNull()
  })

  it('reads only the explicitly opened document path and reloads when that path changes', async () => {
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: path.split('/').at(-1)!, path, kind: 'markdown' as const, content: `# ${path}` }))
    const host = { readDocument } as unknown as PipiHostAPI
    const { rerender } = render(<DocumentPanel host={host} />)
    expect(readDocument).not.toHaveBeenCalled()
    rerender(<DocumentPanel host={host} documentPath="/project-a/a.md" />)
    await waitFor(() => expect(readDocument).toHaveBeenCalledWith('/project-a/a.md'))
    rerender(<DocumentPanel host={host} documentPath="/project-b/b.md" />)
    await waitFor(() => expect(readDocument).toHaveBeenCalledWith('/project-b/b.md'))
    expect(readDocument).toHaveBeenCalledTimes(2)
  })

  it('gives each session its own terminal and keeps the other one alive', async () => {
    let sequence = 0
    const open = vi.fn(async (): Promise<TerminalSession> => ({ id: `terminal-${++sequence}`, title: `终端 ${sequence}`, cwd: '/tmp' }))
    const host = { terminal: { open, write: vi.fn(), clear: vi.fn(), close: vi.fn(), subscribe: () => () => undefined } } as unknown as PipiHostAPI

    const { rerender } = render(<TerminalPanel host={host} theme="light" sessionId="session-a" projectId="p" projectPath="/tmp" />)
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    rerender(<TerminalPanel host={host} theme="light" sessionId="session-b" projectId="p" projectPath="/tmp" />)
    // A second session must get its own shell rather than inherit the first session's.
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2))
    rerender(<TerminalPanel host={host} theme="light" sessionId="session-a" projectId="p" projectPath="/tmp" />)
    // Coming back reuses the live terminal: no third open, and it was never closed.
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2))
    expect(host.terminal!.close).not.toHaveBeenCalled()
  })
})
