// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GitStatus, PipiHostAPI } from '@pipi/host-api'
import { GitBranchMenu, GIT_FOCUS_REFRESH_MS, branchHelpText, orderedBranches, toolbarTitle } from './GitBranchMenu'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const repo: GitStatus = { isRepo: true, currentBranch: 'pipiui/tunnel-reconnect', isDetached: false, shortSHA: '408cf26', localBranches: ['main', 'pipiui/tunnel-reconnect', 'Feature'], upstream: 'origin/main', ahead: 2, behind: 1, isDirty: true, staged: 1, unstaged: 3, untracked: 2, githubURL: 'https://github.com/demo/pipiui' }
const clean: GitStatus = { isRepo: false, isDetached: false, localBranches: [], ahead: 0, behind: 0, isDirty: false, staged: 0, unstaged: 0, untracked: 0 }

function host(overrides: Partial<PipiHostAPI> = {}): PipiHostAPI {
  return { gitStatus: vi.fn(async () => repo), gitCheckout: vi.fn(async (_id: string, branch: string) => ({ ...repo, currentBranch: branch, isDirty: false })), openExternal: vi.fn(async () => undefined), ...overrides } as unknown as PipiHostAPI
}

describe('git toolbar formatting', () => {
  it('marks a dirty tree and truncates like the Swift toolbar', () => {
    expect(toolbarTitle(repo)).toBe('pipiui/tunnel-reconnect*')
    expect(toolbarTitle({ ...repo, currentBranch: 'a'.repeat(40), isDirty: false })).toBe('a'.repeat(24))
    expect(toolbarTitle({ ...repo, isDetached: true, isDirty: false })).toBe('detached @ 408cf26')
  })
  it('describes dirt and upstream in the tooltip', () => {
    expect(branchHelpText(repo)).toBe('Git 分支：pipiui/tunnel-reconnect*（staged=1 unstaged=3 untracked=2） · upstream origin/main +2 -1')
  })
  it('lists the current branch first, then a case-insensitive sort', () => {
    expect(orderedBranches(repo)).toEqual(['pipiui/tunnel-reconnect', 'Feature', 'main'])
  })
})

describe('GitBranchMenu', () => {
  it('renders nothing when the project is not a work tree', async () => {
    render(<GitBranchMenu host={host({ gitStatus: vi.fn(async () => clean) })} projectId="p1" available />)
    await waitFor(() => expect(screen.queryByTestId('git-branch-button')).toBeNull())
  })
  it('renders nothing when the host does not advertise git', () => {
    const gitStatus = vi.fn(async () => repo)
    render(<GitBranchMenu host={host({ gitStatus })} projectId="p1" available={false} />)
    expect(gitStatus).not.toHaveBeenCalled()
    expect(screen.queryByTestId('git-branch-button')).toBeNull()
  })
  it('shows the branch and checks out another one', async () => {
    const api = host()
    render(<GitBranchMenu host={api} projectId="p1" available />)
    const button = await screen.findByTestId('git-branch-button')
    expect(button.textContent).toContain('pipiui/tunnel-reconnect*')
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('menuitem', { name: 'main' }))
    await waitFor(() => expect(screen.getByTestId('git-branch-button').textContent).toContain('main'))
    expect(api.gitCheckout).toHaveBeenCalledWith('p1', 'main')
    expect(screen.queryByTestId('git-branch-menu')).toBeNull()
  })
  it('keeps the branch and reports a failed checkout', async () => {
    const api = host({ gitCheckout: vi.fn(async () => { throw new Error('local changes would be overwritten') }) })
    render(<GitBranchMenu host={api} projectId="p1" available />)
    fireEvent.click(await screen.findByTestId('git-branch-button'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'main' }))
    await waitFor(() => expect(screen.getByTestId('git-branch-error').textContent).toContain('local changes would be overwritten'))
    expect(screen.getByTestId('git-branch-button').textContent).toContain('pipiui/tunnel-reconnect*')
  })
  it('opens the GitHub remote through the host', async () => {
    const api = host()
    render(<GitBranchMenu host={api} projectId="p1" available />)
    fireEvent.click(await screen.findByTestId('git-branch-button'))
    fireEvent.click(screen.getByRole('menuitem', { name: '在 GitHub 打开' }))
    expect(api.openExternal).toHaveBeenCalledWith('https://github.com/demo/pipiui')
  })
  it('re-probes when the window regains focus', async () => {
    const api = host()
    render(<GitBranchMenu host={api} projectId="p1" available />)
    await screen.findByTestId('git-branch-button')
    vi.useFakeTimers()
    fireEvent.focus(window)
    // The same click that focuses a background window often starts a title-bar
    // drag. Do not spawn git(1) on that frame.
    expect(api.gitStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(GIT_FOCUS_REFRESH_MS - 1)
    expect(api.gitStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(api.gitStatus).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
