/**
 * Parse Computer Use episode text side-channels into structured views.
 *
 * Three surfaces carry plan/task data as plain text today (the tool `details`
 * object never survives the host RPC hop):
 * - the leader agent's streamed final message — the raw JSON plan, arriving as
 *   cumulative `log_delta` snapshots, so partial input must render progressively;
 * - a Computer Use worker's closed verdict — `{"outcome","summary"}` after the
 *   SSE object closes, rendered as a result card instead of raw JSON;
 * - the finished `computer_task` tool result — `prose\n\nEpisode ledger:\n{json}`
 *   where the json envelope carries `episodeLedger` plus (newer runs) the
 *   structured `plan` / `verification` / `investigation` view.
 *
 * Every parser is guarded: anything that does not match the expected shape
 * returns null and callers fall back to the plain-text rendering.
 */
import { scrapeJSONString } from './tool-summary'

export type ComputerConditionKind = 'visible_text' | 'element_exists' | 'file_exists' | 'visual_judgement'
export type ComputerConditionView = { kind: ComputerConditionKind | 'unknown'; text: string }

export type ComputerPlanStepView = { id?: string; role?: string; objective?: string; dependsOn: string[] }
export type ComputerPlanView = {
  goal?: string
  revision?: number
  steps: ComputerPlanStepView[]
  successConditions: ComputerConditionView[]
  /** False while the streamed JSON is still incomplete (growing card). */
  complete: boolean
  /** Fence-stripped original text, kept for the collapsed technical view. */
  raw: string
}

export type ComputerEpisodeView = {
  agentId?: string
  runId?: string
  role: string
  name: string
  terminalState: string
  outcome: string
  failureCode?: string
}
export type ComputerWorkerAttemptView = {
  stepId: string
  role: string
  outcome: string
  verification: string
  failureCode?: string
  agentId?: string
}
export type ComputerTaskResultView = {
  summary: string
  episodes: ComputerEpisodeView[]
  plan?: ComputerPlanView
  verification?: { status: string; conditionResults: Array<{ conditionId: string; outcome: string }>; claims?: Array<{ claim: string; evidenceRef: string }> }
  investigation?: { stage?: string; code?: string; workerAttempts: ComputerWorkerAttemptView[] }
}

const WORKER_OUTCOMES = ['completed', 'verified', 'succeeded', 'failed', 'blocked', 'outcome_unknown', 'cancelled'] as const
export type ComputerWorkerOutcome = (typeof WORKER_OUTCOMES)[number]
export type ComputerWorkerResultView = {
  outcome: ComputerWorkerOutcome
  summary: string
  failureCode?: string
  complete: true
  raw: string
}

const EPISODE_LEDGER_MARKER = '\nEpisode ledger:\n'
const CONDITION_KINDS = ['visible_text', 'element_exists', 'file_exists', 'visual_judgement']

export function computerRoleLabel(role: string | undefined): string {
  switch (role) {
    case 'computer-use-agent': return 'Computer Use'
    case 'gui-operator': return '操作'
    case 'verifier': return '核验'
    case 'terminal-worker': return '终端'
    case 'computer-use-leader': return '主管'
    default: return role || '步骤'
  }
}

export function computerOutcomeLabel(outcome: string | undefined): string {
  switch (outcome) {
    case 'completed': return '完成'
    case 'verified': return '已核验'
    case 'succeeded': return '成功'
    case 'failed': return '失败'
    case 'blocked': return '受阻'
    case 'outcome_unknown': return '结果未知'
    case 'cancelled': return '已取消'
    default: return outcome || '未知'
  }
}

export function computerTerminalStateLabel(state: string | undefined): string {
  switch (state) {
    case 'ok': return '成功'
    case 'failed': return '失败'
    case 'aborted': return '已中止'
    case 'interrupted': return '已中断'
    case 'stalled': return '卡住'
    default: return state || '未知'
  }
}

