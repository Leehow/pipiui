# Subagent 思考强度按模型能力动态过滤 — 设计规格

日期：2026-07-26
状态：**已由用户批准（批准日期：July 26, 2026）。spec-only，未实现。**
关联：
- `docs/superpowers/specs/2026-07-24-settings-tabs-tools-subagent-models-design.md`（前置：Subagent 模型选择与思考强度 picker 的落地）
- `docs/superpowers/plans/2026-07-26-subagent-thinking-capabilities.md`（实施计划。若计划与本规格的语义出现冲突，**以本规格的语义为准**。）

> 本文件是**规格**：只描述要做什么、为什么、涉及哪些文件、字段、UI、迁移、错误处理与验收；不包含产品代码改动，不提交、不打包。

---

## 0. 摘要

设置 →「Subagent 模型」tab 里，每个 agent 类型的「思考强度」picker 当前对**所有**模型硬编码展示 8 个选项（默认 / 关闭 / 极低 / 低 / 中 / 高 / 极高 / 最大）。本设计把它改为：**按当前所选模型的真实推理能力动态过滤可选项**，并在模型切换或设置 reload 导致旧选择不再兼容时自动复位为「默认」。

能力来源是 **model-list 元数据**：pi `Model.reasoning` 与 `Model.thinkingLevelMap`，经既有 `listModels()` / `get_available_models` 管线透出到 `ModelInfo`，由纯 Swift 解析器 `ThinkingCapability` 解析为可显示档位。**不引入任何本地策展的 JSON 能力清单，也不在设置页为每个候选模型做 `get_available_thinking_levels` RPC。** 派出端的 Node 扩展 `PiExt/subagent/index.ts` **不改**，保留其现有 suffix-strip 防御。

核心语义（详见 §1、§5）：所有 thinking levels 都遵循同一三态 Pi 规则——显式映射启用、显式 `null` 禁用、缺失键走 provider/Pi 默认；`reasoning == false` 的非推理模型仅显示「默认（由模型决定）」；`reasoning` 元数据未知时不做任何破坏性复位。

---

## 1. 已批准的产品决策（输入，不可改）

1. **按模型真实能力动态过滤**思考强度可选项；能力**唯一**来源是 model-list 元数据 `reasoning` 与 `thinkingLevelMap`。
2. **非推理模型**（`reasoning == false`）：思考强度控件替换为只读说明行，**仅显示「默认（由模型决定）」**一个选项，不显示「关闭思考」（对非推理模型关思考无意义，应由模型决定）。
3. **普通推理模型**（`reasoning == true`）：默认 / 关闭思考 / 极低 / 低 / 中 / 高。
4. **极高 / 最大**（`xhigh` / `max`）：仅当该模型的 `thinkingLevelMap` 把对应键显式映射到非空字符串时才显示。
5. **同一三态 Pi 规则适用于全部 8 档**（`off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`）：`thinkingLevelMap` 中键映射到非空字符串 → 启用；映射到 `null` → 禁用（该档不显示）；**键缺失 → 走 provider/Pi 默认**。不得把标准档位（off..high）无条件视为支持，也不得把 `xhigh`/`max` 的缺失键无条件视为不支持——缺失键一律交给 provider/Pi 默认决定。
6. **`reasoning` 元数据的「明确 false」与「缺失/未知」必须区分**：
   - `reasoning == false`（明确非推理）→ 仅「默认」。
   - `reasoning == nil`（模型不在内存列表、或 pi 未透出该字段、元数据未知）→ 标准档兜底，**且绝不因此对已持久化的 thinking 做破坏性复位**（见 §5.4、§6.2、§6.3、§9）。
7. **切换模型后**：若旧思考强度选择在新模型下不再兼容，自动复位为「默认」（持久化为 `nil`），`model` 值不动。
8. **设置 reload 归一化**：启动 / reload 时做一次幂等扫描，把不兼容的 thinking 复位为默认；第二次 reload 不再写文件。
9. **follow-main 不被误删**：选「跟随主 Agent」（`selection == ""`）时清空整条 override（model + thinking）是既有正确行为；归一化扫描只处理「有显式 model 且有非空 thinking」的条目，**绝不触碰 follow-main 条目**。
10. **未知 metadata 不写入**：当某模型元数据未知（`reasoning == nil`）时，复位判定返回原值（保留），**不写任何复位**。
11. **Pi spawn**（`PiExt/subagent/index.ts`）**保留现有 clamp 做防御**：不在派出端新增能力过滤逻辑；UI 层是权威过滤层。现有 clamp 指 `PI_THINKING_LEVELS`（`index.ts:335`）集合与 `stripModelThinkingSuffix`（`index.ts:338–343`）——它只用于剥离 `model:thinking` 简写后缀，并不校验 `--thinking` 取值合法性；`--thinking` 合法性最终由 pi 运行时兜底。

---

## 2. 现状（调研基线，feature 未实现）

### 2.1 设置页（`Sources/PipiUI/Views/SettingsSheet.swift`）

