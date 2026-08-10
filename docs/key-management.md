# API key 统一管理（`~/.pi/agent/.env`）

Pipi UI 把模型 provider 的 API key 集中存放在 `~/.pi/agent/.env` 一个文件里，由
`EnvFileStore`（`Sources/PipiUI/EnvFileStore.swift`）统一读写。添加模型、设置页与
启动迁移都走这一个文件。

## 位置与权限模型

- 路径：`~/.pi/agent/.env`
- 权限：**0600**（仅本人可读写）。新建文件直接以 0600 创建；已有文件每次
  写入后强制校正回 0600。写入是原子的（临时文件 + rename），写坏半截
  文件的情况不存在。
- 解析格式：标准 dotenv 子集 —— `KEY=VALUE` 行、`#` 注释行、空行、值
  可用单/双引号包裹、重复键后者生效。回写保留注释、空行和原有顺序，
  只改被修改的那一行。

**为什么不做项目级 `.env`？** 项目目录下的 `.env` 会被 pi 及 agent 的
文件工具（read/grep 等）直接读到，等于把密钥喂给模型和任何能跑工具的
子 agent。集中在 `~/.pi/agent/.env` 后，密钥不进项目树、不进 prompt、
不进工具输出，且多个项目共享同一份凭据。

## 键名表（provider → 环境变量）

映射维护在 `ProviderEnvMap.swift`（与 pi 官方 docs/providers.md 的
"API Keys" 表保持同步）。常用项：

| Provider | 环境变量 |
|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` |
| `openai` / `openai-codex` | `OPENAI_API_KEY` |
| `google` | `GEMINI_API_KEY` |
| `xai` | `XAI_API_KEY` |
| `deepseek` | `DEEPSEEK_API_KEY` |
| `zai`（`zhipu` 别名同键） | `ZAI_API_KEY` |
| `zai-coding-cn` | `ZAI_CODING_CN_API_KEY` |
| `kimi-coding` | `KIMI_API_KEY` |
| `moonshot` | `MOONSHOT_API_KEY`（也接受 `KIMI_API_KEY`） |
| `openrouter` | `OPENROUTER_API_KEY` |
| `groq` | `GROQ_API_KEY` |
| `mistral` | `MISTRAL_API_KEY` |
| `minimax` / `minimax-cn` | `MINIMAX_API_KEY` / `MINIMAX_CN_API_KEY` |

完整表见 `ProviderEnvMap.envVarsByProvider`；未知 provider 不在表内，
其 key 不会被迁移/注入（迁移时保留在 auth.json 并记日志）。

## 各链路如何消费 .env

- **模型 key**：每次新建会话 spawn `pi` 子进程时，`ChatSession.mergedSpawnEnv`
  把 `.env` 全量键值注入子进程环境作为**底层**；`PIPIUI_*` 开头的内部键
  永远在顶层、不可被 `.env` 覆盖。因此**改模型 key 需要重启会话才生效**
  （环境变量只在 spawn 那一刻确定）。密钥键值不会进日志。
- **联网工具**：`pi-web-access` 提供 `web_search`、`fetch_content`、
  `get_search_content` 和 `source_check`；PipiUI 不再维护自定义联网扩展的
  配置文件或 key 镜像。默认联网能力无需 PipiUI 额外配置。
- **OAuth 凭据**：`type: "oauth"` 的条目**永远留在** `~/.pi/agent/auth.json`，
  迁移不碰、添加模型不碰、清理冲突也不碰——refresh token 会轮转，必须
  留在 pi 自己管理的 auth.json 里。`.env` 只装 `api_key` 类型的静态密钥。
- **quota 模块**：以 `EnvFileStore` 作为 fallback 查询「某 provider 是否
  已配置 key」，不直接读文件。

## 设置页交互约定

- key 输入框**永不回显**已存的 key；placeholder 显示「已配置，输入以
  替换」或「未配置」。
- 输入框**留空 = 不修改**，不会把空串写进 `.env`。
- 删除 key 用显式「**清除**」按钮（从 `.env` 移除该键）。
- 「添加模型」填 api_key 时：写入 `.env` 对应键，同时清掉 auth.json 中
  该 provider 的旧 `api_key` 条目（oauth 不动）。
- **冲突警告**：当同一 provider 的 key 同时存在于 `.env` 和
  auth.json（`api_key` 类型）时，pi 侧 auth.json 的旧 key 会覆盖 `.env`
  的新值，设置页显示橙色警告并提供「清理」按钮一键删除 auth.json 残留
  （清理后会重启所有打开的会话使 `.env` 生效）。

## 启动迁移与回滚

首次启动（或升级后首次启动）`AuthMigration` 在后台队列执行一次性迁移：

1. 备份 `~/.pi/agent/auth.json` → `auth.json.pipiui-bak`（已存在则不覆盖，
   权限 0600）；
2. 把 auth.json 里所有 `type: "api_key"` 的条目按映射表写入 `.env`
   （**`.env` 已有非空值时保留用户手改，绝不覆盖**）；
3. 从 auth.json 删除已迁移的 `api_key` 条目（oauth 永不动）；
4. 写 UserDefaults 标记 `pipiui.authMigration.v1.done`（幂等，之后启动
   直接跳过），并留一次性提示 `pipiui.authMigration.v1.notice` 给 UI
   显示后清除。

**回滚**（把 key 放回 auth.json 并允许重跑迁移）：

```bash
# 1. 恢复迁移前的 auth.json（备份不会被覆盖，是最初的完整版）
cp ~/.pi/agent/auth.json.pipiui-bak ~/.pi/agent/auth.json

# 2. 删除迁移完成标记，下次启动会重新迁移（幂等）
defaults delete com.pipiui.PipiUI pipiui.authMigration.v1.done 2>/dev/null || true
```

注意：回滚后 `.env` 里的同名键仍然优先（迁移规则是「.env 已有值赢」），
若想完全回到迁移前状态，需先删掉 `.env` 中对应键或整个文件。

## 终端里直接用 pi TUI

迁移后 auth.json 里不再有 api_key，终端里裸跑 `pi` 需要 shell 自己加载
`.env`。把下面一行放进 `~/.zshrc`（或对应 shell 的 rc）：

```bash
set -a; . ~/.pi/agent/.env; set +a
```

`set -a` 让 source 进来的变量自动 export，pi TUI 与 Pipi UI 从此共享同
一份凭据。

## 常见问题

**Q：在设置页改了模型 key，为什么没生效？**
模型 key 只在 spawn `pi` 子进程时注入环境。改完后需要**重启会话**（关闭
再新建/重开），旧会话仍用旧 key。

**Q：设置页里的橙色「冲突」警告是什么意思？**
同一个 provider 的 key 同时存在于 `.env` 和 auth.json。pi 运行时
auth.json 的 `api_key` 优先级高于环境变量，你写进 `.env` 的新 key 会被
旧值盖掉。点旁边的「**清理**」删除 auth.json 残留即可（oauth 条目不受
影响），清理后所有打开的会话会重启以让 `.env` 生效。

**Q：`.env` 里能写 `PIPIUI_*` 键吗？**
写了也没用。`PIPIUI_*` 是 App 内部注入键（桥接端口、会话路由、扩展路径
等），合并环境时内部键永远在顶层，`.env` 无法覆盖。

**Q：迁移会不会覆盖我手动编辑的 `.env`？**
不会。迁移合并时 `.env` 已有的非空值永远赢，只写缺失的键；重复执行也
是 no-op（源已清空 + done 标记）。
