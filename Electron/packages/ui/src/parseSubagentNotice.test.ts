import { describe, expect, it } from 'vitest'
import { parseSubagentNotice } from './subagent-notice'

describe('parseSubagentNotice', () => {
  it('parses the canonical Chinese notice', () => {
    expect(parseSubagentNotice('子任务完成 · explore · ok · cost ¥0.12')).toEqual({ name: 'explore', ok: true, cost: '¥0.12' })
  })

  it('parses failed notices and $ currency with surrounding whitespace', () => {
    expect(parseSubagentNotice('  子任务完成 · reviewer · failed · cost $1.20  ')).toEqual({ name: 'reviewer', ok: false, cost: '¥1.20' })
    expect(parseSubagentNotice('子任务完成 · coder-2 · ok · cost ¥10')).toEqual({ name: 'coder-2', ok: true, cost: '¥10' })
  })

  it('parses English subagent variants (case-insensitive keyword)', () => {
    expect(parseSubagentNotice('Subagent done · scout · ok · cost ¥0.05')).toEqual({ name: 'scout', ok: true, cost: '¥0.05' })
    expect(parseSubagentNotice('subagent task finished · scout · failed · cost ¥0.05')).toEqual({ name: 'scout', ok: false, cost: '¥0.05' })
  })

  it('rejects content that does not anchor on 子任务/subagent', () => {
    expect(parseSubagentNotice('已读取 package.json')).toBeNull()
    expect(parseSubagentNotice('任务完成 · explore · ok · cost ¥0.12')).toBeNull()
    expect(parseSubagentNotice('cost ¥0.12 · explore · ok')).toBeNull()
    expect(parseSubagentNotice('')).toBeNull()
  })
})
