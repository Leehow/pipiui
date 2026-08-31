import { useMemo } from 'react'
import type { AgentDebugSkill, AgentDebugSubagent, AgentDebugTool, AgentDefinition, SubagentDebugInfo } from '@pipi/host-api'
import { agentSourceLabel } from './agent-catalog-ui'
import { DismissibleError } from './DismissibleError'
import { roleDescriptionZh, skillDescriptionZh, toolDescriptionZh } from './subagent-debug-copy'

const SUBAGENT_RUNTIME_TOOLS = ['memory_query', 'memory_status', 'session_recall', 'skill_search', 'skill_load']
const DELEGATION_TOOLS = ['subagent', 'subagent_chain', 'subagent_abort', 'subagent_resolve', 'subagent_status']
const LEGACY_WORKER_TOOLS = [
  'read', 'bash', 'edit', 'write', 'grep', 'find', 'ls',
  'web_search', 'fetch_content', 'source_check', 'get_search_content', 'arxiv_fetch',
  'code_search', 'code_nav', 'repo_map', 'read_spans',
  ...SUBAGENT_RUNTIME_TOOLS,
]
const LEGACY_READ_ONLY_TOOLS = LEGACY_WORKER_TOOLS.filter(name => name !== 'edit' && name !== 'write')
const LEGACY_BUILTIN_TOOLS: Record<string, string[]> = {
  explore: LEGACY_READ_ONLY_TOOLS,
  reviewer: LEGACY_READ_ONLY_TOOLS,
  'general-purpose': [...LEGACY_WORKER_TOOLS, ...DELEGATION_TOOLS],
  secretary: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'secretary_commit'],
}

export function SubagentDebugView({ agents, info, loading, error, onDismissError, onRefresh }: {
  agents: AgentDefinition[]
  info: SubagentDebugInfo | null
  loading: boolean
  error: string | null
  onDismissError: () => void
  onRefresh: () => void
}) {
  const toolCatalog = useMemo(() => new Map((info?.toolCatalog ?? []).map(tool => [tool.name, tool])), [info])
  const projectionByName = useMemo(() => new Map((info?.subagents ?? []).map(agent => [agent.name, agent])), [info])
  const commonTools = SUBAGENT_RUNTIME_TOOLS.filter(name => toolCatalog.has(name))

  if (loading && !info) return <div className="subagent-modal-state">正在读取 Boss 运行时 Debug 信息…</div>

  if (!info?.available) {
    const reason = info?.reason === 'no-session'
      ? '当前没有打开的会话，暂时无法读取 Boss 的实时工具快照。'
      : info?.reason === 'snapshot-too-large'
        ? 'Boss 的运行时 Debug 快照超过 1 MiB 安全上限，未加载；请减少已启用的工具或 Skills 后刷新。'
      : info?.reason === 'snapshot-invalid'
        ? 'Boss 的运行时 Debug 快照无效，请刷新或重新进入一次会话。'
        : 'Boss 的运行时 Debug 快照尚未生成；发送一条消息后即可读取。'
    return <div className="subagent-debug-empty" data-testid="subagent-debug-unavailable">
      {error && <DismissibleError message={error} onDismiss={onDismissError} />}
      <p>{reason}</p>
      <button type="button" onClick={onRefresh}>刷新 Debug 信息</button>
    </div>
  }

  const captured = info.capturedAt ? new Date(info.capturedAt).toLocaleString('zh-CN', { hour12: false }) : '未知时间'
  const demo = info.source === 'demo'

  return <div className="subagent-debug-view" data-testid="subagent-debug-view">
    <div className="subagent-debug-summary">
      <div><strong>{demo ? '演示 Debug（非当前 Boss）' : '运行时 Debug'}</strong><span>快照时间：{captured}</span></div>
      <button type="button" onClick={onRefresh} disabled={loading}>{loading ? '刷新中…' : '刷新'}</button>
    </div>
    {error && <DismissibleError message={error} onDismiss={onDismissError} />}
    {demo && <div className="subagent-debug-demo-warning" role="status">当前是浏览器演示数据，不代表正在运行的 Boss。Electron App 会读取会话的实时工具快照。</div>}
    <p className="subagent-debug-note">{demo ? '演示模式使用完整代表性工具与 Skill 清单。' : 'Boss 显示当前会话的真实活动工具；'} Subagent 显示运行时按 Agent 定义、扩展所有权、工具开关和递归深度计算的派出投影。单次派出仍可能被模型原生搜索或临时能力授权进一步收窄。</p>

    <DebugRoleCard
      testId="debug-role-boss"
      title={demo ? 'Boss（演示数据）' : 'Boss（主 Agent）'}
      description={demo ? '浏览器演示用的完整代表性 Boss 工具清单；不是当前运行会话的实时状态。' : roleDescriptionZh('boss')}
      tools={info.bossTools}
      skills={info.skills}
      skillSummary={`可按需使用 ${info.skills.length} 个已启用 Skills；展开 skill_load 可查看完整清单。`}
    />
    <DebugRoleCard
      testId="debug-role-supervisor"
      title="Supervisor 管理 Agent"
      description={roleDescriptionZh('supervisor')}
      tools={[]}
      skills={[]}
      skillSummary="不加载通用 Skills，只处理 Subagent 管理信号。"
    />
    <DebugRoleCard
      testId="debug-role-memory-review"
      title="Hermes 记忆复核"
      description={roleDescriptionZh('memory-review')}
      tools={[]}
      skills={[]}
      skillSummary="不加载通用 Skills，只执行记忆复核流程。"
    />

    <section className="subagent-debug-agent-section" aria-labelledby="subagent-debug-roles-heading">
      <div className="subagent-agent-group-heading"><h3 id="subagent-debug-roles-heading">Subagents</h3><span>{agents.length} 个 Agent 定义</span></div>
      {agents.map(agent => {
        const projection = debugToolsForAgent(agent, projectionByName.get(agent.name), commonTools, toolCatalog)
        const tools = projection.tools
        const source = agentSourceLabel(agent)
        const hasSkillSearch = tools.some(tool => tool.name === 'skill_search')
        const hasSkillLoad = tools.some(tool => tool.name === 'skill_load')
        return <DebugRoleCard
          key={agent.name}
          testId={`debug-role-${agent.name}`}
          title={agent.name}
          badge={source}
          description={roleDescriptionZh(agent.name)}
          originalDescription={agent.description}
          policyNote={projection.policyNote}
          tools={tools}
          skills={hasSkillLoad ? info.skills : []}
          skillSummary={hasSkillLoad
            ? `可通过 skill_search / skill_load 按需使用 ${info.skills.length} 个 Skills；展开 skill_load 可查看完整清单。`
            : hasSkillSearch
              ? '可查询 Skill 目录，但当前没有 skill_load，不能加载完整流程。'
              : '该 Agent 当前没有 Skill 加载工具。'}
        />
      })}
    </section>
  </div>
}

