# Jev session context selection

Jev optimizer 1.1 adds an optional **按任务选择会话上下文** setting. Enable it in
the project's Jev settings, then open a new session. It uses the existing encrypted
TypeSafe credential. The default remains off; workers retain their existing tool scopes.

## Behavior

Before the first model request, the plugin evaluates short descriptions of tool groups
and eligible philosophy layers. Philosophy still owns model/role/config eligibility,
dependency rules and original text. The locked PipiUI base and project instructions are
never candidates. Foundation, general method, tool-call rules, model corrections and
user-authored layers are retained. Skills retain their existing names-only/on-demand path.

Each candidate is a Noul question in one TypeSafe request. The current request, original
task (up to 2,500 characters), and recent user/assistant text or compaction summary (up
to 6,000 characters) provide context. Tool results, reasoning traces, tool schemas and
full guidance bodies are not sent to Jev. Descriptions may contain business information;
the setting explains the data flow. The existing known-key redaction also applies.

Only confident negatives are excluded initially: Noul < 0.2. Uncertain candidates stay.
This is a conservative initial policy, not a calibrated accuracy claim. At most 96
candidates and 64 KiB of serialized input are accepted. An oversized current request is
not silently truncated. Transport retains the existing 1,500 ms deadline, cancellation,
revocation checks and no automatic retries. The local availability probe is separately
bounded by the same deadline. First-selection failure keeps the full baseline for the
session. Later failure retains loaded capabilities; explicit recovery remains available.

The first assembled system prompt is frozen. Selected tools and layers only accumulate.
Later guidance is delivered through hidden custom messages or a `context_tools` result,
without rewriting the initial prompt. `context_tools {}` lists available semantic capability
IDs; `context_tools {load:[...]}` loads their tools and original guidance. This discovery
entrypoint is always retained when selection is active. Explicit tool names bypass semantic
omission. Independent user turns evaluate remaining candidates; ordinary tool-loop calls
do not call Jev again. Inputs queued during streaming do not change tools under the active
loop; the model can use `context_tools`, or selection runs at the next idle input boundary.

Selection metadata and original material are saved as project-session custom entries,
which are not model messages. Resume restores the active branch's snapshot. New model,
tool-definition or explicit tool-scope changes start a new selection/cache epoch. Ordinary
compaction retains the selected union and rebases its guidance into the next system prompt.
This avoids losing guidance when earlier supplement messages leave the provider context.

## Cache boundary

Without capability additions, selected native tools and system text remain stable. A
guidance-only addition leaves both intact and appends a message. Adding a native tool can
invalidate a provider's cached prefix even though no existing definition was removed.
The plugin records this distinction in its session snapshot diagnostic. It does not
promise universal KV retention, change provider caching implementations, or prevent
other context optimizers from editing conversation history.

## Evidence and validation

The integration tests run the actual Pi SDK, actual philosophy composition and tool loop,
with a controlled TypeSafe transport and a faux model provider. They cover initial
selection, frozen system text, incremental loading and execution, resume, explicit names,
excluded tools, cloud disable, first-failure fallback, payload/response validation and
transport deadlines. Source build and these tests do not establish installed-App behavior,
real Jev relevance accuracy, cache-hit improvement or lower real-provider latency.

For broader speed claims, compare representative tasks with the feature off/on:
initial input tokens, cache-read tokens, time to first text, first useful action, total
completion time and missed-capability recovery. Include follow-up tasks and long sessions.

Design sources read on 2026-09-22:

- [Official TypeSafe skill](https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md): independent typed decisions and host-owned materialization.
- [Noul guidance](https://docs.typesafe.ai/primitives/noul): multi-label judgments and consequence-dependent thresholds.
- [API contract](https://docs.typesafe.ai/api): structured Noul requests and responses.
- [Anthropic cache hierarchy](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching): native tool changes can invalidate later cached content.

The upstream patterns confirm the selection approach; provider cache behavior requires
the explicit native-tool exception above. No external SDK or runtime dependency was added.

## Canonical App acceptance — 2026-09-22

Source commit `630b0833`; canonical PipiUI `0.0.146` built with the current combined
workspace (unrelated dirty work was packaged but not included in this commit).
`fast-app --overwrite-running` quit gracefully and relaunched PID 67659 from
`/Users/haoli/leehow/code/pipiui/build/PipiUI.app`. Strict deep signature verification
passed with `PipiUI Dev`; the certificate requirement remained unchanged. The packaged
Jev manifest is 1.1.0 and compiled selector bytes match the workspace. The arm64 main
executable is newer than the changed source. Temporary staging directories were removed.
LaunchServices was narrowed to the canonical App; 26 historical Trash registrations
were unregistered without deleting their bundles. Spotlight returned no competing App.

Native UI acceptance used the project's existing encrypted Jev credential. Both matched
requests used `grok-build/grok-4.7-build-fast`, reasoning `low`, and the identical prompt:
“请用两句话解释递归。不调用任何工具，不读取或修改文件。”

| Metric | Selection off | Selection on |
| --- | ---: | ---: |
| System prompt characters | 127,708 | 33,304 |
| Active native tools | 70 | 8 |
| Total input tokens (including cache reads) | 63,111 | 12,544 |
| Dispatch to first stream event | 6,377 ms | 2,876 ms |
| Host preparation | 8,613 ms | 7,206 ms |
| Complete user turn | 15,004 ms | 10,645 ms |

The selected run had 71 available tools including its recovery entrypoint. Its real
TypeSafe selection completed in 777 ms. Input volume fell 80.1% and system text 73.9%.
This is one matched task, not a controlled performance distribution; provider/network
variation and host preparation also affect elapsed time. A preliminary Kimi baseline
was excluded from this comparison because its model differed.

The next user turn requested a read-only `code_search` for `assemblePiSpawn`. The model
successfully returned `Electron/packages/pi-backend/src/spawn-assembly.ts`, with no edits
or delegation. The conservative selector expanded to 33 tools, including additional
coding/orchestration guidance: this demonstrates retention, not optimal selection quality.
Returning to a simple “测试完成” response retained all 33 tools. The frozen system hash
remained `b02c7232a9623b0d`; this final turn read 46,080 cached tokens and 147 uncached
input tokens. Native tool expansion had first caused a new uncached request, as documented.

Evidence (project-local sessions):

- Enabled: `.pi/agent/sessions/2026-09-22T05-11-59-284Z_e1bee869-c08a-41a7-a3d8-d1302bb5c79a.jsonl` and its runtime-debug sidecar.
- Matched baseline: `.pi/agent/sessions/2026-09-22T05-16-05-709Z_82c8ff3d-9e12-4376-b3d4-779186473a59.jsonl` and its runtime-debug sidecar.
- Host telemetry: `~/Library/Application Support/@pipiui/electron/pi-agent/telemetry/turns.jsonl`, turns `turn-b69eb19b23ee4460bc232fe8` (enabled) and `turn-86e6c06342dc4583938497b0` (baseline).
- Packaging log: `/tmp/pipiui-jev-context-package.log`.

The PipiUI project's context-selection setting was restored to **enabled** after the
baseline test. Browser cloud decisions and credential presence remained unchanged.
The temporary `low` reasoning setting was restored to the pre-test `xhigh` preference
after all measurements; it does not change the recorded test requests.
