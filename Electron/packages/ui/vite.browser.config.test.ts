// @vitest-environment node
// Regression: the web/browser Vite build must not split File Viewer
// renderers into per-package chunks. Default chunkStrategy:'renderer'
// puts @file-viewer/renderer-word and @file-viewer/renderer-ofd in
// separate chunks that circular-import; the word chunk then evaluates
// a shared binding at top level and throws
//   ReferenceError: Cannot access 'ql' before initialization
// which aborts the whole bundle before React mounts (#root stays empty).
// Electron already pins chunkStrategy:'none' for the same reason.
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveFileViewerCopyAssetsTarget } from '@file-viewer/vite-plugin'
import browserConfig, { fileViewerAssetOptions } from './vite.browser.config'

describe('browser file-viewer build avoids renderer-chunk TDZ', () => {
  it('keeps office renderers in one graph instead of word/ofd circular chunks', () => {
    expect(fileViewerAssetOptions).toEqual({
      preset: 'office',
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

  it('still publishes offline viewer assets below dist/browser/file-viewer', () => {
    const target = resolveFileViewerCopyAssetsTarget('build', fileViewerAssetOptions.copyAssets, {
      projectRoot: dirname(fileURLToPath(import.meta.url)),
      outDir: 'dist/browser'
    })
    expect(target.targetRoot.replace(/\\/g, '/')).toMatch(/packages\/ui\/dist\/browser\/file-viewer$/)
  })
})