function debugToolsForAgent(
  agent: AgentDefinition,
  projection: AgentDebugSubagent | undefined,
  commonTools: string[],
  catalog: Map<string, AgentDebugTool>,
): { tools: AgentDebugTool[]; policyNote?: string } {
  const fallback = inferredLegacyTools(agent, catalog)
  const names = projection?.tools ?? [...new Set([...fallback, ...commonTools])]
  const tools = [...new Set(names)]
    .filter(name => name !== 'computer' && name !== 'open_application')
    .sort((a, b) => a.localeCompare(b))
    .map(name => catalog.get(name) ?? { name, description: '' })
  if (!projection) return { tools, policyNote: '旧 Host 未提供运行时派出投影；以下为兼容推断。' }
  if (projection.toolPolicy === 'unrestricted') {
    const excluded = projection.excludedTools?.length ? `；明确排除：${projection.excludedTools.join('、')}` : ''
    return { tools, policyNote: `Legacy Agent 未设置工具白名单；这里显示当前 worker 工具注册表扣除禁用项后的结果${excluded}。` }
  }
  return { tools }
}

function inferredLegacyTools(agent: AgentDefinition, catalog: Map<string, AgentDebugTool>): string[] {
  const tools = new Set<string>()
  const capabilities = agent.capabilities
  if (!capabilities) {
    const legacy = LEGACY_BUILTIN_TOOLS[agent.name] ?? LEGACY_WORKER_TOOLS
    return legacy.filter(name => catalog.has(name))
  }
  if (capabilities.filesystem !== 'none') ['read', 'grep', 'find', 'ls'].forEach(name => tools.add(name))
  if (capabilities.filesystem === 'workspace-write') ['edit', 'write'].forEach(name => tools.add(name))
  if (capabilities.shell) tools.add('bash')
  if (capabilities.web) ['web_search', 'fetch_content', 'source_check', 'get_search_content', 'arxiv_fetch'].forEach(name => tools.add(name))
  if (capabilities.delegation) DELEGATION_TOOLS.forEach(name => tools.add(name))
  ;(capabilities.mcpTools ?? []).forEach(name => tools.add(name))
  return [...tools]
}

function DebugRoleCard({ testId, title, badge, description, originalDescription, policyNote, tools, skills, skillSummary }: {
  testId: string
  title: string
  badge?: string
  description: string
  originalDescription?: string
  policyNote?: string
  tools: AgentDebugTool[]
  skills: AgentDebugSkill[]
  skillSummary: string
}) {
  return <article className="subagent-debug-role" data-testid={testId}>
    <div className="subagent-debug-role-heading"><strong>{title}</strong>{badge && <span>{badge}</span>}</div>
    <p>{description}</p>
    {originalDescription && <p className="subagent-debug-original" title={originalDescription}>原始定义：{originalDescription}</p>}
    {policyNote && <p className="subagent-debug-policy">{policyNote}</p>}
    <div className="subagent-debug-block">
      <h4>工具 <span>{tools.length}</span></h4>
      {tools.length === 0 ? <p className="subagent-debug-empty-copy">不使用通用工具。</p> : <ul className="subagent-debug-tools">
        {tools.map(tool => <DebugToolRow key={tool.name} tool={tool} skills={skills} />)}
      </ul>}
    </div>
    <div className="subagent-debug-skill-access"><strong>Skills</strong><span>{skillSummary}</span></div>
  </article>
}

function DebugToolRow({ tool, skills }: { tool: AgentDebugTool; skills: AgentDebugSkill[] }) {
  if (tool.name !== 'skill_load') {
    return <li title={tool.description || undefined}>
      <code>{tool.name}</code>
      <span>{toolDescriptionZh(tool.name)}</span>
    </li>
  }

  return <li className="subagent-debug-tool-expandable" title={tool.description || undefined}>
    <details data-testid="subagent-debug-skill-load">
      <summary>
        <span><code>{tool.name}</code><small>{toolDescriptionZh(tool.name)}</small></span>
        <b aria-hidden="true">⌄</b>
      </summary>
      {skills.length === 0 ? <p className="subagent-debug-empty-copy">当前没有发现可调用的 Skill。</p> : <ul className="subagent-debug-tool-skills">
        {skills.map(skill => <li key={skill.name} title={skill.description || undefined}>
          <div><code>{skill.name}</code>{skill.userInvoked && <span>较重流程</span>}</div>
          <p>{skillDescriptionZh(skill.name)}</p>
        </li>)}
      </ul>}
    </details>
  </li>
}
