import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createIpcHost, createWsHost, resolveThinkingLevel, thinkingLevelsForModel, type HostBackend, type HostWireFrame, type IpcRendererLike, type PipiHostAPI, type SidebarSessionPreferences } from '../src/index.js'
import { registerPipiHostIpc } from '../../../apps/electron/src/main/index.js'
import { createWsHostServer } from '../../../apps/server/src/index.js'

type Factory = () => Promise<{ host: PipiHostAPI; close(): Promise<void> }>

describe('thinking capability tri-state helper', () => {
  const unknown = { provider: 'unknown', id: 'unknown', name: 'Unknown' }

  it('uses the standard fallback only for unknown capability metadata', () => {
    expect(thinkingLevelsForModel(unknown)).toEqual(['off', 'minimal', 'low', 'medium', 'high'])
    expect(thinkingLevelsForModel({ ...unknown, reasoning: false })).toEqual([])
    expect(thinkingLevelsForModel({ ...unknown, thinkingConfigurable: false })).toEqual([])
    expect(thinkingLevelsForModel(unknown, ['off', 'high', 'xhigh'])).toEqual(['off', 'high', 'xhigh'])
  })

  it('exposes only string-mapped levels from a sparse openai-codex thinkingLevelMap', () => {
    const sparse = {
      ...unknown,
      provider: 'openai-codex',
      id: 'gpt-5.6-luna',
      name: 'GPT-5.6 Luna',
      reasoning: true,
      thinkingLevelMap: { minimal: 'low', xhigh: 'xhigh', max: 'max' },
    }
    expect(thinkingLevelsForModel(sparse)).toEqual(['off', 'minimal', 'xhigh', 'max'])
    expect(thinkingLevelsForModel(sparse)).not.toContain('high')
    expect(thinkingLevelsForModel(sparse)).not.toContain('medium')
  })

  it('hides an explicit null map value, including off', () => {
    expect(thinkingLevelsForModel({
      ...unknown,
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: 'low', high: null, xhigh: 'xhigh' },
    })).toEqual(['minimal', 'xhigh'])
  })

  it('clamps a stale high onto an allowed sparse-map level', () => {
    const available = thinkingLevelsForModel({
      ...unknown,
      reasoning: true,
      thinkingLevelMap: { minimal: 'low', xhigh: 'xhigh', max: 'max' },
    })
    expect(resolveThinkingLevel('high', available, 'high')).toBe('off')
    expect(resolveThinkingLevel('high', available, 'xhigh')).toBe('xhigh')
    expect(resolveThinkingLevel('minimal', available, 'off')).toBe('minimal')
    expect(resolveThinkingLevel('high', [])).toBeUndefined()
  })
})

