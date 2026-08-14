import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AgentSummary, PipiHostAPI } from '@pipi/host-api'
import { projectLiveSubagents, type LiveSubagentProjection } from './live-subagent-projection'
import type { TranscriptTool } from './transcript-model'

type BindingValue = { sessionId: string; agents: readonly AgentSummary[] }
const LiveSubagentContext = createContext<BindingValue>({ sessionId: '', agents: [] })

function mergeAgent(current: AgentSummary[], incoming: AgentSummary): AgentSummary[] {
  const index = current.findIndex(agent => agent.sessionId === incoming.sessionId && agent.agentId === incoming.agentId)
  return index < 0 ? [...current, incoming] : current.map((agent, candidate) => candidate === index ? incoming : agent)
}

const terminal = (agent: AgentSummary) => agent.state !== 'running' && agent.state !== 'stalled'

function mergeSnapshotWithObserved(snapshot: AgentSummary[], observed: readonly AgentSummary[]): AgentSummary[] {
  return observed.reduce((items, incoming) => {
    const index = items.findIndex(agent => agent.sessionId === incoming.sessionId && agent.agentId === incoming.agentId)
    if (index < 0) return [...items, incoming]
    const listed = items[index]
    const listedAt = listed.updatedAt ?? listed.createdAt
    const incomingAt = incoming.updatedAt ?? incoming.createdAt
    const preferred = listed.runId === incoming.runId && terminal(listed) !== terminal(incoming)
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
