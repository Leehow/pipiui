import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@pipiui/extension-api': resolve(here, '../extension-api/src/index.ts'),
    },
  },
  test: { environment: 'jsdom', globals: true },
})
