# Subagent 思考强度按模型能力动态过滤 — 设计规格

日期：2026-07-26
状态：待用户审阅（spec-only，未实现）
关联：`docs/superpowers/specs/2026-07-24-settings-tabs-tools-subagent-models-design.md`（前置：Subagent 模型选择与思考强度 picker 的落地）

---

## 0. 摘要

设置 →「Subagent 模型」tab 里，每个 agent 类型的「思考强度」picker 当前对**所有**模型硬编码展示 8 个选项（默认 / 关闭 / 极低 / 低 / 中 / 高 / 极高 / 最大）。本设计把它改为：**按当前所选模型的真实推理能力动态过滤可选项**，并在模型切换导致旧选择不再兼容时自动复位为「默认」。能力来源是一份**静态、策展的 capability map**（仿 `ModelPricing.Catalog`），而不是设置页里的 `get_available_thinking_levels` RPC。派出端的 Node 扩展 `PiExt/subagent/index.ts` **不改**，保留其现有的 suffix-strip 防御。

本文件是**规格**：只描述要做什么、为什么、涉及哪些文件、字段、UI、迁移、错误处理与验收；不包含产品代码改动。

---

## 1. 已批准的产品决策（输入，不可改）

1. Subagent 思考强度须**按所选模型真实能力动态过滤**。
2. **非推理模型**：思考强度 picker 仅显示「默认（由模型决定）」一个选项，不显示「关闭思考」（对非推理模型关思考无意义，应由模型决定）。
3. **普通推理模型**：可显示 默认 / 关闭思考 / 极低 / 低 / 中 / 高（6 项）。
4. **极高 / 最大**：仅当 capability map 表明该模型支持时才显示（共 8 项）。
5. **切换模型后**：若旧思考强度选择在新模型下不再兼容，自动复位为「默认」。
6. **Pi spawn**（`PiExt/subagent/index.ts`）**保留现有 clamp 做防御**：不在派出端新增能力过滤逻辑；UI 层是权威过滤层。

> 说明：第 6 条中的「现有 clamp」指 `index.ts` 里 `PI_THINKING_LEVELS`（行 335）集合与 `stripModelThinkingSuffix`（行 337–342）——它只用于剥离 `model:thinking` 简写后缀，并不校验 `--thinking` 取值合法性。本设计**保持该行为不变**，不在此处新增校验。

---

## 2. 现状（调研基线）

### 2.1 设置页（`Sources/PipiUI/Views/SettingsSheet.swift`）

- `SubagentModelRow`（约 1260–1330 行）：模型 picker（跟随主 Agent / 具体模型）+ 思考强度 picker。
- 思考强度 picker **硬编码** 8 项：
  - `""` → 「默认（由模型决定）」（`SubagentModelSettings.defaultThinkingSentinel`）
  - `"off"` → 「关闭思考」
  - `"minimal"` → 「极低」
  - `"low"` → 「低」
  - `"medium"` → 「中」
  - `"high"` → 「高」
  - `"xhigh"` → 「极高」
  - `"max"` → 「最大」
- `.disabled(selection.isEmpty)`：选「跟随主 Agent」（`selection == ""`）时思考 picker 禁用。
- 选模型回调链：`SubagentModelRow.onSelect` → `SettingsSheet.setSubagentModelOverride(_:for:)`。
- 选思考回调链：`SubagentModelRow.onSelectThinking` → `SettingsSheet.setSubagentThinkingOverride(_:for:)`。

### 2.2 模型选择写回（`SettingsSheet.setSubagentModelOverride`）

```swift
let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
let currentThinking = subagentSettings[agentName]?.thinking
SubagentModelSettings.setOverride(
    trimmed.isEmpty ? nil : trimmed,
    thinking: currentThinking,      // 切模型时保留旧 thinking
    for: agentName
)
```

- `trimmed.isEmpty`（跟随主 Agent）→ `setOverride` 内部 `map.removeValue(forKey:)`，**同时清除 model 与 thinking**。
- `trimmed` 非空（显式模型）→ 写入 `Override(model, thinking)`，**thinking 原样保留**。
- 因此「复位」只需在「两个显式模型之间切换」这一条路径上处理；切回跟随主 Agent 天然清空。

