# @pipiui/qoder-extension

Qoder / Qoder CN 提供方扩展：OAuth + PAT 登录，agent 半 vendor `pi-provider-qoder@0.3.0`，并保留 PipiUI 的 context-window 兼容层（按 API `is_default` 档位，通常 200K，而不是最大 1M 档）。

凭证优先走 Pi `auth.json` 与环境变量 `QODER_PERSONAL_ACCESS_TOKEN` / `QODERCN_PERSONAL_ACCESS_TOKEN`；`ext.qoder.pat` / `ext.qoder.cnPat` 作设置兜底。agent 同时注册 `qoder` 与 `qoder-cn`。

## 布局

```
pipiui-extension.json
package.json
agent/tsconfig.json          → tsc 写出 agent/dist/
agent/index.ts               → 首次注册 provider + context-window 兼容
agent/provider.ts            → createAuthProvider（宿主 auth 运行时）
agent/vendor/                → pi-provider-qoder@0.3.0 源码（models.ts 含补丁）
```

## 构建

```sh
npm run build -w @pipiui/qoder-extension --maxsockets 3
# tsc -p agent/tsconfig.json
# postbuild: scripts/sync-bundled-extension.mjs qoder-extension
```

不要安装到全局 `~/.pi`。扫描顺序：builtin → app → project。
