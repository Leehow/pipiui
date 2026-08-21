import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ExtensionJsonSchema, PipiHostAPI } from '@pipi/host-api'
import './schema-settings-form.css'

export type SchemaSettingsFormProps = {
  schema?: ExtensionJsonSchema
  values?: Record<string, unknown>
  onChange?: (key: string, value: unknown) => void
  host?: PipiHostAPI
  extensionId?: string
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
}: {
  fieldKey: string
  prop: ExtensionJsonSchema
  value: unknown
  disabled?: boolean
  onCommit: (value: unknown) => void
}) {
  const title = prop.title ?? fieldKey
  const description = prop.description
  const testId = `ext-schema-field-${fieldKey}`
  const isSecret = prop.format === 'secret'
  const configuredSecret = isSecret && (value === true || (typeof value === 'string' && value.length > 0))

  let control: ReactNode
  if (isSecret) {
    control = (
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
  disabled,
}: SchemaSettingsFormProps) {
  const [loaded, setLoaded] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)
  const controlled = valuesProp !== undefined

  useEffect(() => {
    if (controlled || !host?.getExtensionSettings || !extensionId) return
    let cancelled = false
    void host.getExtensionSettings(extensionId).then((next: Record<string, unknown>) => {
      if (!cancelled) {
        setLoaded(next ?? {})
        setError(null)
      }
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err))
    })
    return () => { cancelled = true }
  }, [controlled, host, extensionId])

  const values = controlled ? valuesProp : loaded
  const properties = schema?.properties ?? {}
  const entries = useMemo(() => Object.entries(properties), [properties])

  const commit = (key: string, value: unknown) => {
    onChange?.(key, value)
    if (!controlled) setLoaded(prev => ({ ...prev, [key]: value }))
    if (host?.updateExtensionSettings && extensionId) {
      void host.updateExtensionSettings(extensionId, { [key]: value }).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
    }
  }

  return (
    <div className="ext-schema-form" data-testid="ext-schema-form">
      {schema?.title ? <div className="ext-schema-heading">{schema.title}</div> : null}
      {schema?.description ? <p className="ext-schema-lede">{schema.description}</p> : null}
      {error ? <p className="ext-schema-error" role="alert">{error}</p> : null}
      {entries.length === 0
        ? <p className="ext-schema-empty">暂无设置项</p>
        : entries.map(([key, prop]) => (
          <SchemaField
            key={key}
            fieldKey={key}
            prop={prop}
            value={resolvedValue(prop, values[key])}
            disabled={disabled}
            onCommit={value => commit(key, value)}
          />
        ))}
    </div>
  )
}
