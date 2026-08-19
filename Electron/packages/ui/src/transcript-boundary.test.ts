import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appSource = () => readFileSync(join(import.meta.dirname, 'App.tsx'), 'utf8')
const transcriptSource = () => readFileSync(join(import.meta.dirname, 'Transcript.tsx'), 'utf8')

describe('transcript architecture boundary', () => {
  it('keeps transcript state and rendering definitions out of App composition', () => {
    const source = appSource()
    for (const definition of [
      /^\s*(?:export\s+)?(?:type|interface)\s+ChatMessage\b/m,
      /^\s*(?:export\s+)?(?:const|function)\s+historyMessages\b/m,
      /^\s*(?:export\s+)?(?:const|function)\s+applyStreamEvent\b/m,
      /^\s*(?:export\s+)?(?:const|function)\s+finishStreamingMessage\b/m,
      /^\s*(?:export\s+)?(?:const|function)\s+Transcript\b/m,
      /^\s*(?:export\s+)?(?:const|function)\s+MessageList\b/m,
      /^\s*(?:export\s+)?(?:const|function)\s+MessageView\b/m,
    ]) expect(source).not.toMatch(definition)
  })

  it('gives Transcript sole ownership of bounded tail pinning across every history page', () => {
    const transcript = transcriptSource()
    expect(transcript).toMatch(/firstItemIndex=\{firstItemIndex\}/)
    expect(transcript).toMatch(/computeItemKey=\{transcriptItemKey\}/)
    expect(transcript).toMatch(/initialTopMostItemIndex=\{\{ index: 'LAST', align: 'end' \}\}/)
    expect(transcript).toMatch(/const virtuosoRef = useRef<VirtuosoHandle \| null>\(null\)/)
    expect(transcript).toMatch(/totalListHeightChanged=\{onListHeightChanged\}/)
    expect(transcript).toMatch(/TRANSCRIPT_PIN_MAX_ATTEMPTS/)
    expect(transcript).not.toMatch(/requestAnimationFrame\(\(\) => requestAnimationFrame/)

    const app = appSource()
    expect(app).toMatch(/applyHistory\(accumulated\)/)
    expect(app).not.toMatch(/idleTranscriptRef|transcriptRef\.current\?\.scrollToIndex/)
    expect(app).not.toMatch(/applyHistory\(accumulated,\s*(?:true|!loadedPage)/)
  })

  it('does not prop-drill live agent inventories into transcript rendering or reducers', () => {
    const source = appSource()
    expect(source).not.toMatch(/<Transcript\b[^>]*\bagents\s*=/s)
    expect(source).not.toMatch(/\bagentsRef\b/)
    expect(source).not.toMatch(/(?:historyMessages|applyStreamEvent)\([^)]*agents/s)
  })
})
