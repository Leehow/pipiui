# Office 行为与格式基线（office-extension-refactor-v1 · T1 冻结）

状态：**冻结基线**（2026-08-25，T1 交付）。本文件与 `docs/office/format-matrix.json` 共同构成 T4/T6
重构的兼容性判据：重构后的 Office 扩展必须逐条保持本文列出的可观察行为，除非计划任务显式修改承诺。
本文只描述现状并冻结承诺，**未改动任何 production 代码**。

## 一、三层格式承诺

| 层级 | 扩展名 | 预览承诺 | 编辑承诺 | 宏策略 |
|---|---|---|---|---|
| Tier 1 保证 | `.docx` `.xlsx` `.pptx` | 内置 office viewer 原生预览（viewer 失败时 anydoc 回退） | OfficeCLI 保证读写（经 MCP `mcp_officecli_officecli` + 截图闸门） | 永不执行 VBA |
| 宏容器 | `.docm` `.xlsm` `.pptm` | 原生预览尽力渲染 | 仅「预览/保留」：不承诺编辑与版式忠实，宏内容只保留不执行 | 永不执行 VBA |
| Tier 2 尽力 | `.doc` `.xls` `.ppt` `.rtf` `.odt` `.epub` `.xlsb` `.ods` `.pps` `.ppsx` `.ppsm` `.pot` `.odp` | best-effort：office viewer 尝试 → 失败即 anydoc 转 Markdown → 仍可外部打开 | 不承诺编辑、不承诺版式忠实 | 永不执行 VBA |
| 仅闸门模板 | `.dot` `.dotx` `.xlt` `.xltx` `.potx` | 面板不支持（确定性 `document_unsupported_type` 错误），OfficeCLI 写入仍受截图闸门约束 | 不承诺 | 永不执行 VBA |

补充（非 Office，但同走 Document 面板，随本基线一并冻结）：

- `.md`/`.markdown` → Markdown 渲染；`.txt`/`.csv` → 纯文本；文本上限 2MB。
- `.pdf` → office viewer 预览，**但 viewer 失败不走 anydoc 回退**（`isOfficeKind` 不含 pdf），只显示可关闭错误。
- 二进制上限 50MB；路径必须绝对、扩展名在允许表内、必须是常规文件；外部打开复用同一分类校验。

## 二、机器可读格式矩阵

`docs/office/format-matrix.json`（version 1）。每行字段：`extension`、`tier`、`documentKind`、
`previewContract`、`editContract`、`fallbackContract`、`macroExecutionPolicy`、`macroContainer`、
`externalOpen`、`shotGateCovered`。矩阵与两处真实代码双向钉死（见测试映射 G-8）：分类表
`Electron/packages/host-api/src/index.ts` `DOCUMENT_KIND_BY_EXTENSION` 与闸门扩展名表
`Electron/resources/runtime/extensions/office-doc-shot-gate.ts` `OFFICE_DOCUMENT_EXTENSIONS`。
任何一侧漂移，`office-format-baseline.test.ts` 立即失败。T4/T6 以此矩阵作为兼容 corpus 输入。

已知钉死的边界事实（重构时不得静默改变）：

- 闸门表含 5 个模板扩展（`.dot/.dotx/.xlt/.xltx/.potx`），面板分类表不含（打开即确定性报错）。
- 闸门表**不含** `.ppsm`（面板可预览、anydoc 可转，但 OfficeCLI 写入不经闸门）——遗留边界，T6 决定收敛或保留。
- 分类表含 `.rtf/.odt/.epub/.ods/.odp/.ppsm`，闸门表不含。
- anydoc 把 `.xls/.xlsb/.xlsm` 一律按 `xlsx` 解析（`anydoc-convert.ts` `formatFromPath`）——旧 `.xls` 的 OLE 二进制能否被正确转换未经验证，见风险清单。

## 三、Document 面板行为基线（renderer 可观察）

每条承诺对应一个冻结测试（测试名见映射表）。

| # | 行为承诺 | 冻结位置 |
|---|---|---|
| P-1 | viewer 成功：word/spreadsheet/presentation 三类二进制全部进入 office viewer，文件名/扩展名/字节数原样传递 | `DocumentPanel.test.tsx` 既有 docx/pdf 用例 + 基线块 `routes spreadsheet and legacy presentation binaries` |
| P-2 | viewer 失败 → generic fallback：三类 office kind 的 viewer 错误都触发 `convertDocumentToMarkdown`，成功后显示 `document-fallback`（含说明条 + 重试 + ×） | 既有 word 用例 + 基线块 `falls back … spreadsheet / presentation viewer fails` |
| P-3 | fallback 失败确定化：转换抛错或返回空串 → 保留**可关闭**的原 viewer 错误，无死循环重试（每次 viewer 生命周期只尝试一次转换） | 基线块 `keeps a closable error when the anydoc conversion itself fails / yields empty markdown` |
| P-4 | 损坏/不支持输入确定错误：宿主返回无效内容 → `宿主返回了无效的文档内容`；`document_unsupported_type` → 显示原始错误信息；无 viewer、无回退 | 基线块 `shows a deterministic error when the host returns invalid office content / for unsupported document types` |
| P-5 | 中文/空格文件名：名称、路径、viewer `type` 与回退调用全部原样保留（含带空格绝对路径） | 既有中文 docx 用例 + 基线块 `preserves Chinese and space-containing names through viewer and fallback` |
| P-6 | `documentChanged` reload：仅匹配当前路径的事件触发重读；Office bytes 重读后按 `updatedAt/size` key 强制 viewer 重建；他路径事件不重读 | 既有 markdown reload 用例 + 基线块 `reloads office bytes only for a matching documentChanged event`；`session-scope.test.tsx` `ignores documentChanged events addressed to a different path` |
| P-7 | watch 生命周期：仅监听当前打开路径；路径切换先 unwatch 旧路径再 watch 新路径 | `session-scope.test.tsx` `watches only the opened document and rewatches when the path changes` |
| P-8 | session 隔离与父组件重渲染稳定：仅读显式打开路径、同文档父级重渲染不重建 viewer | 既有 `reads only the explicitly opened document path…`、`does not reload an Office preview when the parent re-renders…` |

