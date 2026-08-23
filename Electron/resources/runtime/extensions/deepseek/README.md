# @pipiui/deepseek-extension

DeepSeek Responses 提供方扩展：API Key 登录、`deepseek-v4-flash-vision-exp`（多模态，1M ctx / 384K max output）与 `deepseek-v4-flash` 文本模型，以及 hosted `web_search`。

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
