# Remote control reliability

User-approved scope (2026-09-21): repair repeated empty/unusable remote opens and strengthen recovery across first load, network/host interruption, foreground return, and growing data. No promise of failure-free networks.

## Evidence and ownership

- Primary checkout, branch `0.1.0版本`, baseline `986381ee`; unrelated dirty work must remain intact. This task owns remote browser/relay fixes from the preceding turn. Existing host-api/backend changes concern experiment worktrees and compaction, not this task.
- Real public page at `remote.deepwood.cn` reproduced empty projects. Direct capabilities/listProjects succeeded (10 projects).
- Wire capture: global `listAgents` response 12,092,530 bytes triggered relay close 1009 at 8 MiB. Capture removed after metadata extraction.
- Reproduction: foreground/pageshow during pending claim creates three sockets. Initial scoped fixes: browser single-attempt guard; relay response/queue allowance 32 MiB for compatibility. 119 relay + 15 browser tests passed; not deployed.

## Acceptance and steps

1. Bound remote listAgents pages without losing full task/results or truncating stored data. Oversized unrelated responses must fail that request without killing the link.
2. Browser: cancel stale work, one active attempt, finite claim/socket/host handshake, online only after real host response, recover after foreground/network/host loss, preserve explicit replaced/expired semantics. Never replay mutations.
3. Desktop: finite connection/hello, detect silent sockets, reconnect same identity without overlapping loops. Relay tells browsers about host loss.
4. Test actual host-service → relay → browser API seam with growing payloads and disconnect/restart; focused UI lifecycle and timeout tests; relevant typechecks.
5. Prepare concrete artifacts and report required rollout authorization. User replied “做完你用computer use测试” to the concrete rollout proposal on 2026-09-21. This authorizes finishing the coordinated update and real canonical-App Computer Use acceptance, including the previously explained restart. Preserve unrelated source edits; package the current combined primary checkout.

## External checks

- React useEffect docs: cleanup must cancel/ignore stale async work, not share a resettable stop ref across generations: https://react.dev/reference/react/useEffect
- ws guidance: heartbeats need a missed-response deadline and forced retirement of dead connections: https://github.com/websockets/ws/blob/master/README.md
- Google AIP-158: bounded pages with runtime-owned continuation, rather than assuming list cardinality remains small: https://google.aip.dev/158

## Status

Completed: source, coordinated rollout, canonical App verification and actual public Computer Use acceptance.

- Remote-only listAgents paging keeps complete task/result rows. A real service/relay/API integration transferred 180 rows (~17 MiB) with each response below 1 MiB. A separate 9 MiB response returned response_too_large while later project reads succeeded on the same socket. The 32 MiB relay allowance is retained for old desktop clients during rollout; it is not the primary reliability fix.
- Desktop watchdog retires hung handshakes and half-open sockets without rotating identity; repeated start is idempotent and obsolete loops cannot clear a newer transport.
- Browser cancels old async generations, bounds claim/socket/host handshake, proves capabilities before showing connected, detects silent sockets, handles host loss and foreground/online events, and does not steal a connection marked replaced. Reconnect retains the App mount/draft and never replays mutations. Pending requests retire immediately with their transport owner.
- Relay host loss sends a recoverable close (1012); relay shutdown no longer claims another browser took over.
- 124 focused Electron/Host API/UI tests and 121 relay tests pass (245 total). Host API build, UI typecheck, scoped desktop remote source/test typecheck and browser production build pass. The broad Electron tsconfig also includes browser/runtime errors outside the edited seam; baseline equivalence was not checked, and this task does not claim that broad check is green.
- Real CUA browser exercised an isolated actual PiHostBackend → new desktop RemoteControlService → new Relay → production browser bundle. Fixture held 180 completed workers / 19,910,466 bytes persisted. Browser showed all 180; host transport drop and relay restart both recovered the same session and preserved an unsent draft. A remote session rename also round-tripped successfully. No model call was submitted.
- At the end of source-only verification the public service and canonical App were still unchanged; the authorized rollout and final acceptance below supersede that checkpoint. No commits. The old /tmp two-file install-reviewed hotfix script was marked superseded; do not use it for this coordinated rollout.

