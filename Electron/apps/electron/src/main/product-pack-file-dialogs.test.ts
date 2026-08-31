import { describe, expect, it, vi } from 'vitest'
import type { HostBackend } from '@pipi/host-api'

import { withProductPackFileDialogs } from './product-pack-file-dialogs.js'

describe('Product Pack file-dialog adapter', () => {
  it('routes archive open/save methods and delegates everything else', async () => {
    const backend = {
      handle: vi.fn(async () => 'delegated'),
      subscribe: () => () => undefined,
    } as HostBackend
    const pickArchive = vi.fn(async () => '/tmp/input.zip')
    const saveArchive = vi.fn(async () => '/tmp/output.zip')
    const wrapped = withProductPackFileDialogs(backend, { pickArchive, saveArchive })

    await expect(wrapped.handle('pickProductPackArchive', [])).resolves.toBe('/tmp/input.zip')
    await expect(wrapped.handle('saveProductPackArchive', ['coding.pipiui-pack.zip'])).resolves.toBe('/tmp/output.zip')
    await expect(wrapped.handle('listProjects', [])).resolves.toBe('delegated')
    expect(saveArchive).toHaveBeenCalledWith('coding.pipiui-pack.zip')
    expect(backend.handle).toHaveBeenCalledWith('listProjects', [])
  })
})
