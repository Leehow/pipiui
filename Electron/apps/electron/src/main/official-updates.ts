import type { UpdateCenterItem } from '@pipi/host-api'
import type { AppUpdater } from 'electron-updater'
import { compareSemver, parseSemver } from './update-center.js'

export const OFFICIAL_DOWNLOADS = 'https://pipi.aichattrpg.com/downloads/'
export type InstalledExtension = { id: string; name: string; version: string }
type DesktopUpdater = Pick<AppUpdater, 'checkForUpdates' | 'downloadUpdate'> & {
  quitAndInstall(silent: boolean, relaunch: boolean): void | Promise<void>
}

export function createOfficialUpdates(options: {
  currentVersion: string
  desktop?: () => DesktopUpdater | Promise<DesktopUpdater>
  extensions: () => Promise<InstalledExtension[]>
  installExtension: (id: string, version: string) => Promise<void>
  fetch: (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>
}) {
  let initializing: Promise<DesktopUpdater> | undefined
  let native: DesktopUpdater | undefined
  let downloaded: string | undefined
  let busy = false
  const desktopRow = { id: 'pipiui', name: 'PipiUI', category: 'platform', currentVersion: options.currentVersion, officialUpdate: 'desktop', sourceLabel: '官网稳定版' } as const
  const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)

  async function checkDesktop(): Promise<UpdateCenterItem> {
    if (!options.desktop) return { ...desktopRow, status: 'notCheckable', error: '当前安装方式不支持应用内更新' }
    if (downloaded) return { ...desktopRow, latestVersion: downloaded, status: 'updateAvailable', downloaded: true }
    initializing ??= Promise.resolve(options.desktop()).catch(error => {
      initializing = undefined
      throw error
    })
    native = await initializing
    const release = await native.checkForUpdates()
    if (!release) throw new Error('无法检查当前安装包的更新')
    const { version, files } = release.updateInfo
    if (!parseSemver(version) || !files?.length || files.some(file =>
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file.url) || !Number.isSafeInteger(file.size) || (file.size ?? 0) <= 0 || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512))) {
      throw new Error('官网安装包清单无效')
    }
    return { ...desktopRow, latestVersion: version, status: release.isUpdateAvailable ? 'updateAvailable' : 'upToDate' }
  }

  async function extensionRows(): Promise<UpdateCenterItem[]> {
    const response = await options.fetch(OFFICIAL_DOWNLOADS + 'pipiui-extensions.json', { signal: AbortSignal.timeout(8000), redirect: 'error' })
    if (!response.ok) throw new Error('官网插件目录返回 HTTP ' + response.status)
    const catalog = await response.json()
    if (catalog?.schemaVersion !== 1 || !catalog.versions || typeof catalog.versions !== 'object' || Array.isArray(catalog.versions)) {
      throw new Error('官网插件目录格式无效')
    }
    return (await options.extensions()).flatMap(ext => {
      if (!Object.hasOwn(catalog.versions, ext.id)) return []
      const latest = catalog.versions[ext.id]
      if (typeof latest !== 'string' || !parseSemver(latest)) throw new Error('官网插件版本无效')
      const order = compareSemver(latest, ext.version)
      return [{ id: 'official:' + ext.id, name: ext.name, category: 'extension', currentVersion: ext.version,
        latestVersion: latest, ownerExtensionId: ext.id, officialUpdate: 'extension', sourceLabel: '官网插件',
        status: order === undefined ? 'notCheckable' : order > 0 ? 'updateAvailable' : 'upToDate' }]
    })
  }

  return {
    async check(): Promise<UpdateCenterItem[]> {
      const [app, extensions] = await Promise.all([
        checkDesktop().catch(error => ({ ...desktopRow, status: 'checkFailed' as const, error: message(error) })),
        extensionRows().catch(error => [{ id: 'official-extensions', name: '官网插件目录', category: 'extension' as const, currentVersion: '—', status: 'checkFailed' as const, error: message(error) }]),
      ])
      return [app, ...extensions]
    },
    async apply(action: unknown, id: unknown, version: unknown) {
      if (busy) throw new Error('更新正在进行')
      if (typeof version !== 'string' || !parseSemver(version)) throw new Error('无效更新版本')
      busy = true
      try {
        if (action === 'extension') {
          const row = (await extensionRows()).find(item => item.ownerExtensionId === id)
          if (row?.status !== 'updateAvailable' || row.latestVersion !== version) throw new Error('插件版本已变化，请刷新')
          await options.installExtension(row.ownerExtensionId!, version)
        } else if (action === 'download' && id === desktopRow.id) {
          const row = await checkDesktop()
          if (row.status !== 'updateAvailable' || row.latestVersion !== version || !native) throw new Error('软件版本已变化，请刷新')
          if (!downloaded) await native.downloadUpdate()
          downloaded = version
        } else if (action === 'restart' && id === desktopRow.id && downloaded === version && native) {
          await native.quitAndInstall(true, true)
        } else throw new Error('没有可安装的更新')
      } finally { busy = false }
    },
  }
}
