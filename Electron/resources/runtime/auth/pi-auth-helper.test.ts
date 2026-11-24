import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { serializeAvailableModel } from './pi-auth-helper.mjs'

const execFileAsync = promisify(execFile)

describe('Pi auth helper bundled provider registration', () => {
  async function fixtureTree() {
    const root = await mkdtemp(join(tmpdir(), 'pipi-auth-helper-register-'))
    const piRoot = join(root, 'pi-runtime')
    const binDir = join(root, 'bin')
    await mkdir(join(piRoot, 'dist'), { recursive: true })
    await mkdir(join(binDir, 'node_modules', '@earendil-works'), { recursive: true })
    await mkdir(join(root, 'auth'), { recursive: true })
    await mkdir(join(root, 'extensions', 'fakext', 'agent', 'dist'), { recursive: true })
    await writeFile(join(piRoot, 'package.json'), JSON.stringify({ type: 'module' }))
    await writeFile(join(piRoot, 'dist', 'index.js'), `
const registered = new Map()
export const ModelRuntime = {
  async create() {
    return {
      registerProvider(id, config) { registered.set(id, config) },
      getProvider(id) { return registered.get(id) },
      getProviders() { return [...registered.keys()].map(id => ({ id, name: id, auth: { apiKey: {} } })) },
      async getAvailable() { return [] }
    }
  }
}
`)
    await symlink(piRoot, join(binDir, 'node_modules', '@earendil-works', 'pi-coding-agent'), 'dir')
    await writeFile(join(binDir, 'pi'), '')
    await writeFile(join(root, 'extensions', 'fakext', 'agent', 'dist', 'provider.js'), `
export const AUTH_PROVIDER_ID = 'fake-ext'
export const createAuthProvider = () => ({ name: 'Fake Ext', api: 'openai-completions', baseUrl: 'https://example.invalid', models: [] })
`)
    const helper = await readFile(resolve('resources/runtime/auth/pi-auth-helper.mjs'), 'utf8')
    await writeFile(join(root, 'auth', 'pi-auth-helper.mjs'), helper)
    // macOS /var -> /private/var: the helper's entry guard compares
    // import.meta.url against argv[1], so spawn the realpath'd copy or the
    // child loads silently without running main().
    const helperPath = await realpath(join(root, 'auth', 'pi-auth-helper.mjs'))
    return { root, helperPath, piPath: join(binDir, 'pi') }
  }

  it('registers bundled auth providers when a profile home is pinned', async () => {
    const { root, helperPath, piPath } = await fixtureTree()
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, [helperPath, 'list-providers'], {
        env: { PATH: process.env.PATH, HOME: root, PIPIUI_PI_PATH: piPath, PI_CODING_AGENT_DIR: join(root, 'agent') }
      })
      const response = JSON.parse(stdout.trim())
      expect(response.ok).toBe(true)
      expect(response.providers.map((provider: any) => provider.id)).toContain('fake-ext')
      expect(stderr).not.toContain('will not be registered')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('registers host-supplied provider modules from outside the bundled tree', async () => {
    // User-installed providers: the bundled extensions/ dir cannot contain
    // them, so the host hands the module path down via env.
    const { root, helperPath, piPath } = await fixtureTree()
    try {
      const outside = join(root, 'installed', 'deepseekx', 'agent', 'dist')
      await mkdir(outside, { recursive: true })
      await writeFile(join(outside, 'provider.js'), `
export const AUTH_PROVIDER_ID = 'fake-outside'
export const createAuthProvider = async () => {
  await new Promise(resolve => setTimeout(resolve, 5));
  return { name: 'Fake Outside', api: 'openai-completions', baseUrl: 'https://example.invalid', models: [] };
}
`)
      const { stdout } = await execFileAsync(process.execPath, [helperPath, 'list-providers'], {
        env: {
          PATH: process.env.PATH,
          HOME: root,
          PIPIUI_PI_PATH: piPath,
          PI_CODING_AGENT_DIR: join(root, 'agent'),
          PIPIUI_EXTENSION_AUTH_PROVIDERS: JSON.stringify([{ id: 'fake-outside', module: join(outside, 'provider.js') }])
        }
      })
      const response = JSON.parse(stdout.trim())
      expect(response.ok).toBe(true)
      const ids = response.providers.map((provider: any) => provider.id)
      expect(ids).toContain('fake-outside')
      expect(ids).toContain('fake-ext')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('warns and skips registration when no profile home is resolved', async () => {
    const { root, helperPath, piPath } = await fixtureTree()
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, [helperPath, 'list-providers'], {
        env: { PATH: process.env.PATH, HOME: root, PIPIUI_PI_PATH: piPath }
      })
      const response = JSON.parse(stdout.trim())
      expect(response.ok).toBe(true)
      expect(response.providers.map((provider: any) => provider.id)).not.toContain('fake-ext')
      expect(stderr).toContain('bundled auth providers will not be registered')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

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
