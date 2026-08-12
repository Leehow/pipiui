import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPiHostBackend } from '../src/index'

describe('Computer Agent role model settings', () => {
  let root = ''
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })
  it('advertises terminal as a real role and materializes its independent setting', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-computer-models-'))
    const backend = createPiHostBackend({ agentDir: join(root, 'agent'), env: { ...process.env, HOME: root } })
    const roles = await backend.handle('listAgentDefinitions', []) as Array<{ name: string }>
    expect(roles.map(role => role.name)).toContain('computer-terminal')
    await backend.handle('setSubagentModel', ['computer-terminal', [{ model: 'grok-4.5', thinking: 'high' }]])
    expect(await backend.handle('getSubagentModels', [])).toMatchObject({ 'computer-terminal': [{ model: 'grok-4.5', thinking: 'high' }] })
    const runtime = JSON.parse(await readFile(join(root, 'agent/pipiui-subagent-models-runtime.json'), 'utf8'))
    expect(runtime['computer-terminal']).toEqual([{ model: 'grok-4.5', thinking: 'high' }])
  })
  it('passes the Electron-owned role model file to nested worker resolution', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-computer-models-'))
    const agentDir = join(root, 'agent')
    const backend = createPiHostBackend({ agentDir, env: { ...process.env, HOME: root } })
    await backend.handle('setSubagentModel', ['computer-verifier', [{ model: 'xai/grok-4.5', thinking: 'high' }]])
    const runtime = JSON.parse(await readFile(join(agentDir, 'pipiui-subagent-models-runtime.json'), 'utf8'))
    expect(runtime['computer-verifier']).toEqual([{ model: 'xai/grok-4.5', thinking: 'high' }])
    await rm(join(agentDir, 'pipiui-subagent-models-runtime.json'))
    const restarted = createPiHostBackend({ agentDir, env: { ...process.env, HOME: root } })
    await restarted.handle('getSubagentModels', [])
    const rematerialized = JSON.parse(await readFile(join(agentDir, 'pipiui-subagent-models-runtime.json'), 'utf8'))
    expect(rematerialized['computer-verifier']).toEqual([{ model: 'xai/grok-4.5', thinking: 'high' }])
  })
})
