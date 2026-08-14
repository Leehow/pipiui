import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileViewerRenderers, type FileViewerRenderersPluginOptions } from '@file-viewer/vite-plugin'

// Workspace packages must be bundled into the main/preload output so the
// packaged app.asar never resolves @pipi/* through node_modules at runtime.
const workspacePkgs = ['@pipi/pi-backend', '@pipi/host-api', '@pipiui/ui']

// This file lives at apps/electron/electron.vite.config.ts.
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const uiPackageRoot = resolve(workspaceRoot, 'packages/ui')
const piBackendSourceEntry = resolve(workspaceRoot, 'packages/pi-backend/src/index.ts')
const hostApiSourceEntry = resolve(workspaceRoot, 'packages/host-api/src/index.ts')
// Resolve @pipiui/ui straight to the UI package source (not its prebuilt
// dist): electron-vite's dev watcher then tracks packages/ui/src edits for
// HMR (component + CSS reload) and the renderer never depends on a
// packages/ui/dist that may be mid-rebuild (files temporarily missing
// trigger Vite pre-transform errors). Works for dev and for `electron-vite
// build` alike, so the production bundle is built from the same source.
const uiSourceEntry = resolve(uiPackageRoot, 'src/index.ts')
const uiSourceAppCss = resolve(uiPackageRoot, 'src/app.css')
export const fileViewerAssetOptions = {
  preset: 'office',
  copyAssets: { baseDir: 'file-viewer' },
  chunkStrategy: 'none'
} satisfies FileViewerRenderersPluginOptions

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
  { find: '@pipi/host-api', replacement: hostApiSourceEntry }
]

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePkgs })],
    resolve: { alias: hostSourceAliases },
    build: { watch: devWatch }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePkgs })],
    resolve: { alias: hostSourceAliases },
    build: { watch: devWatch }
  },
  renderer: {
    plugins: [fileViewerRenderers(fileViewerAssetOptions), react()],
    resolve: {
      // String aliases are prefix-matched, so the more specific style.css
      // subpath must be listed before the bare package alias. Importing
      // src/index.ts pulls in App.tsx's own `./app.css`/`./subagent.css`
      // imports, so the stylesheet arrives from source exactly once (Vite
      // dedupes the identical resolved app.css module).
      alias: [
        { find: '@pipiui/ui/style.css', replacement: uiSourceAppCss },
        { find: '@pipiui/ui', replacement: uiSourceEntry }
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