- `SubagentModelRow`（约 1234–1320 行）：模型 picker（跟随主 Agent / 具体模型）+ 思考强度 picker。
- 思考强度 picker **硬编码** 8 项（约 1267–1277 行）：`""`→「默认（由模型决定）」、`"off"`→「关闭思考」、`"minimal"`→「极低」、`"low"`→「低」、`"medium"`→「中」、`"high"`→「高」、`"xhigh"`→「极高」、`"max"`→「最大」。
- `.disabled(selection.isEmpty)`：选「跟随主 Agent」（`selection == ""`）时思考 picker 禁用。
- 选模型回调：`SubagentModelRow.onSelect` → `SettingsSheet.setSubagentModelOverride(_:for:)`（约 899–921 行）。

### 2.2 模型选择写回（`setSubagentModelOverride`，约 899–921 行）

切到「跟随主 Agent」（`trimmed == ""`）→ 清空整条 override（model + thinking）；切到显式模型 → 写入 `Override(model, thinking)`，**thinking 原样保留**。因此「复位」只需在「两个显式模型之间切换」与「reload 归一化」这两条路径上处理；切回跟随主 Agent 天然清空。

### 2.3 持久化（`Sources/PipiUI/SubagentModelSettings.swift`）

- `Override { let model: String; let thinking: String? }`——**字段已存在，无需改 schema**。
- `defaultThinkingSentinel = ""`、`followMainSentinel = ""`。
- `setOverride(_:thinking:for:)` 写 UserDefaults `pipiui.subagentModels` 并同步热读 JSON（`subagent-models.json`）。
- `encodeForDefaults`：无 thinking → 裸字符串（legacy 形态）；有 thinking → `{model, thinking}` 对象。

### 2.4 模型元数据（`ModelInfo`，`Sources/PipiUI/ChatSession.swift` 行 5–10）

`ModelInfo` 当前只有 `provider / modelId / name / contextWindow`，**不含** `reasoning` / `thinkingLevelMap`。本设计要把这两项透出到 `ModelInfo`，且 `reasoning` 必须能表达「未知」（见 §5.1）。

### 2.5 派出端（`Sources/PipiUI/PiExt/subagent/index.ts`）

- `loadSubagentModelOverrides()`（行 304）热读 JSON，兼容裸字符串与 `{model,thinking}` 两种形态。
- `resolveAgentThinking(agentName)`（行 417）= `overrides[agentName]?.thinking`，**原样返回**。
- spawn（行 1453–1464）：`resolvedThinking` 非空 → `args.push("--thinking", resolvedThinking)`；同时 `stripModelThinkingSuffix`（行 338–343）剥离 `model:thinking` 简写后缀。**无任何 capability 校验**。

### 2.6 主会话思考强度（`Sources/PipiUI/ChatSession.swift`，**仅作对比，不改**）

- `@Published var thinkingLevels: [String] = ["off"]`（行 380）。
- `refreshThinkingLevels()`（行 1024）→ RPC `get_available_thinking_levels` → `data.levels`。
- `setThinkingLevel(_:)`（行 2629）→ RPC `set_thinking_level`。
- 这是**当前主会话单一模型**的运行时级别，不是「任意候选模型的能力档案」。

### 2.7 模型枚举来源（`Sources/PipiUI/Resources/pi-auth-helper.mjs` + 进程内 handler）

- `pi-auth-helper.mjs listModels()`（行 100–110）调 `runtime.getAvailable()`，返回 `{ provider, id, name, contextWindow }`，**不含** `reasoning` / `thinkingLevelMap`。
- 进程内 `get_available_models` handler（`ChatSession.swift` 约 818–821）同样只取 `provider/id/name/contextWindow`。
- pi 的 `Model<Api>` 对象本身**已携带** `reasoning: boolean` 与 `thinkingLevelMap: Partial<Record<"off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max", string | null>>`，只是当前两条解析路径都未透出。本设计在这两条路径同源同语义地透出这两个字段。

---

## 3. 目标

1. 透出 model-list 元数据 `reasoning` / `thinkingLevelMap` 到 `ModelInfo`（两条解析路径：`pi-auth-helper.mjs listModels()` → `PiAuthHelper.listModels()`，以及进程内 `get_available_models` handler）；`reasoning` 缺失须记为「未知」而非 `false`（见 §5.1、§9）。
2. 新增纯 Swift 解析器 `ThinkingCapability`，把 `(reasoning, thinkingLevelMap)` 解析为有序可显示档位数组与复位判定；**纯函数、无 I/O、无清单文件、无 RPC、无启发式子串匹配**。
3. 让 `SubagentModelRow` 的思考强度 picker **按所选模型元数据动态生成选项**，非推理模型替换为只读说明行；文案与现有 tag 完全一致（不改 key）。
4. 在「显式模型 A → 显式模型 B」切换时，若旧 thinking 不被 B 支持（且 B 的元数据已知），**自动复位为默认**并给可见提示；`model` 保留。
5. 应用启动 / 设置 reload 时做一次**幂等**兼容性归一化，把历史遗留的不兼容 thinking 复位（平滑升级）；follow-main 与未知元数据条目不被破坏。
6. **不改派出端**：`index.ts` 行为不变，UI 层是唯一过滤权威，spawn 端保留现有 clamp 防御。

---

## 4. 非目标

