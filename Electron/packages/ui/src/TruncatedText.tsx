import { useState } from 'react'

/** Default preview budget for tool/activity output. Keep this a named constant so callers and tests stay aligned. */
export const TOOL_OUTPUT_DISPLAY_LIMIT = 12_000

export function TruncatedText({
  text,
  limit = TOOL_OUTPUT_DISPLAY_LIMIT,
}: {
  text: string
  limit?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const truncated = text.length > limit
  // slice + length only: spreading a 100k+ string into code points would itself stall the main thread.
  const visible = truncated && !expanded ? text.slice(0, limit) : text

  return <>
    {visible}
    {truncated && <span className="truncated-text-bar">
      {!expanded && <span className="truncated-text-hint">已截断显示前 {limit} 字符，共 {text.length} 字符</span>}
      <button type="button" className="truncated-text-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        {expanded ? '收起' : '展开全文'}
      </button>
    </span>}
  </>
}
