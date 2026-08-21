# @pipiui/grok-build-oauth-extension

Canonical Grok Build OAuth + Image extension — **M3 OAuth Credential Broker** (M2 Pi-native OAuth included).

One package, two halves, one `pipiui-extension.json` glue (spec `extension-architecture-v1` D1/D2). Single source for PipiUI + chatrpgv4/pi-coc.

M3 implements (on top of M2):

- `oauth/broker` — **Credential Broker** shared by provider requests and image tools: early refresh (60s window, 30-120 clamp), refresh rotation, `invalid_grant` → clear + re-login, network/5xx → preserve old, 401 single forced refresh retry, in-process promise dedup, cross-process flock (proper-lockfile with stale 30s + fallback file lock) + lock内重读 + freshness guard (`obtained_at`/`expires`), 0600 tmp/fsync/rename atomic write, 绝不日志token, `with401Retry` single API for both provider and `image_gen`
- `image_gen` now validates via broker (tokenPreview redacted) and shares same `getAccessToken`/`with401Retry` path; real `POST {base}/images/generations` transport still Phase 4
- Tests: concurrency dedup, cross-process lock simulation, stale-lock crash recovery, 0600/0700 permissions, secret redaction, abort, 401 retry, provider+image shared API

M2 implements:

- `id = grok-build-oauth`, `version: 0.1.0`
- `agent/dist/index.js` registers provider `grok-build` via `pi.registerProvider` with Pi-native OAuth (`/login grok-build` browser/device)
- `oauth/config` — issuer/client/scopes driven by `GROK_OAUTH2_*` env → `ext.grok-build-oauth.*` settings → prod defaults from official HEAD `19d42e35` (`https://auth.x.ai`, `b1a00492-073a-47ea-816f-4c329264a828`, 10 scopes), no guessing
- `oauth/device` — `POST {issuer}/oauth2/device/code` + `POST {issuer}/oauth2/token` form protocol, `referrer=grok-build`, `x-grok-client-version/surface`, `user_code`/`verification_uri` validation, `pending/slow_down/denied/expired` state machine, fake-server + fake-clock testable, abortable
- `refresh` — `grant_type=refresh_token`, rotation, `invalid_grant` → re-login, redacted errors (now via broker with lock+dedup)
- Credentials `access/refresh/expires/issuer/client/scopes/token_type/obtained_at` persisted via Pi Provider `auth.json` (`CredentialStore` modify/lock), not in ordinary `ext.*` settings; `format:secret` vault only for optional compat token, never written by OAuth flow
- No silent `~/.grok` read; explicit `/grok-build:import` with `confirm:true` only, one-shot copy, source untouched
- Redaction (`[redacted]`) on all logs/errors, `AbortSignal` cancels device poll and refresh, filesystem 0600/atomic via broker's `tmp+0600+fsync+rename` and Pi `CredentialStore` (cross-process lock via `proper-lockfile` stale + fallback, re-read, freshness guard)

Images `image_gen`/`image_edit` transport still placeholder — ships in Phase 4 (same `POST {base}/images/generations` contract).

## Layout

```
pipiui-extension.json
agent/index.ts -> agent/dist/index.js  (provider grok-build via broker, import/status, image_gen via broker)
agent/oauth/config.ts   issuer/client/scopes resolution
agent/oauth/device.ts   device_code + poll + refresh wire
agent/oauth/broker.ts   credential broker: earlyRefresh/rotation/401 dedup/lock/atomic600/redaction
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
# manifest + loader + oauth fake-server/clock/redact/abort/import + broker dedup/lock/atomic/401/redact
```

Enable only takes effect on the **next** new session (`-e` spawn), disable disposes app half immediately and agent half with the session (D9).
