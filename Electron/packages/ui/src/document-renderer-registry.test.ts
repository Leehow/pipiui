// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PipiHostAPI } from '@pipi/host-api'
import { DOCUMENT_RENDERER_CONTRACT_VERSION, type DocumentRendererProps } from '@pipiui/extension-api'
import {
  disposeDocumentRenderers,
  disposeUiContributions,
  listDocumentRenderers,
  matchDocumentRenderer,
  matchDocumentRenderers,
  registerDocumentRenderer,
} from './ui-registries'
import { hasControlledEntry, loadControlledContributions } from './controlled-component-loader'

const EXT = 'doc-renderer-test'
const EXT2 = 'doc-renderer-test-2'
const EXT3 = 'doc-renderer-test-3'

function noopRender(): never {
  throw new Error('render must not be called by registry tests')
}

function hostStub(): PipiHostAPI {
  return {} as unknown as PipiHostAPI
}

async function importFixture(specifier: string): Promise<unknown> {
  const file = specifier.slice(specifier.lastIndexOf('/') + 1)
  if (file === 'throws.ts' || file === 'throws.js') throw new Error('cannot load entry')
  if (file === 'document-renderer.ts') return import('./fixtures/controlled/document-renderer')
  throw new Error(`unknown fixture ${specifier}`)
}

afterEach(() => {
  disposeUiContributions(EXT)
  disposeUiContributions(EXT2)
  disposeUiContributions(EXT3)
  cleanup()
})

describe('document renderer contract surface', () => {
  it('exposes a versioned, generic contract', () => {
    expect(DOCUMENT_RENDERER_CONTRACT_VERSION).toBe(1)
    expect(listDocumentRenderers()).toEqual([])
  })
})

describe('register / dispose lifecycle', () => {
  it('registers, matches, and disposes with zero residue', () => {
    expect(matchDocumentRenderer({ documentKind: 'diagram' })).toBeUndefined()
    const dispose = registerDocumentRenderer(EXT, {
      id: 'diagram',
      kinds: ['diagram'],
      render: noopRender,
    })
    expect(matchDocumentRenderer({ documentKind: 'diagram' })?.contribution.id).toBe('diagram')
    dispose()
    expect(matchDocumentRenderer({ documentKind: 'diagram' })).toBeUndefined()
    expect(listDocumentRenderers()).toEqual([])
  })

  it('allows re-registering the same id after disposal (enable/disable cycle)', () => {
    const first = registerDocumentRenderer(EXT, { id: 'r', extensions: ['.a'], render: noopRender })
    first()
    const second = registerDocumentRenderer(EXT, { id: 'r', extensions: ['.a'], render: noopRender })
    expect(listDocumentRenderers()).toHaveLength(1)
    second()
  })

  it('disposeDocumentRenderers drops the whole extension group and leaves others intact', () => {
    registerDocumentRenderer(EXT, { id: 'one', extensions: ['.one'], render: noopRender })
    registerDocumentRenderer(EXT2, { id: 'two', extensions: ['.two'], render: noopRender })
    disposeDocumentRenderers(EXT)
    expect(listDocumentRenderers().map(entry => entry.contribution.id)).toEqual(['two'])
    disposeUiContributions(EXT2)
    expect(listDocumentRenderers()).toEqual([])
  })
})

describe('deterministic errors', () => {
  it('throws on a duplicate renderer id across extensions', () => {
    registerDocumentRenderer(EXT, { id: 'dup', extensions: ['.a'], render: noopRender })
    expect(() => registerDocumentRenderer(EXT2, { id: 'dup', extensions: ['.b'], render: noopRender }))
      .toThrow(/document renderer id 'dup' is already registered by extension 'doc-renderer-test'/)
    expect(listDocumentRenderers()).toHaveLength(1)
  })

  it('throws on invalid declarations', () => {
    expect(() => registerDocumentRenderer(EXT, { id: '', extensions: ['.a'], render: noopRender }))
      .toThrow(/id must be a non-empty string/)
    expect(() => registerDocumentRenderer(EXT, { id: 'x', extensions: ['.a'] } as never))
      .toThrow(/must declare a render function/)
    expect(() => registerDocumentRenderer(EXT, { id: 'x', render: noopRender }))
      .toThrow(/must match kinds, extensions, or mimeTypes/)
    expect(() => registerDocumentRenderer(EXT, { id: 'x', kinds: [], extensions: [], render: noopRender }))
      .toThrow(/must match kinds, extensions, or mimeTypes/)
    expect(() => registerDocumentRenderer(EXT, { id: 'x', extensions: ['.a'], priority: Number.NaN, render: noopRender }))
      .toThrow(/priority must be a finite number/)
    expect(() => registerDocumentRenderer(EXT, { id: 'x', kinds: ['ok', ''], render: noopRender }))
      .toThrow(/kinds must be non-empty strings/)
    expect(listDocumentRenderers()).toEqual([])
  })
})

