// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI, PlanSnapshot } from '@pipi/host-api'

vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return { Virtuoso: React.forwardRef(({ data, itemContent }: { data: unknown[]; itemContent: (index: number, item: never) => JSX.Element }, ref) => { React.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() })); return <div>{data.map((item, index) => <React.Fragment key={index}>{itemContent(index, item as never)}</React.Fragment>)}</div> }) }
})
vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('@streamdown/code', () => ({ code: {} }))
vi.mock('@xterm/xterm', () => ({ Terminal: class { open = vi.fn(); write = vi.fn(); clear = vi.fn(); focus = vi.fn(); scrollToBottom = vi.fn(); loadAddon = vi.fn(); dispose = vi.fn(); buffer = { active: { viewportY: 0, baseY: 0 } }; onData = () => ({ dispose: vi.fn() }); onScroll = () => ({ dispose: vi.fn() }) } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

import { App, createMockHost } from './App'

beforeEach(() => { vi.unstubAllGlobals(); localStorage.clear(); Reflect.deleteProperty(window, 'pipiHost') })
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); Reflect.deleteProperty(window, 'pipiHost') })

const selectSession = async (name: string) => {
  fireEvent.click(await screen.findByText(name))
  await waitFor(() => expect(screen.getAllByText(name).length).toBeGreaterThan(0))
}

describe('the right panel belongs to the selected session', () => {
  it('does not carry one session\'s open document into another', async () => {
    const host = createMockHost()
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')

    fireEvent.click(await screen.findByRole('button', { name: '打开文档 README.md' }))
    expect(await screen.findByLabelText('文档内容 README.md')).toBeTruthy()

    await selectSession('布局与流式消息')

    // The reader must fall back to its empty state, not keep the other chat's file.
    await waitFor(() => expect(screen.queryByLabelText('文档内容 README.md')).toBeNull())

    // Going back restores this session's own document.
    await selectSession('Electron 三栏界面')
    expect(await screen.findByLabelText('文档内容 README.md')).toBeTruthy()
  })

  it('loads plans for the newly selected session only', async () => {
    const plansBySession: Record<string, PlanSnapshot[]> = {
      welcome: [{ id: 'plan-welcome', title: '欢迎会话的计划', lifecycle: 'approved', createdAt: '2026-08-18T01:00:00.000Z', updatedAt: '2026-08-18T01:00:00.000Z', tasks: [{ id: 'a', title: '第一步', state: 'in_progress' }] }],
      layout: [{ id: 'plan-layout', title: '布局会话的计划', lifecycle: 'draft', createdAt: '2026-08-18T01:00:00.000Z', updatedAt: '2026-08-18T01:00:00.000Z', tasks: [{ id: 'b', title: '另一步', state: 'pending' }] }],
    }
    const getPlans = vi.fn(async (sessionId?: string) => plansBySession[sessionId ?? ''] ?? [])
    const host: PipiHostAPI = { ...createMockHost(), getPlans }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')

    fireEvent.click(await screen.findByRole('button', { name: 'Plan' }))
    expect(await screen.findByText('欢迎会话的计划')).toBeTruthy()

    await selectSession('布局与流式消息')

    expect(await screen.findByText('布局会话的计划')).toBeTruthy()
    expect(screen.queryByText('欢迎会话的计划')).toBeNull()
    expect(getPlans).toHaveBeenCalledWith('layout')
  })
})
