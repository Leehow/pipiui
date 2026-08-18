---
name: add-extension
description: Add an MCP server or a third-party Pi extension to PipiUI when the user says 添加 MCP、加插件、加 Pi 扩展, pastes a marketplace/npm/config link, or sends a copied Settings prompt like “请把【厂商】的【MCP 名称】加到 PipiUI” / “请把这个 Pi 扩展加到 PipiUI”.
---

# Add an MCP server or Pi extension to PipiUI

Use this in the **main session** when the user wants PipiUI to gain an external
MCP server or a third-party Pi package/extension. This is a how-to, not a
permission grant.

Settings → 扩展 → 添加 only copies a sentence. The user pastes it here. Treat
that paste as an implementation request.

## What the user may give you

Any of: vendor + product name, a homepage, an npm package, a Pi package URL
(`https://pi.dev/packages/...`), or a ready-made MCP JSON snippet. If the
copied template still has `【厂商或服务名】` / `【MCP 名称】` or an empty
`链接：`, ask for the missing name or link once, then continue.

Do not ask them to fill a settings form. Do the install yourself.

## Decide which kind

- **MCP** — an MCP server (stdio / streamable-http / sse) that Pi should call
  as tools. PipiUI already mounts `pi-mcp-extension`.
- **Pi extension** — a Pi package that declares `pi.extensions` (tools, hooks,
  slash commands). Not an MCP server.

If both appear in one request, do MCP first, then the Pi package.

## MCP — write the config Pi actually reads

`pi-mcp-extension@1.5.0` (the copy PipiUI mounts) loads `{cwd}/.pi/mcp.json`
for this project. Pi homes are per-project. Never write `~/.pi/agent/mcp.json`
or any other global/shared Pi home.

Do not write MCP config into the Electron Application Support profile
expecting the client to see it. Default to `{cwd}/.pi/mcp.json`.

Read the existing file first. Keep every current `mcpServers` entry. Merge the
new server by name. Create the file if it is missing:

```json
{
  "settings": { "toolPrefix": "mcp" },
  "mcpServers": {}
}
```

New server rules:

- HTTP / SSE: `transport` is `streamable-http` or `sse`, `url` is required,
  `lifecycle` is `eager`.
- Local process: `transport` is `stdio`, `command` is required, `args` /
  `env` as the official docs say, `lifecycle` is `eager`.
- This client does **not** interpolate `${VAR}`. Put literal values, or tell
  the user which environment variable the process must already have.
- Do not invent command/url. Look up the official install docs. If you cannot
  find a trustworthy source, stop and say so.
- Do not write secrets into chat more than once. Prefer an env var the user
  already has. If a key must go into `mcp.json`, say that the file now holds it.
- File mode `0600` when you create or rewrite `mcp.json`.
- Do not edit PipiUI's bundled runtime, `managed-npm`, or `pi-mcp-extension`
  itself.

After writing, say that MCP tools show up on the **next** session (this
extension reads config at session start). Offer `/reload` only as a maybe;
do not claim the current turn already has the new tools.

## Pi extension — install where the next session will mount it

Electron launches Pi with `--no-extensions`. A `pi install` / `settings.json`
`packages` entry will **not** load. User extensions load from:

`$PI_CODING_AGENT_DIR/user-extensions/<name>/`

`PI_CODING_AGENT_DIR` is already in the process environment. Do not fall back
to `~/.pi/agent` for Pi packages.

Steps:

1. Look up the package (npm name or `https://pi.dev/packages/...`). Confirm it
   is a Pi package with `pi.extensions`.
2. Install it into that directory, not into the repo and not into
   `~/.pi/agent`. Example:

   `npm install --prefix "$PI_CODING_AGENT_DIR/user-extensions/<name>" --maxsockets 3 <package>`

   Always pass `--maxsockets 3` on this machine.
3. The installed tree must have a `package.json` whose `pi.extensions[0]`
   points at a file inside that directory. The next PipiUI session mounts
   that entry with `-e`.
4. Do not add the package to `settings.json` `packages` as a substitute —
   that list is ignored in this host.
5. Do not copy third-party code into `Electron/resources/runtime`.

After installing, say a **new session** is required. The current process will
not pick up a new `-e` path.

## Stop and ask only when

- You cannot tell MCP from a Pi package, and the name/link does not resolve it.
- The official docs require a secret the user has not provided.
- The install would be destructive (overwrite an existing same-name server or
  extension with a different source). Confirm the replacement in one line.

Otherwise install, then report: what you added, which file, and that they
should open a new session to use it.
