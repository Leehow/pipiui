// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MCP_ADD_PROMPT, PI_EXTENSION_ADD_PROMPT } from './extension-add-copy'
import type { PipiHostAPI, UserMcpServer } from '@pipi/host-api'
import { ExtensionsPane } from './ExtensionsPane'

let originalClipboard: PropertyDescriptor | undefined

beforeEach(() => {
  originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

afterEach(() => {
  cleanup()
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
})

describe('ExtensionsPane', () => {
  it('shows the built-in MCP extension and an empty user list', () => {
    render(<ExtensionsPane addOpen={false} onCloseAdd={() => undefined} />)
    expect(screen.getByTestId('extensions-pane')).toBeTruthy()
    expect(screen.getByTestId('extensions-item-pi-mcp').textContent).toContain('pi-mcp-extension')
    expect(screen.getByTestId('extensions-item-paddleocr').textContent).toContain('PaddleOCR-VL-1.6')
    expect(screen.getByTestId('extensions-user-empty').textContent).toContain('还没有额外添加')
    expect(screen.queryByTestId('extensions-add-dialog')).toBeNull()
  })

  it('lists project mcpServers from the host without secrets', async () => {
    const listUserMcpServers = vi.fn(async (): Promise<UserMcpServer[]> => [
      { name: 'officecli', transport: 'stdio', summary: 'officecli mcp' },
    ])
    const host = { listUserMcpServers, listProjects: async () => [{ id: 'demo', name: 'demo', path: '/tmp/demo' }] } as unknown as PipiHostAPI
    render(<ExtensionsPane host={host} addOpen={false} onCloseAdd={() => undefined} />)
    expect(await screen.findByTestId('extensions-item-mcp-officecli')).toBeTruthy()
    expect(screen.getByTestId('extensions-item-mcp-officecli').textContent).toContain('officecli')
    expect(screen.getByTestId('extensions-item-mcp-officecli').textContent).toContain('officecli mcp')
    expect(screen.queryByTestId('extensions-user-empty')).toBeNull()
    expect(listUserMcpServers).toHaveBeenCalled()
  })

  it('opens the add dialog with copy-paste prompts the main session can handle', async () => {
    const onCloseAdd = vi.fn()
    render(<ExtensionsPane addOpen={true} onCloseAdd={onCloseAdd} />)
    const dialog = screen.getByTestId('extensions-add-dialog')
    expect(dialog.textContent).toContain('不用在这里填命令、URL 或密钥')
    expect(dialog.textContent).toContain('回到主界面直接说就行')
    expect(screen.getByTestId('extensions-copy-mcp').textContent).toContain(MCP_ADD_PROMPT)
    expect(screen.getByTestId('extensions-copy-pi').textContent).toContain(PI_EXTENSION_ADD_PROMPT)
    fireEvent.click(screen.getByTestId('extensions-copy-btn-mcp'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(MCP_ADD_PROMPT))
    expect(screen.getByTestId('extensions-add-copied').textContent).toContain('贴到主界面发送即可')
    fireEvent.click(screen.getByTestId('extensions-copy-btn-pi'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(PI_EXTENSION_ADD_PROMPT))
    fireEvent.click(screen.getByRole('button', { name: '关闭添加说明' }))
    expect(onCloseAdd).toHaveBeenCalledTimes(1)
  })

  it('saves a project-scoped PaddleOCR token without echoing it and opens the apply URL', async () => {
    const getPaddleOcrStatus = vi.fn(async () => ({ hasKey: false }))
    const setPaddleOcrAccessToken = vi.fn(async (_projectId: string, token: string | null) => ({ hasKey: Boolean(token) }))
    const openExternal = vi.fn(async () => undefined)
    const host = {
      getPaddleOcrStatus,
      setPaddleOcrAccessToken,
      openExternal,
      listUserMcpServers: async () => [],
      listProjects: async () => [{ id: 'project-1', name: 'demo', path: '/tmp/demo' }],
    } as unknown as PipiHostAPI
    render(<ExtensionsPane host={host} projectId="project-1" addOpen={false} onCloseAdd={() => undefined} />)
    expect(await screen.findByTestId('paddleocr-status')).toBeTruthy()
    fireEvent.change(screen.getByTestId('paddleocr-token-input'), { target: { value: 'ast-secret-should-not-echo' } })
    fireEvent.click(screen.getByTestId('paddleocr-save'))
    await waitFor(() => expect(setPaddleOcrAccessToken).toHaveBeenCalledWith('project-1', 'ast-secret-should-not-echo'))
    expect(screen.queryByText('ast-secret-should-not-echo')).toBeNull()
    expect(screen.getByTestId('paddleocr-status').textContent).toContain('已配置')
    fireEvent.click(screen.getByTestId('paddleocr-apply'))
    expect(openExternal).toHaveBeenCalledWith('https://aistudio.baidu.com/account/accessToken')
  })

  it('closes the add dialog on Escape without bubbling to the settings modal', () => {
    const onCloseAdd = vi.fn()
    render(<ExtensionsPane addOpen={true} onCloseAdd={onCloseAdd} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCloseAdd).toHaveBeenCalledTimes(1)
  })
})
