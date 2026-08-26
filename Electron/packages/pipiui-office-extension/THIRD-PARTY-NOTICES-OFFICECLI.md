# OfficeCLI provenance

This package uses `@officecli/sdk@0.1.2` (Apache-2.0) from
https://github.com/iOfficeAI/OfficeCLI (maintainer: goworm).

Full attribution ships next to this file:

- `LICENSE-OFFICECLI` — Apache-2.0 text from upstream
- `NOTICE` — upstream NOTICE (must be retained)
- `licenses/officecli/` — LICENSE, NOTICE, THIRD-PARTY-NOTICES.txt

Native `officecli` v1.0.144 binaries are acquired from the immutable GitHub
release (not npm postinstall, not `latest`, not the d.officecli.ai mirror) into
`Electron/.officecli/<platform>-<arch>/extensions/office-extension/bin/<platform>-<arch>/`
and packaged at `bin/<platform>-<arch>/officecli`. Direct integration uses the SDK resident
pipe, not the MCP transport. Auto-update and SDK `install()` are disabled.

Write atomicity: `@officecli/sdk@0.1.2` has no atomic temp+rename. Path
validation rejects symlink components and re-checks immediately before
open/create. A directory can still be replaced between that last check and the
SDK process opening the path; that race is irreducible without OS file-handle
passing, which the SDK does not expose.
