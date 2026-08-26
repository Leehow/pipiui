import { describe, expect, it } from 'vitest'
import {
  fileViewerType,
  isOfficeKind,
  LEGACY_BEST_EFFORT_EXTENSIONS,
  MACRO_OFFICE_EXTENSIONS,
  MODERN_OFFICE_EXTENSIONS,
  officePreviewTier,
} from '../app/src/office-format-policy'

describe('office format policy', () => {
  it('classifies modern .docx/.xlsx/.pptx as native preview', () => {
    expect(officePreviewTier('.docx')).toBe('modern')
    expect(officePreviewTier('XLSX')).toBe('modern')
    expect(officePreviewTier('.pptx')).toBe('modern')
    expect([...MODERN_OFFICE_EXTENSIONS]).toEqual(['.docx', '.xlsx', '.pptx'])
  })

  it('classifies macro containers as preview/preserve', () => {
    expect(officePreviewTier('.docm')).toBe('macro')
    expect(officePreviewTier('.xlsm')).toBe('macro')
    expect(officePreviewTier('.pptm')).toBe('macro')
    expect([...MACRO_OFFICE_EXTENSIONS]).toEqual(['.docm', '.xlsm', '.pptm'])
  })

  it('classifies legacy .doc/.xls/.ppt and open formats as best-effort', () => {
    expect(officePreviewTier('.doc')).toBe('best-effort')
    expect(officePreviewTier('.xls')).toBe('best-effort')
    expect(officePreviewTier('.ppt')).toBe('best-effort')
    expect(officePreviewTier('.rtf')).toBe('best-effort')
    expect(officePreviewTier('.odt')).toBe('best-effort')
    expect(LEGACY_BEST_EFFORT_EXTENSIONS).toContain('.doc')
    expect(LEGACY_BEST_EFFORT_EXTENSIONS).toContain('.xls')
    expect(LEGACY_BEST_EFFORT_EXTENSIONS).toContain('.ppt')
  })

  it('treats unknown extensions as best-effort and never claims PDF', () => {
    expect(officePreviewTier('.unknown')).toBe('best-effort')
    expect(officePreviewTier('.pdf')).toBe('best-effort')
    expect(isOfficeKind('pdf')).toBe(false)
    expect(isOfficeKind('word')).toBe(true)
  })

  it('strips the leading dot for the FileViewer type', () => {
    expect(fileViewerType('.docx')).toBe('docx')
    expect(fileViewerType('PPTX')).toBe('pptx')
  })
})