/** One line of human text for a postcondition, regardless of kind. */
export function computerConditionText(condition: unknown): ComputerConditionView {
  if (!condition || typeof condition !== 'object') return { kind: 'unknown', text: '' }
  const item = condition as Record<string, unknown>
  const kind = CONDITION_KINDS.includes(String(item.kind)) ? String(item.kind) as ComputerConditionKind : 'unknown'
  switch (kind) {
    case 'visible_text': return { kind, text: `界面出现「${String(item.contains ?? '')}」` }
    case 'element_exists': return { kind, text: `存在界面元素「${String(item.name ?? '')}」` }
    case 'file_exists': return { kind, text: `文件存在 ${String(item.path ?? '')}` }
    case 'visual_judgement': return { kind, text: String(item.description ?? '') }
    default: return { kind, text: JSON.stringify(condition).slice(0, 160) }
  }
}

/** Strip a leading ``` / ```json fence even when the closing fence has not streamed yet. */
function stripJsonFence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```')) return trimmed
  const firstLineBreak = trimmed.indexOf('\n')
  if (firstLineBreak < 0) return ''
  const body = trimmed.slice(firstLineBreak + 1)
  const closingFence = body.lastIndexOf('```')
  return (closingFence >= 0 ? body.slice(0, closingFence) : body).trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stepFromRecord(value: unknown): ComputerPlanStepView | null {
  if (!isRecord(value)) return null
  const dependsOn = Array.isArray(value.dependsOn) ? value.dependsOn.filter((item): item is string => typeof item === 'string') : []
  return {
    id: typeof value.id === 'string' && value.id ? value.id : undefined,
    role: typeof value.role === 'string' ? value.role : undefined,
    objective: typeof value.objective === 'string' && value.objective.trim() ? value.objective.trim() : undefined,
    dependsOn,
  }
}

function conditionFromRecord(value: unknown): ComputerConditionView | null {
  if (!isRecord(value) || !CONDITION_KINDS.includes(String(value.kind))) return null
  const view = computerConditionText(value)
  return view.text ? view : null
}

/**
 * Extract the raw object slices of `"key":[{…},{…}` while the JSON is still
 * streaming: complete objects plus the trailing partial object, if any. Used
 * only for display, so structural shortcuts are fine.
 */
function partialArrayObjects(text: string, key: string): { slice: string; complete: boolean }[] {
  const keyAt = text.indexOf(`"${key}"`)
  if (keyAt < 0) return []
  const open = text.indexOf('[', keyAt)
  if (open < 0) return []
  const objects: { slice: string; complete: boolean }[] = []
  let depth = 0
  let objectStart = -1
  let inString = false
  for (let index = open + 1; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (char === '\\') { index += 1; continue }
      if (char === '"') inString = false
      continue
    }
    if (char === '"') { inString = true; continue }
    if (char === '{') {
      if (depth === 0) objectStart = index
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      if (depth === 0 && objectStart >= 0) {
        objects.push({ slice: text.slice(objectStart, index + 1), complete: true })
        objectStart = -1
      }
      continue
    }
    if (char === ']' && depth === 0) break
    if (char === ',' && depth === 0) continue
  }
  // Trailing partial object: everything after the last complete one.
  if (depth > 0 && objectStart >= 0) objects.push({ slice: text.slice(objectStart), complete: false })
  return objects
}

function stepFromPartial(slice: string): ComputerPlanStepView {
  return {
    id: scrapeJSONString('id', slice),
    role: scrapeJSONString('role', slice),
    objective: scrapeJSONString('objective', slice),
    dependsOn: [],
  }
}

function conditionFromPartial(slice: string): ComputerConditionView | null {
  const kind = scrapeJSONString('kind', slice)
  if (!kind || !CONDITION_KINDS.includes(kind)) return null
  const candidate: Record<string, unknown> = { kind }
  const value = scrapeJSONString('contains', slice) ?? scrapeJSONString('name', slice) ?? scrapeJSONString('path', slice) ?? scrapeJSONString('description', slice)
  if (!value) return null
  const field = kind === 'visible_text' ? 'contains' : kind === 'element_exists' ? 'name' : kind === 'file_exists' ? 'path' : 'description'
  candidate[field] = value
  return computerConditionText(candidate)
}

function planFromParsed(value: unknown): ComputerPlanView | null {
  if (!isRecord(value) || !Array.isArray(value.steps) || value.steps.length === 0) return null
  const steps = value.steps.map(stepFromRecord).filter((step): step is ComputerPlanStepView => step !== null)
  if (steps.length === 0) return null
  const conditions = Array.isArray(value.successConditions)
    ? value.successConditions.map(conditionFromRecord).filter((condition): condition is ComputerConditionView => condition !== null)
    : []
  return {
    goal: typeof value.goal === 'string' && value.goal.trim() ? value.goal.trim() : undefined,
    revision: typeof value.revision === 'number' && Number.isInteger(value.revision) ? value.revision : undefined,
    steps,
    successConditions: conditions,
    complete: true,
    raw: '',
  }
}

