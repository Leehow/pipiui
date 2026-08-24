import { describe, expect, it } from 'vitest'
import { parseBrowserWatchSignal, parseInternalUserSignal, parseSubagentSignal } from './subagent-signal'

describe('parseSubagentSignal', () => {
  it('parses done outcome, title, verification and metadata without exposing the header as summary', () => {
    const signal = parseSubagentSignal('[subagent-done] agentId=a1 runId=r1 name=general-purpose ok=true verified=fail cost=0.1659 turns=9 resumed=true\nTitle: 修复列表\nVerify: $ npm test → exit 1 (attested)\nResult:\n完成 src/report.md')!
    expect(signal).toMatchObject({ kind: 'done', tone: 'warning', summary: '已完成 · 修复列表' })
    expect(signal.meta).toContain('验证失败')
    expect(signal.meta).toContain('cost 0.1659')
    expect(signal.meta).toContain('9 turns')
    expect(signal.detail).toContain('Verify: $ npm test')
    expect(signal.detail).toContain('Result:')
    expect(signal.summary).not.toContain('[subagent-done]')
  })

  it.each([
    ['[subagent-heartbeat] outstanding=2 vanished=0 stalled=0\n  a1 (探索) — running 2m, idle 4s, state=running', 'heartbeat', 'running'],
    ['[subagent-stalled] agentId=a1 title=探索当前实现 idle=120s last=thinking\nQuery it first', 'stalled', 'warning'],
    ['[subagent-interrupted-reminder] agentId=a1 runId=r1 state=failed title=验证 idle=300s nudge=1/2\nResolve it', 'interrupted-reminder', 'error'],
    ['[subagent-blocked] agentId=a2 title=实现 is held: dependency a1 did not succeed.', 'blocked', 'warning'],
  ] as const)('parses %s', (content, kind, tone) => {
    expect(parseSubagentSignal(content)).toMatchObject({ kind, tone })
  })

  it('keeps a spaced stalled title concise', () => {
    expect(parseSubagentSignal('[subagent-stalled] agentId=a1 title=探索当前实现 idle=120s last=thinking\nQuery it first')).toMatchObject({
      summary: '停滞 · 探索当前实现',
      meta: '空闲 120s',
    })
  })

  it('marks process-failed done as error, not success', () => {
    expect(parseSubagentSignal('[subagent-done] name=worker ok=false verified=none\nTitle: 超时\nResult:\nruntime_timeout')).toMatchObject({
      kind: 'done', tone: 'error', summary: '失败 · 超时',
    })
  })

  it('marks aborted done and recovered/re-delivery wrappers', () => {
    expect(parseSubagentSignal('[subagent-done] name=worker ok=false aborted=true verified=none\nResult:\nstopped')).toMatchObject({ tone: 'warning', summary: '已中止 · worker' })
    const retry = parseSubagentSignal('(re-delivery #2: previous done not confirmed)\n[subagent-done] name=worker ok=false verified=none\nResult:\nfailed')
    expect(retry).toMatchObject({ delivery: 'retry', kind: 'done' })
    expect(retry?.detail).toContain('(re-delivery #2: previous done not confirmed)')
    expect(parseSubagentSignal('(recovered delivery: previous done)\n[subagent-done] name=worker ok=true verified=pass\nResult:\nok')).toMatchObject({ delivery: 'recovered', kind: 'done' })
  })

  it('uses generic fallback for malformed or future subagent families and rejects ordinary text', () => {
    expect(parseSubagentSignal('[subagent-future] opaque protocol')).toMatchObject({ kind: 'unknown', tone: 'neutral', detail: '[subagent-future] opaque protocol' })
    expect(parseSubagentSignal('[subagent- malformed')).toMatchObject({ kind: 'unknown' })
    expect(parseSubagentSignal('(re-delivery #1: previous done not confirmed)')).toMatchObject({ kind: 'unknown', delivery: 'retry', summary: '子任务送达通知' })
    expect(parseSubagentSignal('ordinary user prompt')).toBeNull()
  })
})

