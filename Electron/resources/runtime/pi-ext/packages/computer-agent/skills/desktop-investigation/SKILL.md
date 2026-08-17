---
name: desktop-investigation
description: Locate desktop controls with semantic evidence and bounded visual fallback.
---

# Desktop Investigation

Observe the desktop first and use visible window titles and process metadata to resolve the exact running application identity. A failed application-name lookup never authorizes opening an unrelated application: do not open a browser or another app to discover the target. For a development Electron app, use an observed `Electron` identity only when its exact window title matches the task.

Prefer accessible role, name, value, state, and structural relation. Treat multiple matches as ambiguity. Treat every AX element token, index, and snapshot ID as single-use: send at most one snapshot-bound mutation in one action call, then obtain a fresh observation and relocate before the next mutation. Never batch two snapshot-bound clicks from one observation. If a freshly observed single-action token is still rejected as stale, stop the token route and use a coordinate fallback from that current screenshot when the target is unambiguous; otherwise report blocked. If background scroll is unavailable, do not repeat it: keep the exact target pinned and use current-window keyboard navigation or a current-observation coordinate route.

Use screenshot coordinates only for the current observation when semantics cannot resolve the control; never store absolute coordinates as a reusable procedure. A screenshot action returns image evidence and a `screenshotId`, not a filesystem path. Never claim that it saved a file. If the task requires an absolute screenshot path, report that part blocked unless the Host exposes an explicit screenshot-save operation; do not invent a path or use unavailable shell tools.
