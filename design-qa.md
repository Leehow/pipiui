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

---

# PipiUI Electron message actions, session rename, and brand spacing — visual QA

Date: 2026-08-12

## Sources and normalization

- Message-action source truth:
  `/var/folders/wn/8ly53x4n6sq3jkvkptvtkrsm0000gn/T/codex-clipboard-e72818d9-ebcc-44c5-99fe-7606032ceddd.png`
  - 1340 × 308 pixels; light theme, user-message hover state.
- Sidebar-rename source truth:
  `/var/folders/wn/8ly53x4n6sq3jkvkptvtkrsm0000gn/T/codex-clipboard-d11d4f2d-9f7f-4439-acd2-29c0043c33ab.png`
  - 528 × 536 pixels; light theme, selected sidebar session.
- Brand-spacing source truth:
  `/var/folders/wn/8ly53x4n6sq3jkvkptvtkrsm0000gn/T/codex-clipboard-440e9f58-3f20-44c2-aac9-68bf61a09f78.png`
  - 518 × 162 pixels; light theme, macOS traffic lights and wordmark.
- Packaged implementation screenshots:
  - Message actions: `/var/folders/wn/8ly53x4n6sq3jkvkptvtkrsm0000gn/T/com.openai.sky.CUAService/PipiUI Electron Screenshot 2026-08-12 at 11.28.08 PM.jpeg`
  - Header rename: `/var/folders/wn/8ly53x4n6sq3jkvkptvtkrsm0000gn/T/com.openai.sky.CUAService/PipiUI Electron Screenshot 2026-08-12 at 11.26.56 PM.jpeg`
  - Sidebar rename: `/var/folders/wn/8ly53x4n6sq3jkvkptvtkrsm0000gn/T/com.openai.sky.CUAService/PipiUI Electron Screenshot 2026-08-12 at 11.27.24 PM.jpeg`
  - Normal layout and brand: `/var/folders/wn/8ly53x4n6sq3jkvkptvtkrsm0000gn/T/com.openai.sky.CUAService/PipiUI Electron Screenshot 2026-08-12 at 11.27.29 PM.jpeg`
  - All implementation captures are 1229 × 768 pixels from the canonical signed Electron App after restart.
- Same-input focused comparison:
  `/Users/haoli/leehow/code/pipiui/.tmp/pipiui-session-actions-rename-brand-comparison.png`
  - 1200 × 500 pixels. Each source region is paired with the corresponding packaged implementation crop and normalized by row height.

## Full-view comparison

- The existing three-column hierarchy, transcript width, composer alignment, and titlebar height remain unchanged.
- The brand now has a safe left inset from the traffic lights while preserving the collapse control and search alignment.
- Both rename entry points stay in context: the sidebar edits in the selected row, and the header edits in the title position.

## Focused comparison

- Message actions: copy and resend now use the same 32 × 32 button component, 17 × 17 native SF Symbol assets, radius, hover treatment, focus treatment, and spacing.
- Sidebar rename: the pencil opens a clearly focused inline field without changing the row height or obscuring neighboring sessions.
- Header rename: double-click replaces the title with the same inline editor; the field is visually bounded and does not shift the branch or right-pane controls.
- Brand spacing: the wordmark keeps the supplied type treatment and cyan second `i`, with enough separation from the macOS traffic lights to read as a distinct titlebar item.

## Findings and comparison history

1. Initial packaged visual inspection confirmed the unified message controls, sidebar editor, and improved wordmark spacing.
2. Live interaction inspection found that the header title was still inside Electron's draggable region, so macOS consumed the double-click even though DOM tests passed.
3. The title label was moved into a `no-drag` region, the canonical App was rebuilt and restarted, and a fresh double-click capture showed the editable title field.
4. Fresh Computer Use checks also opened the sidebar editor from the real pencil button and exposed both message actions in the hover state.
5. The final combined comparison found no remaining actionable P0, P1, or P2 visual differences.

## Interaction and regression checks

- Sidebar pencil: opens the inline session-name field in the canonical App.
- Header title: double-click opens the inline session-name field in the canonical App; Escape cancels.
- Message actions: copy and resend are present as distinct accessible buttons inside one `消息操作` toolbar.
- Manual title persistence is covered through the host transport and backend JSONL persistence tests.
- The canonical App is signed, arm64, 539 MB, and was restarted from the final package.

final result: passed

---

# PipiUI Electron sidebar brand wordmark — visual QA

Date: 2026-08-12

## Sources and normalization

- Full-layout source truth:
  `/var/folders/wn/8ly53x4n6sq3jkvkptvtkrsm0000gn/T/codex-clipboard-351fc710-b6cc-434c-8803-f4cc45206bf8.png`
  - 2578 × 1600 pixels; light theme, sidebar expanded, macOS traffic lights visible.
- Brand source truth:
  `/var/folders/wn/8ly53x4n6sq3jkvkptvtkrsm0000gn/T/codex-clipboard-36ae8c00-913d-4c59-a247-3ec845f6b070.png`
  - 142 × 66 pixels; `Pipi UI` wordmark with only the second `i` in cyan.
- Packaged implementation screenshot:
  `/Users/haoli/leehow/code/pipiui/.tmp/pipiui-brand-implementation.jpeg`
  - 1229 × 768 pixels at the native Computer Use capture size; light theme,
    sidebar expanded, canonical signed Electron App after restart.
- Focused same-input comparison:
  `/Users/haoli/leehow/code/pipiui/.tmp/pipiui-brand-comparison.png`
  - 200 × 50 pixels; source at left and packaged implementation at right.
  - The 142 × 66 brand source was normalized to 71 × 33 to account for its
    2× reference density before comparison with the 1× implementation capture.

## Full-view comparison

- The wordmark occupies the previously empty region between the macOS traffic
  lights and the left-pane collapse control without shifting either control.
- The topbar remains 50 CSS pixels high and preserves its existing divider,
  drag region, sidebar width, and search/list spacing.
- No new image or icon asset was needed because this is editable product-name
  text rather than a pictorial logo.

## Focused comparison

- Fonts and typography: the system sans-serif, compact bold weight, tight
  tracking, and baseline match the supplied wordmark at normalized density.
- Spacing and layout rhythm: the logo is vertically centered and fits inside
  the titlebar without crowding the traffic lights or collapse control.
- Colors and visual tokens: all letters inherit the normal strong foreground;
  only the second `i` uses cyan (`#13b8d3`).
- Image quality and asset fidelity: text remains sharp at native scale; there
  are no raster-scaling artifacts or substitute glyphs.
- Copy and content: visible copy is exactly `Pipi UI`; the accessible label is
  `PipiUI`.

## Findings and comparison history

1. Initial packaged capture was still the pre-restart process and did not show
   the brand; the canonical App was quit normally and relaunched.
2. The post-restart capture displays the new wordmark and its cyan `i` in the
   intended titlebar slot.
3. The focused normalized comparison found no actionable P0, P1, or P2 visual
   differences. No further visual correction was required.

## Interaction and regression checks

- The existing “收起左栏” control remains present and accessible.
- Sidebar rendering tests: 41 passed.
- macOS hiddenInset titlebar test: 1 passed.
- The canonical App is signed, arm64, and its binary is newer than the changed
  sidebar source files.

final result: passed
