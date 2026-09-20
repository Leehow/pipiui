/** Generated public-safe code only. No file from the opened repository enters this corpus. */
export const SYNTHETIC_CASES = [
  { id: "renew-token", query: "where an expired access token is renewed and replaced", variants: ["refresh expired token credential", "request new access token"],
    comment: "Request a new credential and replace the expired access token.", code: "export async function renew(session, api) { const next = await api.refresh(session.refreshToken); session.accessToken = next.accessToken; return next; }" },
  { id: "cancel-request", query: "which code actually cancels an in flight request", variants: ["AbortController abort pending fetch", "stop active network request"],
    comment: "Interrupt the active network operation through its cancellation signal.", code: "export function cancelActive(controller) { controller.abort(new Error('cancelled')); }" },
  { id: "contain-path", query: "哪里检查路径没有越过项目目录", variants: ["reject parent traversal outside project root", "relative path containment check"],
    comment: "Reject resolved file paths that escape the project root.", code: "export function contained(relativePath) { return relativePath !== '..' && !relativePath.startsWith('../') && !relativePath.startsWith('/'); }" },
  { id: "decode-stream", query: "where UTF8 chunks are decoded without losing split characters", variants: ["incremental TextDecoder stream true", "preserve character boundary across byte chunks"],
    comment: "Decode partial byte sequences while preserving unfinished characters.", code: "export function decodeChunks(chunks) { const decoder = new TextDecoder(); return chunks.map(chunk => decoder.decode(chunk, { stream: true })).join('') + decoder.decode(); }" },
  { id: "retry-quota", query: "where a rate limited request is retried after waiting", variants: ["429 retry after delay", "wait then retry throttled request"],
    comment: "Wait for the server retry interval before repeating a throttled call.", code: "export async function retry(request, sleep) { const response = await request(); if (response.status !== 429) return response; await sleep(response.retryAfterMs); return request(); }" },
  { id: "dedupe-records", query: "where repeated record IDs are removed while preserving order", variants: ["unique record ids stable first occurrence", "Set deduplicate records"],
    comment: "Keep the first record for each identity in input order.", code: "export function unique(records) { const seen = new Set(); return records.filter(record => { if (seen.has(record.id)) return false; seen.add(record.id); return true; }); }" },
  { id: "stable-score", query: "which sorting code keeps original order when scores tie", variants: ["stable score tie break original index", "descending scores preserve ties"],
    comment: "Order by descending score and retain input order for equal scores.", code: "export function ranked(items) { return items.map((item, index) => ({ item, index })).sort((a, b) => b.item.score - a.item.score || a.index - b.index).map(row => row.item); }" },
  { id: "redact-log", query: "where a credential is removed from text before writing a log", variants: ["redact credential before log write", "replace secret string with redacted marker"],
    comment: "Remove a known credential before any log sink receives the text.", code: "export function safeLog(text, credential, logger) { const clean = credential ? text.split(credential).join('[REDACTED]') : text; logger.write(clean); }" },
  { id: "expire-cache", query: "哪里会删除过期缓存而不是继续返回旧值", variants: ["evict expired cache entry by expiresAt", "cache TTL expiration delete old value"],
    comment: "Reject and remove cached values whose expiration time has passed.", code: "export function cached(cache, key, now) { const entry = cache.get(key); if (!entry) return; if (entry.expiresAt <= now) { cache.delete(key); return; } return entry.value; }" },
  { id: "atomic-save", query: "where a file is written atomically using a temporary file and rename", variants: ["atomic file replacement temp rename", "write temporary then replace destination"],
    comment: "Write a complete temporary file before atomically replacing the destination.", code: "export async function save(fs, target, content) { const tmp = target + '.tmp'; await fs.writeFile(tmp, content); await fs.rename(tmp, target); }" },
];

export function generatedFiles(def) {
  const label = JSON.stringify(def.query);
  return [
    { path: `${def.id}/work.ts`, text: `/** ${def.comment} */\n${def.code}\n` },
    { path: `${def.id}/audit.ts`, text: `/** ${def.query}. Audit only: never executes this operation. */\nexport function audit(logger) { logger.info(${label}); }\n` },
    { path: `${def.id}/options.ts`, text: `/** Configuration labels for: ${def.query}. No operational code. */\nexport const options = { label: ${label}, visible: true };\n` },
    { path: `${def.id}/view.ts`, text: `/** Display text for: ${def.query}. No operational code. */\nexport function title() { return ${label}; }\n` },
  ];
}

export function liveSyntheticAllowed(argv, env) {
  if (argv.some((arg) => arg === "--project" || arg.startsWith("--project=") || arg === "--source" || arg.startsWith("--source="))) {
    throw new Error("Synthetic evaluation never accepts a repository/source path.");
  }
  if (!argv.includes("--live-synthetic")) return false;
  if (!env.TYPESAFE_API_KEY?.trim()) throw new Error("TYPESAFE_API_KEY must be supplied through a secure environment mount.");
  return true;
}
