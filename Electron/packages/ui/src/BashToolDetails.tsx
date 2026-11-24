import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { BashDetailRequest, BashDetailResponse, PipiHostAPI } from '@pipi/host-api'
import { displaySecretPlaceholders } from './secret-display'

const BashHostContext = createContext<{ host: PipiHostAPI; sessionId: string; agentId?: string; runId?: string; enabled: boolean } | null>(null)
export function BashDetailsProvider({ host, sessionId, agentId, runId, enabled = true, children }: { host: PipiHostAPI; sessionId: string; agentId?: string; runId?: string; enabled?: boolean; children: ReactNode }) {
  return <BashHostContext.Provider value={{ host, sessionId, agentId, runId, enabled }}>{children}</BashHostContext.Provider>
}

// One shared round-robin clock. Forty open cards do not create forty 5Hz timers.
const readers = new Set<() => Promise<void>>()
let timer: ReturnType<typeof setTimeout> | undefined
let active: { reader: () => Promise<void> } | undefined
const pendingRequests = new Set<Promise<BashDetailResponse>>()
async function readDetails(host: PipiHostAPI, request: BashDetailRequest): Promise<BashDetailResponse> {
  if (pendingRequests.size >= 4) throw new Error('日志读取通道繁忙，请稍后重试。')
  const requestPromise = Promise.resolve().then(() => host.getBashDetails!(request))
  pendingRequests.add(requestPromise)
  void requestPromise.then(() => pendingRequests.delete(requestPromise), () => pendingRequests.delete(requestPromise))
  let deadline: ReturnType<typeof setTimeout> | undefined
  try {
    const value = await Promise.race([requestPromise, new Promise<never>((_, reject) => {
      deadline = setTimeout(() => reject(new Error('日志读取超时，请重试。')), 8000)
    })])
    if (value?.identity && (value.identity.sessionId !== request.sessionId || value.identity.toolCallId !== request.toolCallId || value.identity.agentId !== request.agentId || value.identity.runId !== request.runId)) throw new Error('日志归属不匹配，请重试。')
    return value
  } finally { if (deadline) clearTimeout(deadline) }
}
// 64 views × (64KiB snapshot + 32KiB history page) < 8MiB body budget.
let activeDetails = 0
function schedule() {
  if (timer || active || !readers.size) return
  timer = setTimeout(async () => {
    timer = undefined
    if (typeof document !== 'undefined' && document.hidden) { schedule(); return }
    const reader = readers.values().next().value
    if (!reader) return
    readers.delete(reader); readers.add(reader)
    const slot = { reader }
    active = slot
    try { await reader() } finally { if (active === slot) active = undefined; schedule() }
  }, 200)
}
function subscribe(reader: () => Promise<void>) {
  readers.add(reader); schedule()
  return () => {
    readers.delete(reader)
    if (active?.reader === reader) { active = undefined; schedule() }
    if (!readers.size && timer) { clearTimeout(timer); timer = undefined }
  }
}

