# Kimi Code 账号额度胶囊

日期：2026-07-24

## 问题

输入框右下角账号额度胶囊（`QuotaProvider`）目前只接了 Grok / GLM / Claude / Codex。用户通过 pi 使用 `kimi-coding` 时没有 5h / 周 / 月用量显示。各家额度 API 不通用，需按 CodexBar 的 Kimi 适配单独接入。

## 调研摘要

- PipiUI 模式：`*Credits.swift` → `QuotaSnapshot` → `QuotaMonitor` → `ModelInfo.quotaProvider` → `InputBar.metricsStatus`。
- 本机 CodexBar（`~/leehow/code/CodexBar`）已完整实现 Kimi：
  - **周 + 5h**：`GET https://api.kimi.com/coding/v1/usages`（Code API key / CLI OAuth），或 web `GetUsages`。
  - **月**：`POST …/MembershipService/GetSubscriptionStats`（需要 `kimi-auth` cookie），**不在** Code `/usages` 里。
- 用户本机已有 `~/.pi/agent/auth.json` → `kimi-coding`（`api_key`）。
- pi 文档：provider id `kimi-coding`，env `KIMI_API_KEY`。
- CodexBar 还支持浏览器 cookie 全量导入（SweetCookieKit + Full Disk Access）。本方案**不引入**该依赖。

## 方案对比

| 方案 | 做法 | 利 | 弊 |
|------|------|----|----|
| **A. 推荐：Code API + 轻量月额度补全** | pi/env/CLI key 拉 5h+周；有 `kimi-auth`（env 或 Kimi Desktop Cookies）时补月 | 对齐常用路径；无 SweetCookieKit/FDA | 无 Desktop/env 时看不到月 |
| B. 仅 Code API | 只显示 5h+周 | 最简 | 与 CodexBar 三档不一致 |
| C. CodexBar 全套 | 含 SweetCookieKit 浏览器导入 | 与 CodexBar 完全一致 | 依赖重、权限成本高 |

**采用 A。**

## 设计（采用 A）

### Provider 路由

- `QuotaProvider` 新增 `.kimi`，`accountLabel = "Kimi 账号额度"`，`monitor = KimiQuotaMonitor.shared`。
- `ModelInfo.quotaProvider`：非 relay 且 `provider` 匹配 `kimi`（含 `kimi-coding`）时返回 `.kimi`。
  - **不**把 Moonshot 开放平台（`api.moonshot.cn` / balance）算进本胶囊。

### 凭据解析（优先级，先命中先用）

用于 **Code `/usages`（周 + 5h）** 的 bearer：

1. `~/.pi/agent/auth.json` 的 `kimi-coding`（`api_key.key` 或 oauth `access`）
2. 环境变量：`KIMI_CODE_API_KEY`，其次 `KIMI_API_KEY`（pi 文档）
3. 未过期的 Kimi Code CLI：`~/.kimi-code/credentials/kimi-code.json`（或 `KIMI_CODE_HOME`），只读、不写回、不 refresh

用于 **月额度补全** 的 `kimi-auth`（可选，best-effort）：

1. `KIMI_AUTH_TOKEN`（或 `kimi_auth_token`）
2. Kimi Desktop Cookies DB：`~/Library/Application Support/kimi-desktop/Cookies` 中明文 `kimi-auth`（与 CodexBar `KimiDesktopAuthToken` 同逻辑：拷贝后只读 SQLite）

**不做**：浏览器 cookie 导入、SweetCookieKit、CodexBar Settings「Cookie source」UI。

### 拉取与窗口映射

1. 有 Code bearer → `GET https://api.kimi.com/coding/v1/usages`
   - 顶层 `usage` → 窗口 id `weekly`，标签 `周` / `周额度`
   - `limits[0]`（`duration: 300` + `TIME_UNIT_MINUTE`）→ id `fiveHour`，标签 `5h` / `5小时额度`
   - used% = `used/limit`，缺 `used` 时用 `limit - remaining`
2. 若解析出任一窗口，且有 `kimi-auth` → best-effort `POST https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats`（body `{}`，headers 对齐 CodexBar webRequest）
   - `subscriptionBalance`（`FEATURE_OMNI` / `SUBSCRIPTION`，`amountUsedRatio`）→ id `monthly`，标签 `月` / `月额度`（ratio×100）
   - `ratelimitCode7d`：**跳过**。Code `/usages`（或 web GetUsages）的顶层 `usage` 已是周额度，再展示 `code7d` 会重复。
3. 无 Code bearer、仅有 `kimi-auth` → 走 web `GetUsages`（`FEATURE_CODING`）拿周+5h，再同上补月（覆盖「只有 Desktop 登录」）
4. 两者皆无 → 返回 nil，胶囊不显示

胶囊默认窗口：沿用现有 `QuotaSnapshot.capsule`（用户已选 > 最高 used%）。

### 文件与接线

- 新增 `Sources/PipiUI/KimiCredits.swift`：AuthStore、WebBilling/Fetcher、snapshot 映射、`KimiQuotaMonitor`
- Desktop cookie 读取可放同文件或小文件 `KimiDesktopAuthToken` 逻辑内嵌（系统 SQLite3，无新 SPM 依赖）
- 改：`QuotaSnapshot.swift`（enum + monitor）、`ChatSession.swift`（routing）、`MultiProviderQuotaTests.swift`（routing + labels）
- 新增：`Tests/PipiUITests/KimiCreditsTests.swift`（fixture 解析：Code API、SubscriptionStats 月窗口、凭据优先级）

### 失败策略

与现有 monitor 一致：失败静默、保留上次快照；月补全失败不影响周/5h。

### 测试

- Routing：`kimi-coding` → `.kimi`；relay / moonshot-open 不误匹配（按实现约定）
- Parse：Code API fixture → 两窗口百分比与 reset
- Parse：SubscriptionStats → monthly used% = `amountUsedRatio * 100`
- Auth：pi auth.json api_key 优先于 env（可用临时文件注入测）

### 非目标

- Moonshot 开放平台余额
- SweetCookieKit / 浏览器 cookie 导入
- CodexBar 配置 UI / FDA 引导文案
- Extra Usage 余额展示（除非后续单独开）

## 参考

- 本地 CodexBar：`Sources/CodexBarCore/Providers/Kimi/`（尤其 `KimiUsageFetcher.swift`、`KimiUsageSnapshot.swift`、`KimiDesktopAuthToken.swift`）
- [CodexBar docs/kimi.md](https://github.com/steipete/CodexBar/blob/main/docs/kimi.md)
- [pi providers — Kimi For Coding](https://pi.dev/docs/latest/providers)
