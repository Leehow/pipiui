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
  const listSessions = vi.fn(async (projectId: string) => projectId === 'existing'
    ? [{ id: 'existing-session', projectId, name: 'existing 会话', updatedAt: Date.now() }]
    : [])
  const addProject = vi.fn(async (path: string) => {
    const project = { id: path.split('/').pop() ?? path, name: path.split('/').pop() ?? path, path }
    durable = [...durable, project]
    return project
  })
  return { ...createMockHost(), listProjects, getProjectPaths, listSessions, addProject, ...overrides }
}

function emptyHost(overrides: Partial<PipiHostAPI> = {}): PipiHostAPI {
  return {
    ...createMockHost(),
    listProjects: vi.fn(async () => []),
    listSessions: vi.fn(async () => []),
    probeGitBinary: vi.fn(async () => true),
    ...overrides
  }
}

describe('add-project silent git setup', () => {
  it('adds a plain folder without calling gitInitDirectory or showing a modal', async () => {
    const gitInitDirectory = vi.fn(async () => A_REPO)
    const host: PipiHostAPI = { ...projectHost({ gitInitDirectory }), pickProjectDirectory: vi.fn(async () => '/Users/demo/plain') }
    render(<App host={host} />)
    await screen.findByText('existing')

    fireEvent.click(screen.getByRole('button', { name: '添加项目' }))
    await waitFor(() => expect(host.addProject).toHaveBeenCalledWith('/Users/demo/plain'))
    expect(gitInitDirectory).not.toHaveBeenCalled()
    expect(await screen.findByText('plain')).toBeTruthy()
    expect(document.querySelector('[data-testid="git-init-modal"]')).toBeNull()
  })

  it('adds an already-managed folder without calling gitInitDirectory or showing a modal', async () => {
    const gitInitDirectory = vi.fn(async () => A_REPO)
    const gitHost: PipiHostAPI = { ...projectHost({ gitInitDirectory }), pickProjectDirectory: vi.fn(async () => '/Users/demo/repo') }
    render(<App host={gitHost} />)
    await screen.findByText('existing')
    fireEvent.click(screen.getByRole('button', { name: '添加项目' }))
    await waitFor(() => expect(gitHost.addProject).toHaveBeenCalledWith('/Users/demo/repo'))
    expect(gitInitDirectory).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="git-init-modal"]')).toBeNull()
  })

  it('keeps the plain add flow for hosts without gitInitDirectory', async () => {
    const host: PipiHostAPI = { ...projectHost({}), pickProjectDirectory: vi.fn(async () => '/Users/demo/plain') }
    render(<App host={host} />)
    await screen.findByText('existing')

    fireEvent.click(screen.getByRole('button', { name: '添加项目' }))
    await waitFor(() => expect(host.addProject).toHaveBeenCalledWith('/Users/demo/plain'))
    expect(await screen.findByText('plain')).toBeTruthy()
  })
})

describe('empty setup guide', () => {
  it('does not auto-open the model manager, and makes 添加 API Key the empty-page action', async () => {
    render(<App host={emptyHost({ listModels: vi.fn(async () => []) })} />)
    expect(await screen.findByTestId('empty-setup')).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId('model-modal')).toBeNull())
    expect(screen.queryByTestId('chat-composer-stack')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: '添加 API Key' }))
    expect(await screen.findByTestId('provider-add')).toBeTruthy()
  })

  it('asks for a project once models exist, then creates a real session after the first add', async () => {
    let durable: Project[] = []
    const newSession = vi.fn(async (projectId: string, name = '新会话') => ({ id: 'auto-session', projectId, name, updatedAt: Date.now() }))
    const host = emptyHost({
      listProjects: vi.fn(async () => durable.map(project => ({ ...project }))),
      getProjectPaths: vi.fn(async () => durable.map(project => project.path)),
      addProject: vi.fn(async (path: string) => {
        const project = { id: 'first', name: 'first', path }
        durable = [project]
        return project
      }),
      pickProjectDirectory: vi.fn(async () => '/Users/demo/first'),
      newSession
    })
    render(<App host={host} />)
    fireEvent.click(await screen.findByTestId('empty-setup-action'))
    await waitFor(() => expect(host.addProject).toHaveBeenCalledWith('/Users/demo/first'))
    await waitFor(() => expect(newSession).toHaveBeenCalledWith('first'))
    await waitFor(() => expect(screen.queryByTestId('empty-setup')).toBeNull())
    expect(screen.getByTestId('chat-composer-stack')).toBeTruthy()
  })

  it('keeps a populated workspace on the transcript instead of the setup guide', async () => {
    render(<App host={createMockHost()} />)
    // The session title now legitimately appears in both the sidebar row and
    // the chat header, so wait for any of its occurrences as the load sentinel.
    await screen.findAllByText('Electron 三栏界面')
    expect(screen.queryByTestId('empty-setup')).toBeNull()
    await waitFor(() => expect(screen.queryByTestId('model-modal')).toBeNull())
  })

  it('shows the Git tip only when probeGitBinary reports missing', async () => {
    const { unmount } = render(<App host={emptyHost({ probeGitBinary: vi.fn(async () => false) })} />)
    expect((await screen.findByTestId('empty-setup-git')).textContent).toContain('安装 Git')
    unmount()

    render(<App host={emptyHost({ probeGitBinary: vi.fn(async () => { throw new Error('probe failed') }) })} />)
    await screen.findByTestId('empty-setup')
    await waitFor(() => expect(screen.queryByTestId('empty-setup-git')).toBeNull())
  })
})
