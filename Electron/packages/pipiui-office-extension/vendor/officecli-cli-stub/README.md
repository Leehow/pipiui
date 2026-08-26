# @officecli/officecli stub

Replaces the upstream installer package so `npm install @officecli/sdk` cannot
download or auto-update a native binary. DirectOfficeAdapter never calls
`ensureBinary()` / `install()`; the real binary ships bundled at
`bin/<platform>-<arch>/officecli` (acquired by the checksum-pinned target cache,
see THIRD-PARTY-NOTICES-OFFICECLI.md).
