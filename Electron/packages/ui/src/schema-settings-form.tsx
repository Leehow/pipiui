import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ExtensionJsonSchema, PipiHostAPI } from '@pipi/host-api'
import './schema-settings-form.css'

export type SchemaSettingsFormProps = {
  schema?: ExtensionJsonSchema
  values?: Record<string, unknown>
  onChange?: (key: string, value: unknown) => void
  host?: PipiHostAPI
  extensionId?: string
  /** Project-scoped manifests resolve settings against this project. */
  projectId?: string
  disabled?: boolean
}

function resolvedValue(prop: ExtensionJsonSchema, stored: unknown): unknown {
  if (stored !== undefined) return stored
  return prop.default
}

function SchemaField({
  fieldKey,
  prop,
  value,
  disabled,
  onCommit,
  persistentSecret = false,
}: {
  fieldKey: string
  prop: ExtensionJsonSchema
  value: unknown
  disabled?: boolean
  onCommit: (value: unknown) => Promise<boolean>
  persistentSecret?: boolean
}) {
  const title = prop.title ?? fieldKey
  const description = prop.description
  const testId = `ext-schema-field-${fieldKey}`
  const isSecret = prop.format === 'secret'
  const configuredSecret = isSecret && (value === true || (typeof value === 'string' && value.length > 0))
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [secretError, setSecretError] = useState(false)
  const saveSecret = async (next: string | null) => {
    setSaving(true)
    setSecretError(false)
    try {
      if (await onCommit(next)) setDraft('')
      else setSecretError(true)
    } finally {
      setSaving(false)
    }
  }

  let control: ReactNode
  if (isSecret && persistentSecret) {
    control = (
      <>
        <span className="ext-schema-secret-row">
          <input
            className="ext-schema-control"
            type="password"
            aria-label={title}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled || saving}
            data-testid={testId}
            placeholder={configuredSecret ? '输入新密钥以替换' : '粘贴 API key，然后点击保存'}
            value={draft}
            onChange={event => { setDraft(event.target.value); setSecretError(false) }}
            onKeyDown={event => {
              if (event.key === 'Enter' && draft.trim() && !saving) {
                event.preventDefault()
                void saveSecret(draft)
              }
            }}
          />
          <button type="button" className="ext-schema-secret-save" disabled={disabled || saving || !draft.trim()}
            onClick={() => void saveSecret(draft)}>{saving ? '保存中…' : '保存密钥'}</button>
          {configuredSecret && <button type="button" className="ext-schema-secret-clear"
            disabled={disabled || saving} data-testid={`${testId}-clear`}
            onClick={() => void saveSecret(null)}>清除</button>}
        </span>
        <span className={`ext-schema-secret-status${configuredSecret && !draft && !saving && !secretError ? ' is-saved' : ''}`}
          role="status" aria-live="polite" aria-atomic="true">
          {saving ? '保存中…'
            : secretError ? '保存失败，请重试。'
            : draft ? '尚未保存，请点击“保存密钥”。'
            : configuredSecret ? '✓ 已保存，重启后自动恢复。'
            : '未配置密钥'}
          {secretError && <button type="button" className="ext-schema-secret-clear" aria-label="关闭保存失败提示"
            onClick={() => setSecretError(false)}>×</button>}
        </span>
      </>
    )
  } else if (isSecret) {
    control = (
      <span className="ext-schema-secret-row">
        <input
          className="ext-schema-control"
          type="password"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          data-testid={testId}
          placeholder={configuredSecret ? '已配置（输入新密钥以替换）' : ''}
          defaultValue=""
          onChange={event => onCommit(event.target.value)}
        />
        {configuredSecret && !disabled && (
          <button
            type="button"
            className="ext-schema-secret-clear"
            data-testid={`${testId}-clear`}
            onClick={() => onCommit(null)}
          >清除</button>
        )}
      </span>
    )
  } else if (prop.enum && prop.enum.length > 0) {
    const current = value == null ? '' : String(value)
    control = (
      <select
        className="ext-schema-control"
        disabled={disabled}
        data-testid={testId}
        value={current}
        onChange={event => {
          const matched = prop.enum!.find(item => String(item) === event.target.value)
          onCommit(matched)
        }}
      >
        {prop.enum.map(item => (
          <option key={String(item)} value={String(item)}>{String(item)}</option>
        ))}
      </select>
    )
  } else if (prop.type === 'boolean') {
    control = (
      <label className="ext-schema-check">
        <input
          type="checkbox"
          disabled={disabled}
          data-testid={testId}
          checked={Boolean(value)}
          onChange={event => onCommit(event.target.checked)}
        />
        <span>{title}</span>
      </label>
    )
  } else if (prop.type === 'number' || prop.type === 'integer') {
    control = (
      <input
        className="ext-schema-control"
        type="number"
        step={prop.type === 'integer' ? 1 : 'any'}
        disabled={disabled}
        data-testid={testId}
        value={value == null || value === '' ? '' : String(value)}
        onChange={event => {
          const raw = event.target.value
          if (raw === '') {
            onCommit(undefined)
            return
          }
          onCommit(prop.type === 'integer' ? Number.parseInt(raw, 10) : Number(raw))
        }}
      />
    )
  } else {
    control = (
      <input
        className="ext-schema-control"
        type="text"
        disabled={disabled}
        data-testid={testId}
        value={value == null ? '' : String(value)}
        onChange={event => onCommit(event.target.value)}
      />
    )
  }

  return (
    <div className="ext-schema-field">
      {prop.type === 'boolean' ? null : <span className="ext-schema-label">{title}</span>}
      {description ? <span className="ext-schema-help">{description}</span> : null}
      {control}
    </div>
  )
}

