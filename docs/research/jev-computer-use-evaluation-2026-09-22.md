# Jev AX 桌面循环：实现与验证记录

日期：2026-09-22。对应[规格](../jev-computer-use-v1.md)与实施计划 `jev-computer-use-v1`。

## 结论

- 源码已实现：主会话 `computer(action=goal)`、AX 局部索引与主动发现、具名输入本地绑定、既有 Cua 执行器、独立桌面云授权及有界停止。
- 功能范围验证通过，完整源码审查发现的问题已修复并复核关闭。**这不是全仓测试全绿，也不是已安装 App 的实机验收。**
- **未证明真实 Jev 净提速。** 本轮没有运行真实 A/C 主模型、TypeSafe 或 OS 对照；没有开启桌面外发、购买额度、打包或重启 PipiUI。

## 实现边界

需要同时具备：已挂载桌面工具、有效桌面 grant、`computerUseEnabled` 总开关、已挂载且有凭据的 Jev、项目级 `ext.jev-optimizer.computerEnabled` 外发许可，以及通过 `open_application` 绑定的目标。

普通单动作/批处理仍直接执行，不自动调用 Jev。goal 不可放入 `actions[]`。缺条件时明确交接，不偷偷改用另一个模型自动操作。Jev 只选择有限操作；输入原值保留在本地，不生成任意参数、坐标、脚本或文字。

AX 分组使用实际提供的 region/group/parent 信息，缺失时走扁平分页。搜索在原来前 48 个展示元素之外也能进行；每轮候选有界，超出采集范围保留不完整标记。滚动必须有真实可绑定的 AX 容器，不提供无快照约束的窗口级滚动。没有足够 AX 信息时回到普通工具。

输入采用宿主受控子序列：定位字段、选择原内容、输入给定文字或清空。每一步核对最新焦点、角色、名称、区域与唯一性，再绑定当前 token；不能只凭旧索引继续输入。可读取字段值时核对实际值，不符或不可核对就交接。整体 `DONE` 始终是 `needs_verification`、`verified:false`。

原字段值和具名输入值在一次 goal 内有界累计脱敏，不因换快照遗忘；超过预算停止。桌面云授权、桌面总开关、凭据/代际变化均能阻止后续动作，宿主在真正提交 driver mutation 前再次检查。取消中的未确认写操作保留 `outcome_unknown` / `doNotReplay`，不能凭零确认完成数自动重放。

## 已执行验证

| 验证 | 结果 |
| --- | --- |
| 8 个目标范围测试文件 | **210/210 通过** |
| Jev runtime 扩展已有回归 | **53/53 通过** |
| 三个新 Cua 模块独立 strict TypeScript 检查 | 通过 |
| pi-backend TypeScript `--noEmit` | 通过 |
| Jev 扩展构建 | 通过 |
| Electron workspace build 与 preload 校验 | 通过 |
| 实际注册工具→真实能力 broker→真实 CuaDriverHost→假 driver / 假 HTTP | 通过；不是只测试动作规划函数 |
| 四类固定场景的完整工具路径 | 通过；独立夹具谓词确认设置导航、菜单查找、已知输入搜索、滚动查找完成且无禁止动作 |

目标范围命令（工作目录 `Electron/`）：

```sh
npm test -- \
  packages/pi-backend/test/jev-computer-goal.test.ts \
  packages/pi-backend/test/jev-computer-discovery.test.ts \
  packages/pi-backend/test/jev-computer-provider.test.ts \
  packages/pi-backend/test/jev-runtime-state.test.ts \
  packages/pi-backend/test/cua-extension.test.ts \
  packages/pi-backend/test/host-capability-api.test.ts \
  apps/electron/src/main/cua-driver-host.test.ts \
  packages/pi-backend/test/jev-computer-baseline.test.ts

npm run build:jev-optimizer
node --test resources/runtime/extensions/jev-optimizer/agent/dist/*.test.js
npx tsc -p packages/pi-backend/tsconfig.json --noEmit
npm run build -w @pipiui/electron
```

三个独立 strict 检查模块为 Cua 扩展的 `computer-choice.ts`、`computer-goal.ts`、`computer-goal-candidates.ts`，使用 `--noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --types node`。

