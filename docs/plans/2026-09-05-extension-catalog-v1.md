# 扩展目录 v1：静态索引 + 可安装列表

日期：2026-09-05
状态：方案，待拍板
上游规范：`docs/extension-architecture-v1.md`（下称「架构 v1」）。架构 v1 把「扩展市场 / 在线分发」列为 Out of Scope；本方案是它之后的第一步，**只做「浏览 → 安装 → 更新」闭环，不动信任模型**。

---

## 1. 目标与非目标

**用户能做到的事（验收口径）**

1. 打开 设置 → 扩展 → 「可安装」，看到一份官方维护的扩展列表：名称、一句话说明、最新版本、所需能力、支持平台、与本机是否兼容。
2. 点「安装」，扩展下载、校验、落盘、对当前项目启用，新会话即可加载；全程不用手里有 ZIP。
3. 已装的扩展在同一列表里显示「已安装 x.y.z」或「可更新 → a.b.c」，点「更新」走同一条事务。
4. 断网时列表仍能显示上次拉到的快照，并标明离线；安装按钮禁用。
5. 从列表装进来的扩展可以在「已安装」里卸载，卸载后列表回到「可安装」状态。

**明确不做**

- 第三方作者自签名 / 无签名包。v1 索引里只有官方签名包，沿用引擎「只认宿主钉死的 ed25519 公钥」的立场。
- 搜索服务、评分、评论、截图、下载量、动态后端。索引就是一个 JSON 文件。
- npm / pypi 作为安装源。引擎今天只对 `githubReleases` 跑事务，本方案不扩这条。
- 改 `pipiui-extension.json` manifest 合约。索引所需元数据全部来自已有 manifest 字段加发布时生成的字段。

---

## 2. 现状盘点

### 2.1 可以直接复用的件

| 件 | 位置 | 复用方式 |
|---|---|---|
| 更新事务 | `pi-backend/src/extension-update-engine.ts` `applyExtensionUpdate` | 不传 `currentVersion` 即为「全新安装」：discovery → 拉 `<id>-assets.json` → 下载 → SHA-256 + ed25519 → 解包 → hostApi 范围检查 → 收据 → 原子切槽。**安装与更新是同一个函数**。 |
| 资产索引格式 | 同上 `parseAssetIndex`，`scripts/pack-extension-release.mjs` 产出 | 每个扩展的 release 已经有 `<id>-assets.json`。目录索引只需指向仓库，不重复描述资产。 |
| 域名白名单 | `assertAllowedUpdateUrl`，只放 `github.com` / `api.github.com` / `objects.githubusercontent.com` / `release-assets.githubusercontent.com` | 目录索引也作为 GitHub Release 资产发布，**白名单一个域名都不用加**。 |
| 共享仓扫描 | `extension-loader.ts` `scanActiveSharedExtensionStore` | 事务写完 active slot 后 `extensionLoader.scan()` 即可让注册表看到它，origin 为 `app`。ZIP 安装已经走这条路。 |
| 启用与能力确认 | `setExtensionEnabled(id, true, "project", projectId)` + `getCapabilityGrant` / `confirmCapabilityGrant` | ZIP 安装的收尾原样照抄。 |
| 兼容判定 | `satisfiesExtensionHostApiRange(range, EXTENSION_HOST_API_VERSION)` | 列表里算「不兼容」用它，不另写 semver。 |
| 更新中心 | `apps/electron/src/main/update-center.ts` + `ui/src/UpdateCenter.tsx` | 「可更新」状态的语义和它保持一致；本方案不改更新中心，只在扩展页多一个入口。 |
| 版本发现 | `checkExtensionUpdate` | 目录索引自身的「有没有新版」也用它查。 |

### 2.2 必须先补的三个缺口

这三条不补，列表做出来也装不了或卸不掉。

