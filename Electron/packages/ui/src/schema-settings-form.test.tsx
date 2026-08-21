// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionJsonSchema, PipiHostAPI } from '@pipi/host-api'
import { SchemaSettingsForm } from './schema-settings-form'

afterEach(cleanup)

const schema: ExtensionJsonSchema = {
  type: 'object',
  title: '用量监控',
  description: '告警与凭证',
  properties: {
    'ext.quota.threshold': { type: 'number', title: '告警阈值（%）', description: '超过后告警', default: 80 },
    'ext.quota.label': { type: 'string', title: '显示名', description: '面板标题' },
    'ext.quota.enabled': { type: 'boolean', title: '启用告警', default: true },
    'ext.quota.channel': { type: 'string', title: '通道', enum: ['email', 'webhook'] },
    'ext.quota.apiKey': { type: 'string', format: 'secret', title: '可选 API Key' },
  },
}

describe('SchemaSettingsForm', () => {
  it('renders string, number, boolean, and enum from schema titles', () => {
    const onChange = vi.fn()
    render(
      <SchemaSettingsForm
        schema={schema}
        values={{ 'ext.quota.label': 'Quota', 'ext.quota.channel': 'email' }}
        onChange={onChange}
      />,
    )
    expect(screen.getByText('用量监控')).toBeTruthy()
    expect(screen.getByText('告警与凭证')).toBeTruthy()
    expect(screen.getByText('告警阈值（%）')).toBeTruthy()
    expect(screen.getByText('超过后告警')).toBeTruthy()

    const number = screen.getByTestId('ext-schema-field-ext.quota.threshold') as HTMLInputElement
    expect(number.type).toBe('number')
    expect(number.value).toBe('80')
    fireEvent.change(number, { target: { value: '92' } })
    expect(onChange).toHaveBeenCalledWith('ext.quota.threshold', 92)

    const text = screen.getByTestId('ext-schema-field-ext.quota.label') as HTMLInputElement
    expect(text.type).toBe('text')
    fireEvent.change(text, { target: { value: '用量' } })
    expect(onChange).toHaveBeenCalledWith('ext.quota.label', '用量')

    const checkbox = screen.getByTestId('ext-schema-field-ext.quota.enabled') as HTMLInputElement
    expect(checkbox.type).toBe('checkbox')
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith('ext.quota.enabled', false)

    const select = screen.getByTestId('ext-schema-field-ext.quota.channel') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'webhook' } })
    expect(onChange).toHaveBeenCalledWith('ext.quota.channel', 'webhook')
  })

  it('shows format:secret as a password input and writes through updateExtensionSettings only', async () => {
    const updateExtensionSettings = vi.fn(async () => ({ ok: true as const, data: {} }))
    const listSecretVault = vi.fn()
    const host = {
      getExtensionSettings: vi.fn(async () => ({ 'ext.quota.apiKey': true })),
      updateExtensionSettings,
      listSecretVault,
    } as unknown as PipiHostAPI

    render(<SchemaSettingsForm schema={schema} host={host} extensionId="quota" />)
    const secret = await screen.findByTestId('ext-schema-field-ext.quota.apiKey') as HTMLInputElement
    expect(secret.type).toBe('password')
    await waitFor(() => expect(secret.placeholder).toContain('已配置'))
    fireEvent.change(secret, { target: { value: 'sk-new' } })
    await waitFor(() => expect(updateExtensionSettings).toHaveBeenCalledWith('quota', { 'ext.quota.apiKey': 'sk-new' }))
    expect(listSecretVault).not.toHaveBeenCalled()
  })
})
