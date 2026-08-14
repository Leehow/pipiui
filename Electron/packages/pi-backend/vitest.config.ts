import { defineConfig } from 'vitest/config'

// These integration tests spawn a real fake-pi child per sendPrompt (node
// interpreter startup each time). On a busy machine a single test legitimately
// runs 3-5s; the 5s default timeout turned that into flakes under a parallel
// full-suite run, so give the spawn-heavy suite headroom.
export default defineConfig({ test: { testTimeout: 15_000 } })
