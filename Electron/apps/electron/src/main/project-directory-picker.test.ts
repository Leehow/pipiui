import { describe, expect, it, vi } from 'vitest'
import type { HostBackend } from '@pipi/host-api'
import { withProjectDirectoryPicker } from './project-directory-picker.js'

describe('withProjectDirectoryPicker', () => {
  it('returns the selected folder and forwards unrelated methods', async () => {
    const backend: HostBackend = { handle: vi.fn(async () => 'forwarded'), subscribe: () => () => undefined }
    const pick = vi.fn(async () => '/Users/demo/project')
    const wrapped = withProjectDirectoryPicker(backend, pick)

    await expect(wrapped.handle('pickProjectDirectory', [])).resolves.toBe('/Users/demo/project')
    expect(pick).toHaveBeenCalledOnce()
    await expect(wrapped.handle('listProjects', [])).resolves.toBe('forwarded')
    expect(backend.handle).toHaveBeenCalledWith('listProjects', [])
  })

  it('preserves cancellation as null', async () => {
    const backend: HostBackend = { handle: vi.fn(), subscribe: () => () => undefined }
    await expect(withProjectDirectoryPicker(backend, async () => null).handle('pickProjectDirectory', [])).resolves.toBeNull()
  })
})