### 2.3 持久化（`Sources/PipiUI/SubagentModelSettings.swift`）

- `Override { let model: String; let thinking: String? }` —— **字段已存在，无需改 schema**。
- `defaultThinkingSentinel = ""`、`followMainSentinel = ""`。
- `setOverride(_:thinking:for:)` 写 UserDefaults `pipiui.subagentModels` 并同步热读 JSON（`subagent-models.json`）。
- `encodeForDefaults`：无 thinking → 写成裸字符串（legacy 形态）；有 thinking → 写成 `{model, thinking}` 对象。

### 2.4 派出端（`Sources/PipiUI/PiExt/subagent/index.ts`）

- `loadSubagentModelOverrides()`（行 304）热读 JSON，兼容裸字符串与 `{model,thinking}` 两种形态。
- `resolveAgentThinking(agentName)`（行 417）= `overrides[agentName]?.thinking`，**原样返回**。
- spawn（行 1452–1464）：`resolvedThinking` 非空 → `args.push("--thinking", resolvedThinking)`；同时 `stripModelThinkingSuffix` 剥离 `model:thinking` 简写后缀。**无任何 capability 校验**。

### 2.5 主会话思考强度（`Sources/PipiUI/ChatSession.swift`，**仅作对比，不改**）

- `@Published var thinkingLevels: [String] = ["off"]`（行 380）。
- `refreshThinkingLevels()`（行 1023）→ RPC `get_available_thinking_levels` → `data.levels`。
- `setThinkingLevel(_:)`（行 2628）→ RPC `set_thinking_level`。
- 这是**当前主会话单一模型**的运行时级别，不是「任意候选模型的能力档案」。

### 2.6 模型枚举来源（`Sources/PipiUI/Resources/pi-auth-helper.mjs`）

- `listModels()` 调 `runtime.getAvailable()`，返回 `{ provider, id, name, contextWindow }`，**不含任何 thinking/reasoning 能力字段**。

### 2.7 可借鉴的静态目录模式（`Sources/PipiUI/Logging/ModelPricing.swift`）

- `ModelPricing.Catalog`：`static let shared`、`NSLock` 线程安全、bundled JSON（`Resources/model-pricing.json`）+ 硬编码 override、`lookupKeys(for:)` + `providerAliases` 多键解析、按 model id（lowercased）+ `provider/model` 双键索引。
- `Resources/model-pricing.json` 中已存在 `grok-4.20-0309-non-reasoning` 这类显式「非推理」命名，以及 `text-embedding-ada-002`、`gpt-image-2`、`*-tts-*`、`*-realtime-*` 等非聊天/非推理模型 id —— 可作为 capability map 的策展素材。

---

## 3. 目标

1. 引入一份**静态、策展的 capability map**（`ThinkingCapabilityCatalog` + bundled JSON），把任意模型 id 解析为三档能力之一：`nonReasoning` / `standard` / `extended`。
2. 让 `SubagentModelRow` 的思考强度 picker **按当前所选模型的能力档动态生成选项**，且文案与现有 tag 完全一致（不改 key）。
3. 在「显式模型 A → 显式模型 B」切换时，若旧 thinking 不被 B 支持，**自动复位为默认**并给出可见提示。
4. 应用启动/设置 reload 时做一次**幂等的兼容性归一化**，把历史遗留的不兼容 thinking 复位（平滑升级）。
5. **不改派出端**：`index.ts` 行为保持不变，UI 层是唯一过滤权威；保留 `PI_THINKING_LEVELS` suffix-strip 作为防御。

## 4. 非目标

- 不改主会话（composer/底栏）的思考强度菜单（`InputBar.thinkingMenu`、`ChatSession.setThinkingLevel`）——它已经由 `get_available_thinking_levels` 驱动，且只针对单一当前模型。
- 不改 `pi-auth-helper.mjs listModels` 的返回结构（不加 capability 字段）。
- 不改 `index.ts` 的 spawn 逻辑、不向其注入 capability map（见第 12 节理由）。
- 不在本设计内新增「按 agent 类型记忆各自偏好档位」「按 provider 通配」等增强（留作后续）。
- 不改 `Override` schema、不改 JSON 文件路径与命名。
- 不提交、不打包（本轮 spec-only）。

