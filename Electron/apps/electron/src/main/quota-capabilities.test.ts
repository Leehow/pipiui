import { mkdir, mkdtemp, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  fromPartition: vi.fn(() => ({ cookies: { get: vi.fn(async () => []) } })),
}))

vi.mock('electron', () => ({ session: { fromPartition: electron.fromPartition } }))

import { createQuotaCookieReader } from './quota-capabilities.js'

const roots: string[] = []

afterEach(async () => {
  electron.fromPartition.mockClear()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('quota browser partition lookup', () => {
  it('instantiates only a bounded set of recent browser partitions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipi-quota-partitions-'))
    roots.push(root)
    const partitions = join(root, 'Partitions')
    await mkdir(partitions)
    for (let index = 0; index < 20; index += 1) {
      const path = join(partitions, `pipiui-browser-${String(index).padStart(2, '0')}`)
      await mkdir(path)
      const date = new Date(1_700_000_000_000 + index * 1_000)
      await utimes(path, date, date)
    }

    await createQuotaCookieReader(root)('cursor')

    expect(electron.fromPartition).toHaveBeenCalledTimes(9)
    expect(electron.fromPartition).toHaveBeenNthCalledWith(1, 'persist:pipiui-browser')
    expect(electron.fromPartition).toHaveBeenCalledWith('persist:pipiui-browser-19')
    expect(electron.fromPartition).not.toHaveBeenCalledWith('persist:pipiui-browser-00')
  })
})
