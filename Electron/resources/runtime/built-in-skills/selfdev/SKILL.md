---
name: selfdev
description: 用自然语言修改、调整或给已安装的 PipiUI 扩展加功能，并热重载立即生效（/selfdev 入口，也支持语义触发）。当用户要改某个扩展的行为/参数/界面、给已有扩展加能力（如“把 firecrawl 的搜索功能加进我的扩展”“把某扩展的 X 改成 Y”）、或撤销这类修改时使用。覆盖定位→投影→修改→热重载→回执与一键还原的完整流程和护栏。创建全新扩展走 create-pipiui-extension，不是本 skill。
---

# Selfdev：改扩展，马上看到效果

用户没有 PipiUI 源码。他们能动的扩展只有两类可写位置；bundled 和 store 一律只读。

## 扩展位置与优先级（先搞清目标在哪）

| 来源 | 位置 | 可写？ |
|---|---|---|
| project | `{projectRoot}/.pi/agent/extensions/<id>` | ✅ 可写，优先级最高 |
| app | App profile `pi-agent/extensions/<id>` | ⚠️ 可写但跨项目共享，谨慎 |
| shared store | App profile `pi-agent/extension-store/objects/<sha256>/` | ❌ 内容寻址，不可变 |
| bundled | App 包内 `pipiui-runtime/extensions/<id>` | ❌ 只读 |

加载优先级：**project > app > bundled**（store 经 active 槽位）。改非 project 来源的扩展 = 先把整包**拷贝投影**到 project 目录形成影子，改影子；删影子即回落原版。

## 流程

1. **定位**：先列 `{projectRoot}/.pi/agent/extensions/`；没有再看 app 家；store/bundled 只读拷贝源。按 `pipiui-extension.json` 的 name/描述/能力匹配用户说的名字；匹配不到就问一句，别猜。
   - **语义触发**：用户未必说“/selfdev”。“帮我把 X 能力加到我的扩展”“把某扩展的 Y 改成 Z”“撤销上次对某扩展的改动”都算本流程，直接按此 skill 执行，不要反问用户是否要走 selfdev。
2. **判断改哪层**：需求若是"模型上下文窗口/思考级别/供应商参数"这类，目标多半是**模型元数据**（models.json / provider 注册），不是扩展代码——先确认层再动手。
3. **投影**（仅当目标不在 project 目录）：整包拷到 `{projectRoot}/.pi/agent/extensions/<id>`。绝不在 store/bundled 原地把改。
4. **修改**：最小 diff。给已有扩展加能力（如新工具/新命令）时，照该扩展既有 `agent/` 或 `app/` 的写法加一个最小实现，不引入新依赖除非必要。agent 半（`agent/`）若清单入口指向 `agent/dist/index.js`，改完 `.ts` 必须跑该包自己的构建产出 dist，否则加载进 `error`。改完 JSON.parse 验证 `pipiui-extension.json` 仍合法。
5. **热重载**：不用你触发——宿主 watcher 已监听全部扩展根，文件变更防抖后，会话空闲时自动重启 pi 子进程（流式输出中等本轮结束），**下一条消息即新代码**，会话历史不丢；app/ 半 UI 贡献经 contribution 通道热刷新。告诉用户"再发一条消息就能看到效果"。
   - 例外：全新扩展的**首次挂载**发生在新会话（纯新目录落盘不会重启存活会话）；zip 安装、启用/禁用开关会立即触发空闲重启。
6. **回执**：报告改了哪个扩展、哪个文件、什么行为变化、如何验证、如何还原。

## 护栏（不可违反）

- 禁止原地修改 store（`extension-store/objects/`）与 bundled（App 包内）扩展。
- 禁止写全局 `~/.pi`；`PI_CODING_AGENT_DIR` 是当前项目 agent 家。
- 一次只改用户点名的那一个扩展；不顺带"改进"别的。
- 投影目录名必须与 manifest `id` 一致，否则优先级覆盖不生效。
- 改崩了（扩展进 `error` 态）：直接告诉用户，并给出还原路径——删除影子目录 `{projectRoot}/.pi/agent/extensions/<id>`，下条消息即回落原版。

## 还原

用户说"还原/撤销"：删除 project 目录下对应的影子扩展目录即可；若改的本来就是 project 来源扩展，用 git 或对话里记录的原内容回滚，并说明热重载会自动跟上。
