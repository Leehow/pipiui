import { describe, expect, it } from 'vitest'
import { formatDiagnostic, redactDiagnosticMessage } from './agent-catalog-ui'

describe('agent catalog diagnostic formatting', () => {
  it('formats structured shadowed-name text without path fragments', () => {
    const message = 'Agent `explore` from bundled scope overrides user `explore`; existing scope precedence is preserved.'
    expect(formatDiagnostic({ severity: 'warning', code: 'shadowed-name', message })).toBe(`shadowed-name: ${message}`)
    expect(formatDiagnostic({ severity: 'warning', code: 'shadowed-name', message })).not.toContain('/')
    expect(formatDiagnostic({ severity: 'warning', code: 'shadowed-name', message })).not.toContain('Top Secret')
  })

  it('redacts leftover spaced absolute paths as a second layer', () => {
    const leaked = 'overrides definition at /Users/a/Top Secret/AGENT.md; kept'
    expect(redactDiagnosticMessage(leaked)).toBe('overrides definition at <path>; kept')
    expect(redactDiagnosticMessage(leaked)).not.toContain('Top Secret')
    expect(redactDiagnosticMessage(leaked)).not.toContain('AGENT.md')
    expect(formatDiagnostic({
      severity: 'warning',
      code: 'shadowed-name',
      message: leaked,
    })).toBe('shadowed-name: overrides definition at <path>; kept')
  })
})
