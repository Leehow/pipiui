// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageQueue, messageQueueSummary } from './MessageQueue'
import type { MessageQueueItem } from './MessageQueue'

afterEach(cleanup)

const items: MessageQueueItem[] = [
  { id: 'm1', text: '**第一问**：修导航', images: [{ url: 'data:image/png;base64,AAAA' }, { url: 'data:image/png;base64,BBBB' }], status: 'queued' },
  { id: 'm2', text: '第二问：加个测试', status: 'sending' },
  { id: 'm3', text: '带图提问', images: [{ name: 'shot.png' }], status: 'failed', error: '上游超时' }
]

const callbacks = () => ({
  onToggle: vi.fn(),
  onPromote: vi.fn(),
  onEdit: vi.fn(),
  onRemove: vi.fn(),
  onRetry: vi.fn()
})

describe('messageQueueSummary', () => {
  it('strips markdown, collapses whitespace, and truncates by code point', () => {
    expect(messageQueueSummary('**bold** and `code` and [link](https://x)')).toBe('bold and code and link')
    expect(messageQueueSummary('# Header\n\n- item one\n- item two')).toBe('Header item one item two')
    expect(messageQueueSummary('a\n\n  b\t c')).toBe('a b c')
    expect(messageQueueSummary('')).toBe('')
    const long = 'x'.repeat(80)
    expect(messageQueueSummary(long)).toBe('x'.repeat(60) + '…')
    expect(Array.from(messageQueueSummary('😀'.repeat(80)))).toHaveLength(61)
  })
})

