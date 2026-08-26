import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileViewerRenderers, type FileViewerRenderersPluginOptions } from '@file-viewer/vite-plugin'

// PDF-only after T4: Office preset/assets live in pipiui-office-extension.
// chunkStrategy:'none' still avoids renderer-chunk TDZ if more formats return.
export const fileViewerAssetOptions = {
  formats: ['pdf'],
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
