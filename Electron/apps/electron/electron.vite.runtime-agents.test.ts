import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const configPath = resolve(dirname(fileURLToPath(import.meta.url)), 'electron.vite.config.ts')

describe('electron-vite runtime-agents bundle', () => {
  it('builds the generated runtime-agents bundle and excludes it from the watcher', () => {
    const source = readFileSync(configPath, 'utf8')
    expect(source).toContain('packages/pi-backend/scripts/bundle-runtime-agents.mjs')
    expect(source).toContain('packages/pi-backend/src/runtime-agents.bundle.mjs')
    expect(source).toContain("'**/runtime-agents.bundle.mjs'")
    expect(source).toContain('ensurePiBackendRuntimeAgentsBundle')
  })
})
