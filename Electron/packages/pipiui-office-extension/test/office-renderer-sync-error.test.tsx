// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentRendererActions, DocumentRendererProps } from '@pipiui/extension-api'

vi.mock('@file-viewer/react', () => ({
  default: function Boom() {
    throw new Error('sync viewer exploded')
  },
}))
vi.mock('@file-viewer/preset-office', () => ({ default: { id: 'office' } }))
vi.mock('@file-viewer/core', () => ({
  setDefaultFileViewerAssetBaseUrl: () => undefined,
  resetDefaultFileViewerAssetBaseUrl: () => undefined,
  getDefaultFileViewerAssetBaseUrl: () => undefined,
}))

afterEach(cleanup)

describe('OfficeRenderer sync viewer error', () => {
  it('requests generic fallback when FileViewer throws during render', async () => {
    const { default: OfficeRenderer } = await import('../app/src/office-renderer')
    const nextActions: DocumentRendererActions = {
      reload: vi.fn(async () => undefined),
      openExternally: vi.fn(async () => undefined),
      useGenericFallback: vi.fn(async () => undefined),
    }
    const props: DocumentRendererProps = {
      document: {
        documentId: 'doc-1',
        name: 'form.docx',
        extension: '.docx',
        documentKind: 'word',
        size: 4,
        revision: 1,
      },
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      actions: nextActions,
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<OfficeRenderer {...props} />)
    await waitFor(() => expect(nextActions.useGenericFallback).toHaveBeenCalledTimes(1))
    spy.mockRestore()
  })
})
