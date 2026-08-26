import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = dirname(fileURLToPath(import.meta.url))
spawnSync(process.execPath, [resolve(here, 'scripts/bundle-runtime-agents.mjs')], { stdio: 'inherit' })

// These integration tests spawn a real fake-pi child per sendPrompt (node
// interpreter startup each time). On a busy machine a single test legitimately
// runs 3-5s; the 5s default timeout turned that into flakes under a parallel
// full-suite run, so give the spawn-heavy suite headroom.
export default defineConfig({
  resolve: {
    alias: {
      '@pipi/host-api': resolve(here, '../host-api/src/index.ts'),
    },
  },
  test: { testTimeout: 15_000 },
})
