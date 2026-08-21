# @pipiui/grok-build-oauth-extension

Canonical Grok Build OAuth + Image extension — **M2 Pi-native OAuth**.

One package, two halves, one `pipiui-extension.json` glue (spec `extension-architecture-v1` D1/D2). Single source for PipiUI + chatrpgv4/pi-coc.

M2 implements:

- `id = grok-build-oauth`, `version: 0.1.0`
- `agent/dist/index.js` registers provider `grok-build` via `pi.registerProvider` with Pi-native OAuth (`/login grok-build` browser/device)
- `oauth/config` — issuer/client/scopes driven by `GROK_OAUTH2_*` env → `ext.grok-build-oauth.*` settings → prod defaults from official HEAD `19d42e35` (`https://auth.x.ai`, `b1a00492-073a-47ea-816f-4c329264a828`, 10 scopes), no guessing
- `oauth/device` — `POST {issuer}/oauth2/device/code` + `POST {issuer}/oauth2/token` form protocol, `referrer=grok-build`, `x-grok-client-version/surface`, `user_code`/`verification_uri` validation, `pending/slow_down/denied/expired` state machine, fake-server + fake-clock testable, abortable
- `refresh` — `grant_type=refresh_token`, rotation, `invalid_grant` → re-login, redacted errors
- Credentials `access/refresh/expires/issuer/client/scopes/token_type/obtained_at` persisted via Pi Provider `auth.json` (`CredentialStore` modify/lock), not in ordinary `ext.*` settings; `format:secret` vault only for optional compat token, never written by OAuth flow
- No silent `~/.grok` read; explicit `/grok-build:import` with `confirm:true` only, one-shot copy, source untouched
- Redaction (`[redacted]`) on all logs/errors, `AbortSignal` cancels device poll and refresh, filesystem 0600/atomic handled by Pi auth storage (cross-process lock via `CredentialStore.modify` serialization)

Images `image_gen`/`image_edit` transport still placeholder — ships in Phase 4 (same `POST {base}/images/generations` contract).

## Layout

```
pipiui-extension.json
agent/index.ts -> agent/dist/index.js  (provider grok-build, import/status commands, image_gen placeholder)
agent/oauth/config.ts   issuer/client/scopes resolution
agent/oauth/device.ts   device_code + poll + refresh wire
agent/oauth/credentials.ts  OAuthCredentials shape
agent/oauth/redact.ts   secret redaction
agent/oauth/import.ts   explicit ~/.grok import
app/panel.tsx -> app/dist/panel.js
app/image-card.tsx -> app/dist/image-card.js
```

## Install (three locations, D10)

- Bundled runtime: `Electron/resources/runtime/extensions/grok-build-oauth/`
- App profile: `pi-agent/extensions/grok-build-oauth/`
- Project: `{project}/.pi/agent/extensions/grok-build-oauth/`

Scan order: builtin → app → project.

## Build

```sh
npm run build -w @pipiui/grok-build-oauth-extension --maxsockets 3
# tsc -p agent/tsconfig.json && tsc -p app/tsconfig.json
```

## Tests

```sh
npm run test -w @pipiui/grok-build-oauth-extension --maxsockets 3
# manifest + loader + oauth fake-server/clock/redact/abort/import
```

Enable only takes effect on the **next** new session (`-e` spawn), disable disposes app half immediately and agent half with the session (D9).
