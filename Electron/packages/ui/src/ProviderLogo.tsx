import { providerLogoInfo } from './provider-logo'

/** Compact provider logo mark — deterministic, no network images.
 *  Known brands render their real SVG mark (same sources as Swift
 *  GeneratedProviderLogoShapes); unknown providers fall back to a monogram. */
export function ProviderLogo({ provider, modelId, size = 14 }: { provider: string; modelId?: string; size?: number }) {
  const { brand, paths, glyph } = providerLogoInfo(provider, modelId)
  return (
    <span
      className="provider-logo"
      data-brand={brand}
      data-testid={`provider-logo-${brand}`}
      aria-hidden="true"
      style={{ width: size, height: size }}
    >
      {paths && paths.length ? (
        <svg viewBox="0 0 24 24" style={{ width: '78%', height: '78%', display: 'block', margin: '11%' }} fill="currentColor" aria-hidden="true">
          {paths.map((layer, index) => (
            <path key={index} d={layer.d} opacity={layer.opacity} fillRule="evenodd" clipRule="evenodd" />
          ))}
        </svg>
      ) : (
        <span className="provider-logo-glyph" style={{ fontSize: Math.max(7, Math.round(size * 0.58)) }}>{glyph}</span>
      )}
    </span>
  )
}