/** Mount only under an expanded ActivityCard; unmounting revokes demand. */
export function BashToolDetails({ toolCallId, fallbackInput, fallbackOutput }: { toolCallId: string; fallbackInput?: string; fallbackOutput?: string }) {
  const context = useContext(BashHostContext)
  const [visible, setVisible] = useState(() => !document.hidden)
  useEffect(() => {
    const changed = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  const [snapshot, setSnapshot] = useState<BashDetailResponse>()
  const [error, setError] = useState<string>()
  const [legacy, setLegacy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [page, setPage] = useState<{ field: 'input' | 'output'; text: string; nextOffset?: number; truncated?: boolean; revision?: number }>()
  const [pageLoading, setPageLoading] = useState(false)
  const output = useRef<HTMLPreElement>(null)
  const following = useRef(true)
  const epoch = useRef(0)
  const host = context?.host
  const sessionId = context?.enabled ? context.sessionId : undefined
  const agentId = context?.agentId
  const runId = context?.runId
  useEffect(() => {
    const generation = ++epoch.current
    setSnapshot(undefined); setPage(undefined); setError(undefined); setPageLoading(false); setLegacy(false)
    following.current = true
    if (!visible || !host?.getBashDetails || !sessionId) return
    if (activeDetails >= 64) { setError('已达到详情内存预算，请先收起其它命令后重试。'); return }
    activeDetails++
    let cancelled = false
    let revision: number | undefined
    let off = () => {}
    off = subscribe(async () => {
      if (cancelled) return
      try {
        const value = await readDetails(host, { sessionId, toolCallId, agentId, runId, sinceRevision: revision })
        if (cancelled || generation !== epoch.current) return
        if (value == null) { setLegacy(true); off(); return }
        revision = value.revision
        if (!value.unchanged) setSnapshot(value)
        if (value.state !== 'running') off()
      } catch (cause) {
        if (!cancelled) {
          const message = cause instanceof Error ? cause.message : '加载失败'
          if (/getBashDetails/i.test(message) && /unknown|unsupported|not found|not supported/i.test(message)) setLegacy(true)
          else setError(message)
          off()
        }
      }
    })
    return () => { cancelled = true; epoch.current++; activeDetails--; off() }
  }, [host, sessionId, toolCallId, agentId, runId, attempt, visible])
  useEffect(() => {
    if (following.current && output.current) output.current.scrollTop = output.current.scrollHeight
  }, [snapshot?.output])
  async function loadPage(field: 'input' | 'output', offset = 0) {
    if (!host?.getBashDetails || !sessionId || pageLoading) return
    const generation = epoch.current
    setPageLoading(true)
    try {
      const value = await readDetails(host, { sessionId, toolCallId, agentId, runId, field, offset, sinceRevision: offset > 0 ? page?.revision : undefined })
      if (generation === epoch.current) {
        setPage({ field, text: value.text || (value.state === 'unavailable' ? '详情不可用，原始记录可能已不存在。' : '暂无内容'), nextOffset: value.nextOffset, truncated: value.truncated, revision: value.revision })
      }
    } catch (cause) {
      if (generation === epoch.current) setError(cause instanceof Error ? cause.message : '加载失败')
    } finally { if (generation === epoch.current) setPageLoading(false) }
  }
  const available = Boolean(host?.getBashDetails && sessionId && !legacy)
  const input = available ? snapshot?.input : fallbackInput
  const text = available ? snapshot?.output : fallbackOutput
  return <div className="bash-tool-details" data-testid="bash-tool-details">
    {error && <div role="alert"><span>{error}</span><button onClick={() => setError(undefined)} aria-label="关闭日志错误">×</button><button onClick={() => setAttempt(value => value + 1)}>重试</button></div>}
    {available && !snapshot && !error && <p role="status">正在加载命令详情…</p>}
    {context?.enabled === false && <p>此历史视图缺少精确运行归属，仅显示已保留摘要。</p>}
    {snapshot?.state === 'unavailable' && <p>详情不可用，可能仅保留了命令摘要。</p>}
    {input && <div className="tool-io"><div className="tool-io-label">命令参数</div><pre style={{ maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{displaySecretPlaceholders(input)}</pre></div>}
    {snapshot?.inputTruncated && <button disabled={pageLoading} onClick={() => void loadPage('input')}>参数较长，分段查看</button>}
    {(snapshot || !available) && <div className="tool-io"><div className="tool-io-label">输出</div><pre ref={output} onScroll={() => { const el = output.current; if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24 }} style={{ maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{displaySecretPlaceholders(text || (snapshot?.state === 'running' ? '等待输出…' : '暂无可用输出'))}</pre>
      <button onClick={() => { following.current = true; if (output.current) output.current.scrollTop = output.current.scrollHeight }}>跟随最新输出</button>
    </div>}
    {snapshot?.outputTruncated && <p>当前仅显示部分输出。<button disabled={pageLoading} onClick={() => void loadPage('output')}>从已保存记录分段查看</button></p>}
    {pageLoading && <p role="status">正在加载记录…</p>}
    {page && <section aria-label="已保存命令记录"><button onClick={() => setPage(undefined)}>关闭记录</button><pre style={{ maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{displaySecretPlaceholders(page.text)}</pre>{page.truncated && <p>记录不完整或已截断。</p>}{page.nextOffset !== undefined && <button disabled={pageLoading} onClick={() => void loadPage(page.field, page.nextOffset)}>下一段</button>}</section>}
  </div>
}
