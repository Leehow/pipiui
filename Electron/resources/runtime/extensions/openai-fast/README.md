# OpenAI Fast

This opt-in extension contributes a button immediately after the Composer's thinking control. It uses the host's confined `composerActions` and data APIs. The extension is enabled by default so the button is available; every Fast preference starts **off**.

## Scope and persistence

The preference is local to the opened project, session ID, provider and exact model ID. Its file is `.pi/agent/openai-fast/<session>_<encoded-provider>_<encoded-model>.json`; the adjacent `.status.json` contains only tier metadata. No prompt, response text, auth or account setting is stored. A missing or corrupt agent preference means off. UI read/write errors are dismissible.

Switching models/providers restores that exact pair's explicit preference. Closing/reopening or reconnecting the same project/session restores the saved preference. Before the host has assigned a session ID the control is off and disabled without reading/writing data; the first request starts off. New sessions and forks have new IDs and start off; choices do not inherit history. Selecting another project does not inherit them. UI writes need the host connection; an offline failure cannot claim a saved preference. The existing host sessionWorking signal (including observed activity, queued work and stopping), streaming, compaction and read-only leases disable the button. Writes pause polling synchronously, and write/refresh epochs reject late or out-of-order reads. Each provider request captures the choice before serialization; a concurrent external preference write applies to the next request, including the next tool-loop request, never the already-running request. Independent lane/worker requests do not inherit the foreground preference.

## Provider contract

The button appears for `openai-codex`, and for the explicitly listed Flapcode OpenAI identities in `shared/policy.js`. A mismatched API shows a disabled button with its reason. Unsupported tier errors are recorded and do not crash the extension or trigger a retry/model substitution; switch off before another user-requested attempt if necessary. The list is a request capability contract, not a promise of server support. New relay models must be deliberately added and tested.

On sends `service_tier: "priority"`; off sends `"default"` so account defaults or static sampling overrides cannot turn Fast on silently. Other providers/payloads remain untouched. Thinking effort and model names remain untouched. The final Pi `before_provider_request` hook survives `streamSimple` and reaches HTTP and Codex WebSocket serialization. No SDK fork or credential change is needed.

Pressed means **priority requested**. `effective` requires a terminal response reporting `priority` or `fast`; `standard` means the server reported `default` after a priority request; `unconfirmed` means no terminal tier was reported. Codex `response.done` is a terminal alias accepted by the pinned adapter and also confirms the reported tier. A created/in-progress event cannot confirm Fast. Unsupported is separate. An observation is tied to the preference revision, so an old result cannot confirm a changed choice.

The `message_end` replacement runs before session persistence and public listeners in the pinned Pi runtimes. It preserves actual tier metadata and recalculates catalog cost estimates from the reported tier: standard/default ×1, priority/fast ×2 (GPT-5.5 uses the pinned adapters' exceptional ×2.5 estimate), flex ×0.5. GPT-5.5 priority/Fast pricing is not currently verified against an official legacy tier table; persisted metadata explicitly uses `reported-tier-pinned-sdk-estimate-price-unverified` and the button tooltip identifies an unverified price. This retains the SDK's priority estimate and repairs its Fast-return estimate without presenting the result as verified billing. An absent/unknown tier leaves the SDK estimate unchanged and is marked unconfirmed; requested tier is never a price fallback. These are **catalog estimates**, not subscription credits or verified Flapcode charges. The relay probe performed by the separate research owner accepted `priority` but returned `default`; `fast` was rejected. Do not label those responses accelerated.

## Build and offline validation

The browser factory receives the host React instance and has no bare runtime React import. Its single-file bundle is checked in so existing source and runtime assembly routes can load it.

From this extension directory with the repository dependencies already present:

```sh
node scripts/build-app.mjs
node --test test/offline.test.mjs
```

To test the actual pinned SDK too, set `FAST_SDK_ROOT` to the repository's local node_modules directory and run the tests inside an OS sandbox that denies network. Tests use synthetic auth, fetch and WebSocket responses; they never read auth stores or call a real provider. UI tests live in the host workspace and cover the factory, confinement, model/session isolation and button placement. No additional live probes are part of this candidate.

Reference: [OpenAI Fast mode](https://developers.openai.com/api/docs/guides/fast-mode) and [Codex speed configuration](https://learn.chatgpt.com/docs/agent-configuration/speed).

## Host dependency and integration boundary

The agent requires Pi's final `before_provider_request` and raw `provider_stream_event` hooks plus `message_end` replacement before persistence. These were verified on the available `@earendil-works/pi-coding-agent`/`pi-ai` 1.0.0 runtime, including real offline AgentSession lifecycles. The original Fast-only candidate used PipiUI's 0.84.2 manifest with the separately owned 1.0.0 SDK tree for testing. Installable source must align its manifests and lockfile with the reviewed 1.0.0 SDK cohort before activating this extension. The extension itself does not install or upgrade dependencies and does not claim a clean 0.84.2 rebuild was verified. The minimum requirement is the three hook contracts above; 1.0.0 is the verified version, not a claim that no earlier release supports them. A standalone copy onto PipiUI's committed base is not an accepted release.
