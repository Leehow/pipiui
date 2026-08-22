# Vendored context-fold provenance

- Upstream: `Middlewatch/context-fold`
- Version: `0.3.2`
- Commit: `4881382bc6a5acaaf8e346a5f36a4c62cf0d3ae3`
- License: MIT; the upstream license is preserved in `LICENSE`.

The runtime source, entry point, and upstream test suite were vendored from that commit. PipiUI
does not install this package globally and does not bundle its development dependencies. Pi
provides the extension API and `typebox` virtual modules at runtime.

## PipiUI deviations

- Text-only `toolResult` observations may fold. In addition, a discrete completed-tool-use event
  (40 eligible uses by default, preserving the newest 12 pairs and requiring at least 10,000
  estimated saved tokens) may replace only the arguments object of an old, successful, matched
  `subagent` call. Exact original arguments are committed through the same session-local
  spool/index path first; the replacement is a deterministic receipt with recall code, SHA-256,
  original size, and preview. The wire path independently rechecks the fixed `subagent` allowlist,
  durable pair, success, working tail, held, and frozen guards. Assistant text, signed
  thinking/reasoning blocks and signature fields, user messages, images, errors, unmatched calls,
  and every other tool's arguments remain byte-for-byte raw.
- Older successful `subagent_status` results are superseded only when a later successful result has
  the exact same structured `agentId` and `runId`; the newest, errors, other runs, and the protected
  tail stay raw. This is a discrete frozen layer, not persisted-history rewriting.
- Defaults are an absolute 150,000-token cap, a 30,000-token protected recent tail, native Pi
  hard compaction, and 30-day spool retention. Explicit process/project environment values keep
  their normal higher precedence. Native mode registers no `session_before_compact` handler, so
  it cannot displace PipiUI's last-wins compaction owner; only explicit `CONTEXTFOLD_COMPACT=det`
  opts into the vendored deterministic handler.
- The PipiUI host owns a dedicated default-on `contextFold` spawn feature and resolves this exact
  `index.ts` from the installed project runtime. A missing asset or disabled feature omits the
  mount; `CONTEXTFOLD=0` remains the extension-level kill switch.
- Spool and seed-index paths remain the upstream session-local layout rooted exclusively at
  `ctx.sessionManager.getSessionDir()`. Spool/index persistence remains a precondition for a fold
  to reach the provider; failures send the raw context.
- Anthropic provider-native `clear_tool_uses` / `clear_tool_inputs` remains deferred: the scoped
  extension has no typed provider-payload capability seam, and the active Kimi-compatible route
  has no verified support. This deviation is deliberately provider-generic and local.
- The outbound `context` view makes every completed prior user turn's thinking eligible by default
  (`CONTEXTFOLD_THINKING=0` disables it and `CONTEXTFOLD_THINKING_KEEP_TURNS` overrides the
  protected recent-turn window). The newest/current turn remains protected. This is a
  provider-deny-by-default PipiUI transform: cross-model thinking is dropped;
  completed old Anthropic blocks and no-tool official DeepSeek/generic unsigned reasoning use
  narrow source-backed rules; current/incomplete turns and strict signed/tool-coupled islands stay
  byte-exact. A strict over-age island triggers Pi's existing `ctx.compact()` once after
  `agent_settled`, replacing the old region as a whole rather than separating reasoning from its
  tool protocol. Native mode still registers no `session_before_compact` hook.