/** Transport fixture only; production server defaults to PiHostBackend. */
function createContractMockBackend(): HostBackend {
  const listeners = new Set<(event: any) => void>()
  const emit = (channel: string, event: any) => listeners.forEach(listener => listener({ protocolVersion: 2, channel, event }))
  const project = { id: 'project-1', name: 'PipiUI', path: '/tmp/pipiui' }
  let projectPaths = [project.path]
  const projectNames = new Map<string, string>([[project.path, project.name]])
  const projectFor = (path: string) => {
    const id = path === project.path ? project.id : `project-${Buffer.from(path).toString('base64url')}`
    return { id, name: projectNames.get(path) ?? path.split('/').filter(Boolean).at(-1) ?? path, path }
  }
  let sequence = 1
  let sessions: any[] = [{ id: 'session-1', projectId: project.id, name: 'Welcome', updatedAt: 1 }]
  const history = new Map<string, any[]>([['session-1', []]])
  const queues = new Map<string, any[]>()
  const activeSessions = new Set<string>()
  const queueFor = (sessionId: string) => queues.get(sessionId) ?? (queues.set(sessionId, []), queues.get(sessionId)!)
  const emitQueue = (sessionId: string) => emit('stream', { type: 'queue_update', sessionId, queue: queueFor(sessionId).map(item => structuredClone(item)) })
  const queueItem = (sessionId: string, text: string, attachments: any[] = [], state: 'queued' | 'failed' = 'queued', error?: string) => ({ id: `queue-${++sequence}`, sessionId, text, attachments: structuredClone(attachments), createdAt: Date.now(), state, error })
  let state: any = { model: { provider: 'mock', id: 'model-1', name: 'Mock Model', reasoning: true }, thinkingLevel: 'medium', availableThinkingLevels: ['off', 'low', 'medium', 'high'] }
  let hiddenModelIds: string[] = []
  let visionModel: string | null = null
  let sidebarSessionPreferences: SidebarSessionPreferences = { pinnedSessionIds: [], archivedSessionIds: [], orderedSessionIds: [] }
  const loginOwners = new Map<string, string>()
  // session-1 carries full usage; sessions created by newSession have no usage data yet.
  const fullStats = (sessionId: string) => ({ sessionId, tokens: { input: 100, output: 50, cacheRead: 200, cacheWrite: 10, total: 360 }, cost: 0.0123, contextUsage: { tokens: 9000, contextWindow: 262144, percent: 3.4 }, model: { provider: 'mock', id: 'model-1', name: 'Mock Model' } })
  const agent: any = { agentId: 'agent-1', runId: 'run-1', name: 'builder', role: 'general-purpose', title: 'Mock build', task: 'Mock task', state: 'running', depth: 1, createdAt: 1, cost: 0, turns: 1, outputCount: 0 }
  const agentLogs: any[] = []
  let worktree: any = { agentId: agent.agentId, branch: 'pipiui/mock', path: '/tmp/pipiui-mock', lifecycle: 'pendingReview', merge: 'ready', discard: 'ready' }
  const terminals = new Map<string, { cwd: string; input: string }>()
  const requireSession = (id: string) => { if (!history.has(id)) throw new Error(`unknown session ${id}`) }

  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async handle(method, params) {
      switch (method) {
        case 'listProjects': return projectPaths.map(projectFor)
        case 'getProjectPaths': return [...projectPaths]
        case 'setProjectPaths': {
          const paths = params[0]
          if (!Array.isArray(paths) || !paths.every(path => typeof path === 'string' && path.length > 0)) throw new Error('projectPaths must be non-empty string[]')
          projectPaths = [...new Set(paths)]
          return [...projectPaths]
        }
        case 'addProject': {
          const path = params[0]
          if (typeof path !== 'string' || !path.length) throw new Error('project path must be non-empty string')
          if (!projectPaths.includes(path)) projectPaths.push(path)
          return projectFor(path)
        }
        case 'removeProject': {
          const id = params[0] as string
          const path = projectPaths.find(item => projectFor(item).id === id)
          if (!path) throw new Error(`unknown project ${id}`)
          projectPaths = projectPaths.filter(item => item !== path)
          return
        }
        case 'renameProject': {
          const [id, name] = params as [string, string]
          const path = projectPaths.find(item => projectFor(item).id === id)
          if (!path) throw new Error(`unknown project ${id}`)
          if (typeof name !== 'string' || !name.trim()) throw new Error('project name must be a non-empty string')
          projectNames.set(path, name.trim())
          return projectFor(path)
        }
        case 'revealProject': {
          const id = params[0] as string
          if (!projectPaths.some(item => projectFor(item).id === id)) throw new Error(`unknown project ${id}`)
          return
        }
        case 'listSessions': return sessions.filter(session => session.projectId === params[0])
        case 'newSession': {
          const session = { id: `session-${++sequence}`, projectId: params[0], name: params[1] ?? 'New session', updatedAt: Date.now() }
          sessions.push(session); history.set(session.id, []); queues.set(session.id, []); return session
        }
        case 'resumeSession': { const session = sessions.find(item => item.id === params[0]); if (!session) throw new Error('unknown session'); return session }
        case 'renameSession': { const session = sessions.find(item => item.id === params[0]); if (!session) throw new Error('unknown session'); session.name = params[1] as string; session.updatedAt = Date.now(); return { ...session } }
        case 'deleteSession': sessions = sessions.filter(item => item.id !== params[0]); history.delete(params[0] as string); queues.delete(params[0] as string); activeSessions.delete(params[0] as string); return
        case 'moveSession': { const session = sessions.find(item => item.id === params[0]); if (!session) throw new Error('unknown session'); session.projectId = params[1] as string; return { ...session } }
        case 'getSessionHistory': requireSession(params[0] as string); return history.get(params[0] as string)
        case 'getSessionLease': return { sessionId: params[0], writable: true }
        case 'forceTakeoverSessionLease': return { sessionId: params[0], writable: true }
        case 'sendPrompt': {
          const [sessionId, prompt] = params as [string, string]; requireSession(sessionId)
          emit('stream', { type: 'status', sessionId, status: 'started' })
          const log = { type: 'agent_log', sessionId, agentId: agent.agentId, runId: agent.runId, itemType: 'text', text: `Prompt received: ${prompt}` }
          agentLogs.push(log)
          emit('agents', log)
          emit('stream', { type: 'thinking', sessionId, contentIndex: 0, delta: 'thinking' })
          emit('stream', { type: 'text', sessionId, contentIndex: 0, delta: `Echo: ${prompt}` })
          emit('stream', { type: 'tool_call', sessionId, contentIndex: 1, toolCallId: 'tool-1', name: 'mock' })
          emit('stream', { type: 'tool_result', sessionId, toolCallId: 'tool-1', content: 'ok' })
          emit('stream', { type: 'status', sessionId, status: 'settled' }); emit('session_stats', { type: 'snapshot', sessionId, stats: fullStats(sessionId) }); return
        }
        case 'listQueue': { const sessionId = params[0] as string; requireSession(sessionId); return queueFor(sessionId).map(item => structuredClone(item)) }
        case 'enqueueMessage': {
          const [sessionId, text, attachments = []] = params as [string, string, any[]?]; requireSession(sessionId)
          if (text === '__queue_fail__') { const failed = queueItem(sessionId, text, attachments, 'failed', 'mock queue failure'); queueFor(sessionId).push(failed); emitQueue(sessionId); return { outcome: 'queued', message: structuredClone(failed) } }
          const item = queueItem(sessionId, text, attachments)
          if (activeSessions.has(sessionId)) { queueFor(sessionId).push(item); emitQueue(sessionId); return { outcome: 'queued', message: structuredClone(item) } }
          activeSessions.add(sessionId); emit('stream', { type: 'status', sessionId, status: 'started' })
          if (text !== '__hold__') { activeSessions.delete(sessionId); emit('stream', { type: 'status', sessionId, status: 'settled' }) }
          return { outcome: 'direct', message: { ...item, state: 'sending' } }
        }
        case 'updateQueuedMessage': { const [sessionId, id, text, attachments] = params as [string, string, string, any[]?]; requireSession(sessionId); const item = queueFor(sessionId).find(entry => entry.id === id); if (!item || item.state === 'sending') throw new Error('unknown or sending queue item'); item.text = text; if (attachments !== undefined) item.attachments = structuredClone(attachments); emitQueue(sessionId); return structuredClone(item) }
        case 'removeQueuedMessage': { const [sessionId, id] = params as [string, string]; requireSession(sessionId); const items = queueFor(sessionId); const index = items.findIndex(item => item.id === id && item.state !== 'sending'); if (index < 0) throw new Error('unknown or sending queue item'); const [removed] = items.splice(index, 1); emitQueue(sessionId); return structuredClone(removed) }
        case 'promoteQueuedMessage': { const [sessionId, id] = params as [string, string]; requireSession(sessionId); const items = queueFor(sessionId); const index = items.findIndex(item => item.id === id && item.state !== 'sending'); if (index < 0) throw new Error('unknown or sending queue item'); const [item] = items.splice(index, 1); items.unshift(item); emitQueue(sessionId); return structuredClone(item) }
        case 'steerQueuedMessage': { const [sessionId, id] = params as [string, string]; requireSession(sessionId); if (!activeSessions.has(sessionId)) throw new Error('session is idle'); const items = queueFor(sessionId); const index = items.findIndex(item => item.id === id && item.state !== 'sending'); if (index < 0) throw new Error('unknown or sending queue item'); const [item] = items.splice(index, 1); emitQueue(sessionId); return structuredClone({ ...item, state: 'sending' }) }
        case 'retryQueuedMessage': { const [sessionId, id] = params as [string, string]; requireSession(sessionId); const items = queueFor(sessionId); const index = items.findIndex(item => item.id === id && item.state === 'failed'); if (index < 0) throw new Error('unknown or non-failed queue item'); const [item] = items.splice(index, 1); item.state = 'queued'; item.error = undefined; items.unshift(item); emitQueue(sessionId); return structuredClone(item) }
        case 'stop': { const sessionId = params[0] as string; activeSessions.delete(sessionId); emit('stream', { type: 'status', sessionId, status: 'stopped' }); return }
        case 'queueFollowUp': emit('stream', { type: 'status', sessionId: params[0], status: 'streaming', pendingFollowUps: [params[1]] }); return
        case 'listModels': return [state.model]
        case 'getModelState': return state
        case 'setModel': state = { ...state, model: { provider: params[1], id: params[2], name: params[2], reasoning: true } }; return state
        case 'setThinkingLevel': state = { ...state, thinkingLevel: params[1] }; return state
        case 'getHiddenModelIds': return [...hiddenModelIds]
        case 'setHiddenModelIds': {
          const ids = params[0]
          if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) throw new Error('hiddenModelIds must be string[]')
          hiddenModelIds = [...new Set(ids)].sort()
          return [...hiddenModelIds]
        }
        case 'getVisionModel': return visionModel
        case 'setVisionModel': {
          const ref = params[0] ?? null
          if (ref !== null && (typeof ref !== 'string' || !ref.includes('/'))) throw new Error('visionModel must be "provider/id" string or null')
          visionModel = ref
          return visionModel
        }
        case 'getSidebarSessionPreferences': return structuredClone(sidebarSessionPreferences)
        case 'setSidebarSessionPreferences': {
          const value = params[0] as typeof sidebarSessionPreferences
          const archived = new Set(value.archivedSessionIds)
          sidebarSessionPreferences = { pinnedSessionIds: [...new Set(value.pinnedSessionIds)].filter(id => !archived.has(id)), archivedSessionIds: [...archived], orderedSessionIds: [...new Set(value.orderedSessionIds)], ...(value.sessionOrderVersion === 2 ? { sessionOrderVersion: 2 as const } : {}) }
          return structuredClone(sidebarSessionPreferences)
        }
        case 'authProviders': return [{ id: 'mock-provider', name: 'Mock Provider', authTypes: ['api_key'], authenticated: true, authType: 'api_key' }]
        case 'beginProviderLogin': { loginOwners.set(`login-${params[0]}`, params[0] as string); return { loginId: `login-${params[0]}` } }
        case 'continueProviderLogin': {
          // api-key flow: first continue prompts, second (with input) completes. The key never echoes.
          const input = params[1] as string | undefined
          if (input === undefined) return { kind: 'prompt', promptType: 'secret', message: '输入 Mock Provider API Key' }
          return { kind: 'completed', providerId: loginOwners.get(params[0] as string) ?? params[0] }
        }
        case 'cancelProviderLogin': return
        case 'removeProviderCredentials': state = { ...state, model: { provider: 'unknown', id: 'unknown', name: '无可用模型', reasoning: false } }; return state
        case 'getSessionStats': {
          const sessionId = (params[0] as string | undefined) ?? 'session-1'; requireSession(sessionId)
          return sessionId === 'session-1' ? fullStats(sessionId) : { sessionId, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 }
        }
        case 'getQuotaSnapshot': return state.model.provider === 'mock'
          ? { provider: 'codex', accountLabel: 'Codex 账号额度', windows: [{ id: 'window0', usedPercent: 4, resetsAt: 1786400000000, label: '5h', title: '5h额度' }, { id: 'window1', usedPercent: 41, resetsAt: 1786900000000, label: '周', title: '周额度' }] }
          : state.model.provider === 'deepseek'
            ? { provider: 'deepseek', accountLabel: '账户余额', balance: { amount: 88, currency: 'CNY' }, windows: [] }
            : null
        case 'listAgents': return [agent]
        case 'getAgentLogs': {
          const [agentId, sessionId, runId] = params as [string, string, string]
          return agentLogs
            .filter(log => log.agentId === agentId && log.sessionId === sessionId && log.runId === runId)
            .map(({ type: _type, sessionId: _sessionId, agentId: _agentId, runId: _runId, ...entry }) => entry)
        }
        case 'abortAgent': agent.state = 'aborted'; emit('agents', { type: 'agent', agent: { ...agent } }); return
        case 'resolveAgent': agent.state = 'ok'; emit('agents', { type: 'agent', agent: { ...agent } }); return
        case 'checkAgent': return agent
        case 'getWorktreeStatus': return worktree
        case 'mergeWorktree': worktree = { ...worktree, lifecycle: 'merged', merge: 'merged', discard: 'unavailable' }; emit('agents', { type: 'worktree', status: worktree }); return worktree
        case 'discardWorktree': worktree = { ...worktree, lifecycle: 'discarded', merge: 'unavailable', discard: 'discarded' }; emit('agents', { type: 'worktree', status: worktree }); return worktree
        case 'terminalOpen': {
          const options = (params[0] ?? {}) as { cwd?: string }; const id = `terminal-${++sequence}`; const cwd = options.cwd ?? project.path
          terminals.set(id, { cwd, input: '' }); return { id, title: '终端', cwd, initialOutput: `pipiui_e mock terminal\r\n${cwd}\r\n$ ` }
        }
        case 'terminalWrite': {
          const [id, raw] = params as [string, string]; const current = terminals.get(id); if (!current) throw new Error(`unknown terminal ${id}`)
          for (const character of raw.replace(/\r\n/g, '\r')) {
            if (character === '\r' || character === '\n') { const command = current.input.trim(); current.input = ''; emit('terminal', { type: 'output', terminalId: id, data: `\r\n${command ? `mock: received ${command}\r\n` : ''}$ ` }) }
            else { current.input += character; emit('terminal', { type: 'output', terminalId: id, data: character }) }
          }
          return
        }
        case 'terminalClear': { const current = terminals.get(params[0] as string); if (current) current.input = ''; return }
        case 'terminalClose': terminals.delete(params[0] as string); return
        case 'capabilities': return { computerUse: true, revealInFinder: true, terminal: true }
        default: throw new Error(`unsupported method ${method}`)
      }
    },
  }
}

