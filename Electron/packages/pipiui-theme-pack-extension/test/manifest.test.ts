// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const THEME_TOKEN_KEYS = ['--bg', '--surface', '--surface-raised', '--surface-hover', '--surface-input', '--border', '--border-strong', '--text', '--text-strong', '--muted', '--subtle', '--selection', '--accent', '--accent-soft', '--danger', '--warning', '--success']

function readSyncedManifest() {
  // pretest 已把包同步进运行时树；这里校验的就是发布出去的那份副本。
  const runtimePath = join(__dirname, '..', '..', '..', 'resources', 'runtime', 'extensions', 'pipiui-theme-pack', 'pipiui-extension.json')
  return JSON.parse(readFileSync(runtimePath, 'utf8'))
}

describe('pipiui-theme-pack synced manifest', () => {
  it('declares exactly forest/neon/paper with full 17-token maps and valid schemes', () => {
    const manifest = readSyncedManifest()
    expect(manifest.id).toBe('pipiui-theme-pack')
    const themes = manifest.app?.ui?.themes
    expect(Array.isArray(themes)).toBe(true)
    expect(themes.map((t: { id: string }) => t.id)).toEqual(['forest', 'neon', 'paper'])
    for (const theme of themes) {
      expect(theme.id).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(['dark', 'light']).toContain(theme.scheme)
      expect(typeof theme.name).toBe('string')
      expect(typeof theme.description).toBe('string')
      expect(Object.keys(theme.tokens).sort()).toEqual([...THEME_TOKEN_KEYS].sort())
      for (const value of Object.values(theme.tokens)) expect(typeof value).toBe('string')
    }
    expect(themes.find((t: { id: string }) => t.id === 'paper').scheme).toBe('light')
  })
})
