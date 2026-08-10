---
name: create-subagent
description: Create a least-privilege schema v1 PipiUI subagent package through the bundled subagent_manage tool.
---

# Create a PipiUI subagent

## Agent, Skill, and Prompt

Use this **only in the main session**. This Skill is guidance for the current
main session; it is not an Agent and grants no tools. Dispatched workers run
skill-free and must not load this Skill. A Prompt is only task text, not a
reusable definition or permission grant.

The bundled `subagent_manage` tool is the authority for agent package
scaffolding, validation, permission summaries, and installation. Bundled Skill
names are retained and bundled-first: `create-subagent` is the built-in workflow
for this task, so a same-named user Skill cannot replace it. Do **not**
copy a schema by hand or write `AGENT.md` directly when that tool is available.
The template beside this Skill is documentation/test material only; runtime
rules come from the bundled subagent extension's `agents.ts` parser.

## Collect only what is needed

Ask only for information absent from the request:

1. **Scope** — `user` or `project`.
2. **Name** — concise lower-kebab-case name.
3. **Description** — one clear sentence about role and outcome.
4. **Mode / optional model** — `read-only` or `worker`; omit model unless the
   user needs one.
5. **Minimum capabilities** — filesystem, shell, web, exact MCP tool names,
   desktop, and delegation.

Do not ask for accounts, login, credentials, marketplaces, remote installs, or
infrastructure details. The least-privilege baseline is read-only with no
filesystem/shell/web/MCP/desktop/delegation, `worktree: none`, and a report.

## Tool-first workflow

1. If the user wants to inspect existing roles, call
   `subagent_manage({action:"list", scope:"user"|"project"|"both"})` or
   `inspect`. Read its `diagnostics`; a shadowed or malformed definition is not
   a reason to silently invent a replacement.
2. Call `subagent_manage({action:"scaffold", scope, name, description, mode?,
   model?, capabilities?, worktree?, deliverable?, tools?, prompt?})`.
   It returns schema v1 content, the exact target path, parser diagnostics, and
   the capability/tools permission summary.
3. Call `subagent_manage({action:"validate", scope, name, draft})` on the
   proposed content. Use the returned structured errors/warnings and
   `permissionSummary`; do not imitate the parser in prose.
4. **Before any install**, show the user the proposed scope/path, mode/model,
   worktree/deliverable, declared capabilities, explicit `tools` narrowing, and
   the tool's runtime caveats. In particular: global disabled-tools and missing
   extensions can still remove tools; `desktop: requestable` needs the existing
   global Computer Use host gate plus a per-task grant; delegation is depth and
   runtime-role limited.
5. After the user approves that preview, call
   `subagent_manage({action:"install", scope, name, draft, overwrite?})`.
   Omit `overwrite` by default. Set `overwrite:true` only when the user
   explicitly approved replacing that exact existing package. Report the tool's
   final install path and verification result.

`install` only writes a validated standard package under the selected user or
project agent root. A project install writes
`<project>/.pi/agents/<name>/AGENT.md`; it still requires the existing runtime
project-agent confirmation when that role is run. It rejects bundled targets,
traversal, symlink escape, and arbitrary output paths.

## Capability choices

- `read-only` must use `worktree: none`; it cannot use
  `filesystem: workspace-write`.
- Use `worktree: isolated` only for a worker that actually needs isolation.
- MCP is false by default. If needed, give only exact registered
  `mcp_<server>_<tool>` names. Never use `true`, `*`, a server-wide grant, or a
  guessed name.
- `desktop: requestable` is only a request for per-task desktop access. Never
  put `computer` or `open_application` in `tools`.
- `web: true` is retrieval capability, not a browser grant. Never put
  `browser` in `tools`.
- Set delegation only for a real orchestration role. It does not let a worker
  load Skills or self-grant desktop/search access.
- `tools` is optional and only narrows capability-derived tools; it cannot add
  a tool or bypass a capability.

Keep the flow local, direct, and preview-first. No remote market, account, or
pairing ceremony is needed.
