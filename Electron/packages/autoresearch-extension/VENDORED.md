# Vendored pi-autoresearch provenance

- Upstream: `davebcn87/pi-autoresearch`
- Version: `1.8.1`
- Registry tarball: `https://registry.npmjs.org/pi-autoresearch/-/pi-autoresearch-1.8.1.tgz`
  - sha256 `fb5586c303c748a6c7d9bf2e4256c8ab28dd350da48b575688f108bbebde55bb`
  - published gitHead `703a8f12ce80259d65bec41029c8136ce60686ff`
- License: MIT; the upstream license is preserved in `vendor/pi-autoresearch/LICENSE`.

`vendor/pi-autoresearch/` is that tarball's `package/` payload, byte for byte: every file's sha256
was compared against the extracted tarball and matched, and the upstream `package.json` is
unmodified. PipiUI ships no `node_modules` for it — Pi provides `@earendil-works/*` and
`@sinclair/typebox` as virtual modules to extensions at runtime.

## Mount

- `agent.extension` → `mount/autoresearch.ts`, a PipiUI-side file mounted with `-e`. It calls the
  vendored entry's default export (upstream activation, unchanged) and then puts upstream's three
  mode-gated tool names into the active tool set at session start, so the capability is reachable
  from plain language instead of requiring `/autoresearch <goal>`. It skips names the spawn
  excluded via `--exclude-tools`, and skips the whole thing when the newest recorded mode decision
  in the session is an explicit off.
- `agent.skills` → `skills` (the PipiUI entry skill) and `vendor/pi-autoresearch/skills`, exported as
  `PIPIUI_SKILL_ROOTS` so the skill loader offers all four skills to the session and to Settings → 技能.
- `runtimeAssets` → `vendor/pi-autoresearch`, `skills`, `mount`, copied verbatim into
  `resources/runtime/extensions/autoresearch/` by `scripts/sync-bundled-extension.mjs`.

## Updating

1. `npm pack pi-autoresearch@<version>` into a scratch directory and extract it.
2. Replace `vendor/pi-autoresearch/` with the extracted `package/` payload. Keep the directory
   name and keep every file — nothing else moves.
3. Bump `updateComponents[0].version` in `pipiui-extension.json` and refresh this file's version,
   tarball sha256 and gitHead.
4. `npm test` in this package: it fails when the declared component version and the vendored
   `package.json` version disagree.
5. `npm run build` to refresh the runtime mirror.

## PipiUI deviations

None to the vendored code: no upstream file is patched, and no PipiUI-specific branch is added
inside `vendor/`. Everything PipiUI adds lives outside the vendored tree — the mount file
(`mount/autoresearch.ts`), the entry skill (`skills/autoresearch/`), the manifest wiring, and this
provenance file. The mount depends on three upstream internals (the three gated tool names, the
`pi-autoresearch.activation` entry type, and `setActiveTools` gating); `npm test` asserts all three
against the vendored source, so a re-vendor that renames any of them fails instead of silently
leaving the tools gated.
