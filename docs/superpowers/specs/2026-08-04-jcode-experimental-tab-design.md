# jcode 实验性 tab — 全局开关 + 终端 login 设计

> Status: **design, pending implementation plan.**
> Date: 2026-08-04.
> Supersedes the in-chat `EngineSwitcherOverlay` (commit 118cecd), which is
> reverted by this design.

## Background & decision path

Investigation confirmed pi and jcode are **two independent model/auth
systems** (not "shared"): jcode does not read `~/.pi/agent/.env`; its model
catalog comes from its own `runtime_info.routes`; OAuth is the only one-way
overlap (jcode imports pi's `auth.json` on request). A full "sync layer"
(replicating pi's AddModelSheet → writing `~/.jcode/config.toml`) was rejected
as too complex: it needs hand-written TOML (no lib in project), a pi→jcode
provider-id alias map (~15 providers, non-1:1), cannot cover OAuth providers
(claude/openai must `jcode login`), and `jcode provider remove` doesn't exist.

**Chosen direction (approved by user):** keep it simple and honest. Add a
global "启用 jcode 模式" toggle in a new **实验 (Experimental)** settings tab,
plus a button that opens Terminal running `jcode login` for credential setup.
No sync layer, no model picker in the tab — credentials and model selection
are jcode's own concern. jcode is positioned as an **experimental, independently-configured** engine, not a seamless peer of pi.

## Approved decisions

1. **Global toggle, either/or.** Checking "启用 jcode 模式" makes all *new*
   sessions use jcode; unchecking returns to pi. Existing sessions keep their
   engine (pinned at creation).
2. **No model picker in the tab.** jcode manages its own model (default after
   `jcode login`, or `/model` in-session). This is the honest cost of "two
   independent systems."
3. **Credentials via Terminal.** A button shells out to `osascript` → opens
   Terminal running `jcode login` (interactive provider menu). No in-app
   credential entry.
4. **Revert the in-chat EngineSwitcherOverlay** (commit 118cecd's overlay +
   `AppStore.switchEngine`). The sidebar `+` stays a plain pi-new-session
   button (already reverted in 118cecd). `EngineKind` / `.jcode` fork /
   `EngineBadge` are retained (they're the engine foundation).
5. **Confirmation dialog on toggle** (global behavior change).
6. **Status detection row** showing configured providers (from
   `jcode auth status --json`).

## Architecture

```text
Settings → 实验 tab
  ├─ JcodeSettings.isEnabled (UserDefaults "pipiui.jcode.enabled")
  │     ↓ read at session creation
  │  AppStore.newSession → engine = isEnabled ? .jcode : .pi
  │     ↓
  │  ChatSession.startProcess .jcode fork → JcodeBackend (existing, Plan B)
  │
  ├─ "在终端配置 jcode 凭证…" button
  │     ↓ osascript → Terminal
  │  jcode login  (interactive; user picks provider, completes OAuth/key)
  │
  └─ status row: "检测到 N 个 provider: …" or "未检测到已配置 provider"
        ↓ jcode auth status --json → filter status != not_configured
```

## Components

### 1. `JcodeSettings` (new, `Sources/PipiUI/JcodeSettings.swift`)

Thin UserDefaults-backed store, mirroring `BuiltInFeatureSettings`'s pattern:
- `static var isEnabled: Bool` — get/set UserDefaults key
  `"pipiui.jcode.enabled"` (default false).
- `static func detectConfiguredProviders() -> [String]` — shells out to
  `jcode auth status --json`, parses `providers[]`, returns `id`s where
  `status != "not_configured"`. Async (off main); empty if jcode missing.

### 2. `JcodeLoginLauncher` (new, small)

One static method:
```swift
static func openLoginInTerminal()
```
Runs `osascript -e 'tell application "Terminal" to do script "jcode login"'`
(verified working on this Mac). Brings Terminal to front. If jcode isn't on
Terminal's PATH (shouldn't happen — installer writes `.zshenv`), the command
falls back to the full path `~/.local/bin/jcode login`.

### 3. Settings tab additions

- `SettingsTab` enum: add `case experimental = "实验"` (8th segment; sheet is
  640pt wide, Chinese tab names are short — fits).
- `experimentalSection` view: a `GroupBox("jcode 引擎（实验性）")` containing:
  - Toggle "启用 jcode 模式" bound to `JcodeSettings.isEnabled`, with a
    `.confirmationDialog` on enable.
  - Descriptive text: "勾选后，新建会话将使用 jcode 引擎（独立凭证体系，需先配置）。"
  - Button "在终端配置 jcode 凭证…" → `JcodeLoginLauncher.openLoginInTerminal()`.
  - Status row: refreshes `detectConfiguredProviders()` on appear; shows
    "✓ 检到 deepseek, kimi" / "⚠️ 未检测到已配置的 provider". Since login
    happens in an external Terminal, the App can't know when it completes —
    the row refreshes each time the settings sheet opens (onAppear) and via a
    manual "刷新" link next to the status. No live polling.
  - If `JcodeBridge.findJcodeExecutable() == nil`: show "⚠️ 未检测到 jcode，
    请先安装（curl -fsSL https://jcode.sh/install | bash）" and disable toggle.

### 4. AppStore wiring

`newSession(project:)` and `createSessionInBackground(project:)` default
`engine` from `JcodeSettings.isEnabled` instead of hardcoded `.pi`. The
`engine:` param stays for explicit callers. No other AppStore changes.

## Revert of EngineSwitcherOverlay (commit 118cecd)

Revert these three pieces (keep the sidebar `+` plain-button revert that
118cecd also did — i.e. don't restore the split-button):
- Delete `Sources/PipiUI/Views/EngineSwitcherOverlay.swift`.
- Remove the `.overlay { EngineSwitcherOverlay(session: session) }` + its
  comment from `ChatDetailView.swift` (~:688-694).
- Remove `func switchEngine(for session:to:)` from `AppStore.swift` (~:1936).

The 23c3854 commit (`fix(jcode): wire get_state/get_available_models/set_model`)
is **retained** — those RPC adaptations are still needed for jcode sessions to
function (model list, state snapshot, set_model) once a jcode session exists.

## Data flow

1. User opens 设置 → 实验 → checks "启用 jcode 模式" → confirmation →
   `JcodeSettings.isEnabled = true` (UserDefaults).
2. User clicks "在终端配置 jcode 凭证…" → Terminal opens `jcode login` →
   user completes provider login → credentials land in jcode's own store.
3. User closes settings, clicks sidebar `+` (on a project) →
   `newSession(project:)` reads `isEnabled` → `engine: .jcode` →
   `createSessionInBackground` → `makeSession(engine: .jcode)` →
   `ChatSession` with `engineKind = .jcode` → `startProcess` `.jcode` fork →
   `JcodeBackend` (Plan B) → jcode session runs.
4. Sidebar shows the new session with `jc` badge (`EngineBadge`, retained).
5. Uncheck toggle → next new session is pi again; the jcode session stays jcode.

## Non-goals

- No model picker in the tab (jcode self-manages).
- No credential sync layer (no config.toml writes, no provider-id map).
- No in-chat engine switcher (the centered overlay is gone).
- No per-session engine choice at creation (it's global).

## Testing

- `swift test`: existing 1537 pass (no regression). New `JcodeSettings`
  UserDefaults round-trip test; `detectConfiguredProviders` JSON-parse test
  (fixture, no jcode needed).
- Manual: open App → settings → toggle → see confirmation → click login
  button → Terminal opens `jcode login` → complete login → new session is
  jcode (jc badge) → message round-trips.

## Risks

- **Terminal/PATH**: `jcode login` in a fresh Terminal relies on `.zshenv`
  having `~/.local/bin` (installer does this). Fallback to absolute path if
  needed.
- **`jcode auth status --json` stability**: parsed fields (`id`, `status`).
  Unknown providers in the list are ignored gracefully.
- **8th settings tab width**: segmented picker at 640pt with 8 Chinese labels
  — verify it doesn't truncate; if tight, the picker already uses `Text` not
  `Label` (per existing comment).
