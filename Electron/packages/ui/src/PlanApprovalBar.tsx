import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { planIsLive, sortPlans, type PlanEvent, type PlanSnapshot, type PipiHostAPI } from '@pipi/host-api'
import './plan-approval-bar.css'

export const PLAN_APPROVE_PROMPT = '批准该计划'

function newestDraftLivePlan(plans: PlanSnapshot[]): PlanSnapshot | null {
  const drafts = sortPlans(plans.filter(plan => plan.lifecycle === 'draft' && planIsLive(plan)))
  return drafts[0] ?? null
}

export function PlanApprovalBar({
  host,
  sessionId,
  readOnly,
  onSend,
}: {
  host: PipiHostAPI
  sessionId?: string
  readOnly?: boolean
  onSend: (prompt: string) => void | Promise<boolean | void>
}) {
  const [plans, setPlans] = useState<PlanSnapshot[]>([])
  const [dismissedPlanId, setDismissedPlanId] = useState<string | null>(null)
  const sessionRef = useRef(sessionId)
  sessionRef.current = sessionId

  const apply = useCallback((plan: PlanSnapshot) => {
    setPlans(current => sortPlans([...current.filter(item => item.id !== plan.id), plan]))
  }, [])

  useEffect(() => {
    setPlans([])
    setDismissedPlanId(null)
    if (!sessionId || !host.getPlans) return
    let cancelled = false
    void host.getPlans(sessionId).then(loaded => {
      if (!cancelled) setPlans(sortPlans(loaded))
    }).catch(() => {
      if (!cancelled) setPlans([])
    })
    return () => { cancelled = true }
  }, [host, sessionId])

  useEffect(() => {
    if (!host.subscribePlans) return
    return host.subscribePlans((event: PlanEvent) => {
      if (event.sessionId !== sessionRef.current) return
      apply(event.plan)
    })
  }, [host, apply])

  const draft = useMemo(() => newestDraftLivePlan(plans), [plans])
  if (!sessionId || readOnly || !draft || draft.id === dismissedPlanId) return null

  return (
    <div className="plan-approval-bar" data-testid="plan-approval-bar" data-plan-id={draft.id}>
      <span className="plan-approval-bar-label">计划待确认</span>
      <span className="plan-approval-bar-title">{draft.title}</span>
      <div className="plan-approval-bar-actions">
        <button
          type="button"
          className="plan-approval-bar-approve"
          data-testid="plan-approval-approve"
          onClick={() => {
            setDismissedPlanId(draft.id)
            void onSend(PLAN_APPROVE_PROMPT)
          }}
        >
          批准
        </button>
        <button
          type="button"
          className="plan-approval-bar-dismiss"
          aria-label="关闭计划批准提示"
          title="关闭计划批准提示"
          data-testid="plan-approval-dismiss"
          onClick={() => setDismissedPlanId(draft.id)}
        >
          ×
        </button>
      </div>
    </div>
  )
}
