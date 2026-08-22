# @pipiui/grok-build-oauth-extension

Canonical Grok Build OAuth + Image extension — **M5 PipiUI host integration** (M4 Images transport + M3 Credential Broker + M2 Pi-native OAuth included) + review-hardening pass.

One package, two halves, one `pipiui-extension.json` glue (spec `extension-architecture-v1` D1/D2). Single source for PipiUI + chatrpgv4/pi-coc.

Hardening pass (reviewer MUST-FIX closure) adds:

- **Symlink/shared-profile safe persistence:** the broker resolves the credential target's REAL path first (`PI_COC_AGENT_DIR` > `PI_CODING_AGENT_DIR`); the lock and the atomic `tmp+fsync+rename` act on the canonical file, never on a project symlink (which a rename would replace, splitting the shared login), and every project pointing at the same App-profile file shares ONE lock. Persistence mirrors pi `FileAuthStorageBackend` semantics and is reachable only through broker methods.
- **Dependency-free heartbeat lock (`agent/oauth/lock.ts`):** no `proper-lockfile` in the bundle — a live holder heartbeats the lock mtime so a long refresh is never stale-broken (no fixed 30s deletion); crash stops the heartbeat and only then does atomic takeover (rename race, one winner) happen; release is owner-checked so a late release never deletes a new holder's lock. All OAuth network calls carry a 30s timeout.
- **Home precedence:** `PI_COC_AGENT_DIR` > `PI_CODING_AGENT_DIR`; both unset → explicit error. No global `~/.pi/agent` fallback anywhere (agent home, session-id persistence, image isolation root, host auth helper).
- **Compat is truly off by default:** `compatFallback=false` never touches `XAI_API_KEY` or the loopback relay; with `compatFallback=true`, the deprecated API-key/relay fallback only applies when OAuth is absent or expired-without-refresh. `/grok-build:status` and the panel reflect the same resolution.
- **Real `/grok-build:import`:** `--confirm` required, reads `~/.grok/auth.json` exactly once, validates issuer/client_id/expiry against the resolved config, persists via `broker.importCredential` (shared lock), never modifies/deletes the source.
- **Typed image results:** `image_gen`/`image_edit` return `content: [{type:"text",...},{type:"image", data, mimeType}]` + `details {path, mime, backend, model}`; the app-half `image-card` renders the actual image (typed blocks) instead of a JSON placeholder.
- **Reference-image containment:** filesystem refs must resolve (realpath) inside the allowed roots (cwd / agent-home attachments); arbitrary absolute paths and symlink escapes are rejected; data URLs unchanged; 400KB/JPEG-PNG limits kept.
- **Bearer only over HTTPS:** plain-HTTP base URLs are refused; loopback HTTP exists only for the deprecated compat relay with `compatFallback=true`.
- **Host library entry (`agent/dist/host.js`):** `createGrokBuildHostLibrary()` exposes `status()/generateImage()/editImage()` returning **bytes + b64 + mime + path + model** through the exact same broker/tier gate/ImagesClient/SessionImageWriter as the tools — no second implementation. The manifest declares `host.entry`; the bundled sync writes `pipiui-host-receipt.json` (sha256 + bytes) next to the manifest so a pi-coc resolver can verify both hosts consume the same artifact.
- **Device-flow fidelity:** server `expires_in` honored as the total deadline (checked before/after each sleep+fetch), `slow_down` grows `interval ×1.5` capped at 30s, verification URI must be HTTPS (loopback http tolerated only when the issuer itself is a loopback test server).
- Invoke bridge answers only the fixed `status` method; unknown methods are refused without echoing raw args (secret hygiene). Persistent panel status notices are dismissible.

M5 implements (PipiUI host half, on top of M4):

