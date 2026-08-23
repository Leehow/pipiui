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
