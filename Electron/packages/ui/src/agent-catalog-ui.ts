import type { AgentCatalogDiagnostic, AgentDefinition, AgentPatchProvenance } from '@pipi/host-api'

export function isAgentUnavailable(agent: AgentDefinition): boolean {
  return agent.available === false || agent.availability === 'unavailable'
}

export function agentAvailabilityLabel(agent: AgentDefinition): string | undefined {
  if (isAgentUnavailable(agent)) return '不可用'
  if (agent.availability === 'degraded') return '降级'
  return undefined
}

export function agentSourceLabel(
  agent: AgentDefinition,
  options?: { skipProject?: boolean },
): string | undefined {
  if (agent.extensionId) return `扩展 ${agent.extensionId}`
  const origin = agent.source ?? agent.origin
  if (origin === 'bundled') return '内置'
  if (origin === 'project') return options?.skipProject ? undefined : '项目专用'
  if (origin === 'user') return '用户'
  return undefined
}

export function isProjectScopedAgent(agent: AgentDefinition): boolean {
  return (agent.source ?? agent.origin) === 'project'
}

export function diagnosticKey(entry: AgentCatalogDiagnostic): string {
  return [entry.severity, entry.code, entry.message, entry.agentName ?? '', entry.extensionId ?? '', entry.filePath ?? ''].join('\0')
}

/** Display-time safety net so visible diagnostics never leak absolute paths. */
export function redactDiagnosticMessage(message: string): string {
  let text = message
  text = text.replace(/'((?:\/|\\)[^']+)'/g, "'<path>'")
  text = text.replace(/"((?:\/|\\)[^"]+)"/g, '"<path>"')
  text = text.replace(/`((?:\/|\\)[^`]+)`/g, '`<path>`')
  text = text.replace(/(^|[\s:[=(,;])(\/(?:[^/`\'"<>\]]+\/)+[^/`\'"<>\]\s,;]+)/g, '$1<path>')
  text = text.replace(/(^|[\s:[=(,;`\'])([A-Za-z]:\\(?:[^\\`\'"<>\]]+\\)+[^\\`\'"<>\]\s,;]+)/g, '$1<path>')
  text = text.replace(/(^|[\s:[=(,;`\'])(\\\\[^\\`\'"<>\]]+(?:\\[^\\`\'"<>\]]+)+)/g, '$1<path>')
  return text
}

export function formatDiagnostic(entry: AgentCatalogDiagnostic): string {
  return `${entry.code}: ${redactDiagnosticMessage(entry.message)}`
}

/** Catalog banners are for load/contribution failures, not ignored optional fields. */
export function isBlockingCatalogDiagnostic(entry: AgentCatalogDiagnostic): boolean {
  return entry.severity === 'error'
}

export function collectCatalogDiagnostics(agents: AgentDefinition[]): AgentCatalogDiagnostic[] {
  const seen = new Set<string>()
  const out: AgentCatalogDiagnostic[] = []
  for (const agent of agents) {
    for (const entry of agent.catalogDiagnostics ?? []) {
      const key = diagnosticKey(entry)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(entry)
    }
  }
  return out
}

export function partitionCatalog(agents: AgentDefinition[]): {
  general: AgentDefinition[]
  project: AgentDefinition[]
} {
  const general: AgentDefinition[] = []
  const project: AgentDefinition[] = []
  for (const agent of agents) {
    if (isProjectScopedAgent(agent)) project.push(agent)
    else general.push(agent)
  }
  return { general, project }
}

export function contributedAgentsFor(agents: AgentDefinition[], extensionId: string): AgentDefinition[] {
  return agents.filter(agent => agent.extensionId === extensionId)
}

export function patchesForExtension(
  agents: AgentDefinition[],
  extensionId: string,
): Array<{ agentName: string; patch: AgentPatchProvenance }> {
  const out: Array<{ agentName: string; patch: AgentPatchProvenance }> = []
  for (const agent of agents) {
    for (const patch of agent.patches ?? []) {
      if (patch.extensionId === extensionId) out.push({ agentName: agent.name, patch })
    }
  }
  return out
}

export function isRequestedPatch(patch: AgentPatchProvenance): boolean {
  return patch.status === 'requested'
}

export function formatPatchOperations(patch: AgentPatchProvenance): string {
  const parts: string[] = []
  const requested = isRequestedPatch(patch)
  for (const operation of patch.operations) {
    if (operation === 'appendPrompt') parts.push('追加 Prompt')
    else if (operation === 'replacePrompt') parts.push('替换 Prompt')
    else if (operation === 'addTools') {
      const tools = patch.addTools?.length ? patch.addTools.join(', ') : ''
      if (requested) parts.push(tools ? `请求添加工具 ${tools}（待运行验证）` : '请求添加工具（待运行验证）')
      else parts.push(tools ? `添加工具 ${tools}` : '添加工具')
    } else if (operation === 'removeTools') {
      parts.push(patch.removeTools?.length ? `移除工具 ${patch.removeTools.join(', ')}` : '移除工具')
    }
  }
  return parts.join(' · ')
}

export function diagnosticsForExtension(
  extensionId: string,
  agents: AgentDefinition[],
  catalogDiagnostics: AgentCatalogDiagnostic[],
): AgentCatalogDiagnostic[] {
  const contributedNames = new Set(contributedAgentsFor(agents, extensionId).map(agent => agent.name))
  const seen = new Set<string>()
  const out: AgentCatalogDiagnostic[] = []
  const consider = (entry: AgentCatalogDiagnostic) => {
    const matches = entry.extensionId === extensionId
      || entry.filePath === extensionId
      || entry.agentName === extensionId
      || (entry.agentName != null && contributedNames.has(entry.agentName))
      || (entry.code.startsWith('contribution-') && entry.message.includes(`\`${extensionId}\``))
    if (!matches) return
    const key = diagnosticKey(entry)
    if (seen.has(key)) return
    seen.add(key)
    out.push(entry)
  }
  for (const entry of catalogDiagnostics) consider(entry)
  for (const agent of agents) {
    for (const entry of agent.diagnostics ?? []) consider(entry)
  }
  return out
}
