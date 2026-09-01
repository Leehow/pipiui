# pi-core-prompt — the locked base system prompt

`SYSTEM_BASE.md` is PipiUI's base system prompt. It is the only prompt text still there
when every extension is disabled — no feature flag, no setting, and no extension can remove
it.

It reaches a session by two routes, because PipiUI has two spawn assemblers:

| Session | Route |
|---|---|
| Main | `assemblePiSpawn` passes it as the first `--append-system-prompt` |
| Dispatched worker | the same file, via `PIPIUI_CORE_PROMPT`, appended by the subagent before the agent's own prompt |

Workers build their arguments in another process and never call `assemblePiSpawn`, so the
env hand-off is the whole contract between the halves — nothing type-checks across it. A
test pins that the host exports the name and the subagent reads it.

## Why it is locked

PipiUI's core is small on purpose — pi's runtime plus this file. Everything else is an
extension. That only stays true if the base does not accumulate: every rule someone adds
here is a rule that cannot be turned off, cannot be scoped to a model or an agent, and
cannot be replaced without a rebuild. The philosophy layers exist precisely so that none
of that is necessary.

So the base is closed. **Do not add to `SYSTEM_BASE.md`.**

## Where to put a change instead

| You want to change | Go to |
|---|---|
| How the agent works — planning, retrieval, delegation, review, stopping | `pi-philosophy/layers/` (a bundled layer), or `{project}/.pi/agent/philosophy-user/` for a local override |
| A rule that is only true while some capability is mounted | the layer directory of the extension that owns that capability (`PIPI_PHILOSOPHY_LAYER_DIRS`) |
| A rule for one model family only | a layer with `requires-models` / `excludes-models` |
| Guidance attached to one tool | that tool's `promptGuidelines` in its `registerTool` call |
| A rule for one dispatched agent | that agent's own system prompt under `pi-ext/agents/` |
| Project-specific instructions | `AGENTS.md` / `CLAUDE.md` in the project, loaded as project context |

A layer file replaces a bundled layer by reusing its `id`, so even the shipped philosophy
can be overridden per project without touching this tree.

## The three things that belong here, and nothing else

1. **Identity** — that the agent runs inside PipiUI, with pi underneath.
2. **The shape of the architecture** — that capabilities arrive and leave with extensions,
   and what the agent must do about that (trust the tool list, report a missing capability
   instead of simulating it).
3. **Invariants that must survive every extension being off** — currently five: reply in
   the user's language, a question is not a work order, authorization comes from the
   request, an unexecuted claim is not a result, and the host process is the user's.

A candidate rule that is not one of those three has a home in the table above.

### Never enumerate extensions or capabilities

Point 2 is the *shape*, never the roster. The roster is per product profile:
`profiles/base` requires `skill-loader-extension` and `built-in-skills` only, while git, the terminal, plans,
goals, web access, the browser, code retrieval — and the method extension that carries the
philosophy — are all `profiles/coding`. A list written here is therefore false in every
other product, and it grows as products are added. v1 shipped with that list; it was
simultaneously the longest section and the only untrue one, and deleting it took the base
from ~1030 tokens to ~630. State the shape and let the session's own tool list carry the
contents. A test pins this against the ids in `profiles/*`.

### English, and as small as it goes

Every session pays for this prompt and none can decline it, so it is written in English and
kept minimal — currently ~630 tokens against a 800 budget the test enforces. Wording that
earns its place says something the model would otherwise get wrong; anything else is rent.

## If you really must amend it

Amending the base is a constitution-level change, so it is deliberately noisy:

1. Edit `SYSTEM_BASE.md`.
2. Run `npx vitest run packages/pi-backend/test/core-prompt-lock.test.ts` from `Electron/`.
   It fails with the new digest.
3. Paste that digest into `EXPECTED_DIGEST` in the test.
4. Say in the commit message which invariant changed and why no extension could carry it.

Step 3 is the point: the diff shows a reviewer that someone changed prompt text nobody can
turn off.

## Invariants the test pins

- The base is passed to every session, as the first `--append-system-prompt`, whatever the
  feature flags say.
- A user's own `.pi/APPEND_SYSTEM.md` still reaches the prompt after it — passing the base
  explicitly must not disable pi's discovery of the user's file.
- The base names no extension-owned tool. It has to stay true with everything unmounted,
  and a tool name in it would be a lie in exactly that case.
- Size budget, so the one prompt nobody can disable cannot grow unnoticed.
- The host and the subagent agree on `PIPIUI_CORE_PROMPT`, and the worker appends the base
  before the agent's own prompt.
- `PIPIUI_CORE_PROMPT` is a managed key, so a stale inherited value cannot reach a child.

## Checking that it actually landed

`pipiui_runtime_info` reports `systemPrompt`: total size, a digest, and a per-contributor
`segments` breakdown (`pi-frame`, `pipiui-base`, `philosophy`, `project-context`,
`skills`). The same object is written to the runtime debug sidecar beside the session file.

It is collected in `pipiui-runtime-info`'s `before_agent_start` handler. Pi chains that
event through extensions in mount order and PipiUI mounts this one last, so it is the only
point in the process that sees the finished prompt — before it existed, "is the base in
this session?" had no answer short of reading code. Sizes and a digest rather than the
text: the bodies are already on disk, and the digest is enough to tell whether what shipped
matches what you are reading.

Workers are separate processes and cannot mount `pipiui-runtime-info` — it registers a tool,
and a worker's tool set is a curated allowlist. They mount `pipiui-prompt-observer` instead:
the same provenance shape from the same shared module, no tool, no rewriting. The subagent
gives each run a report file at `{project}/.pi/agent-prompts/<agentId>.<runId>.json`, written
atomically, only when the composition changes, and swept to the newest 200.

That covers the half that most needed it: a worker's prompt is assembled by the subagent's
own argv builder rather than by `assemblePiSpawn`, so it is where the base or a philosophy
layer can go missing with nothing to say so.
