import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The large optional extension packs. Every profile lists them as `recommended`
 * and none as `required` (see each resources/runtime/profiles pipiui-profile.json),
 * so a package without them still activates every profile — it just cannot offer
 * these capabilities. They are ~125MB of the shipped app, which is the whole
 * reason a base edition exists.
 */
export const OPTIONAL_EXTENSION_PACKS = Object.freeze(['office-extension', 'code-retrieval', 'pdf-extension'])

/**
 * `full` ships everything and stays the default: an unset PIPIUI_EDITION must
 * never silently produce a slimmer app than the release process expects.
 */
export function resolveEdition(env = process.env) {
  const raw = (env.PIPIUI_EDITION ?? 'full').trim().toLowerCase()
  if (raw !== 'base' && raw !== 'full') {
    throw new Error(`Unknown PIPIUI_EDITION: ${env.PIPIUI_EDITION} (expected "base" or "full")`)
  }
  return raw
}

function targetsOptionalPack(entry) {
  const to = typeof entry?.to === 'string' ? entry.to : ''
  return OPTIONAL_EXTENSION_PACKS.some(
    pack => to === `pipiui-runtime/extensions/${pack}` || to.startsWith(`pipiui-runtime/extensions/${pack}/`)
  )
}

/** The OfficeCLI slice unpacks into office-extension/bin; without that pack it is a stranded binary. */
function carriesOfficeCli(entry) {
  return typeof entry?.from === 'string' && entry.from.includes('.officecli/')
}

/**
 * Derive the base-edition config from the real `build` field rather than
 * duplicating it. Every packaging invariant (asar negation patterns, the
 * per-architecture embedded runtime, the Cua driver slice) therefore stays in
 * apps/electron/package.json, where packaging-contract.test.ts asserts it.
 *
 * Dropping a pack takes two edits: its own extraResources entries carry the
 * node_modules/vendor trees, but the bulk `resources/runtime` copy would still
 * sweep the pack's source files in, so it needs an explicit negation too.
 */
export function baseEditionConfig(build) {
  const config = structuredClone(build)
  const entries = Array.isArray(config.extraResources) ? config.extraResources : []
  const kept = entries.filter(entry => !targetsOptionalPack(entry) && !carriesOfficeCli(entry))
  const runtime = kept.find(entry => entry.to === 'pipiui-runtime')
  if (!runtime) throw new Error('base edition: no extraResources entry copies resources/runtime to pipiui-runtime')
  runtime.filter = [
    ...(Array.isArray(runtime.filter) ? runtime.filter : []),
    ...OPTIONAL_EXTENSION_PACKS.map(pack => `!extensions/${pack}/**`)
  ]
  config.extraResources = kept
  return config
}

/**
 * Materialize the edition config and return the electron-builder arguments that
 * select it. `--config <file>` replaces the package.json `build` field outright,
 * which is why the file above is a full derived copy and not a patch. Relative
 * `from` paths resolve against projectDir (apps/electron), not against this
 * file, so a temp directory is a safe home for it.
 */
export function editionBuilderArgs(electronRoot, env = process.env) {
  if (resolveEdition(env) === 'full') return []
  const packageJSONPath = join(electronRoot, 'apps', 'electron', 'package.json')
  const build = JSON.parse(readFileSync(packageJSONPath, 'utf8')).build
  const configPath = join(mkdtempSync(join(tmpdir(), 'pipiui-edition-')), 'electron-builder.json')
  writeFileSync(configPath, JSON.stringify(baseEditionConfig(build), null, 2))
  return ['--config', configPath]
}