**缺口 A：签名公钥没有钉进构建。**
`extension-seed.ts` `extensionUpdateSigningKey()` 只读环境变量 `PIPIUI_EXTENSION_UPDATE_PUBLIC_KEY`；仓库里没有任何地方在打包或启动时设置它。结果是打包后的 App 里公钥为空，引擎 fail closed，**今天「更新中心 → 更新扩展」在正式包里必然失败**。
修法：把 SPKI DER base64 公钥作为构建产物钉进 App（建议 `Electron/resources/runtime/extension-update-public-key.txt`，随 runtime 一起签名保护），`extensionUpdateSigningKey()` 改为「环境变量优先，否则读该文件」。环境变量保留给测试和本地开发。私钥不进仓库，放发布机。

**缺口 B：从共享仓装进来的扩展卸不掉。**
`uninstallExtension` 把 `appRoot` 设为 `<agentDir>/extensions`，而 ZIP / 事务装进来的包住在 `<agentDir>/extension-store/objects/<sha256>/`，且目录名是哈希不是 id。`removeExtensionPackageDirectory` 的越狱检查会抛 `extension directory escapes install jail`。**今天 ZIP 装的扩展在 UI 里点「卸载」就会报错**。
修法：给 uninstall 加一条 store 分支：若 `directoryOf(id)` 位于 `storeRoot/objects/` 之下，则不删目录，而是删 `extensions/<id>/active.json` 与 `previous.json`（收据保留），随后跑一次对象 GC（删除不再被任何 slot 引用的 `objects/<hash>`）。这一步放进 `extension-update-engine.ts`，与 `withUpdateLock` 同锁，免得和进行中的更新打架。

**缺口 C：更新中心只看内置 / app 且要求 manifest 自带 `updateComponents`。**
`listBundledUpdateExtensions` 的可更新判断是「component.id === extension.id 且 source 为 githubReleases」，这要求每个扩展的 manifest 自己声明自己的仓库。目录安装的扩展来源应以**索引**为准，不能靠包内自述（否则一个包可以把自己的更新源改走）。
修法：目录安装写收据时记录 `catalogSource: {owner, repo}`；「可更新」判定先看收据里的目录来源，再看 manifest 声明。更新中心本期不改，扩展页「可安装」视图自己算状态。

---

## 3. 决策

### D1. 索引形态：一份签名 JSON，作为专用目录仓库的 GitHub Release 资产

- 新建仓库 `Leehow/pipiui-extensions`（名字可改，独立于 `Leehow/pipiui` 主仓，否则「最新 release」会被 App 发布占掉）。
- 每次索引变更发一个 release，tag 为递增 semver（`v1.0.0`, `v1.0.1` …），资产两件：`pipiui-extension-catalog.json` 与 `pipiui-extension-catalog.json.sig`（ed25519，同一把官方私钥）。
- 客户端发现路径与扩展更新完全同构：`api.github.com/repos/Leehow/pipiui-extensions/releases` → 取最新 → 找目录资产 → 经 `assertAllowedUpdateUrl` 下载 → 验签。
- 索引 URL、仓库名在 pi-backend 里是常量，**渲染层永远不传 URL**。

备选：直接放 `raw.githubusercontent.com` 一个固定路径。更简单，但要扩域名白名单、要另设计签名验证与版本号，且 raw 有缓存延迟。不选。

### D2. 索引 schema

```jsonc
{
  "schemaVersion": 1,
  "version": "1.0.3",                 // 与 release tag 一致，parseAssetIndex 同款校验
  "generatedAt": "2026-09-05T10:00:00Z",
  "extensions": [
    {
      "id": "grok-build-oauth",       // 必须过 EXTENSION_ID_RE
      "name": "Grok Build",
      "description": "…",             // ≤ EXTENSION_DESCRIPTION_MAX_LENGTH
      "version": "0.2.0",             // 该扩展当前发布版本；release tag 为 v0.2.0
      "source": { "type": "githubReleases", "owner": "Leehow", "repo": "pipiui-ext-grok-build" },
      "category": "provider",         // ExtensionCategory 闭集
      "capabilities": ["bridge.emit", "invoke.agent", "stream.render"],
      "hostApi": ">=1.0.0 <2.0.0",    // 与 manifest 同一 comparator 文法
      "platforms": ["darwin-universal", "win32-x64", "linux-x64"],   // = assets.json 的 key 集
      "publisher": "official",        // v1 只允许 official
      "homepage": "https://github.com/Leehow/pipiui-ext-grok-build",  // 仅展示，永不拉取
      "license": "MIT"
    }
  ]
}
```

