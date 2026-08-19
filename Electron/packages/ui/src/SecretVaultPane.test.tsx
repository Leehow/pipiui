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
    expect(screen.getByTestId('secret-vault-help').textContent).toContain('仅当前进程内存')
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

  it('does not show keyring diagnosis or disable save', async () => {
    const listSecretVault = vi.fn(async () => ({ secrets: [], mounts: [], sessionId: 'sess-1' }))
    render(<SecretVaultPane sessionId="sess-1" host={{
      listSecretVault,
      putSecretVault: vi.fn(),
      mountSecretVault: vi.fn(),
      unmountSecretVault: vi.fn(),
      deleteSecretVault: vi.fn(),
    }} />)
    await waitFor(() => expect(listSecretVault).toHaveBeenCalled())
    expect(screen.queryByTestId('secret-vault-diagnosis')).toBeNull()
    expect(screen.queryByTestId('secret-vault-retry')).toBeNull()
    expect(screen.getByTestId('secret-vault-save').hasAttribute('disabled')).toBe(false)
  })
})
