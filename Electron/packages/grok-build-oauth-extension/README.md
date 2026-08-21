# @pipiui/grok-build-oauth-extension

Canonical Grok Build OAuth + Image extension — **M5 PipiUI host integration** (M4 Images transport + M3 Credential Broker + M2 Pi-native OAuth included).

One package, two halves, one `pipiui-extension.json` glue (spec `extension-architecture-v1` D1/D2). Single source for PipiUI + chatrpgv4/pi-coc.

M5 implements (PipiUI host half, on top of M4):

- **Bundled assembly via registry/manifest (no bypass):** the built package is synced into the Bundled runtime tree (`Electron/resources/runtime/extensions/grok-build-oauth/`, script `Electron/scripts/sync-bundled-extension.mjs`, wired as `postbuild`); `installRuntimeTree` re-syncs `BUNDLED_MANIFEST_EXTENSIONS` with `keepDist` so the compiled `agent/dist` + `app/dist` halves survive the `dist`-stripping runtime sync; packaged apps re-include it via a dedicated `extraResources` entry (pdf-inspector precedent). The extension loader discovers it as `origin=builtin`, default-enabled, non-uninstallable; mounting is `-e` at **new-session spawn only** (`SpawnRegisteredExtension`, D9).
- **`agent/provider.ts` — canonical provider factory (single source):** `createGrokBuildProvider()` carries the device/browser login + broker refresh + `getApiKey`; the extension entry registers it via `pi.registerProvider`, and the PipiUI host registers the same factory into its auth `ModelRuntime` (in-process and `pi-auth-helper.mjs` external runtime), so the provider login panel shows Grok Build **without a live session**: 登录状态 / 重新登录 / 退出 / 凭证来源 / 到期时间 (new optional `AuthProviderInfo.expiresAtMs` / `credentialSource`, metadata only — credential values never cross IPC).
- **Settings UI:** the manifest settings section renders automatically from the schema (compat fallback switch, base/model/tier overrides); the tool panel (`app/dist/panel.js`) shows 登录状态、到期时间、凭证来源、base/model、tier、compat 开关 with graceful degradation when no session is mounted; `format: secret` keys stay vault-only, OAuth tokens live in pi provider auth (`auth.json`), never in settings JSON.
- **`pipiui-media` becomes a consumer/compat layer:** spawn assembly exports `PIPIUI_MOUNTED_EXTENSIONS` (mounted manifest ids) and `PIPIUI_MEDIA_COMPAT_FALLBACK` (host internal env from `ext.grok-build-oauth.compatFallback`, default off, parent-env stripped). When `grok-build-oauth` is mounted, media registers **nothing** (canonical tools own the session, US-30); otherwise the coding relay stays, and the deprecated xAI API-key/loopback-relay Grok transport runs only under the explicit compat gate, labelled `(deprecated compat)`, with provider-aware errors pointing at `/login grok-build` when off.
- Invoke responder: `statusSnapshot()` (non-secret broker status: loggedIn/expired/expiresAt/hasRefresh/source/base/model/tier/compat) answers host `invokeExtension(..., "status")` and `/grok-build:status`.
- Tests: spawn marker + internal-env contract, `keepDist` runtime install, bundled manifest contract (schema/migrations identity/future-disk refusal), host settings e2e (compat persistence, secret→vault, unknown-key denial, enable toggle keeps settings), loader builtin discovery + disabled overlay, media role matrix (delegate/off/compat + coding relay preserved).

M4 implements (on top of M3):

- `images/client` — official Grok Build Images wire contract (HEAD `19d42e35`):
  - `image_gen` → `POST {base}/images/generations`; `image_edit` → `POST {base}/images/edits`
  - default base `https://api.x.ai/v1` (trailing slash normalized, `XAI_API_BASE_URL` / `ext.grok-build-oauth.xaiApiBaseUrl` override), default model `grok-imagine-image-quality`, payload `n=1`, `resolution=1k`, `response_format=b64_json`, aspect whitelist `1:1 16:9 9:16 4:3 3:4 3:2 2:3 2:1 1:2 19.5:9 9:19.5 20:9 9:20 auto` (invalid rejected client-side, no HTTP)
  - headers: `Authorization: Bearer`, `content-type: application/json`, `x-grok-session-id` (stable: settings → `GROK_SESSION_ID` → persisted `<agentHome>/grok-build-session-id`, generated once and reused)
  - edit payload parity: single ref → `image: {url}`, multiple → `images: [{url}]` + explicit `aspect_ratio`; refs are `data:image/...;base64` URLs or JPEG/PNG ≤400KB paths (`..` traversal rejected, oversize/missing/non-JPEG-PNG rejected with actionable errors)
  - response: `data[0].b64_json` strict base64 decode; empty/malformed → `invalid_response`, nothing written
  - error classification: 401→`auth_expired`, 403→`tier_restricted`, 429→`rate_limited`, 5xx→`upstream_error`, other→`http_failure`; body truncated to 200 chars; bearer redacted from every message
  - `AbortSignal` + 300s timeout (official cap); abort propagates as `AbortError`, no half writes