规则：

- `source` 沿用 `ExtensionUpdateComponentSource` 闭集，且 v1 只接受 `githubReleases`；解析时复用 `parseExtensionUpdateSource`。
- `capabilities` / `hostApi` / `category` 复用 manifest 的校验函数，保证索引里的值与包内一致；不一致以包内为准（安装后注册表读的是包）。
- 未知顶层键与未知条目键一律报错，不静默跳过，与 manifest 解析器同一态度。
- 单文件上限沿用 `EXTENSION_UPDATE_INDEX_MAX_BYTES`（1 MiB）。

### D3. 拉取、缓存、离线

- 缓存目录 `<storeRoot>/catalog/`：`catalog.json`（验签通过的原文）、`catalog.meta.json`（`{version, fetchedAt, sourceRelease}`）。写入走 tmp + rename。
- 刷新策略：进入「可安装」视图时若 `fetchedAt` 超过 6 小时则后台刷新；用户可手动「刷新」。刷新前先 `checkExtensionUpdate` 查目录仓库最新版本，与 `meta.version` 相同则不下载。
- 验签失败或解析失败：保留旧缓存，界面报「索引校验失败」，不清空列表。
- 无缓存且离线：视图显示「尚未获取扩展目录」与重试按钮。
- 拉取加 8 秒超时，与 `checkExtensionUpdate` 同预算；不阻塞 `listExtensions`。

### D4. 安装 = 现有事务 + ZIP 安装的收尾

`installExtensionFromCatalog(projectId, extensionId)`：

1. 从**本地已验签的缓存索引**取条目；找不到即拒绝。渲染层只传 id。
2. 平台不在 `platforms`、`hostApi` 不满足：在事务前拒绝，给出可读原因（事务自己也会拒，但那时已下载）。
3. `applyExtensionUpdate({ extensionId, source: entry.source, targetVersion: entry.version }, { storeRoot, seedRoot, signingPublicKey, activateHook })`。传 `targetVersion` 而非让引擎自己找最新，保证装的就是索引里写的版本。
4. `activateHook` 里读解包后的 manifest，校验 `manifest.id === entry.id`，不一致抛错让引擎回滚槽位。
5. 收据追加 `catalogSource` 与 `catalogVersion`（见缺口 C）。
6. `extensionLoader.scan(projectRoot)` → `setExtensionEnabled(id, true, "project", projectId)`。能力确认沿用现有 grant 流程与对话框。
7. 返回 `ExtensionDescriptor`，与 `installExtensionZip` 同签名，UI 可以共用成功提示。

同一 id 的并发安装由 `withUpdateLock` 天然串行。

### D5. 列表状态合并

后端 `listExtensionCatalog(projectId?)` 返回 `ExtensionCatalogItem[]`，每条在索引条目之上叠加：

| status | 判定 |
|---|---|
| `installable` | 注册表无此 id，平台与 hostApi 都满足 |
| `installed` | 注册表有此 id，版本相等或更高 |
| `updateAvailable` | 注册表有此 id，索引版本更高，且该包来源可走事务（收据 `catalogSource` 或 manifest 自述） |
| `builtin` | 注册表里该 id 为 builtin；显示但不给安装按钮，更新走更新中心 |
| `incompatible` | 平台或 hostApi 不满足，附原因 |

附带 `offline: boolean` 与 `catalogFetchedAt` 让 UI 打离线标。

### D6. 信任模型不变，索引本身也签名

