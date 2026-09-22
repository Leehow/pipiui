# Jev session context selection

User-approved scope: upgrade the optional Jev optimizer to select task-relevant tools
and philosophy guidance before the first model request, then retain selected material
and add missing capabilities during the session. Follow-up authorization: commit this
change, rebuild and restart the canonical App, then test it. No push requested.

Ownership: primary checkout `0.1.0版本`, starting HEAD `986381ee`; existing dirty Jev
browser integration and other concurrent work must remain intact. Do not change branches
under concurrent work. Add independent modules and narrowly integrate existing seams.

Design evidence: TypeSafe official skill and live API/Noul docs (2026-09-22) recommend
independent typed judgments over bounded state, host-owned exact materialization and
evaluated thresholds. Pi input hooks precede system assembly; tools can be selected there.
Philosophy already owns eligible layers and resolved text. Native tool additions can
invalidate provider caches; promise stable bytes, not universal cache hits.

Steps:
1. Add optional bounded batched Noul selection, session retention and recovery/discovery.
2. Connect philosophy contributions, final prompt freezing, host settings and mount order.
3. Verify real Pi request assembly with controlled Jev/provider responses, failure and
   resume paths, build touched workspaces and document measured limits.

Acceptance: unavailable service preserves baseline; existing enabled-tool authority is
never widened; first selection excludes irrelevant tools AND guidance; later selection
only adds; selected text remains frozen; resumptions restore selection; explicit recovery
can add missed capabilities; tool-loop calls do not repeatedly invoke Jev; cancellation
and disable stop new uploads; existing Jev browser/retrieval tests stay green.

Status: source implementation complete (Jev optimizer 1.1.0).

Implemented: optional project setting and revocation, batched bounded Noul transport,
eligible layer publication, dependency closure, frozen system prompt and selected text,
append-only supplements, native-tool union, explicit discovery/loading, branch-scoped
persistence, compaction rebase, model/tool-scope epochs and default-off worker isolation.
The first version uses existing philosophy layer boundaries; it does not rewrite or
semantically summarize their rules. Mandatory and user-authored layers remain pinned.

Validation: 240 targeted Vitest cases across context selection, Jev host state,
philosophy, spawn, base-prompt lock and browser integration; 53 existing Jev unit cases;
Jev build and pi-backend build passed. The raw node:test suite uses unref'd timeout
timers in pre-existing transport tests; a test-runner keepalive with after() cleanup
was used to let those deadline tests finish (no production timer changes).

The context integration cases use the real Pi SDK, real philosophy composer and tool
loop with controlled Jev responses and a faux provider. Resume testing caught and fixed
custom_message deduplication, and compaction has an epoch-scoped supplement regression.
No installed-App, live TypeSafe selection-quality, real cache-hit or latency claim is made.
Source-only phase performed no commit, packaging, restart or push. The authorized
delivery phase is now in progress: scoped commit followed by canonical packaging and
live acceptance. User-facing behavior and limitations:
`docs/jev-context-selection.md`.