- 不改主会话（composer / 底栏）的思考强度菜单（`InputBar.thinkingMenu`、`ChatSession.setThinkingLevel`）——它已由 `get_available_thinking_levels` 驱动，只针对单一当前模型。
- 不新增任何 RPC，不在设置页调用 `get_available_thinking_levels`。
- 不新增 `Resources/thinking-capabilities.json`，不新增 `ThinkingCapabilityCatalog` 或任何本地策展 / 启发式能力清单（理由见 §12）。
- 不改 `index.ts` 的 spawn 逻辑、不向其注入能力解析。
- 不在本设计内新增「按 agent 类型记忆各自偏好档」「按 provider 通配能力」等增强。
- 不改 `Override` schema、不改 JSON 文件路径与命名。
- 不提交、不打包（本轮 spec-only）。

---

## 5. 数据模型 / 能力解析

### 5.1 能力来源（model-list 元数据，唯一权威）

| 字段 | pi 来源 | Swift 表示 | 含义 |
|------|---------|-----------|------|
| `reasoning` | `Model.reasoning` | `Bool?`（`nil` = 未知；`.some(true)` / `.some(false)` = 明确） | 该模型是否具备推理能力。pi 明确返回 `false` → 非推理；pi 未透出 / 模型不在列表 → `nil`（未知）。 |
| `thinkingLevelMap` | `Model.thinkingLevelMap` | `[String: String?]?` | 把 thinking level 映射到 provider 值；`.some(nil)`（pi `null` / `NSNull`）= 该档被显式禁用；**键缺失** = 走 provider/Pi 默认。 |

> `reasoning` 与 `thinkingLevelMap` 由 pi 运行时的 `runtime.getAvailable()` 返回，是上游权威、按模型粒度、随厂商定义演进的元数据。PipiUI 只透出与解析，**不发明能力**。
>
> **三态约束（决策 6）**：透出层必须把「pi 未提供 `reasoning` 字段」记为**未知（`nil`）**，只有 pi 明确返回 `reasoning: false` 才记 `.some(false)`。把缺失静默当作 `false` 会把正常推理模型误判为非推理并触发误复位，**被本设计禁止**。

### 5.2 三态 Pi 规则（适用于全部 8 档，统一、无例外）

对每个候选档位 `L ∈ { "off", "minimal", "low", "medium", "high", "xhigh", "max" }` 与给定 `thinkingLevelMap`，取值分三态：**显式映射到非空字符串 → 该档启用；显式 `null` → 禁用（该档不显示）；键缺失 → 走 provider/Pi 默认。**

| `thinkingLevelMap[L]` | 语义 | 该档是否显示 |
|---|---|---|
| 非空字符串（显式映射） | 启用，并提供 provider 值 | **显示** |
| `null` / `NSNull`（显式禁用） | 该模型明确不支持此档 | **不显示** |
| 键缺失 | 走 provider/Pi 默认 | 由 provider/Pi 默认基线决定（见下） |

- **provider/Pi 默认的落地（不发明，只沿用上游基线）**：解析器不自行裁定缺失键的支持性，而是沿用上游能力基线。对推理模型，基线包含标准 6 档（`off` / `minimal` / `low` / `medium` / `high`，故这五档在缺失键时显示）；`xhigh` / `max` 不在标准基线内，缺失键时不显示——**但只要 provider 显式映射（字符串）即显示，显式 `null` 即隐藏**。对非推理模型，基线为空（仅剩默认 sentinel）。该基线反映上游 provider 能力声明，而非 PipiUI 写死的规则。
- 「默认」sentinel `""` 恒显示、恒首位、恒允许，**不参与**三态判定。
- **关键约束（决策 5）**：解析器**不得**把标准档位当成无条件支持——若某 provider 把标准档映射为 `null`，解析器必须隐藏该档（基线被显式 `null` 覆盖）。同理，**不得**把 `xhigh` / `max` 的缺失键当成无条件不支持——缺失键一律走 provider/Pi 默认，是否显示由上游能力决定，不由 PipiUI 写死。

### 5.3 能力解析器（`ThinkingCapability`，纯 Swift，新增）

```swift
enum ThinkingCapability {
    /// 标准推理基线（含首位默认 sentinel），供缺失键回退与未知兜底共用。
    static let standardTags: [String] = ["", "off", "minimal", "low", "medium", "high"]

    /// 按元数据返回有序可显示档位（含首位 ""）。
    static func allowedLevels(reasoning: Bool?, thinkingLevelMap: [String: String?]?) -> [String]

    /// 某档是否被允许（复位判断用）。"" 恒为 true。
    static func allows(_ level: String, reasoning: Bool?, thinkingLevelMap: [String: String?]?) -> Bool

    /// 切模型 / reload 时决定要持久化的 thinking；返回 nil 表示「复位为默认」。
    /// 元数据未知（reasoning == nil）时原样返回 oldThinking，绝不破坏性复位。
    static func resolvedThinking(persisted oldThinking: String?,
                                  reasoning: Bool?,
                                  thinkingLevelMap: [String: String?]?) -> String?

    /// 把 JSON 解析出的 `[String: Any]` 规整为 `[String: String?]`：
    /// NSNull → .some(nil)（显式禁用）；非字符串丢弃；结果为空返回 nil。
    static func parseThinkingLevelMap(_ raw: [String: Any]?) -> [String: String?]?
}
```

