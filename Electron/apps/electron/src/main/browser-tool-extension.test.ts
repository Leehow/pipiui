import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeBrowserTool } from '../../../../resources/runtime/extensions/pipiui-electron-webview.ts'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../resources/runtime/extensions/pipiui-electron-webview.ts'), 'utf8')

describe('pipiui-electron-webview target schema', () => {
  it('adds an optional target without changing the default single-viewport contract', () => {
    expect(source).toContain('Type.Literal("active")')
    expect(source).toContain('Type.Literal("desktop")')
    expect(source).toContain('Type.Literal("mobile")')
    expect(source).toContain('Type.Literal("both")')
    expect(source).toContain('const targetParams = target ? { target } : {}')
    expect(source).toContain('bridge("screenshot", { ...targetParams }')
    expect(source).toContain('bridge("observe", {')
    expect(source).toContain('scope: params.scope ?? "viewport"')
  })

  it('maps screenshot both onto two labeled image parts and rejects unsafe both actions', () => {
    expect(source).toContain('content.push({ type: "image"')
    expect(source).toContain('viewport')
    expect(source).toContain('cannot target both viewports; specify target=desktop or target=mobile')
    expect(source).toContain('["click", "input", "type", "select", "fill_form", "scroll", "eval", "content", "console", "wait"]')
  })

  it('requires dual structured and visual review only for responsive frontend acceptance', () => {
    expect(source).toContain(
      'Ordinary browsing may use target=active (default). For frontend or responsive-layout implementation/debugging, before claiming responsive visual acceptance, call observe with target=both for structured inspection, then screenshot with target=both and visually review both labeled desktop/mobile images.',
    )
    expect(source).toContain(
      "For frontend/responsive-layout implementation or debugging, before claiming responsive visual acceptance, run observe target='both' for structured inspection, then screenshot target='both' and visually review the two labeled desktop/mobile images.",
    )
  })
})

describe('pipiui-electron-webview actions batch', () => {
  it('declares optional actions[] of 1..8 items mutually exclusive with action', () => {
    expect(source).toContain('actions: Type.Optional(Type.Array')
    expect(source).toContain('minItems: 1')
    expect(source).toContain('maxItems: 8')
    expect(source).toContain('action: Type.Optional(Type.String(')
    expect(source).toContain('browser requires exactly one of "action" or "actions"')
    expect(source).toContain('browser actions must be an array of 1..8 items.')
    expect(source).toContain('executeBrowserActionBatch')
    expect(source).toContain('executeBrowserAction(')
  })

  it('stops the batch on first failure and reports skipped indexes', () => {
    expect(source).toContain('status: "ok" | "failed" | "skipped"')
    expect(source).toContain('stopped at index')
    expect(source).toContain('skipped')
    expect(source).toContain('isBrowserActionError')
    expect(source).toContain('A failed step stops the batch; remaining items are skipped')
  })

  it('guides packing consecutive actions and names observation breakpoints', () => {
    expect(source).toContain('Prefer packing consecutive actions that do not need an intermediate observation into one actions[] call')
    expect(source).toContain('fill_form then submit click, click then wait, type then Enter')
    expect(source).toContain('Stop and observe after navigate, after submitting a form, and when a dialog, captcha, or login wall may appear')
    expect(source).toContain('Prefer actions[] (1..8) for consecutive steps that do not need an intermediate observation')
    expect(source).toContain('Pass exactly one of action (single) or actions (batch).')
  })
})

type BridgeCall = { rpcAction: string; action: string; event: Record<string, unknown> }

function textOf(result: any): string {
  return (result?.content || []).filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n')
}

