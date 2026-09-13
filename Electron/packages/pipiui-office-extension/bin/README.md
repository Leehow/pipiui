# OfficeCLI native binaries

This directory in source is metadata only (`README.md`). Architecture-specific
`officecli` binaries are **not** committed. Packaging copies exactly one target
from `Electron/.officecli/<platform>-<arch>/extensions/office-extension/bin/<platform>-<arch>/`
into packaged `pipiui-runtime` (fixed extraResources `to`) so the resolver sees
`bin/<platform>-<arch>/officecli` (`officecli.exe` on win32) next to `receipt.json`.

DirectOfficeAdapter resolves the binary in this order only:

1. Injected test locator
2. Bundled candidate: `bin/<platform>-<arch>/officecli` (`officecli.exe` on win32)
3. Dev-only `PIPIUI_OFFICECLI_BINARY` (absolute path) when the extension is not packaged

Never PATH, never `~/.local/bin`, never network download, never user MCP config.
The receipt file is never treated as the executable.

Pinned release: iOfficeAI/OfficeCLI v1.0.147 (see `Electron/officecli-assets.json`).
