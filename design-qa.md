# PipiUI Computer Use sidebar button — visual QA

Date: 2026-07-26

## Sources

- Reference screenshot:
  `/var/folders/wn/8ly53x4n6sq3jkvkptvtkrsm0000gn/T/codex-clipboard-03d07eb9-ce01-44a6-b86c-efd8496c8370.png`
  - 608 × 578 pixels
  - State: sidebar open; Settings gear visible alone in the bottom bar
- Packaged implementation screenshot:
  `/var/folders/wn/8ly53x4n6sq3jkvkptvtkrsm0000gn/T/com.openai.sky.CUAService/PipiUI Screenshot 2026-07-26 at 2.42.37 PM.jpeg`
  - 1091 × 768 pixels at native capture size
  - Sidebar width: approximately 263 pixels
  - State: desktop control enabled; live `open_application` flow completed with “Chrome 已打开”
- Same-input comparison:
  `/var/folders/wn/8ly53x4n6sq3jkvkptvtkrsm0000gn/T/pipiui-sidebar-final-comparison-20260726.png`
  - Reference on the left; packaged implementation sidebar on the right

## Full-view comparison

- The existing sidebar hierarchy, project rows, spacing, typography, and bottom
  bar remain consistent with the supplied reference.
- The Computer Use control is placed immediately to the right of the Settings
  gear, matching the requested location without moving or obscuring the
  existing control.
- The enabled state uses the app accent color and a restrained rounded
  background, so it is visible without adding a labeled row or cluttering the
  project list.
- The bottom controls remain inside the sidebar safe area with adequate padding
  and no clipping at the captured window size.

## Focused interaction checks

- Accessibility identity: `desktopcomputer`
- Off state: “开启桌面控制”, value “已关闭”
- On state: “关闭桌面控制”, value “已开启”
- Clicking the control off and on updated the visual and accessibility states
  correctly.
- The packaged live test used the on state to open Google Chrome without a
  session authorization prompt or an ordinary application authorization
  prompt.

## Findings history

1. Initial packaged inspection confirmed the requested button placement and
   toggle behavior.
2. Live testing exposed a transient ScreenCaptureKit application/window
   enumeration race; the implementation was revised to use bounded, fully
   revalidated readiness retries.
3. The authorization flow was revised so the bottom button is the one-click
   ordinary-app authorization. Maintained high-risk targets ask the user rather
   than being categorically denied.
4. Final packaged comparison and live Chrome flow passed.

final result: passed
