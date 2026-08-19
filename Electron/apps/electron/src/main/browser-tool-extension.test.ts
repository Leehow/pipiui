import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../resources/runtime/extensions/pipiui-electron-webview.ts'), 'utf8')

describe('pipiui-electron-webview target schema', () => {
  it('adds an optional target without changing the default single-viewport contract', () => {
    expect(source).toContain('Type.Literal("active")')
    expect(source).toContain('Type.Literal("desktop")')
    expect(source).toContain('Type.Literal("mobile")')
    expect(source).toContain('Type.Literal("both")')
    expect(source).toContain('const targetParams = target ? { target } : {}')
    expect(source).toContain('bridge("screenshot", { ...targetParams }')
    expect(source).toContain('bridge("observe", { scope: params.scope ?? "viewport", ...targetParams }')
  })

  it('maps screenshot both onto two labeled image parts and rejects unsafe both actions', () => {
    expect(source).toContain('content.push({ type: "image"')
    expect(source).toContain('viewport')
    expect(source).toContain('cannot target both viewports; specify target=desktop or target=mobile')
    expect(source).toContain('["click", "input", "type", "select", "scroll", "eval", "content", "console", "wait"]')
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
