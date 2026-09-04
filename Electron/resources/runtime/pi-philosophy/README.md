# pipi-philosophy

A layered working philosophy for the [pi coding agent](https://github.com/earendil-works), shipped as a pi package.

Philosophy is the part of an agent setup that has nothing to do with which frontend you happen
to be using — it is how the agent *thinks*: when to delegate, when to search, what counts as
evidence, when it is allowed to stop. So it lives in pi, not in any one UI. Install it once and
a bare terminal session, a GUI frontend, and every dispatched worker load the same layers from
the same config — each one addressed to whoever can act on it.

## Install

```bash
pi install git:github.com/<you>/pipi-philosophy
```

Also works from a local checkout, which is what a GUI frontend bundling this package should
register:

```bash
pi install /path/to/pipi-philosophy
```

Either form adds the package to `~/.pi/agent/settings.json`. Verify with `pi list`, or start a
session and run `/philosophy`.

To try it without touching your settings:

```bash
pi -e /path/to/pipi-philosophy/philosophy.ts
```

## What sits underneath

Since the base-prompt lock, this package is no longer the bottom of the stack.
`../pi-core-prompt/SYSTEM_BASE.md` is: the host passes it to every session
unconditionally, it survives every extension being disabled, and it is closed to new
rules. It holds identity, the extension architecture, and a handful of invariants — and
nothing about method.

That makes the division of labour explicit. **The base says what is true; the layers say
how to work.** Anything that reads as advice, judgement, or process belongs here, where it
can be toggled, scoped to a model, replaced per project, or dropped when its capability is
unmounted — none of which the base can do.

Two rules appear in both: the reply-language rule and the PipiUI host lifecycle rule. That
duplication is deliberate. `foundation` can be switched off; the base cannot, and neither
rule is safe to lose. Do not "de-duplicate" them.

## The layers

The split that matters most runs along one line: **delete `foundation` and the agent becomes
untrustworthy; delete the rest and it stays trustworthy but works badly.** Foundation is what
you are owed as the person it works for. Everything after it is craft.

The rest of the split is by audience. A layer is written for whoever can act on it, which is
why `craft` reaches the worker that writes code and `orchestration` does not: a rule delivered
to someone who cannot perform it is prompt weight and nothing else.

| id | Name | What it governs | Delivered to |
|---|---|---|---|
| `foundation` | Foundation | Authorization is established by the request (state the assumption you proceeded under, never ask a ritual question); evidence outranks authority; no early stopping; external advice never outranks your own judgement | main + worker |
| `method` | Working method | Process weight matches the work; of the routes that finish, take the fastest and record what each task actually cost; research-only requests are terminal | main |
| `retrieval` | Code retrieval | Locating code is several questions: the index first for a description, exact match for a token you already know, symbol graph for relationships; refs before bodies; a map before a guess | main + every code-reading agent |
| `research` | Research | Form your own read *first*, then cross-validate outside; who does the searching; third-party repos are cloned to `/tmp` | main + `explore` |
| `recon-stopping` | Recon convergence | Convergence by named evidence dimensions — one file:line anchor per required dimension; a four-line checkpoint after a sustained read/search burst; coverage decides the stop, breadth scales with the brief, no hard cap | `explore` + `reviewer` |
| `planning` | Planning | Plans are lists; the publish → approval → execute lifecycle; an approved plan is a dispatch manifest | main + `plan` |
| `craft` | Craft | Define the success criterion before starting; write the minimum that solves it; change only what the task requires; done is a stopping point | main + `general-purpose` |
| `debugloop` | Debug loop | The boss holds the only observation surfaces: reproduce before dispatching, carry evidence verbatim, re-check by hand after the merge — and do it while the reviewer reads | main |
| `domain` | Domain memory | Project vocabulary and the ADR gate: what must be looked up rather than re-derived | main |
| `orchestration` | Orchestration | Do not work the floor: decompose, delegate, verify, integrate, report. Briefs, verification, ledger, completion ownership | main |
| `same-turn` | Same-turn discipline | Every call whose arguments you already know goes out in the same message | main + `general-purpose` |
| `fanout` | Fan-out | Parallel by default; the boss spends width freely — twenty or forty when the decomposition is real — and holds the mainline tighter the wider the wave gets; worker state arrives as signals; keep the wave's raw output out of your context | main |
| `nested-dispatch` | Nested dispatch | For a worker that may itself delegate: dispatches are synchronous, concurrency exists only inside one call, children cannot delegate, and recon returns file:line evidence rather than prose | `general-purpose` |
| `toolcall` | Tool-call discipline | Calling the tool *is* the work; act on the first turn; "I can't" has to name something | one model family (see below) |
| `thinking` | Thinking discipline | Decide, act, verify — once each; resolve an unknown with the cheapest sufficient probe | every family measured to sprawl |

`fanout` requires `orchestration`. `orchestration`, `same-turn`, `fanout` and `nested-dispatch`
require a dispatch tool and are skipped entirely in a session that has none; `retrieval` requires a code-search
tool and is skipped in a project that mounts none — the judgement layers keep working either
way.

Turning off orchestration does **not** cost you the foundation. That separation is the main
reason this package exists: "don't ask ritual confirmations" and "a failed attempt is not the
end of the task" have nothing to do with whether you delegate.

## Configuration

`~/.pi/agent/philosophy.json`, hot-read every turn — a change applies from the next turn, with
no session restart:

```json
{
  "version": 1,
  "enabled": true,
  "layers": { "foundation": true, "method": true, "orchestration": true, "fanout": true },
  "scopes": { "worker": false }
}
```

`layers` is a set of overrides, not a roster: a layer absent from the map is on. The four
named above are the ones the defaults spell out, and listing any other id with `false` turns
that one off just the same.

`scopes.worker` is off by default. Dispatched workers already carry their own agent prompt and
a brief; adding the judgement layers costs roughly 1.6k tokens of prefix per worker, so turn it
on deliberately.

## Commands

| Command | Effect |
|---|---|
| `/philosophy` | What is active, what is not and why, token estimate, and which mapped tools are missing |
| `/philosophy show` | The exact text being appended to the system prompt |
| `/philosophy on` / `off` | Master switch |
| `/philosophy toggle <layer>` | Toggle one layer |

## Editing the philosophy

Drop a file into `~/.pi/agent/philosophy-user/`. A file whose `id` matches a bundled layer
**replaces** it; a new `id` is added at its `order`. Nothing here is compiled, so your own
philosophy needs no fork and no rebuild.

```markdown
---
id: foundation
name: My foundation
summary: shown by /philosophy
order: 10
requires: []
requires-capabilities: []
scope: [main, worker]
---
Your text.
```

### Scoping a layer to models

Most layers are judgement and apply everywhere. A layer that exists to *correct* one
model's behaviour should not be given to a model that does not have that drift — the
prose would simply be false. Two fields express that, and the choice between them is
about which side is enumerable:

| Field | Meaning | Use when |
|---|---|---|
| `requires-models` | Only these routes get the layer | The drift belongs to one family and every other model is fine |
| `excludes-models` | Every route except these gets it | The drift is the norm and the exceptions are what you can name |

Both take `provider/id` patterns, matched case-insensitively as an exact string or with
one trailing `*` (`kimi-coding/*`). Nothing infers a family from a name it was not told.

Prefer `excludes-models` when you are unsure. `requires-models` fails open: a route the
author never named silently receives nothing, and `/philosophy` is the only place that
says so. That is how `thinking` — the layer written to stop thinking sprawl — sat
inactive on this host's own default route while every measured session went on sprawling.
`excludes-models` fails closed, so a provider added tomorrow inherits the correction
until someone measures that it does not need it.

### Scoping a layer to model capabilities

A layer that only makes sense when the selected model actually hosts a feature — hosted
`code_interpreter`, structured outputs, input files — uses `requires-model-capabilities`.
Keys are the public capability contract, never a provider id:

```
requires-model-capabilities: [hostedTools.code_interpreter, structuredOutputs]
```

Known keys: `hostedTools.web_search`, `hostedTools.x_search`,
`hostedTools.code_interpreter`, `structuredOutputs`, `inputFiles`. A missing bag, an
unknown model, or a model that does not declare the key drops the layer. Nothing here
inferrs support from a provider name.

A layer scoped either way bypasses the `scopes.worker` bulk switch. That switch declines
to buy ~1.6k of judgement prefix per worker; it was never about withholding a correction
that keeps the worker's own model from misbehaving.

## When pi changes

Layer bodies never name a pi tool. They reference capabilities — `{{delegate}}`, `{{search}}`,
`{{fetch}}`, `{{browser}}`, `{{code_search}}`, `{{delegate_status}}` — and `capabilities.json`
is the single place that maps a capability to the tool name of the day. A test fails the build
if a body names a tool directly.

So when pi renames or drops a tool, you edit two lines of JSON and every body stays
untouched. When a tool disappears entirely:

- a layer that lists it in `requires-capabilities` is skipped, with the reason shown in
  `/philosophy`;
- an optional capability is replaced by its `absent` prose, so no dead tool name ever reaches
  the model.

`/philosophy` prints the differential between the mapped tools and `getActiveTools()`. Run it
after a pi upgrade and you will see immediately whether anything came unstuck.

## Known limitations

- **Worker detection outside PipiUI.** Scope filtering needs to know whether this process is a
  dispatched worker. It reads `PIPI_PHILOSOPHY_ROLE` (`main` | `worker`) first, then
  falls back to `PIPIUI_AGENT_DEPTH > 0`. A dispatch runtime that sets neither has its workers
  treated as main sessions — they will carry the orchestration layer they do not need. Set
  `PIPI_PHILOSOPHY_ROLE=worker` in your dispatch environment to fix that.
- **`fanout` assumes lifecycle signals.** Its handling of `[worktree-merge-failed]`,
  `[post-merge-verify-failed]` and `[subagent-stalled]` describes the PipiUI dispatch runtime.
  Under a plainer runtime those bullets are inert rather than wrong.
- **The agent roster is a list, not a discovery.** `capabilities.json` → `agents` names the
  agents the orchestration layer will delegate to. Edit it to match your own agent set.

## Development

This copy is vendored into PipiUI rather than installed from npm, so its `test/` directory does
not travel with it. The suite that guards this tree lives with the host:

```bash
npx vitest run packages/pi-backend/test/philosophy-runtime.test.ts
```

Run it from `Electron/`. It reads these layer files off disk and pins what the standalone
package's own tests cannot see: which layers each dispatched agent is addressed, that no body
names a pi tool directly, that the plan lifecycle is stated in exactly one layer, and the
boss's total prefix size.

The composition core (`compose.ts`) imports nothing from pi, so every rule that matters —
placeholder resolution, dependency and scope filtering, capability degradation, user overrides
— is testable with plain node and no API calls. `philosophy.ts` is the only file that touches
the runtime.

## Credits

Three sections of the `method` layer — *write the minimum that solves it*, *change only what
the task requires*, and *define the success criterion before you start* — were prompted by
[andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) (MIT), which
distills Andrej Karpathy's observations about how LLMs fail at coding: they overcomplicate,
they make orthogonal edits, and they run with assumptions nobody checked. The wording here is
our own, and its fourth principle ("ask when unsure") is deliberately *not* adopted — a
dispatched worker has no channel to a human, so the equivalent rule in `foundation` is "do not
ask, but do not hide either": state the assumption and continue.

## License

Apache-2.0.
