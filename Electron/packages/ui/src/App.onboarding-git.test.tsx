// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitStatus, PipiHostAPI, Project } from '@pipi/host-api'
import { App, createMockHost } from './App'

const NOT_A_REPO: GitStatus = { isRepo: false, isDetached: false, localBranches: [], ahead: 0, behind: 0, isDirty: false, staged: 0, unstaged: 0, untracked: 0 }
const A_REPO: GitStatus = { ...NOT_A_REPO, isRepo: true, currentBranch: 'main' }

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

/** Minimal host around the project flows: one durable project list + picker. */
function projectHost(overrides: Partial<PipiHostAPI>): PipiHostAPI {
  let durable: Project[] = [{ id: 'existing', name: 'existing', path: '/Users/demo/existing' }]
  const listProjects = vi.fn(async () => durable.map(project => ({ ...project })))
  const getProjectPaths = vi.fn(async () => durable.map(project => project.path))
  const addProject = vi.fn(async (path: string) => {
    const project = { id: path.split('/').pop() ?? path, name: path.split('/').pop() ?? path, path }
    durable = [...durable, project]
    return project
  })
  return { ...createMockHost(), listProjects, getProjectPaths, addProject, ...overrides }
}

describe('add-project silent git setup', () => {
  it('silently inits a non-git folder and adds it without asking the user anything', async () => {
    const gitInitDirectory = vi.fn(async () => A_REPO)
    const probeDirectoryGit = vi.fn(async () => NOT_A_REPO)
    const host: PipiHostAPI = { ...projectHost({ probeDirectoryGit, gitInitDirectory }), pickProjectDirectory: vi.fn(async () => '/Users/demo/plain') }
    render(<App host={host} />)
    await screen.findByText('existing')

    fireEvent.click(screen.getByRole('button', { name: '添加项目' }))
    await waitFor(() => expect(gitInitDirectory).toHaveBeenCalledWith('/Users/demo/plain'))
    await waitFor(() => expect(host.addProject).toHaveBeenCalledWith('/Users/demo/plain'))
    expect(await screen.findByText('plain')).toBeTruthy()
    // No decision dialog ever appears — the user picked a folder, PipiUI did the rest.
    expect(document.querySelector('[data-testid="git-init-modal"]')).toBeNull()
  })

  it('still adds the folder when git init itself fails', async () => {
    const gitInitDirectory = vi.fn(async () => { throw new Error('git not installed') })
    const probeDirectoryGit = vi.fn(async () => NOT_A_REPO)
    const host: PipiHostAPI = { ...projectHost({ probeDirectoryGit, gitInitDirectory }), pickProjectDirectory: vi.fn(async () => '/Users/demo/plain') }
    render(<App host={host} />)
    await screen.findByText('existing')

    fireEvent.click(screen.getByRole('button', { name: '添加项目' }))
    await waitFor(() => expect(host.addProject).toHaveBeenCalledWith('/Users/demo/plain'))
    expect(await screen.findByText('plain')).toBeTruthy()
  })

  it('never touches an already-managed folder and ignores a failing probe', async () => {
    const gitHost: PipiHostAPI = { ...projectHost({ probeDirectoryGit: vi.fn(async () => A_REPO), gitInitDirectory: vi.fn(async () => A_REPO) }), pickProjectDirectory: vi.fn(async () => '/Users/demo/repo') }
    const { unmount } = render(<App host={gitHost} />)
    await screen.findByText('existing')
    fireEvent.click(screen.getByRole('button', { name: '添加项目' }))
    await waitFor(() => expect(gitHost.addProject).toHaveBeenCalledWith('/Users/demo/repo'))
    expect(gitHost.gitInitDirectory).not.toHaveBeenCalled()
    unmount()

    const brokenHost: PipiHostAPI = { ...projectHost({ probeDirectoryGit: vi.fn(async () => { throw new Error('git missing') }), gitInitDirectory: vi.fn(async () => A_REPO) }), pickProjectDirectory: vi.fn(async () => '/Users/demo/plain') }
    render(<App host={brokenHost} />)
    await screen.findByText('existing')
    fireEvent.click(screen.getByRole('button', { name: '添加项目' }))
    await waitFor(() => expect(brokenHost.addProject).toHaveBeenCalledWith('/Users/demo/plain'))
    expect(brokenHost.gitInitDirectory).not.toHaveBeenCalled()
  })

  it('keeps the plain legacy flow for hosts without the probe', async () => {
    const host: PipiHostAPI = { ...projectHost({}), pickProjectDirectory: vi.fn(async () => '/Users/demo/plain') }
    render(<App host={host} />)
    await screen.findByText('existing')

    fireEvent.click(screen.getByRole('button', { name: '添加项目' }))
    await waitFor(() => expect(host.addProject).toHaveBeenCalledWith('/Users/demo/plain'))
    expect(await screen.findByText('plain')).toBeTruthy()
  })
})

describe('first-run model onboarding', () => {
  it('opens the model manager into the add-provider pane when no model is configured', async () => {
    const host: PipiHostAPI = { ...createMockHost(), listModels: vi.fn(async () => []) }
    render(<App host={host} />)
    expect(await screen.findByTestId('provider-add')).toBeTruthy()
    expect(screen.queryByTestId('model-add-button')).toBeNull() // add view, not manage view
  })

  it('stays closed when the catalog has models', async () => {
    render(<App host={createMockHost()} />)
    await screen.findByText('Electron 三栏界面')
    await waitFor(() => expect(screen.queryByTestId('model-modal')).toBeNull())
  })

  it('respects an explicit close while still model-less across remounts', async () => {
    const host: PipiHostAPI = { ...createMockHost(), listModels: vi.fn(async () => []) }
    const first = render(<App host={host} />)
    fireEvent.click(await screen.findByLabelText('关闭设置'))
    await waitFor(() => expect(screen.queryByTestId('model-modal')).toBeNull())
    expect(localStorage.getItem('pipiui:model-onboarding-dismissed')).toBe('1')
    first.unmount()

    render(<App host={host} />)
    await screen.findByText('Electron 三栏界面')
    await waitFor(() => expect(screen.queryByTestId('model-modal')).toBeNull())
  })
})