- 扩展包：引擎已强制 ed25519，本方案不放松。
- 索引：同一把私钥签名。没签名或验签失败的索引不落缓存、不展示。这样 GitHub 账号被劫持也塞不进未签名条目。
- `publisher` 字段 v1 只认 `"official"`，出现其他值即整份索引无效。这是给以后开第三方留的位置，不是现在的功能。

### D7. 卸载补齐（缺口 B）

- `extension-update-engine.ts` 新增 `uninstallStoreExtension(storeRoot, id)`：持锁 → 删 active/previous 槽 → GC 无引用对象。收据保留用于审计。
- `uninstallExtension` 在调 `removeExtensionPackageDirectory` 前判定目录是否在 store 内，是则走上面这条。
- 内置扩展被 store 覆盖（seed-managed 六个）时，卸载只清槽，运行时自动回落到 seed，行为等同「回滚到内置版本」，UI 文案要说清。

### D8. UI：ExtensionsPane 新增「可安装」视图

- `selectedView` 从 `'packs' | 'skills' | 'mcp'` 扩为四值，加 `'catalog'`；左侧子导航多一项。
- 卡片沿用 `SkillCatalogCard` / `McpCatalogCard` 的密度与样式：名称、版本、一句话、能力标签、平台标签、状态徽标、主按钮（安装 / 更新 / 已安装 / 内置 / 不兼容）。
- 顶部：刷新按钮、`fetchedAt` 时间、离线标。
- 安装中：卡片内进度文案与禁用；完成后复用 `archiveNotice` 那条成功提示，并刷新「已安装」列表。
- 错误：把 `ExtensionUpdateError.code` 映射成中文（`signature_invalid` → 「签名校验失败，已拒绝安装」等），映射表放 `extension-add-copy.ts` 旁。
- `ExtensionsAddDialog` 文案改一行：先指向「可安装」列表，其次才是「让 Agent 帮你加」和 ZIP。
- 无 `installExtensionFromCatalog` 能力（preload 未注入）时整个视图隐藏，与 `installExtensionZip` 的 gating 一致。

### D9. 发布工具链

- 每个扩展：继续用 `scripts/pack-extension-release.mjs` 打签名 tar.gz + `<id>-assets.json`，发到该扩展自己的仓库 release。
- 目录：新增 `scripts/build-extension-catalog.mjs`，输入一份人工维护的源清单（`catalog/sources.json`：id → owner/repo），对每个仓库查最新 release，下载 `<id>-assets.json` 与包内 manifest 生成条目，校验通过后输出 `pipiui-extension-catalog.json` 并签名。**生成器不手写任何描述字段**，全部取自 manifest，杜绝索引与包漂移。
- 发布动作是一次 `gh release create`，失败重跑，不会半发布。
- 首批条目：`grok-build-oauth`（已是独立包，有 capabilities，是好样例）、`pipiui-theme-pack-extension`、`web-search-keys-extension`。六个 seed-managed 内置扩展也进索引，状态显示 `builtin`。

---

## 4. 接口变更

**`@pipi/host-api`**

```ts
export type ExtensionCatalogStatus = "installable" | "installed" | "updateAvailable" | "builtin" | "incompatible";
export type ExtensionCatalogItem = {
  id: string; name: string; description: string; version: string;
  category?: ExtensionCategory; capabilities: readonly string[];
  platforms: readonly string[]; hostApi?: string; homepage?: string; license?: string;
  status: ExtensionCatalogStatus; installedVersion?: string; reason?: string;
};
export type ExtensionCatalogSnapshot = { items: ExtensionCatalogItem[]; fetchedAt?: number; catalogVersion?: string; offline: boolean };

listExtensionCatalog?(projectId?: string, options?: { refresh?: boolean }): Promise<ExtensionCatalogSnapshot>;
installExtensionFromCatalog?(projectId: string, extensionId: string): Promise<ExtensionDescriptor>;
```

**pi-backend `index.ts`**：两个新 RPC 方法进 `HostMethod` 分发表；`uninstallExtension` 加 store 分支；`installExtensionZip` 的收尾抽成 `finishStoreInstall(id, projectId)` 给两条路径共用。

