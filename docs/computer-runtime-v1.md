# PipiUI Computer Runtime v1

PipiUI exposes the desktop runtime to exactly one client: the bundled
`cua-extension` (`Electron/resources/runtime/extensions/cua-extension/`,
enabled by default, gated by the Settings → Computer Use master switch), which
registers the `computer` and `open_application` tools in the main Pi session.
PipiUI owns macOS permissions, capture, input delivery, target PID/window
validation, coordinate mapping, cancellation, request serialization, helper
lifecycle, and teardown. The extension owns tool schemas and descriptions,
prompting, routing, batching, retries, provider adaptation, and model-context
shaping.

There is no selectable/external strategy surface. Workers and subagents have
no desktop capability: `computer` / `open_application` are main-session-only
reserved tools, and no `PIPIUI_COMPUTER_*` value is exported to dispatched
agents.

The Cua helper is a private implementation detail. The extension reaches it
only through this contract, never by starting or calling the helper directly.

## Transport: host-capability broker

Driver calls do not use a dedicated `computer_*` bridge route anymore. Every
call travels as one versioned `HostCapabilityRequestV1` envelope over the
loopback bridge `host_capability` action (`POST http://127.0.0.1:$PIPIUI_BRIDGE_PORT/rpc`),
with `permission: "native.exec"` and `op: "native.cua"`; the exact
`computer_*` request body (including `sessionKey` and the desktop-grant
`computerCapability`) rides inside `params`. Before dispatch, the broker
re-negotiates the manifest `hostApi` range, re-checks the per-project
permission grant, verifies the desktop grant against the owning bridge
session, and consumes a one-time capability token the host minted via the
loopback `host_capability_token` op (single use, TTL-bound, context-bound).
The reference client is
`cua-extension/agent/host-capability-client.ts`; it never invents tokens and
fails closed when the host does not mint one.

## Discovery and lifecycle

PipiUI injects these environment variables into the owning top-level Pi
process. They are readable by every extension loaded in that process; treat
all of them as trusted.

| Variable | Meaning |
|---|---|
| `PIPIUI_BRIDGE_PORT` | Ephemeral loopback HTTP port. |
| `PIPIUI_SESSION_CAPABILITY` | Capability authenticating the bridge `host_capability` route. |
| `PIPIUI_SESSION_KEY` | Session key; the driver's pid/window owner-binding input inside `params`. |
| `PIPIUI_COMPUTER_CAPABILITY` | Desktop-grant capability, presented inside `params` and verified per session. |
| `PIPIUI_COMPUTER_RUNTIME_PROTOCOL` | Requested major protocol version (`1`). |
| `PIPIUI_COMPUTER_DISPLAY_ID` / `PIPIUI_COMPUTER_WIDTH` / `PIPIUI_COMPUTER_HEIGHT` | Initialization hints for the synchronous Anthropic typed-tool hook; runtime negotiation remains authoritative and a mismatch is rejected. |
| `PIPIUI_CUA_DRIVER_VERSION` | Pinned driver version (currently `0.23.2`). |

Capabilities are per session, remain in process memory, and must not be
written to disk or logs. Closing a session terminates its Pi process.
Disabling Computer Use means new sessions are spawned without the desktop
capability, so old process-held values become useless. Cancellation is
different: it bumps the host request generation, tears down the current
driver generation, clears targets, but does not rotate the capability values
in a still-live Pi process. Extensions must not pass capabilities to
unrelated subprocesses.

## Request envelope and negotiation

