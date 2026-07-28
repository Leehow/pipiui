# PipiUI Computer Runtime v1

PipiUI exposes a loopback-only, capability-authenticated desktop runtime and
explicitly mounts exactly one Pi strategy selected by the user. PipiUI owns
macOS permissions, capture, accessibility, input delivery, target PID/window
validation, coordinate conversion, cancellation, the global execution mutex,
helper lifecycle, emergency stop, and held-input cleanup. The Pi strategy owns
tool schemas and descriptions, prompting, routing, batching, retries, provider
adaptation, and model-context shaping.

This is a selection boundary, not code isolation. Pi can also auto-discover or
load other extensions, and every extension in the same Pi process can read the
process environment that carries Runtime capabilities. Treat all extensions in
that process as trusted.

The Cua helper is private implementation detail. Strategy extensions must use
this contract rather than starting or calling that helper directly.

## Selecting a strategy

Settings → Computer Use → **Pi 操作策略** offers:

- **PipiUI 内置策略**: the reference strategy bundled with the App.
- **外部 Pi 策略**: a user-selected `.ts`, `.js`, `.mjs`, or `.cjs` file, or a
  directory containing `index.ts`, `index.js`, `index.mjs`, or `index.cjs`.

PipiUI validates the configured path and blocks Pi session startup with a clear
error if it is missing, unreadable, or unsupported. It never silently falls
back to the built-in strategy. Exactly one strategy is mounted with Pi `-e`.
Nested Pi processes dispatched by PipiUI mount the same selected path.
Choosing **应用** restarts all open Pi sessions when Computer Use is enabled
and the external strategy is selected. Applying an unchanged path deliberately
does the same, providing a simple edit-and-reload loop; merely opening Settings
or refreshing its status does not restart sessions.

External Pi extensions are trusted executable code. While Computer Use is on,
the explicitly selected strategy and any other extension in the same Pi process
can read the Runtime capability and attempt desktop requests. Review the source
and provenance of the complete Pi extension set before enabling it.

### Required nested strategy surface

An external v1 strategy that must work in PipiUI-dispatched nested Pi processes
must register tools named exactly `computer` and `open_application`. PipiUI's
explicit subagent tool allowlist knows only those two reserved names. Additional
custom tools may work in a top-level Pi session, but arbitrary names are not
automatically added to nested explicit allowlists.

## Discovery and lifecycle

PipiUI injects these environment variables into the owning top-level Pi process,
and dispatched Pi children inherit the corresponding values. They are not
scoped to the selected extension: every extension loaded in one of those
processes can read its process environment.

| Variable | Meaning |
|---|---|
| `PIPIUI_BRIDGE_PORT` | Ephemeral loopback HTTP port. |
| `PIPIUI_SESSION_KEY` | Ephemeral capability for the owning Pi session. |
| `PIPIUI_COMPUTER_CAPABILITY` | Separate ephemeral desktop capability. |
| `PIPIUI_COMPUTER_RUNTIME_PROTOCOL` | Requested major protocol version (`1`). |
| `PIPIUI_COMPUTER_EXT` | Selected extension file/directory path, used by PipiUI's subagent extension when spawning nested Pi. |

The built-in strategy also receives `PIPIUI_COMPUTER_DISPLAY_ID`,
`PIPIUI_COMPUTER_WIDTH`, and `PIPIUI_COMPUTER_HEIGHT` because Pi's Anthropic
provider-request hook is synchronous and must describe the typed tool before
the first action. These are initialization hints, not the public discovery
contract. Third-party strategies must use the negotiated `display` object, and
the built-in strategy rejects a mismatch between its hint and the handshake.

The endpoint is `POST http://127.0.0.1:$PIPIUI_BRIDGE_PORT/rpc` with
`content-type: application/json`. It is bound only to `127.0.0.1`. Every
Computer Runtime request must carry both capability values and
`protocolVersion: 1`.

