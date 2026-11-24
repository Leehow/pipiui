# Browser Use Jev core

Pinned repository/commit and original file digests are in `vendor/upstream.json`.
MIT copyright is retained in `vendor/LICENSE`. No npm/Python package is fetched at
application startup. `scripts/fetch-jev-python.mjs` verifies the pinned standalone
Python archive at build time; the worker uses the standard library only.

## Maintained upstream patch

- `agent.py`: injectable Browser, choose and text functions. Original control flow,
  freshness checks, pending text reuse, execution history and progress checks stay intact.
- `browser.py`: optional CDP transport; pass it into the original browser operation
  function. Browser Harness imports become lazy. An injected browser attaches to an
  existing host-owned page and does not create/close targets or override its viewport.
- `model.py`: injectable HTTP requests; optional standalone httpx import becomes lazy.
  Original action space, questions, response validation and text-output parsing remain.
- `snapshot.js`, `questions.py`, `__init__.py` and LICENSE remain byte-identical upstream.

`worker.py` supplies host I/O, filters sensitive input targets, preserves the existing
consequential-action handoff, and returns bounded metadata rather than private snapshots.
`run.ts` owns cancellation/deadlines and request gating. Every browser call is scoped to
the same session/tab/viewport lease. Keys stay in the existing Jev extension or Pi model
registry; the child receives no credentials. The text transport omits provider-specific
output-limit parameters because the raw Pi completion interface does not execute the
main agent's request hooks (Flapcode rejects `max_output_tokens`).

`goal` optionally accepts `url`; open the target website before starting its control
loop. Upstream `done` is returned as `needs_verification`, with `verified:false`.
The caller still checks the actual page; no model self-report is a success oracle.

## Following upstream from Update Center

The owning extension declares `Browser Use Jev` with a `githubCommits` source for
`browser-use/jev-ultrafast` / `main`. Update Center compares full commits and checks
ancestry; it shows a change link and uses the existing **评估更新** flow. A branch
rewind/divergence is not offered as an ordinary upgrade. No release or PyPI package
is required, and raw upstream code is not silently installed into a running App.

From the PipiUI source checkout:

```sh
node Electron/scripts/sync-jev-upstream.mjs --check
# After reviewing/approving the result:
node Electron/scripts/sync-jev-upstream.mjs --apply
```

Check downloads into a disposable temporary directory, reapplies `adapter.patch`,
checks JavaScript syntax, and runs the candidate Python policy through an offline
form regression. It only stores the reviewed target and source identity in
`.pi/agent/jev-upstream-update/proposal.json`; it does not modify source. Apply uses
that exact target (not a newer branch head), repeats validation and refuses local
changes, then updates vendor and the Update Center pin together. Failed publication
restores the previous vendor tree. Credentials, the Electron adapter, and unrelated
manifest fields are outside the source replacement.

`vendor/upstream.json` records original and patched file hashes; the running engine
reads its commit from this receipt. After application, run the integration tests and
the approved canonical-App build/live acceptance. Patch conflicts or new upstream
dependencies require adapter review; they never cause an overwrite of the old version.
