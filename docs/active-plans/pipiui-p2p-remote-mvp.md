# PipiUI P2P Remote MVP

Work ID: `pipiui-p2p-remote-mvp`

## Objective

Evolve the existing personal remote Relay into a distributable remote-control
transport where every PipiUI installation has its own device identity, the
server performs pairing and WebRTC signaling, and command/transcript traffic
uses a peer-to-peer data channel whenever connectivity permits.

## Acceptance

- No Cloudflare Access service token is shared across installed copies.
- Each PipiUI installation owns an independent device identity and device
  secret.
- A browser can pair to exactly one device using a short-lived,
  device-generated capability.
- The server exchanges WebRTC offer/answer/ICE signaling without receiving
  remote command or transcript payloads on the successful P2P path.
- The existing WSS Relay remains an explicit compatibility fallback when
  WebRTC cannot connect.
- Pairing, signaling authorization, expiry, replay rejection, origin checks,
  payload limits, and disconnect cleanup have automated coverage.
- The primary checkout produces the only runnable `build/PipiUI.app`, and the
  packaged app is newer than all changed sources.
- A real browser-to-packaged-app connection is verified through the deployed
  hostname, with evidence distinguishing P2P success from Relay fallback.

## Non-goals

- Shipping one shared Cloudflare service token to end users.
- Building a full commercial account, billing, or organization system in this
  slice.
- Removing the current Relay before the P2P path is accepted.
- Claiming universal direct connectivity without a TURN fallback.

## Boundaries

- Existing unrelated repository work and history stay untouched.
- Browser traffic uses the Access-protected `pipi.aichattrpg.com` trust
  boundary, and the Relay independently verifies the signed Access JWT.
- Accountless device P-256 signaling uses the distinct
  `signal.aichattrpg.com` hostname. At the tunnel and Relay, only the
  exact `/device/ws` WebSocket endpoint is admitted on that hostname; it
  exposes no browser HTTP or legacy route.
- `/device/ws` carries no shared Cloudflare Access client credential. The
  signaling challenge is bound to the signaling origin, while pairing and
  browser commands remain bound to the Access-authenticated browser origin.
- Worker work may change the remote transport, Relay service, remote UI, and
  focused tests only.
- No push, production deploy, credential creation/rotation, destructive git,
  or new paid service without lead review and current user authorization.
- Linked worktrees may run `swift build` and `swift test` only; packaging is
  restricted to `/Users/haoli/leehow/code/pipiui`.

## Validation

- Relay unit/integration tests.
- Focused Swift remote transport tests.
- Full `swift test`.
- Primary-checkout package, timestamp comparison, and `codesign` verification.
- Deployed service health, loopback-only bind, signaling authorization, and
  real browser transport-state evidence.

## Status

- P2P architecture reconnaissance: Done; retained app-scoped WKWebView chosen
  for a gated Slice 0, with native WebRTC/Pion fallback if live lifecycle
  acceptance fails
- Implementation: Slice 0 source, review, package, and available live lifecycle
  gates complete; Slice 1 source/component acceptance complete after five
  revision rounds and an independent CLEAN gate; Slice 2 source/component
  acceptance complete after three revision rounds and an independent CLEAN
  gate; Slice 3 source/component and normalized same-machine production-browser
  acceptance complete after one revision round and an independent CLEAN gate;
  Slice 4 product UI/lifecycle acceptance complete after two revision rounds
  and an independent CLEAN gate; Slice 5 no-TURN adversarial validation
  complete after one exact-expiry revision and an independent CLEAN gate
- Slice 1 validation: Relay build/tests 32/32, npm audit 0 vulnerabilities,
  focused Swift remote tests 48/48, full Swift tests 1082/1082, `swift build`,
  and `git diff --check` passed. This does not claim deployed
  Tunnel/DNS/Access acceptance.
- Slice 2 validation: Relay build/tests 38/38, npm audit 0 vulnerabilities,
  shared hostile fingerprint vectors agree across Relay, Swift, and loaded
  production WK, full Swift tests 1093/1093, `swift build`, JavaScript syntax,
  and `git diff --check` passed. A loaded production WK channel dynamically
  carried a read-only request through `RemoteHostController` and returned its
  response after the signaling deadline. This does not claim a public
  browser/TURN/deployed P2P route.
- Slice 3 validation: Relay build/tests 51/51, npm audit 0 vulnerabilities,
  focused Swift peer tests 27/27, full Swift tests 1095/1095 with the opt-in
  browser test skipped by default, and the opt-in real Chrome/WK gate passed
  independently in 3.814 seconds. The built production browser asset paired,
  verified the signed bind, executed `index` through the real
  DataChannel/controller path, returned `e2e-project`, and left the Relay
  command broker at zero before and after a forced P2P failure. The same-Mac
  gate normalizes ICE candidate addresses to loopback to isolate Surge/mDNS,
  so it is not LAN/WAN/TURN/deployed connectivity evidence.
- Slice 4 validation: Relay build/tests 66/66, npm audit 0 vulnerabilities,
  focused Swift remote tests 65/65, full Swift tests 1100/1100 with the opt-in
  browser gate skipped by default, release build, and the explicit real
  Chrome/WK gate all passed. Server-side pending QR invalidation, exact active
  binding revocation, one signed absolute 24-hour peer lease, fail-closed
  legacy Keychain cleanup, exact QR grammar, and retained-ownership capacity
  bounds passed independent review.
- Independent security review: Done; accountless 256-bit fragment-only QR
  bootstrap accepted, silent server-readable Relay downgrade prohibited, TURN
  kept as a later explicit infrastructure boundary
- Package validation: Passed in the primary checkout; 1069 tests passed,
  production App is newer than every Slice 0 source, and deep strict codesign
  verification passed
- Live acceptance: Packaged Chrome echo passed with the sheet open, sheet
  closed, App minimized/inactive, and macOS locked after display sleep; full
  system sleep/wake and network-transition acceptance remain outstanding