`allowedLevels` 行为（**逐档应用 §5.2 三态规则**，绝不硬编码「标准档恒支持」）：

- `reasoning == nil`（元数据未知）→ 返回 `standardTags`（标准 6 档兜底，绝不静默锁掉用户档位）。
- `reasoning == .some(false)`（明确非推理）→ 返回 `[""]`（仅默认）。
- `reasoning == .some(true)`（推理模型）→ 起始为标准基线 `["", "off", "minimal", "low", "medium", "high"]`，再按 `thinkingLevelMap` 逐档调整：
  - 对每个标准档 `L ∈ {off, minimal, low, medium, high}`：若 `thinkingLevelMap[L]` 为 `null` → 从结果移除；否则保留（缺失键与字符串映射均保留，前者来自 provider 默认基线）。
  - 对 `xhigh` / `max`：若 `thinkingLevelMap[L]` 为非空字符串 → 追加；为 `null` 或缺失 → 不追加（缺失走 provider/Pi 默认，而标准基线不含这两档）。
  - 结果恒以 `""` 起首并保持上述有序。

> 上述「起始为标准基线、再按 map 逐档覆盖」正是 §5.2 的算法化：标准档的「显示」源自 provider 默认基线（缺失键），而非无条件硬编码；任何档被显式 `null` 都会被移除。

### 5.4 复位判定（`resolvedThinking`，切模型 / reload 共用）

- `oldThinking` 为空 / nil（已是默认）→ 返回 `nil`（无变化）。
- `reasoning == nil`（元数据未知）→ **原样返回 `oldThinking`，不写任何复位**（决策 6、10）。
- `reasoning` 已知：若 `allows(oldThinking, reasoning:thinkingLevelMap:)` → 保留旧值；否则 → 返回 `nil`（复位为默认）。

---

## 6. 数据流

### 6.0 元数据透出（新增，两条路径同源同语义）

```
pi runtime.getAvailable()  →  Model<Api>{ reasoning, thinkingLevelMap, … }
   ├─ pi-auth-helper.mjs listModels()  → JSON {provider,id,name,contextWindow,reasoning,thinkingLevelMap}
   │      └─ PiAuthHelper.listModels() → ModelInfo(reasoning: Bool?, thinkingLevelMap)
   └─ 进程内 get_available_models RPC   → ModelInfo(reasoning: Bool?, thinkingLevelMap)
```

两条路径都用 `ThinkingCapability.parseThinkingLevelMap(_:)` 把原始 `thinkingLevelMap` 规整为 `[String: String?]`，严格区分 `null`/`NSNull`（显式禁用）与键缺失（走默认）。`reasoning` 字段缺失时一律记为 `nil`（未知），不得静默置 `false`（§5.1 三态约束）。

### 6.1 picker 渲染

```
SubagentModelRow.selection (model id, 可能为 "")
  ├─ == ""（跟随主 Agent）：思考 picker 禁用（沿用 .disabled(selection.isEmpty)）
  └─ 非空：在内存模型列表查 selection 的 (reasoning, thinkingLevelMap)
         └─ ThinkingCapability.allowedLevels(reasoning:thinkingLevelMap:) 生成有序档位
               ├─ reasoning == .some(false)（非推理）：替换为只读说明行（见 §8.3）
               └─ 否则：picker 仅枚举这些档位，文案见 §8.1
```

- 模型不在内存列表（`reasoning == nil`，元数据未知）→ `allowedLevels(reasoning: nil, …)` 返回标准 6 档兜底，用户不会被锁死。
- 计算极轻（纯内存 + 小字典），可直接在 `SubagentModelRow.body` 内算；若由父视图预算后随参数传入，需加入 `static func ==`，保持 `Equatable` diff 正确。

### 6.2 模型切换 → 复位（核心新增逻辑）

路径：`SubagentModelRow.onSelect` → `SettingsSheet.setSubagentModelOverride(newValue, for:)`：

```
newValue (trimmed)
 ├─ isEmpty（跟随主 Agent）：照旧清空整条 override（model + thinking），无复位副作用（决策 9）
 └─ 非空（显式模型 B）：
     oldThinking = subagentSettings[agent]?.thinking
     cap = 内存列表查 B 的 (reasoning, thinkingLevelMap)；不在列表 → (nil, nil)（未知）
     resolved = ThinkingCapability.resolvedThinking(
                    persisted: oldThinking, reasoning: cap.reasoning, thinkingLevelMap: cap.thinkingLevelMap)
     oldWasExplicit = oldThinking 非空
     didReset = oldWasExplicit && (resolved == nil) && (cap.reasoning != nil)   // 仅在有权威元数据时才算复位
     SubagentModelSettings.setOverride(B, thinking: resolved, for: agent)       // model 保留为 B
     statusMessage = didReset ? "已重置 …（B 不支持该档位）" : "已保存 …"
```

- 只在「显式 → 显式」、旧值非空、不被新模型支持、**且元数据已知**（`cap.reasoning != nil`）时复位；`model` 恒为 B（保留），只 thinking 落到 nil。
- 元数据未知（`cap.reasoning == nil`）→ `resolvedThinking` 返回原值 → 不复位、不写无关变更（决策 6、10）。

