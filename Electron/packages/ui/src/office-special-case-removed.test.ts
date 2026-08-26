import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = import.meta.dirname

function read(name: string): string {
  return readFileSync(join(srcDir, name), 'utf8')
}

describe('core has no Office UI special-case after T4', () => {
  it('deleted the T3 builtin office compatibility module', () => {
    expect(existsSync(join(srcDir, 'builtin-office-compat.tsx'))).toBe(false)
  })

  it('DocumentSurface no longer imports Office preset, kinds, or compat', () => {
    const source = read('DocumentSurface.tsx')
    expect(source).not.toContain('builtin-office-compat')
    expect(source).not.toContain('@file-viewer/preset-office')
    expect(source).not.toContain('OFFICE_DOCUMENT_KINDS')
    expect(source).not.toContain('isOfficeKind')
    expect(source).not.toContain('officePreset')
    expect(source).toContain('@file-viewer/renderer-pdf')
    expect(source).toContain("document.kind === 'pdf'")
  })

  it('DocumentPanel no longer subscribes to Office viewer errors', () => {
    const source = read('DocumentPanel.tsx')
    expect(source).not.toContain('subscribeOfficeViewerErrors')
    expect(source).not.toContain('builtin-office-compat')
    expect(source).not.toContain('isOfficeKind')
    expect(source).toContain('useGenericFallback')
    expect(source).toContain('convertDocumentToMarkdown')
  })
})