- `images/tier` — advisory client-side gate aligned with official `tier.rs`: `Free`/`""`/`X Basic`/`x_basic` short-circuit with the SuperGrok upsell prose (no HTTP); unknown/paid/absent fail open; **API-key callers are never gated**; server remains authoritative
- `images/storage` — session/attachments isolation dir `$PI_CODING_AGENT_DIR/attachments/images/` (fallback `<cwd>/.pi/agent/...`), official `<n>.jpg` numbering resumed from dir scan, atomic `tmp → fsync → chmod 0600 → rename` over an `O_EXCL` placeholder, dir 0700; filenames are counter-generated so paths never escape the root
- `agent/index.ts` — `image_gen`/`image_edit` tools wired through the M3 broker: OAuth path uses `with401Retry` (early refresh + 401 single forced refresh + single retry); explicit `XAI_API_KEY` shares the exact same client/payload (only `Authorization` differs); no credential → actionable `/login grok-build` error; `compatFallback=true` only → deprecated PipiUI loopback relay (`PIPIUI_GROK_RELAY`, default off, marked deprecated in result/logs)
- Typed result: `content: [{type:"text", text:"图像已生成: <path>"}]`, `details: {path, mime, backend, model}` (pixels are not re-sent to the model, matching official Grok Build; the app-half `image-card` renderer shows the file)
- Tests (34 new): request contract/payload/headers, base normalization, aspect whitelist, strict base64, status classification + truncation + redaction, abort, mime sniff, tier gate matrix, storage numbering/permissions/resume/abort, edit single/multi payload, ref resolution guards, broker 401 single retry + second-401 auth_expired + no-retry on 429, and full tool wiring (OAuth/api-key/gate/relay/abort/traversal/isolation)

M3 implements (on top of M2):

- `oauth/broker` — **Credential Broker** shared by provider requests and image tools: early refresh (60s window, 30-120 clamp), refresh rotation, `invalid_grant` → clear + re-login, network/5xx → preserve old, 401 single forced refresh retry, in-process promise dedup, cross-process flock (proper-lockfile with stale 30s + fallback file lock) + lock内重读 + freshness guard (`obtained_at`/`expires`), 0600 tmp/fsync/rename atomic write, 绝不日志token, `with401Retry` single API for both provider and `image_gen`
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

## Layout

```
pipiui-extension.json
agent/index.ts -> agent/dist/index.js  (provider grok-build via broker, import/status invoke, image_gen/image_edit via broker)
agent/provider.ts -> agent/dist/provider.js  (canonical grok-build provider factory; shared with the PipiUI host auth runtime)
agent/oauth/config.ts   issuer/client/scopes resolution
agent/oauth/device.ts   device_code + poll + refresh wire
agent/oauth/broker.ts   credential broker: earlyRefresh/rotation/401 dedup/lock/atomic600/redaction
agent/oauth/credentials.ts  OAuthCredentials shape
agent/oauth/redact.ts   secret redaction
agent/oauth/import.ts   explicit ~/.grok import
agent/images/client.ts  Imagine API client (generations/edits payload + headers + classification + strict b64)
agent/images/tier.ts    advisory tier gate (fail-open, api-key never gated)
agent/images/storage.ts session image writer (numbered <n>.jpg, atomic, isolated)
agent/images/config.ts  base/model/session-id/tier/compat resolution + legacy relay base
agent/images/errors.ts  ImagesError codes + tier upsell prose
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
# postbuild: sync-bundled-extension.mjs -> resources/runtime/extensions/grok-build-oauth/
```

## Tests

```sh
npm run test -w @pipiui/grok-build-oauth-extension --maxsockets 3
# manifest + loader + oauth fake-server/clock/redact/abort/import + broker dedup/lock/atomic/401/redact
# + images contract/tier/storage/edit/401-retry + tool wiring (OAuth/api-key/gate/relay/abort/path)
```

Enable only takes effect on the **next** new session (`-e` spawn), disable disposes app half immediately and agent half with the session (D9).
