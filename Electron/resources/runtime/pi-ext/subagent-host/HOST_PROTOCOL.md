# Portable subagent host v1

`subagent-host/` is the Node/Electron-main portability boundary for host-side
**projection, plan state, persistence, and optional worktree finalization**. It
is not a replacement scheduler.

Public entry point: `index.ts`, with `SUBAGENT_HOST_VERSION === 1`.
It exports `contract`, `env`, `server`, `state`, `worktree`, `runtime`, and the
Node-only `electron-main` reference helper. Every wire/state contract here uses
`schemaVersion: 1`.

## Short Electron-main integration

1. Create `createElectronMainSubagentHostV1({ runtime, capabilities, spawn })`.
   It generates one opaque session capability unless the host injects one.
   Supply caller-owned storage and paths for agent/plan state; no default app-data
   path is derived.
2. Subscribe before `start()` with `onJobsSnapshot`, `onPlan`,
   `onWorktreeFinalization`, and/or `onError`. UI should render the copied
   `JobsSnapshotV1`, not reducer rows/logs.
3. Call `start()` to load durable projections and bind a real loopback `/rpc`
   server. It returns validated `HostCapabilitiesV1`, `PIPIUI_*` environment,
   and a caller-owned `{ command, args, cwd, env }` spawn specification. A
   template `bridge.host` selects the bind host when `start()` omits one; a
   conflicting explicit host is rejected so advertised and actual endpoints match.
4. Electron launches and supervises its own Pi process using that specification.
   The helper deliberately does not spawn, kill, restart, or resume anything.
5. Feed canonical v1 observations to the bridge; call
   `runtime.applyExtensionSnapshot(...)` only when an extension-owned reconnect
   snapshot is available. `runtime.snapshot()` is display-only.

## Bridge migration

There is one loopback endpoint: `POST /rpc`. The extension emits exactly one
body per observation; it never dual-sends legacy and canonical events.

- **Default / current Swift host:** no `PIPIUI_HOST_PROTOCOL` flag means the
  existing flat `{ sessionKey, action: "agent_event", ...event }` body. It now
  carries the extension-captured `runId` on every agent event. For a reused
  row, Swift ignores run-scoped non-start reports whose `runId` no longer
  matches; historical run-less bodies retain legacy compatibility.
- **Electron canonical opt-in:** `buildSubagentEnvironmentV1` exports
  `PIPIUI_HOST_PROTOCOL=1`, `PIPIUI_SESSION_CAPABILITY`, and the same opaque
  value as `PIPIUI_SESSION_KEY` for legacy sibling extensions. Canonical agent
  bodies are `{ schemaVersion: 1, sessionCapability, action: "agent_event",
  event: { schemaVersion: 1, ... } }`; they read only `sessionCapability`.
- The extension is the identity source of truth. `start`, `update`,
  `log_delta`, `log`, `usage`, `stalled`, `end`, and `closeout` all carry their
  dispatch-captured `agentId + runId`. The host never guesses a run from bare
  `agentId`. Historical pre-runId records may only be upgraded by a trusted
  adapter supplied with an externally authoritative run ID.

`host-bridge.ts` also encodes canonical `plan_event` envelopes. The
Swift-generated `PlanRuntimeExtension` remains legacy in this slice; wiring it
to an Electron canonical adapter is a host-adapter follow-up and does not block
the canonical subagent agent-event flow.

## Source-of-truth boundary

| Owner | Owns | Does not own |
| --- | --- | --- |
| `PiExt/subagent/index.ts` | Dispatch, `jobRegistry`, captured `agentId + runId`, running handles, abort/recover, retry/resume, done delivery | Host persistence/UI projections or identity inference |
| `runtime.ts` | Exact `agentId + runId` projection, plan reducer/revisions, durable display state, loopback callbacks | Dispatch, resume, abort, worker termination |
| `worktree/` | Audited Git inspection/finalization after explicit host opt-in | Worktree creation, scheduler policy, implicit reconnect actions |
| PipiUI Swift host | Existing `BridgeServer`, `SubagentStore`, `PlanStore`, native worktree/TCC behavior | Electron adapter behavior |
| Electron main adapter | Capability, paths, storage, process launch policy, platform routes | Renderer-side scheduling or permission bypasses |

`agent_event` is decoded, reduced by exact run identity, persisted, then
notified. A `closeout` applies only to an existing terminal failed/aborted/
interrupted run with the exact key; it marks display disposition `cleaned` while
preserving terminal state, verification, and `pendingReview` worktree evidence.
Duplicate, early, successful-run, and stale-run closeouts are no-ops. It never
starts recovery, merge, resume, or other scheduler work. `plan_event` is
decoded, reduced purely, persisted when applied, and returns the reducer-owned
`PlanRevisionResponseV1`. State saves use a
same-directory staging write followed by rename; the caller-owned storage
adapter remains responsible for any cross-process coordination and durability
policy beyond that replacement boundary. Callback failures/timeouts are bounded
and reported; they do not manufacture terminal events or roll back
already-persisted observations. Runtime `start()`/`stop()` calls are serialized,
and the reference server serializes admitted bridge handlers FIFO.

## Reconnect and optional worktrees

`selectJobsSnapshotV1` serializes a stable, copied `JobsSnapshotV1` from the
agent projection. It omits reducer logs and mutable internal maps. Applying an
extension-authoritative snapshot only reconciles that projection; it cannot
start, resume, abort, kill, or merge a job.

Worktree finalization is **off by default**. It runs only with
`worktreeFinalization: { enabled: true, mainCwd, ownership, ... }` and a
caller-injected `worktreeFinalizationsPath`. On a terminal projection with a
recorded worktree, the runtime builds `WorktreeFinalizationInputV1`, calls the
existing `WorktreeFinalizationServiceV1`, persists its structured result, then
notifies subscribers. No finalization is triggered by load or reconnect. The
service retains unsafe/failed work, uses direct argv rather than shell commands,
and does not perform destructive reset/clean routes.

## Platform/TCC and Swift resource compatibility

`HostCapabilitiesV1.platform` advertises opaque routes only. Electron/PipiUI
must inject `onPlatform` for computer, search, or memory operations; this slice
does not implement TCC checks, screen geometry, permission prompts, or process
supervision.

PipiUI Swift is not switched to this Node runtime in this slice. `Package.swift`
already copies the whole `PiExt` tree, so bundled files and JSON v1 fixtures are
kept as resource-compatible contracts. The Swift test only verifies their
presence and `JSONSerialization` readability; it does not reimplement either
reducer.