- **Bundled assembly via registry/manifest (no bypass):** the built package is synced into the Bundled runtime tree (`Electron/resources/runtime/extensions/grok-build-oauth/`, script `Electron/scripts/sync-bundled-extension.mjs`, wired as `postbuild`); `installRuntimeTree` re-syncs `BUNDLED_MANIFEST_EXTENSIONS` with `keepDist` so the compiled `agent/dist` + `app/dist` halves survive the `dist`-stripping runtime sync; packaged apps re-include it via a dedicated `extraResources` entry (pdf-inspector precedent). The extension loader discovers it as `origin=builtin`, default-enabled, non-uninstallable; mounting is `-e` at **new-session spawn only** (`SpawnRegisteredExtension`, D9).
- **`agent/provider.ts` — canonical provider factory (single source):** `createGrokBuildProvider()` carries the device/browser login + **pure network refresh** + `getApiKey`; the extension entry registers it via `pi.registerProvider`, and the PipiUI host registers the same factory into its auth `ModelRuntime` (in-process and `pi-auth-helper.mjs` external runtime), so the provider login panel shows Grok Build **without a live session**: 登录状态 / 重新登录 / 退出 / 凭证来源 / 到期时间 (new optional `AuthProviderInfo.expiresAtMs` / `credentialSource`, metadata only — credential values never cross IPC). `refreshToken` runs INSIDE pi's locked `credentials.modify()` (pi-ai `resolveStoredOAuth`), so it must never re-acquire the auth-store lock or persist by itself: it calls the lock-free/persistence-free `oauth/refresh.ts#refreshCredentialUnlocked` with the handed-in authoritative credential and returns the next value for pi to write (round-3 reviewer Critical — the previous broker-based callback self-deadlocked).
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
- `images/storage` — session/attachments isolation dir `<agentHome>/attachments/images/` (agent home = `PI_COC_AGENT_DIR` > `PI_CODING_AGENT_DIR`, fail closed otherwise), official `<n>.jpg` numbering resumed from dir scan, atomic `tmp → fsync → chmod 0600 → rename` over an `O_EXCL` placeholder, dir 0700; filenames are counter-generated so paths never escape the root
- `agent/index.ts` — `image_gen`/`image_edit` tools wired through the M3 broker: OAuth path uses `with401Retry` (early refresh + 401 single forced refresh + single retry); the deprecated `XAI_API_KEY` path shares the exact same client/payload but ONLY under `compatFallback=true` when OAuth is absent/expired-without-refresh; otherwise → actionable `/login grok-build` error; `compatFallback=true` + no usable credential → deprecated PipiUI loopback relay (`PIPIUI_GROK_RELAY`, default off, marked deprecated in result/logs)
- Typed result: `content: [{type:"text", text:"图像已生成: <path>"}, {type:"image", data, mimeType}]` (strict-decoded b64 reaches the model and the app-half `image-card` renderer as a typed image block), `details: {path, mime, backend, model}`
- Tests (34 new): request contract/payload/headers, base normalization, aspect whitelist, strict base64, status classification + truncation + redaction, abort, mime sniff, tier gate matrix, storage numbering/permissions/resume/abort, edit single/multi payload, ref resolution guards, broker 401 single retry + second-401 auth_expired + no-retry on 429, and full tool wiring (OAuth/api-key/gate/relay/abort/traversal/isolation)

M3 implements (on top of M2):

- `oauth/broker` — **Credential Broker** shared by provider requests and image tools: early refresh (60s window, 30-120 clamp), refresh rotation, `invalid_grant` → clear + re-login, network/5xx/timeout → preserve old, 401 single forced refresh retry, in-process promise dedup, cross-process heartbeat lock **on the resolved real credential target** + lock内重读 + freshness guard (`obtained_at`/`expires`), 0600 tmp/fsync/rename atomic write on the real file (symlinks never replaced), 绝不日志token, `with401Retry` single API for both provider and `image_gen`; controlled `importCredential` for the one-shot import
- Tests: concurrency dedup, cross-process lock simulation, stale-lock crash recovery, 0600/0700 permissions, secret redaction, abort, 401 retry, provider+image shared API