Capabilities are per session, remain in process memory, and must not be written
to disk or logs. Closing a session terminates its Pi process. Disabling Computer
Use restarts open sessions without the strategy mount or desktop capability, so
the old process-held values become unusable. Emergency stop is different: it
latches desktop execution off, cancels active work, clears targets, and releases
held input, but does not rotate the `computerRoutingKey` or the environment
value in a still-live Pi process. Runtime execution remains blocked until the
user explicitly re-enables it. Extensions must not pass capabilities to
unrelated subprocesses.

## Request envelope and negotiation

Before the first desktop action, negotiate the runtime:

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
  "actions": ["screenshot", "mouse_move", "left_click", "type", "key"],
  "actionAliases": {
    "click": "left_click",
    "move": "mouse_move",
    "keypress": "key",
    "drag": "left_click_drag"
  },
  "features": {
    "batchActions": true,
    "accessibilityElements": true,
    "windowPinning": true,
    "backgroundInput": true,
    "inMemoryScreenshots": true,
    "requestCancellation": true,
    "nativeOpenAIComputerCall": false
  },
  "limits": {
    "maxActionsPerBatch": 64,
    "maxRequestBodyBytes": 2097152,
    "maxExecutionMilliseconds": 30000,
    "maxEstimatedActionMilliseconds": 28000,
    "maxPauseMilliseconds": 10000,
    "maxTypedUTF16Units": 65536
  },
  "display": {
    "id": 1,
    "width": 1440,
    "height": 900,
    "globalBounds": {
      "x": 0,
      "y": 0,
      "width": 1728,
      "height": 1117
    }
  },
  "runtime": {
    "platform": "macOS",
    "transport": "loopback-http-json",
    "endpoint": "/rpc",
    "helperExposed": false,
    "screenRecordingGranted": true,
    "accessibilityGranted": true
  }
}
```

Use the negotiated `display.id`, `display.width`, and `display.height` in normal
requests. Do not cache negotiation across Pi processes or PipiUI sessions.

### Batch

```json
{
  "sessionKey": "<session capability>",
  "computerCapability": "<desktop capability>",
  "action": "computer_batch",
  "protocolVersion": 1,
  "requestID": "caller-generated-unique-id",
  "displayID": 1,
  "displayWidth": 1440,
  "displayHeight": 900,
  "actions": [
    { "type": "left_click", "coordinate": [100, 80] },
    { "type": "type", "text": "hello" }
  ]
}
```

### Open or activate an application

```json
{
  "sessionKey": "<session capability>",
  "computerCapability": "<desktop capability>",
  "action": "computer_open_application",
  "protocolVersion": 1,
  "requestID": "caller-generated-unique-id",
  "displayID": 1,
  "displayWidth": 1440,
  "displayHeight": 900,
  "bundle_identifier": "com.apple.TextEdit"
}
```

Use either `bundle_identifier` or `application_name`. Paths, URLs, and arbitrary
commands are not accepted by this lifecycle operation.

### Cancel

```json
{
  "sessionKey": "<session capability>",
  "computerCapability": "<desktop capability>",
  "action": "computer_cancel",
  "protocolVersion": 1,
  "requestID": "the-original-request-id"
}
```

Transport disconnect and timeout cancellation remain App-owned safeguards;
strategies should still send explicit cancellation when their tool signal is
aborted.

## Errors

v1 failures retain the legacy top-level `error` string and add the stable
`runtimeError` envelope:

```json
{
  "ok": false,
  "error": "human-readable compatibility message",
  "errorCode": "unsupported_protocol_version",
  "runtimeError": {
    "code": "unsupported_protocol_version",
    "message": "PipiUI Computer Runtime requires protocolVersion 1",
    "retryable": false,
    "requiresObservation": false
  }
}
```

Clients should branch on `runtimeError.code`, `retryable`, and
`requiresObservation`; `message` and legacy `error` are diagnostic text and may
change. `retryable: true` means a retry is eligible only after satisfying
`requiresObservation` and any user/runtime prerequisite; it never instructs a
client to retry blindly. The boolean fields are authoritative Runtime guidance,
including for generic and unknown codes. Stable v1 guidance includes:

- `unauthorized_session_capability`: do not retry; the owning Pi session ended
  or the session capability is invalid.
- `unauthorized_computer_capability`: do not retry; discard the capability.
- `unsupported_protocol_version`: renegotiate or use a compatible strategy.
- `runtime_unavailable`: fix display/runtime configuration or permissions.
- `request_cancelled`: retry only when the user still wants the operation, and
  observe again first.
- `computer_busy`: the request was rejected before execution; retry after the
  current desktop operation finishes.
- `computer_cancelled`: cancellation can race with posted input; observe again
  before a user-intended retry.
- `computer_target_missing` / `computer_target_lost`: do not retry the same
  batch; use `open_application` to establish and observe the exact target.
- `computer_outcome_unknown`: do not blindly retry. Reopen and observe the exact
  target before deciding the next action.
- `user_handoff_required`: let the user complete the protected prompt, then
  observe before retrying.
- `cua_driver_error`: do not retry the same mutation because its outcome may be
  uncertain; observe first.
- `invalid_application_target` / `invalid_computer_request`: correct the
  request rather than retrying it unchanged.
- `runtime_error`: compatibility wrapper for a runtime-mechanics failure that
  does not yet have a narrower stable code; do not retry and observe before
  continuing.

Additional lower-level codes may be returned. Unknown codes fail closed with
`retryable: false` and `requiresObservation: true`; clients can trust those
fields directly, must surface the diagnostic, and must not guess behavior from
message text.

## Minimal third-party TypeScript strategy

This example registers the two required nested-compatible tool names. A
production strategy should add cancellation, result shaping, screenshot memory
handling, and provider-specific hooks as needed.

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const port = process.env.PIPIUI_BRIDGE_PORT!;
const sessionKey = process.env.PIPIUI_SESSION_KEY!;
const computerCapability = process.env.PIPIUI_COMPUTER_CAPABILITY!;
const protocolVersion = 1;

async function rpc(body: Record<string, unknown>) {
  const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionKey,
      computerCapability,
      protocolVersion,
      ...body,
    }),
  });
  const json = await response.json() as any;
  if (!json.ok) throw new Error(json.runtimeError?.message || json.error);
  return json;
}

let capabilities: any;

export default function strategy(pi: ExtensionAPI) {
  pi.registerTool({
    name: "computer",
    label: "Computer",
    description: "Observe the selected desktop or run one atomic action.",
    parameters: Type.Object({
      type: Type.Union([Type.Literal("screenshot"), Type.Literal("left_click")]),
      coordinate: Type.Optional(Type.Array(Type.Number(), {
        minItems: 2,
        maxItems: 2,
      })),
    }),
    async execute(_toolCallId, input) {
      capabilities ??= await rpc({
        action: "computer_runtime_capabilities",
      });
      const result = await rpc({
        action: "computer_batch",
        requestID: crypto.randomUUID(),
        displayID: capabilities.display.id,
        displayWidth: capabilities.display.width,
        displayHeight: capabilities.display.height,
        actions: [input],
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "open_application",
    label: "Open Application",
    description: "Launch or activate an exact app and establish its target.",
    parameters: Type.Object({
      bundle_identifier: Type.Optional(Type.String()),
      application_name: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, input) {
      capabilities ??= await rpc({
        action: "computer_runtime_capabilities",
      });
      const result = await rpc({
        action: "computer_open_application",
        requestID: crypto.randomUUID(),
        displayID: capabilities.display.id,
        displayWidth: capabilities.display.width,
        displayHeight: capabilities.display.height,
        ...input,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
```

## Compatibility policy

`protocolVersion` is a major integer. PipiUI rejects missing or unsupported
versions rather than interpreting them as the old private bridge. Additive
response fields, operations, actions, features, limits, and error codes may
appear within v1; clients must ignore unknown fields and capability-gate
optional behavior. Removing or changing a documented field or operation
requires a new major protocol version.

The built-in strategy continues to register the custom Pi `computer` and
`open_application` tools and adapts supported Anthropic models to
`computer_20251124`. External strategies should keep those exact names when
nested compatibility is required. The current Pi extension surface does
**not** promise an OpenAI-native `computer_call` / `computer_call_output`
lifecycle. OpenAI and OpenAI-compatible providers continue to use the custom
tool unless a future runtime and Pi extension contract explicitly adds native
support.