Before the first desktop action, negotiate the runtime (inside the broker
envelope's `params`):

```json
{
  "sessionKey": "<PIPIUI_SESSION_KEY>",
  "computerCapability": "<PIPIUI_COMPUTER_CAPABILITY>",
  "action": "computer_runtime_capabilities",
  "protocolVersion": 1
}
```

A successful response has this shape (values are illustrative):

```json
{
  "ok": true,
  "protocol": {
    "name": "pipiui-computer-runtime",
    "version": 1
  },
  "operations": [
    "computer_runtime_capabilities",
    "computer_batch",
    "computer_open_application",
    "computer_cancel"
  ],
  "actions": [
    "screenshot", "click", "left_click", "right_click", "middle_click",
    "double_click", "triple_click", "invoke_menu", "type", "key",
    "keypress", "scroll", "wait"
  ],
  "features": {
    "batchActions": true,
    "inMemoryScreenshots": true,
    "requestCancellation": true
  },
  "display": {
    "id": 1,
    "width": 1440,
    "height": 900
  },
  "permissions": {}
}
```

`permissions` is the driver-reported TCC status (`check_permissions`
structured content), passed through verbatim.

The `actions` list is the complete supported set; anything else is rejected
by batch pre-validation with `unsupported_action` before anything executes.
Use the negotiated `display.id`, `display.width`, and `display.height` in
normal requests. Do not cache negotiation across Pi processes or PipiUI
sessions. The model-facing `computer` schema caps one batch at 64 actions,
`wait` at 10 seconds, and `scroll_amount` at 1–50.

### Batch

```json
{
  "sessionKey": "<session capability>",
  "computerCapability": "<desktop capability>",
  "action": "computer_batch",
  "protocolVersion": 1,
  "displayID": 1,
  "displayWidth": 1440,
  "displayHeight": 900,
  "actions": [
    { "type": "left_click", "coordinate": [100, 80] },
    { "type": "type", "text": "hello" }
  ]
}
```

Every batch response carries per-action `outcomes` receipts
(`ok` / `failed` / `not_executed`); the batch stops at the first failure and
the tail is `not_executed`. A mutation whose driver call fails or times out
after input may have happened is reported as `mutation_outcome_unknown` with
`outcomeUnknown: true` after one re-observation — never blindly replay it.
When a settled action changes the actionable context or the AX snapshot, the
host answers `ok: true, batchOK: false, batchInterrupted: true` with
`interruptionReason: "actionable_context_changed" | "snapshot_changed"` and
`requiresReplan: true`: re-observe and replan instead of continuing the old
plan.

### Open or activate an application

```json
{
  "sessionKey": "<session capability>",
  "computerCapability": "<desktop capability>",
  "action": "computer_open_application",
  "protocolVersion": 1,
  "displayID": 1,
  "displayWidth": 1440,
  "displayHeight": 900,
  "bundle_identifier": "com.apple.TextEdit"
}
```

Use either `bundle_identifier` or `application_name`. Paths, URLs, and
arbitrary commands are not accepted by this lifecycle operation. A session
with an established exact target rejects unproven alias replacements with
`target_handoff_untrusted`.

### Cancel

```json
{
  "sessionKey": "<session capability>",
  "computerCapability": "<desktop capability>",
  "action": "computer_cancel",
  "protocolVersion": 1
}
```

Cancellation bumps the request generation, rejects pending RPCs, clears
targets and cached scales, and tears down the current daemon/proxy
generation (SIGTERM, then SIGKILL after a bounded wait); the next call
starts a fresh generation. The host serializes all runtime requests
(`requestTail`) and retries driver "desktop busy" rejections with a bounded
same-session backoff budget before surfacing `desktop_already_active`.

## Coordinates and observations

Screenshots delivered to the model are downscaled to a ≤1568px long edge by
the Electron `nativeImage` pipeline. Every observation may carry a top-level
`screenshot: { width, height, scaleX, scaleY }` block: the delivered image
pixel dimensions and the scale back to driver pixels. Model coordinates are
interpreted in the delivered screenshot pixel space; the host bounds-checks
them (`coordinate_out_of_bounds`, retryable, message carries the valid pixel
range) and maps them back with the scale recorded at the latest observation.
There is no letterboxing. AX snapshots are captured with
`max_elements: 2000`, `max_depth: 25`; the extension further trims the
model-facing element list (interactive controls first, cap 48) while
`elementCount` always reports the pre-trim total.

## Errors

Failures keep a top-level human-readable `error` string and add the stable
`runtimeError` envelope:

```json
{
  "ok": false,
  "error": "human-readable compatibility message",
  "runtimeError": {
    "code": "unsupported_protocol_version",
    "message": "Electron Computer Runtime requires protocolVersion 1",
    "retryable": false,
    "requiresObservation": false
  }
}
```

Clients should branch on `runtimeError.code`, `retryable`, and
`requiresObservation`; `message` and legacy `error` are diagnostic text and
may change. `retryable: true` means a retry is eligible only after satisfying
`requiresObservation` (observe again first); it never instructs a client to
retry blindly. The codes the host actually emits:

- `unsupported_protocol_version`: renegotiate with `protocolVersion: 1`.
- `unsupported_platform`: Computer Use is macOS-only; do not retry.
- `driver_unavailable`: the bundled driver is missing or not executable; fix
  the installation, do not retry the same call.
- `missing_session`: the request carried no session key; do not retry.
- `target_unavailable`: no exact target is pinned (or launch returned no exact
  pid/window); use `computer_open_application` to establish and observe the
  target.
- `target_handoff_untrusted`: the target handoff was not authoritative
  (unproven alias replacement, window-ownership check failure, app-switcher
  shortcut after pinning); reopen the exact application.
- `stale_snapshot`: the action is bound to an older accessibility snapshot;
  observe and locate again, never reuse the old token.
- `mutation_outcome_unknown` (with top-level `outcomeUnknown: true`): the
  mutation's outcome is uncertain; observe before deciding the next action,
  never blindly retry.
- `unsupported_action`: batch pre-validation rejected the request; nothing
  executed, and the message lists the supported action types.
- `coordinate_out_of_bounds`: the coordinate is outside the latest delivered
  screenshot pixel space; the message carries the valid range — re-observe and
  pick fresh coordinates.
- `cua_driver_rpc_timeout`: a single driver RPC exceeded its timeout; if it
  followed a mutation, treat the outcome as unknown.
- `desktop_already_active`: the driver stayed busy past the host's bounded
  same-session retry budget; retry after the current desktop operation
  finishes.

Unknown codes fail closed with `retryable: false` and
`requiresObservation: true`; clients can trust those fields directly, must
surface the diagnostic, and must not guess behavior from message text.

## Compatibility policy

`protocolVersion` is a major integer. PipiUI rejects missing or unsupported
versions rather than interpreting them as the old private bridge. Additive
response fields, operations, actions, features, and error codes may appear
within v1; clients must ignore unknown fields and capability-gate optional
behavior. Removing or changing a documented field or operation requires a new
major protocol version.

The built-in `cua-extension` registers the custom Pi `computer` and
`open_application` tools and adapts whitelisted Anthropic models to the typed
`computer_20251124` tool plus the `computer-use-2025-11-24` beta header; the
typed tool may still emit actions outside the supported set, which the host
rejects with `unsupported_action`. Other providers use the plain custom
schema. The runtime does **not** promise an OpenAI-native `computer_call` /
`computer_call_output` lifecycle.
