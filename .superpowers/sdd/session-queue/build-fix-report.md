# Build Fix Report — mid-migration compile

**Date:** 2026-07-23  
**Goal:** Restore `swift build` + `PIPIUI_SELF_TEST=1 swift run` without touching SessionMessageQueue feature code.

## Diagnosis

Reported errors were from a half-finished PiPlugin migration:

- `WebviewExtension.install(into:)` / `BossPrompt.install(into:)` require a target directory.
- `PiPlugin.installAll()` already installs into Application Support and returns paths.
- Early broken state: `AppStore` still called zero-arg `install()` or referenced removed `extensionPath` / `bossPromptPath` locals while `plugin = PiPlugin.installAll()` was partially wired.

## Current tree (verified on disk)

**Option B already complete** — no further source edits required in this pass.

### `Sources/PipiUI/AppStore.swift`
- Holds `private var plugin = PiPlugin.Installed()`
- `init` calls `plugin = PiPlugin.installAll()`
- `makeSession` passes:
  - `webviewExtension: plugin.webviewExtension`
  - `subagentDir: plugin.subagentDir`
  - `agentsDir: plugin.agentsDir`
  - `bossPromptPath: bossModeEnabled ? plugin.bossPrompt : nil`

### `Sources/PipiUI/ChatSession.swift`
- Init accepts `webviewExtension`, `subagentDir`, `agentsDir`, `bossPromptPath`
- Spawns with `-e` for webview + subagent dir when `bridgePort > 0`
- Sets `PIPIUI_BRIDGE_PORT`, `PIPIUI_SESSION_KEY`, optional `PIPIUI_AGENTS_DIR`

### `Sources/PipiUI/PiPlugin.swift`
- `installAll()` → Application Support `PipiUI/`, copies bundled `PiExt`, installs webview + boss prompt via `install(into: root)`

### Unchanged (as required)
- `SessionMessageQueue` and queue wiring left intact

## Verification

```text
$ swift build
Build complete! (2.07s)

$ PIPIUI_SELF_TEST=1 swift run
Build of product 'PipiUI' complete! (0.14s)
...
---
ALL PASSED
```

Self-test includes image, token, and **SessionMessageQueue** cases (enqueue/pop/abort/restore/join). All green.

## Files changed this pass

None — workspace already had Option B fully wired; this task verified compile + self-test and wrote this report.

## Status

**PASS** — build complete, ALL PASSED.
