// @vitest-environment jsdom
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@file-viewer/react', () => ({
  default: ({ name, type }: { name: string; type: string }) =>
    React.createElement('div', { 'data-testid': 'office-viewer', 'data-name': name, 'data-type': type }),
}))
vi.mock('@file-viewer/preset-office', () => ({ default: { id: 'office' } }))
const assetBase = vi.hoisted(() => {
  let current: string | undefined
  let setImpl: ((url?: string | URL | null) => void) | undefined
  return {
    set: (url?: string | URL | null) => {
      if (setImpl) return setImpl(url)
      current = url == null || url === '' ? undefined : String(url)
    },
    reset: () => { current = undefined },
    get: () => current,
    onSet: (fn?: (url?: string | URL | null) => void) => { setImpl = fn },
  }
})
vi.mock('@file-viewer/core', () => ({
  setDefaultFileViewerAssetBaseUrl: (url?: string | URL | null) => assetBase.set(url),
  resetDefaultFileViewerAssetBaseUrl: () => assetBase.reset(),
  getDefaultFileViewerAssetBaseUrl: () => assetBase.get(),
}))
import type { PipiHostAPI } from '@pipi/host-api'
import type { DocumentRendererProps } from '@pipiui/extension-api'
import {
  disposeDocumentRenderers,
  listDocumentRenderers,
  matchDocumentRenderer,
  matchDocumentRenderers,
  registerDocumentRenderer,
} from '../../ui/src/ui-registries'
import { hasControlledEntry, loadControlledContributions } from '../../ui/src/controlled-component-loader'
import OfficeRenderer, {
  acquireOfficeSideEffects,
  OFFICE_STYLE_ID,
  releaseOfficeSideEffects,
} from '../app/src/office-renderer'
import { OFFICE_RENDERER_ID, OFFICE_RENDERER_PRIORITY } from '../app/src/office-format-policy'

const EXT = 'office-extension'
const OTHER = 'other-doc-ext'

async function importOffice(_specifier: string): Promise<unknown> {
  return { default: OfficeRenderer }
}

function rendererProps(partial: Partial<DocumentRendererProps> & { document?: Partial<DocumentRendererProps['document']> } = {}): DocumentRendererProps {
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
    bytes: new Uint8Array([1, 2, 3, 4]),
    actions: {
      reload: async () => undefined,
      openExternally: async () => undefined,
      useGenericFallback: async () => undefined,
    },
    ...rest,
  }
}

afterEach(() => {
  disposeDocumentRenderers(EXT)
  disposeDocumentRenderers(OTHER)
  cleanup()
  document.getElementById(OFFICE_STYLE_ID)?.remove()
  assetBase.onSet(undefined)
  assetBase.reset()
})

describe('office extension registry lifecycle', () => {
  it('registers at priority 100 and unloads with zero residue', async () => {
    const disposers = await loadControlledContributions({
      id: EXT,
      directory: '/tmp/office-extension',
      ui: {
        documentRenderers: [{
          id: OFFICE_RENDERER_ID,
          entry: 'app/dist/office-renderer.js',
          kinds: ['word', 'spreadsheet', 'presentation'],
          priority: OFFICE_RENDERER_PRIORITY,
        }],
      },
    }, {} as PipiHostAPI, importOffice)

    expect(matchDocumentRenderer({ documentKind: 'word' })?.contribution.id).toBe(OFFICE_RENDERER_ID)
    expect(matchDocumentRenderer({ documentKind: 'spreadsheet' })?.contribution.priority).toBe(100)
    expect(matchDocumentRenderer({ documentKind: 'presentation' })?.extId).toBe(EXT)
    expect(matchDocumentRenderer({ documentKind: 'pdf' })).toBeUndefined()

    for (const dispose of disposers) dispose()
    expect(matchDocumentRenderer({ documentKind: 'word' })).toBeUndefined()
    expect(listDocumentRenderers()).toEqual([])
  })

  it('wins over a lower-priority renderer and loses to a higher one', () => {
    registerDocumentRenderer(OTHER, {
      id: 'other-word',
      kinds: ['word'],
      priority: 10,
      render: () => null,
    })
    registerDocumentRenderer(EXT, {
      id: OFFICE_RENDERER_ID,
      kinds: ['word'],
      priority: OFFICE_RENDERER_PRIORITY,
      render: props => <OfficeRenderer {...props} />,
    })
    expect(matchDocumentRenderers({ documentKind: 'word' }).map(entry => entry.contribution.id))
      .toEqual([OFFICE_RENDERER_ID, 'other-word'])

    disposeDocumentRenderers(EXT)
    expect(matchDocumentRenderer({ documentKind: 'word' })?.contribution.id).toBe('other-word')
  })

  it('forwards path-free props into the loaded component', async () => {
    const disposers = await loadControlledContributions({
      id: EXT,
      directory: '/tmp/office-extension',
      ui: {
        documentRenderers: [{
          id: OFFICE_RENDERER_ID,
          entry: 'app/dist/office-renderer.js',
          kinds: ['word'],
          priority: OFFICE_RENDERER_PRIORITY,
        }],
      },
    }, {} as PipiHostAPI, importOffice)
    const match = matchDocumentRenderer({ documentKind: 'word' })
    const rendererProps: DocumentRendererProps = {
      document: {
        documentId: 'doc-9',
        name: 'form.docx',
        extension: '.docx',
        documentKind: 'word',
        size: 4,
        revision: 1,
      },
      bytes: new Uint8Array([1, 2, 3, 4]),
      actions: {
        reload: async () => undefined,
        openExternally: async () => undefined,
        useGenericFallback: async () => undefined,
      },
    }
    expect(JSON.stringify(rendererProps)).not.toContain('/tmp')
    const { getByTestId } = render(match!.contribution.render(rendererProps))
    expect(getByTestId('office-renderer').getAttribute('data-extension')).toBe('.docx')
    for (const dispose of disposers) dispose()
  })

  it('treats the office documentRenderers entry as a controlled entry', () => {
    expect(hasControlledEntry({
      id: EXT,
      ui: { documentRenderers: [{ id: OFFICE_RENDERER_ID, entry: 'app/dist/office-renderer.js', kinds: ['word'] }] },
    })).toBe(true)
  })
})

