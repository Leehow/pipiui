# pipiui-memory-broker-contract

Host-neutral TypeScript contract for PipiUI memory broker implementations.

- **Version:** `0.1.0`
- **License:** Apache-2.0
- **Runtime dependencies:** Node standard library only.

This package deliberately has **no** `pi.extensions` manifest, server, tool
registration, or Hermes retrieval/learning implementation. It is a pure,
independently importable policy baseline for the current Swift host and a future
Pi/Electron host:

- versioned request/response types;
- canonical main-project identity and per-run grant fencing;
- `main` / `worker` / `operator` ACL and promotion policy;
- bounded queries, experience normalization, dedupe hashes, and TTL handling;
- brief/hypothesis quarantine; and
- metadata-only Computer-memory validation and sanitization.

A host must mint and validate desktop grants outside this package's memory RPC
surface. No request or candidate can create, extend, or serialize a desktop
grant. The contract exports policy helpers only; a host supplies transport,
storage, and any retrieval/learning backend.

Run the repository parity suite with:

```sh
node --test Tests/Node/test-memory-broker-contract.mjs
```