---

## 5. 数据模型 / API 字段

### 5.1 能力档枚举（新增，spec 描述）

```swift
enum ThinkingTier {
    case nonReasoning   // 仅「默认」
    case standard       // 默认 + off + minimal + low + medium + high
    case extended       // 默认 + off..high + xhigh + max
}
```

### 5.2 Tag 与可见集合（不变 key，仅集合化）

- 全集（有序，picker 顺序）：`["", "off", "minimal", "low", "medium", "high", "xhigh", "max"]`
- `standard` 可见：`["", "off", "minimal", "low", "medium", "high"]`
- `nonReasoning` 可见：`[""]`
- `extended` 可见：全集。
- 「默认」tag 恒为 `""`（= `SubagentModelSettings.defaultThinkingSentinel`），永远在最前且永远可见。

### 5.3 Capability 目录 API（新增 `ThinkingCapabilityCatalog`，仿 `ModelPricing.Catalog`）

```swift
final class ThinkingCapabilityCatalog: @unchecked Sendable {
    static let shared = ThinkingCapabilityCatalog()

    /// 解析模型引用（provider/modelId 或裸 id）→ 能力档。未知 → .standard
    func tier(forModel ref: String) -> ThinkingTier

    /// 该模型允许的有序 tag 列表（驱动 picker）。
    func allowedLevels(forModel ref: String) -> [String]

    /// 某个 thinking tag 是否被该模型允许（复位判断用）。
    func allows(_ level: String, forModel ref: String) -> Bool
}
```

- 线程安全：`NSLock`（与 `ModelPricing.Catalog` 一致）。
- 解析键：复用 `ModelPricing.lookupKeys(for:)` 的多键策略（`provider/model`、裸 `model`、provider 别名），统一 lowercased。
- 兜底：JSON 缺失/解析失败 → 全部按 `standard`（**永不**把未知模型判成 nonReasoning 或 extended；`extended` 必须 JSON 显式声明）。

### 5.4 capability map 数据（新增 `Resources/thinking-capabilities.json`）

JSON schema（两份显式列表，其余皆为 standard）：

```json
{
  "nonReasoning": [
    "grok-4.20-0309-non-reasoning",
    "gpt-image-2",
    "text-embedding-ada-002",
    "gemini-embedding-2",
    "gemini-embedding-001"
  ],
  "extended": [
    "grok-4.5",
    "grok-4.3"
  ]
}
```

> 上面是**结构示例**。实施时由维护者按各厂商最新文档核对/增补条目；本设计不在此断言任何具体型号的真实能力。判定算法（见 5.5）必须完全确定、无歧义，不依赖这些示例值。

### 5.5 判定算法（确定、无歧义）

对输入 `ref`：

1. 取 `keys = lookupKeys(for: ref)`（lowercased 多键）。
2. **extended 优先**：任一 key 命中 `extended[]` → `.extended`。
3. 否则 **nonReasoning**：任一 key 命中 `nonReasoning[]` → `.nonReasoning`。
4. 否则 **启发式 nonReasoning**：裸 model id（去 provider 前缀、lowercased）匹配以下子串之一 → `.nonReasoning`：
   `non-reasoning`、`embedding`、`-tts-`/`tts-preview`、`image`（且非 `*-image-preview` 的聊天模型时仍判 nonReasoning，保守）、`realtime`、`computer-use`。
   > 启发式只用于**降级**到 nonReasoning，绝不会把模型升级到 extended。
5. 否则 → `.standard`（未知模型的默认安全档）。

`allowedLevels(forModel:)` = 按 5.2 把 tier 映射为有序 tag 数组。

---

## 6. 数据流

### 6.1 picker 渲染

