# PipiUI Server / 统一远程界面

`@pipiui/server` is the headless Node host for the same React build used by
`pipiui_e`. It serves `packages/ui/dist/browser`; `browser.tsx` connects to the
same-origin `/ws` endpoint through `createWsHost`.

## Architecture

```text
paired browser
  │ HTTPS + WSS (same origin)
  ▼
apps/server
  ├─ /pair/<uuid>#<32-byte hex secret> → short-lived HttpOnly cookie
  ├─ / → packages/ui/dist/browser
  └─ /ws → one scoped HostBackend per browser socket
               └─ PiHostBackend → pi --mode rpc
```

Each WebSocket receives a distinct `PiHostBackend`, its own event subscription,
and graceful backend cleanup when the socket closes. Host API requests,
responses, and `stream` / `agents` / `terminal` events use
`@pipi/host-api` protocol v2 unchanged.

## Pairing flow

1. Start the host. It prints one random `/pair/<uuid>#<secret>` link.
2. The fragment secret stays client-side until the pairing page posts it to the
   same-origin claim endpoint over HTTPS; ordinary request paths and proxy logs
   only contain the random room UUID.
3. A successful claim sets an HttpOnly, `SameSite=Strict` cookie and redirects
   to `/`, where the normal browser build opens same-origin WSS `/ws`.
4. The default TTL is 24 hours. Reopening the same link replaces the previous
   cookie/socket (Relay-compatible last-opener-wins behavior).

No account, email, OTP, or manually provisioned credential is added.

### Relay integration decision

`Relay/` remains a separately deployable tunnel for legacy/local hosts. Its
current tunnel browser speaks its older request/response command protocol and
ships a different UI; embedding it in this server would add a translation hop
and would not preserve the unified `createWsHost` WebSocket contract.

The minimal-intrusion server path therefore terminates the Relay-compatible
pairing contract locally in `src/relay-pairing.ts` (same UUID + fragment secret,
TTL, and replacement semantics), then connects directly to the native Host API
WSS. `Relay/` and `Sources/` are unchanged. A future Playwright/Steel adapter
can be injected with `browserBackend` without changing the UI or wire protocol.

## Capability downgrade

| Capability | Default server value | Notes |
| --- | --- | --- |
| `browser` | `false` | Only reported true with a real injected Playwright/Steel `browserBackend`. |
| `revealInFinder` | `false` | No desktop Finder on a headless server. |
| `computerUse` | `false` | No desktop capture/control in this host. |
| `terminal` | `false` | Set `PIPIUI_SERVER_TERMINAL=mock` for deterministic non-shell demo I/O. |

The UI disables Browser, Terminal, desktop-control, and Finder controls from
these values. Browser-provider names alone are intentionally not advertised as
working capability until an actual adapter is installed.

## Run

For the local browser development UI (real Pi models/providers and the same
`~/.pi/agent` state as Electron), run one command and open the printed pairing
link. The server binds only to loopback and serves the page at port 5173:

```bash
cd Electron
npm run dev:browser
```

The listener remains restricted to `127.0.0.1`, while the printed pairing link
uses the canonical `http://localhost:5173` browser origin. Keep using that
hostname after pairing because the authorization cookie is intentionally
host-only.

The server resolves the same `resources/runtime/auth/pi-auth-helper.mjs` used
by Electron. That helper runs Pi's canonical `ModelRuntime` with
`~/.pi/agent/.env` overlaid only in the helper child process, so environment-
backed official providers appear without copying API keys into server state or
Host API responses.

Do not use `electron-vite dev --rendererOnly` as a standalone web app: it has
no Electron preload and therefore no Pi Host transport. Mock data is available
only when the browser build is explicitly compiled with
`VITE_PIPIUI_DEMO=true`.

For the remote/headless server configuration:

```bash
cd Electron
npm run build -w @pipi/host-api
npm run build -w @pipiui/ui
npm run build -w @pipi/pi-backend
npm run build -w @pipiui/server
PIPIUI_SERVER_PUBLIC_ORIGIN=https://remote.example.com \
  PIPIUI_SERVER_HOST=127.0.0.1 \
  PIPIUI_SERVER_PORT=8788 \
  npm run start -w @pipiui/server
```

Use a TLS reverse proxy for the public origin (or set both
`PIPIUI_SERVER_TLS_KEY` and `PIPIUI_SERVER_TLS_CERT`). When the page is HTTPS,
`browser.tsx` automatically chooses `wss://…/ws`.

Useful environment variables:

- `PIPIUI_SERVER_PUBLIC_ORIGIN` — required for a public bind; an HTTPS origin in production.
- `PIPIUI_SERVER_PAIRING=false` — local development only; disables pair-cookie protection.
- `PIPIUI_SERVER_TERMINAL=disabled|mock` — default `disabled`.
- `PIPIUI_SERVER_BROWSER=disabled|playwright|steel` — provider declaration; a real adapter is still required before it is advertised.
- `PIPIUI_SERVER_TLS_KEY` + `PIPIUI_SERVER_TLS_CERT` — optional direct TLS files.

## Verification

```bash
npm --prefix Electron run test -w @pipiui/server
npm --prefix Electron exec vitest run packages/host-api/test/contract.test.ts packages/ui/src/App.test.tsx
```

The server suite covers real `PiHostBackend` Host API events through WebSocket,
static build serving, capability downgrade, pairing cookie authorization, and
last-opener-wins replacement.
