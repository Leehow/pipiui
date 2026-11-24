import { defineConfig } from 'vitest/config';

// Runtime extension tests are intentionally excluded from the workspace suite.
export default defineConfig({ test: { include: ['resources/runtime/pi-ext/subagent/test/bash-details.test.ts'] } });
