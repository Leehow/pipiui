# Document Reference Cards in Chat — Design

Date: 2026-07-26
Status: Approved (design only — no product code in this change)
Scope: Detect locally-previewable document references in chat text and render them as
clickable summary cards that open the existing right-hand `DocumentPanel`.

> 构建约束（来自 `CONSTITUTION.md` / `AGENTS.md`）：本变更只产出设计文档；任何
> 代码实现都必须遵守「唯一可运行包只在主 checkout `/Users/haoli/leehow/code/pipiui`
> 由 `./make-app.sh` 打包」的硬规则。Worktree（含本 worktree）只允许
> `swift build` / `swift test` 验证，**严禁**生成 `build/PipiUI.app`。

---

## 1. Problem

PipiUI already lets users **⌘+click** an absolute path (`/Users/...` or `file://...`) in
chat text to reveal it in Finder, and — when `DocumentDetector` recognises the extension
(md / txt / log / known basenames) — to open it in the right-hand `DocumentPanel`
(`Sources/PipiUI/Views/DocumentPanel.swift`, `Sources/PipiUI/DocumentStore.swift`).

Two gaps remain:

1. **Relative paths are invisible.** `FileReveal.computeAbsolutePathMatches`
   (`Sources/PipiUI/FileReveal.swift`) only scans POSIX-absolute and `file://` candidates.
   When an agent writes `see docs/spec.md` or `result in ./out/report.txt`, nothing is
   clickable and nothing previews, even though the session knows its project root
   (`ChatSession.projectURL`) and each subagent knows its own worktree cwd
   (`SubagentInfo.worktreePath`).
2. **No first-class "document card".** A document reference is just styled text. Users get
   no summary, no filename affordance, and no clear "open this in the panel" target unless
   they happen to ⌘+click the exact glyph.

This design adds **Document Reference Cards**: structured, summary-bearing cards for
locally-previewable documents referenced in chat, fed by a shared path-normalization layer.

## 2. Confirmed scope (in)

- Recognize references to **locally-previewable documents**:
  - Markdown: `.md .markdown .mdx .mdown .mkd` (from `DocumentDetector.markdownExtensions`).
  - Plain text: `.txt .text .log` + known basenames (from `DocumentDetector.plainTextExtensions` / `docBasenames`).
  - **PDF: `.pdf`** (new — see §6; needs a `DocumentKind.pdf` case + PDFKit renderer).
- Source the references from **agent / assistant / user text** in the main transcript.
- Render one **`DocumentFileCardView`** per unique referenced document.
- Card **title** = filename (`url.lastPathComponent`); **subtitle** = full absolute path;
  **body** = a length-limited content summary (loaded off-main, cached, truncated).
- Card **click** reuses the existing `@Environment(\.openDocument)` hook
  (`Sources/PipiUI/Views/DocumentPanel.swift` → injected by `ChatDetailView`), which calls
  `session.documents.open(url)` and sets `session.rightPanel = .document`. **No new routing.**
- Three-layer path strategy (absolute-path nudges, programmatic normalization, UI fallback).

## 3. Non-goals (out of scope for v1)

- Cards / previews for **code or config files** (`.swift .py .json .toml .yml ...`).
  These stay ⌘+click → Finder reveal only; no card is produced.
- In-text **⌘+click on relative paths** inside `PathLinkedText` / `MarkdownView`. The shared
  resolver (§5) makes this a trivial follow-up, but v1 ships the *card* as the display
  surface, not inline prose styling for relative paths. (See §11 "Open follow-ups".)
- Editing documents inside the panel; OCR; remote (`https://`) document cards.
- Changing the existing ⌘+click reveal behavior for absolute paths.
- Touching the user's primary-checkout uncommitted working tree. This change is doc-only.

## 4. Goals

1. A document referenced by **relative path** in chat becomes a discoverable, clickable card
   that opens `DocumentPanel` — no copy-paste, no terminal.
