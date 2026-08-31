// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI } from '@pipi/host-api'

import { ProfilesPane } from './ProfilesPane'
import { createProductWorkbenchRuntime, ProductWorkbenchProvider } from './workbench/workbench-runtime'

describe('ProfilesPane', () => {
  it('switches the current project to an available Product Profile', async () => {
    const setProductProfile = vi.fn(async () => ({ schemaVersion: 2 as const, profile: 'base', overrides: {} }))
    const installLocalProductProfile = vi.fn(async () => ({ schemaVersion: 2 as const, profile: 'base', overrides: {} }))
    const installLocalProductPack = vi.fn(async () => ({ schemaVersion: 2 as const, profile: 'base', overrides: {} }))
    const host = {
      listProductProfiles: vi.fn(async () => [
        { id: 'base', name: '基础版', state: 'available' as const, layout: { primarySidebar: 'pipi.sessions' } },
        { id: 'coding', name: 'Coding 优化版', state: 'available' as const, layout: { primarySidebar: 'coding.sessions' } },
      ]),
      getProductProfile: vi.fn(async () => ({ schemaVersion: 2 as const, profile: 'coding', overrides: {} })),
      setProductProfile,
      pickProjectDirectory: vi.fn(async () => '/tmp/base-profile'),
      installLocalProductProfile,
      installLocalProductPack,
    } as unknown as PipiHostAPI

    const rendered = render(
      <ProductWorkbenchProvider runtime={createProductWorkbenchRuntime()}>
        <ProfilesPane host={host} projectId="pipiui" />
      </ProductWorkbenchProvider>,
    )
    await waitFor(() => expect(rendered.getByTestId('profile-coding').getAttribute('aria-checked')).toBe('true'))
    fireEvent.click(rendered.getByTestId('profile-base'))
    await waitFor(() => expect(setProductProfile).toHaveBeenCalledWith('pipiui', 'base'))
    expect(rendered.getByTestId('profile-base').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(rendered.getByTestId('profile-install-local'))
    await waitFor(() => expect(installLocalProductProfile).toHaveBeenCalledWith('pipiui', '/tmp/base-profile'))
    fireEvent.click(rendered.getByTestId('product-pack-install-local'))
    await waitFor(() => expect(installLocalProductPack).toHaveBeenCalledWith('pipiui', '/tmp/base-profile'))
  })
})
