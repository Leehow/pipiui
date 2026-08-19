// Regression test: the electron-vite renderer must resolve @pipiui/ui from
// packages/ui SOURCE (src/index.ts, src/app.css) instead of the prebuilt
// packages/ui/dist. Otherwise dev HMR never sees packages/ui/src edits and a
// mid-build dist (temporarily missing files) breaks the dev server.
//
// Run with the rest of the workspace tests: `npm test` (from Electron/), or
// just this file: `npx vitest run apps/electron/electron.vite.config.test.ts`.
// The single dev command is `npm run dev` from Electron/ (forwards to the
// @pipiui/electron workspace).
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveFileViewerCopyAssetsTarget } from '@file-viewer/vite-plugin'
import electronViteConfig, { fileViewerAssetOptions, generatedWatchExcludes, rendererAssetFileNames } from './electron.vite.config'

type AliasEntry = { find: string | RegExp; replacement: string }

const config = electronViteConfig as {
  renderer?: { resolve?: { alias?: AliasEntry[] } }
}
const aliases: AliasEntry[] = config.renderer?.resolve?.alias ?? []

const bare = aliases.find((a) => a.find === '@pipiui/ui')
const style = aliases.find((a) => a.find === '@pipiui/ui/style.css')
const toPosix = (p: string): string => p.replace(/\\/g, '/')

describe('renderer resolves @pipiui/ui from packages/ui source', () => {
  it('aliases the bare package to packages/ui/src/index.ts, never dist', () => {
    expect(bare, 'expected an @pipiui/ui renderer alias').toBeDefined()
    expect(toPosix(bare!.replacement)).toMatch(/packages\/ui\/src\/index\.ts$/)
    expect(toPosix(bare!.replacement)).not.toContain('/dist/')
    expect(existsSync(bare!.replacement)).toBe(true)
  })

  it('maps @pipiui/ui/style.css to source app.css, listed before the bare alias', () => {
    expect(style, 'expected an @pipiui/ui/style.css renderer alias').toBeDefined()
    expect(toPosix(style!.replacement)).toMatch(/packages\/ui\/src\/app\.css$/)
    expect(existsSync(style!.replacement)).toBe(true)
    // String aliases are prefix-matched: the more specific subpath must win.
    expect(aliases.indexOf(style!)).toBeLessThan(aliases.indexOf(bare!))
  })

  it('never references packages/ui/dist in renderer resolution', () => {
    expect(toPosix(JSON.stringify(aliases))).not.toContain('/dist/')
  })

  it('selects only the office preset and publishes its offline assets below the renderer output', () => {
    expect(fileViewerAssetOptions).toEqual({ preset: 'office', copyAssets: { baseDir: 'file-viewer' }, chunkStrategy: 'none' })
    const target = resolveFileViewerCopyAssetsTarget('build', fileViewerAssetOptions.copyAssets, {
      projectRoot: dirname(fileURLToPath(import.meta.url)),
      outDir: 'out/renderer'
    })
    expect(toPosix(target.targetRoot)).toMatch(/apps\/electron\/out\/renderer\/file-viewer$/)
  })
})

describe('main-process development watch stability', () => {
  const main = (electronViteConfig as any).main
  const preload = (electronViteConfig as any).preload

  it('bundles workspace host packages from source instead of generated dist', () => {
    for (const target of [main, preload]) {
      const targetAliases: AliasEntry[] = target.resolve.alias
      expect(toPosix(targetAliases.find((a) => a.find === '@pipi/pi-backend')!.replacement)).toMatch(/packages\/pi-backend\/src\/index\.ts$/)
      expect(toPosix(targetAliases.find((a) => a.find === '@pipi/host-api')!.replacement)).toMatch(/packages\/host-api\/src\/index\.ts$/)
      expect(toPosix(targetAliases.find((a) => a.find === '@pipiui/server')!.replacement)).toMatch(/apps\/server\/src\/index\.ts$/)
    }
  })

  it('excludes concurrently generated workspace outputs from Rollup watch', () => {
    expect(generatedWatchExcludes).toEqual(expect.arrayContaining([
      '**/dist/**',
      '**/out/**',
      '**/*.tsbuildinfo',
      '**/.cua-driver/**'
    ]))
  })
})

describe('renderer asset names stay packable on macOS', () => {
  it('gives extensionless LICENSE/NOTICE a .txt suffix instead of a trailing dot', () => {
    expect(rendererAssetFileNames({ name: 'LICENSE' })).toBe('assets/[name]-[hash].txt')
    expect(rendererAssetFileNames({ name: 'NOTICE' })).toBe('assets/[name]-[hash].txt')
    expect(rendererAssetFileNames({ name: 'index.css' })).toBe('assets/[name]-[hash][extname]')
  })
})