```
SubagentModelRow.selection (model id, 可能为 "")
  └─> 若 == ""（跟随主 Agent）：思考 picker 禁用（沿用 .disabled(selection.isEmpty)）
  └─> 否则：ThinkingCapabilityCatalog.allowedLevels(forModel: selection)
            └─> picker 仅枚举这些 tag，文案见第 8 节
```

- 计算量极小（一次字典查找），可直接在 `SubagentModelRow.body` 内算；或在父视图预算后随参数传入（保持 `SubagentModelRow: Equatable` 的 diff 友好——若传入，需加入 `==`）。

### 6.2 模型切换 → 复位（核心新增逻辑）

路径：`SubagentModelRow.onSelect` → `SettingsSheet.setSubagentModelOverride(newValue, for:)`，扩展为：

```
newValue (trimmed)
 ├─ isEmpty（跟随主 Agent）：照旧 removeValue（清 model+thinking），无复位需求
 └─ 非空（显式模型 B）：
     oldThinking = subagentSettings[agent]?.thinking   // 可能 nil/empty
     if oldThinking 非空 且 Catalog.allows(oldThinking, forModel: B) == false:
         newThinking = nil                              // 复位为默认
         statusMessage = "已重置 \(agent) 的思考强度（\(B) 不支持该档位）"
     else:
         newThinking = oldThinking                      // 保留
     SubagentModelSettings.setOverride(B, thinking: newThinking, for: agent)
```

- 只在「显式 → 显式」且旧值非空且不被新模型支持时复位；其余路径完全保留现状。
- 复位后 `subagentSettings = SubagentModelSettings.allSettings()` 刷新（已有），picker 下次渲染自然落到「默认」。

### 6.3 启动/Reload 归一化（升级迁移）

在 `SettingsSheet.reload()` 末尾、`recomputePickerModels()` 附近，新增一次幂等扫描：

```
for (agent, override) in subagentSettings:
    if override.model 非空 且 override.thinking 非空
       且 Catalog.allows(override.thinking, forModel: override.model) == false:
        setOverride(override.model, thinking: nil, for: agent)   // 静默复位
subagentSettings = SubagentModelSettings.allSettings()
```

- 静默（不弹 statusMessage），因为这是升级时的自动修复，不是用户动作。
- 幂等：第二次 reload 不会再写。

### 6.4 派出（不变）

```
index.ts: resolveAgentThinking(agent) ──> overrides[agent]?.thinking
spawn:   if resolvedThinking: args.push("--thinking", resolvedThinking)
         + stripModelThinkingSuffix（现有防御，保留）
```

- 因 UI 已保证写入的 thinking 必然被所选模型支持（且 reload 归一化兜底），正常路径下 `resolvedThinking` 永远合法。
- 即便有遗留/手工编辑的非法值漏到 spawn，也由 pi 运行时对 `--thinking` 的自身校验兜底（**现有 clamp 做防御**，符合决策 6）。

---

## 7. 精确涉及文件与责任

| 文件 | 类型 | 责任 |
|------|------|------|
| `Sources/PipiUI/ThinkingCapability.swift` | **新增** | `ThinkingTier`、`ThinkingCapabilityCatalog`（shared、NSLock、JSON 加载、lookupKeys 复用、5.5 算法）。 |
| `Sources/PipiUI/Resources/thinking-capabilities.json` | **新增** | `{ nonReasoning: [...], extended: [...] }` 两份策展列表（资源 bundle，随 `PipiResourceBundle` 打包，与 `model-pricing.json` 同目录）。 |
| `Sources/PipiUI/Views/SettingsSheet.swift` | **编辑** | (a) `SubagentModelRow`：思考 picker 选项由 `ThinkingCapabilityCatalog.allowedLevels(forModel: selection)` 生成；`nonReasoning` 时用只读文案替代 picker（见 8.3）；保持 `.disabled(selection.isEmpty)`。(b) `setSubagentModelOverride`：加入第 6.2 节复位逻辑与 statusMessage。(c) `reload()` 末尾加入第 6.3 节幂等归一化。 |
| `Sources/PipiUI/SubagentModelSettings.swift` | **不改 schema** | `Override`/`setOverride`/`defaultThinkingSentinel` 复用；必要时可加便捷方法 `thinkingNeedsReset(model:thinking:)`，但非必需。 |
| `Sources/PipiUI/PiExt/subagent/index.ts` | **不改** | 保留 `PI_THINKING_LEVELS`、`stripModelThinkingSuffix`、`resolveAgentThinking`、spawn `--thinking` 透传（决策 6）。 |
| `Sources/PipiUI/Resources/pi-auth-helper.mjs` | **不改** | `listModels` 返回结构不变（见第 12 节）。 |
| `Sources/PipiUI/ChatSession.swift` | **不改** | 主会话思考强度链路独立，不在本设计范围。 |
| 测试（新增） | **新增** | `ThinkingCapabilityCatalog` 与复位/归一化逻辑的单测（见第 11 节）。 |

