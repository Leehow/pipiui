# @pipiui/deepseek-extension

DeepSeek Responses 独立提供方扩展（`deepseek-extended` / DeepSeek Extended）：API Key 登录、hosted `web_search`，以及**运行时发现的模型目录**。不合并、不替换内置 reserved provider `deepseek`（Flash + Pro）。

模型列表不再写死。启动时后台调用 DeepSeek 自己的 `GET /models` 拿到该账号当前可用的 id，元数据按三级取用：

1. `agent/models.ts` 的核定表（对照 DeepSeek 官方 Models & Pricing 页核过），覆盖到的 id 以它为准；
2. models.dev，只用于核定表没有的新 id（它落后于 DeepSeek 发布，且公布过与官方峰/离峰两档都对不上的价格，因此不允许覆盖第 1 级）；
3. 同族默认值——全新 id 依然可用，按同族费率计价并标记 `metadataSource: "family-default"`，让这个估算保持可见。

`api` / `compat` 等传输字段永远来自本地常量，不接受网络输入。目录缓存在 `~/.pipiui-electron/ext-cache/`：注册路径是同步的（宿主不 await `createAuthProvider`），所以刷新结果在下次启动生效；拉取失败只会让目录变旧，不会清空。随版本发布的离峰价目为 `deepseek-flash` $0.15/$0.6（cache $0.003）、`deepseek-v4-pro` $0.66/$1.98（cache $0.022），高峰档翻倍。

一期只有 agent 半边（`agent/dist/index.js`）；`app/` UI、Files API、strict tool calls 属二期。凭证优先走 Pi `auth.json`，`ext.deepseek.apiKey` / `ext.deepseek.baseUrl`（默认 `https://api.deepseek.com`）作兜底。会话传输是 `openai-responses`（`POST /responses`）；`pipiui-deepseek-server-tools.ts` 负责 hosted search 注入、URL 重写和 citation 回映射。

## 布局

```
pipiui-extension.json
package.json
tsconfig.json
agent/tsconfig.json          → tsc 写出 agent/dist/
agent/index.ts               → agent/dist/index.js（provider 工人）
scripts/postbuild.mjs        → 同步进 bundled runtime（packaging 工人）
```

## 构建

```sh
npm run build -w @pipiui/deepseek-extension --maxsockets 3
# tsc -p agent/tsconfig.json
# postbuild: scripts/postbuild.mjs
```

不要安装到全局 `~/.pi`。扫描顺序：builtin → app → project。
