# Subagent Selective Absorption V1

Status: foundation implemented; scheduler integration deliberately deferred

Date: 2026-08-11

Upstream reference: [`nicobailon/pi-subagents` v0.45.2](https://github.com/nicobailon/pi-subagents/tree/v0.45.2)

## Objective

Strengthen PipiUI's existing subagent system by reimplementing a small set of
high-value ideas proven by `pi-subagents`, without replacing PipiUI's scheduler
or importing a second runtime. V1 establishes a pure, versioned, monotonic
capability-ceiling contract. Later slices may add launch preflight, private
child context, and acknowledged lifecycle controls behind explicit PipiUI
interfaces.

Success means PipiUI can narrow a child or resumed run's tool, agent, and
extension authority deterministically at every delegation boundary. This
foundation alone is not user-visible integration and does not claim that the
current scheduler enforces the ceiling yet.

## Current system and upstream boundary

PipiUI already owns product-specific behavior that upstream does not replace:

- the `single`, `parallel`, and `chain` scheduler, dispatch queue, boss ledger,
  retry and recovery behavior;
- stable `agentId` identity plus per-execution `runId` identity;
- Swift `SubagentStore` projection, UI state, logs, notifications, and restart
  reconciliation;
- MemoryBroker storage, ACLs, and capability-aware memory access;
- macOS TCC and desktop/Computer Use grants;
- task-owned worktree creation, automatic integration, verification,
  pending-review, closeout, and recovery semantics.

`pi-subagents` v0.45.2 is used as design evidence for private skills,
child-only extensions, monotonic capability ceilings, launch preflight,
acknowledged control, and machine-readable lifecycle records. Its scheduler,
Fleet/Herdr UI, missions, memory store, watchdog, and managed-worktree behavior
are not adopted. The upstream project is MIT-licensed. This implementation is
an independent, small reimplementation of semantics; it copies no upstream
source, so no new third-party notice is required for this slice.

## Exact V1 scope

V1 adds one pure TypeScript module:

`Sources/PipiUI/PiExt/subagent/capability-ceiling.ts`

It exposes:

- strict parsing and deterministic normalization of
  `SubagentCapabilityCeilingV1`;
- monotonic intersection/narrowing;
- authority comparisons that ignore diagnostic provenance;
- canonical bounded encoding and decoding for a future environment variable or
  launch descriptor transport.

The authority fields are:

- `version: 1`;
- optional `allowedTools`: absence is unbounded, while an empty array denies all;
- optional `allowedAgents`: absence is unbounded, while an empty array denies all;
- required `denyExtensions`: denial is sticky under intersection;
- optional bounded `provenance`: diagnostic-only labels with no authority.

## Non-goals

- No scheduler wiring or change to model-facing tools.
- No second scheduler, job registry, lifecycle owner, or memory store.
- No upstream package installation, vendoring, co-installation, or runtime
  import. Both systems register `subagent`, so co-installation is invalid.
- No arbitrary JavaScript workflow evaluator or `workflowScript` compatibility.
- No change to `agentId`, `runId`, bridge DTOs, Swift projection, MemoryBroker,
  desktop grants, TCC policy, or worktree behavior.
- No UI, package, application launch, migration of persisted state, or
  user-visible acceptance claim.

## Architecture and source-of-truth ownership

The design keeps one owner for each fact:

| Concern | Authoritative owner |
|---|---|
| Dispatch, job state, abort/retry, dependency scheduling | Existing PipiUI subagent extension |
| Stable agent and execution identity | Existing `agentId` + `runId` registry |
| Native projection and presentation | Swift `SubagentStore` and bridge |
| Memory data and ACL decisions | MemoryBroker |
| Desktop/TCC authorization | Existing native and subagent policy gates |
| Worktree create/merge/verify/recover | Existing PipiUI worktree lifecycle |
| Effective delegation ceiling | Future scheduler boundary, using this pure contract |
| Diagnostic ceiling provenance | This contract, explicitly non-authoritative |

The current `subagent-host` remains a projection/persistence boundary, not a
replacement scheduler. If an alternative runtime is ever evaluated, introduce
a small execution port (`preflight`, `launch`, `snapshot`, `steer`, `stop`,
`resume`, `result`, `worktreeHandoff`) and prove it with both the current
runtime and a pinned adapter. Do not layer two schedulers together.

## Capability-ceiling rules

Parsing fails closed. Objects must have exactly known keys, version 1, correct
types, bounded arrays and entries, no blank values, surrounding whitespace, or
control characters. Tool and agent sets are sorted and deduplicated. Authority
entries are limited to 256 items and 128 UTF-8 bytes per item. Provenance is
limited to 8 items and 128 UTF-8 bytes per item.

Intersection is the only composition operation:

- when both sides bound a dimension, use set intersection;
- when one side is unbounded, the bounded side wins;
- when both sides are unbounded, the result remains unbounded;
- `denyExtensions` uses logical OR and therefore cannot be cleared downstream;
- provenance uses deterministic sorted union, capped to the lexically first
  eight entries. It cannot affect an authority comparison.

Transport is canonical JSON encoded as unpadded base64url with the `scv1.`
prefix. Encoded input is capped at 32,768 UTF-8 bytes. Decode rejects wrong
prefixes, malformed or non-canonical base64url, invalid JSON, unknown fields,
non-normalized data, incompatible versions, and oversized payloads. The module
has no filesystem, process-environment, network, scheduler, or mutable global
dependency.

## Security and trust rules

1. A parent effective ceiling must always be intersected with a child's
   requested ceiling. A request is never authoritative by itself.
2. Nested delegation, asynchronous launch, resume, retry, and recovery must
   propagate the effective result, not the original request.
3. Missing or malformed transported data must deny launch once enforcement is
   enabled; it must never silently become unbounded.
4. `provenance` is safe diagnostic metadata only. No code may grant authority
   based on its value.
5. A ceiling limits declared authority but is not an OS sandbox. Existing
   filesystem, shell, MCP, desktop/TCC, and worktree enforcement remains
   mandatory.
6. The transport may be logged only after confirming it contains identifiers,
   not secrets. Callers must not place credentials or prompts in provenance.
7. Version mismatches fail closed. No V1 reader guesses at a future schema.

## Staged rollout

### Stage 0 — pure foundation (this slice)

Ship the versioned module and focused property/example tests. Do not import it
from the scheduler. This makes review and integration independent of current
scheduler WIP.

### Stage 1 — shadow preflight

At one central launch boundary, derive a requested ceiling from the selected
agent package and intersect it with the inherited ceiling. Produce a launch
digest containing version, normalized authority, resolved model/tools/agents,
and acknowledged child configuration. Shadow mode records mismatches but does
not alter launches. Never encode prompts or secrets in the digest.

### Stage 2 — read-only enforcement

Enforce the ceiling for bundled read-only `scout` and `reviewer` roles. Cover
foreground, background, retry, resume, and one nested delegation. Abort launch
on absent/malformed inherited data after the parent declares ceiling support.

### Stage 3 — writer and desktop enforcement

Only after read-only acceptance, enforce writer roles and integrate the ceiling
with existing agent-package capability compilation, MCP allowlists,
MemoryBroker ACLs, desktop grants, and worktree lifecycle. Existing native
gates remain independently authoritative.

### Stage 4 — optional additional absorption

Evaluate private skills/child-only extensions, acknowledged steer/stop/resume,
and machine-readable lifecycle artifacts as separate specs. Do not add
`workflowScript`, missions, Fleet/Herdr, or a second memory store by default.

## Compatibility and versioning

- V1 is identified both by the object field `version: 1` and transport prefix
  `scv1.`.
- Additive fields still require a new version because V1 rejects unknown keys.
- V2 must use a new type/parser/transport prefix and an explicit conversion
  policy; V1 callers must continue to fail closed on it.
- Persisted job state must not be rewritten during shadow rollout. If a future
  persisted descriptor adds the V1 value, old jobs are either handled by an
  explicit legacy path before enforcement or stopped with a visible recovery
  reason; absence must not be guessed.
- Any experimental upstream adapter must pin an exact released version and
  integrity/commit. Following upstream `main` is prohibited for product builds.

## Acceptance matrix

| Requirement | Foundation evidence | Integration evidence required later |
|---|---|---|
| Sorted/deduplicated stable representation | Focused Node test | Launch digest snapshot |
| Commutative/associative/idempotent authority narrowing | Focused Node test | Nested and resumed run traces |
| Child cannot add tool/agent or clear denial | Focused Node test | Rejected launch/tool-call probes |
| Bounded/unbounded semantics | Focused Node test | Legacy-to-enforced transition cases |
| Provenance bounded and non-authoritative | Focused Node test | Safe diagnostics inspection |
| Malformed/version/type/size input fails closed | Focused Node test | Launch refusal and UI recovery reason |
| Deterministic transport round trip | Focused Node test | Parent/child descriptor acknowledgment |
| PipiUI identity/projection unchanged | Not touched | Same `agentId`/`runId`, cards, logs, restart state |
| Memory/TCC/worktree semantics preserved | Not touched | Real broker, desktop gate, merge/recovery acceptance |

Stage 0 is accepted when the focused test passes, source syntax/type stripping
is valid, the scoped diff is clean, and no scheduler or unrelated file changed.
It must be reported as foundation only.

## Migration and rollback

There is no persisted-data migration in Stage 0. Later shadow integration must
be guarded by a default-off feature flag and emit both requested and effective
digests without changing dispatch. Rollback is removal/disablement of that one
integration call and descriptor field; existing scheduler, state, memory,
desktop grants, and worktrees continue unchanged.

Enforcement rollout must be role-scoped and reversible. Never downgrade a
ceiling to restore compatibility. If a child cannot acknowledge the exact V1
descriptor, stop that launch or route it through the explicitly documented
legacy path while shadow mode remains active.

## Existing-WIP integration blockers

The primary checkout already contains concurrent, unintegrated subagent work
in scheduler/bridge-related files, including `index.ts`, `boss-ledger.ts`,
`desktop-tool-policy.mjs`, dispatch queue and worktree-finalization work, plus
Swift `SubagentStore` maintenance. Those edits are not owned by this slice and
may change the correct launch seam, lifecycle events, or identity plumbing.

Before Stage 1:

1. identify and integrate or explicitly retain the owners of those changes;
2. establish a clean integration base and rerun current subagent Node tests;
3. choose exactly one launch boundary after queue admission but before process
   spawn, retry, or resume;
4. define the descriptor/bridge field and absence behavior;
5. verify the chosen seam does not move worktree, memory, TCC, or Swift source
   of truth into this module.

Until those blockers are resolved, wiring this module would risk binding to a
moving scheduler and is intentionally out of scope.
