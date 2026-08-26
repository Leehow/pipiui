import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Subpath first: string aliases are prefix-matched, so the bare
      // '@pipi/host-api' entry below would otherwise capture it.
      '@pipi/host-api/browser': resolve(here, '../host-api/src/browser.ts'),
      '@pipi/host-api': resolve(here, '../host-api/src/index.ts'),
      '@pipiui/extension-api': resolve(here, '../extension-api/src/index.ts'),
    },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'] },
})
