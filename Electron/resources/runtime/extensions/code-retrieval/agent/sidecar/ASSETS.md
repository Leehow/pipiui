# code-retrieval sidecar assets (tree-sitter WASM)

规范 D6 / D7：符号层用 web-tree-sitter（纯 WASM），grammars 随包分发。
本目录只放运行时资产；符号提取逻辑在 `../symbol/`。

## 已内置（本提交已解包进仓）

| 文件 | 来源 npm | 版本 | sha256 |
|---|---|---|---|
| `vendor/web-tree-sitter/tree-sitter.js` | `web-tree-sitter` | 0.25.10 | `d4fc466df6358055253bc4cdaab23cdf84fe00741fa5a4ff56506c06c533da42` |
| `vendor/web-tree-sitter/tree-sitter.wasm` | `web-tree-sitter` | 0.25.10 | `f38dcc4b43b818f9a0785bc1c6d5611a75ac4cdd428ff3f02757c34ca4e46d7f` |
| `wasm/tree-sitter-python.wasm` | `tree-sitter-python` | 0.25.0 | `16108b50df4ee9a30168794252ab55e7c93bfc5765d7fa0aa3e335752c515f47` |
| `wasm/tree-sitter-javascript.wasm` | `tree-sitter-javascript` | 0.25.0 | `5fb488d0cabb4775a594bab85682de5ad6ce83c0d6ac997a9f82dd084d571240` |
| `wasm/tree-sitter-typescript.wasm` | `tree-sitter-typescript` | 0.23.2 | `778025db5a8be0e70f8ccc3671e486dfeddd048c25d9e8a70c26de2e1bf6f97d` |
| `wasm/tree-sitter-tsx.wasm` | `tree-sitter-typescript` | 0.23.2 | `79e5da75ea62855a0cd67177685f0164eac87d5f630b3cbe1e0a099751ad30f8` |
| `wasm/tree-sitter-rust.wasm` | `tree-sitter-rust` | 0.24.0 | `f65f354215611fd94ad34134b3427eb3d58cbb745df7b6509ba722184db73d57` |

配套类型 / 许可证（不参与运行时加载）：

- `vendor/web-tree-sitter/web-tree-sitter.d.ts`
- `vendor/web-tree-sitter/LICENSE`
- `vendor/web-tree-sitter/package.json`
- `vendor/web-tree-sitter/tree-sitter.js.map`

参考 query（官方 `queries/tags.scm`，运行时使用 `../symbol/queries.ts` 的精简版）：

- `queries/python-tags.scm` ← tree-sitter-python@0.25.0
- `queries/javascript-tags.scm` ← tree-sitter-javascript@0.25.0
- `queries/typescript-tags.scm` ← tree-sitter-typescript@0.23.2
- `queries/rust-tags.scm` ← tree-sitter-rust@0.24.0

## 获取命令（复现 / 补齐）

本机 npm 必须带 `--maxsockets 3`，禁止裸 `npm install`（代理死锁）。

```bash
mkdir -p /tmp/pipiui-ts-assets && cd /tmp/pipiui-ts-assets
npm pack web-tree-sitter@0.25.10 --maxsockets 3
npm pack tree-sitter-python@0.25.0 --maxsockets 3
npm pack tree-sitter-javascript@0.25.0 --maxsockets 3
npm pack tree-sitter-typescript@0.23.2 --maxsockets 3
npm pack tree-sitter-rust@0.24.0 --maxsockets 3
```

解包后只拷贝上表文件到本目录对应位置。选 `web-tree-sitter@0.25.10` 是为了和 0.23–0.25 的 grammar ABI 对齐；不要换成 0.26 除非重新验证 `Language.load`。

## 放置步骤（网络受限时）

1. 在可上网的机器按上一节 `npm pack` 四个 grammar + `web-tree-sitter@0.25.10`。
2. 将 `.wasm` / `tree-sitter.js` 拷到本目录，路径必须与上表一致。
3. `shasum -a 256` 对照上表；不一致则拒绝加载（`treesitter.ts` 会在缺文件时返回未就绪，不假装已内置）。
4. 不要提交 `tree-sitter-wasms@0.1.13`（tree-sitter 0.20 ABI，与 0.25 runtime 不兼容）。

## 体积

五份 grammar wasm + runtime ≈ 5.0MB，远低于单 arch App ~610MB 预算（D7）。
