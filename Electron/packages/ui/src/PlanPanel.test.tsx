// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI, PlanEvent, PlanSnapshot } from '@pipi/host-api'
import { PlanPanel } from './PlanPanel'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function plan(overrides: Partial<PlanSnapshot> = {}): PlanSnapshot {
  return {
    id: 'plan-1',
    title: '接上 plan 前端',
    lifecycle: 'approved',
    createdAt: '2026-08-18T01:00:00.000Z',
    updatedAt: '2026-08-18T01:05:00.000Z',
    tasks: [
      { id: 'a', title: '定义契约', state: 'completed' },
      { id: 'b', title: '实现面板', state: 'in_progress' },
      { id: 'c', title: '补测试', state: 'pending' },
    ],
    ...overrides,
  }
}

function hostWith(plans: PlanSnapshot[]) {
  let emit: ((event: PlanEvent) => void) | undefined
  const host = {
    getPlans: vi.fn(async () => plans),
    subscribePlans: (listener: (event: PlanEvent) => void) => { emit = listener; return () => { emit = undefined } },
  } as unknown as PipiHostAPI
  return { host, push: (event: PlanEvent) => act(() => emit?.(event)) }
}

describe('PlanPanel', () => {
  it('renders the published plan with per-task state and a completed count', async () => {
    const { host } = hostWith([plan()])
    render(<PlanPanel host={host} sessionId="s1" />)

    expect((await screen.findByTestId('plan-card')).textContent).toContain('接上 plan 前端')
    expect(screen.getByTestId('plan-card-count').textContent).toBe('1/3 步完成')
    const tasks = screen.getAllByTestId('plan-task')
    expect(tasks.map(task => task.getAttribute('data-state'))).toEqual(['completed', 'in_progress', 'pending'])
    expect(tasks[1].textContent).toContain('实现面板')
    expect(tasks[1].textContent).toContain('进行中')
    expect(screen.getByText('已批准')).toBeTruthy()
  })

  it('advances a task live from a plan_task_update event', async () => {
    const { host, push } = hostWith([plan()])
    render(<PlanPanel host={host} sessionId="s1" />)
    await screen.findByTestId('plan-card')

    push({
      type: 'plan',
      sessionId: 's1',
      kind: 'plan_task_update',
      plan: plan({ updatedAt: '2026-08-18T01:09:00.000Z', tasks: [
        { id: 'a', title: '定义契约', state: 'completed' },
        { id: 'b', title: '实现面板', state: 'completed', note: '面板已接上事件' },
        { id: 'c', title: '补测试', state: 'in_progress' },
      ] }),
    })

    await waitFor(() => expect(screen.getByTestId('plan-card-count').textContent).toBe('2/3 步完成'))
    expect(screen.getAllByTestId('plan-task')[1].textContent).toContain('面板已接上事件')
    expect(screen.getAllByTestId('plan-card')).toHaveLength(1)
  })

  it('ignores plan events belonging to another session', async () => {
    const { host, push } = hostWith([plan()])
    render(<PlanPanel host={host} sessionId="s1" />)
    await screen.findByTestId('plan-card')

    push({ type: 'plan', sessionId: 'other', kind: 'plan_publish', plan: plan({ id: 'plan-2', title: '别的会话' }) })

    expect(screen.queryByText('别的会话')).toBeNull()
    expect(screen.getAllByTestId('plan-card')).toHaveLength(1)
  })

  it('promotes another session from a live event but does not demote it from a settled one', async () => {
    const onHasPlansChange = vi.fn()
    const { host, push } = hostWith([plan()])
    render(<PlanPanel host={host} sessionId="s1" onHasPlansChange={onHasPlansChange} />)
    await waitFor(() => expect(onHasPlansChange).toHaveBeenCalledWith('s1', true))
    onHasPlansChange.mockClear()

    push({ type: 'plan', sessionId: 'other', kind: 'plan_publish', plan: plan({ id: 'plan-2', title: '别的会话' }) })
    await waitFor(() => expect(onHasPlansChange).toHaveBeenCalledWith('other', true))

    push({
      type: 'plan',
      sessionId: 'other',
      kind: 'plan_task_update',
      plan: plan({
        id: 'plan-2',
        title: '别的会话',
        tasks: [{ id: 'a', title: '收尾', state: 'completed' }],
      }),
    })
    expect(onHasPlansChange).not.toHaveBeenCalledWith('other', false)
    expect(onHasPlansChange).toHaveBeenLastCalledWith('other', true)
  })

  it('separates finished and cancelled plans from the live one', async () => {
    const done = plan({ id: 'plan-done', title: '已完成的计划', tasks: [{ id: 'a', title: '收尾', state: 'completed' }] })
    const cancelled = plan({ id: 'plan-x', title: '被取消的计划', lifecycle: 'cancelled', cancelReason: '需求变了' })
    const { host } = hostWith([plan(), done, cancelled])
    render(<PlanPanel host={host} sessionId="s1" />)

    await screen.findByTestId('plan-settled-title')
    expect(screen.getByTestId('plan-settled-title').textContent).toContain('2')
    const cards = screen.getAllByTestId('plan-card')
    expect(cards[0].getAttribute('data-plan-id')).toBe('plan-1')
    expect(cards[0].hasAttribute('open')).toBe(true)
    expect(cards[cards.length - 1].hasAttribute('open')).toBe(false)
    expect(screen.getByText('取消原因：需求变了')).toBeTruthy()
  })

  it('reports live progress for the rail badge and drops it once nothing is unfinished', async () => {
    const onProgressChange = vi.fn()
    const { host, push } = hostWith([plan()])
    render(<PlanPanel host={host} sessionId="s1" onProgressChange={onProgressChange} />)

    await waitFor(() => expect(onProgressChange).toHaveBeenCalledWith({ completed: 1, total: 3 }))
    push({
      type: 'plan',
      sessionId: 's1',
      kind: 'plan_task_update',
      plan: plan({ updatedAt: '2026-08-18T02:00:00.000Z', tasks: [
        { id: 'a', title: '定义契约', state: 'completed' },
        { id: 'b', title: '实现面板', state: 'completed' },
        { id: 'c', title: '补测试', state: 'skipped' },
      ] }),
    })
    await waitFor(() => expect(onProgressChange).toHaveBeenLastCalledWith(null))
  })

  it('shows the empty state when the session published no plan', async () => {
    const { host } = hostWith([])
    render(<PlanPanel host={host} sessionId="s1" />)
    expect((await screen.findByTestId('plan-empty')).textContent).toContain('还没有计划')
  })

  it('reports whether the session has any plan so the rail can hide the tab', async () => {
    const onHasPlansChange = vi.fn()
    const { host, push } = hostWith([])
    render(<PlanPanel host={host} sessionId="s1" onHasPlansChange={onHasPlansChange} />)

    await waitFor(() => expect(onHasPlansChange).toHaveBeenCalledWith('s1', false))
    push({ type: 'plan', sessionId: 's1', kind: 'plan_publish', plan: plan() })
    await waitFor(() => expect(onHasPlansChange).toHaveBeenCalledWith('s1', true))
  })

  it('does not treat historical settled plans as a reason to show the rail tab', async () => {
    const onHasPlansChange = vi.fn()
    const settled = plan({
      id: 'plan-done',
      title: '已完成的计划',
      tasks: [{ id: 'a', title: '收尾', state: 'completed' }],
    })
    const { host, push } = hostWith([settled])
    render(<PlanPanel host={host} sessionId="s1" onHasPlansChange={onHasPlansChange} />)

    await waitFor(() => expect(onHasPlansChange).toHaveBeenCalledWith('s1', false))
    push({ type: 'plan', sessionId: 's1', kind: 'plan_publish', plan: plan() })
    await waitFor(() => expect(onHasPlansChange).toHaveBeenCalledWith('s1', true))
    push({
      type: 'plan',
      sessionId: 's1',
      kind: 'plan_task_update',
      plan: plan({
        updatedAt: '2026-08-18T02:00:00.000Z',
        tasks: [
          { id: 'a', title: '定义契约', state: 'completed' },
          { id: 'b', title: '实现面板', state: 'completed' },
          { id: 'c', title: '补测试', state: 'skipped' },
        ],
      }),
    })
    await waitFor(() => expect(onHasPlansChange).toHaveBeenLastCalledWith('s1', false))
  })

  it('surfaces a failed read instead of pretending the session has no plan', async () => {
    const host = {
      getPlans: vi.fn(async () => { throw new Error('store unreadable') }),
      subscribePlans: () => () => undefined,
    } as unknown as PipiHostAPI
    render(<PlanPanel host={host} sessionId="s1" />)
    expect((await screen.findByTestId('plan-error')).textContent).toContain('store unreadable')
    expect(screen.queryByTestId('plan-empty')).toBeNull()
  })

  it('reloads for the newly selected session and clears the previous plans', async () => {
    const bySession: Record<string, PlanSnapshot[]> = { s1: [plan()], s2: [plan({ id: 'plan-2', title: '第二个会话的计划' })] }
    const host = {
      getPlans: vi.fn(async (sessionId?: string) => bySession[sessionId ?? ''] ?? []),
      subscribePlans: () => () => undefined,
    } as unknown as PipiHostAPI
    const { rerender } = render(<PlanPanel host={host} sessionId="s1" />)
    await screen.findByText('接上 plan 前端')

    rerender(<PlanPanel host={host} sessionId="s2" />)

    expect(await screen.findByText('第二个会话的计划')).toBeTruthy()
    expect(screen.queryByText('接上 plan 前端')).toBeNull()
  })
})