describe('MessageQueue', () => {
  it('renders nothing when the queue is empty', () => {
    const cb = callbacks()
    const { container } = render(<MessageQueue items={[]} expanded={false} {...cb} />)
    expect(container.querySelector('.message-queue')).toBeNull()
    expect(screen.queryByTestId('message-queue')).toBeNull()
  })

  it('collapsed: shows the count, first-item summary, and expand affordance only', () => {
    const cb = callbacks()
    render(<MessageQueue items={items} expanded={false} {...cb} />)

    expect(screen.getByTestId('message-queue-count').textContent).toBe('排队 3 条')
    // First item summary — markdown-stripped, truncated.
    expect(screen.getByTestId('message-queue-preview').textContent).toBe('第一问：修导航')
    const toggle = screen.getByTestId('message-queue-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-controls')).toBe('message-queue-list')
    // List stays hidden while collapsed.
    expect(screen.queryByTestId('message-queue-list')).toBeNull()
    expect(screen.queryByTestId('message-queue-item-0')).toBeNull()
  })

  it('collapsed: falls back to an image-only hint when the first item has no text', () => {
    render(<MessageQueue items={[{ id: 'img', text: '', images: [{ name: 'a.png' }], status: 'queued' }]} expanded={false} {...callbacks()} />)
    expect(screen.getByTestId('message-queue-preview').textContent).toBe('1 张图片')
  })

  it('expands on toggle and lists every item with ordinal order and status', () => {
    const cb = callbacks()
    const { rerender } = render(<MessageQueue items={items} expanded={false} {...cb} />)
    fireEvent.click(screen.getByTestId('message-queue-toggle'))
    expect(cb.onToggle).toHaveBeenCalledTimes(1)

    rerender(<MessageQueue items={items} expanded {...cb} />)
    const toggle = screen.getByTestId('message-queue-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('list')).toBeTruthy()

    const list = screen.getByTestId('message-queue-list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    // Ordinal order chip.
    expect(within(list).getAllByText('1')[0].textContent).toBe('1')
    expect(within(list).getAllByText('2')[0].textContent).toBe('2')
    expect(within(list).getAllByText('3')[0].textContent).toBe('3')
    // Text summaries in queue order.
    expect(screen.getByTestId('queue-text-0').textContent).toBe('第一问：修导航')
    expect(screen.getByTestId('queue-text-1').textContent).toBe('第二问：加个测试')
    expect(screen.getByTestId('queue-text-2').textContent).toBe('带图提问')
    // Statuses.
    expect(screen.getByTestId('queue-status-0').textContent).toBe('排队中')
    expect(screen.getByTestId('queue-status-1').textContent).toBe('发送中')
    expect(screen.getByTestId('queue-status-2').textContent).toBe('发送失败')
  })

  it('shows the image count and thumbnail identifier for items with attachments', () => {
    render(<MessageQueue items={items} expanded {...callbacks()} />)
    const thumbs = screen.getByTestId('queue-thumbs-0')
    expect(thumbs.querySelectorAll('.message-queue__thumb')).toHaveLength(2)
    expect(thumbs.querySelector('.message-queue__thumb-count')?.textContent).toBe('2')
    expect(thumbs.querySelector('.message-queue__thumb-count')?.getAttribute('aria-label')).toBe('2 张图片')
    // Image without a URL renders the blank placeholder, still counted.
    expect(screen.getByTestId('queue-thumbs-2').querySelectorAll('.message-queue__thumb--blank')).toHaveLength(1)
    expect(screen.getByTestId('queue-thumbs-2').querySelector('.message-queue__thumb-count')?.textContent).toBe('1')
    // No attachments → no thumbs block.
    expect(screen.queryByTestId('queue-thumbs-1')).toBeNull()
  })

  it('promotes (插队) a mutable later item, keeps the head non-promotable, and protects sending rows', () => {
    const cb = callbacks()
    render(<MessageQueue items={items} expanded {...cb} />)
    const head = screen.getByTestId('queue-promote-0')
    expect(head.hasAttribute('disabled')).toBe(true)
    expect(head.getAttribute('title')).toBe('已是队首')
    // queue-host rejects mutations for an in-flight sending item.
    expect((screen.getByTestId('queue-promote-1') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('queue-edit-1') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('queue-remove-1') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByTestId('queue-promote-2'))
    expect(cb.onPromote).toHaveBeenCalledWith('m3')
  })

  it('edits inline: prefilled textarea, save commits, editor closes', () => {
    const cb = callbacks()
    render(<MessageQueue items={items} expanded {...cb} />)
    fireEvent.click(screen.getByTestId('queue-edit-0'))

    const input = screen.getByTestId('queue-editor-input-0') as HTMLTextAreaElement
    expect(input.value).toBe('**第一问**：修导航')
    expect(input.getAttribute('aria-label')).toBe('编辑第 1 条消息')

    fireEvent.change(input, { target: { value: '更新后的消息' } })
    fireEvent.click(screen.getByTestId('queue-save'))
    expect(cb.onEdit).toHaveBeenCalledWith('m1', '更新后的消息')
    expect(screen.queryByTestId('queue-editor-0')).toBeNull()
    // Row actions are back once the editor closes.
    expect(screen.getByTestId('queue-edit-0')).toBeTruthy()
  })

  it('edits inline: cancel discards the draft without calling onEdit', () => {
    const cb = callbacks()
    render(<MessageQueue items={items} expanded {...cb} />)
    fireEvent.click(screen.getByTestId('queue-edit-0'))
    const input = screen.getByTestId('queue-editor-input-0')
    fireEvent.change(input, { target: { value: '不会保存' } })
    fireEvent.click(screen.getByTestId('queue-cancel'))
    expect(cb.onEdit).not.toHaveBeenCalled()
    expect(screen.queryByTestId('queue-editor-0')).toBeNull()
  })

  it('edits inline: refuses to save a blank draft', () => {
    render(<MessageQueue items={items} expanded {...callbacks()} />)
    fireEvent.click(screen.getByTestId('queue-edit-0'))
    const input = screen.getByTestId('queue-editor-input-0')
    fireEvent.change(input, { target: { value: '   ' } })
    expect((screen.getByTestId('queue-save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('removes an item', () => {
    const cb = callbacks()
    render(<MessageQueue items={items} expanded {...cb} />)
    fireEvent.click(screen.getByTestId('queue-remove-0'))
    expect(cb.onRemove).toHaveBeenCalledWith('m1')
  })

  it('retries a failed item (retry shown only for failed)', () => {
    const cb = callbacks()
    render(<MessageQueue items={items} expanded {...cb} />)
    expect(screen.queryByTestId('queue-retry-0')).toBeNull()
    expect(screen.queryByTestId('queue-retry-1')).toBeNull()
    fireEvent.click(screen.getByTestId('queue-retry-2'))
    expect(cb.onRetry).toHaveBeenCalledWith('m3')
  })

  it('shows the failed error message with an alert role', () => {
    render(<MessageQueue items={items} expanded {...callbacks()} />)
    const error = screen.getByTestId('queue-error-2')
    expect(error.textContent).toBe('上游超时')
    expect(error.getAttribute('role')).toBe('alert')
  })

  it('disables all mutating actions and the editor while pending', () => {
    const cb = callbacks()
    const { rerender } = render(<MessageQueue items={items} expanded {...cb} />)
    fireEvent.click(screen.getByTestId('queue-edit-0'))
    rerender(<MessageQueue items={items} expanded pending {...cb} />)
    // Item 0 is in edit mode (its actions are hidden); assert the other rows.
    expect((screen.getByTestId('queue-promote-1') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('queue-edit-1') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('queue-remove-1') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('queue-retry-2') as HTMLButtonElement).disabled).toBe(true)

    // Editor opened before pending arrives is read-only and cannot save.
    expect((screen.getByTestId('queue-editor-input-0') as HTMLTextAreaElement).disabled).toBe(true)
    expect((screen.getByTestId('queue-save') as HTMLButtonElement).disabled).toBe(true)
    // Cancel stays available — it is local, side-effect-free.
    expect((screen.getByTestId('queue-cancel') as HTMLButtonElement).disabled).toBe(false)
  })

  it('keyboard: Escape cancels the inline editor, Ctrl+Enter saves it', () => {
    const cb = callbacks()
    render(<MessageQueue items={items} expanded {...cb} />)
    fireEvent.click(screen.getByTestId('queue-edit-0'))

    // Escape → cancel, no onEdit.
    const input = screen.getByTestId('queue-editor-input-0')
    fireEvent.change(input, { target: { value: '会被取消' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(cb.onEdit).not.toHaveBeenCalled()
    expect(screen.queryByTestId('queue-editor-0')).toBeNull()

    // Ctrl+Enter → save.
    fireEvent.click(screen.getByTestId('queue-edit-0'))
    const input2 = screen.getByTestId('queue-editor-input-0')
    fireEvent.change(input2, { target: { value: '键盘保存' } })
    fireEvent.keyDown(input2, { key: 'Enter', ctrlKey: true })
    expect(cb.onEdit).toHaveBeenCalledWith('m1', '键盘保存')
    expect(screen.queryByTestId('queue-editor-0')).toBeNull()
  })

  it('exposes ARIA list/item semantics and labelled action buttons', () => {
    render(<MessageQueue items={items} expanded {...callbacks()} />)
    const list = screen.getByTestId('message-queue-list')
    const row0 = within(list).getAllByRole('listitem')[0]
    expect(row0.getAttribute('data-status')).toBe('queued')
    expect(screen.getByRole('button', { name: '插队第 2 条' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '编辑第 3 条' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '删除第 1 条' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试第 3 条' })).toBeTruthy()
  })
})