2. The path base is unambiguous: normal session text resolves against `session.projectURL`;
   subagent-authored text resolves against that agent's `worktreePath` (fallback
   `session.projectURL`); absolute and `file://` references pass through unchanged.
3. No regression to Markdown cross-paragraph drag selection (the single-`NSTextStorage`
   guarantee in `MarkdownSelectionContent` / `SelectableMarkdownTextView`).
4. No synchronous file reads in any SwiftUI `body`.
5. Bounded cost under streaming: dedup by absolute path; cached summaries; no per-frame IO.

## 5. Path normalization — the shared layer (三层保障)

A new pure helper (proposed name `DocumentReferenceScanner`, file `Sources/PipiUI/DocumentReferenceScanner.swift`)
is the **single source of truth** for "what documents does this text reference, given a base?"
Both the card builder (v1) and a future relative-path ⌘+click (v1.1) call it.

```swift
struct DocumentReference: Equatable, Identifiable {
    let url: URL              // always absolute, resolved
    let title: String         // url.lastPathComponent
    let sourceRange: NSRange  // range in the source plain text (for future inline wiring)
    enum Origin { case absolute, fileURL, tilde, relativeResolved, uiFallback }
    let origin: Origin
    var id: String { url.path }
}

enum DocumentReferenceScanner {
    /// Pure: text + base → ordered, de-duplicated document references.
    /// Existence checks are performed by the caller off-main (see §7); this function
    /// only computes candidate URLs + origins so it stays testable without a filesystem.
    static func references(in text: String, base: URL?) -> [DocumentReference]
}
```

### Three layers (defence in depth)

1. **Agent / output-constraint layer (preferred).** Continue to instruct models/agents
   (system prompt, skill text) to emit **absolute paths** when referencing local files.
   This is already the de-facto convention; the design formalizes it but does not encode
   prompt changes here. Absolute paths and `file://` are recognized verbatim by
   `FileReveal.fileURL(fromCandidate:)` and need no base.

2. **Programmatic normalization layer (shared).** For a relative/tilde token, the scanner
   resolves against a base URL supplied by the call site:
   - **Normal session transcript** (`MessageRow` → `AssistantSegmentsView`, user bubble):
     base = `session.projectURL`.
   - **Subagent-authored text** — the `[subagent-done]` result bubble
     (`SubagentDoneBubbleView`) and the subagent detail log rows (`AgentLogRow` in
     `Sources/PipiUI/Views/SubagentPanel.swift`): base = `SubagentInfo.worktreePath` when
     present, else `session.projectURL`.
   - Resolution is **existence-gated**: a relative candidate only becomes a reference if
     `base.appendingPathComponent(token)` (after `..`/`.` standardization) exists on disk.
     Existence is checked off-main (§7), never in `body`.

3. **UI fallback layer.** Even if layers 1–2 miss (no base, or the agent wrote a bare
   filename), the card layer does a conservative fallback scan: a token is a candidate iff
   it has no whitespace, ends with a recognized document extension (md/txt/pdf/…), and — when
   any plausible base exists — resolves to an existing file. Bare prose words never match
   (extension + existence filter). This is "兜底识别" — best-effort display only.

### Path base rules (explicit, no ambiguity)

| Text form | Base used | Result |
|---|---|---|
| `/abs/path.md`, `file:///abs/x.pdf` | (none) | kept as-is |
| `~/notes/a.md` | `NSHomeDirectory()` | `~/` expanded |
| `docs/spec.md`, `./out/r.txt`, `../x.md` | normal msg → `session.projectURL`; subagent msg → `worktreePath` (else projectURL) | resolved if exists |
| bare `report.txt` (no dir separator) | same base, UI fallback only | resolved if exists; else no card |
| `src/main.swift`, `config.yaml` | — | **no card** (not a previewable doc kind) |

