# Vendored context-fold provenance

- Upstream: `Middlewatch/context-fold`
- Version: `0.3.2`
- Commit: `4881382bc6a5acaaf8e346a5f36a4c62cf0d3ae3`
- License: MIT; the upstream license is preserved in `LICENSE`.

The runtime source, entry point, and upstream test suite were vendored from that commit. PipiUI
does not install this package globally and does not bundle its development dependencies. Pi
provides the extension API and `typebox` virtual modules at runtime.

## PipiUI deviations

- Only text-only `toolResult` observations may fold. Assistant text, thinking/reasoning, tool
  calls, user messages, images, and all other non-text parts remain byte-for-byte raw. The apply
  path independently rejects assistant-message fold operations so signed reasoning cannot be
  rewritten while retaining a provider signature.
- Defaults are an absolute 150,000-token cap, a 30,000-token protected recent tail, native Pi
  hard compaction, and 30-day spool retention. Explicit process/project environment values keep
  their normal higher precedence.
- The PipiUI host owns a dedicated default-on `contextFold` spawn feature and resolves this exact
  `index.ts` from the installed project runtime. A missing asset or disabled feature omits the
  mount; `CONTEXTFOLD=0` remains the extension-level kill switch.
- Spool and seed-index paths remain the upstream session-local layout rooted exclusively at
  `ctx.sessionManager.getSessionDir()`. Spool/index persistence remains a precondition for a fold
  to reach the provider; failures send the raw context.
