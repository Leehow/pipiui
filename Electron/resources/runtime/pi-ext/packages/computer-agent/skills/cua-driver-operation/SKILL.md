---
name: cua-driver-operation
description: Operate PipiUI's pinned Cua Driver through snapshot, semantic locate, coherent action batch, and fresh verification.
metadata:
  cua-driver-version: "0.20.0"
  upstream: https://github.com/trycua/cua/tree/main/libs/cua-driver/rust/Skills/cua-driver
---

# Cua Driver Operation

This private adaptation is pinned to Cua Driver 0.20.0. Use the exact pinned application/window target. `desktop_open_application` success already pins the exact window and brings it to the front: immediately call a fresh `desktop_observe`. Never use Command-Tab, Command-Shift-Tab, or the app switcher to locate or refocus that application. Observe before acting, prefer AX/semantic locators over pixels, batch coherent sequences, and obtain a fresh observation after consequential mutation. A timeout or driver error can mean unknown outcome: never repeat the mutation before observing.

Native macOS application menus are application-level AX surfaces and may be absent from the pinned content-window observation. Use one exact `desktop_act` action `{type:"invoke_menu",path:[<top-level menu>,<immediate child>,...]}`. Every path segment must be a literal live menu label; the Host keeps the call bound to the already-proven pinned PID and the driver fails closed on missing, ambiguous, disabled, or structurally mismatched segments. Never guess an outside-window coordinate for a menu bar or menu item.

Every state mutation consumes the current observation. Before any later click, scroll, key, typing, or other mutation, call `desktop_observe` with `fresh:true` and re-evaluate the returned UI. A mutation batch may contain only one state mutation; only a bounded wait may follow it in that same batch. `fresh_observation_required_after_mutation` is recoverable by observing, not by trying a different blind mutation.

When a fresh observation exposes an interactive `AXButton` and a same-name container or static text, call `desktop_locate` with the exact interactive role and name first, then click only the returned binding/token. A container, group, or static text is evidence, never an interactive substitute. When a blocking onboarding, modal, or interstitial exposes an explicit non-destructive continue button consistent with the goal, resolve and activate that button first, then fresh-observe before continuing. Never blind-scroll or send hotkeys around a blocking layer.

When a fresh observation proves the pinned application is in the wrong target state **and the task explicitly forbids every safe action needed to restore it** (for example, clicking, closing, reopening, or recovery), return exactly `{"outcome":"blocked","summary":"Target state requires manual restoration before retry.","recoveryDisposition":"manual_intervention","blockedReason":"target_state_mismatch","nextAction":"restore_target_state_manually"}`. This is a closed manual-intervention signal, not ordinary failure prose. Do not use it for a failed locator, missing text with an allowed recovery path, a transient driver error, or an untried safe alternative.