export function SchemaSettingsForm({
  schema,
  values: valuesProp,
  onChange,
  host,
  extensionId,
  projectId,
  disabled,
}: SchemaSettingsFormProps) {
  const [loaded, setLoaded] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)
  const controlled = valuesProp !== undefined

  const fetchSettings = () => {
    if (!host?.getExtensionSettings || !extensionId) return undefined
    return projectId === undefined
      ? host.getExtensionSettings(extensionId)
      : host.getExtensionSettings(extensionId, projectId)
  }

  useEffect(() => {
    if (controlled || !host?.getExtensionSettings || !extensionId) return
    let cancelled = false
    void fetchSettings()?.then((next: Record<string, unknown>) => {
      if (!cancelled) {
        setLoaded(next ?? {})
        setError(null)
      }
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err))
    })
    return () => { cancelled = true }
  }, [controlled, host, extensionId, projectId])

  const values = controlled ? valuesProp : loaded
  const properties = schema?.properties ?? {}
  const entries = useMemo(() => Object.entries(properties), [properties])

  const commit = async (key: string, value: unknown): Promise<boolean> => {
    const persistentSecret = extensionId === 'jev-optimizer' && key === 'ext.jev-optimizer.apiKey'
    onChange?.(key, value)
    if (!controlled && !persistentSecret) setLoaded(prev => ({ ...prev, [key]: value }))
    const { updateExtensionSettings } = host ?? {}
    if (updateExtensionSettings && extensionId) {
      if (persistentSecret) setError(null)
      const save = () => (projectId === undefined
        ? updateExtensionSettings(extensionId, { [key]: value })
        : updateExtensionSettings(extensionId, { [key]: value }, projectId))
      try {
        const result = await save()
        // A resolved {ok:false} denial must not leave the optimistic local value behind.
        if (result && result.ok === false) {
          setError(result.error?.message || '设置保存失败')
          if (!controlled && extensionId && !persistentSecret) {
            void fetchSettings()
              ?.then((next: Record<string, unknown>) => setLoaded(next ?? {}))
              .catch(() => undefined)
          }
          return false
        } else if (persistentSecret && result?.ok !== true) {
          setError('未收到保存确认，请重试')
          return false
        } else {
          setError(null)
          if (!controlled && persistentSecret) setLoaded(prev => ({ ...prev, [key]: value !== null }))
          return true
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err))
        return false
      }
    }
    if (persistentSecret) { setError('保存服务不可用，请稍后重试'); return false }
    return true
  }

  return (
    <div className="ext-schema-form" data-testid="ext-schema-form">
      {schema?.title ? <div className="ext-schema-heading">{schema.title}</div> : null}
      {schema?.description ? <p className="ext-schema-lede">{schema.description}</p> : null}
      {error ? <p className="ext-schema-error" role="alert">{error} <button type="button"
        className="ext-schema-secret-clear" aria-label="关闭设置错误" onClick={() => setError(null)}>×</button></p> : null}
      {entries.length === 0
        ? <p className="ext-schema-empty">暂无设置项</p>
        : entries.map(([key, prop]) => (
          <SchemaField
            key={`${extensionId ?? ''}:${projectId ?? ''}:${key}`}
            fieldKey={key}
            prop={prop}
            value={resolvedValue(prop, values[key])}
            disabled={disabled}
            persistentSecret={extensionId === 'jev-optimizer' && key === 'ext.jev-optimizer.apiKey'}
            onCommit={value => commit(key, value)}
          />
        ))}
    </div>
  )
}
