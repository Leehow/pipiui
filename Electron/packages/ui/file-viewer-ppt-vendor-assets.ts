import type { Plugin } from 'vite'

const PPT_DEFAULT_WASM_URL =
  "const DEFAULT_WASM_URL = new URL('./ppt-native.wasm', import.meta.url);"
const PPT_DEFAULT_FONT_URL =
  'const DEFAULT_FONT_URL = new URL(`./${MANIFEST.fontPack.file}`, import.meta.url);'
const PPT_DEFAULT_WORKER_URL =
  'const DEFAULT_WORKER_URL = new URL(`./${MANIFEST.workerFile}`, import.meta.url);'

/**
 * @file-viewer/vite-plugin copyAssets already publishes @file-viewer/ppt under
 * `<baseDir>/vendor/ppt/`. The package still uses `new URL(..., import.meta.url)`
 * defaults, and Vite turns the dynamic font/worker paths into a directory glob
 * that emits a second hashed copy (font ~16MB + WASM ~1.5MB). Rewrite those
 * defaults onto the vendor URLs so Rollup never sees the asset pattern.
 */
export function rewriteFileViewerPptDefaultAssetUrls(
  code: string,
  assetBaseDir = 'file-viewer'
): string | null {
  const matches = [PPT_DEFAULT_WASM_URL, PPT_DEFAULT_FONT_URL, PPT_DEFAULT_WORKER_URL]
    .filter((needle) => code.includes(needle))
  if (matches.length === 0) return null
  if (matches.length !== 3) {
    throw new Error(
      `[file-viewer-ppt-vendor-assets] partial DEFAULT_*_URL match (${matches.length}/3); refuse to rewrite`
    )
  }
  const vendorRoot = `${assetBaseDir.replace(/\\/g, '/').replace(/\/+$/, '')}/vendor/ppt`
  const pageBase =
    "(globalThis.document && globalThis.document.baseURI) || (globalThis.location && globalThis.location.href) || 'http://127.0.0.1/'"
  return code
    .replace(
      PPT_DEFAULT_WASM_URL,
      `const DEFAULT_WASM_URL = new URL(${JSON.stringify(`${vendorRoot}/ppt-native.wasm`)}, ${pageBase});`
    )
    .replace(
      PPT_DEFAULT_FONT_URL,
      `const DEFAULT_FONT_URL = new URL(${JSON.stringify(`${vendorRoot}/ppt-font-cjk.otf`)}, ${pageBase});`
    )
    .replace(
      PPT_DEFAULT_WORKER_URL,
      `const DEFAULT_WORKER_URL = new URL(${JSON.stringify(`${vendorRoot}/worker.mjs`)}, ${pageBase});`
    )
}

export function fileViewerPptVendorAssetPlugin(assetBaseDir = 'file-viewer'): Plugin {
  return {
    name: 'file-viewer-ppt-vendor-assets',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0].replace(/\\/g, '/')
      if (!file.endsWith('/@file-viewer/ppt/index.mjs')) return null
      const next = rewriteFileViewerPptDefaultAssetUrls(code, assetBaseDir)
      return next == null ? null : { code: next, map: null }
    }
  }
}