> Package.swift：`thinking-capabilities.json` 走现有资源打包流程（与 `model-pricing.json` 一致），无需改 `Package.swift`。

---

## 8. UI 状态与中文文案规则

### 8.1 tag → 文案（**保持不变**，与现有 picker 一致）

| tag | 文案 | 备注 |
|-----|------|------|
| `""` | 默认（由模型决定） | 恒可见、恒首位 |
| `"off"` | 关闭思考 | 非推理模型不显示 |
| `"minimal"` | 极低 | |
| `"low"` | 低 | |
| `"medium"` | 中 | |
| `"high"` | 高 | |
| `"xhigh"` | 极高 | 仅 extended 显示 |
| `"max"` | 最大 | 仅 extended 显示 |

### 8.2 三档可见性（对应决策 2/3/4）

- **非推理模型**：仅显示“默认（由模型决定）”（不显示「关闭思考」）。
- **普通推理模型**：默认 / 关闭思考 / 极低 / 低 / 中 / 高。
- **extended**：默认 / 关闭思考 / 极低 / 低 / 中 / 高 / 极高 / 最大。

### 8.3 非推理模型的 picker 表现

- 由于只剩唯一选项，picker 失去意义：把思考强度控件替换为**只读说明行**（禁用态），文案：
  > `该模型为非推理模型，思考强度由模型决定。`
- 仍保留 `.disabled(selection.isEmpty)`（跟随主 Agent 时）的现有禁用与 help：
  > `跟随主 Agent 时仅跟随当前底栏模型`

### 8.4 复位提示文案（statusMessage）

- 模型切换触发复位：`已重置 \(agent) 的思考强度（\(modelId) 不支持该档位）`
- 不复位时不弹该提示。reload 归一化**不弹**任何提示。

### 8.5 一致性约束

- 任何写入 `Override.thinking` 的值必须是 `""` 或 `{"off","minimal","low","medium","high","xhigh","max"}` 之一；复位恒写 `nil`（`setOverride` 内部会把 nil/空 视为「无 thinking」并落到 legacy 裸字符串形态）。

---

## 9. 兼容 / 迁移

- **UserDefaults / JSON 向前兼容**：`Override` schema 不变。老数据里的 `thinking` 若对当前 `model` 仍合法 → 保留；若不合法 → 第 6.3 节 reload 归一化静默复位为 nil，`model` 值不动。无数据丢失（模型选择保留），仅思考强度回到「默认」。
- **legacy 裸字符串形态**：无 thinking 的条目继续写成裸字符串（`encodeForDefaults` 不变），老版本扩展可继续读取。
- **降级**：若 `thinking-capabilities.json` 缺失/损坏 → catalog 全部返回 `standard`，picker 回到「6 项」基线，不影响模型选择与派出。
- **跨版本**：用户从旧版（8 项硬编码）升级后，第一次打开设置触发 reload 归一化，把 extended-only 的旧选择（xhigh/max）在 nonReasoning/standard 模型上复位。extended 模型上的 xhigh/max 选择**不丢**。
- **agent.md frontmatter model**（如 `xai/grok-4.5:high`）：本设计不解析 frontmatter 的思考强度；`resolveAgentModel` 仍只取 model，思考强度只来自 UserDefaults/JSON 覆盖。不变。

---

## 10. 错误处理

