import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export const PI_PROFILE_MIGRATION_MARKER = '.pipiui-profile-migration-v1.json'

const CONTINUITY_ENTRIES = new Set([
  '.env',
  'auth.json',
  'models.json',
  'settings.json',
  'trust.json',
  'sessions',
  'subagent-stats.jsonl'
])

// These settings are resource locators, not ordinary model/runtime preferences. Importing them
// would make the new profile reinstall or load content selected by the user's global Pi. The
// scalar `theme` setting is intentionally retained: it is a TUI display preference, while the
// resource-bearing `themes` list is stripped (and Electron also launches Pi with --no-themes).
const AMBIENT_RESOURCE_SETTINGS = [
  'packages',
  'extensions',
  'skills',
  'prompts',
  'promptTemplates',
  'themes'
] as const

export interface ElectronPiProfile {
  agentDir: string
  sessionsRoot: string
}

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const MODEL_CAPABILITY_PROVENANCE = '.pipiui-model-capability-overrides-v1.json'
type ThinkingLevel = typeof THINKING_LEVELS[number]
type JsonObject = Record<string, any>

interface ModelCapabilitySnapshot {
  schemaVersion: 1
  providers: Record<string, {
    models: Record<string, {
      reasoning?: boolean
      reasoningOptions?: Array<{ type: string, values?: string[] }>
      verifiedAdditiveEffortValues?: string[]
      /**
       * Hand-curated passthrough for providers whose effort vocabulary is not named after
       * pi levels (deepseek accepts low/high/max). The derived same-name map would forward
       * an unsupported "medium" — the one failure mode this file exists to prevent.
       */
      thinkingLevelMap?: Record<string, string | null>
      /** Hand-curated compat fields (e.g. thinkingFormat) merged over the derived override. */
      compat?: Record<string, unknown>
    }>
  }>
}

