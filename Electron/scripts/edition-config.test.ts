import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import packageJSON from '../apps/electron/package.json'
import codingProfile from '../resources/runtime/profiles/coding/pipiui-profile.json'
import baseProfile from '../resources/runtime/profiles/base/pipiui-profile.json'
import { OPTIONAL_EXTENSION_PACKS, baseEditionConfig, editionBuilderArgs, resolveEdition } from './edition-config.mjs'

describe('base edition config', () => {
  const build = packageJSON.build as Record<string, any>

  it('defaults to the full edition so an unset variable never slims a release', () => {
    expect(resolveEdition({})).toBe('full')
    expect(resolveEdition({ PIPIUI_EDITION: 'BASE' })).toBe('base')
    expect(() => resolveEdition({ PIPIUI_EDITION: 'coding' })).toThrow(/Unknown PIPIUI_EDITION/)
  })

  it('emits no builder arguments for the full edition', () => {
    expect(editionBuilderArgs(resolve(import.meta.dirname, '..'), {})).toEqual([])
  })

  // The packs are only ever `recommended`. If one became `required`, dropping it
  // would break profile activation and the base edition would need rethinking.
  it('only drops packs that no profile requires', () => {
    for (const profile of [baseProfile, codingProfile]) {
      const required = profile.extensions.required.map(entry => entry.id)
      for (const pack of OPTIONAL_EXTENSION_PACKS) expect(required).not.toContain(pack)
    }
  })

  it('drops every extraResources entry that carries an optional pack', () => {
    const config = baseEditionConfig(build)
    const destinations = config.extraResources.map((entry: any) => entry.to)
    for (const pack of OPTIONAL_EXTENSION_PACKS) {
      expect(build.extraResources.some((entry: any) => entry.to?.startsWith(`pipiui-runtime/extensions/${pack}`))).toBe(true)
      expect(destinations.some((to: string) => to?.startsWith(`pipiui-runtime/extensions/${pack}`))).toBe(false)
    }
  })

  it('drops the OfficeCLI slice that would otherwise land without its extension', () => {
    const config = baseEditionConfig(build)
    expect(config.extraResources.some((entry: any) => entry.from?.includes('.officecli/'))).toBe(false)
  })

  it('negates the packs in the bulk runtime copy that would otherwise sweep them in', () => {
    const runtime = baseEditionConfig(build).extraResources.find((entry: any) => entry.to === 'pipiui-runtime')
    for (const pack of OPTIONAL_EXTENSION_PACKS) expect(runtime.filter).toContain(`!extensions/${pack}/**`)
    // The invariants the full config already carries must survive the derivation.
    expect(runtime.filter).toContain('!**/node_modules/**')
    expect(runtime.filter).toContain('!**/target/**')
  })

  it('keeps the embedded runtime and every other resource the full edition ships', () => {
    const config = baseEditionConfig(build)
    for (const platform of ['mac', 'win', 'linux']) {
      expect(config[platform].extraResources).toEqual(build[platform].extraResources)
    }
    expect(config.extraResources).toContainEqual(expect.objectContaining({ to: 'browser-ui' }))
    expect(config.extraResources).toContainEqual(expect.objectContaining({ to: 'cua-driver' }))
    expect(config.productName).toBe(build.productName)
    expect(config.appId).toBe(build.appId)
    expect(config.files).toEqual(build.files)
  })

  it('leaves the source config untouched', () => {
    const before = JSON.stringify(build)
    baseEditionConfig(build)
    expect(JSON.stringify(build)).toBe(before)
  })

  it('is reachable from the shared target packager, so win and linux get it too', () => {
    const packager = readFileSync(resolve(import.meta.dirname, './package-electron-target.mjs'), 'utf8')
    expect(packager).toMatch(/editionBuilderArgs\(electronRoot, releaseEnv\)/)
  })
})
