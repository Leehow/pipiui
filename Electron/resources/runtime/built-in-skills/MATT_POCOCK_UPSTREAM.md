# Vendored from mattpocock/skills

Most of the skills in this directory are copied verbatim from
<https://github.com/mattpocock/skills>. They are shipped as ordinary files (the
"tinkerers" install route), not as a plugin, so nothing updates them behind our back.

| Field | Value |
|---|---|
| Upstream commit | `3cca18b368ae95cdbdebbff572ccafa662551015` |
| Upstream date | 2026-09-04 |
| Upstream package version | 1.2.3 |
| Synced on | 2026-09-05 |

## Vendored skills by upstream bucket

- **engineering**: ask-matt, code-review, codebase-design, diagnosing-bugs, domain-modeling,
  grill-with-docs, implement, improve-codebase-architecture, prototype, research,
  resolving-merge-conflicts, setup-matt-pocock-skills, tdd, to-spec, to-tickets, triage,
  wayfinder, wizard
- **productivity**: grill-me, grilling, handoff, teach, to-questionnaire, wait-what,
  writing-for-agents
- **in-progress** (beta upstream; may change or disappear): claude-handoff, implement-spec,
  loop-me, retro, setup-ts-deep-modules, writing-beats, writing-fragments, writing-shape
- **misc**: git-guardrails-claude-code, migrate-to-shoehorn, scaffold-exercises, setup-pre-commit

Everything else here (add-extension, browser-operator, chatrpg-test-dispatch,
create-pipiui-extension, create-subagent, pipiui-research, selfdev) is PipiUI's own.

## How these skills are meant to be read here

Upstream assumes an issue tracker, triage labels and a `/setup-matt-pocock-skills` run. PipiUI
does not: the philosophy `planning` layer owns the grill → design → slice → publish lifecycle
and tells the model to treat `to-spec` / `to-tickets` / `implement-spec` as advice on
*structure*, translating tracker/ticket/label steps into `plan_publish` tasks and worker briefs.
Do not edit the vendored files to "fix" that; adjust the layer.

## Updating

```bash
git clone --depth 50 https://github.com/mattpocock/skills /tmp/mp-skills
for d in Electron/resources/runtime/built-in-skills/*/; do
  n=$(basename "$d"); up=$(find /tmp/mp-skills/skills -mindepth 2 -maxdepth 2 -type d -name "$n" | head -1)
  [ -n "$up" ] && { diff -rq "$d" "$up" >/dev/null && echo "SAME $n" || echo "DIFF $n"; }
done
```

Copy changed directories over wholesale, add any new skill you want (its `SKILL.md` needs a
`description`, or the loader drops it), add a Chinese one-liner for it in
`packages/ui/src/subagent-debug-copy.ts`, then update the table above.
