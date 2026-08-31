import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { planIsLive, sortPlans, type PlanEvent, type PlanSnapshot, type PipiHostAPI } from '@pipi/host-api'
import './plan-approval-bar.css'

export const PLAN_APPROVE_PROMPT = '批准该计划'

export type PlanApprovalLastUser = {
  content: string
  timestamp?: number
}

function newestDraftLivePlan(plans: PlanSnapshot[]): PlanSnapshot | null {
  const drafts = sortPlans(plans.filter(plan => plan.lifecycle === 'draft' && planIsLive(plan)))
  return drafts[0] ?? null
}

/** True when the latest user turn already approved this draft (click or typed 批准该计划). */
export function userHasApprovedDraft(plan: PlanSnapshot, lastUser?: PlanApprovalLastUser | null): boolean {
  if (!lastUser || lastUser.content.trim() !== PLAN_APPROVE_PROMPT) return false
  if (lastUser.timestamp == null) return true
  const created = Date.parse(plan.createdAt)
  if (Number.isNaN(created)) return true
  return lastUser.timestamp >= created
}

export function PlanApprovalBar({
  host,
  sessionId,
  readOnly,
  lastUser,
  onSend,
}: {
  host: PipiHostAPI
  sessionId?: string
  readOnly?: boolean
  /** Kept for callers/tests: a pending approval must remain visible while the agent is busy. */
  busy?: boolean
  lastUser?: PlanApprovalLastUser | null
  onSend: (prompt: string) => void | Promise<boolean | void>
}) {
  const [plans, setPlans] = useState<PlanSnapshot[]>([])
  const [dismissedPlanId, setDismissedPlanId] = useState<string | null>(null)
  const sessionRef = useRef(sessionId)
  sessionRef.current = sessionId

  const apply = useCallback((plan: PlanSnapshot) => {
    setPlans(current => sortPlans([...current.filter(item => item.id !== plan.id), plan]))
  }, [])

  // Host identity is not a session change. Clearing dismiss here is what revived
  // "计划待确认" after 批准 while the model was still thinking (plan stays draft
  // until it calls plan_approve).
  useEffect(() => {
    setDismissedPlanId(null)
  }, [sessionId])

  useEffect(() => {
    setPlans([])
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
  const hidden = !sessionId || readOnly || !draft
    || draft.id === dismissedPlanId
    || userHasApprovedDraft(draft, lastUser)
  if (hidden) return null

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
