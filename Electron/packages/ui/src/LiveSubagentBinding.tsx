import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AgentSummary, PipiHostAPI } from '@pipi/host-api'
import { projectLiveSubagents, type LiveSubagentProjection } from './live-subagent-projection'
import type { TranscriptTool } from './transcript-model'

type BindingValue = { sessionId: string; agents: readonly AgentSummary[] }
const LiveSubagentContext = createContext<BindingValue>({ sessionId: '', agents: [] })

const terminal = (agent: AgentSummary) => agent.state !== 'running' && agent.state !== 'stalled'

/** Episode identity: {sessionId, agentId, runId}. Two runs of one agentId are
 *  siblings, never overwrites — a late event from a retired run must not
 *  repaint the current run's row (and vice versa). */
const sameEpisode = (agent: AgentSummary, incoming: AgentSummary) =>
  agent.sessionId === incoming.sessionId && agent.agentId === incoming.agentId && agent.runId === incoming.runId

function mergeAgent(current: AgentSummary[], incoming: AgentSummary): AgentSummary[] {
  const index = current.findIndex(agent => sameEpisode(agent, incoming))
  if (index < 0) return [...current, incoming]
  const previous = current[index]
  // Within ONE episode a reached terminal verdict must not be reopened by a
  // late running/stalled event for that same run (see SubagentPanel's
  // agentEventSupersedes). Cross-run events never reach this branch.
  if (terminal(previous) && !terminal(incoming)) return current
  return current.map((agent, candidate) => candidate === index ? incoming : agent)
}

function mergeSnapshotWithObserved(snapshot: AgentSummary[], observed: readonly AgentSummary[]): AgentSummary[] {
  return observed.reduce((items, incoming) => {
    const index = items.findIndex(agent => sameEpisode(agent, incoming))
    if (index < 0) return [...items, incoming]
    const listed = items[index]
    const listedAt = listed.updatedAt ?? listed.createdAt
    const incomingAt = incoming.updatedAt ?? incoming.createdAt
    // Same episode: a terminal verdict survives a stale non-terminal row in
    // either direction; otherwise the newer observation wins, ties to the incoming.
    const preferred = terminal(listed) !== terminal(incoming)
      ? terminal(incoming) ? incoming : listed
      : listedAt !== undefined && incomingAt !== undefined && listedAt !== incomingAt
        ? incomingAt > listedAt ? incoming : listed
        : incoming
    return items.map((agent, candidate) => candidate === index ? preferred : agent)
  }, snapshot)
}

export function LiveSubagentBindingProvider({ host, sessionId, children }: { host: PipiHostAPI; sessionId: string; children: ReactNode }) {
  const [agents, setAgents] = useState<AgentSummary[]>([])
  useEffect(() => {
    let active = true
    setAgents([])
    if (!sessionId) return () => { active = false }
    const unsubscribe = host.subscribeAgents(event => {
      if (!active || event.type !== 'agent' || event.agent.sessionId !== sessionId) return
      setAgents(current => mergeAgent(current, event.agent))
    })
    void host.listAgents(sessionId).then(snapshot => {
      if (active) setAgents(current => mergeSnapshotWithObserved(
        snapshot.filter(agent => agent.sessionId === sessionId),
        current.filter(agent => agent.sessionId === sessionId),
      ))
    }).catch(() => undefined)
    return () => { active = false; unsubscribe() }
  }, [host, sessionId])
  const value = useMemo(() => ({ sessionId, agents }), [agents, sessionId])
  return <LiveSubagentContext.Provider value={value}>{children}</LiveSubagentContext.Provider>
}

export function useLiveSubagentBindings(tools: readonly Pick<TranscriptTool, 'id' | 'result'>[]): ReadonlyMap<string, LiveSubagentProjection> {
  const binding = useContext(LiveSubagentContext)
  return useMemo(() => new Map(tools.map(tool => [tool.id, projectLiveSubagents(tool, binding.sessionId, binding.agents)])), [binding, tools])
}
