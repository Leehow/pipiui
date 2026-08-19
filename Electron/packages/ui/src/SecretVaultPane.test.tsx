// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SecretVaultPane } from './SecretVaultPane'

describe('SecretVaultPane', () => {
  afterEach(() => cleanup())

  it('saves, mounts, unmounts, deletes, and can close errors without showing plaintext', async () => {
    const secrets = [{ id: '1', name: 'openai', envName: 'OPENAI_API_KEY', createdAt: 't' }]
    const listSecretVault = vi.fn(async () => ({ secrets, mounts: [] as Array<{ secretId: string; envName: string; name: string }>, sessionId: 'sess-1' }))
    const putSecretVault = vi.fn(async () => {
      listSecretVault.mockResolvedValueOnce({ secrets, mounts: [{ secretId: '1', envName: 'OPENAI_API_KEY', name: 'openai' }], sessionId: 'sess-1' })
      return { secret: secrets[0]!, mount: { secretId: '1', envName: 'OPENAI_API_KEY' }, sessionId: 'sess-1' }
    })
    const mountSecretVault = vi.fn(async () => ({ sessionId: 'sess-1', mount: { secretId: '1', envName: 'OPENAI_API_KEY' } }))
    const unmountSecretVault = vi.fn(async () => ({ sessionId: 'sess-1', removed: true }))
    const deleteSecretVault = vi.fn(async () => ({ deleted: true }))
    render(<SecretVaultPane sessionId="sess-1" host={{ listSecretVault, putSecretVault, mountSecretVault, unmountSecretVault, deleteSecretVault }} />)
    await waitFor(() => expect(screen.getByTestId('secret-vault-item-OPENAI_API_KEY').textContent).toContain('openai'))
    fireEvent.change(screen.getByTestId('secret-vault-name'), { target: { value: 'openai' } })
    fireEvent.change(screen.getByTestId('secret-vault-env'), { target: { value: 'OPENAI_API_KEY' } })
    fireEvent.change(screen.getByTestId('secret-vault-value'), { target: { value: 'sk-live-supersecret' } })
    fireEvent.submit(screen.getByTestId('secret-vault-form'))
    await waitFor(() => expect(putSecretVault).toHaveBeenCalledWith({ name: 'openai', envName: 'OPENAI_API_KEY', value: 'sk-live-supersecret', sessionId: 'sess-1' }))
    expect(screen.getByTestId('secret-vault-pane').textContent).not.toContain('sk-live-supersecret')
    listSecretVault.mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(screen.getByTestId('secret-vault-unmount-OPENAI_API_KEY'))
    await waitFor(() => expect(screen.getByTestId('secret-vault-error').textContent).toContain('boom'))
    fireEvent.click(screen.getByTestId('secret-vault-error-close'))
    expect(screen.queryByTestId('secret-vault-error')).toBeNull()
    fireEvent.click(screen.getByTestId('secret-vault-delete-OPENAI_API_KEY'))
    await waitFor(() => expect(deleteSecretVault).toHaveBeenCalledWith('1'))
  })

  it('shows a closable Linux diagnosis with copyable install hint and retry', async () => {
    const diagnoseSecretVault = vi.fn()
      .mockResolvedValueOnce({
        available: false,
        kind: 'missing-packages' as const,
        message: '系统密钥服务不可用。请先安装 gnome-keyring。',
        installHint: 'sudo apt install gnome-keyring libsecret-1-0 libsecret-tools',
        retryable: true,
        platform: 'linux',
      })
      .mockResolvedValueOnce({
        available: true,
        kind: 'available' as const,
        message: '系统密钥服务可用。',
        retryable: true,
        platform: 'linux',
      })
    const listSecretVault = vi.fn(async () => ({ secrets: [], mounts: [], sessionId: 'sess-1' }))
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<SecretVaultPane sessionId="sess-1" host={{
      listSecretVault,
      putSecretVault: vi.fn(),
      mountSecretVault: vi.fn(),
      unmountSecretVault: vi.fn(),
      deleteSecretVault: vi.fn(),
      diagnoseSecretVault,
    }} />)
    await waitFor(() => expect(screen.getByTestId('secret-vault-diagnosis-message').textContent).toContain('gnome-keyring'))
    expect(screen.getByTestId('secret-vault-install-hint').textContent).toContain('sudo apt install')
    expect(screen.getByTestId('secret-vault-save').hasAttribute('disabled')).toBe(true)
    expect(listSecretVault).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('secret-vault-copy-hint'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('sudo apt install gnome-keyring libsecret-1-0 libsecret-tools'))
    fireEvent.click(screen.getByTestId('secret-vault-retry'))
    await waitFor(() => expect(diagnoseSecretVault).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(listSecretVault).toHaveBeenCalled())
    expect(screen.queryByTestId('secret-vault-diagnosis')).toBeNull()
  })

  it('lets the user close a Linux diagnosis without blocking later chat-only use', async () => {
    render(<SecretVaultPane sessionId="sess-1" host={{
      listSecretVault: vi.fn(async () => ({ secrets: [], mounts: [], sessionId: 'sess-1' })),
      putSecretVault: vi.fn(),
      diagnoseSecretVault: vi.fn(async () => ({
        available: false,
        kind: 'no-graphical-session' as const,
        message: '当前没有图形桌面会话。',
        retryable: true,
        platform: 'linux',
      })),
    }} />)
    await waitFor(() => expect(screen.getByTestId('secret-vault-diagnosis')).toBeTruthy())
    fireEvent.click(screen.getByTestId('secret-vault-diagnosis-close'))
    expect(screen.queryByTestId('secret-vault-diagnosis')).toBeNull()
    expect(screen.getByTestId('secret-vault-pane')).toBeTruthy()
  })
})
