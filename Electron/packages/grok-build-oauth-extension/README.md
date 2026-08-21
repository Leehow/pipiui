# @pipiui/grok-build-oauth-extension

Canonical Grok Build OAuth + Image extension — **M1 skeleton only**.

One package, two halves, one `pipiui-extension.json` glue (spec `extension-architecture-v1` D1/D2). This package is the single source for both hosts (PipiUI + chatrpgv4/pi-coc) — no copied TS implementation.

M1 establishes:

- `id = grok-build-oauth` (`[a-z][a-z0-9-]*`), `version: 0.1.0`, stable
- `agent/dist/index.js` placeholder entry (no OAuth / no `images/generations` calls)
- `app/dist/panel.js` + `app/dist/image-card.js` placeholders
- manifest with `capabilities: settings.read, settings.write, bridge.emit, invoke.agent, stream.render`
- `app.settings.scope: app`, keys `ext.grok-build-oauth.*`, `format: secret` for token, `settingsVersion: 1`
- `lifecycle: dispose-app-immediate; unmount-agent-on-next-session` (D9)

No OAuth endpoint or image request is wired in M1. Full provider/tools/refresh/lock/images phases land later.

## Layout

```
pipiui-extension.json
agent/index.ts -> agent/dist/index.js
app/panel.tsx -> app/dist/panel.js
app/image-card.tsx -> app/dist/image-card.js
```

## Install (three locations, D10)

- Bundled runtime: `Electron/resources/runtime/extensions/grok-build-oauth/`
- App profile: `pi-agent/extensions/grok-build-oauth/`
- Project: `{project}/.pi/agent/extensions/grok-build-oauth/`

Scan order: builtin → app → project (project overrides enablement only).

## Build

```sh
npm run build -w @pipiui/grok-build-oauth-extension --maxsockets 3
# tsc -p agent/tsconfig.json && tsc -p app/tsconfig.json
```

## Tests

```sh
npm run test -w @pipiui/grok-build-oauth-extension --maxsockets 3
# vitest run — manifest validates, entries are buildable
```

Enable only takes effect on the **next** new session (`-e` spawn), disable disposes app half immediately and agent half with the session (D9).
