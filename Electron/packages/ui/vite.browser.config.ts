import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileViewerRenderers } from '@file-viewer/vite-plugin'

export default defineConfig({
  plugins: [fileViewerRenderers({ preset: 'office', copyAssets: { baseDir: 'file-viewer' } }), react()],
  build: {
    outDir: 'dist/browser',
    emptyOutDir: false
  }
})