/**
 * Detect and project a Computer Use plan from a leader text segment. Complete
 * JSON yields a full view; while streaming, per-step/objective scrapes yield a
 * growing card (`complete: false`). Returns null for anything that is not a
 * plan — plain prose and unrelated JSON keep their normal rendering.
 */
export function parseComputerPlanSegment(text: string): ComputerPlanView | null {
  const body = stripJsonFence(text)
  if (!body.startsWith('{') || !body.includes('"steps"')) return null
  try {
    const parsed = planFromParsed(JSON.parse(body))
    if (parsed) return { ...parsed, raw: body }
  } catch { /* fall through to the streaming scrape */ }
  const steps = partialArrayObjects(body, 'steps').map(item =>
    item.complete
      ? (() => {
        try { return stepFromRecord(JSON.parse(item.slice)) ?? stepFromPartial(item.slice) } catch { return stepFromPartial(item.slice) }
      })()
      : stepFromPartial(item.slice),
  ).filter((step): step is ComputerPlanStepView => Boolean(step?.objective || step?.role || step?.id))
  if (!steps.length) return null
  const successConditions = partialArrayObjects(body, 'successConditions')
    .map(item => (item.complete
      ? (() => {
        try { return conditionFromRecord(JSON.parse(item.slice)) } catch { return conditionFromPartial(item.slice) }
      })()
      : conditionFromPartial(item.slice)))
    .filter((condition): condition is ComputerConditionView => condition !== null)
  return {
    goal: scrapeJSONString('goal', body),
    steps,
    successConditions,
    complete: false,
    raw: body,
  }
}

function episodeFromRecord(value: unknown): ComputerEpisodeView | null {
  if (!isRecord(value) || typeof value.agentId !== 'string') return null
  const result = isRecord(value.result) ? value.result : {}
  return {
    agentId: value.agentId,
    runId: typeof value.runId === 'string' ? value.runId : undefined,
    role: typeof value.role === 'string' ? value.role : '',
    name: typeof value.name === 'string' ? value.name : '',
    terminalState: typeof value.terminalState === 'string' ? value.terminalState : '',
    outcome: typeof result.outcome === 'string' ? result.outcome : '',
    failureCode: typeof result.failureCode === 'string' ? result.failureCode : undefined,
  }
}

/**
 * Parse a finished `computer_task` tool result: `prose\n\nEpisode ledger:\n{json}`.
 * The JSON envelope keeps `episodeLedger` as its first key; `plan`,
 * `verification` and `investigation` are newer optional members. Returns null
 * unless an `episodeLedger` array is present so older/garbled output falls back
 * to the plain-text view.
 */
/**
 * Parse a Computer Use worker's closed verdict JSON:
 * `{"outcome":"completed|verified|failed|blocked","summary":"..."}`.
 * Incomplete SSE snapshots stay null so the transcript keeps showing the
 * growing JSON until the object closes, then the card replaces it.
 */
export function parseComputerWorkerResult(text: string): ComputerWorkerResultView | null {
  const body = stripJsonFence(text)
  if (!body.startsWith('{') || body.includes('"steps"') || body.includes('episodeLedger')) return null
  try {
    const parsed = JSON.parse(body)
    if (!isRecord(parsed) || typeof parsed.outcome !== 'string' || typeof parsed.summary !== 'string') return null
    if (!(WORKER_OUTCOMES as readonly string[]).includes(parsed.outcome)) return null
    return {
      outcome: parsed.outcome as ComputerWorkerOutcome,
      summary: parsed.summary,
      failureCode: typeof parsed.failureCode === 'string' ? parsed.failureCode : undefined,
      complete: true,
      raw: body,
    }
  } catch {
    return null
  }
}

