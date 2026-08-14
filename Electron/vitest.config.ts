import { defineConfig } from 'vitest/config'

// The pi-backend integration tests spawn a real fake-pi child (a node process)
// per sendPrompt; on a busy machine a single test legitimately runs 3-5s. The
// 5s default timeout turned that into mass flakes under a parallel full-suite
// run, so every suite gets headroom here. `packages/pi-backend/vitest.config.ts`
// mirrors this for runs started inside that package.
export default defineConfig({
  test: {
    // `.pi/worktrees` / `.worktrees` hold live in-app agent worktrees: their
    // copied test files must never run from this workspace (positional file
    // filters match them even though the default include glob skips dot-dirs).
    exclude: ['**/node_modules/**', '**/dist/**', 'resources/runtime/**', '**/.pi/**', '**/.worktrees/**'],
    testTimeout: 15_000,
  },
})
