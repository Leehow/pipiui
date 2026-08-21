// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const CHROME = [
  process.env.PIPIUI_CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
].find(candidate => candidate && existsSync(candidate))
const temporaryDirectories: string[] = []
type LayoutResult = {
  clientHeight: number
  scrollHeight: number
  initialScrollTop: number
  finalScrollTop: number
  lastVisible: boolean
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function renderPlanLayout(): LayoutResult {
  const directory = mkdtempSync(join(tmpdir(), 'pipiui-plan-layout-'))
  temporaryDirectories.push(directory)
  const css = readFileSync(new URL('./plan-panel.css', import.meta.url), 'utf8')
  const tasks = Array.from({ length: 12 }, (_, index) => `
    <li class="plan-task plan-task-completed" data-plan-last="${index === 11}">
      <span class="plan-task-mark">✓</span>
      <div class="plan-task-body">
        <div class="plan-task-title"><span class="plan-task-index">${index + 1}.</span>完成一项足够长的计划任务，以验证真实浏览器布局不会裁掉后面的内容</div>
        <div class="plan-task-note">landed in primary; targeted tests passed; build green; evidence retained for review</div>
      </div>
      <span class="plan-task-state">已完成</span>
    </li>`).join('')
  const html = `<!doctype html><meta charset="utf-8"><style>
    :root{--surface:#fff;--surface-raised:#fff;--border:#ddd;--border-strong:#bbb;--text:#333;--text-strong:#111;--muted:#666;--subtle:#888;--success:#17834f;--accent:#06c;--danger:#c00;--warning:#a60}
    *{box-sizing:border-box}body{margin:0}.fixture{width:760px;height:360px}
    ${css}
  </style><div class="fixture"><div class="plan-panel"><div class="plan-scroll">
    <details class="plan-card" open>
      <summary class="plan-card-summary"><div class="plan-card-heading"><b class="plan-card-title">长计划滚动验收</b><span class="plan-lifecycle plan-lifecycle-approved">已批准</span></div><div class="plan-card-meta">12/12 步完成</div><div class="plan-progress-bar"></div></summary>
      <ol class="plan-task-list">${tasks}</ol>
    </details>
  </div></div><output id="result"></output><script>
    const scroll = document.querySelector('.plan-scroll')
    const last = document.querySelector('[data-plan-last="true"]')
    const before = { clientHeight: scroll.clientHeight, scrollHeight: scroll.scrollHeight, initialScrollTop: scroll.scrollTop }
    scroll.scrollTop = scroll.scrollHeight
    const scrollBottom = scroll.getBoundingClientRect().bottom
    const lastBottom = last.getBoundingClientRect().bottom
    document.querySelector('#result').textContent = JSON.stringify({ ...before, finalScrollTop: scroll.scrollTop, lastVisible: lastBottom <= scrollBottom })
  </script>`
  const page = join(directory, 'plan-layout.html')
  writeFileSync(page, html)
  if (!CHROME) throw new Error('No Chromium browser found; set PIPIUI_CHROME_BIN to run this layout regression')
  const dumped = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--log-level=3', '--no-sandbox', '--dump-dom', `file://${page}`], { encoding: 'utf8' })
  const encoded = dumped.match(/<output id="result">([^<]+)<\/output>/)?.[1]
  if (!encoded) throw new Error(`Chrome did not emit layout result: ${dumped.slice(-500)}`)
  return JSON.parse(encoded.replaceAll('&quot;', '"')) as LayoutResult
}

describe.skipIf(!CHROME)('PlanPanel browser layout', () => {
  it('makes a long expanded plan vertically scrollable through its final task', () => {
    const layout = renderPlanLayout()

    expect(layout.scrollHeight).toBeGreaterThan(layout.clientHeight)
    expect(layout.finalScrollTop).toBeGreaterThan(0)
    expect(layout.lastVisible).toBe(true)
  })
})
