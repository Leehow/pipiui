import type { ExternalHistoryAvailability, ExternalSession, ExternalSessionHistory, ExternalSessionSource } from '@pipi/host-api'
import { historyMessages, type ChatMessage } from './transcript-model'

export type SessionSource = 'pi' | ExternalSessionSource

export type ProjectExternalSession = ExternalSession & { projectId: string }

export const SESSION_SOURCE_LABELS: Record<SessionSource, string> = {
  pi: 'Pi',
  claude: 'Anthropic/Claude',
  codex: 'OpenAI/Codex',
  grok: 'xAI/Grok',
  cursor: 'Cursor',
  opencode: 'OpenCode',
  zcode: 'Z.ai/ZCode',
}

/** Provider/model hints reused by ProviderLogo; unknown sources keep a stable monogram. */
export const SESSION_SOURCE_LOGO: Record<SessionSource, { provider: string; modelId?: string; glyph: string }> = {
  pi: { provider: 'pi', glyph: 'π' },
  claude: { provider: 'anthropic', modelId: 'claude', glyph: 'C' },
  codex: { provider: 'openai', modelId: 'codex', glyph: 'O' },
  grok: { provider: 'xai', modelId: 'grok', glyph: 'G' },
  cursor: { provider: 'cursor', glyph: 'C' },
  opencode: { provider: 'opencode', glyph: 'O' },
  zcode: { provider: 'zhipu', modelId: 'glm', glyph: 'Z' },
}

const EXTERNAL_HISTORY_PLACEHOLDERS: Record<ExternalHistoryAvailability, string> = {
  none: '此外部会话没有可展示的记录。',
  metadata: '此外部会话仅提供元数据，无法读取正文。',
  summary: '此外部会话仅提供摘要。',
  text: '此外部会话没有可展示的正文。',
}

export function isExternalSessionId(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith('ext:') && id.length > 4
}

export function isSessionSource(value: unknown): value is SessionSource {
  return typeof value === 'string' && value in SESSION_SOURCE_LABELS
}

export function sessionSourceLabel(source: string | undefined): string {
  return isSessionSource(source) ? SESSION_SOURCE_LABELS[source] : SESSION_SOURCE_LABELS.pi
}

export function sessionSourceLogo(source: string | undefined): { provider: string; modelId?: string; glyph: string } {
  return isSessionSource(source) ? SESSION_SOURCE_LOGO[source] : SESSION_SOURCE_LOGO.pi
}

export function isExternalSidebarSource(source: string | undefined): source is ExternalSessionSource {
  return isSessionSource(source) && source !== 'pi'
}

export function sessionRowLabel(title: string, source?: string): string {
  return `${sessionSourceLabel(source)} · ${title}`
}

export function loadExternalSessionsForProjects(
  listExternalSessions: ((projectId: string) => Promise<ExternalSession[]>) | undefined,
  projects: readonly { id: string }[],
): Promise<ProjectExternalSession[]> {
  if (!listExternalSessions) return Promise.resolve([])
  return Promise.all(projects.map(async project => {
    try {
      const sessions = await listExternalSessions(project.id)
      return sessions.map(session => ({ ...session, projectId: project.id }))
    } catch {
      return []
    }
  })).then(groups => groups.flat())
}

export function replaceProjectExternalSessions(
  current: readonly ProjectExternalSession[],
  projectId: string,
  next: readonly ExternalSession[],
): ProjectExternalSession[] {
  return [
    ...current.filter(session => session.projectId !== projectId),
    ...next.map(session => ({ ...session, projectId })),
  ]
}

export function externalHistoryToMessages(history: ExternalSessionHistory): ChatMessage[] {
  if (history.availability === 'text' && history.entries.length > 0) {
    return historyMessages(history.entries.map(entry => ({
      id: entry.id,
      role: entry.role === 'system' ? 'assistant' : entry.role,
      content: entry.content,
      timestamp: entry.timestamp,
    })))
  }
  const summary = history.summary?.trim()
  if (summary) {
    return [{ id: `${history.id}:summary`, role: 'assistant', content: summary, timestamp: Date.now() }]
  }
  return [{
    id: `${history.id}:unavailable`,
    role: 'assistant',
    content: EXTERNAL_HISTORY_PLACEHOLDERS[history.availability],
    timestamp: Date.now(),
  }]
}
