import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { serializeAvailableModel } from './pi-auth-helper.mjs'

const execFileAsync = promisify(execFile)

describe('Pi auth helper model serialization', () => {
  it('bounds online model-catalog refresh while keeping network refresh enabled', async () => {
    const { modelRuntimeOptions } = await import('./pi-auth-helper.mjs')
    expect(modelRuntimeOptions()).toEqual({
      allowModelNetwork: true,
      modelRefreshTimeoutMs: 5_000
    })
  })

  it('passes the bounded online refresh options through the real list-models child seam', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipi-auth-helper-timeout-'))
    try {
      const piRoot = join(root, 'pi-runtime')
      const binDir = join(root, 'bin')
      await mkdir(join(piRoot, 'dist'), { recursive: true })
      await mkdir(binDir, { recursive: true })
      await writeFile(join(piRoot, 'package.json'), JSON.stringify({ type: 'module' }))
      await writeFile(join(piRoot, 'dist', 'index.js'), `
export const ModelRuntime = {
  async create(options) {
    return {
      async getAvailable() {
        return [{ provider: 'fixture', id: JSON.stringify(options), name: 'Fixture' }]
      }
    }
  }
}
`)
      const piPath = join(binDir, 'pi')
      await writeFile(piPath, '')
      await mkdir(join(binDir, 'node_modules'), { recursive: true })
      await (await import('node:fs/promises')).symlink(piRoot, join(binDir, 'node_modules', '@earendil-works', 'pi-coding-agent'), 'dir').catch(async () => {
        await mkdir(join(binDir, 'node_modules', '@earendil-works'), { recursive: true })
        await (await import('node:fs/promises')).symlink(piRoot, join(binDir, 'node_modules', '@earendil-works', 'pi-coding-agent'), 'dir')
      })
      const { stdout } = await execFileAsync(process.execPath, [
        resolve('resources/runtime/auth/pi-auth-helper.mjs'), 'list-models'
      ], { env: { ...process.env, PIPIUI_PI_PATH: piPath } })
      const response = JSON.parse(stdout.trim())
      expect(JSON.parse(response.models[0].id)).toEqual({
        allowModelNetwork: true,
        modelRefreshTimeoutMs: 5_000
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('preserves thinking capability metadata from the configured ModelRuntime catalog', () => {
    expect(serializeAvailableModel({
      provider: 'fixture',
      id: 'reasoner',
      name: 'Reasoner',
      api: 'openai-completions',
      reasoning: true,
      input: ['text'],
      thinkingLevelMap: {
        off: null,
        minimal: 'minimal',
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: null
      },
      compat: {
        supportsStore: false,
        supportsReasoningEffort: true,
        supportsDeveloperRole: false
      },
      secret: 'must-not-pass'
    })).toEqual({
      provider: 'fixture',
      id: 'reasoner',
      name: 'Reasoner',
      api: 'openai-completions',
      reasoning: true,
      input: ['text'],
      thinkingLevelMap: {
        off: null,
        minimal: 'minimal',
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: null
      },
      compat: {
        supportsStore: false,
        supportsReasoningEffort: true,
        supportsDeveloperRole: false
      }
    })
  })

  it('returns the isolated profile override through the real helper child process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipi-auth-helper-profile-'))
    try {
      const agentDir = join(root, 'agent')
      const sessionsRoot = join(agentDir, 'sessions')
      await mkdir(sessionsRoot, { recursive: true })
      await writeFile(join(agentDir, 'models.json'), JSON.stringify({
        providers: {
          xai: {
            apiKey: 'XAI_API_KEY',
            models: [{
              id: 'fixture-reasoner',
              name: 'Fixture Reasoner',
              api: 'openai-completions',
              baseUrl: 'https://api.x.ai/v1',
              reasoning: true,
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 1000
            }],
            modelOverrides: {
              'fixture-reasoner': {
                thinkingLevelMap: { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: null },
                compat: { supportsReasoningEffort: true }
              }
            }
          }
        }
      }))
      const embedded = resolve('.embedded-runtimes', 'darwin-arm64')
      const { stdout } = await execFileAsync(join(embedded, 'node', 'bin', 'node'), [
        resolve('resources/runtime/auth/pi-auth-helper.mjs'), 'list-models'
      ], {
        env: {
          ...process.env,
          PI_OFFLINE: '1',
          PI_CODING_AGENT_DIR: agentDir,
          PI_CODING_AGENT_SESSION_DIR: sessionsRoot,
          PIPIUI_PI_PATH: join(embedded, 'pi', 'bin', 'pi'),
          XAI_API_KEY: 'fixture-not-serialized'
        }
      })
      const response = JSON.parse(stdout.trim())
      expect(response.ok).toBe(true)
      expect(response.models.find((model: any) => model.id === 'fixture-reasoner')).toMatchObject({
        thinkingLevelMap: { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: null },
        compat: { supportsReasoningEffort: true }
      })
      expect(stdout).not.toContain('fixture-not-serialized')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
