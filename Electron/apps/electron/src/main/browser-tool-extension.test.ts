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

  it('reports an externally aborted signal as a failed item plus skipped remainder, not a rejection', async () => {
    const { calls } = installBridgeMock([])
    const result = await executeBrowserTool(
      { actions: [{ action: 'reload' }, { action: 'reload' }] },
      AbortSignal.abort(),
    )
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ ok: false, failedIndex: 0, skipped: [1] })
    expect(textOf(result)).toContain('timed out or was cancelled')
    // bridge() also registers disconnect cancellation for the aborted request.
    expect(calls.map((call) => call.action)).toEqual(['reload', 'browser_cancel'])
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
})
