import { memo } from 'react'
import { TranscriptMarkdown } from './TranscriptMarkdown'
import { scrapeJSONString } from './tool-summary'
import { TruncatedText } from './TruncatedText'
import {
  computerOutcomeLabel,
  computerRoleLabel,
  computerStepStatuses,
  computerTaskOutcome,
  type ComputerTaskResultView,
  type ComputerWorkerResultView,
} from './computer-task-report'
import './computer-cards.css'

const GOAL_LIMIT = 80

const STEP_STATUS: Record<string, { icon: string; label: string }> = {
  ok: { icon: '✓', label: '完成' },
  failed: { icon: '×', label: '失败' },
  unknown: { icon: '?', label: '结果未知' },
  pending: { icon: '○', label: '未执行' },
}

function shortAgentId(agentId: string | undefined): string | undefined {
  return agentId ? agentId.slice(0, 12) : undefined
}

/**
 * Structured view of a finished `computer_task` tool result. Replaces the raw
 * `prose + Episode ledger JSON` dump: outcome header, the leader's conclusion
 * as markdown, a per-step checklist, verification conditions, and the raw
 * payload collapsed into technical details.
 */
export const ComputerTaskResultCard = memo(function ComputerTaskResultCard({ result, goal, raw, elapsed, onOpenSubagents }: { result: ComputerTaskResultView; goal?: string; raw?: string; elapsed?: string; onOpenSubagents?: (agentId?: string) => void }) {
  const outcome = computerTaskOutcome(result)
  const statuses = computerStepStatuses(result)
  const conditions = result.plan?.successConditions ?? []
  const conditionResults = result.verification?.conditionResults ?? []
  const goalText = (result.plan?.goal ?? goal ?? '').replace(/\s+/g, ' ').trim()
  const title = goalText.length > GOAL_LIMIT ? `${goalText.slice(0, GOAL_LIMIT)}…` : goalText
  const openSubagents = (event: React.MouseEvent) => {
    event.stopPropagation()
    onOpenSubagents?.(result.episodes.find(episode => episode.name === 'computer-use-leader')?.agentId)
  }
  return <section className={`activity-card activity-card-tool computer-card computer-result-card${outcome.ok ? '' : ' computer-card-error'}`} data-testid="computer-result-card">
    <button className="computer-card-head" onClick={onOpenSubagents ? openSubagents : undefined} title={onOpenSubagents ? '打开 Subagents 面板' : undefined}>
      <span className="activity-status" aria-hidden="true">{outcome.ok ? '✓' : '×'}</span>
      <span className="activity-kind">桌面任务</span>
      <b className="computer-card-goal" title={goalText || undefined}>{title || outcome.label}</b>
      <small className="activity-meta">{[outcome.label, elapsed].filter(Boolean).join(' · ')}</small>
    </button>
    <div className="computer-card-body">
      {result.summary && <div className="computer-result-summary"><TranscriptMarkdown content={result.summary} /></div>}
      {statuses.length > 0 && <div className="computer-step-list">
        <div className="computer-section-label">执行步骤</div>
        {statuses.map(({ step, status, attempt }, index) => {
          const state = STEP_STATUS[status] ?? STEP_STATUS.unknown
          return <div key={step.id ?? index} className="computer-step-row computer-step-done">
            <span className={`computer-step-status ${status}`} aria-hidden="true">{state.icon}</span>
            <span className="computer-step-role">{computerRoleLabel(step.role)}</span>
            <span className="computer-step-objective">{step.objective || step.id}</span>
            <small className="computer-step-meta">
              {state.label}{attempt?.failureCode ? ` · ${attempt.failureCode}` : ''}
            </small>
          </div>
        })}
      </div>}
      {conditions.length > 0 && <div className="computer-condition-list">
        <div className="computer-section-label">成功条件</div>
        {conditions.map((condition, index) => {
          // `task:condition:N` ids index into plan.successConditions; envelopes
          // without verification results fall back to an unlabelled circle.
          const outcome = conditionResults.find(item => item.conditionId === `task:condition:${index}`)?.outcome
          const mark = outcome === 'verified' ? '✓' : outcome === 'not_verified' ? '✗' : '○'
          return <div key={index} className="computer-condition-row">
            <span className={`computer-condition-mark ${outcome ?? 'unknown'}`} aria-hidden="true">{mark}</span>
            <span>{condition.text}</span>
          </div>
        })}
      </div>}
      <details className="computer-raw">
        <summary>技术详情</summary>
        {result.episodes.length > 0 && <ul className="computer-episode-list">
          {result.episodes.map((episode, index) => <li key={`${episode.agentId}:${episode.runId ?? index}`}>
            <span className={`computer-episode-state ${episode.terminalState || 'unknown'}`}>{episode.terminalState || '?'}</span>
            <span>{computerRoleLabel(episode.role) || episode.name}</span>
            {shortAgentId(episode.agentId) && <small className="computer-step-meta"> {shortAgentId(episode.agentId)}</small>}
            <small className="computer-step-meta"> · {computerOutcomeLabel(episode.outcome)}{episode.failureCode ? ` · ${episode.failureCode}` : ''}</small>
          </li>)}
        </ul>}
        {raw && <pre className="computer-raw-pre"><TruncatedText text={raw} /></pre>}
      </details>
    </div>
  </section>
})

/** Goal argument from the tool-call input, even when the plan is absent from the envelope. */
export function computerTaskGoalFromInput(input: string | undefined): string | undefined {
  return input ? scrapeJSONString('goal', input) : undefined
}

const WORKER_OK = new Set(['completed', 'verified', 'succeeded'])

/** Closed `{outcome,summary}` verdict from operator / verifier / terminal workers. */
export const ComputerWorkerResultCard = memo(function ComputerWorkerResultCard({ result }: { result: ComputerWorkerResultView }) {
  const ok = WORKER_OK.has(result.outcome)
  return <section className={`activity-card activity-card-tool computer-card computer-result-card${ok ? '' : ' computer-card-error'}`} data-testid="computer-worker-result-card">
    <div className="computer-card-head">
      <span className="activity-status" aria-hidden="true">{ok ? '✓' : '×'}</span>
      <span className="activity-kind">结果</span>
      <b className="computer-card-goal">{computerOutcomeLabel(result.outcome)}</b>
      <small className="activity-meta">{ok ? '已完成' : computerOutcomeLabel(result.outcome)}</small>
    </div>
    <div className="computer-card-body">
      {result.summary && <div className="computer-result-summary"><TranscriptMarkdown content={result.summary} /></div>}
      <details className="computer-raw">
        <summary>技术详情</summary>
        <pre className="computer-raw-pre"><TruncatedText text={result.raw} /></pre>
      </details>
    </div>
  </section>
})
