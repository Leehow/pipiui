import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPiHostBackend } from '../src/index'
import type { AuthRuntimeLike } from '../src/provider-auth'

function authRuntime(models: Array<{ provider: string; id: string; name?: string; reasoning?: boolean }>): AuthRuntimeLike {
  return {
    getProviders: async () => [],
    getAvailable: async () => models,
    login: async () => undefined,
    logout: async () => undefined,
  }
}

const RETIRED_SUBAGENT_MODEL_KEYS = [
  'computer-use',
  'computer-use-leader',
  'computer-verifier',
  'computer-terminal',
  'operator',
] as const

describe('Subagent role model settings', () => {
  let root = ''
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) })
  it('does not advertise retired computer-use roles and ignores their model keys', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-computer-models-'))
    const backend = createPiHostBackend({ agentDir: join(root, 'agent'), env: { ...process.env, HOME: root }, authRuntime: authRuntime([{ provider: 'xai', id: 'grok-4.5' }]) })
    const roles = await backend.handle('listAgentDefinitions', []) as Array<{ name: string; description?: string; canonicalRole?: string }>
    const names = roles.map(role => role.name)
    expect(names).toEqual(expect.arrayContaining(['explore', 'general-purpose', 'reviewer', 'secretary']))
    for (const name of RETIRED_SUBAGENT_MODEL_KEYS) expect(names).not.toContain(name)
    expect(roles.every(role => typeof role.name === 'string' && typeof role.description === 'string')).toBe(true)
    expect(roles.find(role => role.canonicalRole === 'computer')).toBeUndefined()
    await backend.handle('setSubagentModel', ['computer-use', [{ model: 'xai/grok-4.5', thinking: 'high' }]])
    expect(await backend.handle('getSubagentModels', [])).toEqual({})
    const runtime = JSON.parse(await readFile(join(root, 'agent/pipiui-subagent-models-runtime.json'), 'utf8'))
    expect(runtime['computer-use']).toBeUndefined()
    await backend.handle('setSubagentModel', ['explore', [{ model: 'xai/grok-4.5', thinking: 'high' }]])
    expect(await backend.handle('getSubagentModels', [])).toMatchObject({ explore: [{ model: 'xai/grok-4.5', thinking: 'high' }] })
  })
  it('drops retired persisted keys on read and rematerializes live role settings', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-computer-models-'))
    const agentDir = join(root, 'agent')
    await mkdir(agentDir, { recursive: true })
    await writeFile(join(agentDir, 'pipiui-settings.json'), JSON.stringify({
      subagentModels: {
        explore: [{ model: 'xai/grok-4.5', thinking: 'high' }],
        operator: [{ model: 'xai/grok-4.5', thinking: 'high' }],
        'computer-use': [{ model: 'xai/grok-4.5', thinking: 'high' }],
        'computer-use-leader': [{ model: 'openai-codex/gpt-5.6-terra' }],
        'computer-verifier': [{ model: 'openai-codex/gpt-5.6-terra' }],
        'computer-terminal': [{ model: 'openai-codex/gpt-5.6-terra' }],
      },
    }))
    const backend = createPiHostBackend({ agentDir, env: { ...process.env, HOME: root }, authRuntime: authRuntime([{ provider: 'xai', id: 'grok-4.5' }]) })
    expect(await backend.handle('getSubagentModels', [])).toEqual({
      explore: [{ model: 'xai/grok-4.5', thinking: 'high' }],
    })
    const settings = JSON.parse(await readFile(join(agentDir, 'pipiui-settings.json'), 'utf8'))
    expect(settings.subagentModels).toEqual({ explore: [{ model: 'xai/grok-4.5', thinking: 'high' }] })
    for (const name of RETIRED_SUBAGENT_MODEL_KEYS) expect(settings.subagentModels[name]).toBeUndefined()
    const runtime = JSON.parse(await readFile(join(agentDir, 'pipiui-subagent-models-runtime.json'), 'utf8'))
    expect(runtime).toEqual({ explore: [{ model: 'xai/grok-4.5', thinking: 'high' }] })
    await rm(join(agentDir, 'pipiui-subagent-models-runtime.json'))
    const restarted = createPiHostBackend({ agentDir, env: { ...process.env, HOME: root }, authRuntime: authRuntime([{ provider: 'xai', id: 'grok-4.5' }]) })
    await restarted.handle('getSubagentModels', [])
    const rematerialized = JSON.parse(await readFile(join(agentDir, 'pipiui-subagent-models-runtime.json'), 'utf8'))
    expect(rematerialized).toEqual({ explore: [{ model: 'xai/grok-4.5', thinking: 'high' }] })
    for (const name of RETIRED_SUBAGENT_MODEL_KEYS) expect(rematerialized[name]).toBeUndefined()
  })
  it('persists the Supervisor Luna override across backend recreation and rematerializes it', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-supervisor-models-'))
    const agentDir = join(root, 'agent')
    const models = [{ provider: 'openai-codex', id: 'gpt-5.6-luna' }]
    const backend = createPiHostBackend({ agentDir, env: { ...process.env, HOME: root }, authRuntime: authRuntime(models) })
    await backend.handle('setSubagentModel', ['supervisor', [{ model: 'openai-codex/gpt-5.6-luna' }]])
    expect(await backend.handle('getSubagentModels', [])).toMatchObject({
      supervisor: [{ model: 'openai-codex/gpt-5.6-luna' }],
    })

    await rm(join(agentDir, 'pipiui-subagent-models-runtime.json'))
    const restarted = createPiHostBackend({ agentDir, env: { ...process.env, HOME: root }, authRuntime: authRuntime(models) })
    expect(await restarted.handle('getSubagentModels', [])).toMatchObject({
      supervisor: [{ model: 'openai-codex/gpt-5.6-luna' }],
    })
    const rematerialized = JSON.parse(await readFile(join(agentDir, 'pipiui-subagent-models-runtime.json'), 'utf8'))
    expect(rematerialized.supervisor).toEqual([{ model: 'openai-codex/gpt-5.6-luna' }])
  })
  it('migrates a uniquely owned legacy bare id but never chooses between duplicate providers', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-computer-models-'))
    const uniqueDir = join(root, 'unique')
    await mkdir(uniqueDir, { recursive: true })
    await writeFile(join(uniqueDir, 'pipiui-settings.json'), JSON.stringify({ subagentModels: { explore: [{ model: 'gpt-5' }] } }))
    const unique = createPiHostBackend({ agentDir: uniqueDir, env: { ...process.env, HOME: root }, authRuntime: authRuntime([{ provider: 'openai', id: 'gpt-5' }]) })
    expect(await unique.handle('getSubagentModels', [])).toEqual({ explore: [{ model: 'openai/gpt-5' }] })
    expect(JSON.parse(await readFile(join(uniqueDir, 'pipiui-subagent-models-runtime.json'), 'utf8'))).toEqual({ explore: [{ model: 'openai/gpt-5' }] })

    const ambiguousDir = join(root, 'ambiguous')
    await mkdir(ambiguousDir, { recursive: true })
    await writeFile(join(ambiguousDir, 'pipiui-settings.json'), JSON.stringify({ subagentModels: { explore: [{ model: 'grok-4.5' }] } }))
    const ambiguous = createPiHostBackend({ agentDir: ambiguousDir, env: { ...process.env, HOME: root }, authRuntime: authRuntime([{ provider: 'xai', id: 'grok-4.5' }, { provider: 'github-copilot', id: 'grok-4.5' }]) })
    expect(await ambiguous.handle('getSubagentModels', [])).toEqual({ explore: [{ model: 'grok-4.5' }] })
    await expect(ambiguous.handle('setSubagentModel', ['explore', [{ model: 'grok-4.5' }]])).rejects.toThrow('provider/model')
  })
})