`FileReveal.recognizedPrefixes` already constrains absolute detection; the scanner reuses
`FileReveal.absolutePathMatches` for the absolute/`file://` pass and adds the relative/tilde
pass. Tilde expansion uses `NSString(string:).expandingTildeInPath`.

## 6. PDF support (new, scoped)

`DocumentDetector` today has `.markdown` and `.plain` only. PDF is a new previewable kind:

- Add `DocumentKind.pdf` and `DocumentDetector.plainTextExtensions`-adjacent
  `pdfExtensions = ["pdf"]` (or a dedicated branch) so `DocumentDetector.kind(for:)` returns
  `.pdf` for `.pdf`.
- `DocumentPanel.documentView(_:)` gains a `.pdf` case rendering via AppKit **PDFKit**
  (`PDFView`), which loads by URL and paginates lazily — it does **not** slurp the whole file
  into a `String`, so the 2 MB text cap does not apply to PDF the same way. Size guard for
  PDF uses `FileManager.attributesOfItem` only and a higher cap (e.g. 50 MB) to avoid
  pathological files; above it, show the existing `.tooLarge` placeholder + "open externally".
- PDF **card summary** is minimal (filename + optional page count via `PDFDocument` off-main);
  full text extraction is **not** required for v1.
- This is the only renderer addition; markdown/plain rendering paths are unchanged.

> Note: PDFKit (`import PDFKit`) is a system framework on macOS 14+; no new dependency.

## 7. Card content, loading, caching (no IO in `body`)

### 7.1 `DocumentFileCardView` (new SwiftUI view, `Sources/PipiUI/Views/MessageViews.swift`)

```
┌──────────────────────────────────────────────┐
│ 📄 spec.md                          ⌘ open ↗ │   title = lastPathComponent
│ /Users/.../docs/spec.md                       │   subtitle = absolute path (truncated middle)
├──────────────────────────────────────────────┤
│ # Spec title                                  │   body = ≤ N chars/lines summary
│ First paragraphs of content…                  │
└──────────────────────────────────────────────┘
```

- Tap (whole card) → `@Environment(\.openDocument)?(url)` → right panel opens (same path as
  ⌘+click today). A small "open" glyph is the affordance; no secondary action needed.
- Title `lineLimit(1)` + `.truncationMode(.tail)`; subtitle `lineLimit(1)` +
  `.truncationMode(.middle)` (matches `DocumentPanel` toolbar conventions).

### 7.2 Summary store (off-main, cached)

A small `ObservableObject` (proposed `DocumentSummaryStore`, file
`Sources/PipiUI/DocumentSummaryStore.swift`) keyed by **absolute path**:

```swift
@MainActor final class DocumentSummaryStore: ObservableObject {
    struct Entry: Equatable {
        enum State { case loading, loaded(Summary), missing, tooLarge, unreadable }
        let state: State
    }
    func entry(for absolutePath: String) -> Entry     // sync read from cache; never reads disk
    func request(for absolutePath: URL, kind: DocumentKind) // kicks a background load if absent
}
```

- Mirrors `DocumentStore.LoadState` semantics (`.missing / .tooLarge / .unreadable /
  .loaded`) so card error states and panel error states stay consistent.
- **Background load** on `DispatchQueue.global(qos: .utility)` (same pattern as
  `DocumentStore.readFromDisk`): `fileExists` → `attributesOfItem` (size guard) →
  `Data(contentsOf:, .mappedIfSafe)` → lenient UTF-8 decode → truncate.
- **Truncation**: ≤ 240 characters **and** ≤ 6 lines, trimmed; append "…" when cut. CJK-safe
  (character-based, not byte-based).
- **Cache**: process-wide `NSCache<NSString, Entry>` by absolute path. Transcript history is
  immutable, so a warm session switch hits the cache (mirrors `PathLinkCache`).
- `DocumentFileCardView.body` **only** reads `store.entry(for: url.path)`; it never touches
  `FileManager` or `Data`. The view calls `store.request(...)` in `.onAppear` / `.onChange`.

