# Vendored from nicobailon/pi-subagents

The files under `pi-subagents/` are copied verbatim from the `agents/` directory of the
`pi-subagents` npm package (<https://github.com/nicobailon/pi-subagents>, MIT — full text in
`ThirdPartyNotices/pi-subagents-LICENSE.txt`). They are shipped as ordinary files, not as a
plugin, so nothing updates them behind our back.

| Field | Value |
|---|---|
| Upstream package version | 0.66.0 |
| Upstream tag commit | `d17ed4ff29bae5c4996a220f57bc3e8c7bc5e485` (`v0.66.0`) |
| Upstream publish date | 2026-09-06 |
| Synced on | 2026-09-09 |

## What is vendored, and why only these

- **Native Pi agents** (`scout`, `researcher`, `worker`, `reviewer`, `oracle`, `delegate`): the
  six definitions that run as ordinary Pi sessions. They are importable.
- **Not vendored**: `codex-exec`, `codex-exec-writer`, `claude-code`, `claude-code-writer`,
  `cursor-agent`, `cursor-agent-writer`. Those declare `runner: { type: external-cli }`; PipiUI
  has no external-CLI worker runtime yet (`docs/superpowers/specs/2026-08-26-cli-subagent-workers-design.md`
  is approved but unimplemented), so the importer refuses them and there is nothing to ship.

## How these files are meant to be read here

These are **samples for the importer, not bundled roles**. They do not enter the agent catalog
by themselves. `subagent_manage({ action: "import", sample: "oracle", scope: "project" })`
converts one into a PipiUI `schema: 1` package (`.pi/agents/oracle/AGENT.md`) and reports every
upstream field it had to drop. The bundled roles (`explore`, `general-purpose`, `reviewer`,
`secretary`) stay PipiUI's own; upstream's `reviewer` can only be imported under another name
(`as: "..."`) because bundled roles shadow everything.

Do not edit the vendored files to "fix" upstream mechanics they reference (`contact_supervisor`,
`bg_wait`, acceptance reports, `context.md` handoffs). The converter maps what has a PipiUI home
and reports the rest; the prompt bodies are carried verbatim so a re-sync is a plain copy.

## Updating

```bash
curl -sL https://registry.npmjs.org/pi-subagents/-/pi-subagents-<version>.tgz | tar -xz -C /tmp
cp /tmp/package/agents/{scout,researcher,worker,reviewer,oracle,delegate}.md \
  Electron/resources/runtime/pi-ext/agent-samples/pi-subagents/
cp /tmp/package/LICENSE ThirdPartyNotices/pi-subagents-LICENSE.txt
```

Then update the table above and rerun
`node --experimental-strip-types --test Electron/resources/runtime/pi-ext/subagent/test/agent-import.test.ts`,
which converts every vendored sample and fails if a new upstream field is neither mapped nor in
the converter's drop table.
