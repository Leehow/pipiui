import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileViewerRenderers, type FileViewerRenderersPluginOptions } from '@file-viewer/vite-plugin'
import type { Plugin } from 'vite'

// Workspace packages must be bundled into the main/preload output so the
// packaged app.asar never resolves @pipi/* through node_modules at runtime.
const workspacePkgs = ['@pipi/pi-backend', '@pipi/host-api', '@pipiui/ui', '@pipiui/server']

// This file lives at apps/electron/electron.vite.config.ts.
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const uiPackageRoot = resolve(workspaceRoot, 'packages/ui')
const piBackendSourceEntry = resolve(workspaceRoot, 'packages/pi-backend/src/index.ts')
const hostApiSourceEntry = resolve(workspaceRoot, 'packages/host-api/src/index.ts')
const serverSourceEntry = resolve(workspaceRoot, 'apps/server/src/index.ts')
// Resolve @pipiui/ui straight to the UI package source (not its prebuilt
// dist): electron-vite's dev watcher then tracks packages/ui/src edits for
// HMR (component + CSS reload) and the renderer never depends on a
// packages/ui/dist that may be mid-rebuild (files temporarily missing
// trigger Vite pre-transform errors). Works for dev and for `electron-vite
// build` alike, so the production bundle is built from the same source.
const uiSourceEntry = resolve(uiPackageRoot, 'src/index.ts')
const uiSourceAppCss = resolve(uiPackageRoot, 'src/app.css')
const extensionApiSourceEntry = resolve(workspaceRoot, 'packages/extension-api/src/index.ts')
// Extensionless static files (file-viewer LICENSE/NOTICE) become
// `NAME-<hash>.` under Vite's default `[extname]`. electron-builder on
// macOS cannot open a trailing-dot path (ENOENT).
export function rendererAssetFileNames(assetInfo: { name?: string }): string {
  const name = assetInfo.name ?? 'asset'
  if (!/\.[A-Za-z0-9]+$/.test(name)) return 'assets/[name]-[hash].txt'
  return 'assets/[name]-[hash][extname]'
}

export const fileViewerAssetOptions = {
  preset: 'office',
  copyAssets: { baseDir: 'file-viewer' },
  chunkStrategy: 'none'
} satisfies FileViewerRenderersPluginOptions

const fileViewerCopyAssetsBaseDir =
  typeof fileViewerAssetOptions.copyAssets === 'object'
    ? fileViewerAssetOptions.copyAssets.baseDir || 'file-viewer'
    : 'file-viewer'

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
  assetBaseDir = fileViewerCopyAssetsBaseDir
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

export function fileViewerPptVendorAssetPlugin(): Plugin {
  return {
    name: 'file-viewer-ppt-vendor-assets',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0].replace(/\\/g, '/')
      if (!file.endsWith('/@file-viewer/ppt/index.mjs')) return null
      const next = rewriteFileViewerPptDefaultAssetUrls(code)
      return next == null ? null : { code: next, map: null }
    }
  }
}

// A parallel workspace build/package rewrites these generated paths. Rollup's
// main-process watcher otherwise treats those writes as source edits and
// repeatedly restarts Electron, interrupting live CUA sessions.
export const generatedWatchExcludes = [
  '**/dist/**',
  '**/out/**',
  '**/build/**',
  '**/*.tsbuildinfo',
  '**/.cua-driver/**',
  '**/.cua-driver-cache/**'
]
const devWatch = process.env.NODE_ENV_ELECTRON_VITE === 'development'
  ? { exclude: generatedWatchExcludes }
  : undefined

const hostSourceAliases = [
  { find: '@pipi/pi-backend', replacement: piBackendSourceEntry },
  { find: '@pipi/host-api', replacement: hostApiSourceEntry },
  { find: '@pipiui/server', replacement: serverSourceEntry }
]

export default defineConfig({
  main: {
    // Vite stubs optional `require('bufferutil')` / `utf-8-validate` as `{}`.
    // Force ws onto its JS fallbacks so unmask/mask stay functions.
    define: {
      'process.env.WS_NO_BUFFER_UTIL': JSON.stringify('1'),
      'process.env.WS_NO_UTF_8_VALIDATE': JSON.stringify('1')
    },
    plugins: [externalizeDepsPlugin({ exclude: [...workspacePkgs, 'express', 'ws'] })],
    resolve: { alias: hostSourceAliases },
    build: { watch: devWatch }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePkgs })],
    resolve: { alias: hostSourceAliases },
    build: { watch: devWatch }
  },
  renderer: {
    plugins: [fileViewerPptVendorAssetPlugin(), fileViewerRenderers(fileViewerAssetOptions), react()],
    optimizeDeps: { exclude: ['@file-viewer/ppt'] },
    build: {
      rollupOptions: {
        output: { assetFileNames: rendererAssetFileNames }
      }
    },
    resolve: {
      // String aliases are prefix-matched, so the more specific style.css
      // subpath must be listed before the bare package alias. Importing
      // src/index.ts pulls in App.tsx's own `./app.css`/`./subagent.css`
      // imports, so the stylesheet arrives from source exactly once (Vite
      // dedupes the identical resolved app.css module).
      alias: [
        { find: '@pipiui/ui/style.css', replacement: uiSourceAppCss },
        { find: '@pipiui/ui', replacement: uiSourceEntry },
        { find: '@pipiui/extension-api', replacement: extensionApiSourceEntry }
      ],
      // The UI source and the renderer share the hoisted workspace React;
      // dedupe guarantees a single React instance even if a nested
      // node_modules copy ever sneaks in (avoids double-React "invalid hook
      // call" failures in the monorepo).
      dedupe: ['react', 'react-dom']
      // server.fs: intentionally not set — Vite's default
      // searchForWorkspaceRoot() already resolves to the Electron workspace
      // root, which covers both the renderer root and packages/ui/src. An
      // explicit allow list would REPLACE that default and 403 the entry.
    }
  }
})
