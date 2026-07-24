# Final fix — trailing newline ack bypass

**Date:** 2026-07-24  
**Branch:** `feat/sticky-task-bar`

## Issue

Whole-branch review (Minor): `isPinnable` checked `raw.contains(where: \.isNewline)` before blacklist on **untrimmed** text, so acks with a trailing newline (`"ok\n"`, `"继续\n"`, `"x\n"`) bypassed blacklist and ≤2-char rules.

## Fix

- `TaskPinLogic.isPinnable`: newline bypass now uses trimmed `display` — `display.contains(where: \.isNewline)`.
- Real multi-line tasks (e.g. `"看\n这个"`) remain pinnable; trailing-newline-only acks do not.

## Tests

- `TaskPinLogicTests.testNewlineOrImageIsPinnable`: `"x\n"` / `"ok\n"` / `"继续\n"` → not pinnable; `"看\n这个"` → pinnable.
- `swift test --filter TaskPinLogicTests` — all 9 passed.

## Scope

Logic + tests only; no `ChatDetailView` changes.
