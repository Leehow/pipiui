import { describe, expect, it, vi } from 'vitest'
import { createOfficialUpdates } from './official-updates.js'

function fixture() {
  const quitAndInstall = vi.fn()
  const downloadUpdate = vi.fn(async () => ['/tmp/official-installer'])
  const checkForUpdates = vi.fn(async () => ({
    isUpdateAvailable: true, updateInfo: { version: '1.0.1', files: [{ url: 'official-1.0.1.zip', sha512: Buffer.alloc(64).toString('base64'), size: 100 }] },
  }))
  let pluginVersion = '0.1.0'
  const installExtension = vi.fn(async (_id: string, version: string) => { pluginVersion = version })
  const service = createOfficialUpdates({
    currentVersion: '1.0.0', desktop: () => ({ checkForUpdates, downloadUpdate, quitAndInstall } as any),
    extensions: async () => [{ id: 'flapcode', name: 'Flapcode', version: pluginVersion }],
    installExtension,
    fetch: async () => Response.json({ schemaVersion: 1, versions: { flapcode: '0.1.1' } }),
  })
  return { service, quitAndInstall, downloadUpdate, installExtension }
}

describe('official update actions', () => {
  it('discovers both updates without downloading, and restarts only for the downloaded version', async () => {
    const { service, downloadUpdate, quitAndInstall } = fixture()
    expect((await service.check()).map(item => item.status)).toEqual(['updateAvailable', 'updateAvailable'])
    expect(downloadUpdate).not.toHaveBeenCalled()
    await expect(service.apply('restart', 'pipiui', '1.0.1')).rejects.toThrow()
    await service.apply('download', 'pipiui', '1.0.1')
    expect(downloadUpdate).toHaveBeenCalledTimes(1)
    expect((await service.check())[0].downloaded).toBe(true)
    await expect(service.apply('restart', 'pipiui', '1.0.2')).rejects.toThrow()
    expect(quitAndInstall).not.toHaveBeenCalled()
    await service.apply('restart', 'pipiui', '1.0.1')
    expect(quitAndInstall).toHaveBeenCalledWith(true, true)
  })
  it('rechecks official extension ID and version, independently of App installation', async () => {
    const { service, downloadUpdate, installExtension } = fixture()
    await expect(service.apply('extension', 'flapcode', '0.2.0')).rejects.toThrow()
    await service.apply('extension', 'flapcode', '0.1.1')
    expect(installExtension).toHaveBeenCalledWith('flapcode', '0.1.1')
    expect((await service.check())[1]).toMatchObject({ currentVersion: '0.1.1', status: 'upToDate' })
    expect(downloadUpdate).not.toHaveBeenCalled()
  })
  it('does not permit installation after a failed download', async () => {
    const { service, downloadUpdate, quitAndInstall } = fixture()
    downloadUpdate.mockRejectedValueOnce(new Error('interrupted'))
    await expect(service.apply('download', 'pipiui', '1.0.1')).rejects.toThrow('interrupted')
    await expect(service.apply('restart', 'pipiui', '1.0.1')).rejects.toThrow()
    expect(quitAndInstall).not.toHaveBeenCalled()
  })
})
