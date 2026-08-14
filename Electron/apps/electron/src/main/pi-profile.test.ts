import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PI_PROFILE_MIGRATION_MARKER,
  installBundledModelCapabilityOverrides,
  importLegacyPiProfile,
  resolveElectronPiProfile
} from './pi-profile.js'

describe('Electron Pi profile', () => {
  let root = ''
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = ''
  })

  it('resolves agent and session state beneath userData', () => {
    expect(resolveElectronPiProfile('/app/user-data')).toEqual({
      agentDir: join('/app/user-data', 'pi-agent'),
      sessionsRoot: join('/app/user-data', 'pi-agent', 'sessions')
    })
  })

  it('copies only continuity state, preserves the source, and is idempotent', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-profile-'))
    const legacy = join(root, 'legacy')
    const profile = resolveElectronPiProfile(join(root, 'user-data'))
    await mkdir(join(legacy, 'sessions', 'project'), { recursive: true })
    await mkdir(join(legacy, 'pipiui-queues'), { recursive: true })
    for (const excluded of ['extensions', 'skills', 'prompts', 'packages', 'npm', 'bin', 'git', 'agents', 'missions', 'memory', 'backups']) {
      await mkdir(join(legacy, excluded), { recursive: true })
      await writeFile(join(legacy, excluded, 'excluded.txt'), excluded)
    }
    const settingsSource = `${JSON.stringify({
      defaultProvider: 'relay',
      defaultModel: 'fast',
      defaultThinkingLevel: 'high',
      retry: { enabled: true, maxRetries: 4 },
      theme: 'custom-tui-theme',
      packages: ['git:github.com/example/global-package'],
      extensions: ['extensions/global.ts'],
      skills: ['skills/global'],
      prompts: ['prompts/global.md'],
      promptTemplates: ['legacy-prompts/global.md'],
      themes: ['themes/custom.json']
    })}\n`
    const continuity = {
      '.env': 'TOKEN=secret-value\n',
      'auth.json': '{"credential":"opaque"}\n',
      'models.json': '{"models":[]}\n',
      'settings.json': settingsSource,
      'trust.json': '{}\n',
      'subagent-stats.jsonl': '{"runs":1}\n'
    }
    for (const [name, value] of Object.entries(continuity)) await writeFile(join(legacy, name), value)
    await writeFile(join(legacy, 'sessions', 'project', 'session.jsonl'), 'session-original\n')
    await writeFile(join(legacy, 'pipiui-queues', 'queue.json'), 'queue-original\n')
    await writeFile(join(legacy, 'unrelated.json'), 'unrelated\n')

    expect(await importLegacyPiProfile(profile, legacy)).toBe('imported')
    expect(await readdir(profile.agentDir)).toEqual(expect.arrayContaining([
      ...Object.keys(continuity), 'sessions', 'pipiui-queues', PI_PROFILE_MIGRATION_MARKER
    ]))
    expect(await readFile(join(profile.agentDir, 'sessions', 'project', 'session.jsonl'), 'utf8')).toBe('session-original\n')
    expect(await readFile(join(profile.agentDir, 'pipiui-queues', 'queue.json'), 'utf8')).toBe('queue-original\n')
    const importedSettings = JSON.parse(await readFile(join(profile.agentDir, 'settings.json'), 'utf8'))
    expect(importedSettings).toEqual({
      defaultProvider: 'relay',
      defaultModel: 'fast',
      defaultThinkingLevel: 'high',
      retry: { enabled: true, maxRetries: 4 },
      // `theme` is a scalar TUI preference, not a path/package source. `themes` is removed.
      theme: 'custom-tui-theme'
    })
    for (const resourceKey of ['packages', 'extensions', 'skills', 'prompts', 'promptTemplates', 'themes']) {
      expect(importedSettings).not.toHaveProperty(resourceKey)
    }
    await expect(readdir(join(profile.agentDir, 'extensions'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(profile.agentDir, 'unrelated.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    // Neither the import nor a rerun mutates source bytes or replaces the installed copy.
    expect(await readFile(join(legacy, '.env'), 'utf8')).toBe(continuity['.env'])
    expect(await readFile(join(legacy, 'settings.json'), 'utf8')).toBe(settingsSource)
    const installedSettings = await readFile(join(profile.agentDir, 'settings.json'), 'utf8')
    await writeFile(join(legacy, 'settings.json'), '{"theme":"changed-after-import"}\n')
    expect(await importLegacyPiProfile(profile, legacy)).toBe('already-complete')
    expect(await readFile(join(profile.agentDir, 'settings.json'), 'utf8')).toBe(installedSettings)
  })

  it('does not merge legacy state into an initialized destination', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-profile-initialized-'))
    const legacy = join(root, 'legacy')
    const profile = resolveElectronPiProfile(join(root, 'user-data'))
    await mkdir(legacy, { recursive: true })
    await mkdir(profile.agentDir, { recursive: true })
    await writeFile(join(legacy, 'auth.json'), 'legacy-auth\n')
    await writeFile(join(profile.agentDir, 'settings.json'), 'electron-settings\n')

    expect(await importLegacyPiProfile(profile, legacy)).toBe('skipped-initialized')
    expect(await readFile(join(profile.agentDir, 'settings.json'), 'utf8')).toBe('electron-settings\n')
    await expect(readFile(join(profile.agentDir, 'auth.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(legacy, 'auth.json'), 'utf8')).toBe('legacy-auth\n')
  })

  it('converts sourced effort metadata into user-preserving Pi overrides idempotently', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-profile-model-capabilities-'))
    const profile = resolveElectronPiProfile(join(root, 'user-data'))
    const snapshotPath = join(root, 'model-capabilities.json')
    await mkdir(profile.agentDir, { recursive: true })
    await writeFile(snapshotPath, JSON.stringify({
      schemaVersion: 1,
      source: 'https://models.dev/api.json',
      retrievedAt: '2026-08-13T03:20:00Z',
      providers: {
        generic: {
          models: {
            reasoner: {
              reasoning: true,
              reasoningOptions: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh'] }],
              verifiedAdditiveEffortValues: ['minimal'],
              verification: { endpoint: 'official provider endpoint', rejectedValues: ['off', 'max'] }
            }
          }
        }
      }
    }))
    await writeFile(join(profile.agentDir, 'models.json'), `${JSON.stringify({
      topLevelUserField: { retained: true },
      providers: {
        generic: {
          apiKey: 'GENERIC_KEY',
          userProviderField: 'retained',
          modelOverrides: {
            reasoner: {
              name: 'User name',
              thinkingLevelMap: { high: 'user-high' },
              compat: { supportsDeveloperRole: false }
            },
            untouched: { reasoning: false }
          }
        },
        untouched: { apiKey: 'OTHER_KEY' }
      }
    }, null, 2)}\n`)

    expect(await installBundledModelCapabilityOverrides(profile, snapshotPath)).toBe('updated')
    const installed = await readFile(join(profile.agentDir, 'models.json'), 'utf8')
    const parsed = JSON.parse(installed)
    expect(parsed.topLevelUserField).toEqual({ retained: true })
    expect(parsed.providers.generic).toMatchObject({
      apiKey: 'GENERIC_KEY',
      userProviderField: 'retained',
      modelOverrides: {
        untouched: { reasoning: false },
        reasoner: {
          name: 'User name',
          reasoning: true,
          thinkingLevelMap: {
            minimal: 'minimal',
            low: 'low',
            medium: 'medium',
            high: 'user-high',
            xhigh: 'xhigh',
            max: null
          },
          compat: { supportsReasoningEffort: true, supportsDeveloperRole: false }
        }
      }
    })
    // "off" stays absent from the managed map so it remains selectable and sends no effort param.
    expect(parsed.providers.generic.modelOverrides.reasoner.thinkingLevelMap.off).toBeUndefined()
    expect(parsed.providers.untouched).toEqual({ apiKey: 'OTHER_KEY' })
    expect(await installBundledModelCapabilityOverrides(profile, snapshotPath)).toBe('unchanged')
    expect(await readFile(join(profile.agentDir, 'models.json'), 'utf8')).toBe(installed)

    const upgraded = JSON.parse(await readFile(snapshotPath, 'utf8'))
    upgraded.providers.generic.models.reasoner.reasoningOptions[0].values = ['medium', 'high', 'xhigh']
    upgraded.providers.generic.models.reasoner.verifiedAdditiveEffortValues = ['minimal']
    await writeFile(snapshotPath, JSON.stringify(upgraded))
    expect(await installBundledModelCapabilityOverrides(profile, snapshotPath)).toBe('updated')
    const upgradedModels = JSON.parse(await readFile(join(profile.agentDir, 'models.json'), 'utf8'))
    // Managed `low` follows the newer snapshot, while the divergent user `high` mapping remains.
    expect(upgradedModels.providers.generic.modelOverrides.reasoner.thinkingLevelMap).toMatchObject({
      minimal: 'minimal', low: null, medium: 'medium', high: 'user-high', xhigh: 'xhigh'
    })

  })

  it('feeds the bundled override through installed Pi ModelRuntime and into the xhigh request payload', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-profile-real-model-runtime-'))
    const profile = resolveElectronPiProfile(join(root, 'user-data'))
    await mkdir(profile.agentDir, { recursive: true })
    await writeFile(join(profile.agentDir, 'models-store.json'), JSON.stringify({
      xai: {
        lastModified: 4102444800000,
        checkedAt: 4102444800000,
        models: [{
          provider: 'xai',
          id: 'grok-4.6',
          name: 'Grok 4.6',
          api: 'openai-completions',
          baseUrl: 'https://api.x.ai/v1',
          reasoning: true,
          input: ['text', 'image'],
          cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
          contextWindow: 500000,
          maxTokens: 500000,
          compat: { supportsReasoningEffort: false }
        }]
      }
    }))
    const snapshotPath = join(process.cwd(), 'resources', 'runtime', 'model-capabilities', 'models-dev-reasoning-options.json')
    expect(await installBundledModelCapabilityOverrides(profile, snapshotPath)).toBe('updated')

    const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
    const runtime = await ModelRuntime.create({
      modelsPath: join(profile.agentDir, 'models.json'),
      modelsStorePath: join(profile.agentDir, 'models-store.json'),
      allowModelNetwork: false
    })
    const model = runtime.getModel('xai', 'grok-4.6')
    expect(model).toMatchObject({
      reasoning: true,
      thinkingLevelMap: {
        minimal: 'minimal',
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: null
      },
      compat: { supportsReasoningEffort: true }
    })
    expect(model?.thinkingLevelMap?.off).toBeUndefined()

    const { streamSimple } = await import('@earendil-works/pi-ai/api/openai-completions')
    let payload: Record<string, unknown> | undefined
    const stream = streamSimple(model as any, {
      messages: [{ role: 'user', content: 'probe', timestamp: Date.now() }]
    }, {
      apiKey: 'not-sent',
      reasoning: 'xhigh',
      maxTokens: 1,
      onPayload: value => {
        payload = value as unknown as Record<string, unknown>
        throw new Error('payload captured before network')
      }
    })
    await stream.result()
    expect(payload).toMatchObject({ model: 'grok-4.6', reasoning_effort: 'xhigh' })

    // Thinking off must not leak a reasoning_effort param the provider would reject.
    let offPayload: Record<string, unknown> | undefined
    const offStream = streamSimple(model as any, {
      messages: [{ role: 'user', content: 'probe', timestamp: Date.now() }]
    }, {
      apiKey: 'not-sent',
      reasoning: 'off',
      maxTokens: 1,
      onPayload: value => {
        offPayload = value as unknown as Record<string, unknown>
        throw new Error('payload captured before network')
      }
    })
    await offStream.result()
    expect(offPayload).toBeDefined()
    expect(offPayload).not.toHaveProperty('reasoning_effort')
  })

  it('wires a hand-curated deepseek map so thinking levels reach a non-pi-named effort vocabulary', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipi-profile-deepseek-effort-'))
    const profile = resolveElectronPiProfile(join(root, 'user-data'))
    await mkdir(profile.agentDir, { recursive: true })
    // The broken state this guards against: a relay serving deepseek models with
    // reasoning:false and no thinking wiring, so every dispatch-level thinking knob
    // silently did nothing while the model thought itself into thousands of tokens.
    await writeFile(join(profile.agentDir, 'models.json'), JSON.stringify({
      providers: {
        jellytoken: {
          api: 'openai-completions',
          apiKey: 'not-sent',
          baseUrl: 'https://aiservice.example.test/v1',
          models: [{
            id: 'deepseek-v4-flash',
            name: 'DeepSeek V4 Flash',
            reasoning: false,
            input: ['text'],
            contextWindow: 200000,
            maxTokens: 16384
          }]
        }
      }
    }))
    await writeFile(join(profile.agentDir, 'models-store.json'), JSON.stringify({}))
    const snapshotPath = join(process.cwd(), 'resources', 'runtime', 'model-capabilities', 'models-dev-reasoning-options.json')
    expect(await installBundledModelCapabilityOverrides(profile, snapshotPath)).toBe('updated')
    expect(await installBundledModelCapabilityOverrides(profile, snapshotPath)).toBe('unchanged')

    const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
    const runtime = await ModelRuntime.create({
      modelsPath: join(profile.agentDir, 'models.json'),
      modelsStorePath: join(profile.agentDir, 'models-store.json'),
      allowModelNetwork: false
    })
    const model = runtime.getModel('jellytoken', 'deepseek-v4-flash')
    expect(model).toMatchObject({
      reasoning: true,
      thinkingLevelMap: {
        off: null,
        minimal: 'low',
        low: 'low',
        medium: 'high',
        high: 'high',
        xhigh: 'max',
        max: 'max'
      },
      compat: { supportsReasoningEffort: true, thinkingFormat: 'deepseek' }
    })

    const { streamSimple } = await import('@earendil-works/pi-ai/api/openai-completions')
    const capture = async (reasoning?: string) => {
      let payload: Record<string, unknown> | undefined
      const stream = streamSimple(model as any, {
        messages: [{ role: 'user', content: 'probe', timestamp: Date.now() }]
      }, {
        apiKey: 'not-sent',
        ...(reasoning ? { reasoning } : {}),
        maxTokens: 1,
        onPayload: value => {
          payload = value as unknown as Record<string, unknown>
          throw new Error('payload captured before network')
        }
      })
      await stream.result().catch(() => undefined)
      expect(payload).toBeDefined()
      return payload!
    }

    // An explicit low level arrives as deepseek's native pair: thinking on + effort low.
    expect(await capture('low')).toMatchObject({ reasoning_effort: 'low', thinking: { type: 'enabled' } })
    // medium is not a deepseek effort: the map routes it to high instead of forwarding garbage.
    expect(await capture('medium')).toMatchObject({ reasoning_effort: 'high' })
    // With no level requested, off:null must not silently disable thinking wholesale.
    expect(await capture()).not.toHaveProperty('thinking')
  })
})
