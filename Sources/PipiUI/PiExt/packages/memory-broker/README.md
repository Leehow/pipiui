# pipiui-memory-broker

`pipiui-memory-broker` is PipiUI's host-neutral Pi package for a bounded memory
broker. It starts no server at extension load time.

- **Version:** `0.1.0`
- **License:** Apache-2.0
- **Runtime dependencies:** Node standard library, Pi peer packages, pinned
  `pi-hermes-memory@0.9.4`, and explicit
  `pipiui-memory-broker-contract@0.1.0` metadata.

The contract is vendored in this package's publish layout and resolved through
its package import map, so a copied broker package has no implicit sibling
checkout dependency. It has no Swift, AppStore, BridgeServer, or UI dependency.

## Modes

- **main**: merges Hermes config with `memoryMode: "policy-only"` and
  `flushOnCompact: false`, registers the pinned upstream Hermes extension, then
  starts a random-token loopback server on `127.0.0.1`. It exposes
  `PIPIUI_MEMORY_BROKER_URL` and `PIPIUI_MEMORY_BROKER_TOKEN` and closes the
  server/native adapter on `session_shutdown`.
- **worker**: never starts a server or backend; registers only `memory_query`.
- **operator**: uses the worker client plus app/bundle query scope and exports a
  metadata-only Computer candidate helper. It never exposes a durable-write
  tool.

The HTTP child surface accepts only a server-issued capability bound to one
project root, agent id, run id, and role. The request payload has no role,
project-root override, desktop grant, or durable authority field.

The backend is deliberately pluggable. `InMemoryMemoryBackend` is for tests;
`UnavailableMemoryBackend` makes memory a fail-closed, non-blocking degraded
capability. Main mode dynamically loads the upstream Hermes extension only
there. Its 0.9.4 internal storage imports live in the single
`src/hermes-adapter.ts` compatibility boundary with exact package/version/shape
checks; replace that adapter when Hermes publishes a stable broker API.

Project-scoped durable main promotions write through Hermes's verified FTS
store. Quarantined child submissions and session-scoped candidates are appended
and fsync'd to `pipiui-memory-broker-experience-v1.jsonl`; broker status reports
that pending review state rather than claiming a durable Hermes write.

## Local verification

```sh
node --experimental-strip-types --test \
  Tests/Node/test-memory-broker-package.mjs \
  Tests/Node/test-memory-broker-hermes-adapter.mjs
```
