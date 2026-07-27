# pipi-philosophy

A layered working philosophy for the [pi coding agent](https://github.com/earendil-works), shipped as a pi package.

Philosophy is the part of an agent setup that has nothing to do with which frontend you happen
to be using — it is how the agent *thinks*: when to delegate, when to search, what counts as
evidence, when it is allowed to stop. So it lives in pi, not in any one UI. Install it once and
a bare terminal session, a GUI frontend, and every dispatched worker load the same four layers
from the same config.

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

## The four layers

| id | 中文名 | What it governs | Scope |
|---|---|---|---|
| `foundation` | 基础哲学 | Authorization is established by the request; process weight matches the work; no early stopping; plans are lists, not documents; external advice never outranks your own judgement | main + lead + worker |
| `method` | 工作方式哲学 | Form your own read of the problem *first*, then cross-validate against the outside world; evidence outranks authority | main + lead + worker |
| `orchestration` | 编排哲学 | Do not work the floor: decompose, delegate, verify, integrate, report. Briefs, verification, ledger, completion ownership | main + lead |
| `fanout` | 瀑布流哲学 | Parallel by default; fan-out width triggers a lead firewall; worker state arrives as signals; keep the wave's raw output out of your context | main + lead |

`fanout` requires `orchestration`. `orchestration` and `fanout` require a dispatch tool and are
skipped entirely in a session that has none — the judgement layers keep working.

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
name: 我的基础哲学
summary: shown by /philosophy
order: 10
requires: []
requires-capabilities: []
scope: [main, lead, worker]
---
Your text.
```

## When pi changes

Layer bodies never name a pi tool. They reference capabilities — `{{delegate}}`, `{{search}}`,
`{{fetch}}`, `{{browser}}`, `{{delegate_status}}` — and `capabilities.json` is the single place
that maps a capability to the tool name of the day. A test fails the build if a body names a
tool directly.

So when pi renames or drops a tool, you edit two lines of JSON and the four bodies stay
untouched. When a tool disappears entirely:

- a layer that lists it in `requires-capabilities` is skipped, with the reason shown in
  `/philosophy`;
- an optional capability is replaced by its `absent` prose, so no dead tool name ever reaches
  the model.

`/philosophy` prints the differential between the mapped tools and `getActiveTools()`. Run it
after a pi upgrade and you will see immediately whether anything came unstuck.

## Known limitations

- **Worker detection outside PipiUI.** Scope filtering needs to know whether this process is a
  dispatched worker. It reads `PIPI_PHILOSOPHY_ROLE` (`main` | `lead` | `worker`) first, then
  falls back to `PIPIUI_AGENT_DEPTH > 0`. A dispatch runtime that sets neither has its workers
  treated as main sessions — they will carry the orchestration layer they do not need. Set
  `PIPI_PHILOSOPHY_ROLE=worker` in your dispatch environment to fix that.
- **`fanout` assumes lifecycle signals.** Its handling of `[worktree-merge-failed]`,
  `[post-merge-verify-failed]` and `[subagent-stalled]` describes the PipiUI dispatch runtime.
  Under a plainer runtime those bullets are inert rather than wrong.
- **The agent roster is a list, not a discovery.** `capabilities.json` → `agents` names the
  agents the orchestration layer will delegate to. Edit it to match your own agent set.

## Development

```bash
node --test test/*.test.ts
```

The composition core (`compose.ts`) imports nothing from pi, so every rule that matters —
placeholder resolution, dependency and scope filtering, capability degradation, user overrides
— is tested with plain node and no API calls. `philosophy.ts` is the only file that touches the
runtime.

## License

Apache-2.0.