function objectValue(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must contain a JSON object`)
  return value as JsonObject
}

function parseSnapshot(source: string): ModelCapabilitySnapshot {
  const snapshot = objectValue(JSON.parse(source), 'Bundled model capability snapshot')
  if (snapshot.schemaVersion !== 1) throw new Error('Unsupported bundled model capability snapshot schema')
  objectValue(snapshot.providers, 'Bundled model capability snapshot providers')
  return snapshot as ModelCapabilitySnapshot
}

function capabilityOverride(model: ModelCapabilitySnapshot['providers'][string]['models'][string]): JsonObject | undefined {
  const catalogValues = model.reasoningOptions
    ?.filter(option => option.type === 'effort')
    .flatMap(option => option.values ?? []) ?? []
  const supported = new Set([...catalogValues, ...(model.verifiedAdditiveEffortValues ?? [])])
  const handCurated = model.thinkingLevelMap !== undefined || model.compat !== undefined
  if (!handCurated && (!model.reasoning || supported.size === 0)) return undefined
  // "off" disables reasoning and must stay available even when the provider's effort
  // catalog omits it. Leave the key absent rather than mapped: an absent entry keeps
  // "off" selectable in the UI while sending no reasoning param, whereas a string value
  // would be forwarded as the provider effort and null would hide the level entirely
  // (stranding the UI default thinking level as invalid). A hand-curated entry may set
  // "off": null deliberately — for a model that cannot be trusted to think on command,
  // keeping an unset level at the provider default beats silently disabling thinking.
  const derived = handCurated && model.thinkingLevelMap !== undefined
    ? model.thinkingLevelMap
    : Object.fromEntries(
        THINKING_LEVELS.filter(level => level !== 'off').map(level => [level, supported.has(level) ? level : null])
      ) as Record<ThinkingLevel, string | null>
  return {
    reasoning: model.reasoning ?? true,
    thinkingLevelMap: derived,
    compat: { supportsReasoningEffort: true, ...(model.compat ?? {}) }
  }
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

const DELETE_MANAGED_VALUE = Symbol('delete-managed-value')

/** Replace only missing fields or fields that still equal the last PipiUI-managed value. */
function mergeManagedFields(current: unknown, next: unknown, previous: unknown): unknown | typeof DELETE_MANAGED_VALUE {
  if (next === undefined && previous !== undefined) {
    if (equalJson(current, previous)) return DELETE_MANAGED_VALUE
    if (!previous || typeof previous !== 'object' || Array.isArray(previous)) return current
  }
  if (!next || typeof next !== 'object' || Array.isArray(next)) {
    if (previous !== undefined && equalJson(current, previous))
      return next === undefined ? DELETE_MANAGED_VALUE : next
    return current === undefined ? next : current
  }
  const existing = objectValue(current ?? {}, 'models.json managed capability fields')
  const prior = previous === undefined ? {} : objectValue(previous, 'model capability provenance')
  const merged = structuredClone(existing)
  for (const key of new Set([...Object.keys(next), ...Object.keys(prior)])) {
    const value = mergeManagedFields(existing[key], (next as JsonObject)[key], prior[key])
    if (value === DELETE_MANAGED_VALUE) delete merged[key]
    else merged[key] = value
  }
  if (next === undefined && previous !== undefined && Object.keys(merged).length === 0) return DELETE_MANAGED_VALUE
  return merged
}

function sourcedOverrides(snapshot: ModelCapabilitySnapshot): JsonObject {
  const result: JsonObject = { providers: {} }
  for (const [providerId, providerSnapshot] of Object.entries(snapshot.providers)) {
    const models = objectValue(providerSnapshot.models, `Snapshot provider ${providerId} models`)
    for (const [modelId, modelSnapshot] of Object.entries(models)) {
      const sourced = capabilityOverride(modelSnapshot)
      if (!sourced) continue
      result.providers[providerId] ??= { modelOverrides: {} }
      result.providers[providerId].modelOverrides[modelId] = sourced
    }
  }
  return result
}

export function mergeBundledModelCapabilityOverrides(
  modelsJson: unknown,
  snapshot: ModelCapabilitySnapshot,
  previousManaged: unknown = { providers: {} }
): JsonObject {
  const existing = objectValue(modelsJson, 'models.json')
  const result = structuredClone(existing)
  const providers = objectValue(result.providers ?? {}, 'models.json providers')
  result.providers = providers
  const sourced = sourcedOverrides(snapshot)
  const previous = objectValue(previousManaged, 'model capability provenance')
  const previousProviders = objectValue(previous.providers ?? {}, 'model capability provenance providers')
  for (const providerId of new Set([...Object.keys(sourced.providers), ...Object.keys(previousProviders)])) {
    const sourcedModels = sourced.providers[providerId]?.modelOverrides ?? {}
    const previousModels = previousProviders[providerId]?.modelOverrides ?? {}
    for (const modelId of new Set([...Object.keys(sourcedModels), ...Object.keys(previousModels)])) {
      const sourcedModel = sourcedModels[modelId]
      const provider = objectValue(providers[providerId] ?? {}, `models.json provider ${providerId}`)
      providers[providerId] = provider
      const modelOverrides = objectValue(provider.modelOverrides ?? {}, `models.json provider ${providerId} modelOverrides`)
      provider.modelOverrides = modelOverrides
      const user = objectValue(modelOverrides[modelId] ?? {}, `models.json override ${providerId}/${modelId}`)
      const prior = previousProviders[providerId]?.modelOverrides?.[modelId]
      const merged = mergeManagedFields(user, sourcedModel, prior)
      if (merged === DELETE_MANAGED_VALUE) delete modelOverrides[modelId]
      else modelOverrides[modelId] = merged
    }
    if (Object.keys(providers[providerId].modelOverrides).length === 0) delete providers[providerId].modelOverrides
    if (Object.keys(providers[providerId]).length === 0) delete providers[providerId]
  }
  return result
}

/** Install the bundled capability layer before Pi ModelRuntime reads models.json. */
export async function installBundledModelCapabilityOverrides(
  profile: ElectronPiProfile,
  snapshotPath: string
): Promise<'updated' | 'unchanged'> {
  const modelsPath = join(profile.agentDir, 'models.json')
  const provenancePath = join(profile.agentDir, MODEL_CAPABILITY_PROVENANCE)
  await mkdir(profile.agentDir, { recursive: true })
  let original = ''
  try {
    original = await readFile(modelsPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  let current: unknown = { providers: {} }
  if (original) {
    try {
      current = JSON.parse(original)
    } catch (error) {
      throw new Error(`Failed to parse Electron Pi models.json: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const snapshot = parseSnapshot(await readFile(snapshotPath, 'utf8'))
  let previousManaged: unknown = { providers: {} }
  try {
    previousManaged = JSON.parse(await readFile(provenancePath, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Failed to read model capability provenance: ${error instanceof Error ? error.message : String(error)}`)
  }
  const managed = sourcedOverrides(snapshot)
  const merged = `${JSON.stringify(mergeBundledModelCapabilityOverrides(current, snapshot, previousManaged), null, 2)}\n`
  const provenance = `${JSON.stringify(managed, null, 2)}\n`
  let previousProvenance = ''
  try { previousProvenance = await readFile(provenancePath, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (original === merged && previousProvenance === provenance) return 'unchanged'
  const temporary = join(profile.agentDir, `.models.json-${process.pid}-${Date.now()}.tmp`)
  const provenanceTemporary = join(profile.agentDir, `.model-capabilities-${process.pid}-${Date.now()}.tmp`)
  try {
    if (original !== merged) {
      await writeFile(temporary, merged, { flag: 'wx' })
      await rename(temporary, modelsPath)
    }
    if (previousProvenance !== provenance) {
      await writeFile(provenanceTemporary, provenance, { flag: 'wx' })
      await rename(provenanceTemporary, provenancePath)
    }
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    await rm(provenanceTemporary, { force: true }).catch(() => undefined)
    throw error
  }
  return 'updated'
}

export const ELECTRON_USER_DATA_DIRNAME = '@pipiui/electron'

export function resolveElectronPiProfile(userData: string): ElectronPiProfile {
  const agentDir = join(userData, 'pi-agent')
  return { agentDir, sessionsRoot: join(agentDir, 'sessions') }
}

/** Historical Electron userData. `app.setName('PipiUI')` must not move this. */
export function resolveStableElectronUserDataPath(appData: string): string {
  return join(appData, ELECTRON_USER_DATA_DIRNAME)
}

function isContinuityEntry(name: string): boolean {
  return CONTINUITY_ENTRIES.has(name) || name.startsWith('pipiui-')
}

async function directoryEntries(path: string): Promise<string[] | undefined> {
  try {
    return await readdir(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function copySanitizedSettings(source: string, destination: string): Promise<void> {
  const original = await readFile(source, 'utf8')
  const parsed: unknown = JSON.parse(original)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Legacy Pi settings must contain a JSON object')
  }
  const settings = { ...(parsed as Record<string, unknown>) }
  for (const key of AMBIENT_RESOURCE_SETTINGS) delete settings[key]
  await writeFile(destination, `${JSON.stringify(settings, null, 2)}\n`, { flag: 'wx' })
}

/**
 * Seeds a new Electron-owned Pi profile from the former shared profile exactly once.
 *
 * The copy is assembled in a sibling staging directory, then renamed into place, so an
 * interrupted import never leaves a half-initialized destination. Existing profile data is
 * authoritative and is never merged with or overwritten by legacy state.
 */
export async function importLegacyPiProfile(
  profile: ElectronPiProfile,
  legacyAgentDir = join(homedir(), '.pi', 'agent')
): Promise<'imported' | 'already-complete' | 'skipped-initialized'> {
  const existing = await directoryEntries(profile.agentDir)
  if (existing?.includes(PI_PROFILE_MIGRATION_MARKER)) {
    // Read the marker so an unreadable/corrupt completion record does not silently masquerade
    // as a successful import. Its contents intentionally contain no source paths or credentials.
    JSON.parse(await readFile(join(profile.agentDir, PI_PROFILE_MIGRATION_MARKER), 'utf8'))
    return 'already-complete'
  }
  if (existing?.length) return 'skipped-initialized'

  await mkdir(dirname(profile.agentDir), { recursive: true })
  const staging = await mkdtemp(join(dirname(profile.agentDir), `.${basename(profile.agentDir)}-migration-`))
  let installed = false
  try {
    for (const name of (await directoryEntries(legacyAgentDir)) ?? []) {
      if (!isContinuityEntry(name)) continue
      const source = join(legacyAgentDir, name)
      if ((await lstat(source)).isSymbolicLink()) continue
      if (name === 'settings.json') {
        await copySanitizedSettings(source, join(staging, name))
        continue
      }
      await cp(source, join(staging, name), {
        recursive: true,
        force: false,
        errorOnExist: true,
        preserveTimestamps: true,
        filter: async candidate => !(await lstat(candidate)).isSymbolicLink()
      })
    }
    await writeFile(join(staging, PI_PROFILE_MIGRATION_MARKER), `${JSON.stringify({ version: 1 })}\n`, { flag: 'wx' })
    if (existing) await rmdir(profile.agentDir)
    await rename(staging, profile.agentDir)
    installed = true
    return 'imported'
  } finally {
    if (!installed) await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}