### 6.3 启动 / Reload 归一化（升级迁移）

在 `reload()` 末尾（`recomputePickerModels()` 之后）新增幂等扫描 `normalizeSubagentThinkingIfNeeded()`：

```
for (agent, override) in subagentSettings:
    model = override.model
    guard !model.isEmpty,                                     // follow-main 条目跳过（决策 9）
          let thinking = override.thinking,
          !thinking.isBlank else { continue }
    cap = 内存列表查 model 的 (reasoning, thinkingLevelMap)   // 不在列表 → (nil, nil)
    resolved = ThinkingCapability.resolvedThinking(
                   persisted: thinking, reasoning: cap.reasoning, thinkingLevelMap: cap.thinkingLevelMap)
    if cap.reasoning != nil && resolved == nil:               // 仅在有权威元数据且确需复位时写
        SubagentModelSettings.setOverride(model, thinking: nil, for: agent)   // model 保留
subagentSettings = SubagentModelSettings.allSettings()
```

- 静默（不弹 statusMessage）：升级自动修复，非用户动作。
- **幂等**：复位后 thinking 已为 nil，第二次 reload 该条目被 `guard` 跳过，不再写文件（须以行为测试验证，见 §11.3）。
- **follow-main 不被误删**：`model` 为空的 follow-main 条目天然被跳过（决策 9）。
- **未知 metadata 不写入**：`cap.reasoning == nil` 的条目不写复位（决策 10）。

### 6.4 派出（不变）

```
index.ts: resolveAgentThinking(agent) ──> overrides[agent]?.thinking（原样）
spawn:   if resolvedThinking: args.push("--thinking", resolvedThinking)
         + stripModelThinkingSuffix（现有防御，保留）
```

- UI 已保证写入的 thinking 必然被所选模型支持（reload 归一化兜底），正常路径下 `resolvedThinking` 合法。
- 即便有遗留 / 手工编辑的非法值漏到 spawn，pi 运行时对 `--thinking` 的自身校验兜底；`index.ts` 的 `PI_THINKING_LEVELS` + `stripModelThinkingSuffix` 仅做 suffix-strip，不做能力校验（决策 11）。

---

## 7. 精确涉及文件与责任

| 文件 | 类型 | 责任 |
|------|------|------|
| `Sources/PipiUI/ThinkingCapability.swift` | **新增** | 纯解析器：`allowedLevels` / `allows` / `resolvedThinking` / `parseThinkingLevelMap`（§5.3–5.4）。无 I/O、无清单文件、无 RPC、无启发式。 |
| `Sources/PipiUI/ChatSession.swift` | **编辑** | (a) `ModelInfo`（行 5–10）加 `reasoning: Bool? = nil`（`nil`=未知）与 `thinkingLevelMap: [String: String?]? = nil`（默认值保证既有 4 参 init 调用点不变）。(b) `get_available_models` handler（约 818–821）解析 `reasoning`（缺失→nil）/`thinkingLevelMap` 填入 `ModelInfo`。 |
| `Sources/PipiUI/PiAuthHelper.swift` | **编辑** | `listModels()`（约 112–123）从 helper JSON 解析 `reasoning`（缺失→nil）/`thinkingLevelMap` 填入 `ModelInfo`。 |
| `Sources/PipiUI/Resources/pi-auth-helper.mjs` | **编辑** | `listModels()`（行 100–110）从 `runtime.getAvailable()` 透出 `reasoning`（pi 缺失时透出 `null`，**不得**兜底成 `false`）与 `thinkingLevelMap`。 |
| `Sources/PipiUI/Views/SettingsSheet.swift` | **编辑** | (a) `SubagentModelRow`（约 1234–1320）：picker 选项由 `ThinkingCapability.allowedLevels(所选模型元数据)` 生成；非推理模型替换为只读说明行；保持 `.disabled(selection.isEmpty)`。(b) `setSubagentModelOverride`（约 899–921）：§6.2 复位逻辑 + statusMessage + `capability(forModelId:)` 查询。(c) `reload()`（约 1126–）：末尾新增 §6.3 幂等归一化 `normalizeSubagentThinkingIfNeeded()`。 |
| `Sources/PipiUI/SubagentModelSettings.swift` | **不改 schema** | `Override` / `setOverride` / sentinel 复用。 |
| `Sources/PipiUI/PiExt/subagent/index.ts` | **不改** | 保留 `PI_THINKING_LEVELS`(335)、`stripModelThinkingSuffix`(338–343)、`resolveAgentThinking`(417)、spawn `--thinking` 透传(1464)（决策 11）。 |
| 测试（新增 / 扩展） | **新增** | `ThinkingCapability` 行为单测 + 复位 / 归一化行为测试（见 §11）。 |

> 不新增 `Resources/thinking-capabilities.json`；`Package.swift` 不需改（无新资源文件）。

---

## 8. UI 状态与中文文案

### 8.1 tag → 文案（**保持不变**）

| tag | 文案 |
|-----|------|
| `""` | 默认（由模型决定） |
| `"off"` | 关闭思考 |
| `"minimal"` | 极低 |
| `"low"` | 低 |
| `"medium"` | 中 |
| `"high"` | 高 |
| `"xhigh"` | 极高 |
| `"max"` | 最大 |

