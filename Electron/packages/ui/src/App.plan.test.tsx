// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostCapabilities, PipiHostAPI, PlanEvent, PlanSnapshot } from '@pipi/host-api'

vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return { Virtuoso: React.forwardRef(({ data, itemContent }: { data: unknown[]; itemContent: (index: number, item: never) => JSX.Element }, ref) => { React.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() })); return <div>{data.map((item, index) => <React.Fragment key={index}>{itemContent(index, item as never)}</React.Fragment>)}</div> }) }
})
vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('@streamdown/code', () => ({ code: {} }))
vi.mock('@xterm/xterm', () => ({ Terminal: class { open = vi.fn(); write = vi.fn(); clear = vi.fn(); focus = vi.fn(); scrollToBottom = vi.fn(); loadAddon = vi.fn(); dispose = vi.fn(); buffer = { active: { viewportY: 0, baseY: 0 } }; onData = () => ({ dispose: vi.fn() }); onScroll = () => ({ dispose: vi.fn() }) } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

import { App, createMockHost } from './App'

const CAPABILITIES: HostCapabilities = { computerUse: false, revealInFinder: true, terminal: false, documents: true, browser: true, git: true, plan: true, retainedWorktreeDisposition: false }

function multicastPlans() {
  const listeners = new Set<(event: PlanEvent) => void>()
  return {
    subscribePlans: (listener: (event: PlanEvent) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    emit: (event: PlanEvent) => { for (const listener of listeners) listener(event) },
    get attached() { return listeners.size > 0 },
  }
}

beforeEach(() => { vi.unstubAllGlobals(); localStorage.clear(); Reflect.deleteProperty(window, 'pipiHost') })
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); Reflect.deleteProperty(window, 'pipiHost') })

function planFixture(tasks: PlanSnapshot['tasks']): PlanSnapshot {
  return { id: 'plan-1', title: '把 plan 接到前端', lifecycle: 'approved', createdAt: '2026-08-18T01:00:00.000Z', updatedAt: '2026-08-18T01:04:00.000Z', tasks }
}

describe('Plan tool panel wiring', () => {
  it('opens the Plan tab from the rail and shows the session plan', async () => {
    const host: PipiHostAPI = { ...createMockHost(), capabilities: async () => CAPABILITIES, getPlans: async () => [planFixture([
      { id: 'a', title: '定义 plan 契约', state: 'completed' },
      { id: 'b', title: '实现 Plan 面板', state: 'in_progress' },
    ])] }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')

    fireEvent.click(await screen.findByRole('button', { name: 'Plan' }))

    expect(await screen.findByTestId('plan-panel')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Plan' }).className).toContain('active')
    expect((await screen.findByTestId('plan-card')).textContent).toContain('把 plan 接到前端')
    expect(screen.getByTestId('plan-card-count').textContent).toBe('1/2 步完成')
  })

  it('tracks plan progress on the rail badge without opening the panel', async () => {
    const plans = multicastPlans()
    const host: PipiHostAPI = {
      ...createMockHost(),
      capabilities: async () => CAPABILITIES,
      getPlans: async () => [planFixture([
        { id: 'a', title: '定义 plan 契约', state: 'completed' },
        { id: 'b', title: '实现 Plan 面板', state: 'in_progress' },
        { id: 'c', title: '补测试', state: 'pending' },
      ])],
      subscribePlans: plans.subscribePlans,
    }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')

    // The Subagents tab stays active; the badge is the only plan surface on screen.
    const badge = await screen.findByTestId('tool-rail-plan-progress')
    expect(badge.textContent).toBe('1/3')
    expect(screen.getByRole('button', { name: 'Subagents' }).className).toContain('active')

    await waitFor(() => expect(plans.attached).toBe(true))
    act(() => plans.emit({ type: 'plan', sessionId: 'welcome', kind: 'plan_task_update', plan: planFixture([
      { id: 'a', title: '定义 plan 契约', state: 'completed' },
      { id: 'b', title: '实现 Plan 面板', state: 'completed' },
      { id: 'c', title: '补测试', state: 'in_progress' },
    ]) }))

    await waitFor(() => expect(screen.getByTestId('tool-rail-plan-progress').textContent).toBe('2/3'))
  })

  it('hides the Plan tab when the host advertises no plan capability', async () => {
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, capabilities: async () => ({ ...CAPABILITIES, plan: false }) }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull())
    expect(screen.queryByTestId('plan-panel')).toBeNull()
    expect(screen.queryByTestId('tool-rail-plan-progress')).toBeNull()
  })

  it('hides the Plan tab when the session has not published a plan', async () => {
    const getPlans = vi.fn(async () => [])
    const host: PipiHostAPI = { ...createMockHost(), capabilities: async () => CAPABILITIES, getPlans }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')

    await waitFor(() => expect(getPlans).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Subagents' }).className).toContain('active')
  })

  it('shows the Plan tab once the session publishes a plan', async () => {
    const plans = multicastPlans()
    const host: PipiHostAPI = {
      ...createMockHost(),
      capabilities: async () => CAPABILITIES,
      getPlans: async () => [],
      subscribePlans: plans.subscribePlans,
    }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull())
    await waitFor(() => expect(plans.attached).toBe(true))

    act(() => plans.emit({ type: 'plan', sessionId: 'welcome', kind: 'plan_publish', plan: planFixture([
      { id: 'a', title: '定义 plan 契约', state: 'pending' },
    ]) }))

    expect(await screen.findByRole('button', { name: 'Plan' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Subagents' }).className).toContain('active')
  })

  it('hides the Plan tab again after switching to a session without a plan', async () => {
    const plansBySession: Record<string, PlanSnapshot[]> = {
      welcome: [planFixture([{ id: 'a', title: '欢迎会话的计划', state: 'in_progress' }])],
    }
    const host: PipiHostAPI = {
      ...createMockHost(),
      capabilities: async () => CAPABILITIES,
      getPlans: async sessionId => plansBySession[sessionId ?? ''] ?? [],
    }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')

    fireEvent.click(await screen.findByRole('button', { name: 'Plan' }))
    expect(screen.getByRole('button', { name: 'Plan' }).className).toContain('active')

    fireEvent.click(await screen.findByText('布局与流式消息'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Subagents' }).className).toContain('active')
  })

  it('hides the Plan tab after the last live plan settles', async () => {
    const plans = multicastPlans()
    const host: PipiHostAPI = {
      ...createMockHost(),
      capabilities: async () => CAPABILITIES,
      getPlans: async () => [planFixture([{ id: 'a', title: '定义 plan 契约', state: 'in_progress' }])],
      subscribePlans: plans.subscribePlans,
    }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    expect(await screen.findByRole('button', { name: 'Plan' })).toBeTruthy()
    await waitFor(() => expect(plans.attached).toBe(true))

    act(() => plans.emit({
      type: 'plan',
      sessionId: 'welcome',
      kind: 'plan_task_update',
      plan: planFixture([{ id: 'a', title: '定义 plan 契约', state: 'completed' }]),
    }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Subagents' }).className).toContain('active')
  })

  it('leaves the Plan page for the default tool view when the last plan settles', async () => {
    const plans = multicastPlans()
    const host: PipiHostAPI = {
      ...createMockHost(),
      capabilities: async () => CAPABILITIES,
      getPlans: async () => [planFixture([
        { id: 'a', title: '定义 plan 契约', state: 'completed' },
        { id: 'b', title: '实现 Plan 面板', state: 'in_progress' },
      ])],
      subscribePlans: plans.subscribePlans,
    }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(await screen.findByRole('button', { name: 'Plan' }))
    expect(await screen.findByTestId('plan-panel')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Plan' }).className).toContain('active')
    await waitFor(() => expect(plans.attached).toBe(true))

    act(() => plans.emit({
      type: 'plan',
      sessionId: 'welcome',
      kind: 'plan_task_update',
      plan: planFixture([
        { id: 'a', title: '定义 plan 契约', state: 'completed' },
        { id: 'b', title: '实现 Plan 面板', state: 'failed' },
      ]),
    }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Subagents' }).className).toContain('active')
    expect(screen.getByTestId('plan-panel').closest('.tool-page')?.hasAttribute('hidden')).toBe(true)
  })

  it('does not show the Plan tab when restoring a session that only has settled plans', async () => {
    const getPlans = vi.fn(async () => [planFixture([
      { id: 'a', title: '定义 plan 契约', state: 'completed' },
      { id: 'b', title: '实现 Plan 面板', state: 'skipped' },
    ])])
    const host: PipiHostAPI = { ...createMockHost(), capabilities: async () => CAPABILITIES, getPlans }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')

    await waitFor(() => expect(getPlans).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Subagents' }).className).toContain('active')
  })

  it('does not revive the Plan tab when switching back to a session with only historical plans', async () => {
    const plans = multicastPlans()
    const plansBySession: Record<string, PlanSnapshot[]> = {
      welcome: [planFixture([{ id: 'a', title: '欢迎会话的计划', state: 'in_progress' }])],
      layout: [planFixture([
        { id: 'a', title: '旧计划', state: 'completed' },
      ])],
    }
    const host: PipiHostAPI = {
      ...createMockHost(),
      capabilities: async () => CAPABILITIES,
      getPlans: async sessionId => plansBySession[sessionId ?? ''] ?? [],
      subscribePlans: plans.subscribePlans,
    }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(await screen.findByRole('button', { name: 'Plan' }))
    expect(screen.getByRole('button', { name: 'Plan' }).className).toContain('active')
    await waitFor(() => expect(plans.attached).toBe(true))

    act(() => plans.emit({
      type: 'plan',
      sessionId: 'welcome',
      kind: 'plan_task_update',
      plan: planFixture([{ id: 'a', title: '欢迎会话的计划', state: 'completed' }]),
    }))
    plansBySession.welcome = [planFixture([{ id: 'a', title: '欢迎会话的计划', state: 'completed' }])]
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull())

    fireEvent.click(await screen.findByText('布局与流式消息'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Subagents' }).className).toContain('active')

    const welcomeRow = screen.getAllByTestId('session-row').find(row => row.getAttribute('data-session-id') === 'welcome')
    expect(welcomeRow).toBeTruthy()
    fireEvent.click(welcomeRow!)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Subagents' }).className).toContain('active')
  })

  it('hides the Plan tab after the last plan is cancelled', async () => {
    const plans = multicastPlans()
    const host: PipiHostAPI = {
      ...createMockHost(),
      capabilities: async () => CAPABILITIES,
      getPlans: async () => [planFixture([{ id: 'a', title: '定义 plan 契约', state: 'in_progress' }])],
      subscribePlans: plans.subscribePlans,
    }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(await screen.findByRole('button', { name: 'Plan' }))
    expect(await screen.findByTestId('plan-panel')).toBeTruthy()
    await waitFor(() => expect(plans.attached).toBe(true))

    act(() => plans.emit({
      type: 'plan',
      sessionId: 'welcome',
      kind: 'plan_cancel',
      plan: { ...planFixture([{ id: 'a', title: '定义 plan 契约', state: 'in_progress' }]), lifecycle: 'cancelled', cancelReason: '需求变了' },
    }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Subagents' }).className).toContain('active')
    expect(screen.getByTestId('plan-panel').closest('.tool-page')?.hasAttribute('hidden')).toBe(true)
  })

  it('keeps historical plans after the tab hides and a later live plan reopens it', async () => {
    const plans = multicastPlans()
    const historical = planFixture([{ id: 'a', title: '定义 plan 契约', state: 'completed' }])
    const host: PipiHostAPI = {
      ...createMockHost(),
      capabilities: async () => CAPABILITIES,
      getPlans: async () => [historical],
      subscribePlans: plans.subscribePlans,
    }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull())
    await waitFor(() => expect(plans.attached).toBe(true))

    act(() => plans.emit({
      type: 'plan',
      sessionId: 'welcome',
      kind: 'plan_publish',
      plan: { ...planFixture([{ id: 'b', title: '新的一轮', state: 'pending' }]), id: 'plan-2', title: '接下来的计划' },
    }))

    fireEvent.click(await screen.findByRole('button', { name: 'Plan' }))
    expect(await screen.findByTestId('plan-settled-title')).toBeTruthy()
    expect(screen.getByText('把 plan 接到前端')).toBeTruthy()
    expect(screen.getByText('接下来的计划')).toBeTruthy()
  })
})

function draftPlan(overrides: Partial<PlanSnapshot> = {}): PlanSnapshot {
  return {
    id: 'plan-draft',
    title: '待确认的计划',
    lifecycle: 'draft',
    createdAt: '2026-08-18T01:00:00.000Z',
    updatedAt: '2026-08-18T01:04:00.000Z',
    tasks: [{ id: 'a', title: '第一步', state: 'pending' }],
    ...overrides,
  }
}

describe('Plan approval bar in main chat', () => {
  it('shows 批准 when getPlans returns a live draft', async () => {
    const host: PipiHostAPI = {
      ...createMockHost(),
      capabilities: async () => CAPABILITIES,
      getPlans: async () => [draftPlan()],
    }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    expect(await screen.findByTestId('plan-approval-bar')).toBeTruthy()
    expect(screen.getByRole('button', { name: '批准' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull()
  })

  it('hides the bar when the plan is approved, cancelled, or missing', async () => {
    const approvedHost: PipiHostAPI = {
      ...createMockHost(),
      capabilities: async () => CAPABILITIES,
      getPlans: async () => [planFixture([{ id: 'a', title: '定义 plan 契约', state: 'completed' }])],
    }
    const { unmount } = render(<App host={approvedHost} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(screen.queryByTestId('plan-approval-bar')).toBeNull())
    unmount()

    const cancelledHost: PipiHostAPI = {
      ...createMockHost(),
      capabilities: async () => CAPABILITIES,
      getPlans: async () => [draftPlan({ lifecycle: 'cancelled' })],
    }
    const second = render(<App host={cancelledHost} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(screen.queryByTestId('plan-approval-bar')).toBeNull())
    second.unmount()

    const emptyHost: PipiHostAPI = {
      ...createMockHost(),
      capabilities: async () => CAPABILITIES,
      getPlans: async () => [],
    }
    render(<App host={emptyHost} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(screen.queryByTestId('plan-approval-bar')).toBeNull())
  })

  it('sends 批准该计划 when 批准 is clicked', async () => {
    const sendPrompt = vi.fn(async () => undefined)
    const host: PipiHostAPI = {
      ...createMockHost(),
      capabilities: async () => CAPABILITIES,
      getPlans: async () => [draftPlan()],
      sendPrompt,
    }
    render(<App host={host} />)
    await screen.findByTestId('plan-approval-bar')
    fireEvent.click(screen.getByTestId('plan-approval-approve'))
    await waitFor(() => expect(sendPrompt).toHaveBeenCalledWith('welcome', '批准该计划'))
    expect(screen.queryByTestId('plan-approval-bar')).toBeNull()
  })

  it('hides the bar when subscribePlans flips draft to approved', async () => {
    const plans = multicastPlans()
    const host: PipiHostAPI = {
      ...createMockHost(),
      capabilities: async () => CAPABILITIES,
      getPlans: async () => [draftPlan()],
      subscribePlans: plans.subscribePlans,
    }
    render(<App host={host} />)
    expect(await screen.findByTestId('plan-approval-bar')).toBeTruthy()
    await waitFor(() => expect(plans.attached).toBe(true))
    act(() => plans.emit({
      type: 'plan',
      sessionId: 'welcome',
      kind: 'plan_approve',
      plan: { ...draftPlan(), lifecycle: 'approved' },
    }))
    await waitFor(() => expect(screen.queryByTestId('plan-approval-bar')).toBeNull())
  })
})
