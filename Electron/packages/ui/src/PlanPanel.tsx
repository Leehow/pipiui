import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { planProgress, planIsLive, sortPlans, type PlanEvent, type PlanSnapshot, type PlanTask, type PlanTaskState, type PipiHostAPI } from '@pipi/host-api'
import './plan-panel.css'

const STATE_TEXT: Record<PlanTaskState, string> = {
  pending: '待办',
  in_progress: '进行中',
  completed: '已完成',
  failed: '失败',
  blocked: '受阻',
  skipped: '已跳过',
}
const STATE_GLYPH: Record<PlanTaskState, string> = {
  pending: '○',
  in_progress: '◍',
  completed: '✓',
  failed: '×',
  blocked: '!',
  skipped: '–',
}
const LIFECYCLE_TEXT: Record<PlanSnapshot['lifecycle'], string> = { draft: '待确认', approved: '已批准', cancelled: '已取消' }

function stamp(value: string | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function TaskRow({ task, index }: { task: PlanTask; index: number }) {
  return <li className={`plan-task plan-task-${task.state}`} data-testid="plan-task" data-state={task.state}>
    <span className="plan-task-mark" aria-hidden="true">{STATE_GLYPH[task.state]}</span>
    <div className="plan-task-body">
      <div className="plan-task-title"><span className="plan-task-index">{index + 1}.</span>{task.title}</div>
      {task.note && <div className="plan-task-note">{task.note}</div>}
    </div>
    <span className="plan-task-state">{STATE_TEXT[task.state]}</span>
  </li>
}

/** Segmented bar: one slice per task, so a 3-of-7 plan reads without counting rows. */
function ProgressBar({ plan }: { plan: PlanSnapshot }) {
  return <div className="plan-progress-bar" role="presentation">
    {plan.tasks.map(task => <span key={task.id} className={`plan-progress-slice plan-progress-${task.state}`} title={`${task.title} · ${STATE_TEXT[task.state]}`} />)}
  </div>
}

export function PlanCard({ plan, defaultOpen }: { plan: PlanSnapshot; defaultOpen: boolean }) {
  const progress = useMemo(() => planProgress(plan), [plan])
  return <details className="plan-card" data-testid="plan-card" data-plan-id={plan.id} open={defaultOpen}>
    <summary className="plan-card-summary">
      <div className="plan-card-heading">
        <b className="plan-card-title">{plan.title}</b>
        <span className={`plan-lifecycle plan-lifecycle-${plan.lifecycle}`}>{LIFECYCLE_TEXT[plan.lifecycle]}</span>
      </div>
      <div className="plan-card-meta">
        <span className="plan-card-count" data-testid="plan-card-count">{progress.completed}/{progress.total} 步完成</span>
        {progress.in_progress > 0 && <span className="plan-card-running">{progress.in_progress} 进行中</span>}
        {progress.failed > 0 && <span className="plan-card-failed">{progress.failed} 失败</span>}
        {progress.blocked > 0 && <span className="plan-card-blocked">{progress.blocked} 受阻</span>}
        <small className="plan-card-time">{stamp(plan.updatedAt)}</small>
      </div>
      <ProgressBar plan={plan} />
    </summary>
    {plan.cancelReason && <p className="plan-cancel-reason">取消原因：{plan.cancelReason}</p>}
    <ol className="plan-task-list">{plan.tasks.map((task, index) => <TaskRow key={task.id} task={task} index={index} />)}</ol>
  </details>
}

function PlanHeader({ plans }: { plans: PlanSnapshot[] }) {
  const live = plans.filter(planIsLive)
  const progress = live.length === 1 ? planProgress(live[0]) : null
  return <div className="plan-header" data-testid="plan-header">
    <b>Plan</b>
    {progress
      ? <span className="plan-header-progress">{progress.completed}/{progress.total}</span>
      : plans.length > 0 && <span className="plan-header-progress">{plans.length} 个计划</span>}
  </div>
}

/**
 * Live view of the plans this session published through the plan tools.
 *
 * The runtime owns the state — this panel never mutates a plan. It hydrates
 * from `getPlans` on session switch and then follows `plan` channel events, so
 * a step flipping to `in_progress` shows up without a refresh.
 */
export function PlanPanel({ host, sessionId, visible = true, headerSlot, onProgressChange, onHasPlansChange }: { host: PipiHostAPI; sessionId?: string; visible?: boolean; headerSlot?: HTMLElement | null; onProgressChange?: (progress: { completed: number; total: number } | null) => void; onHasPlansChange?: (sessionId: string, hasPlans: boolean) => void }) {
  const [plans, setPlans] = useState<PlanSnapshot[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Skip reporting while the next session's snapshot is in flight so a reset to
  // [] cannot flicker the rail tab off before getPlans returns.
  const [hydrated, setHydrated] = useState(false)
  const sessionRef = useRef(sessionId)
  sessionRef.current = sessionId
  const onHasPlansChangeRef = useRef(onHasPlansChange)
  onHasPlansChangeRef.current = onHasPlansChange

  const apply = useCallback((plan: PlanSnapshot) => {
    setPlans(current => sortPlans([...current.filter(item => item.id !== plan.id), plan]))
  }, [])

  useEffect(() => {
    setPlans([])
    setError(null)
    setHydrated(false)
    if (!sessionId || !host.getPlans) return
    let cancelled = false
    setLoading(true)
    void host.getPlans(sessionId)
      .then(loaded => {
        if (cancelled) return
        setPlans(sortPlans(loaded))
        setHydrated(true)
      })
      .catch(loadError => {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : String(loadError))
        setHydrated(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [host, sessionId])

  useEffect(() => {
    if (!host.subscribePlans) return
    return host.subscribePlans((event: PlanEvent) => {
      // Events arrive for every session the host runs; keep the panel to its own.
      if (event.sessionId !== sessionRef.current) {
        // Without that session's full list we can only promote: a live event
        // may reveal the tab on switch. A settled snapshot must not hide it
        // while another plan in that session may still be live.
        if (planIsLive(event.plan)) onHasPlansChangeRef.current?.(event.sessionId, true)
        return
      }
      apply(event.plan)
    })
  }, [host, apply])

  const live = useMemo(() => plans.filter(planIsLive), [plans])
  const settled = useMemo(() => plans.filter(plan => !planIsLive(plan)), [plans])

  // The rail tab follows unfinished plans only. Historical completed/cancelled
  // plans stay in the panel data but must not keep the tab visible.
  useEffect(() => {
    if (!sessionId || !hydrated) return
    onHasPlansChangeRef.current?.(sessionId, live.length > 0)
  }, [sessionId, live, hydrated])

  // The rail badge tracks unfinished plans only; a settled plan stops advertising itself.
  useEffect(() => {
    if (!onProgressChange) return
    if (!live.length) return onProgressChange(null)
    const totals = live.reduce((sum, plan) => {
      const progress = planProgress(plan)
      return { completed: sum.completed + progress.completed, total: sum.total + progress.total }
    }, { completed: 0, total: 0 })
    onProgressChange(totals.total ? totals : null)
  }, [live, onProgressChange])

  return <div className="plan-panel" data-testid="plan-panel">
    {headerSlot && visible && createPortal(<PlanHeader plans={plans} />, headerSlot)}
    <div className="plan-scroll">
      {error && <div className="plan-error" data-testid="plan-error">读取计划失败：{error}</div>}
      {!error && plans.length === 0 && <div className="empty-panel" data-testid="plan-empty">
        <b>还没有计划</b>
        <p>{loading ? '正在读取计划…' : '当 Agent 用 plan 工具发布结构化计划后，这里会列出每一步以及它的进展。'}</p>
      </div>}
      {live.map(plan => <PlanCard key={plan.id} plan={plan} defaultOpen />)}
      {settled.length > 0 && <>
        <div className="plan-section-title" data-testid="plan-settled-title">已结束（{settled.length}）</div>
        {settled.map(plan => <PlanCard key={plan.id} plan={plan} defaultOpen={false} />)}
      </>}
    </div>
  </div>
}
