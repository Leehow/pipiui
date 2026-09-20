# Retrieval evaluation (remediation wave)

Read-only evaluation surface for the code-retrieval extension. This directory is
the only place the evaluator lives; it is development tooling and is excluded
from production packaging concerns by construction (it never registers itself —
it *drives* the registered tools).

## What changed in the remediation wave

Reviewer findings (`retrieval-behavior`, `retrieval-review-safety`) mapped to fixes:

| Finding | Fix |
|---|---|
| Eval could SIGTERM a shared/pre-existing sidecar | `eval-lib/ownership.mjs`: detach-only cleanup. No `process.kill` anywhere; spawned sidecars idle-exit. Decision logic pinned by `eval-tests/ownership.test.mjs`. |
| Snapshot-diff deletion could remove other sessions' files | `eval-lib/result-files.mjs` `ResultFileTracker`: only exact `details.resultsPath` values returned to THIS run are deleted; pre-existing names are refused even if re-created mid-run. |
| JSON exported raw attribution call arrays | `eval-lib/trace-classify.mjs` + `sanitizeValue/toBoundedJson`: aggregates, redacted keys (`bearer/apiKey/authorization/token…`), string/array caps. No `calls[]` key exists at all. |
| Adjacency across globally interleaved runs | `eval-lib/adjacency.mjs`: pairs counted strictly within `(sessionId, runId)` episodes; the count of cross-episode pairs a global sort WOULD have added is reported for honest reconciliation. |
| Budget/stale-gold printed but not enforced | `eval-lib/gates.mjs`: stale anchors are excluded from all denominators AND fail the run; preview violations are enforced per rendered block (≤6 lines, ≤1000 tok/block) plus an INDEPENDENT fixed aggregate cap per result — the SUM of all block tokens must stay ≤1000 regardless of each block's size or any self-reported footer numerator/denominator (a missing, understated, or inflated "~1200/4000" footer cannot mask an over-budget result) — and fail the run. Exit code 1 on FAIL. |
| Self-referential optimization-file corpus | `retrieval-eval-cases.mjs`: 20 cases grounded in measured production task shapes (pdf-plugin-recon read×86, office gate, closeout/secretary, browser guard, UI busy cut-in, provider manifest truth, secret vault, npm proxy deadlock, packaging runtime-target, constitution slug rule, CJK recon layer, telemetry). Pinned by `eval-tests/cases.test.mjs`. |
| Evaluator faked its own repo_map renderer | The runner installs the real extension entry (`dist/index.js`) against a capturing ExtensionAPI and executes the REGISTERED handlers exactly as sessions do. `eval-tests/map-tool.test.mjs` additionally drives the compiled `executeRepoMap` shared implementation, asserting inline previews, ≤6-line blocks, stable R# continuation and ledger marking of the shown window. |
| Live reduction claims | Report still states verbatim: live ≥30% grep+read and ≥20% descriptive call-reduction targets remain **unproven** until matched live traffic replays them. |

## Run

```bash
cd Electron/
npm run build:code-retrieval        # required first; eval fails loudly on stale dist
node resources/runtime/extensions/code-retrieval/agent/eval/run-retrieval-eval.mjs \
     [--json /tmp/report.json] [--attribution-since ISO] [--require-map-previews]
```

Deterministic unit coverage (no network, no sidecars, no symbol extraction):

```bash
node --test resources/runtime/extensions/code-retrieval/agent/eval/eval-tests/*.test.mjs
```

## Jev 对照入口

真实仓库的本地 A/B（30 个金标，默认重复 3 次）：

```bash
cd Electron/
node resources/runtime/extensions/code-retrieval/agent/eval/run-retrieval-eval.mjs \
  --jev-contrast --repetitions 3 --json /tmp/jev-offline.json
```

该入口始终只运行本地检索，即使环境中已有 key 也不会加载 Jev。A 为单查询，B 为同范围宽召回；两者使用同样的最终 topK 与输出预算。描述型案例明确使用 semantic 模式，精确／符号控制组不加变体。C 和单查询+Jev 明确标为 `not-run`，不能填模拟分数。初次观测不冒充冷索引，A/B 顺序按轮次交替；PASS 只表示金标、预算、来源和测量完整性有效，不表示更快。

真实 API 的安全合成对照（仅在明确授权后运行）：

```bash
# TYPESAFE_API_KEY 必须通过保险库/安全环境挂载；不要把值写进命令或文件。
npm run build:jev-optimizer
node resources/runtime/extensions/code-retrieval/agent/eval/run-jev-synthetic.mjs \
  --live-synthetic --json /tmp/jev-synthetic.json
```

- 只在新建临时目录生成 10 个任务、40 份代码文件；不接受 `--project/--source`，不读取真实仓库作为候选。
- 3 次重复，最多 60 次 API 请求，无重试；不加 `--live-synthetic` 时不使用 key、不请求网络。
- A/B 使用生产检索核心，候选预算为 100；C 重排 B 的同一批返回候选，单查询+Jev 重排 A 的同一批候选。逐对断言路径/行范围集合不变。
- C/单查询+Jev 的时间是对应本地阶段加重排阶段的分段累计，不是完整 Agent 耗时；不会把其它组耗时夹进来。
- 这些是人工构造的近似词干扰场景，不是代表性真实仓库或 LLM 基线。报告 Top1、Recall@3/@12、P50/P95、回退和输入用量；新增 Top12 漏检会使进程失败。
- API 单价和真实账单未核对，不伪造总费用；任务级成功率、LLM 轮次和整体加速仍需另测。

金标旧路径会继续硬失败；provider 来源检查独立于 preview-budget。zvec 是本地语义层，不要求等于同时运行的 exact sidecar。纯问题词若在当前索引有真实命中，或产生有解释的普通未命中，不强迫其标记降级。

## Safety contract while running

- Existing sidecars on this machine (including user sessions') are leased via
  attach/detach or merely pinged. They are never signaled.
- A sidecar whose PID appeared during the run cannot be proven ours from
  outside; it is treated as unowned and left to its own idle expiry (spawned
  probe sidecars get `idleMs: 15s`).
- Result/index writes happen only inside `.pi/agent/code-retrieval/results/`
  under the project home; every written file this run received is recorded and
  removed at exit unless it existed before the run started.
- Forced-fallback honesty probing skips (never manufactures unsafe states) when
  a shared tantivy sidecar is currently serving.

## Files

- `run-retrieval-eval.mjs` — runner (drives real registered tool handlers)
- `retrieval-eval-cases.mjs` — 20 representative bounded cases with verified gold
- `eval-lib/*.mjs` — ownership / file tracking / aggregation+redaction /
  adjacency / gates / trace aggregation (pure, testable)
- `eval-tests/*.test.mjs` — deterministic node:test suites pinning each finding fix