## Public acceptance follow-up

- User authorized completion and Computer Use testing. Canonical 0.0.139 installed, persistent PipiUI Dev identity verified, and 627 remote files deployed with checksum verification and rollback copy `/opt/pipiui-relay/backups/remote-reliability-20260922-075015`. First package attempt rolled back after canonical-path signature verification failure. The separate failed-directory recheck later proved to concern version 0.0.136, so it is not evidence about the new 0.0.138 candidate; the initial failure cause remains unconfirmed. Second attempt passed. Exact residual canonical PID 65375 required KILL after graceful/TERM waits; new PID 78805 verified.
- Actual public browser now loads projects/sessions, but startup exposed relay backpressure (`too many requests in flight (32)`). Added a WebSocket client queue capped at eight in-flight requests; 100-read burst and unsent-mutation cancellation regressions pass.
- Testing delayed host re-registration exposed a 403 response during relay restart being mistaken for final auth failure. Recovery grace now handles both 403 and 404 only for a previously verified connection; explicit replaced/expired still stop. Regression first failed as expected.
- The follow-up package and repeated acceptance were completed as recorded below; the earlier backpressure error is not treated as a passing run.

## Final delivery and Computer Use acceptance

- Installed canonical `build/PipiUI.app` version **0.0.140**, arm64, main PID **85730**, executable mtime **2026-09-21 19:55:36** (newer than final remote/browser/Host API changes). Strict deep codesign passes at the canonical path. Authority remains **PipiUI Dev**, designated leaf **108232C5A713C15A869FC4C267E18D2E35CD276C**. Core size 792 MB; bundled extensions 151 MB. The final overwrite retired exact canonical PID 78805 after graceful and TERM waits did not finish; no other product was signalled.
- Deployed 627 verified remote files. Rollback directory: `/opt/pipiui-relay/backups/remote-reliability-20260922-075629`. Packaged/public browser index SHA-256 both `8bc4ebd73c87783be55c808b96802c99081c547e976b67f13259adff6dd423f2`. Relay remains loopback-only; nginx/public domain configuration untouched. Final relay service active, healthz `{ok:true}`; post-recovery PID 1630161.
- Final regression coverage: **127 Electron/Host API/UI + 121 Relay = 248 passing tests**. Host API/UI typechecks and the actual package build pass.
- Computer Use operated the actual `https://remote.deepwood.cn` page connected to the installed App: initial project/session loading; new session creation; rename; exactly one prompt asking for `远控收发验证通过。`; observed that exact assistant reply.
- Then stopped the production relay for five seconds and started it again. The browser visibly showed `正在重新连接…`, automatically returned to the same session, retained the unsent draft, and still displayed `用户输入 1/1` with exactly one reply. After recovery, another rename succeeded. Cleared the test draft through keyboard input, reloaded the full page and observed the persisted session/reply with no loading/auth/backpressure error.
- The retained test conversation is **远控验收通过 2026-09-21**. The successful browser tab is retained for the user. No automatic replay or second model prompt occurred.
- Exact Trash registrations were unregistered; the only non-Trash product registration is the canonical App. All three task-owned `.electron-fast-*` staging directories are gone. A failed-directory artifact reports 0.0.136, outside the current run's expected 0.0.138 ownership, so its identity check prevented deletion and it was preserved. Temporary packet captures and isolated backend fixtures were removed earlier. Server upload staging was removed by the rollout script.
- No git commit, push, worktree adoption or unrelated source cleanup was performed. Packaging necessarily includes the current combined primary-checkout source as explained and authorized.

## Mobile layout follow-up (2026-09-22)