export function parseComputerTaskResult(text: string): ComputerTaskResultView | null {
  const marker = text.lastIndexOf(EPISODE_LEDGER_MARKER)
  if (marker < 0) return null
  const summary = text.slice(0, marker).trim()
  let envelope: unknown
  try {
    envelope = JSON.parse(text.slice(marker + EPISODE_LEDGER_MARKER.length))
  } catch {
    return null
  }
  if (!isRecord(envelope) || !Array.isArray(envelope.episodeLedger)) return null
  const episodes = envelope.episodeLedger.map(episodeFromRecord).filter((episode): episode is ComputerEpisodeView => episode !== null)
  const plan = planFromParsed(envelope.plan) ?? undefined
  const verification = isRecord(envelope.verification) && typeof envelope.verification.status === 'string'
    ? {
        status: String(envelope.verification.status),
        conditionResults: (Array.isArray(envelope.verification.conditionResults) ? envelope.verification.conditionResults : []).flatMap((item) => {
          if (!isRecord(item) || typeof item.conditionId !== 'string' || typeof item.outcome !== 'string') return []
          return [{ conditionId: item.conditionId, outcome: item.outcome }]
        }),
        claims: (Array.isArray(envelope.verification.claims) ? envelope.verification.claims : []).flatMap((item) => {
          if (!isRecord(item) || typeof item.claim !== 'string' || typeof item.evidenceRef !== 'string') return []
          return [{ claim: item.claim, evidenceRef: item.evidenceRef }]
        }),
      }
    : undefined
  const investigationRecord = isRecord(envelope.investigation) ? envelope.investigation : undefined
  const investigation = investigationRecord
    ? {
        stage: typeof investigationRecord.stage === 'string' ? investigationRecord.stage : undefined,
        code: typeof investigationRecord.code === 'string' ? investigationRecord.code : undefined,
        workerAttempts: (Array.isArray(investigationRecord.workerAttempts) ? investigationRecord.workerAttempts : []).flatMap((item) => {
          if (!isRecord(item) || typeof item.stepId !== 'string') return []
          return [{
            stepId: item.stepId,
            role: typeof item.role === 'string' ? item.role : '',
            outcome: typeof item.outcome === 'string' ? item.outcome : '',
            verification: typeof item.verification === 'string' ? item.verification : 'unknown',
            failureCode: typeof item.failureCode === 'string' ? item.failureCode : undefined,
            agentId: typeof item.agentId === 'string' ? item.agentId : undefined,
          }]
        }),
      }
    : undefined
  return { summary, episodes, plan, verification, investigation }
}

export type ComputerStepStatus = 'ok' | 'failed' | 'unknown' | 'pending'

/**
 * Per-step status for the finished card: the newest `workerAttempts` entry for
 * each plan step decides; steps without attempts stayed unexecuted. Synthetic
 * verifier passes (`<stepId>-verify`) count toward their parent step.
 */
export function computerStepStatuses(result: ComputerTaskResultView): Array<{ step: ComputerPlanStepView; status: ComputerStepStatus; attempt?: ComputerWorkerAttemptView }> {
  const steps = result.plan?.steps ?? []
  const attempts = result.investigation?.workerAttempts ?? []
  return steps.map(step => {
    const related = attempts.filter(attempt =>
      attempt.stepId === step.id
      || attempt.stepId.startsWith(`${step.id}-`),
    )
    const latest = related.at(-1)
    if (!latest) return { step, status: 'pending' }
    if (latest.verification === 'verified' || latest.outcome === 'completed' || latest.outcome === 'verified') return { step, status: 'ok', attempt: latest }
    if (latest.outcome === 'failed' || latest.outcome === 'blocked') return { step, status: 'failed', attempt: latest }
    return { step, status: 'unknown', attempt: latest }
  })
}

/** Root episode is the single Computer Use Agent; legacy Leader envelopes remain readable. */
export function computerTaskOutcome(result: ComputerTaskResultView): { label: string; ok: boolean } {
  const root = result.episodes.find(episode => episode.name === 'computer-use' || episode.role === 'computer-use-agent')
    ?? result.episodes.find(episode => episode.name === 'computer-use-leader')
  const outcome = root?.outcome
  if (outcome === 'completed' || outcome === 'succeeded') return { label: '任务完成', ok: true }
  if (outcome === 'cancelled') return { label: '任务已取消', ok: false }
  if (root?.terminalState === 'stalled') return { label: 'Agent 超时受阻', ok: false }
  return { label: '任务受阻', ok: false }
}