### 8.2 可见性（对应决策 2/3/4/5）

- **非推理模型**（`reasoning == false`）：仅显示“默认（由模型决定）”（不显示「关闭思考」），控件替换为只读说明行。
- **推理模型**（`reasoning == true`）：默认 / 关闭思考 / 极低 / 低 / 中 / 高；`xhigh` / `max` 仅当 `thinkingLevelMap` 显式映射（非空字符串）时追加；**任何档**被显式 `null` 都不显示（含标准档）。
- **元数据未知**（`reasoning == nil`）：标准 6 档兜底（绝不锁死用户）。

### 8.3 非推理模型的 picker 表现

只剩唯一选项，picker 失去意义：把思考强度控件替换为**只读说明行**（禁用态），文案：
> `该模型为非推理模型，思考强度由模型决定。`

仍保留 `.disabled(selection.isEmpty)`（跟随主 Agent 时）的现有禁用与 help：
> `跟随主 Agent 时仅跟随当前底栏模型`

### 8.4 复位提示文案（statusMessage）

- 模型切换触发复位：`已重置 \(agent) 的思考强度（\(modelId) 不支持该档位）`
- 不复位时不弹该提示。reload 归一化**不弹**任何提示。

### 8.5 一致性约束

- 写入 `Override.thinking` 的值必须是 `nil` / `""` 或 `{"off","minimal","low","medium","high","xhigh","max"}` 之一；复位恒写 `nil`。

---

## 9. 兼容 / 迁移

- **schema 向前兼容**：`Override` 不变。老数据 `thinking` 若对当前 `model` 仍合法 → 保留；若不合法 → §6.3 reload 归一化静默复位为 nil，`model` 不动。无数据丢失（模型选择保留），仅思考强度回到「默认」。
- **legacy 裸字符串形态**：无 thinking 的条目继续写成裸字符串（`encodeForDefaults` 不变），老版本扩展可继续读取。
- **未知元数据不破坏**：模型若不在内存列表（`reasoning == nil`），归一化 / 复位都不动其 thinking（决策 6、10），避免在能力信息缺失时误删用户偏好。
- **`reasoning` 缺失 ≠ 明确 false（决策 6 的迁移含义）**：透出层把 pi 未提供的 `reasoning` 记为未知（nil）。因此一个「字段缺失」的推理模型不会被当作非推理而触发误复位 / 误显示只读行；只有 pi 明确返回 `reasoning: false` 才走非推理分支。这条「缺失 ≠ false」直接落实决策 6「明确 false 与缺失 / 未知必须区分，未知不可破坏性迁移」。
- **跨版本**：旧版（8 项硬编码）升级后第一次打开设置触发 reload 归一化，把 extended-only 旧选择（`xhigh`/`max`）在非推理 / 标准模型上复位；extended 模型上的 `xhigh`/`max` 选择**不丢**（前提是该模型 `thinkingLevelMap` 显式映射了它们）。
- **元数据未透出的降级**：若 `listModels` / `get_available_models` 因故没带上 `reasoning`/`thinkingLevelMap`（旧 helper、RPC 字段缺失）→ `ModelInfo.reasoning == nil`、`thinkingLevelMap == nil` → 解析器按未知兜底标准 6 档，picker 回到「6 项」基线，不影响模型选择与派出，也不触发误复位。

---

## 10. 错误处理

| 场景 | 行为 |
|------|------|
| 模型不在内存列表（元数据未知） | `allowedLevels` 返回标准 6 档兜底；`resolvedThinking` 原样返回旧值，**不复位、不写** |
| `thinkingLevelMap` 字段缺失 / 为空 | 视作「无显式覆盖」：推理模型显示标准 6 档，非推理仅默认 |
| `thinkingLevelMap[L] == null` | 该档被显式禁用，不显示（**即使是标准档**也必须移除） |
| `thinkingLevelMap[L]` 为非字符串（数字等） | 解析时丢弃该键（视同缺失 → 走 provider 默认），不崩溃 |
| helper / RPC 未透出 `reasoning` | 透出层记为**未知**（解析器按 nil → 标准 6 档兜底，不触发复位），**不得**静默当作 `false` |
| 手工编辑 JSON 写入非法 thinking | reload 归一化复位（仅当元数据已知且确不支持）；spawn 端 pi 运行时再兜底 |
| `selection == ""`（跟随主 Agent） | 思考控件禁用（现状）；切到该路径清空整条 override；归一化跳过该条目 |
| 并发访问 | `ThinkingCapability` 全静态纯函数，无共享可变状态，天然线程安全 |

---

## 11. 测试 / 验收标准

> **必须用真实行为测试验证**，不得依赖脆弱的源代码字符串 grep 作为主要验收手段。grep 断言只能作辅助回归提示，**永不**作为通过门。下列每条都要求「给定输入 → 断言行为输出」的行为用例。本轮不写测试代码，仅定义验收点。

### 11.1 `ThinkingCapability` 三态规则（逐档 × 三态）

对**每个**真实档位 `L ∈ {off, minimal, low, medium, high, xhigh, max}`，分别覆盖三种键状态：

