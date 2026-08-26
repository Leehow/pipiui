import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = dirname(fileURLToPath(import.meta.url))
spawnSync(process.execPath, [resolve(here, 'packages/pi-backend/scripts/bundle-runtime-agents.mjs')], {
  stdio: 'inherit',
})

// The pi-backend integration tests spawn a real fake-pi child (a node process)
// per sendPrompt; on a busy machine a single test legitimately runs 3-5s. The
// 5s default timeout turned that into mass flakes under a parallel full-suite
// run, so every suite gets headroom here. `packages/pi-backend/vitest.config.ts`
// mirrors this for runs started inside that package.
export default defineConfig({
  resolve: {
    alias: {
      // Subpath first: string aliases are prefix-matched, so the bare
      // '@pipi/host-api' entry below would otherwise capture it.
      '@pipi/host-api/browser': resolve(here, 'packages/host-api/src/browser.ts'),
      '@pipi/host-api': resolve(here, 'packages/host-api/src/index.ts'),
      '@pipi/pi-backend': resolve(here, 'packages/pi-backend/src/index.ts'),
      '@pipiui/extension-api': resolve(here, 'packages/extension-api/src/index.ts'),
    },
  },
  test: {
    // `.pi/worktrees` / `.worktrees` hold live in-app agent worktrees: their
    // copied test files must never run from this workspace (positional file
    // filters match them even though the default include glob skips dot-dirs).
    exclude: ['**/node_modules/**', '**/dist/**', 'resources/runtime/**', '**/.pi/**', '**/.worktrees/**'],
    testTimeout: 15_000,
  },
})