function contract(name: string, factory: Factory, expectedCapabilities: Record<string, boolean> = { computerUse: true, revealInFinder: true, terminal: true }): void {
  describe(name, () => {
    let close = async () => {}
    afterEach(async () => close())

    it('exposes equivalent projects, sessions, history, models, capabilities and control plane', async () => {
      const setup = await factory()
      close = setup.close
      const { host } = setup
      expect(host.protocolVersion).toBe(2)
      if (!host.getProjectPaths || !host.setProjectPaths || !host.addProject || !host.removeProject) throw new Error('project persistence extension unavailable')
      expect(await host.getProjectPaths()).toEqual(['/tmp/pipiui'])
      expect(await host.setProjectPaths(['/tmp/pipiui'])).toEqual(['/tmp/pipiui'])
      const addedProject = await host.addProject('/tmp/contract-added')
      expect((await host.listProjects()).map(item => item.path)).toContain('/tmp/contract-added')
      const [project] = await host.listProjects()
      const session = await host.newSession(project.id, 'Contract')
      expect((await host.listSessions(project.id)).map(item => item.id)).toContain(session.id)
      expect(await host.renameSession(session.id, 'Renamed contract')).toMatchObject({ id: session.id, name: 'Renamed contract' })
      expect((await host.listSessions(project.id)).find(item => item.id === session.id)?.name).toBe('Renamed contract')
      expect(await host.moveSession(session.id, addedProject.id)).toMatchObject({ id: session.id, projectId: addedProject.id })
      expect((await host.listSessions(addedProject.id)).map(item => item.id)).toContain(session.id)
      expect(await host.renameProject?.(project.id, 'Renamed project')).toMatchObject({ id: project.id, name: 'Renamed project', path: project.path })
      expect((await host.listProjects()).find(item => item.id === project.id)?.name).toBe('Renamed project')
      await host.removeProject(addedProject.id)
      expect((await host.listProjects()).map(item => item.path)).not.toContain('/tmp/contract-added')
      expect(await host.resumeSession(session.id)).toMatchObject({ id: session.id })
      expect(await host.getSessionHistory(session.id)).toEqual([])
      expect(await host.capabilities()).toMatchObject(expectedCapabilities)
      expect((await host.listModels())[0]).toMatchObject({ id: 'model-1' })
      expect((await host.setModel(session.id, 'mock', 'model-2')).model.id).toBe('model-2')
      expect((await host.setThinkingLevel(session.id, 'high')).thinkingLevel).toBe('high')
      expect(await host.getHiddenModelIds()).toEqual([])
      expect(await host.setHiddenModelIds(['openai/model-1', 'anthropic/model-2', 'openai/model-1'])).toEqual(['anthropic/model-2', 'openai/model-1'])
      expect(await host.getHiddenModelIds()).toEqual(['anthropic/model-2', 'openai/model-1'])
      expect(await host.getVisionModel?.()).toBeNull()
      expect(await host.setVisionModel?.('anthropic/claude-sonnet-4')).toBe('anthropic/claude-sonnet-4')
      expect(await host.getVisionModel?.()).toBe('anthropic/claude-sonnet-4')
      expect(await host.setVisionModel?.(null)).toBeNull()
      expect(await host.getVisionModel?.()).toBeNull()
      expect(await host.getSidebarSessionPreferences?.()).toEqual({ pinnedSessionIds: [], archivedSessionIds: [], orderedSessionIds: [] })
      expect(await host.setSidebarSessionPreferences?.({ pinnedSessionIds: ['session-a', 'session-b'], archivedSessionIds: ['session-b'], orderedSessionIds: ['session-b', 'session-a'], sessionOrderVersion: 2 })).toEqual({ pinnedSessionIds: ['session-a'], archivedSessionIds: ['session-b'], orderedSessionIds: ['session-b', 'session-a'], sessionOrderVersion: 2 })
      expect(await host.getSidebarSessionPreferences?.()).toEqual({ pinnedSessionIds: ['session-a'], archivedSessionIds: ['session-b'], orderedSessionIds: ['session-b', 'session-a'], sessionOrderVersion: 2 })
      expect(await host.listAgents()).toEqual([expect.objectContaining({ agentId: 'agent-1', depth: 1, title: 'Mock build', role: 'general-purpose', createdAt: 1 })])
      expect((await host.checkAgent('agent-1')).state).toBe('running')
      expect(await host.getWorktreeStatus('agent-1')).toMatchObject({ lifecycle: 'pendingReview', merge: 'ready', discard: 'ready' })
      expect(await host.mergeWorktree('agent-1')).toMatchObject({ lifecycle: 'merged', merge: 'merged' })
      await host.abortAgent('agent-1')
      expect((await host.checkAgent('agent-1')).state).toBe('aborted')
      await host.resolveAgent('agent-1')
      expect((await host.checkAgent('agent-1')).state).toBe('ok')
      expect(await host.discardWorktree('agent-1')).toMatchObject({ lifecycle: 'discarded', discard: 'discarded' })
      await host.deleteSession(session.id)
      expect((await host.listSessions(project.id)).map(item => item.id)).not.toContain(session.id)
    })

    it('routes provider auth and credential removal over the same contract without leaking secrets', async () => {
      const setup = await factory()
      close = setup.close
      const { host } = setup
      expect(await host.authProviders()).toEqual([{ id: 'mock-provider', name: 'Mock Provider', authTypes: ['api_key'], authenticated: true, authType: 'api_key' }])
      const { loginId } = await host.beginProviderLogin('mock-provider', 'api_key')
      expect(loginId).toBe('login-mock-provider')
      expect(await host.continueProviderLogin(loginId)).toEqual({ kind: 'prompt', promptType: 'secret', message: '输入 Mock Provider API Key' })
      const secret = 'sk-super-secret-value'
      const completed = await host.continueProviderLogin(loginId, secret)
      expect(completed).toEqual({ kind: 'completed', providerId: 'mock-provider' })
      // The api key never appears in any response payload or serialized frame.
      expect(JSON.stringify(completed)).not.toContain(secret)
      await host.cancelProviderLogin(loginId)
      const afterRemove = await host.removeProviderCredentials('mock-provider')
      expect(afterRemove.model.id).toBe('unknown')
      expect(JSON.stringify(afterRemove)).not.toContain(secret)
    })

    it('serves stable session stats and forwards settle snapshots to subscribers', async () => {
      const setup = await factory()
      close = setup.close
      const { host } = setup
      const [project] = await host.listProjects()
      const session = await host.newSession(project.id, 'Stats')
      // Normal values: explicit id returns the full stable shape.
      expect(await host.getSessionStats('session-1')).toEqual({ sessionId: 'session-1', tokens: { input: 100, output: 50, cacheRead: 200, cacheWrite: 10, total: 360 }, cost: 0.0123, contextUsage: { tokens: 9000, contextWindow: 262144, percent: 3.4 }, model: { provider: 'mock', id: 'model-1', name: 'Mock Model' } })
      expect(await host.getQuotaSnapshot?.('session-1')).toEqual({ provider: 'codex', accountLabel: 'Codex 账号额度', windows: [{ id: 'window0', usedPercent: 4, resetsAt: 1786400000000, label: '5h', title: '5h额度' }, { id: 'window1', usedPercent: 41, resetsAt: 1786900000000, label: '周', title: '周额度' }] })
      // Balance providers ride the same snapshot RPC (DeepSeek prepaid balance).
      await host.setModel(session.id, 'deepseek', 'deepseek-v3')
      expect(await host.getQuotaSnapshot?.(session.id)).toEqual({ provider: 'deepseek', accountLabel: '账户余额', balance: { amount: 88, currency: 'CNY' }, windows: [] })
      // Omitted id targets the host's current active session.
      expect(await host.getSessionStats()).toMatchObject({ sessionId: 'session-1', cost: 0.0123 })
      // Empty session: zeroed tokens/cost and no fabricated contextUsage or model.
      const fresh = await host.getSessionStats(session.id)
      expect(fresh).toMatchObject({ sessionId: session.id, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 })
      expect(fresh.contextUsage).toBeUndefined()
      expect(fresh.model).toBeUndefined()
      // RPC errors reject instead of returning guessed values.
      await expect(host.getSessionStats('missing-session')).rejects.toThrow(/unknown session/)
      // Settle pushes a session_stats snapshot through the same transport.
      const stats: any[] = []
      const offStats = host.subscribeSessionStats(event => stats.push(event))
      await host.sendPrompt(session.id, 'settle me')
      await new Promise(resolve => setTimeout(resolve, 10))
      offStats()
      expect(stats.some(event => event.type === 'snapshot' && event.sessionId === session.id && event.stats.cost === 0.0123)).toBe(true)
    })

    it('delivers matching stream, follow-up and agent log subscriptions', async () => {
      const setup = await factory()
      close = setup.close
      const { host } = setup
      const [project] = await host.listProjects()
      const session = await host.newSession(project.id)
      const stream: any[] = []
      const agents: any[] = []
      const logs: any[] = []
      const wrongRunLogs: any[] = []
      const off = [
        host.subscribeStream(session.id, event => stream.push(event)),
        host.subscribeAgents(event => agents.push(event)),
        host.subscribeAgentLog('agent-1', event => logs.push(event), session.id, 'run-1'),
        host.subscribeAgentLog('agent-1', event => wrongRunLogs.push(event), session.id, 'wrong-run')
      ]
      await host.queueFollowUp(session.id, 'later')
      await host.sendPrompt(session.id, 'hello')
      await host.abortAgent('agent-1')
      await new Promise(resolve => setTimeout(resolve, 10))
      off.forEach(stop => stop())
      expect(stream.map(event => event.type)).toEqual(expect.arrayContaining(['status', 'thinking', 'text', 'tool_call', 'tool_result']))
      expect(stream.find(event => event.type === 'tool_call')).toMatchObject({ contentIndex: 1, toolCallId: 'tool-1', name: 'mock' })
      expect(stream.some(event => event.type === 'status' && event.pendingFollowUps?.includes('later'))).toBe(true)
      expect(agents.some(event => event.type === 'agent' && event.agent.state === 'aborted')).toBe(true)
      expect(logs[0]).toMatchObject({ sessionId: session.id, agentId: 'agent-1', runId: 'run-1', itemType: 'text', text: 'Prompt received: hello' })
      expect(wrongRunLogs).toEqual([])
    })

    it('round-trips queue commands and queue_update snapshots while preserving legacy sendPrompt', async () => {
      const setup = await factory()
      close = setup.close
      const { host } = setup
      const [project] = await host.listProjects()
      const session = await host.newSession(project.id, 'Queue')
      const updates: any[] = []
      const off = host.subscribeStream(session.id, event => { if (event.type === 'queue_update') updates.push(event) })
      // The legacy void-return send method remains callable for old clients.
      await host.sendPrompt(session.id, 'legacy still works')
      const direct = await host.enqueueMessage(session.id, '__hold__')
      expect(direct.outcome).toBe('direct')
      const queued = await host.enqueueMessage(session.id, 'later', [{ dataBase64: 'aGVsbG8=', mimeType: 'image/png', name: 'queue.png', width: 42 }])
      expect(queued).toMatchObject({ outcome: 'queued', message: { state: 'queued', text: 'later' } })
      const edited = await host.updateQueuedMessage(session.id, queued.message.id, 'edited', [{ dataBase64: 'd29ybGQ=', mimeType: 'image/jpeg', name: 'edited.jpg', width: 99 }])
      expect(edited).toMatchObject({ text: 'edited', attachments: [expect.objectContaining({ width: 99 })] })
      expect(await host.listQueue(session.id)).toMatchObject([expect.objectContaining({ id: queued.message.id, text: 'edited' })])
      const steered = await host.steerQueuedMessage(session.id, queued.message.id)
      expect(steered.text).toBe('edited')
      expect(await host.listQueue(session.id)).toEqual([])
      const failed = await host.enqueueMessage(session.id, '__queue_fail__')
      expect(failed.message.state).toBe('failed')
      const retried = await host.retryQueuedMessage(session.id, failed.message.id)
      expect(retried).toMatchObject({ state: 'queued' })
      expect(retried.error).toBeUndefined()
      await host.removeQueuedMessage(session.id, retried.id)
      off()
      expect(updates.some(event => event.queue.some((item: any) => item.id === queued.message.id))).toBe(true)
    })

    it('forwards terminal input and output through the optional mock extension', async () => {
      const setup = await factory()
      close = setup.close
      const terminal = setup.host.terminal
      if (!terminal) throw new Error('terminal extension unavailable')
      const session = await terminal.open({ cwd: '/tmp/contract-terminal' })
      expect(session).toMatchObject({ title: '终端', cwd: '/tmp/contract-terminal' })
      expect(session.initialOutput).toContain('mock terminal')
      const output: string[] = []
      const unsubscribe = terminal.subscribe(session.id, event => {
        if (event.type === 'output') output.push(event.data)
      })
      await terminal.write(session.id, 'echo pasted\r')
      await new Promise(resolve => setTimeout(resolve, 10))
      unsubscribe()
      expect(output.join('')).toContain('echo pasted')
      expect(output.join('')).toContain('mock: received echo pasted')
      await terminal.clear(session.id)
      await terminal.close(session.id)
    })
  })
}

