# PipiUI Office extension

Independent dual-half extension: app preview is extension-owned; the agent tool
talks to OfficeCLI through `@officecli/sdk` and a resident native process.

- Manifest id: `office-extension`
- Workspace package: `@pipiui/pipiui-office-extension`
- Builtin runtime mirror (generated, do not edit): `Electron/resources/runtime/extensions/office-extension`

## App half

The renderer receives only path-free `DocumentRendererProps`. Host/core still owns
document read/watch/reload, path validation, and the single anydoc conversion engine.
The renderer has no Node, Electron, or IPC access.

## Agent half (direct only)

- Tool name: `pipiui_officecli` — the only tool this extension registers.
  Edits go through `DirectOfficeAdapter` → `@officecli/sdk` resident native
  process → bundled `officecli` binary. No MCP server, no MCP config, no
  credentials, no PATH lookup, nothing to set up.
- `docs/office/direct-mcp-parity-v1.json` is immutable historical evidence
  from the 2026-08 direct-vs-MCP cutover comparison; the harness that produced
  it was removed with the migration and it is not executed by any test.
- Direct `@officecli/sdk@0.1.2` resident pipe (the SDK starts one native resident per document path; the adapter reuses handles and serializes same-file commands)
- No user MCP server, credentials, or PATH/`~/.local/bin` lookup
- Native binaries ship via the checksum-pinned cache
  `Electron/.officecli/<platform>-<arch>/extensions/office-extension/bin/<platform>-<arch>/`
  into packaged `bin/<platform>-<arch>/officecli`. Dev-only override:
  `PIPIUI_OFFICECLI_BINARY` (absolute path, unpackaged only). Subprocesses run
  with `OFFICECLI_SKIP_UPDATE=1`.

Build syncs through the generic `scripts/sync-bundled-extension.mjs` (manifest,
README, NOTICE, LICENSE-OFFICECLI, `bin/`, `licenses/`, and `*/dist`). Never
hand-edit the runtime copy.

Write atomicity: SDK `Document.close()` flushes in place. Path validation
rejects symlink components and re-checks immediately before open/create. A
directory can still be replaced between that last check and the SDK process
opening the path; that race is irreducible without OS file-handle passing.
