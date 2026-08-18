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
    let emit: ((event: PlanEvent) => void) | undefined
    const host: PipiHostAPI = {
      ...createMockHost(),
      capabilities: async () => CAPABILITIES,
      getPlans: async () => [planFixture([
        { id: 'a', title: '定义 plan 契约', state: 'completed' },
        { id: 'b', title: '实现 Plan 面板', state: 'in_progress' },
        { id: 'c', title: '补测试', state: 'pending' },
      ])],
      subscribePlans: listener => { emit = listener; return () => { emit = undefined } },
    }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')

    // The Subagents tab stays active; the badge is the only plan surface on screen.
    const badge = await screen.findByTestId('tool-rail-plan-progress')
    expect(badge.textContent).toBe('1/3')
    expect(screen.getByRole('button', { name: 'Subagents' }).className).toContain('active')

    await waitFor(() => expect(emit).toBeDefined())
    act(() => emit?.({ type: 'plan', sessionId: 'welcome', kind: 'plan_task_update', plan: planFixture([
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
    let emit: ((event: PlanEvent) => void) | undefined
    const host: PipiHostAPI = {
      ...createMockHost(),
      capabilities: async () => CAPABILITIES,
      getPlans: async () => [],
      subscribePlans: listener => { emit = listener; return () => { emit = undefined } },
    }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull())
    await waitFor(() => expect(emit).toBeDefined())

    act(() => emit?.({ type: 'plan', sessionId: 'welcome', kind: 'plan_publish', plan: planFixture([
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
})
