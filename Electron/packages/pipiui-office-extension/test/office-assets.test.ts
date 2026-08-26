import { describe, expect, it } from 'vitest'
import { fileViewerAssetOptions } from '../app/vite.config'
import {
  fileViewerPptVendorAssetPlugin,
  rewriteFileViewerPptDefaultAssetUrls,
} from '../app/src/file-viewer-ppt-vendor-assets'
import { OFFICE_RENDERER_CSS } from '../app/src/office-styles'

describe('office extension assets and build policy', () => {
  it('keeps office renderers in one graph and copies vendor assets beside the entry', () => {
    expect(fileViewerAssetOptions).toEqual({
      preset: 'office',
      copyAssets: { baseDir: 'file-viewer' },
      chunkStrategy: 'none',
      inject: false,
    })
  })

  it('rewrites PPT defaults onto import.meta.url so the host page is not the asset origin', () => {
    const source = [
      "const DEFAULT_WASM_URL = new URL('./ppt-native.wasm', import.meta.url);",
      'const DEFAULT_FONT_URL = new URL(`./${MANIFEST.fontPack.file}`, import.meta.url);',
      'const DEFAULT_WORKER_URL = new URL(`./${MANIFEST.workerFile}`, import.meta.url);',
    ].join('\n')
    const rewritten = rewriteFileViewerPptDefaultAssetUrls(source)
    expect(rewritten).toContain('file-viewer/vendor/ppt/ppt-native.wasm')
    expect(rewritten).toContain('file-viewer/vendor/ppt/ppt-font-cjk.otf')
    expect(rewritten).toContain('file-viewer/vendor/ppt/worker.mjs')
    expect(rewritten).toContain('import.meta.url')
    expect(rewritten).not.toContain('document.baseURI')
    expect(rewritten).not.toContain("new URL('./ppt-native.wasm', import.meta.url)")
  })

  it('does not rewrite unrelated modules and refuses a partial match', () => {
    expect(rewriteFileViewerPptDefaultAssetUrls('export const x = 1')).toBeNull()
    expect(() => rewriteFileViewerPptDefaultAssetUrls(
      "const DEFAULT_WASM_URL = new URL('./ppt-native.wasm', import.meta.url);",
    )).toThrow(/partial DEFAULT_\*_URL match/)
  })

  it('registers the vendor rewrite plugin before file-viewer renderers', () => {
    const plugin = fileViewerPptVendorAssetPlugin()
    expect(plugin.name).toBe('file-viewer-ppt-vendor-assets')
    expect(plugin.enforce).toBe('pre')
  })

  it('keeps the FileViewer toolbar inside the panel width', () => {
    expect(OFFICE_RENDERER_CSS).toMatch(/\.document-file-viewer::part\(toolbar\)\{[^}]*max-width:100%/)
    expect(OFFICE_RENDERER_CSS).toMatch(/\.document-file-viewer::part\(toolbar\)\{[^}]*flex-wrap:wrap/)
    expect(OFFICE_RENDERER_CSS).toMatch(/\.document-file-viewer::part\(input\)\{[^}]*max-width:100%/)
  })
})