## 四、截图闸门基线（agent 可观察）

| # | 行为承诺 | 冻结位置 |
|---|---|---|
| G-1 | MCP 工具名绑定：`OFFICECLI_MCP_TOOL === "mcp_officecli_officecli"`；`officecli`、`*_officecli` 别名同样受闸门；其他工具名完全不受影响 | 基线块 `binds the gate to the officecli MCP tool name family…` |
| G-2 | baseline 先于写：已存在文档的首次写必须先有成功的 whole-document baseline screenshot（`view … screenshot --grid auto`，无 `--page`/`--range`）；失败截图不计入 | 既有 `blocks a write … before a successful baseline`、`does not count a failed baseline screenshot` |
| G-3 | 写期间禁止截图、截图期间禁止写（同文档双向阻断，跨文档互不影响） | 既有 `blocks mixed inflight screenshot/write in both directions`、`keeps documents isolated…` |
| G-4 | final 后于写：成功写之后必须有晚于它的 qualifying final screenshot，否则 `agent_end` 触发 follow-up（≤3 次）→ 可见失败公告；**写失败不产生 final 义务、截图失败不清除义务** | 既有 `invalidates a final screenshot…`、`announces a visible gate failure…` + 基线块 `adds no final obligation for a failed write…` |
| G-5 | bash 绕过阻断：任何形式的 shell 直调 officecli 被拒绝并指回 MCP 工具名 | 既有 `blocks bash officecli bypasses` |
| G-6 | 覆盖范围：闸门扩展名表（含宏容器、旧格式、模板）逐项生效；宏文档与普通文档同一规则，无执行语义 | 基线块 `gates every shipped office extension…` |
| G-7 | 中文/空格路径：命令引号化与路径归一化（`@` 前缀、相对→绝对）对含空格中文名成立，闸门按归一化路径记账 | 基线块 `quotes and normalizes Chinese and space-containing document paths` |
| G-8 | 格式矩阵 ↔ 分类表/闸门表双向一致；Tier 集合恰好为承诺值；`never-execute` 全表统一 | `office-format-baseline.test.ts`（9 用例） |

既有继承（不在本次新增，随基线一并视为冻结）：闸门扩展挂载（`worker -e`，computer worker 除外）、
每个 human task 重置账本、extension follow-up 消息不计入新 human task —— 见 `office-doc-shot-gate.test.ts` 既有用例。

## 五、验证命令

```bash
cd Electron && npx vitest run --exclude '**/dist/**' --exclude 'resources/runtime/**' \
  packages/ui/src/DocumentPanel.test.tsx \
  packages/ui/src/session-scope.test.tsx \
  packages/pi-backend/test/office-doc-shot-gate.test.ts \
  packages/pi-backend/test/office-format-baseline.test.ts
```

（T1 实测：4 files / 59 tests 全部通过。）

## 六、基线未覆盖的真实文件风险（如实清单）

以下风险是本基线**没有**用真实文件验证的空白，T4/T6 的真实 corpus 验收必须补上：

1. **旧格式真实渲染**：`@file-viewer/preset-office@2.2.8` 对 `.doc/.xls/.ppt/.xlsb/.pps/.pot` 的逐格式支持
   从未用真实文件验证；分类表接受 ≠ viewer 能渲染（这正是 Tier 2 只承诺 best-effort 的原因）。
2. **anydoc 对旧 `.xls` 的解析**：`formatFromPath` 把 `.xls` 按 `xlsx` 处理，OLE 二进制是否被正确转换未知。
3. **宏容器**：`.docm/.xlsm/.pptm` 中 VBA 部分经 anydoc 转换后的保留行为未验证；viewer 是否意外触发宏未测
   （Electron 无 VBA 运行时，风险低但未证明）。
4. **CJK 字体与版式**：截图闸门产物与 viewer 渲染对中文字体回退的表现未在本基线验证（OfficeCLI 字体依赖见上游调研 findings）。
5. **大文件边界**：2MB/50MB 上限已由后端测试钉死，但「接近上限的 Office 文件在 viewer/anydoc 的表现」未测。
6. **并发写**：闸门只保证同文档串行；两个 session 同时写同一文件的行为未在 UI 层冻结。

## 七、T4/T6 使用方式

- T4（renderer contract）与 T6（agent half）验收时：以 `format-matrix.json` 为 corpus 输入，逐行验证
  preview/edit/fallback/macro 四项承诺在重构后仍成立；矩阵字段即验收维度。
- 允许的偏离必须先改矩阵版本（version 2）并同步本文承诺表，再动代码——`office-format-baseline.test.ts`
  会强制两侧一致。
