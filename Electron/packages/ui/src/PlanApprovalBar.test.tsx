// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI, PlanSnapshot } from '@pipi/host-api'
import { PLAN_APPROVE_PROMPT, PlanApprovalBar, userHasApprovedDraft } from './PlanApprovalBar'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function draft(overrides: Partial<PlanSnapshot> = {}): PlanSnapshot {
  return {
    id: 'plan-draft',
    title: 'Pi-Coc 原始 PDF 模组导入与自然玩法验收',
    lifecycle: 'draft',
    createdAt: '2026-08-23T15:00:00.000Z',
    updatedAt: '2026-08-23T15:04:00.000Z',
    tasks: [{ id: 'a', title: '第一步', state: 'pending' }],
    ...overrides,
  }
}

function hostWith(plans: PlanSnapshot[]) {
  const host = {
    getPlans: vi.fn(async () => plans),
    subscribePlans: () => () => undefined,
  } as unknown as PipiHostAPI
  return { host }
}

describe('userHasApprovedDraft', () => {
  it('accepts 批准该计划 at or after the draft was published', () => {
    expect(userHasApprovedDraft(draft(), { content: PLAN_APPROVE_PROMPT, timestamp: Date.parse('2026-08-23T15:11:00.000Z') })).toBe(true)
    expect(userHasApprovedDraft(draft(), { content: PLAN_APPROVE_PROMPT, timestamp: Date.parse('2026-08-23T14:00:00.000Z') })).toBe(false)
    expect(userHasApprovedDraft(draft(), { content: '同意' })).toBe(false)
  })
})

describe('PlanApprovalBar', () => {
  it('shows 批准 for a live draft', async () => {
    const { host } = hostWith([draft()])
    render(<PlanApprovalBar host={host} sessionId="s1" onSend={vi.fn()} />)
    expect(await screen.findByTestId('plan-approval-bar')).toBeTruthy()
    expect(screen.getByRole('button', { name: '批准' })).toBeTruthy()
  })

  it('hides after 批准 even if the host object is replaced while the plan stays draft', async () => {
    const first = hostWith([draft()])
    const send = vi.fn()
    const view = render(<PlanApprovalBar host={first.host} sessionId="s1" onSend={send} />)
    await screen.findByTestId('plan-approval-bar')
    fireEvent.click(screen.getByTestId('plan-approval-approve'))
    expect(send).toHaveBeenCalledWith(PLAN_APPROVE_PROMPT)
    expect(screen.queryByTestId('plan-approval-bar')).toBeNull()

    const second = hostWith([draft()])
    view.rerender(<PlanApprovalBar host={second.host} sessionId="s1" onSend={send} />)
    await waitFor(() => expect(second.host.getPlans).toHaveBeenCalledWith('s1'))
    expect(screen.queryByTestId('plan-approval-bar')).toBeNull()
  })

  it('hides a still-draft plan after the user already sent 批准该计划', async () => {
    const { host } = hostWith([draft()])
    render(<PlanApprovalBar
      host={host}
      sessionId="s1"
      onSend={vi.fn()}
      lastUser={{ content: PLAN_APPROVE_PROMPT, timestamp: Date.parse('2026-08-23T15:11:00.000Z') }}
    />)
    await waitFor(() => expect(host.getPlans).toHaveBeenCalled())
    expect(screen.queryByTestId('plan-approval-bar')).toBeNull()
  })

  it('still shows 批准 for a newer draft published after an earlier approval', async () => {
    const { host } = hostWith([draft({
      id: 'plan-draft-v2',
      createdAt: '2026-08-23T16:00:00.000Z',
      updatedAt: '2026-08-23T16:00:00.000Z',
    })])
    render(<PlanApprovalBar
      host={host}
      sessionId="s1"
      onSend={vi.fn()}
      lastUser={{ content: PLAN_APPROVE_PROMPT, timestamp: Date.parse('2026-08-23T15:11:00.000Z') }}
    />)
    expect(await screen.findByTestId('plan-approval-bar')).toBeTruthy()
  })

  it('keeps the approval bar visible while the session is working', async () => {
    const { host } = hostWith([draft()])
    render(<PlanApprovalBar host={host} sessionId="s1" busy onSend={vi.fn()} />)
    expect(await screen.findByTestId('plan-approval-bar')).toBeTruthy()
  })
})
