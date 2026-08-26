import { configure } from '@testing-library/react'

/**
 * Test-infrastructure only: raise @testing-library's default async timeout
 * (waitFor/findBy*) from 1s to 5s for this package's suites.
 *
 * App.test.tsx runs 200+ jsdom tests that fan out real promise chains (host
 * mocks, streaming projections, session lifecycle). Under parallel vitest
 * workers these chains are occasionally CPU-starved past the 1s default and a
 * waitFor that would converge at ~1.1s reports a false failure — a different
 * test each run, always on an unrelated wait. 5s keeps every assertion intact
 * (a wait that never converges still fails) and only widens the load tolerance.
 */
configure({ asyncUtilTimeout: 5_000 })
