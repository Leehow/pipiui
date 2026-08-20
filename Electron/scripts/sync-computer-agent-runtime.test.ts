import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const scriptSource = resolve(import.meta.dirname, 'sync-computer-agent-runtime.mjs')
const temporaryRoots: string[] = []

async function write(root: string, relative: string, content: string) {
  const path = join(root, relative)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

async function makeFixture(driverVersion: string, skillVersion: string) {
  const root = await mkdtemp(join(tmpdir(), 'pipiui-sync-runtime-'))
  temporaryRoots.push(root)
  const electron = join(root, 'Electron')
  await write(electron, 'scripts/sync-computer-agent-runtime.mjs', await readFile(scriptSource))
  await write(electron, 'cua-driver-assets.json', JSON.stringify({ version: driverVersion }))
  await write(
    electron,
    join('resources', 'runtime', 'pi-ext', 'packages', 'computer-agent', 'skills', 'cua-driver-operation', 'SKILL.md'),
    `cua-driver-version: ${skillVersion}\n`,
  )
  return join(electron, 'scripts', 'sync-computer-agent-runtime.mjs')
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Electron computer-agent runtime contract gate', () => {
  it('passes when the Cua skill version matches the packaged driver', async () => {
    const script = await makeFixture('fixture-driver', 'fixture-driver')
    await expect(execFileAsync(process.execPath, [script])).resolves.toMatchObject({
      stdout: expect.stringContaining('Computer Agent runtime contract OK.'),
    })
    await expect(execFileAsync(process.execPath, [script, '--check'])).resolves.toMatchObject({
      stdout: expect.stringContaining('Computer Agent runtime contract OK.'),
    })
  })

  it('fails when the Cua skill version drifts from the packaged driver', async () => {
    const script = await makeFixture('fixture-driver', 'other-driver')
    await expect(execFileAsync(process.execPath, [script])).rejects.toMatchObject({ code: 1 })
  })
})
