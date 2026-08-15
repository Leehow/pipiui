import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const scriptSource = resolve(import.meta.dirname, 'sync-computer-agent-runtime.mjs')
const temporaryRoots: string[] = []
const electronOwnedSubagentFiles = [
  'subagent/index.ts',
  'subagent/model-ref.ts',
  'subagent/agents.ts',
  'subagent/runtime-policy.ts',
  'subagent/rpc-stream.ts',
]

async function write(root: string, relative: string, content: string) {
  const path = join(root, relative)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'pipiui-sync-runtime-'))
  temporaryRoots.push(root)
  const electron = join(root, 'Electron')
  const sourcePiExt = join(root, 'Sources', 'PipiUI', 'PiExt')
  const runtimePiExt = join(electron, 'resources', 'runtime', 'pi-ext')
  const sourcePhilosophy = join(root, 'Sources', 'PipiUI', 'PiPhilosophy')
  const runtimePhilosophy = join(electron, 'resources', 'runtime', 'pi-philosophy')

  await mkdir(join(electron, 'scripts'), { recursive: true })
  await writeFile(join(electron, 'scripts', 'sync-computer-agent-runtime.mjs'), await readFile(scriptSource))
  await write(electron, 'cua-driver-assets.json', JSON.stringify({ version: 'fixture-driver' }))

  for (const relative of electronOwnedSubagentFiles) {
    await write(sourcePiExt, relative, `frozen-swift:${relative}`)
    await write(runtimePiExt, relative, `electron-owned:${relative}`)
  }
  for (const relative of [
    'agents/operator/AGENT.md',
    'agents/computer-use-leader/AGENT.md',
    'agents/computer-verifier/AGENT.md',
    'agents/computer-terminal/AGENT.md',
  ]) await write(sourcePiExt, relative, `shared:${relative}`)
  await write(sourcePiExt, 'packages/computer-agent/skills/cua-driver-operation/SKILL.md', 'cua-driver-version: fixture-driver\n')
  await write(sourcePiExt, 'packages/computer-agent/runtime.ts', 'shared computer agent runtime')
  await write(sourcePhilosophy, 'layers/30-orchestration.md', 'shared orchestration')
  await write(sourcePhilosophy, 'capabilities.json', '{}')

  return { electron, runtimePiExt, runtimePhilosophy }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Electron computer-agent runtime sync boundary', () => {
  it('leaves Electron subagent runtime owned by Electron while syncing and checking intended shared mirrors', async () => {
    const { electron, runtimePiExt, runtimePhilosophy } = await makeFixture()
    const script = join(electron, 'scripts', 'sync-computer-agent-runtime.mjs')

    await execFileAsync(process.execPath, [script])

    for (const relative of electronOwnedSubagentFiles) {
      await expect(readFile(join(runtimePiExt, relative), 'utf8'))
        .resolves.toBe(`electron-owned:${relative}`)
    }
    await expect(readFile(join(runtimePiExt, 'packages/computer-agent/runtime.ts'), 'utf8'))
      .resolves.toBe('shared computer agent runtime')
    await expect(readFile(join(runtimePhilosophy, 'layers/30-orchestration.md'), 'utf8'))
      .resolves.toBe('shared orchestration')

    await write(runtimePiExt, 'packages/computer-agent/runtime.ts', 'stale shared mirror')
    await expect(execFileAsync(process.execPath, [script, '--check'])).rejects.toMatchObject({ code: 1 })
    await execFileAsync(process.execPath, [script])
    await expect(execFileAsync(process.execPath, [script, '--check'])).resolves.toMatchObject({
      stdout: expect.stringContaining('Computer Agent runtime mirror is current.'),
    })
  })
})
