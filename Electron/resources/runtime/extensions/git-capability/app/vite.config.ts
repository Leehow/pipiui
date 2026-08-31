import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: here,
  esbuild: {
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
  },
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    lib: {
      entry: resolve(here, 'branch-menu.tsx'),
      formats: ['es'],
      fileName: () => 'branch-menu.js',
    },
  },
})
