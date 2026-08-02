# PipiUI Computer Use — unrestricted implementation design

> Final product contract revised 2026-07-26. This supersedes the earlier approval/lease/takeover design.
>
> Runtime and manual acceptance details: [`docs/computer-use.md`](../../computer-use.md).
> Replaceable strategy contract: [`docs/computer-runtime-v1.md`](../../computer-runtime-v1.md).

## Decision

PipiUI Computer Use is deliberately unrestricted when the bottom global desktop button is ON.

The application retains only:

1. global ON/OFF;
2. macOS Screen Recording and Accessibility TCC;
3. manual/`⌥⇧Esc` emergency stop;
4. technical correctness and cleanup.

It does not create session/app/high-risk/write approvals, persisted policy enforcement, takeover pauses, refocus waits, cross-request leases, action budgets, expiry UX, or subagent exclusions.

## Runtime architecture

```text
top-level Pi or subagent Pi
        │ computer / open_application
        ▼
selected Pi strategy (`PiExt/computer-use-strategy.ts` by default)
        │ versioned loopback Runtime v1 + ephemeral capabilities
        ▼
BridgeServer
        ▼
process-global ComputerCoordinator
        │ one actual in-flight operation
        ├───────────────┐
        ▼               ▼
ScreenCaptureKit     CGEvent / postToPid
        │               │
        └──── outcomes + latest target screenshot
```

### Global in-flight mutex

`inFlightExecution` and `inFlightApplicationOpen` are the ownership tokens. At most one is non-nil. A concurrent call returns busy. Success, failure and cancellation clear the token and presentation immediately, except an irrevocably committed Launch Services request: it retains the token until its callback and bounded focus-side-effect drain settle.

Compatibility `ComputerLeaseController`, approval structs, and persisted settings may remain readable while old installs migrate, but the runtime does not consult them for ownership or policy. Beginning an operation clears stale compatibility lease state.

### Target correctness

General `computer` captures the exact frontmost bundle + PID and resolves its canonical bundle path, static code identity and running dynamic code identity. Startup, every action boundary, final capture and post-capture revalidate the process and code identity.

`open_application` resolves one unambiguous Launch Services bundle URL, validates static identity before launch, validates returned PID/dynamic identity, waits for the exact frontmost process, then captures only its target window. Transient ScreenCaptureKit application/window readiness misses retry inside the bounded verification deadline; identity, focus, descriptor, TCC or activation-generation drift does not retry.

Pointer actions map immutable advertised screenshot coordinates to the selected display bounds and verify the front-to-back hit belongs to the target PID immediately before posting. Keyboard/Unicode events post to the target PID. Cancellation and normal post share a serial gate.

### Cleanup

Every error, cancellation, OFF and emergency stop releases held keys/buttons. Cleanup-up bypasses normal authorization so stuck input can always be repaired; keyboard cleanup remains directed to the original PID and Unicode cleanup carries no text.

## Input monitoring

The app installs only `.keyDown` monitors needed for `⌥⇧Esc`. Ordinary key, mouse, move, drag and scroll events are ignored. Synthetic event tags are irrelevant to takeover because takeover does not exist.

Emergency stop is global: it sets the latch, aborts current work, clears stale compatibility pending state, stops affected generation and releases input. Turning the global control ON clears the latch.

## Policy compatibility

The following data and helper types may remain so upgrades do not destructively erase user defaults:

- bundle allow/deny keys;
- exact application identity catalog;
- legacy approval/lease model types.

They are inert in runtime routing. PipiUI, Terminal, System Settings/security/admin UI, password managers, arbitrary apps, persisted-denied targets, password/token text and destructive/system shortcuts all use the same no-prompt execution path.

Approval controls are removed from Settings, consent bar and toolbar. The runtime status surface contains only TCC status, actual in-flight state and emergency stop.

## Request limits

Limits are technical DoS/transport bounds:

- 64 actions per request;
- 10 seconds for one wait/hold;
- 65,536 UTF-16 units of typed text;
- estimated request duration below the 28-second transport-safe threshold;
- 30-second Swift watchdog, 35-second Pi request timeout, 40-second bridge timeout;
- 2 MiB bridge body.

These limits do not persist across calls, decrement a budget, pause a session or ask for confirmation.

## Tool and provider contract

All providers receive the custom batch tool:

```json
{
  "name": "computer",
  "actions": [
    {"type": "click", "x": 300, "y": 240},
    {"type": "type", "text": "hello"}
  ]
}
```

Supported Anthropic messages/model combinations replace `computer` with `computer_20251124` and merge `computer-use-2025-11-24`. Other providers keep the custom schema. OpenAI native `computer_call` is not claimed.

Every accepted, non-cancelled batch returns a fresh screenshot. PNG stays in extension memory and is injected from an opaque marker by the context hook.

`open_application` accepts only an exact bundle identifier and shares the same mutex and cancellation contract.

## Subagent exposure

When globally enabled, `ChatSession` exports the exact selected
`PIPIUI_COMPUTER_EXT`, Runtime v1, display hints, session route and desktop
capability. The subagent extension loads that same strategy path in the child
Pi and adds `computer` / `open_application` to explicit tool allowlists.
Selecting an external strategy suppresses the built-in strategy rather than
mounting both.

The child Pi alone preserves the desktop capability. Shell verification and git helper processes still use the default stripped environment. Nested Pi agents inherit the same extension path/route, while the process-global coordinator serializes all callers.

## Stable signing and TCC

Computer Use requires stable App identity because both Screen Recording and Accessibility are TCC-protected. `make-app.sh` prefers `PipiUI Dev` (or `PIPIUI_SIGN_ID`) and warns when falling back to ad-hoc signing.

Only the primary checkout may create `build/PipiUI.app`. `swift build` / `swift test` validate source but do not validate real TCC or desktop interaction.

## Verification map

| Contract | Automated evidence |
|---|---|
| ordinary input ignored | batch/open operation objects remain current; no pause state |
| emergency hotkey | latch set, execution cancelled, input cleared |
| any app/legacy deny no prompt | PipiUI/Terminal/System Settings/password manager/unknown and persisted deny all bypass approvals |
| writes/shortcuts/text unrestricted | normalized input validates and `requiresWriteApproval == false` |
| mutex lifetime | concurrent real operation busy; success/failure/cancel clear ownership; committed launch quarantine retained |
| exact target correctness | PID/code identity/focus/window/activation drift suites |
| subagent tools | Swift source contract plus Node contract for extension path, capability and allowlist |
| provider/memory screenshots | bundled strategy resource execution contract |

Real App/TCC/keyboard/mouse acceptance remains a separate manual gate and must not be inferred from Swift build/test success.
