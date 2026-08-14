// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockHost } from './App'
import { BrowserPanel } from './BrowserPanel'

function renderPanel(host = createMockHost(), sessionId = 'welcome') {
  const slot = document.createElement('div')
  document.body.appendChild(slot)
  const view = render(<BrowserPanel host={host} sessionId={sessionId} headerSlot={slot} />)
  return { view, slot }
}

afterEach(cleanup)

describe('BrowserPanel', () => {
  it('adds, switches, and closes virtual tabs through the host API', async () => {
    const host = createMockHost()
    renderPanel(host)

    await screen.findByRole('tab', { name: '新标签页' })
    const address = screen.getByLabelText('浏览器地址') as HTMLInputElement
    fireEvent.change(address, { target: { value: 'first.example' } })
    fireEvent.submit(address.closest('form')!)
    await waitFor(() => expect(address.value).toBe('https://first.example'))

    fireEvent.click(screen.getByRole('button', { name: '新建标签页' }))
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2))
    fireEvent.change(address, { target: { value: 'second.example' } })
    fireEvent.submit(address.closest('form')!)
    await waitFor(() => expect(address.value).toBe('https://second.example'))

    fireEvent.click(screen.getByRole('tab', { name: 'first.example' }))
    await waitFor(() => expect(address.value).toBe('https://first.example'))
    fireEvent.click(screen.getByRole('button', { name: '关闭标签页 first.example' }))
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1))
    await waitFor(() => expect(address.value).toBe('https://second.example'))
  })

  it('exposes back, forward, and refresh against mock navigation state', async () => {
    const host = createMockHost()
    renderPanel(host)
    await screen.findByRole('tab', { name: '新标签页' })
    const address = screen.getByLabelText('浏览器地址') as HTMLInputElement

    fireEvent.change(address, { target: { value: 'one.example' } })
    fireEvent.submit(address.closest('form')!)
    await waitFor(() => expect(address.value).toBe('https://one.example'))
    fireEvent.change(address, { target: { value: 'two.example' } })
    fireEvent.submit(address.closest('form')!)
    await waitFor(() => expect(address.value).toBe('https://two.example'))

    const back = screen.getByRole('button', { name: '后退' }) as HTMLButtonElement
    const forward = screen.getByRole('button', { name: '前进' }) as HTMLButtonElement
    expect(back.disabled).toBe(false)
    expect(forward.disabled).toBe(true)
    fireEvent.click(back)
    await waitFor(() => expect(address.value).toBe('https://one.example'))
    await waitFor(() => expect(forward.disabled).toBe(false))
    fireEvent.click(forward)
    await waitFor(() => expect(address.value).toBe('https://two.example'))
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  })

  it('emits loading navigation snapshots and exposes the agent-browser-shaped snapshot API', async () => {
    const host = createMockHost()
    const browser = host.browser
    if (!browser) throw new Error('mock browser unavailable')
    const events: boolean[] = []
    const unsubscribe = browser.subscribe(event => events.push(event.type === 'tabs' ? event.snapshot.tabs.find(tab => tab.id === event.snapshot.activeTabId)?.isLoading ?? false : false))

    await browser.loadURL('welcome', 'first.example')
    await browser.loadURL('welcome', 'second.example')
    expect(events).toContain(true)
    expect((await browser.getActiveTab('welcome'))?.canGoBack).toBe(true)
    await browser.goBack('welcome')
    expect((await browser.getActiveTab('welcome'))?.url).toBe('https://first.example')
    await browser.goForward('welcome')
    const snapshot = await browser.snapshot('welcome')
    expect(snapshot).toMatchObject({ url: 'https://second.example', text: 'mock browser snapshot' })
    unsubscribe()
  })

  it('dismisses a floating operation error and re-shows it when the failure re-occurs', async () => {
    const host = createMockHost()
    const browser = host.browser
    if (!browser) throw new Error('mock browser unavailable')
    const reload = vi.fn(async () => { throw new Error('mock reload failure') })
    browser.reload = reload
    renderPanel(host)
    await screen.findByRole('tab', { name: '新标签页' })

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('mock reload failure')
    expect(screen.getByRole('button', { name: '关闭错误提示' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('mock reload failure')
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('switches to the selected session browser space and ignores other session tab events', async () => {
    const host = createMockHost()
    const { rerender } = render(<BrowserPanel host={host} sessionId="welcome" />)
    const address = await screen.findByLabelText('浏览器地址') as HTMLInputElement
    fireEvent.change(address, { target: { value: 'welcome.example' } })
    fireEvent.submit(address.closest('form')!)
    await waitFor(() => expect(address.value).toBe('https://welcome.example'))

    rerender(<BrowserPanel host={host} sessionId="layout" />)
    await waitFor(() => expect(address.value).toBe(''))
    fireEvent.change(address, { target: { value: 'layout.example' } })
    fireEvent.submit(address.closest('form')!)
    await waitFor(() => expect(address.value).toBe('https://layout.example'))

    rerender(<BrowserPanel host={host} sessionId="welcome" />)
    await waitFor(() => expect(address.value).toBe('https://welcome.example'))
  })

  it('hides the native browser view while occluded and restores its current bounds', async () => {
    const host = createMockHost()
    const setViewBounds = vi.spyOn(host.browser!, 'setViewBounds')
    const { rerender } = render(<BrowserPanel host={host} sessionId="welcome" />)
    await waitFor(() => expect(setViewBounds).toHaveBeenCalledWith('welcome', expect.objectContaining({ visible: true })))

    rerender(<BrowserPanel host={host} sessionId="welcome" occluded />)
    await waitFor(() => expect(setViewBounds).toHaveBeenCalledWith('welcome', { x: 0, y: 0, width: 0, height: 0, visible: false }))

    rerender(<BrowserPanel host={host} sessionId="welcome" occluded={false} />)
    await waitFor(() => expect(setViewBounds.mock.calls.at(-1)?.[1]).toMatchObject({ visible: true }))
  })
})
