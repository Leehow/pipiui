import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileViewerRenderers, type FileViewerRenderersPluginOptions } from '@file-viewer/vite-plugin'
import { fileViewerPptVendorAssetPlugin } from './src/file-viewer-ppt-vendor-assets'

const here = dirname(fileURLToPath(import.meta.url))

export const fileViewerAssetOptions = {
  preset: 'office',
  copyAssets: { baseDir: 'file-viewer' },
  chunkStrategy: 'none',
  inject: false,
} satisfies FileViewerRenderersPluginOptions

export default defineConfig({
  root: here,
  plugins: [
    fileViewerPptVendorAssetPlugin('file-viewer'),
    fileViewerRenderers(fileViewerAssetOptions),
    react(),
  ],
  optimizeDeps: { exclude: ['@file-viewer/ppt'] },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    lib: {
      entry: resolve(here, 'src/office-renderer.tsx'),
      formats: ['es'],
      fileName: () => 'office-renderer.js',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
  },
})
