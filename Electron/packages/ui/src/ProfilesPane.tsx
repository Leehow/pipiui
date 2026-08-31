import { useEffect, useState } from 'react'
import type { PipiHostAPI, ProductProfileDescriptor, ProjectProductActivation } from '@pipi/host-api'

import { useProductWorkbenchRuntime } from './workbench/workbench-runtime'

export function ProfilesPane({ host, projectId }: { host: PipiHostAPI; projectId?: string }) {
  const productWorkbench = useProductWorkbenchRuntime()
  const [profiles, setProfiles] = useState<ProductProfileDescriptor[]>([])
  const [activation, setActivation] = useState<ProjectProductActivation | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    if (!projectId || !host.listProductProfiles || !host.getProductProfile) return
    try {
      const [nextProfiles, nextActivation] = await Promise.all([
        host.listProductProfiles(projectId),
        host.getProductProfile(projectId),
      ])
      setProfiles(nextProfiles)
      setActivation(nextActivation)
      const active = nextProfiles.find(profile => profile.id === nextActivation.profile && profile.state === 'available')
      if (active) productWorkbench.activateProductWorkbenchProfile(active, nextActivation)
      setError(null)
    } catch (cause) {
      setError(`加载产品 Profile 失败：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  useEffect(() => { void refresh() }, [host, projectId])

  const select = async (profile: ProductProfileDescriptor) => {
    if (!projectId || !host.setProductProfile || profile.state !== 'available') return
    setBusy(profile.id)
    try {
      const next = await host.setProductProfile(projectId, profile.id)
      setActivation(next)
      productWorkbench.activateProductWorkbenchProfile(profile, next)
      setError(null)
    } catch (cause) {
      setError(`切换产品 Profile 失败：${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setBusy(null)
    }
  }

  const install = async () => {
    if (!projectId || !host.pickProjectDirectory || !host.installLocalProductProfile) return
    const source = await host.pickProjectDirectory()
    if (!source) return
    setBusy('install')
    try {
      await host.installLocalProductProfile(projectId, source)
      await refresh()
    } catch (cause) {
      setError(`安装 Product Profile 失败：${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setBusy(null)
    }
  }

  const installPack = async () => {
    if (!projectId || !host.pickProjectDirectory || !host.installLocalProductPack) return
    const source = await host.pickProjectDirectory()
    if (!source) return
    setBusy('install-pack')
    try {
      await host.installLocalProductPack(projectId, source)
      await refresh()
    } catch (cause) {
      setError(`安装 Product Pack 失败：${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setBusy(null)
    }
  }

  if (!projectId) return <div className="model-modal-state">先选择一个项目，再设置 Product Profile。</div>
  if (!host.listProductProfiles || !host.getProductProfile || !host.setProductProfile) {
    return <div className="model-modal-state">当前连接不支持 Product Profiles。</div>
  }
  return <div className="extensions-list" data-testid="profiles-pane">
    {host.pickProjectDirectory && host.installLocalProductPack && <button type="button" className="model-modal-add" data-testid="product-pack-install-local" disabled={busy !== null} onClick={() => void installPack()}>＋ 安装本地 Product Pack</button>}
    {host.pickProjectDirectory && host.installLocalProductProfile && <button type="button" className="model-modal-add" data-testid="profile-install-local" disabled={busy !== null} onClick={() => void install()}>＋ 导入本地 Profile</button>}
    {error && <div className="model-modal-error" role="alert"><span>{error}</span><button aria-label="关闭 Profile 错误" onClick={() => setError(null)}>×</button></div>}
    {profiles.map(profile => {
      const selected = activation?.profile === profile.id
      const unavailable = profile.state !== 'available'
      return <button
        key={profile.id}
        type="button"
        role="radio"
        aria-checked={selected}
        data-testid={`profile-${profile.id}`}
        className={`extensions-pkg-row${selected ? ' active' : ''}`}
        disabled={unavailable || busy !== null}
        onClick={() => void select(profile)}
      >
        <span className="update-center-name"><strong>{profile.name}</strong><span>{profile.id}{selected ? ' · 当前' : ''}</span></span>
        {profile.description && <span className="extensions-pkg-desc">{profile.description}</span>}
        {profile.error && <span className="model-modal-error">{profile.error}</span>}
      </button>
    })}
  </div>
}
