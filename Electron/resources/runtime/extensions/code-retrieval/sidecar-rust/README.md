# tantivy-sidecar

Phase 2 exact-index sidecar for `code-retrieval`. Loopback HTTP, Git HEAD
baseline + dirty overlay, in-process FSEvents watcher (`notify`).

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo build --release
mkdir -p ../agent/sidecar/bin/darwin-arm64
cp target/release/tantivy-sidecar ../agent/sidecar/bin/darwin-arm64/tantivy-sidecar
```

This crate is darwin arm64 only for now. Lifecycle prefers this binary and
falls back to `query-sidecar.js` (rg) when it is missing.

## Session leases

`POST /attach` creates or renews a per-session lease (`lastSeenAt` / `expiresAt`).
`POST /heartbeat` renews an **existing** session only (unknown or detached ids
return 404 and never upsert). Default TTL is 5 minutes
(`PIPIUI_CODE_RETRIEVAL_SESSION_TTL_MS`).
Expired sessions are dropped in the idle loop; when refcount hits zero the
sidecar still exits after `PIPIUI_CODE_RETRIEVAL_IDLE_MS`. Authenticated
`GET /health` returns `sessionTtlMs`, `oldestExpiresAt`, and a live session
summary (ids + timestamps only — never the token). Node fallback matches.

## Watcher batching

The watcher does **not** register a recursive watch on the whole project root.
It watches the root non-recursively and each non-skipped top-level directory
recursively, so `.pi`, `.git`, `node_modules`, `dist`/`build`/`target`, and
worktree bookkeeping trees never enter the notify queue.

Event filter (any path segment, plus binary/generated extensions):

- VCS / sidecar: `.git`, `.hg`, `.svn`, `.pi` (includes
  `.pi/agent/code-retrieval/index`)
- Worktree bookkeeping: `.worktrees`, `pipiui-wt`
- Generated / build: `node_modules`, `dist`, `build`, `out`, `release`,
  `coverage`, `target`, `.next`, `.turbo`, `.cache`, `.eggs`, `__pycache__`,
  `.venv`, `venv`, `.tox`, `.mypy_cache`, `.pytest_cache`, `.idea`, `.vscode`,
  `vendor`

Surviving file events are merged by path (last op wins) for a short debounce
window after the first event in a burst (`80ms` default,
`PIPIUI_CODE_RETRIEVAL_WATCH_DEBOUNCE_MS` to override, max 5s). Overlay
upserts/deletes in that window share **one** Tantivy commit + reader reload.
Deletes also tombstone already-covered descendants so a directory remove does
not leave stale overlay docs. HTTP `/v1/index/update|delete` still commits
immediately so search stays fresh for explicit API writes.
