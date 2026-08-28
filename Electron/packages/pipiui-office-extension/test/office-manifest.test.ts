import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateExtensionManifest } from '../../pi-backend/src/extension-manifest.js'
import { OFFICE_RENDERER_ID, OFFICE_RENDERER_PRIORITY } from '../app/src/office-format-policy'
import { DIRECT_OFFICECLI_TOOL } from '../agent/tool-contract.js'
import { OFFICECLI_PROVENANCE } from '../agent/provenance.js'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(pkgRoot, 'pipiui-extension.json')
const runtimeRoot = join(pkgRoot, '../../resources/runtime/extensions/office-extension')

describe('office-extension manifest contract', () => {
  it('is valid and registers word/spreadsheet/presentation renderers', () => {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const result = validateExtensionManifest(raw)
    expect(result.ok, result.ok ? '' : (result as { errors: string[] }).errors.join('; ')).toBe(true)
    if (!result.ok) return
    expect(result.manifest.id).toBe('office-extension')
    expect(result.manifest.version).toBe('0.1.0')
    expect(result.manifest.capabilities).toEqual([])
    expect(result.manifest.agentExtension).toBe('agent/dist/index.js')
    expect(result.manifest.hostEntry).toBe('agent/dist/host.js')
    const renderers = result.manifest.ui?.documentRenderers ?? []
    expect(renderers).toHaveLength(1)
    expect(renderers[0]?.id).toBe(OFFICE_RENDERER_ID)
    expect(renderers[0]?.entry).toBe('app/dist/office-renderer.js')
    expect(renderers[0]?.priority).toBe(OFFICE_RENDERER_PRIORITY)
    expect(renderers[0]?.kinds).toEqual(['word', 'spreadsheet', 'presentation'])
    expect(renderers[0]?.extensions).toEqual(expect.arrayContaining(['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']))
    expect(renderers[0]?.extensions).not.toContain('.pdf')
    expect(renderers[0]?.entry.includes('..')).toBe(false)
  })

  it('keeps the app renderer path-free and registers only the direct tool', () => {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      agent?: { extension?: string }
      host?: { entry?: string }
      app?: { ui?: { documentRenderers?: unknown[]; toolRenderers?: unknown[]; panels?: unknown[] } }
    }
    expect(raw.agent?.extension).toBe('agent/dist/index.js')
    expect(raw.host?.entry).toBe('agent/dist/host.js')
    expect(raw.app?.ui?.toolRenderers ?? []).toEqual([])
    expect(raw.app?.ui?.panels ?? []).toEqual([])
    const toolContract = readFileSync(join(pkgRoot, 'agent/tool-contract.ts'), 'utf8')
    const agent = readFileSync(join(pkgRoot, 'agent/index.ts'), 'utf8')
    expect(toolContract).toContain(`"${DIRECT_OFFICECLI_TOOL}"`)
    expect(toolContract).not.toContain('MCP_TOOL')
    // Registers the direct name only; no other Office tool name exists.
    expect(agent).toContain('name: DIRECT_OFFICECLI_TOOL')
    expect(JSON.stringify(raw.app?.ui?.documentRenderers)).not.toMatch(/ipc|electron|node:fs/i)
  })

  it('keeps the runtime mirror generated and in sync', () => {
    const runtimeManifest = join(runtimeRoot, 'pipiui-extension.json')
    expect(existsSync(runtimeManifest)).toBe(true)
    expect(JSON.parse(readFileSync(runtimeManifest, 'utf8'))).toEqual(JSON.parse(readFileSync(manifestPath, 'utf8')))
  })

  it('syncs built agent/host, sdk copy, NOTICE, LICENSE, and bin contract', () => {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as { agent: { extension: string }; host: { entry: string } }
    expect(existsSync(join(pkgRoot, 'agent/dist'))).toBe(true)
    expect(existsSync(join(pkgRoot, raw.agent.extension))).toBe(true)
    expect(existsSync(join(pkgRoot, raw.host.entry))).toBe(true)
    expect(existsSync(join(pkgRoot, 'agent/dist/officecli-sdk.cjs'))).toBe(true)
    expect(existsSync(join(runtimeRoot, raw.agent.extension))).toBe(true)
    expect(existsSync(join(runtimeRoot, raw.host.entry))).toBe(true)
    expect(existsSync(join(runtimeRoot, 'NOTICE'))).toBe(true)
    expect(existsSync(join(runtimeRoot, 'LICENSE-OFFICECLI'))).toBe(true)
    expect(existsSync(join(runtimeRoot, 'bin/README.md'))).toBe(true)
    expect(OFFICECLI_PROVENANCE.binaryStatus).toBe('shipped-via-target-cache')
    expect(OFFICECLI_PROVENANCE.cliVersion).toBe('1.0.144')
    expect(OFFICECLI_PROVENANCE.binaryReceipt).toBe('receipt.json')
    const assets = JSON.parse(readFileSync(join(pkgRoot, '../../officecli-assets.json'), 'utf8')) as { version: string }
    expect(assets.version).toBe(OFFICECLI_PROVENANCE.cliVersion)
    expect(existsSync(join(pkgRoot, 'bin/README.md'))).toBe(true)
  })

  it('declares exactly one native OfficeCLI update component pinned to the assets metadata', () => {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      updateComponents?: Array<{
        id: string
        name: string
        version: string
        source: { type: string; owner?: string; repo?: string }
        upstream?: string
        license?: string
      }>
    }
    const components = raw.updateComponents ?? []
    expect(components).toHaveLength(1)

    // officecli-assets.json is the authoritative version/repository/license pin.
    const assets = JSON.parse(readFileSync(join(pkgRoot, '../../officecli-assets.json'), 'utf8')) as {
      version: string
      repository: string
      license: string
    }
    const upstreamUrl = new URL(assets.repository)
    expect(upstreamUrl.protocol).toBe('https:')
    expect(upstreamUrl.hostname).toBe('github.com')
    const [, owner, repo] = upstreamUrl.pathname.split('/')

    const component = components[0]
    expect(component?.id).toBe('officecli')
    expect(component?.name).toBe('OfficeCLI')
    expect(component?.version).toBe(assets.version)
    expect(component?.source).toEqual({ type: 'githubReleases', owner, repo })
    expect(component?.upstream).toBe(assets.repository)
    expect(component?.license).toBe(assets.license)

    // The generic update-component schema accepts the declaration as-is: no
    // update-center special case for the native CLI.
    const validated = validateExtensionManifest(raw)
    expect(validated.ok, validated.ok ? '' : (validated as { errors: string[] }).errors.join('; ')).toBe(true)
    if (!validated.ok) return
    expect(validated.manifest.updateComponents).toEqual([
      {
        id: 'officecli',
        name: 'OfficeCLI',
        version: assets.version,
        source: { type: 'githubReleases', owner, repo },
        upstream: assets.repository,
        license: assets.license,
      },
    ])

    // The generated runtime manifest carries the identical declaration.
    const runtimeRaw = JSON.parse(readFileSync(join(runtimeRoot, 'pipiui-extension.json'), 'utf8')) as typeof raw
    expect(runtimeRaw.updateComponents).toEqual(raw.updateComponents)
  })
})