| 场景 | 行为 |
|------|------|
| `thinking-capabilities.json` 缺失 | catalog 视所有模型为 `standard`；UI 显示 6 项 |
| JSON 解析失败 | 同上（catch → 空 map → standard 兜底） |
| 未知模型 id | `standard`（永不升级到 extended） |
| 启发式误判（把某推理模型判成 nonReasoning） | 用户可改回 standard——但 nonReasoning 下 picker 是只读说明，**无手动覆盖入口**；缓解：把易误判的 id 显式加入 JSON `extended` 或不放入 `nonReasoning`，启发式仅作保守兜底 |
| 手工编辑 JSON 写入非法 thinking | reload 归一化复位；spawn 端 pi 运行时再兜底 |
| catalog 并发访问 | `NSLock` 保护（与 `ModelPricing.Catalog` 一致） |
| `selection == ""`（跟随主 Agent） | 思考 picker 禁用（现状），不做任何复位/写入 |

> 关于「启发式误判」: 启发式**只降级到 nonReasoning、不升级**，最坏情况是把一个支持思考的模型临时只给「默认」档。这是可接受的保守方向；后续可由 JSON 显式条目修正，无需改代码。

---

## 11. 测试 / 验收标准

> 本节为规格定义的验收点；实现时落地为 `swift test` / `PipiUITestRunner` 用例。本轮不写测试代码。

### 11.1 `ThinkingCapabilityCatalog`

- 命中 `extended[]` 的模型 → `.extended`，`allowedLevels` = 8 项且顺序正确。
- 命中 `nonReasoning[]` 的模型 → `.nonReasoning`，`allowedLevels` = `[""]`。
- 命中启发式子串（如 id 含 `embedding`）且不在 `extended[]` → `.nonReasoning`。
- 既不在两表也不命中启发式 → `.standard`，`allowedLevels` = 6 项。
- `provider/model`、裸 `model`、provider 别名三种键都能命中同一档位。
- JSON 缺失/损坏 → 所有模型 `.standard`，不崩溃。
- `allows("", forModel:)` 对任意模型恒为 `true`（默认永远允许）。
- 并发：多线程并发 `tier(forModel:)` 不崩溃（NSLock）。

### 11.2 复位逻辑（`setSubagentModelOverride` 扩展）

- extended 模型 A 选 `xhigh` → 切到 standard 模型 B → thinking 复位为 nil，statusMessage 出现，`subagentSettings[B-agent].thinking == nil`。
- standard 模型选 `high` → 切到另一个 standard 模型 → thinking 保留 `high`。
- 任意模型选 `medium` → 切到 nonReasoning 模型 → thinking 复位为 nil。
- extended → extended（都支持 xhigh）→ 保留。
- 切到「跟随主 Agent」→ 整条 override 被移除（现状不变），无复位副作用。

### 11.3 reload 归一化

- 预置一条不合法历史数据（model=某 standard 模型, thinking=`xhigh`）→ 触发 reload → 该条 thinking 被静默复位为 nil，model 保留；第二次 reload 不再写文件（幂等，可用文件 mtime 或 JSON 内容断言）。

### 11.4 UI 渲染（人工 / 快照）

- standard 模型行：思考 picker 6 项；nonReasoning 模型行：只读说明行；extended 模型行：8 项。
- `selection == ""`（跟随主 Agent）：思考控件禁用。

### 11.5 派出回归（不新增）

- 用一条合法的 `thinking=high` 覆盖派出 subagent → `index.ts` spawn 参数含 `--thinking high`（与现状一致，证明未破坏）。
- 不要求、也不验证 spawn 端做 capability 过滤（决策 6）。

### 11.6 构建验收（主仓库命令级，仅作实现后参考）

- `swift build` 通过；`swift test`（或 `swift run PipiUITestRunner`）通过。
- 本轮（spec-only）**不**运行 `make-app.sh`、**不**产出 `build/PipiUI.app`。

---

## 12. 为什么不以「设置页 RPC」作能力来源

候选 RPC：`get_available_thinking_levels`（`ChatSession.refreshThinkingLevels`，行 1023）。结论：**不采用**，理由如下。