describe('office renderer CSS and asset-base lifecycle', () => {
  it('keeps one style lease across two mounts and restores globals after the last unmount', () => {
    assetBase.set('https://core.example/file-viewer/')
    const first = rendererProps({ document: { documentId: 'a', name: 'a.docx' } })
    const second = rendererProps({ document: { documentId: 'b', name: 'b.docx' } })
    const view = render(<>
      <OfficeRenderer {...first} />
      <OfficeRenderer {...second} />
    </>)
    expect(document.querySelectorAll(`#${OFFICE_STYLE_ID}`)).toHaveLength(1)
    expect(assetBase.get()).toMatch(/file-viewer\/?$/)
    expect(assetBase.get()).not.toBe('https://core.example/file-viewer/')

    view.rerender(<OfficeRenderer {...first} />)
    expect(document.querySelectorAll(`#${OFFICE_STYLE_ID}`)).toHaveLength(1)
    expect(assetBase.get()).toMatch(/file-viewer\/?$/)

    view.unmount()
    expect(document.getElementById(OFFICE_STYLE_ID)).toBeNull()
    expect(assetBase.get()).toBe('https://core.example/file-viewer/')
  })

  it('does not leave a duplicate style after unload and remount', () => {
    const view = render(<OfficeRenderer {...rendererProps()} />)
    expect(document.querySelectorAll(`#${OFFICE_STYLE_ID}`)).toHaveLength(1)
    view.unmount()
    expect(document.getElementById(OFFICE_STYLE_ID)).toBeNull()
    expect(assetBase.get()).toBeUndefined()

    render(<OfficeRenderer {...rendererProps()} />)
    expect(document.querySelectorAll(`#${OFFICE_STYLE_ID}`)).toHaveLength(1)
  })

  it('does not restore a global that another owner changed during the lease', () => {
    assetBase.set('https://core.example/file-viewer/')
    const view = render(<OfficeRenderer {...rendererProps()} />)
    expect(assetBase.get()).not.toBe('https://core.example/file-viewer/')
    assetBase.set('https://other-owner.example/file-viewer/')
    view.unmount()
    expect(document.getElementById(OFFICE_STYLE_ID)).toBeNull()
    expect(assetBase.get()).toBe('https://other-owner.example/file-viewer/')
  })

  it('rolls back when the asset-base setter throws during acquire', () => {
    assetBase.set('https://core.example/file-viewer/')
    assetBase.onSet(() => { throw new Error('set boom') })
    expect(() => acquireOfficeSideEffects()).toThrow('set boom')
    expect(document.getElementById(OFFICE_STYLE_ID)).toBeNull()
    assetBase.onSet(undefined)
    expect(assetBase.get()).toBe('https://core.example/file-viewer/')
  })

  it('does not mutate the global when appending the style node throws', () => {
    assetBase.set('https://core.example/file-viewer/')
    const original = document.head.appendChild.bind(document.head)
    document.head.appendChild = ((node: Node) => {
      if (node instanceof HTMLElement && node.id === OFFICE_STYLE_ID) throw new Error('append boom')
      return original(node)
    }) as typeof document.head.appendChild
    try {
      expect(() => acquireOfficeSideEffects()).toThrow('append boom')
    } finally {
      document.head.appendChild = original
    }
    expect(document.getElementById(OFFICE_STYLE_ID)).toBeNull()
    expect(assetBase.get()).toBe('https://core.example/file-viewer/')
  })

  it('still removes the style lease when restore throws on release', () => {
    assetBase.set('https://core.example/file-viewer/')
    acquireOfficeSideEffects()
    expect(document.getElementById(OFFICE_STYLE_ID)).toBeTruthy()
    assetBase.onSet(() => { throw new Error('restore boom') })
    expect(() => releaseOfficeSideEffects()).toThrow('restore boom')
    expect(document.getElementById(OFFICE_STYLE_ID)).toBeNull()
  })
})
