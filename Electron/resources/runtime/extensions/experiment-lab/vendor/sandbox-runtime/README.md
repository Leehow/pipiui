# Sandbox runtime distribution

This isolated production tree pins `@anthropic-ai/sandbox-runtime` to **0.0.77**.
Upstream: https://github.com/anthropic-experimental/sandbox-runtime (Apache-2.0).
The actual upstream license ships at `node_modules/@anthropic-ai/sandbox-runtime/LICENSE`;
transitive packages retain their own license files. No upstream source is modified.

`npm ci --omit=dev --ignore-scripts --bin-links=false --maxsockets=3 --workspaces=false`
installs only this lockfile, not extension peer dependencies. The build preparation script
runs it only when the pinned tree is absent or changed. Tool execution never installs.
`sync-bundled-extension.mjs` copies this entire tree via `runtimeAssets`; runtime-install
preserves its nested node_modules. The supervisor loads this exact tree by absolute URL,
never the checkout's or a globally installed package.

macOS uses the system sandbox-exec. Linux requires bubblewrap, socat and ripgrep plus
usable kernel namespaces. Unsupported or unavailable isolation fails closed. A macOS
OS test result does not certify Linux. No App launch or restart is part of this build.