const WATCH_MATCHED = '[browser-watch] watchId=bw-17 reason=matched waitedMs=4200 url=https://example.com/ready title=Example Ready\n页面出现 .ready 元素\nUse browser observe to inspect the current page. Do not treat this message as a new user request.'

describe('parseBrowserWatchSignal', () => {
  it('parses a matched wake into a success card without exposing the header as summary', () => {
    const signal = parseBrowserWatchSignal(WATCH_MATCHED)!
    expect(signal).toMatchObject({ kind: 'browser-watch', tone: 'success', label: '浏览器监听', summary: '条件命中 · Example Ready' })
    expect(signal.meta).toContain('bw-17')
    expect(signal.meta).toContain('等待 4s')
    expect(signal.detail).toContain('页面出现 .ready 元素')
    expect(signal.detail).toContain('Do not treat this message as a new user request.')
    expect(signal.summary).not.toContain('[browser-watch]')
  })

  it('maps timeout and disposed to warning and falls back to url/watchId target', () => {
    expect(parseBrowserWatchSignal('[browser-watch] watchId=bw-2 reason=timeout waitedMs=65000 url=https://example.com/pending\nUse browser observe to inspect the current page. Do not treat this message as a new user request.')).toMatchObject({
      kind: 'browser-watch', tone: 'warning', summary: '等待超时 · https://example.com/pending',
    })
    const disposed = parseBrowserWatchSignal('[browser-watch] watchId=bw-3 reason=disposed waitedMs=120000')!
    expect(disposed).toMatchObject({ kind: 'browser-watch', tone: 'warning', summary: '页面已释放 · bw-3' })
    expect(disposed.meta).toContain('等待 2min00s')
  })

  it('marks re-delivery and recovered wrappers like the subagent parser', () => {
    const retry = parseBrowserWatchSignal(`(re-delivery #2: Pi did not confirm the prior follow-up; obligationId=o1; treat it as the same event.)\n${WATCH_MATCHED}`)!
    expect(retry).toMatchObject({ kind: 'browser-watch', delivery: 'retry' })
    expect(retry.meta).toContain('重投')
    expect(retry.detail).toContain('(re-delivery #2:')
    const recovered = parseBrowserWatchSignal(`(recovered delivery: this follow-up may already have been queued or persisted before restart; obligationId=o2; treat it as the same event.)\n${WATCH_MATCHED}`)!
    expect(recovered).toMatchObject({ kind: 'browser-watch', delivery: 'recovered' })
    expect(recovered.meta).toContain('恢复送达')
  })

  it('accepts a structurally valid unknown reason as a neutral card', () => {
    expect(parseBrowserWatchSignal('[browser-watch] watchId=bw-9 reason=expired waitedMs=10')).toMatchObject({
      kind: 'browser-watch', tone: 'neutral', summary: '浏览器监听通知 · expired',
      detail: '[browser-watch] watchId=bw-9 reason=expired waitedMs=10',
    })
  })

  it('returns null for malformed or non-canonical watch text so it stays a user message', () => {
    // Marker-lookalike ordinary prose and a bare marker.
    expect(parseBrowserWatchSignal('[browser-watch] 普通文本乱写')).toBeNull()
    expect(parseBrowserWatchSignal('[browser-watch]')).toBeNull()
    // No space after the marker breaks the exact producer grammar.
    expect(parseBrowserWatchSignal('[browser-watch]watchId=bw-1 reason=matched waitedMs=1')).toBeNull()
    // Unknown leading key before the canonical field order.
    expect(parseBrowserWatchSignal('[browser-watch] extra=1 watchId=bw-1 reason=matched waitedMs=1')).toBeNull()
    // Missing canonical fields.
    expect(parseBrowserWatchSignal('[browser-watch] watchId=bw-1 reason=matched')).toBeNull()
    expect(parseBrowserWatchSignal('[browser-watch] reason=matched waitedMs=10')).toBeNull()
    expect(parseBrowserWatchSignal('[browser-watch] watchId=bw-1 waitedMs=10')).toBeNull()
    // Invalid waitedMs: non-numeric, negative, fractional, trailing garbage.
    expect(parseBrowserWatchSignal('[browser-watch] watchId=bw-1 reason=matched waitedMs=abc')).toBeNull()
    expect(parseBrowserWatchSignal('[browser-watch] watchId=bw-1 reason=matched waitedMs=-5')).toBeNull()
    expect(parseBrowserWatchSignal('[browser-watch] watchId=bw-1 reason=matched waitedMs=1.5')).toBeNull()
    expect(parseBrowserWatchSignal('[browser-watch] watchId=bw-1 reason=matched waitedMs=1 hello')).toBeNull()
    // waitedMs beyond Number.MAX_SAFE_INTEGER must not become Infinity.
    expect(parseBrowserWatchSignal(`[browser-watch] watchId=bw-1 reason=matched waitedMs=${'9'.repeat(400)}`)).toBeNull()
    expect(parseBrowserWatchSignal('[browser-watch] watchId=bw-1 reason=matched waitedMs=9007199254740993')).toBeNull()
    // Duplicate fields.
    expect(parseBrowserWatchSignal('[browser-watch] watchId=a watchId=b reason=matched waitedMs=1')).toBeNull()
    expect(parseBrowserWatchSignal('[browser-watch] watchId=a reason=matched reason=timeout waitedMs=1')).toBeNull()
    // Whitespace inside scalar fields.
    expect(parseBrowserWatchSignal('[browser-watch] watchId=a b reason=matched waitedMs=1')).toBeNull()
    // Trailing unknown key or free text AFTER url is now a valid producer
    // url tail (oneLine keeps spaces); garbage with no url=/title= literal
    // after the required section still fails.
    expect(parseBrowserWatchSignal('[browser-watch] watchId=bw-1 reason=matched waitedMs=1 hello')).toBeNull()
    expect(parseBrowserWatchSignal('[browser-watch] watchId=bw-1 reason=matched waitedMs=1 url=')).toBeNull()
    // Empty title never occurs in the producer; reject the title-only branch.
    expect(parseBrowserWatchSignal('[browser-watch] watchId=bw-1 reason=matched waitedMs=1 title=')).toBeNull()
    // Ordinary user prose — even about watching — never matches the protocol.
    expect(parseBrowserWatchSignal('帮我监听页面变化')).toBeNull()
    expect(parseBrowserWatchSignal('[browser-watch hello')).toBeNull()
    expect(parseBrowserWatchSignal('[subagent-done] name=worker ok=true')).toBeNull()
  })

  it('keeps producer-controlled title/url text with field lookalikes valid', () => {
    // title is the tail of the producer header line: embedded ` reason=` /
    // ` waitedMs=` fragments stay part of the title, never fields/duplicates.
    const titleLookalike = parseBrowserWatchSignal('[browser-watch] watchId=bw-3 reason=matched waitedMs=5000 title=页面出现 reason=完成 waitedMs=提示')!
    expect(titleLookalike).toMatchObject({ kind: 'browser-watch', tone: 'success' })
    expect(titleLookalike.summary).toBe('条件命中 · 页面出现 reason=完成 waitedMs=提示')
    expect(titleLookalike.meta).toContain('等待 5s')
    expect(titleLookalike.fields.waitedMs).toBe('5000')
    // A query-style url token keeps lookalike keys inside one url field.
    const urlLookalike = parseBrowserWatchSignal('[browser-watch] watchId=bw-4 reason=disposed waitedMs=7000 url=https://x/a?reason=1&title=2')!
    expect(urlLookalike).toMatchObject({ kind: 'browser-watch', tone: 'warning', summary: '页面已释放 · https://x/a?reason=1&title=2' })
    // A spaced url tail with a field-lookalike fragment is valid producer
    // output and must not be truncated.
    const spacedUrl = parseBrowserWatchSignal('[browser-watch] watchId=bw-5 reason=matched waitedMs=3000 url=https://example/x reason=foo')!
    expect(spacedUrl).toMatchObject({ kind: 'browser-watch', tone: 'success' })
    expect(spacedUrl.fields.url).toBe('https://example/x reason=foo')
    expect(spacedUrl.summary).toBe('条件命中 · https://example/x reason=foo')
  })

  it('accepts the canonical hand-written grammar layouts (producer fixtures live in apps/electron/src/main/browser-watch-parser-contract.test.ts)', () => {
    // Mirrors of the three producer layouts; the real-formatter fixtures are
    // generated by the runtime module itself in the contract test (the ui
    // package's tsc build cannot import .ts runtime paths).
    const full = parseBrowserWatchSignal('[browser-watch] watchId=bw-17 reason=matched waitedMs=4200 url=https://example.com/ready title=Example Ready\n页面出现 .ready 元素\nUse browser observe to inspect the current page. Do not treat this message as a new user request.')!
    expect(full).toMatchObject({ kind: 'browser-watch', tone: 'success' })
    expect(full.detail).toContain('页面出现 .ready 元素')
    expect(full.detail).toContain('Do not treat this message as a new user request.')
    const bare = parseBrowserWatchSignal('[browser-watch] watchId=bw-2 reason=timeout waitedMs=61000\nUse browser observe to inspect the current page. Do not treat this message as a new user request.')!
    expect(bare).toMatchObject({ kind: 'browser-watch', tone: 'warning', summary: '等待超时 · bw-2' })
    expect(bare.meta).toContain('等待 1min01s')
  })

  it('accepts the real producer layout with and without url/title and the fixed trailer', () => {
    // Exact formatBrowserWatchMessage shape: header line, optional summary
    // line, fixed trailer line.
    const full = parseBrowserWatchSignal('[browser-watch] watchId=bw-17 reason=matched waitedMs=4200 url=https://example.com/ready title=Example Ready\n页面出现 .ready 元素\nUse browser observe to inspect the current page. Do not treat this message as a new user request.')!
    expect(full).toMatchObject({ kind: 'browser-watch', tone: 'success' })
    expect(full.detail).toContain('页面出现 .ready 元素')
    expect(full.detail).toContain('Do not treat this message as a new user request.')
    const bare = parseBrowserWatchSignal('[browser-watch] watchId=bw-2 reason=timeout waitedMs=61000\nUse browser observe to inspect the current page. Do not treat this message as a new user request.')!
    expect(bare).toMatchObject({ kind: 'browser-watch', tone: 'warning', summary: '等待超时 · bw-2' })
    expect(bare.meta).toContain('等待 1min01s')
  })
})

describe('parseInternalUserSignal dispatch', () => {
  it('routes watch wakes before the subagent wrapper-only fallback and keeps both families working', () => {
    expect(parseInternalUserSignal(WATCH_MATCHED)).toMatchObject({ kind: 'browser-watch' })
    // A wrapped watch must keep the watch label, not 子任务送达通知.
    expect(parseInternalUserSignal(`(re-delivery #1: prior follow-up not confirmed)\n${WATCH_MATCHED}`)).toMatchObject({ kind: 'browser-watch', delivery: 'retry' })
    expect(parseInternalUserSignal('[subagent-done] name=worker ok=true\nTitle: 文档')).toMatchObject({ kind: 'done' })
    expect(parseInternalUserSignal('(re-delivery #1: previous done not confirmed)')).toMatchObject({ kind: 'unknown', delivery: 'retry' })
    expect(parseInternalUserSignal('普通用户消息')).toBeNull()
    // Malformed watch text falls through to ordinary prose, never a card.
    expect(parseInternalUserSignal('[browser-watch] 普通文本乱写')).toBeNull()
    expect(parseInternalUserSignal('[browser-watch] watchId=bw-1 reason=matched waitedMs=abc')).toBeNull()
  })
})
