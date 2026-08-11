/**
 * Parse the compact final-result notice emitted for a subagent. Kept outside
 * App so consumers/tests do not need to load browser-only panels (xterm).
 */
const SUBAGENT_NOTICE_RE = /^(?:子任务(?:完成|结束)?|subagent(?:\s+(?:task\s+)?)?(?:done|finished|completed|failed)?)(?:\s*[·:：]\s*|\s+)(.+?)\s*[·:：]\s*(ok|failed)\s*[·:：,，\s]+cost\s*[¥$￥]\s*(\d+(?:\.\d+)?)\s*$/i

export function parseSubagentNotice(content: string): { name: string; ok: boolean; cost: string } | null {
  const match = content.trim().match(SUBAGENT_NOTICE_RE)
  if (!match) return null
  return { name: match[1].trim(), ok: match[2].toLowerCase() === 'ok', cost: `¥${match[3]}` }
}
