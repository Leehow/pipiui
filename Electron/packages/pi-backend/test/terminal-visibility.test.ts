import { describe, expect, it } from 'vitest'
import { TerminalVisibility, shouldRevealTerminal } from '../../../resources/runtime/extensions/terminal-visibility.ts'

describe('shouldRevealTerminal', () => {
  it('reveals only on an explicit built-in terminal ask', () => {
    const asks = ['打开终端', '在终端里跑', '用内置终端', '命令行看下参数', 'run it in the terminal', 'start a TUI', 'SSH 到服务器', 'open a terminal please']
    for (const text of asks) expect(shouldRevealTerminal(text), text).toBe(true)
  })
  it('does not reveal ordinary work asks', () => {
    const asks = ['跑个命令', '运行测试', 'build it', '修复这个 bug', '', undefined, null]
    for (const text of asks) expect(shouldRevealTerminal(text), String(text)).toBe(false)
  })
})

describe('TerminalVisibility', () => {
  it('hides terminal by default and keeps every other tool', () => {
    const v = new TerminalVisibility()
    expect(v.hide(['read', 'terminal', 'bash'])).toEqual(['read', 'bash'])
    expect(v.nextActiveTools('随便干点啥', ['read', 'terminal'])).toEqual(['read'])
  })
  it('reveals once asked and stays sticky for the session', () => {
    const v = new TerminalVisibility()
    const first = v.nextActiveTools('打开终端', ['read'])
    expect(first).toEqual(['read', 'terminal'])
    expect(v.nextActiveTools('继续修', first)).toEqual(['read', 'terminal'])
  })
  it('is idempotent: no duplicate terminal, no redundant setActiveTools', () => {
    const v = new TerminalVisibility()
    const once = v.nextActiveTools('用 terminal 工具', ['read', 'terminal'])
    const twice = v.nextActiveTools('terminal again', once)
    expect(once).toEqual(['read', 'terminal'])
    expect(twice).toEqual(['read', 'terminal'])
    expect(v.shouldCallSetActiveTools(['read', 'terminal'], once)).toBe(false)
    expect(v.shouldCallSetActiveTools(['read'], once)).toBe(true)
  })
})