- **缺失（absent）**：`thinkingLevelMap` 不含 `L` → 该档是否显示由 provider/Pi 默认基线决定（标准档显示、`xhigh`/`max` 不显示）；断言 `allowedLevels(reasoning: true, …)` 的结果集合正确。
- **映射（mapping）**：`thinkingLevelMap[L] = "<value>"` → 该档显示。
- **显式 null**：`thinkingLevelMap[L] = null` → 该档**不显示**（即使是 `off`/`minimal`/`low`/`medium`/`high` 等标准档也必须被移除——这正是「不得把标准档无条件视为支持」的可执行验证）。

并覆盖：
- `reasoning == false` → `allowedLevels == [""]`（仅默认）。
- `reasoning == nil` → 标准 6 档兜底。
- `allows("", …)` 对任意模型恒 `true`；`allows` 对 `null` 档恒 `false`。
- `parseThinkingLevelMap` 区分 `NSNull` → `.some(nil)`、字符串 → 值、非字符串 → 丢弃、空 → nil。

### 11.2 `resolvedThinking` 复位判定（行为）

- 标准模型持久化 `xhigh`（不支持）→ 返回 `nil`（复位）。
- extended 模型（`thinkingLevelMap["xhigh"]` 非空）持久化 `xhigh` → 保留。
- 非推理模型持久化 `high` → 返回 `nil`。
- 标准模型持久化 `high` → 保留。
- 已是默认（nil / `""`）→ 返回 `nil`（无变化）。
- **元数据未知（`reasoning == nil`）持久化 `xhigh` → 原样返回 `xhigh`，不复位**（决策 6、10 的行为验证）。
- 标准档被显式 `null`（如 `thinkingLevelMap["off"] = null`）且持久化 `off` → 返回 `nil`（被显式禁用而复位）。

### 11.3 模型切换复位与 reload 归一化（行为）

用真实 `setSubagentModelOverride` / `normalizeSubagentThinkingIfNeeded`（或等价入口）驱动，喂入样本 `ModelInfo` 元数据，断言：

- extended → 标准切换、持久化 `xhigh` → thinking 复位 nil，**model 保留为新模型**，statusMessage 出现。
- 标准 → 标准、持久化 `high` → 保留。
- 任意 → 非推理、持久化 `high` → 复位 nil。
- extended → extended（都映射 `xhigh`）→ 保留。
- 切到「跟随主 Agent」→ 整条 override 被移除（现状不变），**无复位副作用**；归一化不重新写入（决策 9）。
- **元数据未知不写**：目标模型不在列表时，复位不发生、不写文件（决策 10）。
- **幂等性（行为，非 grep）**：预置一条不合法历史数据（标准模型 + `xhigh`）→ 触发归一化 → thinking 被静默复位 nil、model 保留 → **第二次归一化不再写**（用 JSON 内容 / 写入计数 / 文件 mtime 断言）。

### 11.4 元数据透出（行为，非 grep）

- `parseThinkingLevelMap`：喂入代表性 `[String: Any]`（含字符串、`NSNull`、数字、缺失键），断言规整结果严格区分 null / 值 / 丢弃 / 缺失。
- `ModelInfo`：构造带 `reasoning` / `thinkingLevelMap` 的实例，断言字段流转正确；4 参默认 init 仍可编译且 `reasoning == nil`、`thinkingLevelMap == nil`。
- **缺失 ≠ false（行为）**：模拟 helper / RPC 输出中 `reasoning` 字段缺失 → 断言 `ModelInfo.reasoning == nil`（未知），而**非** `false`。
- helper / handler 透出：**优先**用行为方式验证——把一段固定 JSON（模拟 `runtime.getAvailable()` 输出）喂入解析路径，断言 `ModelInfo.reasoning` / `thinkingLevelMap` 与 null / 缺失的区分。若环境无法运行 helper 进程，至少以「固定输入 → 解析函数输出」的行为用例覆盖解析逻辑；**不得**用「源码里是否出现某字符串」作为通过门。

### 11.5 UI 渲染（人工 / 快照，非门）

- 标准模型行：思考 picker 6 项；非推理模型行：只读说明行；extended（映射 `xhigh`/`max`）模型行：7–8 项；`selection == ""`：控件禁用。信息性，绑定门为 §11.1–11.4。

### 11.6 派出回归（不新增）

- 合法 `thinking=high` 覆盖 → `index.ts` spawn 参数含 `--thinking high`（与现状一致）。不要求、不验证 spawn 端做能力过滤（决策 11）。

### 11.7 构建验收（仅实现后参考）

- `swift build` 通过；`swift test`（或无 XCTest 时 `swift run PipiUITestRunner`）通过。本轮 spec-only **不**运行 `make-app.sh`、**不**产出 `build/PipiUI.app`。

---

## 12. 为什么既不用「设置页 RPC」也不用「本地策展 JSON」

候选能力来源被否决的两个方向：

