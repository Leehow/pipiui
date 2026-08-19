/** Large, integer-exact headroom for years of paged history prepends. */
export const TRANSCRIPT_FIRST_ITEM_BASE = 1_000_000_000_000

/** One event-driven pin burst; later message/size changes can start another burst. */
export const TRANSCRIPT_PIN_MAX_ATTEMPTS = 4

/**
 * Paging identity is richer than a host id because malformed/imported history
 * can contain duplicate ids. Include stable history fields so two different
 * imported rows sharing an id do not collapse into one prepend identity.
 */
export function transcriptMessageIdentity(message: { id: string; role: string; timestamp?: number; content: string }): string {
  return JSON.stringify([message.id, message.role, message.timestamp ?? null, message.content])
}

function sameAt(haystack: readonly string[], offset: number, needle: readonly string[]): boolean {
  for (let index = 0; index < needle.length; index += 1) {
    if (haystack[offset + index] !== needle[index]) return false
  }
  return true
}

/** How many items were inserted before `previousIds` inside `nextIds`, or null if the previous run is gone. */
export function countTranscriptPrepended(previousIds: readonly string[], nextIds: readonly string[]): number | null {
  if (nextIds.length < previousIds.length) return null
  if (previousIds.length === 0) return nextIds.length
  if (sameAt(nextIds, 0, previousIds)) return 0
  const last = previousIds[previousIds.length - 1]
  for (let end = nextIds.length - 1; end >= previousIds.length - 1; end -= 1) {
    if (nextIds[end] !== last) continue
    const start = end - previousIds.length + 1
    if (sameAt(nextIds, start, previousIds)) return start
  }
  return null
}

/**
 * Keep newest rows on a stable virtual index across older-page prepends.
 * Tail appends leave the anchor alone. Branch replace / clear reset to the base.
 * The result is never negative.
 */
export function nextTranscriptFirstItemIndex(
  previousFirstItemIndex: number,
  previousIds: readonly string[],
  nextIds: readonly string[],
): number {
  if (nextIds.length === 0 || previousIds.length === 0) return TRANSCRIPT_FIRST_ITEM_BASE
  const prepended = countTranscriptPrepended(previousIds, nextIds)
  if (prepended === null) return TRANSCRIPT_FIRST_ITEM_BASE
  return Math.max(0, previousFirstItemIndex - prepended)
}

export function transcriptTailVirtualIndex(firstItemIndex: number, count: number): number {
  return count <= 0 ? firstItemIndex : firstItemIndex + count - 1
}

/** Real Virtuoso passes a virtual index; test doubles often pass the data index. */
export function transcriptDataIndex(virtualIndex: number, firstItemIndex: number): number {
  return virtualIndex >= firstItemIndex ? virtualIndex - firstItemIndex : virtualIndex
}
