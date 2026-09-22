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

Before making a speed claim, compare representative tasks with the feature off/on:
initial input tokens, cache-read tokens, time to first text, first useful action, total
completion time and missed-capability recovery. Include follow-up tasks and long sessions.

Design sources read on 2026-09-22:

- [Official TypeSafe skill](https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md): independent typed decisions and host-owned materialization.
- [Noul guidance](https://docs.typesafe.ai/primitives/noul): multi-label judgments and consequence-dependent thresholds.
- [API contract](https://docs.typesafe.ai/api): structured Noul requests and responses.
- [Anthropic cache hierarchy](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching): native tool changes can invalidate later cached content.

The upstream patterns confirm the selection approach; provider cache behavior requires
the explicit native-tool exception above. No external SDK or runtime dependency was added.