/** Replaces global fetch so the extension's bridge() layer is fully mocked. */
function installBridgeMock(responses: Array<Record<string, any> | Error>) {
  const calls: BridgeCall[] = []
  const fetchMock = vi.fn(async (_url: unknown, init?: { body?: string; signal?: AbortSignal }) => {
    const body = JSON.parse(init?.body ?? '{}')
    calls.push({ rpcAction: body.action, action: body.event?.action, event: body.event ?? {} })
    if (init?.signal?.aborted) throw new Error('The operation was aborted')
    const response = responses.shift()
    if (!response) throw new Error(`unexpected bridge call #${calls.length}: ${body.event?.action}`)
    if (response instanceof Error) throw response
    return { json: async () => response }
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

const OK_RELOAD = { ok: true, url: 'https://example.com/', title: 'Example', snapshotID: 'snap-1', viewport: { width: 800, height: 600 } }

describe('pipiui-electron-webview tool execute (behavioral)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('accepts exactly one of action or actions across all four input combinations', async () => {
    const { calls } = installBridgeMock([OK_RELOAD])
    const neither = await executeBrowserTool({}, undefined)
    expect(neither.isError).toBe(true)
    expect(textOf(neither)).toContain('exactly one of "action" or "actions"')
    const both = await executeBrowserTool({ action: 'reload', actions: [{ action: 'reload' }] }, undefined)
    expect(both.isError).toBe(true)
    expect(textOf(both)).toContain('exactly one of "action" or "actions"')
    expect(calls.length).toBe(0)
    const single = await executeBrowserTool({ action: 'help' }, undefined)
    expect(single.isError).toBeUndefined()
    expect(textOf(single)).toContain('browser actions:')
    expect(calls.length).toBe(0)
    const batch = await executeBrowserTool({ actions: [{ action: 'reload' }] }, undefined)
    expect(batch.isError).toBeUndefined()
    expect(batch.details.batch).toBe(true)
    expect(calls.length).toBe(1)
  })

  it('marks parameter-validation failures as errors without touching the bridge', async () => {
    const { calls } = installBridgeMock([])
    const navigate = await executeBrowserTool({ action: 'navigate' }, undefined)
    expect(navigate.isError).toBe(true)
    expect(textOf(navigate)).toContain('browser navigate requires "url"')
    expect(calls.length).toBe(0)
    const batch = await executeBrowserTool({ actions: [{ action: 'input', text: 'x' }] }, undefined)
    expect(batch.isError).toBe(true)
    expect(batch.details.results[0]).toMatchObject({ index: 0, status: 'failed', isError: true })
    expect(calls.length).toBe(0)
  })

  it('forwards scroll selector to the bridge and rejects mixing selector with snapshot targets', async () => {
    const { calls } = installBridgeMock([OK_RELOAD])
    const ok = await executeBrowserTool({ action: 'scroll', selector: '#scroll-container', direction: 'down', amount: 2 }, undefined)
    expect(ok.isError).toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(calls[0].event).toMatchObject({ action: 'scroll', selector: '#scroll-container', direction: 'down', amount: 2, scope: 'viewport' })
    expect(source).toContain('scroll {direction?, amount?, selector? | locator? | snapshot_id?, element_index|element_token?}')

    const mixedSnapshot = await executeBrowserTool({ action: 'scroll', selector: '#x', snapshot_id: 's1', element_index: 0 }, undefined)
    expect(mixedSnapshot.isError).toBe(true)
    expect(textOf(mixedSnapshot)).toContain('browser scroll accepts selector or a snapshot element target, not both')
    const mixedToken = await executeBrowserTool({ action: 'scroll', selector: '#x', element_token: 'tok-1' }, undefined)
    expect(mixedToken.isError).toBe(true)
    expect(textOf(mixedToken)).toContain('browser scroll accepts selector or a snapshot element target, not both')
    expect(calls).toHaveLength(1)
  })

  it('forwards scroll locator to the bridge and rejects mixing locator with selector or snapshot', async () => {
    const { calls } = installBridgeMock([OK_RELOAD])
    const ok = await executeBrowserTool(
      { action: 'scroll', locator: { role: 'region', name: 'Feed' }, direction: 'down', amount: 0.8 },
      undefined,
    )
    expect(ok.isError).toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(calls[0].event).toMatchObject({
      action: 'scroll',
      locator: { role: 'region', name: 'Feed' },
      direction: 'down',
      amount: 0.8,
      scope: 'viewport',
    })
    expect(calls[0].event.selector).toBeUndefined()
    expect(source).toContain('click/input/select/scroll accept locator')
    expect(source).toContain('locator uses the same {role,name}')

    const mixedSelector = await executeBrowserTool(
      { action: 'scroll', selector: '#x', locator: { css: '#x' } },
      undefined,
    )
    expect(mixedSelector.isError).toBe(true)
    expect(textOf(mixedSelector)).toContain('browser scroll accepts selector or locator, not both')
    const mixedSnapshot = await executeBrowserTool(
      { action: 'scroll', locator: { css: '#x' }, snapshot_id: 's1', element_index: 0 },
      undefined,
    )
    expect(mixedSnapshot.isError).toBe(true)
    expect(textOf(mixedSnapshot)).toContain('browser scroll accepts locator or a snapshot element target, not both')
    expect(calls).toHaveLength(1)
  })

  it('forwards locator scroll parameters inside a batch', async () => {
    const { calls } = installBridgeMock([OK_RELOAD, OK_RELOAD])
    const result = await executeBrowserTool(
      {
        actions: [
          { action: 'scroll', locator: { css: '#scroll-container' }, direction: 'down', amount: 1 },
          { action: 'observe' },
        ],
      },
      undefined,
    )
    expect(result.isError).toBeUndefined()
    expect(calls[0].event).toMatchObject({
      action: 'scroll',
      locator: { css: '#scroll-container' },
      direction: 'down',
      amount: 1,
    })
    expect(calls[0].event.selector).toBeUndefined()
    expect(calls[1].event).toMatchObject({ action: 'observe' })
    expect(result.details.results.map((entry: any) => entry.status)).toEqual(['ok', 'ok'])
  })

  it('does not misread a successful result that happens to end with the help text as an error', async () => {
    const helpText = textOf(await executeBrowserTool({ action: 'help' }, undefined))
    installBridgeMock([{ ok: true, result: `page notes:\n${helpText}` }])
    const result = await executeBrowserTool({ actions: [{ action: 'eval', js: 'document.title' }] }, undefined)
    expect(result.isError).toBeUndefined()
    expect(result.details.ok).toBe(true)
    expect(result.details.results[0]).toMatchObject({ index: 0, action: 'eval', status: 'ok' })
  })

  it('stops at a failed item, skips the rest, and never calls the bridge for skipped items', async () => {
    const { calls, fetchMock } = installBridgeMock([OK_RELOAD, { ok: false, error: 'click failed', code: 'no_match' }])
    const result = await executeBrowserTool(
      { actions: [{ action: 'reload' }, { action: 'click', locator: { role: 'button', name: 'Go' } }, { action: 'reload' }] },
      undefined,
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ batch: true, ok: false, failedIndex: 1, skipped: [2] })
    expect(result.details.results).toEqual([
      expect.objectContaining({ index: 0, action: 'reload', status: 'ok' }),
      expect.objectContaining({ index: 1, action: 'click', status: 'failed', isError: true }),
      expect.objectContaining({ index: 2, action: 'reload', status: 'skipped' }),
    ])
    expect(textOf(result)).toContain('stopped at index 1 (click)')
    expect(textOf(result)).toContain('[2] reload skipped')
    expect(textOf(result)).toContain('click failed')
  })

  it('converts a thrown bridge error into a failed item plus skipped remainder instead of rejecting', async () => {
    const { fetchMock } = installBridgeMock([new Error('bridge connection reset')])
    const result = await executeBrowserTool({ actions: [{ action: 'reload' }, { action: 'reload' }] }, undefined)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ ok: false, failedIndex: 0, skipped: [1] })
    expect(result.details.results[0]).toMatchObject({ index: 0, action: 'reload', status: 'failed' })
    expect(result.details.results[1]).toMatchObject({ index: 1, status: 'skipped' })
    expect(textOf(result)).toContain('bridge connection reset')
  })

  it('reports an already-aborted signal as a failed item plus skipped remainder without any bridge RPC', async () => {
    const { calls, fetchMock } = installBridgeMock([])
    const result = await executeBrowserTool(
      { actions: [{ action: 'reload' }, { action: 'reload' }] },
      AbortSignal.abort(),
    )
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ ok: false, failedIndex: 0, skipped: [1] })
    expect(result.details.results[0]).toMatchObject({ index: 0, action: 'reload', status: 'failed', isError: true })
    expect(textOf(result)).toContain('timed out or was cancelled')
    // The pre-abort check runs before the item: no bridge request and no
    // browser_cancel for a request that never started.
    expect(fetchMock).toHaveBeenCalledTimes(0)
    expect(calls).toHaveLength(0)
  })

  it('does not issue the next item RPC when the signal aborts between items', async () => {
    const controller = new AbortController()
    const calls: BridgeCall[] = []
    const fetchMock = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}')
      calls.push({ rpcAction: body.action, action: body.event?.action, event: body.event ?? {} })
      // Abort while item 0's bridge response is in flight: item 0 still completes
      // ok, but the batch must not start item 1.
      controller.abort()
      return { json: async () => (OK_RELOAD) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await executeBrowserTool(
      { actions: [{ action: 'reload' }, { action: 'reload' }, { action: 'reload' }] },
      controller.signal,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(calls.map((call) => call.action)).toEqual(['reload'])
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ ok: false, failedIndex: 1, skipped: [2] })
    expect(result.details.results[0]).toMatchObject({ index: 0, action: 'reload', status: 'ok' })
    expect(result.details.results[1]).toMatchObject({ index: 1, action: 'reload', status: 'failed', isError: true })
    expect(result.details.results[2]).toMatchObject({ index: 2, action: 'reload', status: 'skipped' })
    expect(textOf(result)).toContain('stopped at index 1 (reload)')
    expect(textOf(result)).toContain('[2] reload skipped')
    expect(textOf(result)).toContain('timed out or was cancelled')
  })

  it('keeps a structured host wait timeout as a normal bridge result, not a generic cancellation', async () => {
    const { calls } = installBridgeMock([{ ok: false, error: 'browser wait timed out', code: 'timeout' }])
    const result = await executeBrowserTool(
      { actions: [{ action: 'wait', mode: 'idle', timeout: 0.1 }, { action: 'eval', js: 'document.title' }] },
      undefined,
    )
    expect(calls.map((call) => call.action)).toEqual(['wait'])
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ ok: false, failedIndex: 0, skipped: [1] })
    expect(textOf(result)).toContain('browser wait timed out')
    expect(textOf(result)).not.toContain('browser request timed out or was cancelled')
  })

  it('fails an item that lacks action and skips the rest of the batch', async () => {
    const { calls } = installBridgeMock([OK_RELOAD])
    const result = await executeBrowserTool({ actions: [{ action: 'reload' }, { url: 'https://x.example/' }] }, undefined)
    expect(calls.length).toBe(1)
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ ok: false, failedIndex: 1, skipped: [] })
    expect(result.details.results[1]).toMatchObject({ index: 1, action: '', status: 'failed', isError: true })
    expect(textOf(result)).toContain('requires "action"')
  })

  it('labels each batch screenshot image with its step index and action', async () => {
    installBridgeMock([
      OK_RELOAD,
      { ok: true, images: [{ base64: 'QUJD', mimeType: 'image/png', viewport: 'desktop', width: 100, height: 50 }] },
    ])
    const result = await executeBrowserTool({ actions: [{ action: 'reload' }, { action: 'screenshot' }] }, undefined)
    expect(result.isError).toBeUndefined()
    const imageIndex = result.content.findIndex((part: any) => part.type === 'image')
    expect(imageIndex).toBeGreaterThan(-1)
    expect(result.content[imageIndex - 1]).toMatchObject({ type: 'text', text: '[1] screenshot desktop' })
    expect(result.content[imageIndex]).toMatchObject({ type: 'image', data: 'QUJD', mimeType: 'image/png' })
  })

  it('skips the remaining items when the batch time budget is exhausted', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    let releaseFirst!: () => void
    const actions: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}')
      actions.push(body.event?.action)
      if (actions.length === 1) await new Promise<void>((resolve) => { releaseFirst = resolve })
      return { json: async () => (OK_RELOAD) }
    }))
    const pending = executeBrowserTool(
      { actions: [{ action: 'reload' }, { action: 'reload' }, { action: 'reload' }] },
      undefined,
    )
    expect(actions).toEqual(['reload'])
    vi.setSystemTime(200_000)
    releaseFirst()
    const result = await pending
    expect(actions).toEqual(['reload'])
    expect(result.isError).toBe(true)
    expect(result.details.budgetExhaustedAt).toBe(1)
    expect(result.details.skipped).toEqual([1, 2])
    expect(result.details.results.map((entry: any) => entry.status)).toEqual(['ok', 'skipped', 'skipped'])
    expect(textOf(result)).toContain('time budget exhausted before index 1')
    expect(textOf(result)).toContain('[1] reload skipped (batch time budget exhausted)')
  })

  it('renders a compact mutation summary for lightweight batch DOM results instead of fake empty metadata', async () => {
    const lightweightClick = {
      ok: true,
      deferObservation: true,
      action: { kind: 'click' },
      mutation: { added: 2, removed: 0, attributes: 1, dialogs: [], urlChanged: false },
    }
    const { calls } = installBridgeMock([lightweightClick, OK_RELOAD])
    const result = await executeBrowserTool(
      { actions: [{ action: 'click', locator: { role: 'button', name: 'Go' } }, { action: 'reload' }] },
      undefined,
    )
    expect(result.isError).toBeUndefined()
    expect(calls.map((call) => call.action)).toEqual(['click', 'reload'])
    const batchText = textOf(result)
    expect(batchText).toContain('Action: {"kind":"click"}')
    expect(batchText).toContain('Mutation: {"added":2')
    // No fabricated empty page metadata for results that carry no snapshot.
    expect(batchText).not.toContain('Viewport: 0x0')
    expect(batchText).not.toContain('Title: \n')
    // Full observations (reload) still print their metadata.
    expect(batchText).toContain(`URL: ${OK_RELOAD.url}`)
    expect(batchText).toContain('Viewport: 800x600')
    expect(result.details.results[0]).toMatchObject({ index: 0, action: 'click', status: 'ok' })
    // Single-action clicks keep the full observation contract (deferred metadata included).
    installBridgeMock([lightweightClick])
    const single = await executeBrowserTool({ action: 'click', locator: { role: 'button', name: 'Go' } }, undefined)
    expect(single.isError).toBeUndefined()
    expect(textOf(single)).toContain('URL: ')
  })

  it('keeps batch parameter failures short and specific without repeating the whole help', async () => {
    const { calls } = installBridgeMock([])
    const result = await executeBrowserTool(
      { actions: [{ action: 'click' }, { action: 'reload' }] },
      undefined,
    )
    expect(calls.length).toBe(0)
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ ok: false, failedIndex: 0, skipped: [1] })
    expect(result.details.results[0]).toMatchObject({ index: 0, action: 'click', status: 'failed', isError: true })
    const batchText = textOf(result)
    expect(batchText).toContain('browser click requires snapshot_id and exactly one of element_index or element_token, or a locator')
    expect(batchText).toContain('[1] reload skipped')
    // The embedded HELP manual is stripped; only a one-line pointer remains.
    expect(batchText).not.toContain('fill_form {fields')
    expect(batchText).not.toContain('watch {timeoutSecs')
    expect(batchText).toContain('action:"help"')
  })

  it('deduplicates repeated identical large outputs inside the batch text', async () => {
    const body = 'x'.repeat(3000)
    const other = 'y'.repeat(3000)
    installBridgeMock([
      { ok: true, content: body },
      { ok: true, content: body },
      { ok: true, content: other },
    ])
    const result = await executeBrowserTool(
      { actions: [{ action: 'content' }, { action: 'content' }, { action: 'content' }] },
      undefined,
    )
    expect(result.isError).toBeUndefined()
    const batchText = textOf(result)
    expect(batchText.split(body).length - 1).toBe(1)
    expect(batchText).toContain('[duplicate of index 0: same 3000-char output, not repeated]')
    expect(batchText).toContain(other)
    expect(result.details.results.map((entry: any) => entry.status)).toEqual(['ok', 'ok', 'ok'])
    expect(result.details.results.map((entry: any) => entry.action)).toEqual(['content', 'content', 'content'])
  })

  it('caps earlier large outputs to a batch text budget while keeping final evidence and labeled images', async () => {
    const first = ('a'.repeat(20_000))
    const second = ('b'.repeat(20_000))
    const third = ('c'.repeat(20_000))
    installBridgeMock([
      { ok: true, content: first },
      { ok: true, content: second },
      { ok: true, content: third },
      { ok: true, images: [{ base64: 'QUJD', mimeType: 'image/png', viewport: 'desktop', width: 100, height: 50 }] },
    ])
    const result = await executeBrowserTool(
      { actions: [{ action: 'content' }, { action: 'content' }, { action: 'content' }, { action: 'screenshot' }] },
      undefined,
    )
    expect(result.isError).toBeUndefined()
    const batchText = textOf(result)
    expect(batchText.length).toBeLessThan(60_000)
    // Earlier entries are truncated with an explicit marker; the final content entry keeps its evidence.
    expect(batchText).toContain('chars omitted (batch text budget)')
    expect(batchText).toContain(third)
    expect(batchText).not.toContain(first)
    expect(batchText).not.toContain(second)
    expect(result.details.results.map((entry: any) => entry.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
    const imageIndex = result.content.findIndex((part: any) => part.type === 'image')
    expect(result.content[imageIndex - 1]).toMatchObject({ type: 'text', text: '[3] screenshot desktop' })
    expect(result.content[imageIndex]).toMatchObject({ type: 'image', data: 'QUJD' })
  })

  it('enforces one global body budget: several large earlier entries plus a 40k final entry stay well under the cap', async () => {
    // Each earlier body fits the per-entry cap (no slice), so only the global
    // accounting can stop them from stacking on top of the 40k final entry.
    const bodies = ['a', 'b', 'c', 'd', 'e'].map(ch => ch.repeat(7_900))
    const final = 'f'.repeat(40_000)
    installBridgeMock([
      ...bodies.map(content => ({ ok: true, content })),
      { ok: true, content: final },
    ])
    const result = await executeBrowserTool(
      { actions: [...bodies.map(() => ({ action: 'content' })), { action: 'content' }] },
      undefined,
    )
    expect(result.isError).toBeUndefined()
    const batchText = textOf(result)
    // The final substantial entry's 40k cap comes out of the same global budget as
    // the earlier entries: total bodies stay near 48k, never ~80k.
    expect(batchText.length).toBeLessThan(52_000)
    expect(batchText).toContain(final)
    expect(batchText).toContain('[output omitted: 7900 chars (batch text budget)]')
    expect(result.details.results.map((entry: any) => entry.status)).toEqual(Array.from({ length: 6 }, () => 'ok'))
  })

  it('truncates on UTF-16 surrogate pair boundaries, never leaving a lone surrogate', async () => {
    // 403 BMP chars, then 3799 emoji (2 UTF-16 units each), then one BMP char: the
    // plain 8000-cap truncation boundary lands between a high and a low surrogate.
    const emojiBody = 'a'.repeat(403) + '\uD83D\uDE00'.repeat(3_799) + 'b'
    expect(emojiBody.length).toBe(8_002)
    const other = 'c'.repeat(403) + '\uD83D\uDE00'.repeat(3_799) + 'd'
    installBridgeMock([
      { ok: true, content: emojiBody },
      { ok: true, content: other },
    ])
    const result = await executeBrowserTool(
      { actions: [{ action: 'content' }, { action: 'content' }] },
      undefined,
    )
    expect(result.isError).toBeUndefined()
    const batchText = textOf(result)
    expect(batchText).toContain('chars omitted (batch text budget)')
    // No orphaned high or low surrogate anywhere in the rendered batch text.
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    expect(loneSurrogate.test(batchText)).toBe(false)
    // The full second body survives as the final evidence.
    expect(batchText).toContain(other)
  })

  it('passes a fractional wait timeout through to the bridge inside a batch', async () => {
    const waitObservation = {
      ok: true,
      ready: true,
      mode: 'idle',
      url: 'https://example.com/',
      title: 'Example',
      snapshotID: 'snap-2',
      viewport: { width: 800, height: 600 },
    }
    const { calls } = installBridgeMock([
      { ok: true, deferObservation: true, action: { kind: 'click' }, mutation: { added: 1, removed: 0, attributes: 0, dialogs: [], urlChanged: false } },
      waitObservation,
    ])
    const result = await executeBrowserTool(
      { actions: [
        { action: 'click', locator: { role: 'button', name: 'Go' } },
        { action: 'wait', mode: 'idle', timeout: 0.3 },
      ] },
      undefined,
    )
    const waitCall = calls.find((call) => call.action === 'wait')
    expect(waitCall?.event).toMatchObject({ mode: 'idle', timeout: 0.3 })
    expect(result.isError).toBeUndefined()
    expect(result.details.ok).toBe(true)
    const batchText = textOf(result)
    expect(batchText).toContain('[1] wait ok')
    expect(batchText).toContain(`URL: ${waitObservation.url}`)
  })

  it('summarizes intermediate batch observation details while keeping final evidence and failed diagnostics', async () => {
    const huge = (id: string) => ({
      ok: true,
      url: `https://example.com/${id}`,
      title: `Page ${id}`,
      snapshotID: `snap-${id}`,
      viewport: { width: 800, height: 600 },
      scroll: { pixelsAbove: 0, pixelsBelow: 400, positionPercent: 0 },
      elements: Array.from({ length: 180 }, (_, i) => ({
        index: i,
        token: `tok-${id}-${i}`,
        role: 'button',
        name: `Btn ${id} ${i} ${'x'.repeat(24)}`,
      })),
      regions: [{
        id: 'main',
        name: 'main',
        role: 'main',
        count: 180,
        preview: Array.from({ length: 40 }, (_, i) => ({ token: `p-${id}-${i}`, name: `preview ${i}` })),
      }],
    })
    const first = huge('a')
    const second = huge('b')
    const third = huge('c')
    installBridgeMock([first, second, third])
    const result = await executeBrowserTool(
      { actions: [{ action: 'observe' }, { action: 'observe' }, { action: 'observe' }] },
      undefined,
    )
    expect(result.isError).toBeUndefined()
    expect(result.details.results.map((entry: any) => ({ index: entry.index, action: entry.action, status: entry.status }))).toEqual([
      { index: 0, action: 'observe', status: 'ok' },
      { index: 1, action: 'observe', status: 'ok' },
      { index: 2, action: 'observe', status: 'ok' },
    ])
    expect(result.details.results[0].details).toMatchObject({
      url: first.url,
      title: first.title,
      snapshotID: first.snapshotID,
      elementCount: 180,
      summarized: true,
    })
    expect(result.details.results[0].details.elements).toBeUndefined()
    expect(result.details.results[0].details.regions?.[0]?.preview).toBeUndefined()
    expect(result.details.results[1].details.elements).toBeUndefined()
    expect(result.details.results[2].details.elements).toHaveLength(180)
    expect(result.details.results[2].details.snapshotID).toBe(third.snapshotID)
    expect(result.details.results[2].details.summarized).toBeUndefined()
    const structured = JSON.stringify(result.details)
    expect(structured.length).toBeLessThan(JSON.stringify([first, second, third]).length)
    expect(structured.length).toBeLessThan(80_000)
    expect(textOf(result).length).toBeLessThan(52_000)

    installBridgeMock([
      first,
      second,
      {
        ok: false,
        error: 'locator matched 0 elements. Candidates: [{"role":"button","tag":"button","name":"Go"}]',
        code: 'browser_locator_not_found',
        candidates: [{ role: 'button', tag: 'button', name: 'Go' }],
      },
    ])
    const failed = await executeBrowserTool(
      {
        actions: [
          { action: 'observe' },
          { action: 'observe' },
          { action: 'click', locator: { role: 'button', name: 'Missing' } },
        ],
      },
      undefined,
    )
    expect(failed.isError).toBe(true)
    expect(failed.details).toMatchObject({ ok: false, failedIndex: 2, skipped: [] })
    expect(failed.details.results[0].details.elements).toBeUndefined()
    expect(failed.details.results[0].details.summarized).toBe(true)
    expect(failed.details.results[1].details.elements).toHaveLength(180)
    expect(failed.details.results[2]).toMatchObject({
      index: 2,
      action: 'click',
      status: 'failed',
      isError: true,
      details: {
        error: expect.stringContaining('0 elements'),
        code: 'browser_locator_not_found',
        candidates: [{ role: 'button', tag: 'button', name: 'Go' }],
      },
    })
    expect(textOf(failed)).toContain('browser_locator_not_found')
  })

  it('serves the watches list through the dedicated browser_watch bridge, not the DOM host dispatcher', async () => {
    const { calls } = installBridgeMock([
      { ok: true, watches: [{ watchId: 'bw-1', condition: { type: 'selector', selector: '.ready' }, status: 'active', createdAt: 1, timeoutAt: 61_000, intervalMs: 2_000 }] },
    ])
    const result = await executeBrowserTool({ action: 'watches' }, undefined)
    expect(result.isError).toBeUndefined()
    // The list rides the browser_watch RPC with op=list — never the DOM host
    // dispatcher, which would answer unknown_action for watches.
    expect(calls).toEqual([{
      rpcAction: 'browser_watch',
      action: 'watches',
      event: expect.objectContaining({ action: 'watches', op: 'list' }),
    }])
    expect(textOf(result)).toContain('bw-1')
    expect(textOf(result)).toContain('"selector":".ready"')
    expect(textOf(result)).toContain('status=active')
    expect(result.details.watches).toHaveLength(1)

    installBridgeMock([{ ok: false, error: 'browser watch limit reached for this session (8 active watches); unwatch one before registering another', code: 'browser_watch_limit_exceeded', limit: 8 }])
    const failed = await executeBrowserTool({ action: 'watches' }, undefined)
    expect(failed.isError).toBe(true)
    expect(textOf(failed)).toContain('browser_watch_limit_exceeded')
  })

  it('registers and cancels watches through the browser_watch bridge with structured failures', async () => {
    const { calls } = installBridgeMock([
      { ok: true, watchId: 'bw-9', condition: { type: 'idle' }, conditionSummary: 'idle', timeoutAt: 61_000, intervalMs: 2_000, watch: { watchId: 'bw-9', createdAt: 1_000, timeoutAt: 61_000 } },
      { ok: true },
    ])
    const registered = await executeBrowserTool({ action: 'watch', timeoutSecs: 60, idle: true }, undefined)
    expect(registered.isError).toBeUndefined()
    expect(calls[0]).toMatchObject({ rpcAction: 'browser_watch', action: 'watch' })
    expect(calls[0].event).toMatchObject({ op: 'register', timeoutSecs: 60, idle: true })
    expect(textOf(registered)).toContain('Registered watch bw-9')
    const cancelled = await executeBrowserTool({ action: 'unwatch', watchId: 'bw-9' }, undefined)
    expect(cancelled.isError).toBeUndefined()
    expect(calls[1]).toMatchObject({ rpcAction: 'browser_watch', action: 'unwatch' })
    expect(calls[1].event).toMatchObject({ op: 'unwatch', watchId: 'bw-9' })
  })
})
