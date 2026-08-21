# __NAME__

PipiUI dual-half extension (`id`: `__ID__`). Agent half = function; app half = UI/settings; glued by `pipiui-extension.json`.

Do not import `@pipi/host-api` or use `window.pipiHost`. Types come from `@pipiui/extension-api`.

## Install (three locations)

Copy this directory to **one** of:

| Location | Path | Typical use |
|---|---|---|
| Project | `{project}/.pi/agent/extensions/__ID__` | **Development default.** Only this project's home is scanned. |
| App | App profile `pi-agent/extensions/__ID__` | User-level, shared across projects. |
| Builtin | Bundled runtime `extensions/__ID__` | Maintainers; default-enabled. Do not overwrite builtin files from a project. |

Never install into global `~/.pi`. `PI_CODING_AGENT_DIR` is always the opened project's agent home.

## Enable

1. Place the package as above.
2. Enable it in PipiUI (App-level table, or a project overlay in `{project}/.pi/agent`).
3. **Open a new session.** Agent half mounts only via spawn `-e`. Enable does not hot-mount a running session.

Disable disposes the whole app-half contribution group immediately; the agent half unmounts when that session ends.

## Dev loop

1. Edit `agent/` / `app/` / `pipiui-extension.json`.
2. `npm run build` (writes `agent/dist` and `app/dist` as declared in the manifest).
3. Open a **new** session after agent-half changes.
4. Settings keys must stay `ext.__ID__.*`. `"format": "secret"` never lands in settings JSON.

## Capabilities

Declared in the manifest and shown at install. Runtime calls outside the set return `capability_denied`. Empty `capabilities` is L0 only — it cannot ship `agent.extension` or a controlled `entry`.
