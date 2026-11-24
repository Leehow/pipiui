# Jev upstream browser integration

## Approved outcome

Reuse Browser Use jev-ultrafast's complete Python control core (pinned upstream commit
1231850a0bf1a0c0341fe408ef1668dbbfdfac46), with a small maintained injection patch,
and target PipiUI's built-in Electron browser. Reuse saved project Jev credentials
and the existing text-model configuration. Package the runtime; verify in the
canonical App with ordinary human task prompts.

## Scope and ownership

Primary checkout, current shared branch `0.1.0版本`, baseline 986381ee. Preserve all
existing dirty work, including browser-host/tab changes owned by remote-control
work and the preceding Jev save-status UI changes. No commit/push/deploy requested.
Own only upstream vendoring/adapter, Choice integration, Python packaging, relevant
tests and this plan. Keep ordinary browser tools, Score, and project isolation.

## Acceptance

- Original control semantics retained: complete observed state, freshness guards,
  post-action observation, stale recovery, pending text reuse and progress checks.
- Credentials never need a second user configuration and never enter logs.
- Built-in WebContents only; browser ownership stays with the current session/tab.
- Natural-language form task fills text and selects Two without submission.
- Natural-language link task reaches IANA and does not fail merely during navigation.
- Relevant tests, signed canonical package and actual UI outcomes are distinct gates.

## Steps

1. Pin upstream source/license, identify exact injection patch and transport contract.
2. Implement Electron browser adapter and Python worker bridge with cancellation.
3. Connect existing Jev authority and full text-provider request handling.
4. Bundle Python runtime; build and test real integration seams.
5. Package canonical App and run natural-language acceptance; record evidence.

## Current evidence

Before replacement, App 0.0.141: Score succeeded (18 candidates, 690 ms), while
Choice text calls failed; navigation could execute and still return browser_navigating;
SELECT could repeat after success. Logs: `.pi/agent/sessions/2026-09-22T01-14-52-306Z_f2161b60-1265-42d8-898a-129acc231340.jsonl`.
Source research confirms Electron debugger can target the existing WebContents and
upstream Agent needs explicit browser/model transport injection.

## Implementation progress

- Vendored original Agent/browser/model plus unchanged snapshot/questions at the pinned commit.
  Small injection patch documented beside source; Python worker has no credentials or external packages.
- Electron adapter holds one existing WebContents lease; CDP stays in-process, scoped to that pane.
- Existing Jev authority handles upstream Choice payloads; text uses current Pi auth and original
  upstream prompt/parser. Removed the raw completion's incompatible max-output-token injection.
- Pinned Python 3.12.14 standalone (20260901) and SHA-256 for four shipped targets; macOS Python
  gets stable signing and a post-signing startup check. Actual host archive is 66 MiB extracted.
- 260 focused Vitest cases pass, including a real Python subprocess through original snapshot,
  production Jev transport/validation with fake HTTP, current-value-driven selection, cancellation,
  authorization revocation, browser compatibility and packaging. Scoped new TS files typecheck.
- Broad Electron tsc also includes pre-existing test/import/assets errors; not claimed green.
- Canonical App 0.0.142, stable PipiUI Dev signing and signed Python startup passed.
  Core 793 MiB; bundled extensions 220 MiB (including standalone Python).
- Live natural-language form task passed: TYPE_TEXT + SELECT, 3 decisions, 9,195 ms,
  one text-model call. Native UI independently showed `Jev browser test` / `Two`, unsubmitted.
- Live natural-language link task passed: one CLICK, 2 decisions, 2,219 ms, IANA page
  independently confirmed. Both return needs_verification rather than navigation failure.
  Evidence: preceding session JSONL lines 49 and 57 (same session named above).
- Final background-focus/time-bound cleanup additions pass 10 targeted tests; final
  packaging and another stateful natural-language task remain before closeout.
- Final packaging collided with the user's Grok catalog update task
  `01a0c6e1-064b-7563-ac16-9c36a581b79f`. That task now owns the sole final package/install;
  this task must not quit, replace or relaunch the App until its owner hands UI control back.
  We sent the source/test/runtime handoff and are waiting for final version/PID/signature.
  Current canonical is 0.0.142; failed/staged artifacts belong to the coordinated installer.
- Coordinator delivered final **0.0.145**, PID **12798**, stable PipiUI Dev signature,
  arm64, core 793 MiB / extensions 220 MiB. Independently verified all eight vendored
  runtime/adapter file hashes match source, binary is newer than source, no staging residue.
  UI ownership was handed back. Final checkbox task is not submitted yet: CUA can read
  the window but input returns clipboard timeout / noWindowsAvailable. Asked user to
  foreground PipiUI and select `Jev网页表单填写`; do not replay a potentially submitted prompt.
  Last successful actual task is still the 0.0.142 link run at JSONL line 57.

## Approved follow-up: upstream Update Center tracking

User requested and approved adding upstream tracking and a controlled update flow.
Update Center now supports `githubCommits`, validates commit identity/ancestry and
passes exact source/revisions through the existing evaluation intent. Browser Use
Jev is declared as its own component. `sync-jev-upstream.mjs --check/--apply` replays
the maintained patch, validates the candidate core, pins a review proposal, guards
local edits and rolls back failed source publication. It never updates credentials.
Initial targeted checks: 58 tests passed; actual --check fetched the pinned upstream,
applied the patch and passed candidate validation without updating source. Build,
broader update-engine compatibility and packaged UI verification remain pending.
