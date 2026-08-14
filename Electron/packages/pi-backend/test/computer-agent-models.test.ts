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

describe('Computer Agent role model settings', () => {
  let root = ''
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })
  it('advertises terminal as a real role and materializes its independent setting', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-computer-models-'))
    const backend = createPiHostBackend({ agentDir: join(root, 'agent'), env: { ...process.env, HOME: root }, authRuntime: authRuntime([{ provider: 'xai', id: 'grok-4.5' }]) })
    const roles = await backend.handle('listAgentDefinitions', []) as Array<{ name: string }>
    expect(roles.map(role => role.name)).toContain('computer-terminal')
    await backend.handle('setSubagentModel', ['computer-terminal', [{ model: 'xai/grok-4.5', thinking: 'high' }]])
    expect(await backend.handle('getSubagentModels', [])).toMatchObject({ 'computer-terminal': [{ model: 'xai/grok-4.5', thinking: 'high' }] })
    const runtime = JSON.parse(await readFile(join(root, 'agent/pipiui-subagent-models-runtime.json'), 'utf8'))
    expect(runtime['computer-terminal']).toEqual([{ model: 'xai/grok-4.5', thinking: 'high' }])
  })
  it('passes the Electron-owned role model file to nested worker resolution', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-computer-models-'))
    const agentDir = join(root, 'agent')
    const backend = createPiHostBackend({ agentDir, env: { ...process.env, HOME: root }, authRuntime: authRuntime([{ provider: 'xai', id: 'grok-4.5' }]) })
    await backend.handle('setSubagentModel', ['computer-verifier', [{ model: 'xai/grok-4.5', thinking: 'high' }]])
    const runtime = JSON.parse(await readFile(join(agentDir, 'pipiui-subagent-models-runtime.json'), 'utf8'))
    expect(runtime['computer-verifier']).toEqual([{ model: 'xai/grok-4.5', thinking: 'high' }])
    await rm(join(agentDir, 'pipiui-subagent-models-runtime.json'))
    const restarted = createPiHostBackend({ agentDir, env: { ...process.env, HOME: root }, authRuntime: authRuntime([{ provider: 'xai', id: 'grok-4.5' }]) })
    await restarted.handle('getSubagentModels', [])
    const rematerialized = JSON.parse(await readFile(join(agentDir, 'pipiui-subagent-models-runtime.json'), 'utf8'))
    expect(rematerialized['computer-verifier']).toEqual([{ model: 'xai/grok-4.5', thinking: 'high' }])
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