function ipcFactory(): Promise<{ host: PipiHostAPI; close(): Promise<void> }> {
  const backend = createContractMockBackend()
  let handler: any
  const listeners = new Set<any>()
  const sender = { send(_channel: string, frame: HostWireFrame) { for (const listener of listeners) listener({}, frame) } }
  registerPipiHostIpc({ handle(_channel, callback) { handler = callback } }, backend)
  const ipc: IpcRendererLike = {
    invoke: (_channel, request) => handler({ sender }, request),
    on: (_channel, listener) => listeners.add(listener),
    removeListener: (_channel, listener) => listeners.delete(listener)
  }
  return Promise.resolve({ host: createIpcHost(ipc), close: async () => {} })
}

async function wsFactory(): Promise<{ host: PipiHostAPI; close(): Promise<void> }> {
  const server = createWsHostServer({ backend: createContractMockBackend(), pairing: false, terminalMode: 'mock' })
  const port = await server.listen()
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  return { host: createWsHost(socket as any), close: async () => { socket.close(); await server.close() } }
}

contract('IPC transport', ipcFactory)
contract('WebSocket transport', wsFactory, { computerUse: false, revealInFinder: false, terminal: true, browser: false })

describe('agent log cache identity contract', () => {
  it('serializes the exact session, agent, and run over IPC', async () => {
    const calls: Array<{ method: string; params: unknown[] }> = []
    const ipc: IpcRendererLike = {
      invoke: async (_channel, request) => {
        calls.push({ method: request.method, params: request.params })
        return { protocolVersion: 2, id: request.id, type: 'response', ok: true, result: [] }
      },
      on: () => undefined,
      removeListener: () => undefined
    }
    const host = createIpcHost(ipc)
    await expect(host.getAgentLogs('shared', 'session-exact', 'run-exact')).resolves.toEqual([])
    expect(calls).toEqual([{ method: 'getAgentLogs', params: ['shared', 'session-exact', 'run-exact'] }])
  })
})

