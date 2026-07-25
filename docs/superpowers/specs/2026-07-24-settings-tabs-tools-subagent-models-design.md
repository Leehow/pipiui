# 设置多 Tab：模型 / 工具与 Skills / Subagent 模型

日期：2026-07-24

## 问题

设置里目前只有「模型设置」（可见性 / 添加 / 删除凭据）。用户还需要：

1. 设置分多个 tab
2. 查看当前有哪些工具与 skills
3. 为不同类型 subagent 单独指定模型；默认跟随主 agent（会话底栏当前模型）

## 调研摘要

- UI：`SettingsSheet` 单页 ScrollView；入口在侧栏齿轮。
- 模型可见性：`ModelVisibility` → UserDefaults `pipiui.hiddenModelIds`。
- Subagent 类型：App 自有 `PiExt/agents/*.md`（lead / explore / plan / general-purpose / reviewer），经 `PIPIUI_AGENTS_DIR` 加载；frontmatter 含 `tools` 与硬编码 `model`。
- 派出时：`PiExt/subagent/index.ts` 用 `agent.model` 传 `--model`。
- Skills：会话 RPC `get_commands` → `SlashCommand`（`source == .skill`）。
- 工具：无统一 RPC；来自 pi 内置 + PipiUI 扩展（media / webview / git / subagent）。
- `ctx.model` 在工具执行时可取当前进程模型（见 `MediaExtension`）。

## 方案对比

| 方案 | 做法 | 利 | 弊 |
|------|------|----|----|
| A. 只改 agent.md | 手写各类型 model | 无 Swift 设置 | 不能跟随主模型、难切 |
| B. 改 md + 重启会话读 env | 设置写 env，重启 pi | 简单 | 改设置要重启才生效 |
| **C. 推荐：UserDefaults + JSON 热读** | 设置持久化；扩展每次 spawn 读 JSON；默认跟随 `ctx.model` / `PIPIUI_MAIN_MODEL` | 即时生效、对齐现有偏好存储 | 多一个小文件 |

## 设计（采用 C）

### Tab 结构

设置 sheet 顶部 `Picker`（segmented）三 tab：

1. **模型** — 现有模型设置原样迁入
2. **工具与 Skills** — 只读清单
3. **Subagent 模型** — 按 agent 类型选模型

### 工具与 Skills（可开关）

- **内置工具**：固定列表（read / bash / edit / write / grep / find / ls / subagent / subagent_status）
- **扩展工具**：PipiUI 注入（generate_image、browser_*、git_status / git_diff 等）
- **Skills**：当前会话 `availableCommands` 中 `source == .skill`；无会话时提示「打开会话后可刷新」
- **按 Agent 工具集**：解析 `agents/*.md` frontmatter 的 `tools`，展示各类型允许的工具
- **开关**：UserDefaults `pipiui.disabledTools` / `pipiui.disabledSkills` + `tool-skill-settings.json`
  - 工具：会话 spawn 传 `--exclude-tools`（改开关会重启会话）；subagent 派出时过滤 allowlist
  - Skills：立即从斜杠菜单隐藏；不从 pi 全局发现层卸载 skill 正文（边界）

### Subagent 模型

- 行：每个 PipiUI agent（explore / plan / general-purpose / reviewer / lead）
- 选择：`跟随主 Agent`（默认）或具体 `provider/modelId`（与底栏候选一致，受可见性过滤）
- 持久化：UserDefaults `pipiui.subagentModels: [String: String]`  
  - 缺省或空字符串 = 跟随主 Agent  
  - 非空 = 显式模型 id
- 热读文件：`Application Support/PipiUI/subagent-models.json`（与 UserDefaults 同步写入），供 Node 扩展在 spawn 时读取，无需重启会话

### 运行时解析顺序（index.ts）

对每个要派出的 agent：

1. JSON / 覆盖表中该 `name` 有非空值 → 用该模型
2. 否则「跟随主 Agent」：  
   - depth 0：`ctx.model` → `provider/id`  
   - depth > 0：子进程 env `PIPIUI_MAIN_MODEL`（由 depth 0 spawn 时写入并向下传递）
3. 再否则回退 `agent.md` frontmatter `model`（兼容无 ctx 的边缘情况）
4. 再否则不传 `--model`（交给 pi 默认）

主会话 spawn 时可选写入初始 `PIPIUI_MAIN_MODEL`（Swift 侧当前 `session.model`），与 depth 0 的 `ctx.model` 双保险。

### UI / 持久化细节

- Sheet 略加宽加高以容纳 tab 与列表
- 改 Subagent 模型立即写 UserDefaults + JSON；下次派出即生效
- agent.md 内硬编码 model 保留作回退，设置默认「跟随」会覆盖其作为首选行为

### 测试

- `SubagentModelSettings`：跟随 / 显式覆盖读写、JSON 编码
- Agent frontmatter 解析（tools / name）
- 不测真实 subagent 网络派出

### 非目标

- 在设置里开关单个 tool/skill
- 编辑 agent 系统提示词
- 同步修改用户 `~/.pi/agent/agents`
- git commit（本轮）

## 默认决策

1. 「主 Agent」= 当前聊天会话选中模型（底栏），不是 lead 父进程模型。
2. 工具/Skills tab 只读展示。
3. 显式模型用与底栏相同的 `provider/modelId` 字符串。
