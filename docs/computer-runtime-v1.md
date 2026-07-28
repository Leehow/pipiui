# PipiUI Computer Runtime v1

PipiUI exposes a loopback-only, capability-authenticated desktop runtime to one
trusted Pi extension selected by the user. PipiUI owns macOS permissions,
capture, accessibility, input delivery, target PID/window validation,
coordinate conversion, cancellation, the global execution mutex, helper
lifecycle, emergency stop, and held-input cleanup. The Pi extension owns tool
schemas and descriptions, prompting, routing, batching, retries, provider
adaptation, and model-context shaping.

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

External Pi extensions are trusted executable code. While Computer Use is on,
the selected extension can act through the desktop runtime. Review its source
and provenance before enabling it.

## Discovery and lifecycle

PipiUI injects these process environment variables into the selected top-level
strategy and its dispatched Pi children:

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
to disk or logs. PipiUI revokes their usefulness when the session closes,
Computer Use is disabled, or emergency stop terminates the active workflow.
Extensions must not pass them to unrelated subprocesses.

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
change. Contract-level codes in v1 are:

- `unauthorized_session_capability`: do not retry; the owning Pi session ended
  or the session capability is invalid.
- `unauthorized_computer_capability`: do not retry; discard the capability.
- `unsupported_protocol_version`: renegotiate or use a compatible strategy.
- `runtime_unavailable`: fix display/runtime configuration or permissions.
- `request_cancelled`: retry only when the user still wants the operation, and
  observe again first.
- `runtime_error`: compatibility wrapper for a runtime-mechanics failure that
  does not yet have a narrower stable code.

Additional lower-level codes may be returned. Unknown codes must be treated
according to `retryable` and `requiresObservation`, not guessed from message
text.

## Minimal third-party TypeScript strategy

This example registers a deliberately small `computer` tool. A production
strategy should add cancellation, result shaping, screenshot memory handling,
and provider-specific hooks as needed.

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
`computer_20251124`. The current Pi extension surface does **not** promise an
OpenAI-native `computer_call` / `computer_call_output` lifecycle. OpenAI and
OpenAI-compatible providers continue to use the custom tool unless a future
runtime and Pi extension contract explicitly adds native support.
