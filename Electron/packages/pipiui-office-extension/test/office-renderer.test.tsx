// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentRendererActions, DocumentRendererProps } from '@pipiui/extension-api'
import OfficeRenderer from '../app/src/office-renderer'

vi.mock('@file-viewer/react', async () => {
  const React = await import('react')
  type ViewerStateSink = (state: { error?: unknown }) => void
  const sinksByName = new Map<string, Set<ViewerStateSink>>()
  const MockViewer = ({
    buffer, name, type, className, onStateChange,
  }: {
    buffer: ArrayBuffer
    name: string
    type: string
    className?: string
    onStateChange?: ViewerStateSink
  }) => {
    React.useEffect(() => {
      if (!onStateChange) return
      let sinks = sinksByName.get(name)
      if (!sinks) {
        sinks = new Set()
        sinksByName.set(name, sinks)
      }
      sinks.add(onStateChange)
      return () => { sinks!.delete(onStateChange) }
    }, [name, onStateChange])
    return <div className={className} data-testid="office-viewer" data-name={name} data-type={type} data-size={buffer.byteLength} />
  }
  return {
    default: MockViewer,
    __emitViewerState: (state: { error?: unknown }) => {
      for (const sinks of sinksByName.values()) for (const sink of sinks) sink(state)
    },
    __emitViewerStateFor: (name: string, state: { error?: unknown }) => {
      for (const sink of sinksByName.get(name) ?? []) sink(state)
    },
  }
})
vi.mock('@file-viewer/preset-office', () => ({ default: { id: 'office' } }))
const assetBase = vi.hoisted(() => {
  let current: string | undefined
  return {
    set: (url?: string | URL | null) => { current = url == null || url === '' ? undefined : String(url) },
    reset: () => { current = undefined },
    get: () => current,
  }
})
vi.mock('@file-viewer/core', () => ({
  setDefaultFileViewerAssetBaseUrl: (url?: string | URL | null) => assetBase.set(url),
  resetDefaultFileViewerAssetBaseUrl: () => assetBase.reset(),
  getDefaultFileViewerAssetBaseUrl: () => assetBase.get(),
}))

function actions(overrides: Partial<DocumentRendererActions> = {}): DocumentRendererActions {
  return {
    reload: vi.fn(async () => undefined),
    openExternally: vi.fn(async () => undefined),
    useGenericFallback: vi.fn(async () => undefined),
    ...overrides,
  }
}

function props(partial: Partial<DocumentRendererProps> & { document?: Partial<DocumentRendererProps['document']> } = {}): DocumentRendererProps {
  const { document: documentPartial, ...rest } = partial
  return {
    document: {
      documentId: 'doc-1',
      name: 'form.docx',
      extension: '.docx',
      documentKind: 'word',
      size: 4,
      revision: 1,
      ...documentPartial,
    },
    bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    actions: actions(),
    ...rest,
  }
}

afterEach(cleanup)

describe('OfficeRenderer modern preview', () => {
  it.each([
    { name: '报告.docx', extension: '.docx', kind: 'word', type: 'docx', tier: 'modern' },
    { name: '台账.xlsx', extension: '.xlsx', kind: 'spreadsheet', type: 'xlsx', tier: 'modern' },
    { name: 'deck.pptx', extension: '.pptx', kind: 'presentation', type: 'pptx', tier: 'modern' },
  ])('previews $extension natively', ({ name, extension, kind, type, tier }) => {
    const rendered = props({
      document: { name, extension, documentKind: kind, size: 4 },
    })
    render(<OfficeRenderer {...rendered} />)
    const host = screen.getByTestId('office-renderer')
    expect(host.getAttribute('data-preview-tier')).toBe(tier)
    expect(host.getAttribute('data-extension')).toBe(extension)
    const viewer = screen.getByTestId('office-viewer')
    expect(viewer.getAttribute('data-name')).toBe(name)
    expect(viewer.getAttribute('data-type')).toBe(type)
    expect(viewer.getAttribute('data-size')).toBe('4')
    expect(JSON.stringify(rendered)).not.toMatch(/\/[A-Za-z]/)
  })
})