describe('desktop document host extension', () => {
  it('exposes only the opted-in local opener and preserves structured error codes', async () => {
    const calls: Array<{ method: string; params: unknown[] }> = []
    const ipc: IpcRendererLike = {
      invoke: async (_channel, request) => {
        calls.push({ method: request.method, params: request.params })
        if (request.params[0] === '/missing/report.pdf') {
          return { protocolVersion: 2, id: request.id, type: 'response', ok: false, error: 'Document does not exist', errorCode: 'document_not_found' }
        }
        return { protocolVersion: 2, id: request.id, type: 'response', ok: true, result: undefined }
      },
      on: () => undefined,
      removeListener: () => undefined
    }
    const defaultHost = createIpcHost(ipc)
    expect(defaultHost.openDocumentExternally).toBeUndefined()

    const desktopHost = createIpcHost(ipc, undefined, { openDocumentExternally: true })
    await desktopHost.openDocumentExternally?.('/work/report.pdf')
    expect(calls.at(-1)).toEqual({ method: 'openDocumentExternally', params: ['/work/report.pdf'] })
    await expect(desktopHost.openDocumentExternally?.('/missing/report.pdf'))
      .rejects.toMatchObject({ message: 'Document does not exist', code: 'document_not_found' })
  })
})

describe('browser transport extension', () => {
  it('maps tab commands, active-tab state, snapshots, bounds, and subscriptions', async () => {
    const calls: Array<{ method: string; params: unknown[] }> = []
    const listeners = new Set<any>()
    const tab = { id: 'browser-1', title: 'Example', url: 'https://example.test', isLoading: false, canGoBack: false, canGoForward: false }
    const ipc: IpcRendererLike = {
      invoke: async (_channel, request) => {
        calls.push({ method: request.method, params: request.params })
        const result = request.method === 'browserListTabs' ? { tabs: [tab], activeTabId: tab.id }
          : request.method === 'browserSnapshot' ? { tabId: tab.id, url: tab.url, title: tab.title, isLoading: false }
            : request.method === 'browserSetViewBounds' ? undefined : tab
        return { protocolVersion: 2, id: request.id, type: 'response', ok: true, result }
      },
      on: (_channel, listener) => listeners.add(listener),
      removeListener: (_channel, listener) => listeners.delete(listener)
    }
    const browser = createIpcHost(ipc).browser
    if (!browser) throw new Error('browser extension unavailable')
    const received: any[] = []
    const unsubscribe = browser.subscribe(event => received.push(event))
    await browser.selectSession('session-a')
    expect(await browser.listTabs('session-a')).toMatchObject({ activeTabId: tab.id })
    expect(await browser.getActiveTab('session-a')).toMatchObject({ id: tab.id })
    await browser.loadURL('session-a', 'example.test', tab.id)
    expect(await browser.snapshot('session-a')).toMatchObject({ tabId: tab.id })
    await browser.setViewBounds('session-a', { x: 1, y: 2, width: 3, height: 4, visible: true })
    for (const listener of listeners) listener({}, { type: 'event', protocolVersion: 2, channel: 'browser', event: { type: 'tabs', sessionId: 'session-a', snapshot: { tabs: [tab], activeTabId: tab.id } } })
    expect(received).toHaveLength(1)
    expect(calls).toEqual(expect.arrayContaining([
      { method: 'browserSelectSession', params: ['session-a'] },
      { method: 'browserListTabs', params: ['session-a'] },
      { method: 'browserGetActiveTab', params: ['session-a'] },
      { method: 'browserLoadURL', params: ['session-a', 'example.test', tab.id] },
      { method: 'browserSnapshot', params: ['session-a', undefined] },
      { method: 'browserSetViewBounds', params: ['session-a', { x: 1, y: 2, width: 3, height: 4, visible: true }] }
    ]))
    unsubscribe()
  })
})