M2 implements:

- `id = grok-build-oauth`, `version: 0.1.0`
- `agent/dist/index.js` registers provider `grok-build` via `pi.registerProvider` with Pi-native OAuth (`/login grok-build` browser/device)
- `oauth/config` — issuer/client/scopes driven by `GROK_OAUTH2_*` env → `ext.grok-build-oauth.*` settings → prod defaults from official HEAD `19d42e35` (`https://auth.x.ai`, `b1a00492-073a-47ea-816f-4c329264a828`, 10 scopes), no guessing
- `oauth/device` — `POST {issuer}/oauth2/device/code` + `POST {issuer}/oauth2/token` form protocol, `referrer=grok-build`, `x-grok-client-version/surface`, `user_code`/`verification_uri` validation, `pending/slow_down/denied/expired` state machine, fake-server + fake-clock testable, abortable
- `refresh` — `grant_type=refresh_token`, rotation, `invalid_grant` → re-login, redacted errors. Two entry points share the one pure network refresh (`oauth/refresh.ts`): the provider callback (lock-free, pi persists inside its `credentials.modify`) and the broker path for image tools/host (lock + re-read + freshness guard + dedup + atomic write). A response without `id_token` keeps the existing tier/tier_raw/tier_source; a fresh `tier` claim wins (round-3 Warning).
- Credentials `access/refresh/expires/issuer/client/scopes/token_type/obtained_at` persisted via Pi Provider `auth.json` (`CredentialStore` modify/lock), not in ordinary `ext.*` settings; `format:secret` vault only for optional compat token, never written by OAuth flow
- No silent `~/.grok` read; explicit `/grok-build:import --confirm` reads `~/.grok/auth.json` once, validates issuer/client/expiry, persists via the broker, source untouched
- Redaction (`[redacted]`) on all logs/errors, `AbortSignal` cancels device poll and refresh, filesystem 0600/atomic via broker's `tmp+0600+fsync+rename` on the real target (cross-process heartbeat lock `agent/oauth/lock.ts`, no external dependency)

## Layout

```
pipiui-extension.json
agent/index.ts -> agent/dist/index.js  (provider grok-build via broker, import/status invoke, image_gen/image_edit via broker)
agent/provider.ts -> agent/dist/provider.js  (canonical grok-build provider factory; shared with the PipiUI host auth runtime)
agent/host.ts -> agent/dist/host.js  (stable host library entry: status/generateImage/editImage via the same broker+client; hash pinned by the bundled receipt)
agent/oauth/config.ts   issuer/client/scopes resolution
agent/oauth/home.ts     PI_COC_AGENT_DIR > PI_CODING_AGENT_DIR, fail closed
agent/oauth/device.ts   device_code + poll + refresh wire (30s timeouts, server expires_in honored)
agent/oauth/broker.ts   credential broker: earlyRefresh/rotation/401 dedup/real-target lock/atomic600/redaction/import
agent/oauth/lock.ts     dependency-free heartbeat cross-process lock (owner nonce, stale takeover)
agent/oauth/credentials.ts  OAuthCredentials shape
agent/oauth/redact.ts   secret redaction
agent/oauth/import.ts   explicit ~/.grok import (--confirm, one-shot read, validated)
agent/images/client.ts  Imagine API client (HTTPS-only base, contained reference roots, generations/edits payload + headers + classification + strict b64)
agent/images/tier.ts    advisory tier gate (explicit empty tier = free = gated; api-key never gated)
agent/images/storage.ts session image writer (numbered <n>.jpg, atomic, isolated)
agent/images/config.ts  base/model/session-id/tier/compat resolution + legacy relay base
agent/images/errors.ts  ImagesError codes + tier upsell prose
app/panel.tsx -> app/dist/panel.js
app/image-card.tsx -> app/dist/image-card.js  (typed image renderer)
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
