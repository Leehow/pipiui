// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentSetupStep, EmptySetupGuide, GIT_MISSING_DISMISSED_KEY } from './EmptySetupGuide'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('currentSetupStep', () => {
  it('waits while the model catalog is still loading', () => {
    expect(currentSetupStep({ modelsLoading: true, hasModels: false, hasProjects: false })).toBe('checking')
  })

  it('asks for an API key before a project or session', () => {
    expect(currentSetupStep({ modelsLoading: false, hasModels: false, hasProjects: false })).toBe('models')
  })

  it('asks for a project once models exist', () => {
    expect(currentSetupStep({ modelsLoading: false, hasModels: true, hasProjects: false })).toBe('project')
  })

  it('asks for a session when a project exists but none is selected', () => {
    expect(currentSetupStep({ modelsLoading: false, hasModels: true, hasProjects: true })).toBe('session')
  })
})

describe('EmptySetupGuide', () => {
  beforeEach(() => localStorage.clear())

  it('makes 添加 API Key the primary action when no model is configured', () => {
    const onAddApiKey = vi.fn()
    render(<EmptySetupGuide modelsLoading={false} hasModels={false} hasProjects={false} gitInstalled="unknown" onAddApiKey={onAddApiKey} onAddProject={() => undefined} onNewSession={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: '添加 API Key' }))
    expect(onAddApiKey).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '添加项目' })).toBeNull()
  })

  it('makes 添加项目 the primary action once models exist', () => {
    const onAddProject = vi.fn()
    render(<EmptySetupGuide modelsLoading={false} hasModels={true} hasProjects={false} gitInstalled="unknown" onAddApiKey={() => undefined} onAddProject={onAddProject} onNewSession={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: '添加项目' }))
    expect(onAddProject).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '添加 API Key' })).toBeNull()
  })

  it('makes 新建会话 the primary action when a project exists but no session is selected', () => {
    const onNewSession = vi.fn()
    render(<EmptySetupGuide modelsLoading={false} hasModels={true} hasProjects={true} gitInstalled="unknown" onAddApiKey={() => undefined} onAddProject={() => undefined} onNewSession={onNewSession} />)
    fireEvent.click(screen.getByRole('button', { name: '新建会话' }))
    expect(onNewSession).toHaveBeenCalledTimes(1)
  })

  it('shows a checking state instead of the API key button while models load', () => {
    render(<EmptySetupGuide modelsLoading={true} hasModels={false} hasProjects={false} gitInstalled="unknown" onAddApiKey={() => undefined} onAddProject={() => undefined} onNewSession={() => undefined} />)
    expect(screen.getByTestId('empty-setup-checking').textContent).toContain('正在检查模型')
    expect(screen.queryByRole('button', { name: '添加 API Key' })).toBeNull()
  })

  it('shows a dismissible Git tip only when the binary is missing', () => {
    const { rerender } = render(<EmptySetupGuide modelsLoading={false} hasModels={true} hasProjects={false} gitInstalled={false} onAddApiKey={() => undefined} onAddProject={() => undefined} onNewSession={() => undefined} />)
    expect(screen.getByTestId('empty-setup-git').textContent).toContain('安装 Git')
    fireEvent.click(screen.getByRole('button', { name: '关闭 Git 提示' }))
    expect(screen.queryByTestId('empty-setup-git')).toBeNull()
    expect(localStorage.getItem(GIT_MISSING_DISMISSED_KEY)).toBe('1')

    rerender(<EmptySetupGuide modelsLoading={false} hasModels={true} hasProjects={false} gitInstalled={true} onAddApiKey={() => undefined} onAddProject={() => undefined} onNewSession={() => undefined} />)
    expect(screen.queryByTestId('empty-setup-git')).toBeNull()
  })

  it('does not show the Git tip after an explicit dismiss, even if git is still missing', () => {
    localStorage.setItem(GIT_MISSING_DISMISSED_KEY, '1')
    render(<EmptySetupGuide modelsLoading={false} hasModels={true} hasProjects={false} gitInstalled={false} onAddApiKey={() => undefined} onAddProject={() => undefined} onNewSession={() => undefined} />)
    expect(screen.queryByTestId('empty-setup-git')).toBeNull()
  })
})
