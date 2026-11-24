/** Wire-only paging: public listAgents still returns complete, unmodified rows. */
export type RemoteAgentPageRequest = { remotePage: 1; after: string | null }
export type RemoteAgentPage<T> = { remotePage: 1; items: T[]; nextCursor: string | null }
type AgentIdentity = { sessionId?: string; agentId: string; runId: string }
export const REMOTE_RESPONSE_MAX_BYTES = 7 * 1024 * 1024
const PAGE_BYTES = 1024 * 1024
const keyOf = (row: AgentIdentity) => JSON.stringify([row.sessionId ?? '', row.agentId, row.runId])

export function isRemoteAgentPageRequest(value: unknown): value is RemoteAgentPageRequest {
  if (!value || typeof value !== 'object') return false
  const page = value as RemoteAgentPageRequest
  return page.remotePage === 1 && (page.after === null || typeof page.after === 'string')
}

export function remoteAgentPage<T extends AgentIdentity>(rows: T[], request: RemoteAgentPageRequest): RemoteAgentPage<T> {
  const sorted = rows.map(row => ({ row, key: keyOf(row) }))
    .filter(item => request.after === null || item.key > request.after)
    .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  const items: T[] = []
  let bytes = 128
  let cursor: string | null = null
  for (const item of sorted) {
    const size = new TextEncoder().encode(JSON.stringify(item.row)).byteLength + 1
    if (size + 1024 > REMOTE_RESPONSE_MAX_BYTES) throw new Error('A single agent detail exceeds the remote response limit; open its logs on the desktop.')
    if (items.length && (bytes + size > PAGE_BYTES || items.length >= 64)) break
    items.push(item.row)
    bytes += size
    cursor = item.key
  }
  return { remotePage: 1, items, nextCursor: items.length < sorted.length ? cursor : null }
}

export async function collectRemoteAgentPages<T>(read: (page: RemoteAgentPageRequest) => Promise<unknown>): Promise<T[]> {
  const items: T[] = []
  let after: string | null = null
  for (;;) {
    const result = await read({ remotePage: 1, after })
    // Rolling updates: an older host ignores the extra argument.
    if (Array.isArray(result)) return result as T[]
    const page = result as RemoteAgentPage<T> | null
    if (!page || page.remotePage !== 1 || !Array.isArray(page.items) ||
      !(page.nextCursor === null || typeof page.nextCursor === 'string')) throw new Error('Invalid remote agent page')
    items.push(...page.items)
    if (page.nextCursor === null) return items
    if (!page.items.length || (after !== null && page.nextCursor <= after)) throw new Error('Remote agent pagination did not advance')
    after = page.nextCursor
  }
}
