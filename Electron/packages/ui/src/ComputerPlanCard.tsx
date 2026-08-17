import { memo } from 'react'
import { computerRoleLabel, type ComputerPlanView } from './computer-task-report'
import './computer-cards.css'

const GOAL_LIMIT = 80

/**
 * Structured view of the Computer Use Leader's plan JSON. Replaces the raw
 * JSON markdown dump in the leader's transcript; while the plan is still
 * streaming (`complete: false`) the rows grow one step at a time.
 */
export const ComputerPlanCard = memo(function ComputerPlanCard({ plan }: { plan: ComputerPlanView }) {
  const goal = plan.goal?.replace(/\s+/g, ' ').trim() ?? ''
  const title = goal.length > GOAL_LIMIT ? `${goal.slice(0, GOAL_LIMIT)}…` : goal
  return <section className="activity-card activity-card-tool computer-card computer-plan-card" data-testid="computer-plan-card">
    <div className="computer-card-head">
      <span className="activity-status" aria-hidden="true">{plan.complete ? '✓' : <span className="agent-spinner" aria-label="生成中" />}</span>
      <span className="activity-kind">计划</span>
      <b className="computer-card-goal" title={goal || undefined}>{title || '桌面任务计划'}</b>
      <small className="activity-meta">
        {plan.complete ? `共 ${plan.steps.length} 步${plan.revision ? ` · 第 ${plan.revision + 1} 版` : ''}` : `正在生成 · 已 ${plan.steps.length} 步`}
      </small>
    </div>
    <div className="computer-card-body">
      <ol className="computer-step-list">
        {plan.steps.map((step, index) => <li key={step.id ?? index} className="computer-step-row">
          <span className="computer-step-index">{index + 1}</span>
          <span className="computer-step-role">{computerRoleLabel(step.role)}</span>
          <span className="computer-step-objective">{step.objective || (step.role ? '…' : '')}</span>
          {step.dependsOn.length > 0 && <small className="computer-step-depends">依赖 {step.dependsOn.join('、')}</small>}
        </li>)}
      </ol>
      {plan.successConditions.length > 0 && <div className="computer-condition-list">
        <div className="computer-section-label">成功条件</div>
        {plan.successConditions.map((condition, index) => <div key={index} className="computer-condition-row">
          <span className="computer-condition-mark" aria-hidden="true">○</span>
          <span>{condition.text}</span>
        </div>)}
      </div>}
      <details className="computer-raw">
        <summary>原始 JSON</summary>
        <pre>{plan.raw}</pre>
      </details>
    </div>
  </section>
})
