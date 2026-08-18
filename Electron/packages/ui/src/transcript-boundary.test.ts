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

  it('opens MessageList at the newest item and only first-page history asks Virtuoso to follow the tail', () => {
    expect(transcriptSource()).toMatch(/initialTopMostItemIndex=\{Math\.max\(0, messages\.length - 1\)\}/)
    const source = appSource()
    expect(source).toMatch(/applyHistory\(accumulated, !loadedPage\)/)
    expect(source).toMatch(/requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => transcriptRef\.current\?\.scrollToIndex/)
    expect(source).not.toMatch(/applyHistory\(accumulated, true\)/)
  })

  it('does not prop-drill live agent inventories into transcript rendering or reducers', () => {
    const source = appSource()
    expect(source).not.toMatch(/<Transcript\b[^>]*\bagents\s*=/s)
    expect(source).not.toMatch(/\bagentsRef\b/)
    expect(source).not.toMatch(/(?:historyMessages|applyStreamEvent)\([^)]*agents/s)
  })
})
