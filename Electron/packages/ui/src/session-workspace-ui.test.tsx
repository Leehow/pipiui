// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitStatus, PipiHostAPI } from '@pipi/host-api'
import {
  SessionBranchHeader,
  SessionBranchPair,
  UnmergedAheadBadge,
  shouldShowDualBranch,
  shouldShowUnmergedBadge,
} from './session-workspace-ui'

beforeEach(() => {
  vi.useRealTimers()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const REPO: GitStatus = {
  isRepo: true,
  currentBranch: 'main',
  isDetached: false,
  localBranches: ['main', 'pipiui/session-foo'],
  ahead: 0,
  behind: 0,
  isDirty: false,
  staged: 0,
  unstaged: 0,
  untracked: 0,
}

function gitHost(status: GitStatus): { host: PipiHostAPI; gitStatus: ReturnType<typeof vi.fn> } {
  const gitStatus = vi.fn(async () => status)
  return { host: { protocolVersion: 2, gitStatus } as unknown as PipiHostAPI, gitStatus }
}

describe('shouldShowDualBranch', () => {
  it('is false without a session branch (no workspace)', () => {
    expect(shouldShowDualBranch(undefined, 'main')).toBe(false)
    expect(shouldShowDualBranch('', 'main')).toBe(false)
  })
  it('is false when session and main match', () => {
    expect(shouldShowDualBranch('main', 'main')).toBe(false)
  })
  it('is true when they differ', () => {
    expect(shouldShowDualBranch('pipiui/session-foo', 'main')).toBe(true)
  })
})

describe('SessionBranchPair', () => {
  it('renders nothing without a session branch', () => {
    const { container } = render(<SessionBranchPair mainBranch="main" />)
    expect(container.querySelector('[data-testid="session-branch-pair"]')).toBeNull()
  })
  it('renders nothing when session and main are the same branch', () => {
    const { container } = render(<SessionBranchPair sessionBranch="main" mainBranch="main" />)
    expect(container.querySelector('[data-testid="session-branch-pair"]')).toBeNull()
  })
  it('shows only the session branch when it differs from main (main is the adjacent git control)', () => {
    render(<SessionBranchPair sessionBranch="pipiui/session-foo" mainBranch="main" />)
    const pair = screen.getByTestId('session-branch-pair')
    expect(screen.getByTestId('session-branch-name').textContent).toBe('pipiui/session-foo')
    expect(screen.queryByTestId('main-branch-name')).toBeNull()
    expect(pair.getAttribute('title')).toBe('会话分支：pipiui/session-foo · 主树：main')
  })
})

describe('SessionBranchHeader', () => {
  it('does not probe git when the session has no workspace', async () => {
    const { host, gitStatus } = gitHost(REPO)
    const { container } = render(<SessionBranchHeader host={host} projectId="p1" gitAvailable />)
    expect(gitStatus).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="session-branch-pair"]')).toBeNull()
  })
  it('hides the pair when workspace.branch equals the main-tree branch', async () => {
    const { host, gitStatus } = gitHost(REPO)
    const { container } = render(
      <SessionBranchHeader host={host} projectId="p1" workspace={{ branch: 'main' }} gitAvailable />,
    )
    await waitFor(() => expect(gitStatus).toHaveBeenCalledWith('p1'))
    expect(container.querySelector('[data-testid="session-branch-pair"]')).toBeNull()
  })
  it('shows the session branch when workspace.branch differs from GitStatus.currentBranch', async () => {
    const { host, gitStatus } = gitHost(REPO)
    render(
      <SessionBranchHeader host={host} projectId="p1" workspace={{ branch: 'pipiui/session-foo' }} gitAvailable />,
    )
    await waitFor(() => expect(gitStatus).toHaveBeenCalledWith('p1'))
    expect(screen.getByTestId('session-branch-name').textContent).toBe('pipiui/session-foo')
    expect(screen.queryByTestId('main-branch-name')).toBeNull()
  })
})

describe('shouldShowUnmergedBadge', () => {
  it('shows only when aheadOfMain is a positive count', () => {
    expect(shouldShowUnmergedBadge(3)).toBe(true)
    expect(shouldShowUnmergedBadge(0)).toBe(false)
    expect(shouldShowUnmergedBadge(null)).toBe(false)
    expect(shouldShowUnmergedBadge(undefined)).toBe(false)
  })
})

describe('UnmergedAheadBadge', () => {
  it('renders an icon whose tooltip is the ahead count when aheadOfMain > 0', () => {
    render(<UnmergedAheadBadge aheadOfMain={3} />)
    const badge = screen.getByTestId('session-unmerged-badge')
    expect(badge.getAttribute('title')).toBe('领先 3 个提交')
    expect(badge.querySelector('svg')).toBeTruthy()
  })
  it('renders nothing when aheadOfMain is 0', () => {
    const { container } = render(<UnmergedAheadBadge aheadOfMain={0} />)
    expect(container.querySelector('[data-testid="session-unmerged-badge"]')).toBeNull()
  })
  it('renders nothing when aheadOfMain is null', () => {
    const { container } = render(<UnmergedAheadBadge aheadOfMain={null} />)
    expect(container.querySelector('[data-testid="session-unmerged-badge"]')).toBeNull()
  })
  it('renders nothing when the workspace field is absent', () => {
    const { container } = render(<UnmergedAheadBadge />)
    expect(container.querySelector('[data-testid="session-unmerged-badge"]')).toBeNull()
  })
})
