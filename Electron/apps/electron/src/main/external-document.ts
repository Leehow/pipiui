import { promises as fs } from 'node:fs'
import { isAbsolute } from 'node:path'
import { documentKindForName, type DocumentErrorCode, type HostBackend } from '@pipi/host-api'

class ExternalDocumentError extends Error {
  constructor(readonly code: DocumentErrorCode, message: string) {
    super(message)
    this.name = 'ExternalDocumentError'
  }
}

/** Validate the one renderer-supplied local path before delegating to Electron shell. */
export async function safeLocalDocumentPath(raw: unknown): Promise<string> {
  if (typeof raw !== 'string' || !raw.trim() || !isAbsolute(raw.trim())) {
    throw new ExternalDocumentError('document_invalid_path', 'document path must be a non-empty absolute path')
  }
  const path = raw.trim()
  if (!documentKindForName(path)) {
    throw new ExternalDocumentError('document_unsupported_type', 'unsupported document type')
  }
  let stat
  try {
    stat = await fs.stat(path)
  } catch (error: any) {
    if (error?.code === 'ENOENT') throw new ExternalDocumentError('document_not_found', `Document does not exist: ${path}`)
    throw new ExternalDocumentError('document_read_failed', `Cannot inspect document: ${path}`)
  }
  if (!stat.isFile()) throw new ExternalDocumentError('document_not_file', `Document is not a regular file: ${path}`)
  return path
}

/** Add a narrow local-document opener without weakening the URL opener policy. */
export function withOpenDocumentExternally(backend: HostBackend, openPath: (path: string) => Promise<string>): HostBackend {
  return {
    async handle(method, params) {
      if (method === 'openDocumentExternally') {
        const path = await safeLocalDocumentPath(params[0])
        const shellError = (await openPath(path)).trim()
        if (shellError) throw new ExternalDocumentError('document_external_open_failed', shellError)
        return
      }
      return backend.handle(method, params)
    },
    subscribe: listener => backend.subscribe(listener)
  }
}