- User supplied an iPhone screenshot: connected session title/model visible, composer at top, empty history area. Reproduced on the real public page at 393×750. History articles existed in the DOM but `.message-list` measured **0 px**, `.pipiui-shell` only **175 px**, while the viewport/root were 750 px.
- Confirmed regression introduced by keeping the remote wrapper mounted for reconnection: its `min-height:100vh` did not give the inner percentage-height chat grid a definite height. Collapsed mobile overlays removed the incidental desktop sizing that had masked it. Earlier desktop-only acceptance was insufficient.
- Scoped repair in `Electron/packages/ui/src/app.css`: explicit 100% wrapper height, zero minimum/hidden overflow, a growing zero-basis App child, and a nonshrinking reconnect banner. No backend, message content, mobile privacy setting, App restart, or unrelated dirty-source change.
- Compared actual browser geometry before/after and verified banner space allocation in a local layout fixture at mobile, landscape and desktop widths. References checked: MDN height/containing-block rules and web.dev viewport sizing.
- Published the equivalent minimal CSS patch against the verified existing public bundle, preserving all other deployed code. Added `?v=mobile-height-20260922` to the stylesheet URL to request fresh CSS. Backup: `/opt/pipiui-relay/backups/mobile-height-20260922-181954`. CSS SHA-256 `1ff6502f135689e0cdd46298051e200a247735396a8d6e5bcb8530be7f4e0744`; index SHA-256 `c8a97f5dbc32ff6a7185a9a623c06574fc72b14ecd669bef739cedf04e955edf`.
- Computer Use then opened the user's actual **检查Pi版本升级** session on the public site: at 393×750 its visible history measured **574 px** and composer bottom **735 px**. Screenshot confirmed readable actual conversation text. At 430×932 history measured **786 px**; landscape 844×390 **214 px**; desktop 1280×800 **654 px**. Composer stayed within the viewport in every case. These are Chromium browser viewport checks, not a claim to have operated the user's physical iPhone/Safari.
- Native PipiUI was not repackaged or restarted for this web-only repair. Browser viewport overrides reset; temporary fixture page/server cleaned up. Existing real-app and server reliability fixes remain in place. No Git commit.
- The configured SSH SOCKS listener at localhost:7891 was absent. The same authenticated host was reached using a per-command HTTP CONNECT proxy override through localhost:6152; no persistent SSH/proxy configuration was changed.

## Compact phone tool rail (2026-09-22)

- User requested smaller top-right controls and default collapse. Scoped source change: phone float buttons 44→32 px; container padding reduced and moved to right:8px/top:56px; collapsed rail shows only its expand button rather than the active tool plus toggle. Missing/unreadable local preference defaults to collapsed; explicit user choices remain remembered. Desktop and drawer-header button sizes remain unchanged.
- Updated the existing rail behavior/layout tests; **5 focused tests pass**. This is a routine size/default adjustment; browser measurements and interaction checks were used instead of additional external research.
- Published only the corresponding two changes in the existing JS bundle and the phone CSS rule, preserving unrelated deployed code and the preceding message-height repair. Backup `/opt/pipiui-relay/backups/compact-rail-20260922-182949`; JS SHA-256 `7e87941f0ba4901c25d64fd2ee7bac5de62d51a099a4b835dd894d58fc197ca4`; CSS SHA-256 `54d08e669f9e65898a3ccc17697161bc29af7b4eaafd8deabe8c1cd14eac1ca6`. The stylesheet cache suffix is `compact-tools-20260922`; JS URL intentionally remains stable because lazy chunks import that shared module.
- Computer Use on the actual public page at 393×750: fresh reload showed only `展开工具快捷栏`; collapsed box measured **38×38** at x=347/y=56. Expanded box measured **174×38**, with five 32 px controls. Opened Subagents, closed the drawer, collapsed the rail again; all worked. Message viewport remained 574 px. Restored viewport override and kept the existing page for the user. No App/server restart, Git commit, or unrelated source cleanup.
