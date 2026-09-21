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

- `agent.extension` → `vendor/pi-autoresearch/extensions/pi-autoresearch/index.ts`, mounted with `-e`.
- `agent.skills` → `vendor/pi-autoresearch/skills`, exported as `PIPIUI_SKILL_ROOTS` so the skill
  loader offers the three upstream skills to the session and to Settings → 技能.
- `runtimeAssets` → `vendor/pi-autoresearch`, copied verbatim into
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

None to the vendored code. The mount/skill wiring lives entirely in `pipiui-extension.json`, and
the extension is enabled for a session by the ordinary bundled-extension registry — no upstream
file is patched, and no PipiUI-specific branch is added inside `vendor/`.