## A/B/C 数据与限制

可重跑的 13 个合成 AX 场景覆盖四类任务以及同名控件、分页、模态、过期、无进展、敏感控件、覆盖不足等边界。完整的 B 记录在 [JSON 数据](jev-computer-use-evaluation-2026-09-22.json)。

| 组 | 本轮状态 | 结果含义 |
| --- | --- | --- |
| A：原主模型逐步操作 | 未执行；CLI 返回 skipped、0 条记录 | 没有真实原路径耗时或成功率基线 |
| B：确定性合成回放 | 13 场景 × 3 次，共 39 次 | 36 次成功；不可达的覆盖不足场景 3 次均交接；零错误动作、零主模型调用、零真实 Jev 请求 |
| C：真实 Jev 桌面循环 | 未执行；CLI 返回 skipped、0 条记录 | 没有真实模型选择质量、费用或净提速证据 |

B 的 0ms 中位数、2ms P95 是**本地假驱动回放的时间**，不包含真实 OS、截图采集或云端延迟，绝不能当作桌面性能数据。B 的截图计数也是合成图片生成次数，不是实际屏幕抓取。usage 为 unavailable，账单为 unverified；估算与实际 usage 在记录中分栏。

另外，注册工具贯通测试使用真实产品控制器和 provider 合同，但 Jev 响应仍由可控假 HTTP 给出。四类任务的动作结果由夹具状态机独立检查，不能证明真实 Jev 会选择同样的操作。

```sh
node --experimental-strip-types scripts/jev-computer-evaluation.ts --group B --repeats 3
node --experimental-strip-types scripts/jev-computer-evaluation.ts --group A
node --experimental-strip-types scripts/jev-computer-evaluation.ts --group C
```

真实 A/C 需要后续在已获桌面外发许可、具备真实凭据和受控测试 App 的环境执行。本轮没有为了凑结果读取真实业务界面，也没有把模拟结果标作真实结果。

## 未通过的扩大检查

本轮曾执行 `npm test -- --maxWorkers 4`：**446 文件通过、9 文件失败；5226 测试通过、11 失败、2 跳过**。这次全仓尝试发生在最终三项边界修复之前；修复后已重新运行上列目标范围验证，没有再次宣称全仓全绿。

随后将失败的 9 个文件按 `--maxWorkers=1` 重跑：**3 文件通过、6 文件失败；307 测试通过、9 失败**。

- Grok 清单断言稳定失败：期望旧的静态模型列表，工作区已有动态 4.7 清单/空 manifest 列表；不在本次 AX 修改中。
- App 的 Browser 按钮和工具轨道布局断言稳定失败；串行时还出现 provider logo/composer 断言。不属于本次修改的 UI 文件，新增失败的稳定性未继续验证。
- `project-pi-isolation`、`runtime-refresh-spawn`、`PlanPanel.layout` 在串行重跑通过。
- compaction、queue、telemetry 的超时在重跑时落到不同用例；没有发现与本次 AX 改动的可见代码交点，但不能仅凭此证明所有超时根因。
- 全 App `tsc --noEmit` 也未通过，包含已有浏览器/测试类型、PNG 声明和宿主旧区段诊断。目标新模块及 backend 的检查通过不能替代这一失败记录。

没有为本目标修改这些范围外断言或源文件。原始本机日志为 `/tmp/pipiui-jev-ax-full-test.log`、`/tmp/pipiui-jev-ax-rerun-9.log`；日志是临时诊断材料，以上计数与分类保留在本记录中。

## 调用方式

以下只是接口示例，不是实机通过证明。先由用户配置现有桌面总开关、Jev 凭据及独立桌面外发许可，再调用 `open_application` 绑定目标应用：

```json
{
  "action": "goal",
  "goal": "在搜索框输入给定搜索词并搜索",
  "inputs": [{ "id": "query", "label": "搜索词", "value": "release notes" }],
  "max_steps": 12,
  "timeoutSecs": 30
}
```

遇到 `handoff`、未知执行结果或 `needs_verification`，由主模型读取最终观察并决定后续步骤；不能把控制器结束或一次点击成功直接写成任务成功。当前运行中的 PipiUI 未因本次源码修改而自动更新。