### 7.3 UI states on the card

| Disk state | Card body | Click |
|---|---|---|
| loaded | truncated summary | opens panel (loaded) |
| loading | subtle `ProgressView().controlSize(.mini)` + "读取中…" | opens panel (it shows its own loading) |
| missing | "文件不存在" (secondary/red) | opens panel → `.missing` placeholder (consistent with ⌘+click) |
| too large | "文件过大（\<size>）" | opens panel → `.tooLarge` placeholder |
| unreadable | "无法读取（权限?）" | opens panel → `.unreadable` placeholder |

Click always routes to `openDocument`; the panel is authoritative for the rendered error.

## 8. Placement — keep Markdown text un-split (recommended approach)

### 8.1 Recommended: sibling card stack, Markdown body untouched

Cards render as a **sibling** to `MarkdownTextView`, never *inside* its `NSTextStorage`.

In `AssistantSegmentsView.segmentsBody` (`Sources/PipiUI/Views/MessageViews.swift`), append a
single `DocumentFileCardStack` as the **last child** of the existing `VStack`:

```swift
VStack(alignment: .leading, spacing: 10) {
    ForEach(segments) { segment in /* existing: MarkdownTextView / ToolCardView / … */ }
    if let cards = documentCards, !cards.isEmpty {
        DocumentFileCardStack(references: cards, summaryStore: summaryStore)
    }
}
```

`documentCards` is computed once per `body` from all `.text` segments joined, via
`DocumentReferenceScanner.references(in:base:)` + an off-main existence/summary prefetch.
Dedup is by `DocumentReference.id` (= absolute path), preserving first-seen order.

**Why this preserves selection:** `MarkdownSelectionContent.attributedString(for:)` still
builds **one** `NSAttributedString` per `MarkdownTextView`, hosted in one `NSTextView`
(`SelectableMarkdownTextView`). Drag selection across paragraphs/lists inside that block is
unchanged. Cards live in a separate SwiftUI view below — exactly like `ToolCardView` does
today, which already coexists with markdown without breaking selection.

### 8.2 Alternatives considered (≥2)

- **Alt A — Inline `NSTextAttachment` chips inside the attributed string.** Replace each
  detected document path run with an attachment cell (mini card) inside the `NSTextView`.
  - *Pros:* card sits visually next to the mention.
  - *Cons:* substantial AppKit attachment layout/identity work; the path text would stop being
    selectable as plain text; clashes with the existing "style only, no `.link`, ⌘+click
    overlay" model in `PathLinkedText`/`PathClickTextView`; attachment sizing inside
    `MarkdownSelectionContent`'s single storage is fragile across fonts/scales.
  - *Verdict: rejected for v1.*

- **Alt B — Split the markdown block at each reference into multiple `MarkdownTextView`s,
  interleaving cards.** Each text fragment becomes its own `MarkdownTextView` with a card
  between.
  - *Pros:* card appears at the mention; pure SwiftUI.
  - *Cons:* **shatters the single `NSTextStorage`** → breaks cross-paragraph drag selection
    (explicit non-goal, §3); multiplies markdown parse + `NSAttributedString` builds under
    streaming (each token streamed re-splits); reflows as text grows.
  - *Verdict: rejected for v1.*

