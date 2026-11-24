import { constants, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parseQueueFailure, safeQueueError, type LoginRecordStatus, type QueueFailureDetails } from '@pipi/host-api'

export class QueueDispatchError extends Error {
  readonly details: QueueFailureDetails

  constructor(message: string, details: QueueFailureDetails) {
    super(safeQueueError(message))
    this.details = parseQueueFailure(details)!
  }
}

/** Inspect only whether this provider has a stored login entry. No credential leaves this function. */
export async function loginRecordStatus(agentDir: string | undefined, provider: string): Promise<LoginRecordStatus> {
  if (!agentDir) return 'unknown'
  try {
    const file = await fs.open(join(agentDir, 'auth.json'), constants.O_RDONLY | (constants.O_NONBLOCK ?? 0))
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > 1024 * 1024) return 'unknown'
      const entries: unknown = JSON.parse(await file.readFile('utf8'))
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return 'unknown'
      return Object.hasOwn(entries, provider) ? 'present' : 'absent'
    } finally {
      await file.close()
    }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unknown'
  }
}