1. **设置页 RPC `get_available_thinking_levels`**（主会话 `ChatSession.refreshThinkingLevels`，行 1024）——不采用：
   - **作用域不匹配**：只返回当前主会话那一个模型的运行时级别；设置页需要的是「每个候选模型」的能力档案。
   - **无法低成本枚举**：要逐模型调用就得为每个模型 spawn 一个 pi 会话（鉴权 / 网络 / 启动开销），设置页要的是即时、离线可渲染。
   - **生命周期缺口**：设置页可在无打开会话时打开，此时该 RPC 不可用。
   - **语义不完整**：返回 pi 运行时当下暴露的级别，无法表达「非推理模型」，无法区分「不能思考」与「思考被关」。
   - **职责混淆**：RPC 反映「运行时当前模型能跑什么」；设置页要的是「候选模型档案」。两者用途不同。

2. **本地策展的 JSON 能力清单**（仿 `ModelPricing.Catalog`）——不采用：
   - **重复且会漂移**：`reasoning` / `thinkingLevelMap` 已是 pi `Model<Api>` 上权威、按模型粒度、随厂商定义演进的上游元数据，且已被 `runtime.getAvailable()` 返回；在 PipiUI 再维护一份手抄清单必然与上游漂移。
   - **粒度不足**：手抄清单只能粗分 nonReasoning / standard / extended 三档，无法表达「同一模型某档被显式 `null` 禁用」这种 provider 级声明，丢失 §5.2 的三态语义。
   - **可策展性劣势**：上游已策展且可被单测固定；本地副本只是重复劳动并引入维护负担。
   - **零网络依赖这一点元数据同样满足**：元数据随模型列表一次性返回，离线可渲染。

> 结论：能力来源 = model-list 元数据（`reasoning` / `thinkingLevelMap`），经既有 `listModels()` / `get_available_models` 透出。主会话思考强度菜单继续用 `get_available_thinking_levels`（单一当前模型，合理）；Subagent 设置页候选过滤用元数据。

---

## 13. 自检（残留旧方案扫描）

- **残留「本地策展能力清单」设计**：无。§4 非目标、§7 文件表、§12 理由均明确不新增 `Resources/thinking-capabilities.json`、不新增 catalog 类、不引入启发式子串匹配；能力来源统一为元数据。
- **残留「待审阅」状态**：无。状态已改为「已由用户批准（批准日期：July 26, 2026）」。
- **残留「逐模型 RPC」要求**：无。§4 / §12 明确不新增 RPC、不在设置页调 `get_available_thinking_levels`。
- **三态语义一致性**：§1 决策 5、§5.2、§5.3、§10、§11.1 自上而下统一为「映射启用 / null 禁用 / 缺失走 provider 默认」；标准档不被无条件视为支持，`xhigh`/`max` 缺失键不被无条件视为不支持。
- **`reasoning` 明确 false 与未知 nil 区分**：§1 决策 6、§5.1、§5.4、§6.2 / 6.3、§9、§10、§11.2 / 11.4 多处落实，未知不破坏性复位、缺失字段不静默置 false。
- **切模型 / reload 归一化真实行为**：§6.2 / 6.3、§9、§11.3 统一为「保留 model、把不兼容 thinking 复位 default、follow-main 不误删、未知 metadata 不写入、幂等」。
- **spawn clamp 防御语义**：§1 决策 11、§6.4、§11.6 保留 `index.ts` 现有 suffix-strip 与 `--thinking` 透传，UI 为权威过滤层。
- **测试要求**：§11 明确以真实行为测试为准（逐档 × 三态、复位、幂等、未知不写、缺失≠false），源码 grep 不作通过门。
- **与既有代码冲突**：`Override` schema 不变；`index.ts` spawn 链路不改；`setSubagentModelOverride`「跟随主 Agent 清空整条」语义保留，新增复位只在「显式 → 显式」且元数据已知分支；tag / 文案逐字一致；reload 归一化幂等追加，不改 reload 既有流程；无新资源文件，不改 `Package.swift`。
- **边界确认**：「跟随主 Agent」时 picker 禁用，不解析主模型能力，不耦合主会话状态；元数据未知走标准兜底，绝不锁死用户档位。
- **已知留白（非本轮范围）**：按 provider 通配能力、按 agent 类型记忆偏好档、把能力元数据暴露给 `index.ts` 做二次过滤——均列入 §4 非目标。

---

## 14. 默认决策一览（便于审阅）

1. 能力来源 = model-list 元数据（`reasoning` / `thinkingLevelMap`），经 `listModels()` / `get_available_models` 透出到 `ModelInfo`。**非** RPC、**非**本地策展 JSON。
2. 全部 8 档统一三态 Pi 规则：显式映射启用、显式 `null` 禁用、缺失键走 provider/Pi 默认。
3. 非推理模型（`reasoning == false`）仅显示「默认（由模型决定）」，控件替换为只读说明行。
4. `reasoning` 明确 false 与缺失 / 未知（nil）必须区分；未知走标准兜底且**绝不破坏性复位**。
5. 复位触发点 = `setSubagentModelOverride`「显式 → 显式」分支 + `reload()` 幂等归一化；`model` 保留、follow-main 不误删、未知元数据不写入。
6. 派出端 `index.ts` **不动**，UI 为唯一过滤权威，spawn 端保留现有 clamp 防御。
7. 文案与 tag 字面不变；`Override` schema 不变；资源打包流程不变（无新资源）。
8. 验收以真实行为测试为准（逐档 × 三态、复位、幂等、未知不写、缺失≠false），源码 grep 不作通过门。