**Electron main / preload**：与 `installExtensionZip` 同一 gating 开关注入；渲染层拿不到 URL、仓库名、文件路径。

**新文件**：`pi-backend/src/extension-catalog.ts`（schema 解析、验签、缓存、状态合并），与 `extension-update-components.ts` 并列，保持 engine 文件不再长胖。

---

## 5. 测试

对标现有 `extension-update-engine.test.ts` 的注入式风格（`fetchImpl` 假响应、临时 storeRoot、假公钥）：

1. **索引解析**：合法样例通过；未知键、非 official publisher、非 githubReleases source、超 1 MiB、id 不合法各自报错且不写缓存。
2. **验签**：错误签名 → 保留旧缓存、返回 `offline: false` 且带错误；无网络 → 返回旧缓存 + `offline: true`。
3. **安装**：`targetVersion` 钉住；`activateHook` 遇到 manifest.id 不一致触发回滚，active 槽不变；装完注册表能列出、origin 为 `app`、项目启用表有记录。
4. **状态合并**：五种 status 各一例，含 seed-managed 内置被 store 覆盖后显示 `installed` 而非 `builtin`。
5. **卸载**：store 安装后卸载，槽文件消失、对象 GC、收据保留；卸载后 `listExtensionCatalog` 回到 `installable`。
6. **UI**：`ExtensionsPane.catalog.test.tsx` 钉「视图切换、五种状态按钮文案、安装成功提示、离线标、能力缺失时视图隐藏」，不钉 DOM 细节。
7. **公钥钉入**：打包后的 App 能读到公钥文件（现有 `runtime-package-contract.mjs` 里加一条断言）。

---

## 6. 里程碑

| 里程碑 | 内容 | 验收 | 依赖 |
|---|---|---|---|
| **M0 地基** | 缺口 A 公钥钉入；缺口 B store 卸载；生成一对正式 ed25519 密钥 | 正式包里更新中心能真更新一个内置扩展；ZIP 装的扩展能卸载 | 无 |
| **M1 索引** | 目录仓库建立；schema + 解析 + 验签 + 缓存（`extension-catalog.ts`）；`build-extension-catalog.mjs` 生成首份索引 | 后端测试 1、2 通过；`listExtensionCatalog` 能返回带状态的列表 | M0 |
| **M2 安装** | `installExtensionFromCatalog`；收据记来源；host-api 与 main 接线 | 命令行或测试里从索引装 `grok-build-oauth` 并在新会话可用 | M1 |
| **M3 列表** | ExtensionsPane「可安装」视图；错误码文案；添加对话框改文案 | 一台干净机器上完成第 1 节五条验收 | M2 |
| **M4 发布** | 三个首批扩展进各自仓库 release；索引 v1.0.0 发布；`docs/agents/packaging.md` 补发布步骤 | 正式包用户可见并可装 | M3 |

M0 可以立刻开工，它对现有功能就是修 bug。

---

## 7. 风险与留白

- **GitHub API 匿名限流**（60 次/小时/IP）。目录刷新每次两个请求，扩展安装每次两个；正常使用远不到上限，但 CI 或多开会撞。缓解：6 小时 TTL、失败退避、不做自动轮询。
- **单一密钥**。私钥泄露等于整条链失守。M0 时把私钥放在发布机的 keychain，不进任何仓库与 CI 环境变量；轮换方案（钉两把公钥过渡）留到需要时再做，本期只在公钥文件里预留数组结构。
- **seed-managed 内置扩展**同时出现在目录与更新中心，两处更新入口指向同一事务，不会冲突，但 UI 要避免两边状态不同步：目录视图刷新时同步触发 `listBundledUpdateExtensions`。
- **项目级启用**。目录安装默认只对当前项目启用，与 ZIP 一致；「对所有项目启用」按钮已有，不另做。
- 第三方发布、搜索、npm 源：见第 1 节非目标，等有真实第三方作者再开。
