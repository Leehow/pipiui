// @vitest-environment node
// After T4 the browser UI build is PDF-only. Office preset/PPT vendor assets
// live in pipiui-office-extension. chunkStrategy:'none' stays so a future
// extra format cannot reintroduce word/ofd circular chunks.
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveFileViewerCopyAssetsTarget } from '@file-viewer/vite-plugin'
import browserConfig, { fileViewerAssetOptions } from './vite.browser.config'

describe('browser file-viewer build is PDF-only after T4', () => {
  it('does not assemble the office preset in the core browser bundle', () => {
    expect(fileViewerAssetOptions).toEqual({
      formats: ['pdf'],
      copyAssets: { baseDir: 'file-viewer' },
      chunkStrategy: 'none'
    })
  })

  it('empties dist/browser so a previous word/ofd circular chunk cannot keep crashing the page', () => {
    expect(browserConfig.build?.emptyOutDir).toBe(true)
  })

  it('targets conservative engines so older mobile WebViews can parse the bundle', () => {
    expect(browserConfig.build?.target).toEqual(['es2017', 'chrome64', 'safari11', 'firefox67'])
  })

  it('still publishes offline PDF viewer assets below dist/browser/file-viewer', () => {
    const target = resolveFileViewerCopyAssetsTarget('build', fileViewerAssetOptions.copyAssets, {
      projectRoot: dirname(fileURLToPath(import.meta.url)),
      outDir: 'dist/browser'
    })
    expect(target.targetRoot.replace(/\\/g, '/')).toMatch(/packages\/ui\/dist\/browser\/file-viewer$/)
  })

  it('does not register the Office PPT vendor rewrite plugin', () => {
    const names = (browserConfig.plugins ?? []).map((entry) => {
      const plugin = Array.isArray(entry) ? entry[0] : entry
      return plugin && typeof plugin === 'object' && 'name' in plugin ? plugin.name : undefined
    })
    expect(names).not.toContain('file-viewer-ppt-vendor-assets')
  })
})