1. **作用域不匹配**。该 RPC 只返回**当前主会话那一个模型**的运行时级别。设置页列出的是**跨 provider 的全部已配置模型**，需要的是「每个候选模型」的能力档案，而非「当前模型」。
2. **无法低成本枚举**。要对每个候选模型调用它，必须为每个模型 spawn 一个 pi 会话（鉴权、网络、启动开销），设置页要的是即时、离线可渲染，根本不可行。
3. **生命周期缺口**。设置页可在**无打开会话**时打开（`store.currentSession == nil`，见 `SettingsSheet` 现有「当前无打开会话」分支），此时该 RPC 不可用。
4. **语义不完整**。该 RPC 返回的是 pi 运行时**当下**暴露的级别（可能含运行时默认、可能漏掉厂商实际支持但运行时未映射的档位），且**无法表达「非推理模型」**——一个不会思考的模型只会回 `["off"]` 之类，把「不能思考」和「思考被关」混为一谈，无法支撑决策 2（非推理模型单独处理）。
5. **稳定性与可策展性**。bundled JSON + 硬编码 override（仿 `ModelPricing.Catalog`）可随厂商文档独立演进、可对单模型精确覆盖、零网络依赖、可被单测固定；RPC 做不到。
6. **职责分离**。RPC 反映「运行时当前模型能跑什么」，capability map 反映「设置页候选模型档案」。两者用途不同，混用会让设置页渲染依赖一个不稳定、不可枚举的运行时接口。

> 因此：主会话的思考强度菜单继续用 `get_available_thinking_levels`（单一当前模型，合理）；**Subagent 设置页的候选过滤**用静态 capability map。`pi-auth-helper.mjs listModels` 也不扩展（第 4 节非目标），避免在模型枚举链路里塞入能力语义。

---

## 13. 自检（TBD / 模糊占位 / 与既有代码冲突扫描）

- **TBD / 模糊占位**：无。第 5.4 节 JSON 给的是**结构示例**并明确标注「实施时按厂商文档核对/增补」，判定算法（5.5）完全确定，不依赖示例取值；这不是 TBD。
- **与既有代码冲突**：
  - `SubagentModelSettings.Override` schema **不变** → 无冲突。
  - `index.ts` spawn 链路**不改** → 无冲突；现有 `PI_THINKING_LEVELS`/`stripModelThinkingSuffix` 保留。
  - `setSubagentModelOverride` 的「跟随主 Agent 清空整条」语义**保留**，新增复位只在「显式→显式」分支 → 无行为回退。
  - tag 与文案与现有 picker **逐字一致** → 不影响已有 UserDefaults 数据与扩展读取。
  - `reload()` 归一化是**幂等追加**，不改 reload 既有快照/刷新流程。
  - 资源打包沿用 `model-pricing.json` 同流程，不改 `Package.swift`。
- **边界确认**：
  - 「跟随主 Agent」时思考 picker 禁用（现状）→ 不尝试解析「主模型能力」，避免把主会话状态耦合进设置页。
  - 启发式只降级、不升级 → 不会把非推理模型误判成 extended。
- **未涵盖（已知留白，非本轮范围）**：按 provider 通配能力、按 agent 类型记忆偏好档、把 capability map 暴露给 `index.ts` 做二次过滤——均明确列入第 4 节非目标。

---

## 14. 默认决策一览（便于审阅）

1. 能力来源 = 静态策展 map（`ThinkingCapabilityCatalog` + `Resources/thinking-capabilities.json`），**非** RPC。
2. 三档：`nonReasoning`（仅默认）/ `standard`（默认+off+minimal+low+medium+high）/ `extended`（+xhigh+max）。
3. 非推理模型 picker 替换为只读说明行（唯一选项无意义）。
4. 复位触发点 = `setSubagentModelOverride` 的「显式→显式」分支 + `reload()` 幂等归一化。
5. 派出端 `index.ts` **不动**，UI 为唯一过滤权威，spawn 端保留现有 clamp 防御。
6. 文案与 tag 字面不变；`Override` schema 不变；资源打包流程不变。
