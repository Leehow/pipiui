# Computer Use Landscape — August 2026

Date: 2026-08-28
Scope: how modern projects let an AI agent observe and drive a GUI (screenshots + mouse/keyboard), with a deep dive on the browser-use team's Computer Use line. Sources are primary (repos, official docs, vendor blogs); every load-bearing claim carries a URL.

## 1. TL;DR

- **browser-use's Computer Use is a "thin harness", not an agent loop.** Their new [`macos-harness`](https://github.com/browser-use/macos-harness) (repo created 2026-08-17) and [`windows-harness`](https://github.com/browser-use/windows-harness) (2026-08-23) ship **six primitives — `see`, `key`, `type`, `click`, `ax`, `script` — inside one persistent Python process**, plus their existing Browser Harness (CDP) for anything inside Chrome. There is no framework, no per-app tools, no agent loop; a coding agent (Claude Code / Codex) writes Python against the primitives and *writes any missing helper itself mid-task* — the published rationale is [The Bitter Lesson of Agent Harnesses](https://browser-use.com/posts/bitter-lesson-agent-harnesses): "your helpers are abstractions too. Delete them."
- **Observation is per-window, not full-screen.** On macOS they shell out to `/usr/sbin/screencapture -l <window_id>` to capture one background window *without raising it*, downscale to ≤1280×1280, and return the scale factors; a click-through virtual pointer (separate AppKit overlay process) is drawn into the screenshot so the model sees where "its" cursor is. Input goes to a **PID** via `CGEventPostToPid` — the physical cursor and foreground focus are never touched, and a `FocusChangedError` halts the burst if a background-targeted action accidentally foregrounds the app ([macos.py](https://github.com/browser-use/macos-harness/blob/main/src/macos_harness/macos.py)).
- **Computer use is NOT a fallback for DOM targeting — it's the layer around the browser.** Their own SKILL.md instructs: "Do not substitute AX for CDP inside a web page." Web work stays on CDP (Browser Harness); pixels/AX handle native and cross-app work ([SKILL.md](https://github.com/browser-use/macos-harness/blob/main/skills/macos-harness/SKILL.md)).
- **The market has converged on the same skeleton**: model sees a screenshot (often plus an AX/DOM tree), emits a *batch* of primitive actions, environment executes them in order, fresh screenshot goes back. Anthropic formalized this as the 17-member [`computer_toolset_20260801`](https://docs.anthropic.com/en/docs/agents-and-tools/computer-use) with in-order batch semantics and a fixed "halt text" for skipped actions; OpenAI's GA [`computer` tool](https://platform.openai.com/docs/guides/tools-computer-use) in the Responses API returns a batched `actions[]` array per `computer_call`.
- **For web-shaped work, pixels lose to structure.** The [Odysseys leaderboard](https://odysseysbench.com/leaderboard) separates CUA (screenshot→GUI), Hybrid (screenshot+structured browser tools), and Terminal (drive the browser by writing code) agents: the top spots are Hybrid (Skyvern, 98.1 rubric avg) and Terminal (browser-use's own BrowserCode, 96.8); the best pure CUA is Claude Opus 4.6 at 68.9. Computer use earns its keep on *native* apps and cross-app gaps, not as a browser substitute.
- **For PipiUI (already has Playwright/CDP + a Cua Driver desktop runtime):** the evidence supports the existing routing ladder (app lifecycle → AX/shortcuts → pixel coordinates last). The portable deltas to steal: burst-then-verify discipline, per-action proof screenshots, text-entry escalation with read-back verification, explicit screenshot token budgeting (≤20 images, prune in batches), and a full-resolution sub-region capture (`zoom`-style) primitive.

## 2. browser-use Computer Use deep dive

### 2.1 What actually shipped, and when

The browser-use org's computer-use surface is a family of small repos rather than one product:

| Repo / surface | What it is | Evidence |
|---|---|---|
| [`browser-use/macos-harness`](https://github.com/browser-use/macos-harness) | "The simplest, thinnest harness that gives an LLM complete freedom to control a Mac." Created **2026-08-17**, ~800 stars in 11 days | [repo metadata](https://github.com/browser-use/macos-harness), [README](https://raw.githubusercontent.com/browser-use/macos-harness/main/README.md) |
| [`browser-use/windows-harness`](https://github.com/browser-use/windows-harness) | Same idea for Windows 10 1809+/11. Created 2026-08-23; "architecture ported from [trycua/cua](https://github.com/trycua/cua), MIT" | [README](https://raw.githubusercontent.com/browser-use/windows-harness/main/README.md) |
| [`browser-use/desktop`](https://github.com/browser-use/desktop) | Desktop app: "run a team of browser agents on your desktop"; ports cookies into a fresh Chromium, built on Browser Harness | [README](https://raw.githubusercontent.com/browser-use/desktop/main/README.md) |
| [`browser-use/bux`](https://github.com/browser-use/bux) | 24/7 box with Claude Code + Browser Harness, driven from Telegram/web/SSH | [repo](https://github.com/browser-use/bux) |
| Cloud "Computer Use" surface | Mentioned in the [2026-07-17 changelog](https://browser-use.com/changelog): "GLM and MiniMax are now available natively on Computer Use and Browser Use" — i.e. their hosted model gateway serves computer-use-capable models alongside browser models. No public API docs for a managed desktop VM product were found in `docs.browser-use.com` as of 2026-08-28 | [changelog](https://browser-use.com/changelog) |
| [`browser-use/macOS-use`](https://github.com/browser-use/macOS-use) (`mlx-use`) | The 2025 predecessor: a full agent loop over the macOS AX tree with per-element `highlight_index`, AXPress/AXValue actions, pyautogui fallbacks. Superseded in spirit by macos-harness | [README](https://raw.githubusercontent.com/browser-use/macOS-use/main/README.md), [element.py](https://github.com/browser-use/macOS-use/blob/main/mlx_use/mac/element.py) |

The design manifesto is [The Bitter Lesson of Agent Harnesses](https://browser-use.com/posts/bitter-lesson-agent-harnesses) (Gregor Zunic, 2026-04-19): they deleted thousands of lines of element extractors/click wrappers down to ~600 lines (`run.py` + `helpers.py` + `daemon.py` + `SKILL.md`), because "LLMs know CDP… Every `click()`, `type()`, `scroll()` helper is an abstraction you decided the model needs." macos-harness applies the same lesson to the desktop.

### 2.2 Architecture: one persistent Python process, six primitives

The whole product is a CLI that runs **stdin Python programs in one persistent process** with `mac`, `browser`, `Path`, `subprocess` preloaded:

```python
frame = mac.see("Spotify")          # per-window screenshot, background-safe
mac.key("cmd+k", app="Spotify")     # CGEvent keyboard chord to the app PID
mac.type("Alessia Cara", app="Spotify")
mac.click(640, 420, app="Spotify")  # coordinate click, screenshot-space

item = mac.ax.at(640, 420, app="Spotify")   # AX hit-test at those coords
mac.script('tell application "Spotify" to play')  # Apple Events escape hatch
```

There are deliberately **no app-specific tools**: "There are no Spotify tools, Slack tools, or Final Cut tools. The model gets raw primitives and writes the rest" ([README](https://raw.githubusercontent.com/browser-use/macos-harness/main/README.md)). Dependencies are minimal: `pillow`, `pyobjc-framework-ApplicationServices`, and `browser-harness` ([pyproject.toml](https://raw.githubusercontent.com/browser-use/macos-harness/main/pyproject.toml)).

### 2.3 Observation: background per-window capture + tracked scale + virtual pointer

From [src/macos_harness/macos.py](https://github.com/browser-use/macos-harness/blob/main/src/macos_harness/macos.py):

- **Capture**: `capture_screenshot()` enumerates the app's layer-0 windows via `CGWindowListCopyWindowInfo` (filters <40×40 px, sorts on-screen first), then runs `/usr/sbin/screencapture -x -o -l <window_id>` — macOS's own tool, which renders a window **even when occluded or on another space, without raising it**.
- **Downscale**: `see()` resizes to fit 1280×1280 (LANCZOS) and returns `scale_x`/`scale_y` alongside the window `bounds`, so every downstream coordinate can be mapped exactly back to screen points. Handles Retina's 2× factor implicitly via the measured PNG size vs. point bounds.
- **Virtual pointer**: the harness never moves the real cursor. `LivePointerOverlay` is a **separate disposable AppKit helper process** fed JSON commands over stdin that draws an animated, click-through pointer window ([overlay.py](https://github.com/browser-use/macos-harness/blob/main/src/macos_harness/overlay.py)). `see()` *draws that pointer into the returned image* so the model can see where its last action landed — a cheap self-verification cue.
- **Focus state in every frame**: each `see()` result embeds `focus: {frontmost, target_is_frontmost}` so the model can tell whether the world matches its assumption without a separate query.
- **AX tree on demand**: `get_app_state()` (aliased `snapshot`) walks the app's AXUIElement tree (batched `AXUIElementCopyMultipleAttributeValues` reads, depth ≤25, ≤5000 nodes), renders an indented text tree with `element_index`, role/title/value/frame, supported `actions`, and `settable` attributes. It sets `AXEnhancedUserInterface=1` on the app root first — required for Chromium/Electron apps to expose their full tree. `ax_search()` uses Apple's `AXUIElementsForSearchPredicate` parameterized attribute (fast path for virtualized Chromium/WebKit content) with a bounded tree-walk fallback when unsupported. `ax.at(x, y)` does an **AX hit-test** (`AXUIElementCopyElementAtPosition`) — the bridge from "I see a button at (640,420)" to "element_index 73 supports AXPress".

### 2.4 Action: PID-targeted CGEvents, honest timing, focus guard

- **Delivery**: all input is created against a private `CGEventSource` (`kCGEventSourceStatePrivate`) and posted **to the target PID** via `CGEventPostToPid` — not to the session event tap — so the app receives input without being activated. `click()` posts down/up with 30 ms gaps and per-click `clickState` for double/triple clicks; `drag()` interpolates 12 steps over ~250 ms.
- **Coordinate spaces**: every coordinate primitive takes `coordinate_space` = `screenshot` (default — the pixel space of the image the model actually saw), `window`, or `screen`. `_screen_point()` converts screenshot→window→screen using the stored `scale_x/scale_y` and bounds. This is the same "coordinates are in the pixels of the image you returned" discipline Anthropic documents.
- **Typing non-ASCII**: `type()` emits per-character key events and sets the character via `CGEventKeyboardSetUnicodeString` — so arbitrary Unicode (CJK, emoji) lands regardless of keycode layout; a `_SHIFTED_CHARACTERS` table handles shifted punctuation. `key()` parses `cmd+shift+g`-style chords and stages modifier flags in order. ~10 ms per character.
- **Scrolling**: `scroll()` splits large deltas into exact ≤100 px (or ≤10 line) steps posted 10 ms apart — "small exact steps accepted reliably by apps" — and can target a point.
- **Safety invariant**: every input op snapshots the frontmost app before acting and calls `_guard_focus()` after each sub-event; if the background-targeted app became frontmost, it raises `FocusChangedError` and stops the burst. The SKILL.md makes it a hard rule: "never manipulate focus to restore it."
- **Browser handoff**: `browser.*` lazily connects their Browser Harness (CDP) to the *real, logged-in* Chrome; a watcher thread auto-approves Chrome's "Allow remote debugging?" sheet by AX-hit-testing for an `AXButton` with description "Allow" inside that specific window ([browser.py](https://github.com/browser-use/macos-harness/blob/main/src/macos_harness/browser.py)). No mouse events are synthesized for this.

### 2.5 Windows-harness: the honest-delivery counterpart

Windows has no `CGEventPostToPid` equivalent, so [windows-harness](https://raw.githubusercontent.com/browser-use/windows-harness/main/README.md) is explicit about trade-offs:

- **Capture**: `PrintWindow` screenshots — background, occluded, and minimized windows without raising them.
- **Two delivery modes, honestly labeled**: `foreground` (default) fronts the target and uses SendInput, **holding the foreground across a burst of actions** until `win.release()`; `background` (opt-in) uses synthetic-pen injection / `PostMessage` where the app's framework accepts it. Rationale given: "focus-driven UI (suggestion popups, menus, IME candidates) closes the moment its window loses the foreground, and CEF/XAML input stacks only accept input while truly foreground."
- **Refuse what doesn't work**: a class-name matrix (extensible from locally observed drops) detects frameworks that silently drop background events and returns a structured `BackgroundUnavailable` error "instead of pretending." `doctor` probes whether SendInput survives the machine's hook software (`input_health`), and UIPI integrity-level blocks are reported, not fought.
- **Typing escalates three ways**: UIA `set_value` *verified by read-back* → foreground Unicode input → clipboard paste ("the route that still lands when hook software swallows every injected keystroke").
- **Proof screenshots**: every coordinate primitive stamps an action-proof image — circle-cross reticle for clicks, arrow for scrolls, line for drags — returned at `result["proof"]["path"]` "so an agent can check a mis-landed point."

### 2.6 Recommended usage patterns (their SKILL.md, verbatim rules that matter)

[skills/macos-harness/SKILL.md](https://github.com/browser-use/macos-harness/blob/main/skills/macos-harness/SKILL.md) is the behavioral half of the product:

- **One CLI call per decision point, not per primitive.** "Bundle deterministic, reversible steps into one program, then verify once… Stop at a genuine decision boundary: ambiguous identity, new coordinates, an irreversible action, or unexpected state."
- **Don't over-screenshot.** "Do not screenshot merely to confirm that a known shortcut opened a text field before typing. Let the final screenshot verify the whole sequence." Poll exact AX/Apple Events state *inside the same Python program* instead of LLM round-trips.
- **Mode ladder**: (1) inspect local context for identity, (2) `mac.script()` for a known exact focus-safe command, (3) `see()` + vision, (4) keyboard route before coordinates, (5) targeted `ax` only when semantic identity matters — "Do not dump a full AX tree before trying the direct route."
- **Failure discipline**: "After a failed verified burst, switch mode or stop. Never repair uncertainty with repeated keys, clicks, deletion loops, or bulk input."
- **Cheap strong end-state check**: one screenshot for visible state *or* one exact AX/API query for semantic state; both only when they prove different things.

### 2.7 Models, benchmarks, sandboxing

- **Model-agnostic by construction**: the harness ships as an installable *skill* for Claude Code / Codex; the "model" is whichever coding agent drives the CLI. Their cloud changelog lists GLM/MiniMax as "available natively on Computer Use and Browser Use" ([changelog](https://browser-use.com/changelog)), i.e. they resell computer-use-capable models on their gateway.
- **Benchmarks**: browser-use publishes browser-agent numbers only — [98% on 300 live Online-Mind2Web tasks](https://browser-use.com/posts/online-mind2web-benchmark), #1 on [Odysseys](https://odysseysbench.com/leaderboard) (their Terminal-style BrowserCode entry: 96.8 rubric avg with GPT-5.6 Luna). **No public OSWorld/WindowsAgentArena number exists for macos-harness/windows-harness** as of 2026-08-28 — treat the desktop capability as unmeasured by third parties.
- **Sandboxing: none.** It drives the user's real Mac with the user's apps and logged-in browser; the guardrails are TCC permissions (accessibility / screen recording / event posting, inspectable via `macos-harness doctor` without prompting), the focus guard, and the never-raise/never-move-cursor invariants. Anonymous telemetry is on by default (command category/success/duration only) with `macos-harness telemetry disable` ([README](https://raw.githubusercontent.com/browser-use/macos-harness/main/README.md)).

## 3. Other projects' approaches

### 3.1 Anthropic — computer use tool + reference sandbox

[Docs](https://docs.anthropic.com/en/docs/agents-and-tools/computer-use) (current toolset `computer_toolset_20260801`, GA without beta header as of 2026-08; predecessors `computer_20251124`/`computer_20250124` remain in beta):

- **Interface**: 17 member tools — `screenshot`, `zoom` (full-resolution sub-region capture; coordinates afterwards still in full-screenshot space), click variants with optional modifier `text`, `left_click_drag`, `left_mouse_down/up`, `mouse_move`, `scroll`, `type`, `key` (with `repeat`), `hold_key`, `wait`, `cursor_position`. Schema-less; the schema is "built into the model."
- **Batch actions**: Claude returns several member calls in one turn; the harness runs them **in order**, stops at the first failure, and answers every skipped block with the fixed text `"Not executed: an earlier computer action in this turn failed."` — Claude then replans. If a batch doesn't end with `screenshot`, the harness may attach one anyway to save a round trip.
- **Coordinates**: always in the pixel space of the screenshots you return; if you downscale, scale back before applying. Recommended display sizes 1024×768–1366×768, avoid >1920×1080; images must fit ~1568 px long edge / ~1.15 MP (the API rejects oversized `tool_result` images — resizing is your job).
- **Context budget**: screenshots cost ~1,000–1,800 input tokens each; past 20 images per request a stricter per-side limit kicks in. Guidance: keep ≤20 images, prune old screenshots **in batches** (e.g. keep last 3, prune every 25 turns) so prompt-cache prefixes stay byte-identical.
- **Reference environment**: Docker + Ubuntu 22.04 + Xvfb + Mutter + Tint2 + xdotool/scrot + noVNC ([computer-use-demo Dockerfile](https://github.com/anthropics/claude-quickstarts/blob/main/computer-use-demo/Dockerfile); note the repo was renamed anthropics/anthropic-quickstarts → anthropics/claude-quickstarts). The demo's [computer.py](https://github.com/anthropics/claude-quickstarts/blob/main/computer-use-demo/computer_use_demo/tools/computer.py) scales to XGA/WXGA/FWXGA targets, types in 50-char chunks with 12 ms delay, and implements `zoom` as crop+resize via ImageMagick.
- **Safety**: automatic prompt-injection classifiers on screenshots steer the model to ask for confirmation (opt-out via support); docs push sandboxing, least privilege, and ZDR eligibility (client-side tool; screenshots live in your environment).
- **Claude Cowork** ([help center](https://support.claude.com/en/articles/14128542-let-claude-use-your-computer-in-cowork), research preview on macOS since 2026-01): computer use on the *real* desktop with **no sandbox**, but per-application permission prompts and a documented tool-ordering rule: "Claude uses the most precise tool first" — connectors/APIs before screen navigation.

### 3.2 OpenAI — CUA model, Responses `computer` tool, Codex desktop

[Tools: Computer use guide](https://platform.openai.com/docs/guides/tools-computer-use):

- **GA shape**: `tools=[{"type":"computer"}]` with GPT-5.x models; the deprecated `computer-use-preview` mapping is documented (one action per call → batched `actions[]`, `truncation:"auto"` no longer needed). Action space: `click`, `double_click`, `scroll`, `type`, `wait`, `keypress`, `drag` (path), `move`, `screenshot`, plus a `keys[]` modifier array on mouse actions.
- **Loop**: screenshot-first turns are normal; run the returned batch in order; return one `computer_call_output` containing a fresh `computer_screenshot`. Recommended `detail:"original"` (no resize — better click accuracy); when downscaling is needed they observe "strong performance with 1440×900 and 1600×900."
- **Three harness shapes**, explicitly supported: (1) the built-in loop, (2) your own Playwright/Selenium/VNC/MCP harness exposed as ordinary tools, (3) a **code-execution harness** — "gpt-5.4 and future models are explicitly trained" to mix visual and programmatic (DOM) interaction in a REPL. This is the browser-use "bitter lesson" arriving from the model side.
- **Confirmation taxonomy worth stealing wholesale**: only direct user instructions count as permission; on-screen text is untrusted; confirm *at the point of risk* (not at task start); typing sensitive data counts as transmission; hand-off (not just confirm) for password changes and bypassing safety barriers; CAPTCHA solving always confirms.
- **Codex desktop app**: ["background computer use"](https://openai.com/index/codex-for-almost-everything/) (2026-04) — Codex "can use all of the apps on your computer by seeing, clicking, and typing with its own cursor. Multiple agents can work on your Mac in parallel, without interfering with your own work" — same virtual-cursor/background-input direction as macos-harness.

### 3.3 Open Interpreter

- **Classic (Python, now community-maintained at [endolith/open-interpreter](https://github.com/endolith/open-interpreter))**: OS mode = `interpreter --profile os`, provider-agnostic via LiteLLM + a `computer.*` module (screenshot/mouse/keyboard, pyautogui-style); the old `--os` flag ran a deprecated Anthropic-demo integration.
- **Current (Rust rewrite, [OpenInterpreter/open-interpreter](https://github.com/OpenInterpreter/open-interpreter))**: pivoted to a Codex-fork coding agent; "Computer Use" is a **QA skill** that drives web apps via [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) and native apps via [trycua/cua](https://github.com/trycua/cua). Notable as an existence proof: coding-agent + skill + external driver is now the mainstream packaging.

### 3.4 Self-Operating Computer (OthersideAI, 2023 — the archetype)

[Repo](https://github.com/OthersideAI/self-operating-computer): the original pure-vision loop — full screenshot in, mouse/keyboard out (pyautogui), model-agnostic (GPT-4o/Gemini/Claude/Qwen-VL/LLaVa). Two grounding aids that became folklore: **OCR mode** (default) — OCR the screen, give the model a text→coordinate hash map, let it "click by text"; and **SoM mode** — a fine-tuned YOLOv8 labels buttons with IDs on the image ([set-of-mark prompting](https://arxiv.org/abs/2310.11441)). Their README notes OCR outperformed both SoM and vanilla vision for them.

### 3.5 Microsoft UFO² / UFO³ Galaxy

[Repo](https://github.com/microsoft/UFO) · [UFO² paper](https://arxiv.org/abs/2504.14603) · [UFO³ paper](https://arxiv.org/abs/2511.11332):

- **UFO² (Windows Desktop "AgentOS")**: deep OS integration — **UIA + Win32 + WinCOM** for control detection and *hybrid actions* (prefer an app's API/COM over GUI clicks when available); visual+UIA hybrid control detection (OmniParser for the visual side); **speculative multi-action** — predict a batch of actions per LLM call, validate each against live state before executing, claimed **51% fewer LLM calls**; RAG "knowledge substrate" (docs, demos, execution traces) to ground app-specific behavior.
- **UFO³ Galaxy**: multi-device orchestration — decompose requests into a DAG of "TaskStars," capability-based device assignment, WebSocket AIP protocol, UFO² as the Windows device agent. The direction to watch: computer-use agents as *managed workers* under an orchestrator.

### 3.6 Microsoft OmniParser

[Repo](https://github.com/microsoft/OmniParser) · [paper](https://arxiv.org/abs/2408.00203): **screen parsing as a reusable component** — icon/interactive-region detection (YOLO; 2026-07 moved to a YOLOv9-E detector), icon captioning (Florence-2), OCR, interactability classification → a SoM-style labeled overlay that turns any VLM into a passable GUI grounder. 39.5% on ScreenSpot-Pro at v2 (since surpassed by UI-TARS-1.5's 61.6%). License note: caption models MIT, earlier Ultralytics detectors AGPL — check before vendoring.

### 3.7 Skyvern

[Repo](https://github.com/Skyvern-AI/skyvern): browser-only, but instructive as the **hybrid** archetype: vision + DOM together (never raw coordinates alone), agent swarm for plan/execute/validate, and a 2026 repositioning as a **Playwright extension SDK** — `page.click(prompt="...")` with selector-first-then-AI fallback. Claims WebBench 64.4% SOTA; sits #1 on [Odysseys](https://odysseysbench.com/leaderboard) (98.1 rubric avg, classified "hybrid"). AGPL-3.0.

### 3.8 OpenAdapt

[Repo](https://github.com/OpenAdaptAI/OpenAdapt): pivoted away from model-in-the-loop entirely — **record a human demo once, compile it to a deterministic program, replay with 0 model calls**. The transferable idea is its outcome taxonomy: a run ends `VERIFIED` (every declared effect confirmed at the required evidence tier, ideally by an *independent system of record* — not the screen that did the writing), `HALTED_BEFORE_EFFECT`, `RECONCILIATION_REQUIRED` (never blind-retried), etc. "A click landing is not evidence that a transaction committed." MIT.

### 3.9 trycua/cua (Cua Driver)

[Repo](https://github.com/trycua/cua) · [cua-driver README](https://github.com/trycua/cua/blob/main/libs/cua-driver/README.md): the Rust background-input driver both browser-use's windows-harness and Open Interpreter build on (and **the driver PipiUI already embeds**). MCP-over-stdio agent boundary + UniFFI Python/TS SDKs over a versioned C ABI; background click/type/verify without stealing cursor/focus on macOS, Windows, Linux (X11 + compositor-specific Wayland routes); permission modes `standard`/`bounded`(manifest)/`unrestricted`; careful macOS **TCC attribution** story (the daemon must stay in the granting app's responsibility chain — standalone `.app`, explicit `--direct`, or embedded host). Around it: Cua sandboxes (per-OS VMs/containers), cua-bench (OSWorld/ScreenSpot/Windows Arena eval + RL), Lume (macOS VM management on Apple Silicon).

### 3.10 UI-TARS (ByteDance)

[Repo](https://github.com/bytedance/UI-TARS) · [paper](https://arxiv.org/abs/2501.12326): the leading open **native GUI grounding model** line. Screenshot in, `Thought: … Action: click(start_box='(x,y)')` out; coordinates are absolute-pixel predictions normalized by a factor-1000 scheme (Qwen2.5-VL lineage). UI-TARS-1.5: OSWorld 42.5 (100 steps) vs OpenAI CUA 36.4 and Claude 3.7 28; WindowsAgentArena 42.1; ScreenSpotPro 61.6. Ships prompt templates `COMPUTER_USE` / `MOBILE_USE` / `GROUNDING` and a UI-TARS-desktop app. UI-TARS-2 (2025-09) folds GUI+game+code+tool-use into one model. Evidence that coordinate accuracy is a *training* problem being solved in the model, while harnesses still own verification.

## 4. Cross-cutting design patterns

| Pattern | Who does it | Takeaway |
|---|---|---|
| **Screenshot downscale + explicit scale factors** | Anthropic (≤1568 px/1.15 MP, scale back coordinates), browser-use (≤1280², returns `scale_x/scale_y`), OpenAI (`detail:original`, else 1440×900/1600×900) | Coordinates must live in the pixel space of the image the model saw; ship the transform in the same result object, never as out-of-band state |
| **Sub-region / full-res capture** | Anthropic `zoom` member; browser-use `see()` is inherently sub-region (per-window); OmniParser crop pipelines | A `zoom(region)` or per-window capture is the standard fix for "small text unreadable in downscaled shot" — and zoom images never become a coordinate frame |
| **Per-window background capture** | browser-use macos (`screencapture -l windowID`), windows (`PrintWindow`), Cua Driver | Prefer window-scoped over full-display: smaller images, no focus theft, model can't be distracted by unrelated windows |
| **AX/DOM tree as optional second channel** | browser-use (`ax` only "when semantic identity or state matters"), UFO² (UIA+Win32 hybrid), Cowork ("most precise tool first"), Skyvern (DOM+vision) | Structure-first, pixels-last is the consensus routing; expose the tree on demand, not as the default observation |
| **Coordinate→element bridge** | browser-use `ax.at(x,y)` hit-test; SoC OCR text→coords map; OmniParser labeled overlays | When the model has a pixel but you want reliability, resolve pixel→AX element→AXPress instead of trusting the pixel twice |
| **Batched actions + ordered execution + halt semantics** | Anthropic batch actions with fixed "Not executed" halt text; OpenAI `actions[]`; UFO² speculative multi-action (validate-then-run, −51% LLM calls); browser-use "one CLI call per decision point" | Batch the deterministic middle, verify once at the end; define skip semantics *in the protocol*, not in prompts |
| **Unicode-safe typing** | browser-use (`CGEventKeyboardSetUnicodeString` per char; Windows: UIA set_value→Unicode→paste escalation) | Never synthesize keycodes for text; use unicode-string injection, and read-back-verify when it matters |
| **Action verification loops** | browser-use focus guard + pointer drawn into screenshots + Windows proof images (`result["proof"]["path"]`); OpenAdapt independent system-of-record verification; Anthropic "end every batch with a screenshot" | Verify with the cheapest *independent* signal; a screenshot proves pixels, an AX/API read proves state — they answer different questions |
| **Honest failure / refusal** | windows-harness `BackgroundUnavailable` + class-name drop matrix + UIPI reporting; browser-use `FocusChangedError`; OpenAdapt `RECONCILIATION_REQUIRED` | Detect what the platform silently drops and refuse structurally; never fake delivery |
| **Safety posture spectrum** | Anthropic demo: full X11 Docker sandbox · OpenAI: isolated browser/VM + confirmation taxonomy · Cowork/Codex/browser-use: real machine + per-app permission / focus guards / virtual cursor · Cua: permission modes + manifest | Match containment to blast radius; on the real desktop the minimum is per-app scoping, confirm-at-point-of-risk, and treating all on-screen text as untrusted input |
| **Agent packaging: skill + thin CLI, no framework** | browser-use (SKILL.md + ~600-line harness), Open Interpreter (QA skill), Cua (MCP server + skill) | The model writes missing helpers mid-task; harnesses ship *capabilities and conventions*, not flows |

## 5. What this implies for a project with a Playwright/CDP browser driver

PipiUI already has: a CDP browser path, an embedded Cua Driver runtime (window-scoped screenshots + AX metadata + background input), a routing ladder (app lifecycle → AX/shortcut → pixel coordinates), letterbox-exact coordinate transforms with letterbox rejection, stale-token fail-closed AX references, a process-global execution mutex, and `outcome_unknown` semantics ([docs/computer-use.md](../computer-use.md), [docs/computer-runtime-v1.md](../computer-runtime-v1.md)). Against the 2026 evidence:

1. **Keep computer use off the browser's turf.** browser-use's own SKILL.md ("Do not substitute AX for CDP inside a web page"), the Odysseys leaderboard (hybrid/terminal ≫ pure CUA on web tasks), and Cowork's "most precise tool first" all agree: the desktop driver is for native apps and cross-app seams. PipiUI's existing rule (web URLs → browser tool; external browser apps only via pinned window + clipboard paste of the URL) matches the best practice observed.
2. **The existing routing ladder is the right architecture — hold it.** Every serious implementation converged on structure→keyboard→coordinates (browser-use mode ladder, Cowork, UFO² hybrid actions). Do not add a screenshot-first mode.
3. **Adopt burst-then-verify with protocol-level skip semantics.** Anthropic's batch+halt-text and OpenAI's `actions[]` are now the interop shape; browser-use's "one call per decision point, verify once" is the same idea at CLI grain. PipiUI's guarded action blocks already batch — the gap to close is making per-action failure stop the tail with an explicit "not executed" receipt per skipped action (Anthropic's exact text is a fine precedent), which the current per-action receipt model can express.
4. **Add a full-resolution sub-region capture (`zoom`-style).** Anthropic made `zoom` a default-on member for a reason: small text in sidebars/status bars is illegible at screenshot scale. PipiUI's window-scoped capture mitigates but doesn't eliminate this; a `region` parameter that returns a crop at native (Retina) resolution — without becoming a coordinate frame — is cheap on top of the existing transform code.
5. **Ship proof artifacts per action.** windows-harness stamps a reticle/arrow onto a post-action image (`result["proof"]["path"]`) so mis-landed clicks are debuggable from the receipt alone. PipiUI already returns a fresh screenshot per batch; stamping the intended coordinate onto it closes the loop between "model picked a pixel" and "runtime clicked a pixel."
6. **Text entry: verify by read-back for consequential input.** The windows-harness escalation (UIA `set_value` with read-back → unicode injection → clipboard paste) is the documented answer to "did the text land." PipiUI has Unicode input via Cua; adding an optional AX read-back assertion after `type` into high-risk fields (forms that submit, passwords) is a small change with real failure-detection value.
7. **Budget screenshots as a first-class context cost.** Anthropic's numbers (~1–1.8k tokens/shot, ≤20 images/request, prune in batches of turns to protect the cache prefix) apply to any provider. A desktop loop produces far more images than a browser loop; decide the retention/prune policy deliberately instead of letting the transcript grow.
8. **Keep the "honest refusal" discipline and extend the matrix.** windows-harness's class-name drop matrix and PipiUI's `outcome_unknown`/letterbox rejection are the same philosophy: detect unsupportable delivery and refuse structurally. Worth adding: a per-app delivery ledger (which apps accept background input, which required foreground) persisted as workflow memory — PipiUI's Workflow Memory is a natural home.
9. **Permissions/safety: per-app scoping is the emerging real-desktop norm.** Cowork prompts per application; Cua has `standard`/`bounded`/`unrestricted` modes with manifests; OpenAI's confirmation taxonomy (confirm at point of risk, typing sensitive data = transmission, hand-off for password changes/CAPTCHA/safety-barrier bypass) is directly adoptable as policy text. PipiUI runs with `permission-mode unrestricted` in embedded mode — fine for the host-driven product, but the *strategy* layer should still gate consequential actions, because the driver no longer will.
10. **Don't chase a CUA-model dependency.** UI-TARS shows grounding moving into models; browser-use and OpenAI's code-execution guidance show harnesses getting thinner. The durable asset is the runtime (capture, delivery, verification, permissions, receipts) — exactly what PipiUI owns. Model choice should stay swappable behind the existing strategy boundary.

## Sources

Primary sources read for this report (all accessed 2026-08-28):

- browser-use: [macos-harness repo](https://github.com/browser-use/macos-harness) · [macos.py](https://github.com/browser-use/macos-harness/blob/main/src/macos_harness/macos.py) · [overlay.py](https://github.com/browser-use/macos-harness/blob/main/src/macos_harness/overlay.py) · [browser.py](https://github.com/browser-use/macos-harness/blob/main/src/macos_harness/browser.py) · [controls.py](https://github.com/browser-use/macos-harness/blob/main/src/macos_harness/controls.py) · [SKILL.md](https://github.com/browser-use/macos-harness/blob/main/skills/macos-harness/SKILL.md) · [pyproject.toml](https://github.com/browser-use/macos-harness/blob/main/pyproject.toml) · [windows-harness README](https://raw.githubusercontent.com/browser-use/windows-harness/main/README.md) · [desktop README](https://raw.githubusercontent.com/browser-use/desktop/main/README.md) · [macOS-use README](https://raw.githubusercontent.com/browser-use/macOS-use/main/README.md) · [The Bitter Lesson of Agent Harnesses](https://browser-use.com/posts/bitter-lesson-agent-harnesses) · [changelog](https://browser-use.com/changelog) · [Online-Mind2Web post](https://browser-use.com/posts/online-mind2web-benchmark)
- Anthropic: [computer use docs](https://docs.anthropic.com/en/docs/agents-and-tools/computer-use) · [claude-quickstarts computer-use-demo Dockerfile](https://github.com/anthropics/claude-quickstarts/blob/main/computer-use-demo/Dockerfile) · [computer.py](https://github.com/anthropics/claude-quickstarts/blob/main/computer-use-demo/computer_use_demo/tools/computer.py) · [Cowork computer use help article](https://support.claude.com/en/articles/14128542-let-claude-use-your-computer-in-cowork)
- OpenAI: [Computer use guide](https://platform.openai.com/docs/guides/tools-computer-use) · [Codex for (almost) everything](https://openai.com/index/codex-for-almost-everything/)
- Open Interpreter: [current repo README](https://raw.githubusercontent.com/OpenInterpreter/open-interpreter/main/README.md) · [endolith/open-interpreter README](https://raw.githubusercontent.com/endolith/open-interpreter/master/README.md)
- Others: [self-operating-computer](https://raw.githubusercontent.com/OthersideAI/self-operating-computer/main/README.md) · [microsoft/UFO](https://raw.githubusercontent.com/microsoft/UFO/main/README.md) · [microsoft/OmniParser](https://raw.githubusercontent.com/microsoft/OmniParser/master/README.md) · [Skyvern](https://raw.githubusercontent.com/Skyvern-AI/skyvern/main/README.md) · [OpenAdapt](https://raw.githubusercontent.com/OpenAdaptAI/OpenAdapt/main/README.md) · [trycua/cua](https://raw.githubusercontent.com/trycua/cua/main/README.md) · [cua-driver README](https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/README.md) · [bytedance/UI-TARS](https://raw.githubusercontent.com/bytedance/UI-TARS/main/README.md) · [Odysseys leaderboard](https://odysseysbench.com/leaderboard) · [Set-of-Mark paper](https://arxiv.org/abs/2310.11441)

Caveat: browser-use's cloud "Computer Use" surface is only evidenced by one changelog line; no public OSWorld-class benchmark exists for macos-harness/windows-harness. Where a vendor number is quoted (UFO's 51%, Skyvern/Odysseys scores, UI-TARS OSWorld), it is the vendor's/leaderboard's own measurement, not independently reproduced here.