describe('Electron-native project directory picker extension', () => {
  it('is exposed only when the preload opts into the native picker', async () => {
    const calls: Array<{ method: string; params: unknown[] }> = []
    const ipc: IpcRendererLike = {
      invoke: async (_channel, request) => {
        calls.push({ method: request.method, params: request.params })
        return { protocolVersion: 2, id: request.id, type: 'response', ok: true, result: '/Users/demo/project' }
      },
      on: () => undefined,
      removeListener: () => undefined
    }

    expect(createIpcHost(ipc).pickProjectDirectory).toBeUndefined()
    const picker = createIpcHost(ipc, undefined, { projectDirectoryPicker: true }).pickProjectDirectory
    if (!picker) throw new Error('project directory picker unavailable')
    await expect(picker()).resolves.toBe('/Users/demo/project')
    expect(calls).toEqual([{ method: 'pickProjectDirectory', params: [] }])
  })
})

describe('Electron-native Computer Use permission opener', () => {
  it('is exposed only when the preload opts into system permission settings', async () => {
    const calls: Array<{ method: string; params: unknown[] }> = []
    const ipc: IpcRendererLike = {
      invoke: async (_channel, request) => {
        calls.push({ method: request.method, params: request.params })
        return { protocolVersion: 2, id: request.id, type: 'response', ok: true, result: { enabled: true, screenRecording: false, accessibility: true } }
      },
      on: () => undefined,
      removeListener: () => undefined
    }

    expect(createIpcHost(ipc).openComputerUsePermission).toBeUndefined()
    const open = createIpcHost(ipc, undefined, { computerUsePermissions: true }).openComputerUsePermission
    if (!open) throw new Error('computer-use permission opener unavailable')
    await expect(open('screenRecording')).resolves.toEqual({ enabled: true, screenRecording: false, accessibility: true })
    expect(calls).toEqual([{ method: 'openComputerUsePermission', params: ['screenRecording'] }])
  })
})

describe('Electron-native update center extension', () => {
  it('is exposed only when preload opts in and sends no renderer-controlled parameters', async () => {
    const calls: Array<{ method: string; params: unknown[] }> = []
    const result = { checkedAt: 123, items: [{ id: 'pi', name: 'Pi', currentVersion: '1.0.0', latestVersion: '1.0.1', status: 'updateAvailable' }] }
    const ipc: IpcRendererLike = {
      invoke: async (_channel, request) => {
        calls.push({ method: request.method, params: request.params })
        return { protocolVersion: 2, id: request.id, type: 'response', ok: true, result }
      },
      on: () => undefined,
      removeListener: () => undefined
    }
    expect(createIpcHost(ipc).checkForUpdates).toBeUndefined()
    const check = createIpcHost(ipc, undefined, { updateCenter: true }).checkForUpdates
    if (!check) throw new Error('update center unavailable')
    await expect(check()).resolves.toEqual(result)
    expect(calls).toEqual([{ method: 'checkForUpdates', params: [] }])
  })
})
