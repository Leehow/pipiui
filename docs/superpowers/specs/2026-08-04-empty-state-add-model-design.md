# 空页引导：添加模型 + 产品说明 + 提供商额度

> Status: **design, pending implementation plan.**
> Date: 2026-08-04.

## Background

刚安装或未选中会话时，detail 区显示 `EmptyStateView`（品牌 +「添加项目文件夹」）。
没有 AI API / 鉴权时应用无法真正运行，但空页没有添加模型入口；「添加模型」
（`AddModelSheet`）目前只能经设置 → 模型 tab 打开。额度/余额能力已存在
（`QuotaMonitor` / `BalanceMonitor`），但只挂在会话输入栏。

目标：把空页做成可用的首装落地页——先配凭据，再加项目；并说明本产品相对纯 Pi
多了哪些内置能力。

## Approved decisions

1. **API 优先 CTA**：无凭据时主按钮是「添加模型」，「添加项目文件夹」为次要；
   有凭据后主按钮切到「添加项目文件夹」，「添加模型」降为次要。
2. **直接弹出 `AddModelSheet`**：不经设置页、不自动打开 Settings。
3. **提供商列表仅有凭据时显示**：无凭据时不占位空列表；有则展示已配置提供商，
   能查额度/余额则显示，否则显示「已配置」。
4. **产品说明**：短段定位句 + 5 条功能要点（带小图标），不做营销卡片墙。
5. **增强现有 `EmptyStateView`**（方案 1），不新建独立 Welcome 路由，不做强制 wizard。

## Information architecture

Trigger unchanged: `store.currentSession == nil` → enhanced `EmptyStateView`.

Top → bottom:

1. **Brand** — `BrandMark` + one-line positioning copy
2. **Feature bullets** — ~5 items with SF Symbols
3. **Provider section** — only when credentials exist
4. **CTA row** — primary/secondary swap by credential state

```text
EmptyStateView
  ├─ BrandMark + tagline
  ├─ feature list (always)
  ├─ provider rows (if hasCredentials)
  │     name + quota% / balance / "已配置"
  └─ CTAs
        no creds:  [添加模型] primary   ·  添加项目文件夹 secondary
        has creds: [添加项目文件夹] primary ·  添加模型 secondary
              ↓
        .sheet { AddModelSheet { refresh } }
```

## Copy (Chinese, tunable in implementation)

**Tagline:** 基于纯 Pi 的桌面界面，并内置编排与工具能力。

**Feature bullets:**

| Icon (suggested) | Title | Detail |
|---|---|---|
| `person.3` | 多 Agent 编排 | 可并行派生子任务协作 |
| `magnifyingglass` | 内置搜索 | 模型无搜索时自动触发 |
| `doc.text.viewfinder` | 图片 OCR | 模型不识图时自动触发 |
| `desktopcomputer` | Computer Use | 可操作本机界面完成任务 |
| `antenna.radiowaves.left.and.right` | 远程控制 | 可远程接入并操控会话环境 |

**Buttons:** 「添加模型」「添加项目文件夹」

## Data & behavior

### Credential presence

Explicit union (search-only env keys like `TAVILY_API_KEY` do **not** count):

1. **`.env` model providers** — any `ProviderEnvMap.envVarsByProvider` env var
   for which `EnvFileStore.isConfigured(forKey:)` is true → that provider id
   is configured.
2. **`auth.json` oauth (and any remaining entries)** — each
   `PiAuthStore.list()` entry contributes its `providerId`. After Add Model
   api_key flow, `api_key` residue is cleared from auth.json, so this path is
   mainly oauth.

`hasCredentials == true` iff the union is non-empty.

Refresh on:

- `EmptyStateView.onAppear`
- `AddModelSheet` `onFinished` (after save/login)

### Provider list

- Show **only** providers in that union (display name = provider id or the
  same human label Settings already uses if one exists).
- Do **not** list unconfigured catalog providers.
- Deduplicate by provider id when both `.env` and auth.json mention the same id.

### Quota / balance

Reuse existing monitors; do not add new billing APIs.

- Map provider id → `QuotaProvider` / `BalanceProvider` when possible.
- Subscribe / `refreshIfNeeded` in the background; render names first, fill
  values when snapshots arrive.
- Display short form consistent with InputBar semantics (remaining % or
  balance amount string).
- Unsupported provider or fetch failure → show 「已配置」; never block or
  toast-error the empty page.
- Do not show local usage ledger (`TokenUsageStats`) here.

### Add Model sheet

```swift
.sheet(isPresented: $showAddModelSheet) {
    AddModelSheet {
        // reload configured providers + re-observe monitors
    }
    .environmentObject(store)
}
```

`AddModelSheet` stays unchanged. Optional: after successful add, keep the user
on the empty page (no auto-open Settings).

## Components

### Primary: enhance `EmptyStateView` (`Sources/PipiUI/App.swift`)

Local `@State` (not AppStore):

- `showAddModelSheet: Bool`
- `configuredProviders: […]` (id + display name + status text)
- observer tokens / Task handles for quota/balance (cleaned on disappear)

If the view grows unwieldy, extract `EmptyStateProviderRow` / feature bullet
subviews into `Sources/PipiUI/Views/EmptyState*.swift` — still rendered only
from `EmptyStateView`, no new navigation route.

### Optional thin helper

A small loader (e.g. `EmptyStateCredentialSummary`) that returns configured
provider ids + whether each maps to quota/balance — keeps disk I/O off the
main thread, mirroring `SettingsSheet.loadReloadSnapshot` style. Prefer
reusing existing list/credential helpers over duplicating env parsing.

## Out of scope

- First-launch forced wizard / multi-step onboarding
- Accounts, email/OTP, or any identity layer
- Changes to `AddModelSheet` UI/behavior
- Moving quota UI into Settings home
- Auto-selecting a session or project after adding a key
- jcode / experimental engine credential setup on this page

## Testing

- Unit/logic: credential summary helper (if extracted) — empty vs `.env` vs oauth.
- UI smoke (manual or existing test patterns):
  - no credentials → primary CTA is 添加模型; sheet presents `AddModelSheet`
  - after save → provider row appears; primary CTA flips to 添加项目文件夹
  - quota-capable provider shows a value or 「已配置」 on failure (no crash)
- Do not require packaging `PipiUI.app` for this feature's verification;
  `swift build` / targeted tests suffice in worktrees; primary checkout packages
  only when user asks.

## Success criteria

1. Fresh install with no keys: empty page explains the product and one-click opens
   Add Model.
2. After configuring a provider: empty page lists it (with quota/balance when
   available) and prioritizes adding a project folder.
3. Existing Settings → 添加模型 path remains intact.
