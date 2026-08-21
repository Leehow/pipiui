import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileViewerRenderers, type FileViewerRenderersPluginOptions } from '@file-viewer/vite-plugin'

// Default chunkStrategy:'renderer' splits word/ofd into circular chunks
// that TDZ-crash the web bundle before React mounts. Match Electron.
export const fileViewerAssetOptions = {
  preset: 'office',
  copyAssets: { baseDir: 'file-viewer' },
  chunkStrategy: 'none'
} satisfies FileViewerRenderersPluginOptions

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [fileViewerRenderers(fileViewerAssetOptions), react()],
  resolve: {
    alias: {
      '@pipiui/extension-api': resolve(here, '../extension-api/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist/browser',
    emptyOutDir: true,
    target: ['es2017', 'chrome64', 'safari11', 'firefox67']
  }
})