describe('matching and deterministic ordering', () => {
  it('matches by kind, extension (case/dot insensitive), and mime type', () => {
    registerDocumentRenderer(EXT, {
      id: 'by-kind',
      kinds: ['diagram'],
      extensions: ['.SVGX'],
      mimeTypes: ['image/svg+xml'],
      render: noopRender,
    })
    expect(matchDocumentRenderer({ documentKind: 'diagram' })?.contribution.id).toBe('by-kind')
    expect(matchDocumentRenderer({ extension: '.svgx' })?.contribution.id).toBe('by-kind')
    expect(matchDocumentRenderer({ extension: 'svgx' })?.contribution.id).toBe('by-kind')
    expect(matchDocumentRenderer({ mimeType: 'image/SVG+XML' })?.contribution.id).toBe('by-kind')
    expect(matchDocumentRenderer({ documentKind: 'other' })).toBeUndefined()
  })

  it('orders by priority descending regardless of registration order', () => {
    registerDocumentRenderer(EXT, { id: 'low', priority: 1, kinds: ['k'], render: noopRender })
    registerDocumentRenderer(EXT2, { id: 'high', priority: 100, kinds: ['k'], render: noopRender })
    registerDocumentRenderer(EXT3, { id: 'mid', priority: 10, kinds: ['k'], render: noopRender })
    expect(matchDocumentRenderers({ documentKind: 'k' }).map(entry => entry.contribution.id))
      .toEqual(['high', 'mid', 'low'])
    expect(matchDocumentRenderer({ documentKind: 'k' })?.contribution.id).toBe('high')
  })

  it('breaks equal-priority ties on id, then extension id — not registration order', () => {
    // Register in the opposite of the expected order to prove no traversal-order luck.
    registerDocumentRenderer(EXT, { id: 'zzz', priority: 5, kinds: ['k'], render: noopRender })
    registerDocumentRenderer(EXT2, { id: 'aaa', priority: 5, kinds: ['k'], render: noopRender })
    registerDocumentRenderer(EXT3, { id: 'mmm', priority: 5, kinds: ['k'], render: noopRender })
    expect(matchDocumentRenderers({ documentKind: 'k' }).map(entry => entry.contribution.id))
      .toEqual(['aaa', 'mmm', 'zzz'])
    expect(matchDocumentRenderers({ documentKind: 'k' }).map(entry => entry.extId))
      .toEqual([EXT2, EXT3, EXT])

    // Equal priority + same id is impossible (duplicates throw), so the extId
    // tie-break is exercised through ordering stability of the whole list.
    expect(listDocumentRenderers().map(entry => entry.contribution.id)).toEqual(['aaa', 'mmm', 'zzz'])
  })
})

describe('controlled loader integration', () => {
  it('loads a document renderer entry and forwards host-prepared props only', async () => {
    const disposers = await loadControlledContributions({
      id: EXT,
      directory: '/tmp/ext',
      capabilities: [],
      ui: {
        documentRenderers: [{ id: 'diagram-view', entry: 'document-renderer.ts', kinds: ['diagram'], priority: 7 }],
      },
    }, hostStub(), importFixture)

    const match = matchDocumentRenderer({ documentKind: 'diagram' })
    expect(match?.extId).toBe(EXT)
    expect(match?.contribution.id).toBe('diagram-view')
    expect(match?.contribution.priority).toBe(7)

    const actions = {
      reload: async () => {},
      openExternally: async () => {},
      useGenericFallback: async () => {},
    }
    const props: DocumentRendererProps = {
      document: {
        documentId: 'session-doc-1',
        name: 'blueprint.svg',
        extension: '.svg',
        documentKind: 'diagram',
        size: 128,
        revision: 3,
      },
      bytes: new Uint8Array([1, 2, 3, 4]),
      actions,
    }
    const { getByTestId } = render(match!.contribution.render(props))
    const node = getByTestId('ext-controlled-document-renderer')
    expect(node.getAttribute('data-document-id')).toBe('session-doc-1')
    expect(node.getAttribute('data-name')).toBe('blueprint.svg')
    expect(node.getAttribute('data-kind')).toBe('diagram')
    expect(node.getAttribute('data-extension')).toBe('.svg')
    expect(node.getAttribute('data-size')).toBe('128')
    expect(node.getAttribute('data-revision')).toBe('3')
    expect(node.getAttribute('data-bytes')).toBe('4')
    expect(node.getAttribute('data-text')).toBe('')
    expect(node.getAttribute('data-actions')).toBe('openExternally,reload,useGenericFallback')
    // The renderer component receives no host bridge: descriptor/actions only.
    expect(node.getAttribute('data-pipi-host')).toBe('undefined')

    for (const dispose of disposers) dispose()
    expect(matchDocumentRenderer({ documentKind: 'diagram' })).toBeUndefined()
  })

  it('skips broken entries silently and keeps builtin rendering', async () => {
    const before = listDocumentRenderers().length
    const disposers = await loadControlledContributions({
      id: EXT,
      directory: '/tmp/ext',
      ui: { documentRenderers: [{ id: 'broken', entry: 'throws.ts', kinds: ['diagram'] }] },
    }, hostStub(), importFixture)
    expect(listDocumentRenderers()).toHaveLength(before)
    expect(matchDocumentRenderer({ documentKind: 'diagram' })).toBeUndefined()
    for (const dispose of disposers) dispose()
  })

  it('skips a renderer whose id conflicts with a registered one', async () => {
    registerDocumentRenderer(EXT, { id: 'conflict', kinds: ['diagram'], render: noopRender })
    const disposers = await loadControlledContributions({
      id: EXT2,
      directory: '/tmp/ext',
      ui: { documentRenderers: [{ id: 'conflict', entry: 'document-renderer.ts', kinds: ['diagram'] }] },
    }, hostStub(), importFixture)
    expect(listDocumentRenderers()).toHaveLength(1)
    expect(matchDocumentRenderer({ documentKind: 'diagram' })?.extId).toBe(EXT)
    for (const dispose of disposers) dispose()
  })

  it('treats a documentRenderers entry as a controlled entry', () => {
    expect(hasControlledEntry({
      id: EXT,
      ui: { documentRenderers: [{ id: 'r', entry: 'document-renderer.ts', kinds: ['k'] }] },
    })).toBe(true)
    expect(hasControlledEntry({ id: EXT, ui: { documentRenderers: [{ id: 'r', kinds: ['k'] }] } })).toBe(false)
    expect(hasControlledEntry({ id: EXT })).toBe(false)
  })
})
