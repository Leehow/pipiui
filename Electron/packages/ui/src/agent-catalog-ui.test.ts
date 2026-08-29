import { describe, expect, it } from 'vitest'
import {
  agentSourceLabel,
  formatDiagnostic,
  isBlockingCatalogDiagnostic,
  partitionCatalog,
  redactDiagnosticMessage,
} from './agent-catalog-ui'

describe('agent catalog diagnostic formatting', () => {
  it('formats structured shadowed-name text without path fragments', () => {
    const message = 'Agent `explore` from bundled scope overrides user `explore`; existing scope precedence is preserved.'
    expect(formatDiagnostic({ severity: 'warning', code: 'shadowed-name', message })).toBe(`shadowed-name: ${message}`)
    expect(formatDiagnostic({ severity: 'warning', code: 'shadowed-name', message })).not.toContain('/')
    expect(formatDiagnostic({ severity: 'warning', code: 'shadowed-name', message })).not.toContain('Top Secret')
  })

  it('redacts leftover spaced absolute paths as a second layer', () => {
    const leaked = 'overrides definition at /Users/a/Top Secret/AGENT.md; kept'
    expect(redactDiagnosticMessage(leaked)).toBe('overrides definition at <path>; kept')
    expect(redactDiagnosticMessage(leaked)).not.toContain('Top Secret')
    expect(redactDiagnosticMessage(leaked)).not.toContain('AGENT.md')
    expect(formatDiagnostic({
      severity: 'warning',
      code: 'shadowed-name',
      message: leaked,
    })).toBe('shadowed-name: overrides definition at <path>; kept')
  })

  it('keeps catalog error banners for failures, not ignored optional fields', () => {
    expect(isBlockingCatalogDiagnostic({
      severity: 'warning',
      code: 'unknown-field',
      message: 'Unknown frontmatter field `thinking`; ignored by legacy compatibility mode.',
    })).toBe(false)
    expect(isBlockingCatalogDiagnostic({
      severity: 'error',
      code: 'catalog-discovery-failed',
      message: 'overlay scan failed',
    })).toBe(true)
  })
})

describe('agent catalog grouping', () => {
  it('keeps bundled and user agents in general and folds project agents', () => {
    const explore = { name: 'explore', description: 'Research', origin: 'bundled' as const, source: 'bundled' as const }
    const userWorker = { name: 'openai-user', description: 'User install', origin: 'user' as const, source: 'user' as const }
    const steward = { name: 'steward-init', description: 'COC L0', origin: 'project' as const, source: 'project' as const }
    const ext = { name: 'ext-researcher', description: 'Project ext', origin: 'project' as const, source: 'project' as const, extensionId: 'ext-research' }
    const extra = { name: 'research-helper', description: 'Extra project agent', origin: 'project' as const, source: 'project' as const }
    const grouped = partitionCatalog([explore, userWorker, steward, ext, extra])
    expect(grouped.general.map(agent => agent.name)).toEqual(['explore', 'openai-user'])
    expect(grouped.project.map(agent => agent.name)).toEqual(['steward-init', 'ext-researcher', 'research-helper'])
  })

  it('labels project agents as project-specific instead of a bare 项目 badge', () => {
    expect(agentSourceLabel({ name: 'steward-init', description: 'COC L0', origin: 'project', source: 'project' })).toBe('项目专用')
    expect(agentSourceLabel({ name: 'explore', description: 'Research', origin: 'bundled', source: 'bundled' })).toBe('内置')
    expect(agentSourceLabel({
      name: 'ext-researcher',
      description: 'Project ext',
      origin: 'project',
      source: 'project',
      extensionId: 'ext-research',
    })).toBe('扩展 ext-research')
    expect(agentSourceLabel({ name: 'steward-init', description: 'COC L0', origin: 'project', source: 'project' }, { skipProject: true })).toBeUndefined()
  })
})
