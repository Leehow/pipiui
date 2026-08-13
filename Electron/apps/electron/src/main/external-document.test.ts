import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostBackend } from '@pipi/host-api'
import { safeLocalDocumentPath, withOpenDocumentExternally } from './external-document.js'

let root = ''
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = ''
})

async function fixture(name: string, content: string | Uint8Array = 'document'): Promise<string> {
  if (!root) root = await mkdtemp(join(tmpdir(), 'pipi-external-document-'))
  const path = join(root, name)
  await writeFile(path, content)
  return path
}

const backend: HostBackend = {
  handle: vi.fn(async () => 'forwarded'),
  subscribe: () => () => undefined
}

describe('safeLocalDocumentPath', () => {
  it('accepts a supported absolute regular file', async () => {
    const path = await fixture('report.pdf', new Uint8Array([1, 2, 3]))
    await expect(safeLocalDocumentPath(path)).resolves.toBe(path)
  })

  it('rejects relative, unsupported, missing, and directory paths with codes', async () => {
    await expect(safeLocalDocumentPath('report.pdf')).rejects.toMatchObject({ code: 'document_invalid_path' })
    await expect(safeLocalDocumentPath(await fixture('script.js'))).rejects.toMatchObject({ code: 'document_unsupported_type' })
    await expect(safeLocalDocumentPath(join(root, 'missing.docx'))).rejects.toMatchObject({ code: 'document_not_found' })
    const directory = join(root, 'folder.pdf')
    await mkdir(directory)
    await expect(safeLocalDocumentPath(directory)).rejects.toMatchObject({ code: 'document_not_file' })
  })
})

describe('withOpenDocumentExternally', () => {
  it('opens the validated path and surfaces shell error strings', async () => {
    const path = await fixture('slides.pptx')
    const openPath = vi.fn(async () => '')
    await withOpenDocumentExternally(backend, openPath).handle('openDocumentExternally', [path])
    expect(openPath).toHaveBeenCalledWith(path)

    openPath.mockResolvedValueOnce('No application knows how to open this file')
    await expect(withOpenDocumentExternally(backend, openPath).handle('openDocumentExternally', [path]))
      .rejects.toMatchObject({ code: 'document_external_open_failed', message: 'No application knows how to open this file' })
  })
})
