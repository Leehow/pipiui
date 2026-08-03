# PipiUI jcode engine backend — dual-engine, session-pinned design

> Status: **design, pending implementation plan.**
> Date: 2026-08-03.
> Scope: add jcode as a second agent engine alongside pi, switchable per session,
> with the two engines fully isolated except for shared model auth.

## Background & motivation

PipiUI today drives a single engine: the `pi-coding-agent` Node.js CLI via
`pi --mode rpc` (`Sources/PipiUI/PiProcess.swift:60`). All multi-agent
orchestration — Boss/lead/worker fan-out, worktree isolation, agent leases,
depth guardrails — is implemented **in PipiUI itself** through the Philosophy
layers (`Sources/PipiUI/PiPhilosophy/layers/30-orchestration.md`,
`40-fanout.md`), the `subagent` extension (`Sources/PipiUI/PiExt/subagent/`),
and the Swift-side `SubagentStore`.

[jcode](https://github.com/1jehuang/jcode) is a separate Rust harness that
ships **native Swarm**: agents spawn their own teammates, the server manages
collaboration and resolves conflicts, and the root agent becomes a coordinator
while spawned agents work in parallel. This covers, out of the box, what
PipiUI hand-builds for pi.

We want both engines, switchable per session with one control, fully isolated.
This keeps the proven pi/Philosophy path untouched while letting users opt into
jcode's native swarm model where "the agent orchestrates itself" is preferable
to "PipiUI dictates the dispatch shape."

### Non-goals

- **Not** migrating pi sessions to jcode. The pi path is preserved verbatim.
- **Not** deleting the Philosophy/subagent orchestration code. It stays for pi.
- **Not** unifying subagent state into one store. jcode swarm keeps its own.
- **Not** making a session switchable mid-life. Engine is pinned at creation;
  switching means starting a new session.

## Core decisions (approved)

1. **Dual backend, session-pinned.** A `ChatSession` is created with an
   `engineKind` (`.pi` or `.jcode`); it never changes. UI exposes one control
   at new-session time and a per-session badge in the sidebar.
2. **Abstract one protocol: `AgentSessionBackend`.** `ChatSession` talks to
   `any AgentSessionBackend` instead of `PiProcess` directly. PiBackend wraps
   the existing logic; JcodeBackend is new. The UI layer is unchanged.
3. **pi-only features stay pi-only.** `fork` / `branch` / `switch_session` /
   `get_commands` do not enter the protocol. In jcode mode their UI is hidden
   or disabled; jcode may or may not grow equivalents later (out of scope).
4. **Shared model auth, nothing else.** OAuth tokens in
   `~/.pi/agent/auth.json` are imported by jcode automatically; API keys in
   `~/.pi/agent/.env` are injected into the spawned jcode process via the same
   mechanism pi already uses. PipiUI never writes jcode's own credential files.
5. **Parallel isolation for config and sub-agent state.** jcode gets its own
   feature-set model and its own swarm store; it does not reuse
   `BuiltInFeatureSettings` or `SubagentInfo`.

## Architecture

```text
                    ┌─────────────────────────────────────┐
   UI (unchanged)   │ ChatDetailView / MessageViews / ... │ consumes ChatItem
                    └─────────────────┬───────────────────┘
                                      │ @ObservedObject
                    ┌─────────────────▼───────────────────┐
   ChatSession      │ engineKind + any AgentSessionBackend│ delegates events
   (small change)   │  pi-only branch keeps fork/branch   │
                    └───────┬───────────────────┬─────────┘
                            │                   │
              ┌─────────────▼──────┐   ┌────────▼──────────┐
   backends   │   PiBackend        │   │   JcodeBackend    │
   (protocol) │  holds PiProcess   │   │  holds JcodeBridge│
              │  PiEventAdapter    │   │  JcodeEventAdapter│
              └────────────────────┘   └───────────────────┘
```

### The `AgentSessionBackend` protocol

Derived from the actual call sites on `ChatSession` (grep of
`proc.request` / `proc.send` / lifecycle):

| Protocol member | pi implementation | jcode implementation |
|---|---|---|
| `var onEvent: ((BackendEvent) -> Void)?` | `PiEventAdapter` translates pi's `agent_start` / `message_*` / `tool_execution_*` / `compaction_*` | `JcodeEventAdapter` translates jcode's `text_delta` / `tool_start` / `tool_done` / `turn_done` / `permission_request` |
| `var onExit: ((Int32, String) -> Void)?` | `PiProcess.onExit` | `JcodeBridge.onExit` |
| `var isRunning: Bool` | `PiProcess.isRunning` | bridge liveness |
| `sendPrompt(_:images:completion:)` | `request(["type":"prompt", ...])` | `send_message` request over the api-bridge socket |
| `loadHistory(completion:)` | `request(["type":"get_messages"])` | `get_history` request |
| `loadState(completion:)` | `request(["type":"get_state"])` | `getRuntimeInfo` request |
| `stop()` | `signalDescendants` + `terminate` | `cancel` / `soft_interrupt` |
| `forceKill()` | `PiProcess.forceKill` | kill the bridge subprocess |

`BackendEvent` is a single engine-agnostic enum both adapters emit:

```swift
enum BackendEvent {
    case turnStart
    case turnEnd
    case textDelta(/* streaming text */)
    case messageFinal(ChatItem)      // a complete message lands
    case toolStart(toolCallId, name)
    case toolUpdate(toolCallId, partial)
    case toolEnd(toolCallId, result, isError)
    case error(String)
    case compaction(...)             // pi only; jcode simply never emits it
}
```

`ChatSession.handleEvent(_ e: J)` (the pi-specific switch at
`ChatSession.swift:1665`) is **moved into** `PiEventAdapter`; `ChatSession`
gains a `handleBackendEvent(_ ev: BackendEvent)` that drives the same UI
state machine (streaming throttle, queue, quota binding) but on the unified
event type. The body of that state machine is reused, not rewritten.

### ChatSession change surface

- `private var proc: PiProcess?` → `private var backend: (any AgentSessionBackend)?`.
- The 17 pi-extension init parameters (`philosophyExtension`, `subagentDir`,
  `agentsDir`, ...) are grouped behind an `EngineConfig`; `ChatSession.init`
  branches on `engineKind`:
  - `.pi` → existing `PipiSpawnAssembly.assemble(...)` → `PiBackend`.
  - `.jcode` → new `JcodeSpawnAssembly` (builds `jcode api-bridge` args +
    env, with `.env` injected) → `JcodeBackend`.
- `proc?.request(...)` call sites become `backend?.sendPrompt(...)` /
  `loadHistory(...)` / `loadState(...)` / `stop()`.
- pi-only RPCs (`get_entries`, `fork`, `switch_session`, `get_commands`) are
  gated behind `if let pi = backend as? PiBackend { ... }` so they are inert
  in jcode sessions. The fork/branch UI reads `engineKind == .pi` to show or
  hide itself.

## JcodeBackend implementation

### Transport

Swift spawns `jcode api-bridge --api-socket <path>` (the documented stable
subcommand; alias `api`), then connects to the Unix-domain socket and speaks
**NDJSON** (one JSON object per line, no length prefix). This is exactly what
the official `@1jehuang/jcode-sdk` does internally
(`sdk/typescript/src/launch.ts`), so no Node bridge process is needed.

Protocol handshake (from `sdk/typescript/src/protocol.ts`):
client → `{ req: "hello", min_version, max_version, client }`,
server → `{ ev: "hello_ok", version, server, capabilities? }`,
`API_VERSION_MAJOR = 1`. After handshake the backend drives the session via
`create_session` / `send_message` / `cancel` / `soft_interrupt` /
`respond_to_permission`, and consumes the event union (`text_delta`,
`tool_start`, `tool_done`, `turn_done`, `permission_request`, `session_status`,
...). Unknown `ev` values are ignored — the protocol explicitly allows new
events within v1.

The socket-path resolution rules from `sdk/typescript/src/sockets.ts` must be
matched (honor `JCODE_API_SOCKET` / `JCODE_SOCKET` / `JCODE_RUNTIME_DIR` /
`XDG_RUNTIME_DIR` / `TMPDIR`). On macOS this is a plain Unix socket.

### Auth

- **OAuth (Claude / Codex / Gemini / Grok / GLM / Kimi / Qoder — subscription
  providers):** jcode discovers `~/.pi/agent/auth.json` automatically and
  imports it after a one-time confirmation. PipiUI does nothing but surface a
  hint in the UI.
- **API keys (DeepSeek / OpenRouter / SiliconFlow / Moonshot / Anthropic /
  OpenAI / ...):** PipiUI reuses `ChatSession.mergedSpawnEnv`
  (`ChatSession.swift:883`) — the same `~/.pi/agent/.env` it already injects
  into pi — and merges it into the jcode bridge's environment. Variable names
  (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`,
  `ZAI_API_KEY`, ...) overlap because pi's `ProviderEnvMap`
  (`Sources/PipiUI/ProviderEnvMap.swift:25-65`) already uses the standard names
  jcode recognizes.

PipiUI must **never** write `~/.jcode/auth.json` or any other jcode credential
file: token refresh, expiry, and file format are jcode's responsibility, and
fighting them produces stale-token bugs. PipiUI bridges only the `.env` layer.

### Swarm

jcode Swarm has **no external control API** (confirmed: the TS SDK exposes
zero swarm methods, and `docs/SWARM_ARCHITECTURE.md` describes it as internal).
Therefore JcodeBackend drives a **single root session** and lets the agent
spawn its own swarm internally. Swarm events surface as ordinary
`tool_*` / `session_status` events in the stream; PipiUI observes, it does not
command the topology. This is the intended ceiling for external swarm control.

## Isolation matrix

| Layer | pi | jcode | Shared |
|---|---|---|---|
| Process backend | `PiBackend` (wraps `PiProcess`) | `JcodeBackend` (wraps `JcodeBridge`) | `AgentSessionBackend` protocol |
| Event adapter | `PiEventAdapter` (today's `handleEvent`) | `JcodeEventAdapter` | `BackendEvent` enum |
| Engine config | `PipiSpawnAssembly` + existing paths | `JcodeSpawnAssembly` (new) | — |
| Feature switches | `BuiltInFeatureSettings` (philosophy, subagent, browser, ...) | `JcodeFeatures` (new) | — |
| Sub-agent state | `SubagentStore` + `SubagentInfo` (depth, worktree, verify, closeout) | `JcodeSwarmStore` (new; jcode's own model) | — |
| Model auth | OAuth via `auth.json`; API key via `.env` | auto-import + `.env` injection | **`~/.pi/agent/.env` + `auth.json`** |
| Message model | `ChatItem` / `ChatBlock` | `ChatItem` / `ChatBlock` | **`ChatItem`** |

The UI layer (`MessageViews`, `InputBar`, `SidebarView`, the bulk of
`ChatDetailView`) depends only on `ChatItem` and `ChatSession`'s
`@Published` surface, so it is unchanged.

## Session-level engine selection

- New field on `ChatSession`: `let engineKind: EngineKind` where
  `enum EngineKind { case pi, jcode }`.
- New persisted field on `SessionMeta` (`AppStore.swift:5`) so resume restores
  the right engine.
- `AppStore.createSessionInBackground(project:engine:)` threads the choice
  through `makeSession` → `ChatSession.init`.
- Sidebar: a small per-session badge shows the engine; the new-session control
  is a segmented `pi | jcode` selector.

## Risks & mitigations

- **jcode `api-bridge` is single-vendor, in flux.** Pin a jcode version;
  re-validate the `ev` union on upgrade; treat unknown events as no-ops (the
  protocol permits this). Add a startup capability check that surfaces a clear
  error if `jcode api-bridge` is missing or the wrong version.
- **Swarm write isolation unknown.** jcode claims its server "resolves
  conflicts" among swarm agents, but whether that isolation is worktree-level
  (like pi's `resolveSubagentWorktree`) is unconfirmed. "Single-writer" below
  refers only to the **PipiUI↔jcode** boundary: PipiUI itself does not issue
  parallel writes — the swarm's internal parallelism is entirely jcode's
  concern. Before relying on safe concurrent file edits across swarm members,
  confirm the isolation level; for the first cut, document the assumption.
- **No external swarm control.** Accepted: PipiUI observes, the agent
  orchestrates. If users later need to command topology, that is a separate
  proposal (it would require jcode-side support that does not exist today).
- **pi-only features go dark in jcode mode.** Accepted per the approved
  decision; UI hides fork/branch/etc. when `engineKind == .jcode`.
- **Two backends to maintain long-term.** Accepted: the protocol boundary keeps
  them decoupled, and the shared `ChatItem`/`BackendEvent` models limit drift.

## Open questions deferred to the implementation plan

- Exact `BackendEvent` payload shapes (text-delta chunk, tool partial, image
  backfill) — to be pinned against both engines' real streams in the plan.
- How `loadHistory`'s result maps onto `ChatItem` for jcode (pi uses an entry
  tree; jcode uses a flat history) — adapter concern, resolved in the plan.
- Whether the `pi` session-title side-channel (`SessionTitleClient`) needs a
  jcode equivalent or whether jcode's own session naming suffices.

## References

- jcode repo: https://github.com/1jehuang/jcode · SDK docs: https://jcode.sh/sdk
- jcode OAuth import: https://github.com/1jehuang/jcode/blob/master/OAUTH.md
  (explicitly lists `~/.pi/agent/auth.json` as an import source)
- Key jcode source paths (repo-relative): `src/cli/args.rs` (`ApiBridge`
  subcommand), `sdk/typescript/src/{framing,protocol,launch,sockets,client}.ts`
- Key PipiUI paths: `Sources/PipiUI/PiProcess.swift`,
  `Sources/PipiUI/ChatSession.swift` (esp. `:868` proc, `:1665` handleEvent,
  `:883` mergedSpawnEnv, `:934` init), `Sources/PipiUI/PipiSpawnAssembly.swift`,
  `Sources/PipiUI/SubagentStore.swift:44` (SubagentInfo),
  `Sources/PipiUI/ProviderEnvMap.swift:25`, `Sources/PipiUI/AppStore.swift:5`
  (SessionMeta), `AppStore.swift:1789` (createSessionInBackground).
