import { memo } from 'react'
import { Streamdown, type ControlsConfig } from 'streamdown'
import { code } from '@streamdown/code'

const staticMarkdownPlugins = { code }
const streamdownControls: ControlsConfig = { table: { copy: false, download: false, fullscreen: false }, code: { copy: true, download: false }, mermaid: false }

export const TranscriptMarkdown = memo(function TranscriptMarkdown({ content, streaming }: { content: string; streaming?: boolean }) { return <div className="markdown"><Streamdown mode={streaming ? 'streaming' : 'static'} isAnimating={streaming} plugins={streaming ? undefined : staticMarkdownPlugins} shikiTheme={['github-light', 'github-dark']} controls={streamdownControls}>{content}</Streamdown></div> })