- **Recommended (C) — Shared resolver + sibling `DocumentFileCardView` stack at message
  bottom; keep Markdown body un-split.** Minimal AppKit risk, zero selection regression,
  cheap under streaming, and the shared resolver still enables Alt-A/B later if desired.
  - *Secondary placement option (not v1 default):* for very long multi-segment messages,
  cards may be attached per `.text` segment (after that segment's `MarkdownTextView`). This
  is safe because each segment is **already** a separate `NSTextView`/view, so inserting a
  sibling card between two already-separate segments does not split any single storage. v1
  ships **message-bottom** (one stack) to minimize churn; per-segment is a config flag.

> This matches the requested recommendation: "路径规范化共享层 + 消息底部/段间的结构化
> `DocumentFileCardView`；保持正文 Markdown 文本不拆散".

### 8.3 Streaming & dedup

- Recompute `documentCards` when the joined text of `.text` segments changes.
- Dedup by absolute path so the same file (referenced 3×) yields **one** card.
- Summary prefetches are keyed by absolute path → idempotent across recompute.
- A streaming assistant message that mentions `docs/a.md` mid-stream shows the card as soon
  as the reference is complete; it does not duplicate when the path appears again later.

## 9. Files to touch (implementation boundary — verify against current code)

| File | Change |
|---|---|
| `Sources/PipiUI/DocumentReferenceScanner.swift` (**new**) | Pure `DocumentReference` + `references(in:base:)`; reuses `FileReveal.absolutePathMatches`; adds relative/tilde resolution + UI-fallback candidate generation. Existence-gating lives in the summary store, not here. |
| `Sources/PipiUI/DocumentSummaryStore.swift` (**new**) | `@MainActor ObservableObject`; off-main load, size guard, truncation, `NSCache` by absolute path; states mirror `DocumentStore.LoadState`. |
| `Sources/PipiUI/DocumentStore.swift` | Add `DocumentKind.pdf`; extend `DocumentDetector` (`pdfExtensions`); keep `maxFileSize` for text kinds. |
| `Sources/PipiUI/Views/DocumentPanel.swift` | `.pdf` render branch via `PDFView`; keep all other branches. |
| `Sources/PipiUI/Views/MessageViews.swift` | Add `DocumentFileCardView` + `DocumentFileCardStack`; attach stack in `AssistantSegmentsView.segmentsBody`; thread `projectURL` (already present) into the scanner; optional card in `SubagentDoneBubbleView`. |
| `Sources/PipiUI/Views/SubagentPanel.swift` | Pass `agent.worktreePath` as base to the scanner for `AgentLogRow` default-case cards (today it passes main `projectURL`). |
| `Sources/PipiUI/FileReveal.swift` | (Minimal) expose a relative-candidate helper if the scanner needs internals; do **not** change absolute-path behavior. |
| `Sources/PipiUI/Views/PathLinkedText.swift`, `Sources/PipiUI/Views/MarkdownView.swift` | **No change in v1.** Relative-path ⌘+click is a documented follow-up (§11), reusing the same scanner. |
| `Sources/PipiUI/Views/ChatDetailView.swift` | **No change** — `openDocument` is already injected (≈ line 136) and does exactly what the card needs. |

> "以实际代码为准": line numbers and exact signatures must be re-checked at implementation
> time; the boundaries above are the design's intent.

## 10. Tests / acceptance

### 10.1 Unit tests (`Tests/PipiUITests/`)

Add (verify dir exists; siblings: `FileRevealTests.swift`, `DocumentStoreTests.swift`,
`PathLinkedAttributedCacheTests.swift`, `PathLinkLayoutTests.swift`):

- `DocumentReferenceScannerTests.swift` —
  - absolute `/a/b.md` and `file://` → `origin == .absolute/.fileURL`, url unchanged.
  - relative `docs/x.md` + base → resolved URL; non-existent candidate excluded after
    existence gate (mock or tmp dir).
  - `~/x.md` tilde expansion; `..`/`.` standardization.
  - subagent base = `worktreePath` wins over projectURL.
  - code/config tokens (`.swift`, `.json`) → no reference regardless of existence.
  - PDF `.pdf` → reference with pdf kind.
  - dedup: same absolute path via different relative spellings → one `DocumentReference`.
- `DocumentSummaryStoreTests.swift` —
  - missing / tooLarge / unreadable / loaded state mapping; truncation (char + line caps);
  - `body`-equivalent call (`entry(for:)`) does not perform IO (use a deterministic stub).
- Extend `DocumentStoreTests.swift` — `DocumentDetector.kind(for:)` returns `.pdf` for
  `.pdf`; `DocumentKind.pdf` Equatable.

### 10.2 Behavioral acceptance (manual / integration)

1. Agent message containing `see docs/spec.md` (relative) → a card titled `spec.md` with the
   project-root-resolved absolute path and a short summary appears; clicking opens the right
   `DocumentPanel` showing the rendered markdown.
2. Same for `.txt`/`.log` (plain render) and `.pdf` (PDFKit render).
3. Absolute `/Users/.../notes.md` and `file:///.../a.pdf` references still produce cards
   (unchanged base) and still ⌘+click-reveal in Finder as today.
4. A reference to `src/main.swift` produces **no** card; ⌘+click on it (absolute form) still
   reveals in Finder (no regression).
5. Missing / too-large / unreadable references show the matching card body and still route
   to the panel's matching placeholder on click.
6. Subagent `[subagent-done]` result referencing a relative path resolves against that
   agent's `worktreePath`; if the worktree was already merged/removed, the card shows
   "文件不存在" gracefully.
7. Cross-paragraph Markdown drag selection still copies the full selected range (no
   regression — cards are siblings).
8. Streaming an assistant message that mentions the same file three times shows exactly one
   card, with no per-frame file reads (verified by Instruments / no main-thread `Data` reads).
9. `DocumentSummaryStore` cache hit on session switch (second open is instant).

### 10.3 Build / package verification (CONSTITUTION)

- **Worktree** (this one, and any worker): `swift build` and `swift test` must pass.
  **Must not** run `make-app.sh` / `build-app.sh` or create `build/PipiUI.app`.
- **Primary checkout only** (`/Users/haoli/leehow/code/pipiui`):
  `./scripts/build-app.sh` (tests then package) → `./make-app.sh`, then timestamp-verify:
  ```bash
  stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' \
    build/PipiUI.app/Contents/MacOS/PipiUI \
    Sources/PipiUI/DocumentReferenceScanner.swift \
    Sources/PipiUI/DocumentSummaryStore.swift \
    Sources/PipiUI/Views/MessageViews.swift \
    Sources/PipiUI/DocumentStore.swift
  ```
  The `.app` binary must be newer than the changed sources (CONSTITUTION §2). Do not report
  "done / open the app" based only on a fresh `.build/*`.

## 11. Open follow-ups (explicitly out of v1, not TBD)

- Wire relative-path **⌘+click** into `PathLinkedText` / `PathClickTextView` using the same
  `DocumentReferenceScanner` (so prose relative paths get the accent/underline style +
  reveal). Deferred to keep v1 reviewable; the shared layer makes it additive.
- Per-segment card placement flag (§8.2 secondary option) for very long messages.
- PDF page-count + outline in the card summary.
- Card for tool-result outputs (e.g. `write` tool "created file") — separate detection path.

None of these block v1; none are left as unresolved design questions inside the v1 surface.

## 12. Self-check

- **TBD scan:** none in the v1 surface. §11 items are explicitly marked *out of scope*, not
  "to-be-decided".
- **Contradiction check:**
  - PDF size cap: text kinds use `DocumentStore.maxFileSize` (2 MB); PDF uses a higher,
    attribute-only cap because `PDFView` streams by URL. Stated explicitly in §6 to avoid the
    apparent conflict with the 2 MB rule.
  - Card click vs ⌘+click: both route through the *same* `openDocument` env value → no
    behavioral divergence.
  - "Message bottom" vs "段间": resolved in §8.2 — v1 default is message-bottom; per-segment
    is a documented option that is also selection-safe (segments are already separate views).
- **Scope ambiguity:** "previewable document" is pinned to `DocumentDetector` kinds + PDF;
  code/config explicitly excluded (§3). Path base is fully tabulated (§5).
- **Risk lines called out:** PDFKit renderer is the only new component; everything else
  reuses `FileReveal`, `DocumentStore`, `openDocument`. No change to absolute-path behavior
  or to Markdown selection.