describe('OfficeRenderer legacy best-effort + generic fallback', () => {
  it.each([
    { name: '旧稿.doc', extension: '.doc', kind: 'word', type: 'doc' },
    { name: '旧表.xls', extension: '.xls', kind: 'spreadsheet', type: 'xls' },
    { name: '旧灯.ppt', extension: '.ppt', kind: 'presentation', type: 'ppt' },
  ])('tries $extension then falls back once on viewer error', async ({ name, extension, kind, type }) => {
    const viewerModule = await import('@file-viewer/react') as unknown as {
      __emitViewerStateFor: (fileName: string, state: { error?: unknown }) => void
    }
    const nextActions = actions()
    render(<OfficeRenderer {...props({
      document: { name, extension, documentKind: kind },
      actions: nextActions,
    })} />)
    const viewer = screen.getByTestId('office-viewer')
    expect(viewer.getAttribute('data-type')).toBe(type)
    expect(screen.getByTestId('office-renderer').getAttribute('data-preview-tier')).toBe('best-effort')
    viewerModule.__emitViewerStateFor(name, { error: new Error('legacy engine failed') })
    await waitFor(() => expect(nextActions.useGenericFallback).toHaveBeenCalledTimes(1))
    viewerModule.__emitViewerStateFor(name, { error: new Error('legacy engine failed again') })
    expect(nextActions.useGenericFallback).toHaveBeenCalledTimes(1)
  })
})

describe('OfficeRenderer viewer errors', () => {
  it('requests generic fallback on an async viewer state error', async () => {
    const viewerModule = await import('@file-viewer/react') as unknown as {
      __emitViewerState: (state: { error?: unknown }) => void
    }
    const nextActions = actions()
    render(<OfficeRenderer {...props({ actions: nextActions })} />)
    viewerModule.__emitViewerState({ error: new Error('wasm load failed') })
    await waitFor(() => expect(nextActions.useGenericFallback).toHaveBeenCalledTimes(1))
  })

  it('clears the one-shot fallback latch when revision changes', async () => {
    const viewerModule = await import('@file-viewer/react') as unknown as {
      __emitViewerState: (state: { error?: unknown }) => void
    }
    const first = actions()
    const { rerender } = render(<OfficeRenderer {...props({ actions: first })} />)
    viewerModule.__emitViewerState({ error: new Error('first') })
    await waitFor(() => expect(first.useGenericFallback).toHaveBeenCalledTimes(1))
    const second = actions()
    rerender(<OfficeRenderer {...props({ document: { revision: 2 }, actions: second })} />)
    viewerModule.__emitViewerState({ error: new Error('second') })
    await waitFor(() => expect(second.useGenericFallback).toHaveBeenCalledTimes(1))
    expect(first.useGenericFallback).toHaveBeenCalledTimes(1)
  })

  it('does not put a filesystem path or host API on renderer props', () => {
    const rendered = props({
      document: { name: '2026 报告 表格.xlsx', extension: '.xlsx', documentKind: 'spreadsheet' },
    })
    render(<OfficeRenderer {...rendered} />)
    const serialized = JSON.stringify(rendered)
    expect(serialized).not.toContain('/工作')
    expect(serialized).not.toContain('convertDocumentToMarkdown')
    expect(serialized).not.toContain('pipiHost')
    expect(Object.keys(rendered.actions).sort()).toEqual(['openExternally', 'reload', 'useGenericFallback'])
  })

  it('delegates external open without reading a path', async () => {
    const nextActions = actions()
    render(<OfficeRenderer {...props({ actions: nextActions })} />)
    await nextActions.openExternally()
    expect(nextActions.openExternally).toHaveBeenCalledTimes(1)
  })

  it('isolates async viewer errors to the file that failed', async () => {
    const viewerModule = await import('@file-viewer/react') as unknown as {
      __emitViewerStateFor: (fileName: string, state: { error?: unknown }) => void
    }
    const alpha = actions()
    const beta = actions()
    render(<>
      <OfficeRenderer {...props({
        document: { documentId: 'alpha', name: 'alpha.docx' },
        actions: alpha,
      })} />
      <OfficeRenderer {...props({
        document: { documentId: 'beta', name: 'beta.docx' },
        actions: beta,
      })} />
    </>)
    viewerModule.__emitViewerStateFor('alpha.docx', { error: new Error('alpha failed') })
    await waitFor(() => expect(alpha.useGenericFallback).toHaveBeenCalledTimes(1))
    expect(beta.useGenericFallback).not.toHaveBeenCalled()
  })
})
