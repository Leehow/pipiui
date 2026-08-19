import { ProviderLogo } from './ProviderLogo'
import { isKnownBrand, providerBrand } from './provider-logo'
import { sessionSourceLabel, sessionSourceLogo, type SessionSource } from './session-source'

/** Dedicated source mark for mixed Pi / external session rows.
 *  Known brands reuse ProviderLogo vectors; missing artwork falls back to a
 *  stable monogram so the row still identifies the source. */
export function SessionSourceIcon({ source, size = 13 }: { source: SessionSource; size?: number }) {
  const label = sessionSourceLabel(source)
  const logo = sessionSourceLogo(source)
  const brand = providerBrand(logo.provider, logo.modelId)
  const useBrand = isKnownBrand(brand)
  return (
    <span
      className="sb-session-source"
      data-source={source}
      data-testid={`session-source-${source}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {useBrand
        ? <ProviderLogo provider={logo.provider} modelId={logo.modelId} size={size} />
        : (
          <span className="provider-logo" data-brand={source} aria-hidden="true" style={{ width: size, height: size }}>
            <span className="provider-logo-glyph" style={{ fontSize: Math.max(7, Math.round(size * 0.58)) }}>{logo.glyph}</span>
          </span>
        )}
    </span>
  )
}
