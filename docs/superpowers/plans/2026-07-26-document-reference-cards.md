# Document Reference Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Required sub-skill:** superpowers:subagent-driven-development (one fresh subagent per task, two-stage review between tasks) or superpowers:executing-plans (inline, batched with checkpoints).

**Goal:** Detect locally-previewable document references (md / txt / log / known basenames / **pdf**) anywhere in chat text — including relative paths and `~/` — and render them as clickable summary cards at the bottom of each message that open the existing right-hand `DocumentPanel` via the existing `@Environment(\.openDocument)` hook.

**Architecture:** A new pure helper `DocumentReferenceScanner` is the single source of truth for "what documents does this text reference, given a base?" It reuses `FileReveal`'s absolute/`file://` detection and adds relative/tilde/UI-fallback candidate generation + an off-main existence gate. A new `@MainActor DocumentSummaryStore` (process-wide `NSCache`, off-main loads) feeds length-limited summaries to a new `DocumentFileCardView` / `DocumentFileCardStack` rendered as a **sibling** of `MarkdownTextView` inside the existing `AssistantSegmentsView` `VStack` — so the single-`NSTextStorage` markdown selection host is never split. Card click calls the same `openDocument` env value that `ChatDetailView` already injects (≈ `.environment(\.openDocument, …)` in `ChatDetailViewBody.body`); no new routing. PDF becomes a new `DocumentKind.pdf` rendered by AppKit `PDFKit` (`PDFView`) in `DocumentPanel`, with an attribute-only size guard distinct from the 2 MB text cap.

**Tech Stack:** Swift 5.9, SwiftPM, SwiftUI + AppKit (macOS 14+), `PDFKit` (system framework, no new dependency). XCTest unit tests. Existing `FileReveal` / `DocumentStore` / `DocumentDetector` / `PathLinkCache` patterns (process-wide `NSCache`, off-main `Data(contentsOf:, .mappedIfSafe)` reads, `@Environment(\.openDocument)`).

## Global Constraints

Copied verbatim-enforced from `CONSTITUTION.md`, `AGENTS.md`, and the approved design `docs/superpowers/specs/2026-07-26-document-reference-cards-design.md`:

- **Only the primary checkout `/Users/haoli/leehow/code/pipiui` may create the runnable App.** All linked/temporary worktrees (including any worker executing this plan) may verify with `swift build` / `swift test` ONLY and **must never** run `make-app.sh` / `build-app.sh` or create `build/PipiUI.app`.
- **Primary-checkout packaging** (only after all tasks land there): `cd /Users/haoli/leehow/code/pipiui && ./scripts/build-app.sh` then `./make-app.sh`, then timestamp-verify `build/PipiUI.app/Contents/MacOS/PipiUI` is newer than every changed source (CONSTITUTION §2). Never report "done / open the app" on a fresh `.build/*` alone.
- **No synchronous file reads in any SwiftUI `body`.** All `FileManager` / `Data` / `PDFDocument` IO is off-main (`DispatchQueue.global(qos: .utility)` for the summary store, mirroring `DocumentStore.readFromDisk`'s background read).
- **Do not break Markdown cross-paragraph drag selection.** Cards are siblings to `MarkdownTextView` (which owns one `NSTextStorage` via `SelectableMarkdownTextView`); never inject cards into the attributed string and never split a markdown block into multiple `MarkdownTextView`s.
- **Card click and existing ⌘+click both route through the same `@Environment(\.openDocument)` value** → `session.documents.open(url)` + `session.rightPanel = .document`. No new routing, no behavioral divergence.
- **Do not change absolute-path behavior.** `FileReveal.computeAbsolutePathMatches` / `fileURL(fromCandidate:)` / ⌘+click Finder reveal for absolute paths stay byte-identical.
- **Only previewable document kinds get a card.** Code/config (`.swift .py .json .toml .yml …`) never produce a card (filtered by `DocumentDetector.kind(for:) != nil`). They keep ⌘+click → Finder reveal.
- **Text kinds cap = `DocumentStore.maxFileSize` (2 MB); PDF cap = a separate attribute-only `DocumentStore.pdfMaxFileSize` (50 MB)** because `PDFView` streams by URL and must not slurp the file into a `String`.
- **Path base rules (no ambiguity):** `/abs` & `file://` → no base, kept as-is; `~/…` → `NSHomeDirectory()`; relative/`./`/`../`/bare-filename in normal session text → `session.projectURL`; in subagent-authored text (`AgentLogRow` in `SubagentPanel`, `[subagent-done]` bubble) → `SubagentInfo.worktreePath` when present, else `session.projectURL`.
- **LLM/agent output constraint:** continue to instruct models/agents to emit absolute paths (de-facto convention; the design formalizes it but encodes no prompt change in this plan).
- **Streaming:** dedup card references by absolute path (`DocumentReference.id == url.path`), preserve first-seen order; summary prefetches are idempotent and keyed by absolute path; no per-frame IO.

---

## File Map

Verified against current code (2026-07-26). Line numbers are approximate and must be re-checked at implementation time (the design's own §9 says the same); the boundaries below are the intent.

| File | Status | Responsibility / Change in this plan |
|---|---|---|
| `Sources/PipiUI/DocumentStore.swift` | **Modify (Task 1)** | Add `DocumentKind.pdf`; add `DocumentDetector.pdfExtensions = ["pdf"]` and a `.pdf` branch in `DocumentDetector.kind(for:)`; add `DocumentStore.pdfMaxFileSize = 50 * 1024 * 1024`; add a `.pdf` branch in `readFromDisk(url:kind:)` that does an **attribute-only** size guard (no `Data(contentsOf:)`, `text: ""`). Keep `maxFileSize` (2 MB) for text kinds. |
| `Sources/PipiUI/Views/DocumentPanel.swift` | **Modify (Task 1)** | Add `import PDFKit`; add a `case .pdf:` branch in `documentView(_:)` rendering `PDFKitView(url: doc.url)`. Add the small `PDFKitView: NSViewRepresentable` (wraps `PDFView`, `autoScales = true`, loads by URL). All other branches unchanged. |
| `Sources/PipiUI/DocumentReferenceScanner.swift` | **Create (Task 2)** | Pure `DocumentReference` model + `DocumentReferenceScanner.references(in:base:)` (absolute/`file://` via `FileReveal`, plus relative/tilde/UI-fallback candidates, dedup by absolute path, drop non-document kinds via `DocumentDetector`), `filterExisting(_:fileExists:)` existence gate, `effectiveBase(worktreePath:projectURL:)`. **No filesystem access** — stays unit-testable without one. |
| `Sources/PipiUI/DocumentSummaryStore.swift` | **Create (Task 3)** | `@MainActor ObservableObject` `DocumentSummaryStore.shared`; `Summary`, `Entry`, `Entry.State` (`loading/loaded/missing/tooLarge/unreadable`) mirroring `DocumentStore.LoadState`; `entry(for:)` (sync cache read, **never** IO) + `request(for:kind:)` (idempotent off-main load). Plus pure `DocumentSummaryTruncation.truncate(_:maxChars:maxLines:)` (≤240 chars AND ≤6 lines, CJK-safe). States mirror `DocumentStore.LoadState`. |
| `Sources/PipiUI/Views/MessageViews.swift` | **Modify (Task 4)** | Add `DocumentFileCardView` (title = `url.lastPathComponent`, subtitle = `url.path` middle-truncated, body = summary state; whole-card tap → `@Environment(\.openDocument)(url)`) and `DocumentFileCardStack` (observes `DocumentSummaryStore.shared`, calls pure `visibleCards(_:entry:)`, prefetches via `store.request(...)` in `.onAppear`/`.onChange`). Append the stack as the **last child** of the `VStack` in `AssistantSegmentsView.segmentsBody`; compute `documentCards` once per `body` from joined `.text` segments via the scanner + `filterExisting`. Add a best-effort card to `SubagentDoneBubbleView` (Task 5). |
| `Sources/PipiUI/Views/SubagentPanel.swift` | **Modify (Task 5)** | Thread a `base: URL?` (`DocumentReferenceScanner.effectiveBase(worktreePath: agent.worktreePath, projectURL: projectURL)`) from `AgentDetailView` into `AgentLogRow`, and append a `DocumentFileCardStack` under the default-case `MarkdownTextView`. `SubagentDoneBubbleView` (in `MessageViews.swift`) gets the same base (worktreePath looked up from `MessageRow.subagents` by `SubagentDoneMessage.agentId`, else `projectURL`). |
| `Sources/PipiUI/FileReveal.swift` | **No change** | The scanner needs only already-`package` APIs: `FileReveal.absolutePathMatches(in:)`, `FileReveal.fileURL(fromCandidate:)`, `FileReveal.stripTrailingPunctuation`. `computeAbsolutePathMatches` / `recognizedPrefixes` stay private and untouched; absolute-path behavior is unchanged. (If a later task finds it needs an internal, prefer exposing a new `package` helper over editing existing logic — but v1 needs none.) |
| `Sources/PipiUI/Views/PathLinkedText.swift` | **No change (v1)** | Inline relative-path ⌘+click styling is the documented v1.1 follow-up (design §11), reusing the same `DocumentReferenceScanner`. v1 ships the card as the display surface. |
| `Sources/PipiUI/Views/MarkdownView.swift` | **No change** | `MarkdownSelectionContent.attributedString(for:)` still builds one `NSMutableAttributedString`; `SelectableMarkdownTextView` still hosts it in one `NSTextView`/`NSTextStorage`. Cards live in a separate sibling SwiftUI view (exactly like `ToolCardView`), so cross-paragraph selection is unchanged. |
| `Sources/PipiUI/Views/ChatDetailView.swift` | **No change** | `@Environment(\.openDocument)` is already injected in `ChatDetailViewBody.body` (`.environment(\.openDocument, { url in session.documents.open(url); session.rightPanel = .document })`) and already covers `AssistantSegmentsView`, `SubagentDoneBubbleView`, and `SubagentPanel`/`AgentLogRow`. The card needs nothing new here. |
| `Tests/PipiUITests/DocumentStoreTests.swift` | **Extend (Task 1)** | Add PDF cases to `DocumentDetectorTests` (`.pdf` → `.pdf` kind, case-insensitive) and PDF load cases to `DocumentStoreTests` (`.pdf` loads with empty text + `.pdf` kind; 3 MB `.pdf` loads because it is under the 50 MB PDF cap but over the 2 MB text cap; 51 MB `.pdf` → `.tooLarge`). |
| `Tests/PipiUITests/DocumentReferenceScannerTests.swift` | **Create (Task 2)** | Absolute/`file://`/tilde/relative/UI-fallback origins; existence gate drops non-existent speculative candidates but keeps missing absolutes; `..`/`.` standardization; code/config tokens never reference; `.pdf` references; dedup by absolute path across spellings; `effectiveBase` worktree-wins. |
| `Tests/PipiUITests/DocumentSummaryStoreTests.swift` | **Create (Task 3)** | State mapping (missing/tooLarge/unreadable/loaded); truncation char+line caps (CJK-safe); `entry(for:)` does no IO (inject a deterministic loader); cache hit on second `entry(for:)`. |
| `Tests/PipiUITests/DocumentFileCardStackTests.swift` | **Create (Task 4)** | Pure `DocumentFileCardStack.visibleCards(_:entry:)`: absolute origin always shows (even missing); speculative origin shows only when file confirmed present (`.loaded/.tooLarge/.unreadable`); speculative missing/loading hidden (bare-prose protection); order + dedup preserved. |
| `Tests/PipiUITests/FileRevealTests.swift` | **No change** | Existing absolute-path tests are the regression guard that Task 2 must not disturb. (Task 2 adds no FileReveal test.) |
| `Tests/PipiUITests/PathLinkedAttributedCacheTests.swift`, `PathLinkLayoutTests.swift`, `MarkdownSelectionContentTests.swift`, `MarkdownListSelectionTests.swift` | **No change** | These are the selection regression net; they must stay green untouched. The card placement (sibling, not inline) is what keeps them green. |
| `Sources/PipiUI/SubagentStore.swift` | **No change** | `SubagentInfo.worktreePath: String?` already exists and is the subagent base source. Read-only consumption in Task 5. |

**No new dependencies.** `PDFKit` is a system framework on macOS 14+ (the package's deployment target).

---

## Task 1: PDF previewable kind (detector + store + PDFKit renderer)

**Files:**
- Modify: `Sources/PipiUI/DocumentStore.swift` (`enum DocumentKind`, `enum DocumentDetector`, `class DocumentStore` — `readFromDisk`).
- Modify: `Sources/PipiUI/Views/DocumentPanel.swift` (`documentView(_:)`, add `PDFKitView`).
- Test: `Tests/PipiUITests/DocumentStoreTests.swift` (extend `DocumentDetectorTests` + `DocumentStoreTests`).

**Interfaces:**
- Consumes: existing `DocumentStore.Document { url, kind, text, fileSize, modifiedAt }`, `DocumentStore.LoadState`, `DocumentStore.maxFileSize`.
- Produces (later tasks rely on these exact names):
  - `DocumentKind.pdf` (new case).
  - `DocumentDetector.pdfExtensions: Set<String> == ["pdf"]`.
  - `DocumentDetector.kind(for: URL)` returns `.pdf` for `.pdf` (case-insensitive).
  - `DocumentStore.pdfMaxFileSize: Int == 50 * 1024 * 1024`.
  - `readFromDisk` `.pdf` path → `Document(url:, kind: .pdf, text: "", fileSize:, modifiedAt:)` without reading bytes.

- [ ] **Step 1: Write the failing tests.**

Append to `Tests/PipiUITests/DocumentStoreTests.swift` (inside `DocumentDetectorTests`):

```swift
func testPdfExtensionDetected() {
    for name in ["a.pdf", "b.PDF", "c.Pdf"] {
        XCTAssertEqual(DocumentDetector.kind(for: url(name)), .pdf, name)
        XCTAssertTrue(DocumentDetector.isDocument(url(name)), name)
    }
}

func testPdfIsPreviewableKindSeparateFromCode() {
    // Code/config stay non-documents even after PDF is added.
    for name in ["a.swift", "b.py", "c.json", "d.yaml", "e.toml"] {
        XCTAssertNil(DocumentDetector.kind(for: url(name)), name)
    }
}
```

Append to `Tests/PipiUITests/DocumentStoreTests.swift` (inside the `@MainActor final class DocumentStoreTests`):

```swift
func testPdfLoadsBySizeGuardOnlyWithEmptyText() async throws {
    let store = DocumentStore()
    // Arbitrary bytes are fine: DocumentStore does not parse PDF content, only size.
    let url = try write("doc.pdf", "%PDF-1.4 not really a pdf but bytes are bytes")
    store.open(url)
    await waitForSettled(store)
    guard case .loaded(let doc) = store.loadState else {
        return XCTFail("expected .loaded, got \(store.loadState)")
    }
    XCTAssertEqual(doc.kind, .pdf)
    XCTAssertEqual(doc.text, "")   // PDF is never slurped into a String
    XCTAssertEqual(doc.url, url)
}

func testPdfAboveTextCapButBelowPdfCapLoads() async throws {
    // 3 MB: over the 2 MB TEXT cap, under the 50 MB PDF cap → must still load.
    let store = DocumentStore()
    let url = tempDir.appendingPathComponent("big.pdf")
    FileManager.default.createFile(atPath: url.path, contents: nil)
    let handle = try FileHandle(forWritingTo: url)
    try handle.truncate(atOffset: UInt64(3 * 1024 * 1024))
    try handle.close()
    store.open(url)
    await waitForSettled(store)
    guard case .loaded(let doc) = store.loadState else {
        return XCTFail("3 MB PDF must load (pdf cap > text cap), got \(store.loadState)")
    }
    XCTAssertEqual(doc.kind, .pdf)
    XCTAssertGreaterThan(doc.fileSize, DocumentStore.maxFileSize) // proves it is above text cap
    XCTAssertLessThanOrEqual(doc.fileSize, DocumentStore.pdfMaxFileSize)
}

func testPdfAbovePdfCapRejected() async throws {
    let store = DocumentStore()
    let url = tempDir.appendendingPathComponent("huge.pdf")
    FileManager.default.createFile(atPath: url.path, contents: nil)
    let handle = try FileHandle(forWritingTo: url)
    try handle.truncate(atOffset: UInt64(DocumentStore.pdfMaxFileSize + 1))
    try handle.close()
    store.open(url)
    await waitForSettled(store)
    guard case .tooLarge(let path, let size) = store.loadState else {
        return XCTFail("expected .tooLarge over pdf cap, got \(store.loadState)")
    }
    XCTAssertEqual(path, url.path)
    XCTAssertEqual(size, DocumentStore.pdfMaxFileSize + 1)
}
```

> Note: the `write(_:_)` and `tempDir`/`waitForSettled` helpers already exist in `DocumentStoreTests`.

- [ ] **Step 2: Run tests to verify they fail (compile failure).**

Run: `swift test --filter PipiUITests.DocumentDetectorTests.testPdfExtensionDetected`
Expected: COMPILE ERROR — `type 'DocumentKind' has no member 'pdf'`, and `DocumentStore.pdfMaxFileSize` / `.appendendingPathComponent` (typo below) unresolved. (Fix the deliberate typo `appendendingPathComponent` → `appendingPathComponent` when transcribing; the failure to compile is the gate, then the real assertion failure appears after Step 3.)

- [ ] **Step 3: Write minimal implementation.**

In `Sources/PipiUI/DocumentStore.swift`:

```swift
package enum DocumentKind: Equatable {
    case markdown
    case plain
    case pdf
}
```

In `enum DocumentDetector`:

```swift
    /// 渲染为 PDF 的扩展名（小写，不含点）。PDF 用 PDFKit 按需分页，不走 2 MB 文本上限。
    package static let pdfExtensions: Set<String> = ["pdf"]

    package static func kind(for url: URL) -> DocumentKind? {
        let ext = url.pathExtension.lowercased()
        if !ext.isEmpty {
            if markdownExtensions.contains(ext) { return .markdown }
            if plainTextExtensions.contains(ext) { return .plain }
            if pdfExtensions.contains(ext) { return .pdf }
            return nil
        }
        if docBasenames.contains(url.lastPathComponent.lowercased()) { return .plain }
        return nil
    }
```

In `class DocumentStore` (near `maxFileSize`):

```swift
    /// PDF 渲染上限：PDFKit 按需分页，不整文件读成 String，故远高于文本上限。
    package static let pdfMaxFileSize = 50 * 1024 * 1024
```

In `private static func readFromDisk(url: URL, kind: DocumentKind) -> LoadState`, insert a PDF branch immediately after the `fileExists` guard and **before** the `do { … Data(contentsOf:) … }` text-read block:

```swift
        if kind == .pdf {
            do {
                let attrs = try FileManager.default.attributesOfItem(atPath: path)
                let size = (attrs[.size] as? NSNumber)?.intValue ?? 0
                guard size <= Self.pdfMaxFileSize else {
                    return .tooLarge(path: path, size: size)
                }
                return .loaded(Document(
                    url: url,
                    kind: .pdf,
                    text: "",            // PDF is never decoded into a String
                    fileSize: size,
                    modifiedAt: attrs[.modificationDate] as? Date
                ))
            } catch {
                return .unreadable(path: path)
            }
        }
```

In `Sources/PipiUI/Views/DocumentPanel.swift`, add `import PDFKit` at the top, then extend the exhaustive switch in `documentView(_:)`:

```swift
    private func documentView(_ doc: DocumentStore.Document) -> some View {
        ScrollView {
            Group {
                switch doc.kind {
                case .markdown:
                    MarkdownTextView(text: doc.text)
                case .plain:
                    Text(doc.text)
                        .font(Font(chatTypography.codeNSFont))
                        .lineSpacing(chatTypography.lineSpacing)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                case .pdf:
                    PDFKitView(url: doc.url)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlayScrollers()
        }
        .scrollIndicators(.automatic)
    }
```

and append the `PDFKitView` host at the end of the file:

```swift
/// PDFKit host for the document panel's `.pdf` kind. Loads by URL and paginates lazily,
/// so it does NOT read the whole file into a String (the 2 MB text cap does not apply).
private struct PDFKitView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> PDFView {
        let pdfView = PDFView()
        pdfView.autoScales = true
        pdfView.document = PDFDocument(url: url)
        return pdfView
    }

    func updateNSView(_ nsView: PDFView, context: Context) {
        if nsView.document?.documentURL?.path != url.path {
            nsView.document = PDFDocument(url: url)
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass.**

Run: `swift test --filter PipiUITests.DocumentDetectorTests`
Expected: PASS (all detector tests, including the two new PDF ones).

Run: `swift test --filter PipiUITests.DocumentStoreTests`
Expected: PASS (all store tests, including the three new PDF load cases).

- [ ] **Step 5: Commit.**

```bash
git add Sources/PipiUI/DocumentStore.swift Sources/PipiUI/Views/DocumentPanel.swift Tests/PipiUITests/DocumentStoreTests.swift
git commit -m "feat(documents): add PDF previewable kind with PDFKit renderer and 50MB cap"
```

---

## Task 2: DocumentReferenceScanner — pure path-normalization layer

**Files:**
- Create: `Sources/PipiUI/DocumentReferenceScanner.swift`.
- Test: `Tests/PipiUITests/DocumentReferenceScannerTests.swift`.

**Interfaces:**
- Consumes (Task 1): `DocumentDetector.kind(for: URL) -> DocumentKind?` (to drop code/config tokens).
- Consumes (existing): `FileReveal.absolutePathMatches(in:) -> [Range<String.Index>]`, `FileReveal.fileURL(fromCandidate:) -> URL?`, `FileReveal.stripTrailingPunctuation(_:) -> String`.
- Produces (Tasks 3–5 rely on these exact signatures):

```swift
package struct DocumentReference: Equatable, Identifiable {
    package let url: URL              // always absolute, resolved
    package let title: String         // url.lastPathComponent
    package let sourceRange: NSRange  // UTF-16 range in the source plain text (future inline wiring)
    package enum Origin: String, Equatable { case absolute, fileURL, tilde, relativeResolved, uiFallback }
    package let origin: Origin
    package var id: String { url.path }
}

package enum DocumentReferenceScanner {
    /// Pure: text + base → ordered, de-duplicated CANDIDATE references. No filesystem.
    /// Absolute/file:// are emitted unconditionally; tilde is expanded; relative + UI-fallback
    /// candidates carry the resolved absolute URL but are still speculative — the caller
    /// gates them with `filterExisting(_:fileExists:)` off-main. Non-document kinds
    /// (code/config) are dropped here via `DocumentDetector.kind(for:)`.
    package static func references(in text: String, base: URL?) -> [DocumentReference]

    /// Existence gate. Absolute/fileURL/tilde origins are ALWAYS kept (a card may legitimately
    /// show a "missing" state). relativeResolved/uiFallback origins are dropped when
    /// `fileExists` says their resolved URL is absent (bare-prose protection). Order preserved.
    package static func filterExisting(
        _ references: [DocumentReference],
        fileExists: (URL) -> Bool
    ) -> [DocumentReference]

    /// Subagent base: worktreePath wins over projectURL; nil when both absent.
    package static func effectiveBase(worktreePath: String?, projectURL: URL?) -> URL?
}
```

- [ ] **Step 1: Write the failing test.**

Create `Tests/PipiUITests/DocumentReferenceScannerTests.swift`:

```swift
import XCTest
import PipiUI
import Foundation

final class DocumentReferenceScannerTests: XCTestCase {

    private func tmpBase() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-scan-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateExists: true)
        return dir
    }

    func testAbsoluteAndFileURLKeptVerbatim() {
        let text = "see /Users/a/spec.md and file:///Users/a/x.pdf end"
        let refs = DocumentReferenceScanner.references(in: text, base: nil)
        XCTAssertEqual(refs.map(\.url.path), ["/Users/a/spec.md", "/Users/a/x.pdf"])
        XCTAssertEqual(refs.map(\.origin), [.absolute, .fileURL])
    }

    func testRelativeResolvesAgainstBase() throws {
        let base = try tmpBase()
        try "hi".write(to: base.appendingPathComponent("docs/spec.md"), atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: base) }

        let refs = DocumentReferenceScanner.references(in: "see docs/spec.md here", base: base)
        let gated = DocumentReferenceScanner.filterExisting(refs) { url in
            FileManager.default.fileExists(atPath: url.path)
        }
        XCTAssertEqual(gated.count, 1)
        XCTAssertEqual(gated.first?.url.path, base.appendingPathComponent("docs/spec.md").path)
        XCTAssertEqual(gated.first?.origin, .relativeResolved)
    }

    func testNonExistentRelativeDroppedByExistenceGate() {
        let base = URL(fileURLWithPath: "/tmp")
        let refs = DocumentReferenceScanner.references(in: "see docs/nope.md here", base: base)
        let gated = DocumentReferenceScanner.filterExisting(refs) { _ in false }
        XCTAssertTrue(gated.isEmpty, "speculative non-existent relative candidate must not produce a card")
    }

    func testAbsoluteMissingIsKeptSoCardCanShowMissingState() {
        // Absolute paths are not speculative: a card may legitimately render "文件不存在".
        let refs = DocumentReferenceScanner.references(in: "see /Users/ghost/missing.md", base: nil)
        let gated = DocumentReferenceScanner.filterExisting(refs) { _ in false }
        XCTAssertEqual(gated.count, 1)
        XCTAssertEqual(gated.first?.origin, .absolute)
    }

    func testTildeExpansion() {
        let refs = DocumentReferenceScanner.references(in: "see ~/notes/a.md", base: nil)
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs.first?.origin, .tilde)
        XCTAssertEqual(refs.first?.url.path, home + "/notes/a.md")
    }

    func testDotDotStandardization() throws {
        let base = try tmpBase()
        try "x".write(to: base.appendingPathComponent("a.md"), atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: base) }
        let refs = DocumentReferenceScanner.references(in: "see ../a.md", base: base.appendingPathComponent("sub"))
        let gated = DocumentReferenceScanner.filterExisting(refs) { FileManager.default.fileExists(atPath: $0.path) }
        XCTAssertEqual(gated.first?.url.resolvingSymlinksInPath().path,
                       base.appendingPathComponent("a.md").resolvingSymlinksInPath().path)
    }

    func testCodeAndConfigNeverReferenceRegardlessOfExistence() throws {
        let base = try tmpBase()
        try "".write(to: base.appendingPathComponent("main.swift"), atomically: true, encoding: .utf8)
        try "".write(to: base.appendingPathComponent("config.json"), atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: base) }
        let refs = DocumentReferenceScanner.references(in: "see main.swift and config.json", base: base)
        XCTAssertTrue(refs.isEmpty, "code/config must not become document references")
    }

    func testPdfReferencesAsDocument() {
        let refs = DocumentReferenceScanner.references(in: "see /Users/a/paper.pdf", base: nil)
        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs.first?.title, "paper.pdf")
    }

    func testDedupByAbsolutePathAcrossSpellings() throws {
        let base = try tmpBase()
        try "x".write(to: base.appendingPathComponent("same.md"), atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: base) }
        // Two relative spellings of the same absolute file → one reference.
        let refs = DocumentReferenceScanner.references(
            in: "see same.md and ./same.md again", base: base
        )
        let gated = DocumentReferenceScanner.filterExisting(refs) { FileManager.default.fileExists(atPath: $0.path) }
        XCTAssertEqual(gated.count, 1, "same file via different spellings must dedup to one card")
    }

    func testEffectiveBaseWorktreeWins() {
        let wt = URL(fileURLWithPath: "/Users/wt")
        let proj = URL(fileURLWithPath: "/Users/proj")
        XCTAssertEqual(
            DocumentReferenceScanner.effectiveBase(worktreePath: wt.path, projectURL: proj),
            wt
        )
        XCTAssertEqual(
            DocumentReferenceScanner.effectiveBase(worktreePath: nil, projectURL: proj),
            proj
        )
        XCTAssertNil(DocumentReferenceScanner.effectiveBase(worktreePath: nil, projectURL: nil))
    }
}
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `swift test --filter PipiUITests.DocumentReferenceScannerTests`
Expected: COMPILE ERROR — `cannot find 'DocumentReferenceScanner' in scope`.

- [ ] **Step 3: Write minimal implementation.**

Create `Sources/PipiUI/DocumentReferenceScanner.swift`:

```swift
import Foundation

/// One detected reference to a locally-previewable document in chat text.
package struct DocumentReference: Equatable, Identifiable {
    package let url: URL
    package let title: String
    package let sourceRange: NSRange
    package enum Origin: String, Equatable { case absolute, fileURL, tilde, relativeResolved, uiFallback }
    package let origin: Origin
    package var id: String { url.path }
}

/// Pure path-normalization layer: "what documents does this text reference, given a base?"
/// Single source of truth shared by the card builder (v1) and a future relative-path ⌘+click (v1.1).
/// Never touches the filesystem — existence gating is the caller's job (`filterExisting`).
package enum DocumentReferenceScanner {

    package static func references(in text: String, base: URL?) -> [DocumentReference] {
        var candidates: [DocumentReference] = []

        // 1) Absolute + file:// pass — reuse FileReveal verbatim (unchanged behavior).
        for range in FileReveal.absolutePathMatches(in: text) {
            let raw = String(text[range])
            guard let url = FileReveal.fileURL(fromCandidate: raw) else { continue }
            guard DocumentDetector.kind(for: url) != nil else { continue }
            let origin: DocumentReference.Origin = url.scheme == "file" && raw.lowercased().hasPrefix("file://") ? .fileURL : .absolute
            candidates.append(DocumentReference(
                url: url,
                title: url.lastPathComponent,
                sourceRange: NSRange(range, in: text),
                origin: origin
            ))
        }

        // 2) Relative / tilde / UI-fallback pass over whitespace-split tokens. Skip any token
        //    already covered by the absolute pass (e.g. "/Users/a/spec.md" is one whitespace
        //    token but already an .absolute reference — re-deriving it as a relative candidate
        //    would yield a bogus URL and a duplicate card).
        let absoluteRanges = FileReveal.absolutePathMatches(in: text) // [Range<String.Index>]
        func overlapsAbsolute(_ r: Range<String.Index>) -> Bool {
            absoluteRanges.contains { $0.overlaps(r) }
        }
        for (startIdx, endIdx) in tokenRanges(in: text) {
            let tokenRange = startIdx..<endIdx
            if overlapsAbsolute(tokenRange) { continue }
            let raw = String(text[tokenRange])
            let cleaned = FileReveal.stripTrailingPunctuation(raw)
            guard !cleaned.isEmpty else { continue }
            if let ref = reference(forToken: cleaned, range: NSRange(tokenRange, in: text), base: base) {
                candidates.append(ref)
            }
        }

        // 3) Order by source position, dedup by absolute path (first-seen wins).
        candidates.sort { $0.sourceRange.location < $1.sourceRange.location }
        var seen: Set<String> = []
        return candidates.filter { seen.insert($0.id).inserted }
    }

    package static func filterExisting(
        _ references: [DocumentReference],
        fileExists: (URL) -> Bool
    ) -> [DocumentReference] {
        references.filter { ref in
            switch ref.origin {
            case .absolute, .fileURL, .tilde:
                return true // not speculative — a card may show a missing/error state
            case .relativeResolved, .uiFallback:
                return fileExists(ref.url) // bare-prose protection
            }
        }
    }

    package static func effectiveBase(worktreePath: String?, projectURL: URL?) -> URL? {
        if let path = worktreePath?.trimmingCharacters(in: .whitespacesAndNewlines), !path.isEmpty {
            return URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
        }
        return projectURL
    }

    // MARK: - Private tokenization + classification

    private static func reference(
        forToken token: String,
        range: NSRange,
        base: URL?
    ) -> DocumentReference? {
        // Tilde → expand against home, no base required.
        if token.hasPrefix("~") {
            let expanded = (token as NSString).expandingTildeInPath
            let url = URL(fileURLWithPath: expanded).standardizedFileURL
            guard DocumentDetector.kind(for: url) != nil else { return nil }
            return DocumentReference(url: url, title: url.lastPathComponent, sourceRange: range, origin: .tilde)
        }
        let looksPathish = token.contains("/") || token.contains("\\")
        // Relative path with a directory component.
        if looksPathish, token.hasPrefix("./") || token.hasPrefix("../") || token.contains("/") {
            guard let base else { return nil }
            let joined = base.appendingPathComponent(token).standardizedFileURL
            guard DocumentDetector.kind(for: joined) != nil else { return nil }
            return DocumentReference(url: joined, title: joined.lastPathComponent, sourceRange: range, origin: .relativeResolved)
        }
        // UI fallback: bare filename (no separator) ending in a recognized document extension.
        let ext = (token as NSString).pathExtension.lowercased()
        guard !ext.isEmpty,
              DocumentDetector.markdownExtensions.contains(ext)
                || DocumentDetector.plainTextExtensions.contains(ext)
                || DocumentDetector.pdfExtensions.contains(ext)
                || DocumentDetector.docBasenames.contains(token.lowercased())
        else { return nil }
        let resolved: URL = base.map { $0.appendingPathComponent(token).standardizedFileURL }
            ?? URL(fileURLWithPath: token)
        guard DocumentDetector.kind(for: resolved) != nil else { return nil }
        return DocumentReference(url: resolved, title: resolved.lastPathComponent, sourceRange: range, origin: .uiFallback)
    }

    /// Maximal runs of non-whitespace, ASCII-control, and CJK/ASCII path-punct-breaking chars.
    private static func tokenRanges(in text: String) -> [(String.Index, String.Index)] {
        let breakers = CharacterSet.whitespacesAndNewlines
            .union(CharacterSet(charactersIn: "<>\"'`()[]{}|,;。，；：、？！…—（）【】《》「」『』〈〉～·→←↑↓"))
        var ranges: [(String.Index, String.Index)] = []
        var i = text.startIndex
        while i < text.endIndex {
            if breakers.contains(text[i].unicodeScalars.first!) {
                i = text.index(after: i)
                continue
            }
            let start = i
            while i < text.endIndex, !breakers.contains(text[i].unicodeScalars.first!) {
                i = text.index(after: i)
            }
            ranges.append((start, i))
        }
        return ranges
    }
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `swift test --filter PipiUITests.DocumentReferenceScannerTests`
Expected: PASS (all 10 cases).

- [ ] **Step 5: Commit.**

```bash
git add Sources/PipiUI/DocumentReferenceScanner.swift Tests/PipiUITests/DocumentReferenceScannerTests.swift
git commit -m "feat(cards): add pure DocumentReferenceScanner path-normalization layer"
```

---

## Task 3: DocumentSummaryStore — off-main cached summaries + truncation

**Files:**
- Create: `Sources/PipiUI/DocumentSummaryStore.swift`.
- Test: `Tests/PipiUITests/DocumentSummaryStoreTests.swift`.

**Interfaces:**
- Consumes (Task 1): `DocumentKind`, `DocumentStore.maxFileSize`, `DocumentStore.pdfMaxFileSize`.
- Produces (Task 4 relies on these exact names):

```swift
@MainActor
package final class DocumentSummaryStore: ObservableObject {
    package struct Summary: Equatable { package let text: String; init(_ text: String) { self.text = text } }
    package struct Entry: Equatable {
        package enum State: Equatable { case loading; case loaded(Summary); case missing; case tooLarge(size: Int); case unreadable }
        package let state: State
    }
    package static let shared = DocumentSummaryStore()
    package func entry(for absolutePath: String) -> Entry          // sync cache read; NEVER IO
    package func request(for url: URL, kind: DocumentKind)         // idempotent off-main load
    /// Test seam: inject a deterministic loader so tests assert state mapping without IO.
    package func setEntryForTesting(_ entry: Entry, for absolutePath: String)
}

package enum DocumentSummaryTruncation {
    package static func truncate(_ text: String, maxChars: Int = 240, maxLines: Int = 6) -> String
}
```

- [ ] **Step 1: Write the failing test.**

Create `Tests/PipiUITests/DocumentSummaryStoreTests.swift`:

```swift
import XCTest
import PipiUI
import Foundation

@MainActor
final class DocumentSummaryStoreTests: XCTestCase {

    private var tempDir: URL!
    override func setUp() async throws {
        tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-sum-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    }
    override func tearDown() async throws { try? FileManager.default.removeItem(at: tempDir) }

    private func write(_ name: String, _ contents: String) throws -> URL {
        let url = tempDir.appendingPathComponent(name)
        try contents.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    func testTruncationCharCapAppendsEllipsis() {
        let long = String(repeating: "字", count: 300)
        let t = DocumentSummaryTruncation.truncate(long)
        XCTAssertLessThanOrEqual(t.count, 240 + 1) // 240 chars + "…"
        XCTAssertTrue(t.hasSuffix("…"))
    }

    func testTruncationLineCapBeatsCharCap() {
        let eightShortLines = (1...8).map { "L\($0)" }.joined(separator: "\n")
        let t = DocumentSummaryTruncation.truncate(eightShortLines)
        // ≤6 lines ⇒ at most 5 interior newlines.
        XCTAssertLessThanOrEqual(t.components(separatedBy: "\n").count, 6)
    }

    func testTruncationNoCutWhenUnderBothCaps() {
        let t = DocumentSummaryTruncation.truncate("short")
        XCTAssertEqual(t, "short")
    }

    func testLoadedSummaryForTextKind() async throws {
        let store = DocumentSummaryStore.shared
        let url = try write("note.md", "# Title\nbody text")
        store.request(for: url, kind: .markdown)
        await settled(store, path: url.path)
        let entry = store.entry(for: url.path)
        guard case .loaded(let summary) = entry.state else {
            return XCTFail("expected .loaded, got \(entry.state)")
        }
        XCTAssertEqual(summary.text, "# Title\nbody text")
    }

    func testMissingStateForAbsentFile() async {
        let store = DocumentSummaryStore.shared
        let url = tempDir.appendingPathComponent("ghost.md")
        store.request(for: url, kind: .markdown)
        await settled(store, path: url.path)
        if case .loaded = store.entry(for: url.path).state { XCTFail("must not load a missing file") }
        XCTAssertEqual(store.entry(for: url.path).state, .missing)
    }

    func testTooLargeStateAboveTextCap() async throws {
        let store = DocumentSummaryStore.shared
        let url = tempDir.appendingPathComponent("big.md")
        FileManager.default.createFile(atPath: url.path, contents: nil)
        let handle = try FileHandle(forWritingTo: url)
        try handle.truncate(atOffset: UInt64(DocumentStore.maxFileSize + 1))
        try handle.close()
        store.request(for: url, kind: .markdown)
        await settled(store, path: url.path)
        guard case .tooLarge = store.entry(for: url.path).state else {
            return XCTFail("expected .tooLarge, got \(store.entry(for: url.path).state)")
        }
    }

    func testEntryReadNeverPerformsIO() {
        // Deterministic stub: entry(for:) returns a pre-seeded value with no disk access.
        let store = DocumentSummaryStore.shared
        store.setEntryForTesting(.init(state: .loaded(DocumentSummaryStore.Summary("stub"))), for: "/no/such/path/at/all")
        let entry = store.entry(for: "/no/such/path/at/all")
        guard case .loaded(let s) = entry.state, s.text == "stub" else {
            XCTFail("expected seeded loaded stub, got \(entry.state)")
        }
    }

    private func settled(_ store: DocumentSummaryStore, path: String, timeout: TimeInterval = 5) async {
        // The off-main load publishes on main; poll until the entry is non-loading.
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if case .loading = store.entry(for: path).state {
                try? await Task.sleep(for: .milliseconds(10)); continue
            }
            return
        }
        XCTFail("summary load did not settle within \(timeout)s for \(path)")
    }
}
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `swift test --filter PipiUITests.DocumentSummaryStoreTests`
Expected: COMPILE ERROR — `cannot find 'DocumentSummaryStore' in scope`.

- [ ] **Step 3: Write minimal implementation.**

Create `Sources/PipiUI/DocumentSummaryStore.swift`:

```swift
import Foundation

/// Pure summary truncation: ≤ maxChars AND ≤ maxLines, trimmed, "…" appended when cut.
/// Character-based (CJK-safe), never byte-based.
package enum DocumentSummaryTruncation {
    package static func truncate(_ text: String, maxChars: Int = 240, maxLines: Int = 6) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        var lines = trimmed.split(separator: "\n", omittingEmptySubsequences: false)
        let overLines = lines.count > maxLines
        if overLines { lines = Array(lines.prefix(maxLines)) }
        var s = lines.joined(separator: "\n")
        let overChars = s.count > maxChars
        if overChars {
            s = String(s.prefix(maxChars))
        }
        if overLines || overChars {
            s += "…"
        }
        return s
    }
}

/// Off-main, cached content summaries for document reference cards. Process-wide `NSCache`
/// keyed by absolute path (transcript text is immutable → warm session switch hits cache,
/// mirroring `PathLinkCache`). `entry(for:)` is a sync cache read and NEVER touches disk;
/// `request(for:kind:)` kicks an idempotent background load.
@MainActor
package final class DocumentSummaryStore: ObservableObject {

    package struct Summary: Equatable {
        package let text: String
        package init(_ text: String) { self.text = text }
    }

    package struct Entry: Equatable {
        package enum State: Equatable {
            case loading
            case loaded(Summary)
            case missing
            case tooLarge(size: Int)
            case unreadable
        }
        package let state: State
        package init(state: State) { self.state = state }
    }

    package static let shared = DocumentSummaryStore()

    private let cache: NSCache<NSString, Box> = {
        let c = NSCache<NSString, Box>()
        c.countLimit = 1000
        return c
    }()
    private final class Box { let entry: Entry; init(_ entry: Entry) { self.entry = entry } }

    package init() {}

    /// Sync cache read. Returns `.loading` when nothing is cached yet — never reads disk.
    package func entry(for absolutePath: String) -> Entry {
        if let box = cache.object(forKey: absolutePath as NSString) { return box.entry }
        return Entry(state: .loading)
    }

    /// Kick an off-main load if no entry is cached for `url.path`. Idempotent: a pending
    /// `.loading` entry is set synchronously so repeated calls do not re-schedule IO.
    package func request(for url: URL, kind: DocumentKind) {
        let key = url.path as NSString
        if cache.object(forKey: key) != nil { return }
        cache.setObject(Box(Entry(state: .loading)), forKey: key)
        let path = url.path
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let entry = Self.compute(url: url, kind: kind)
            Task { @MainActor in
                self?.cache.setObject(Box(entry), forKey: key)
                self?.objectWillChange.send()
                _ = path // keep `path` live for diagnostics if needed
            }
        }
    }

    /// Test seam.
    package func setEntryForTesting(_ entry: Entry, for absolutePath: String) {
        cache.setObject(Box(entry), forKey: absolutePath as NSString)
        objectWillChange.send()
    }

    // MARK: - Disk read (off-main)

    private static func compute(url: URL, kind: DocumentKind) -> Entry {
        let path = url.path
        guard FileManager.default.fileExists(atPath: path) else {
            return Entry(state: .missing)
        }
        if kind == .pdf {
            return computePDF(url: url)
        }
        return computeText(url: url)
    }

    private static func computeText(url: URL) -> Entry {
        let path = url.path
        do {
            let attrs = try FileManager.default.attributesOfItem(atPath: path)
            let size = (attrs[.size] as? NSNumber)?.intValue ?? 0
            guard size <= DocumentStore.maxFileSize else {
                return Entry(state: .tooLarge(size: size))
            }
            let data = try Data(contentsOf: url, options: [.mappedIfSafe])
            let raw = String(decoding: data, as: UTF8.self)
            return Entry(state: .loaded(Summary(DocumentSummaryTruncation.truncate(raw))))
        } catch {
            return Entry(state: .unreadable)
        }
    }

    private static func computePDF(url: URL) -> Entry {
        let path = url.path
        do {
            let attrs = try FileManager.default.attributesOfItem(atPath: path)
            let size = (attrs[.size] as? NSNumber)?.intValue ?? 0
            guard size <= DocumentStore.pdfMaxFileSize else {
                return Entry(state: .tooLarge(size: size))
            }
            // Minimal v1 summary (page count is a documented follow-up, design §11).
            return Entry(state: .loaded(Summary("PDF 文档")))
        } catch {
            return Entry(state: .unreadable)
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `swift test --filter PipiUITests.DocumentSummaryStoreTests`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit.**

```bash
git add Sources/PipiUI/DocumentSummaryStore.swift Tests/PipiUITests/DocumentSummaryStoreTests.swift
git commit -m "feat(cards): add DocumentSummaryStore with off-main cached summaries and truncation"
```

---

## Task 4: DocumentFileCardView + DocumentFileCardStack + message-bottom wiring

**Files:**
- Modify: `Sources/PipiUI/Views/MessageViews.swift` (add `DocumentFileCardView`, `DocumentFileCardStack` + `visibleCards`; attach stack in `AssistantSegmentsView.segmentsBody`; compute `documentCards`).
- Test: `Tests/PipiUITests/DocumentFileCardStackTests.swift`.

**Interfaces:**
- Consumes (Task 2): `DocumentReference`, `DocumentReference.Origin`, `DocumentReferenceScanner.references(in:base:)`, `DocumentReferenceScanner.filterExisting(_:fileExists:)`.
- Consumes (Task 3): `DocumentSummaryStore.shared`, `DocumentSummaryStore.Entry`, `DocumentSummaryStore.Entry.State`, `DocumentSummaryStore.Summary`.
- Consumes (existing): `@Environment(\.openDocument)` (injected by `ChatDetailView`), `DocumentDetector.kind(for:)`.
- Produces (Task 5 relies on these exact names): `DocumentFileCardStack(references: [DocumentReference])` (it reads `DocumentSummaryStore.shared` itself), and the pure `DocumentFileCardStack.visibleCards(_:entry:) -> [DocumentReference]`.

- [ ] **Step 1: Write the failing test.**

Create `Tests/PipiUITests/DocumentFileCardStackTests.swift`:

```swift
import XCTest
import PipiUI
import Foundation

final class DocumentFileCardStackTests: XCTestCase {

    private func ref(_ path: String, _ origin: DocumentReference.Origin) -> DocumentReference {
        let url = URL(fileURLWithPath: path)
        return DocumentReference(
            url: url, title: url.lastPathComponent,
            sourceRange: NSRange(location: 0, length: 1), origin: origin
        )
    }

    private func loaded() -> DocumentSummaryStore.Entry { .init(state: .loaded(DocumentSummaryStore.Summary("body"))) }
    private func loading() -> DocumentSummaryStore.Entry { .init(state: .loading) }
    private func missing() -> DocumentSummaryStore.Entry { .init(state: .missing) }

    func testAbsoluteShowsEvenWhenMissing() {
        let candidates = [ref("/Users/a/abs.md", .absolute)]
        let visible = DocumentFileCardStack.visibleCards(candidates) { _ in missing() }
        XCTAssertEqual(visible.count, 1)
    }

    func testSpeculativeHiddenWhenMissingOrLoading() {
        let candidates = [
            ref("/proj/rel.md", .relativeResolved),
            ref("/proj/bare.txt", .uiFallback),
        ]
        let visibleMissing = DocumentFileCardStack.visibleCards(candidates) { _ in missing() }
        XCTAssertTrue(visibleMissing.isEmpty, "speculative missing → no card (bare-prose protection)")
        let visibleLoading = DocumentFileCardStack.visibleCards(candidates) { _ in loading() }
        XCTAssertTrue(visibleLoading.isEmpty, "speculative not-yet-checked → no card")
    }

    func testSpeculativeShownWhenFileConfirmedPresent() {
        let candidates = [ref("/proj/rel.md", .relativeResolved)]
        let visible = DocumentFileCardStack.visibleCards(candidates) { _ in loaded() }
        XCTAssertEqual(visible.count, 1)
    }

    func testOrderAndDedupPreservedFromCandidates() {
        let candidates = [
            ref("/proj/a.md", .absolute),
            ref("/proj/b.md", .relativeResolved),
        ]
        let visible = DocumentFileCardStack.visibleCards(candidates) { _ in loaded() }
        XCTAssertEqual(visible.map(\.title), ["a.md", "b.md"])
    }
}
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `swift test --filter PipiUITests.DocumentFileCardStackTests`
Expected: COMPILE ERROR — `cannot find 'DocumentFileCardStack' in scope`.

- [ ] **Step 3: Write minimal implementation.**

In `Sources/PipiUI/Views/MessageViews.swift`, add the card view + stack (e.g. near `ToolCardView`). `DocumentFileCardStack` reads `DocumentSummaryStore.shared` via `@ObservedObject`; the candidate list is computed by the parent and passed in:

```swift
/// One document reference card: filename + absolute path + length-limited summary.
/// Whole-card tap reuses the existing `@Environment(\.openDocument)` hook (same path as
/// ⌘+click), so the right-hand DocumentPanel opens identically.
struct DocumentFileCardView: View {
    let reference: DocumentReference
    @ObservedObject private var store = DocumentSummaryStore.shared
    @Environment(\.openDocument) private var openDocument

    private var entry: DocumentSummaryStore.Entry { store.entry(for: reference.url.path) }

    var body: some View {
        Button {
            openDocument?(reference.url)
        } label: {
            cardBody
        }
        .buttonStyle(.plain)
        .onAppear { prefetch() }
        .onChange(of: reference.url.path) { _, _ in prefetch() }
    }

    private func prefetch() {
        guard let kind = DocumentDetector.kind(for: reference.url) else { return }
        store.request(for: reference.url, kind: kind)
    }

    private var cardBody: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "doc")
                    .foregroundStyle(.secondary)
                Text(reference.title)
                    .font(.callout.weight(.medium))
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.forward.app")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            Text(reference.url.path)
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .lineLimit(1)
                .truncationMode(.middle)
            bodyText
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.035)))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.08)))
        .contentShape(Rectangle())
        .pointingHandCursor(openDocument != nil)
    }

    @ViewBuilder
    private var bodyText: some View {
        switch entry.state {
        case .loading:
            HStack(spacing: 6) { ProgressView().controlSize(.mini); Text("读取中…") }
        case .loaded(let summary):
            Text(summary.text)
        case .missing:
            Text("文件不存在").foregroundStyle(.red)
        case .tooLarge(let size):
            Text("文件过大（\(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))）")
        case .unreadable:
            Text("无法读取（权限?）").foregroundStyle(.red)
        }
    }
}

/// Sibling card stack at the bottom of a message. Reads the shared summary store for
/// per-path state; shows speculative (relative/UI-fallback) cards only after the off-main
/// existence check confirms the file is present.
struct DocumentFileCardStack: View, Equatable {
    let references: [DocumentReference]

    static func == (lhs: DocumentFileCardStack, rhs: DocumentFileCardStack) -> Bool {
        lhs.references == rhs.references
    }

    @ObservedObject private var store = DocumentSummaryStore.shared

    var body: some View {
        let visible = Self.visibleCards(references) { store.entry(for: $0) }
        VStack(alignment: .leading, spacing: 6) {
            ForEach(visible) { ref in
                DocumentFileCardView(reference: ref)
            }
        }
    }

    /// Pure: which candidate references produce a visible card given current summary entries.
    /// Absolute/fileURL/tilde origins always show (a card may legitimately show a missing
    /// state). Speculative (relativeResolved/uiFallback) origins show only when the file is
    /// confirmed present (`.loaded`/`.tooLarge`/`.unreadable`), never while `.missing` or
    /// still `.loading` — that is the bare-prose protection.
    static func visibleCards(
        _ candidates: [DocumentReference],
        entry: (String) -> DocumentSummaryStore.Entry
    ) -> [DocumentReference] {
        candidates.filter { ref in
            switch ref.origin {
            case .absolute, .fileURL, .tilde:
                return true
            case .relativeResolved, .uiFallback:
                switch entry(ref.id).state {
                case .loaded, .tooLarge, .unreadable: return true
                case .loading, .missing: return false
                }
            }
        }
    }
}
```

Then wire it into `AssistantSegmentsView`. Add a computed candidate list and append the stack as the **last child** of the existing `VStack` in `segmentsBody` (the markdown body stays un-split — the stack is a sibling, exactly like `ToolCardView`):

```swift
    @ViewBuilder
    private var segmentsBody: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                switch segment {
                case .text(let text):
                    MarkdownTextView(text: text, onFlash: onFlash)
                case .image(let img):
                    ImageThumbnailView(
                        data: img.data,
                        mimeType: img.mimeType,
                        path: img.path,
                        maxWidth: 360,
                        maxHeight: 240,
                        projectURL: projectURL,
                        onFlash: onFlash
                    )
                case .video(let vid):
                    VideoBlockView(path: vid.path, onFlash: onFlash)
                case .singleton(let block):
                    assistantBlockView(block)
                case .finishedGroup(let blocks):
                    FinishedNonTextGroupView(
                        blocks: blocks,
                        toolRuns: toolRuns,
                        subagents: subagents,
                        projectURL: projectURL,
                        onFlash: onFlash,
                        onSelectAgent: onSelectAgent
                    )
                }
            }
            if !documentCards.isEmpty {
                DocumentFileCardStack(references: documentCards)
            }
        }
    }

    /// Pure candidate references for all `.text` segments joined, resolved against
    /// `projectURL` (main-chat base). Existence gating for speculative candidates is
    /// handled off-main by `DocumentSummaryStore`; the stack hides them until resolved.
    private var documentCards: [DocumentReference] {
        let joined = segments.compactMap { segment -> String? in
            if case .text(let text) = segment { return text }
            return nil
        }.joined(separator: "\n")
        let candidates = DocumentReferenceScanner.references(in: joined, base: projectURL)
        return DocumentReferenceScanner.filterExisting(candidates) { url in
            FileManager.default.fileExists(atPath: url.path)
        }
    }
```

> **Why `documentCards` may call `FileManager.fileExists` in `body` and still satisfy "no IO in body":** it only runs `fileExists` for the **absolute/tilde/fileURL** candidates that `filterExisting` keeps unconditionally — wait, that is not what we want. Correct design: `documentCards` returns the **pure candidate list without existence filtering** for speculative origins, and `DocumentFileCardStack.visibleCards` (backed by the off-main store) decides per-speculative visibility. Replace the `documentCards` body with:

```swift
    private var documentCards: [DocumentReference] {
        let joined = segments.compactMap { segment -> String? in
            if case .text(let text) = segment { return text }
            return nil
        }.joined(separator: "\n")
        // Pure candidates only — NO fileExists here (avoids main-thread IO).
        // filterExisting with a trivially-true predicate keeps absolute/tilde/fileURL
        // and all speculative candidates; the per-path existence decision is deferred
        // to the off-main DocumentSummaryStore via DocumentFileCardStack.visibleCards.
        return DocumentReferenceScanner.filterExisting(
            DocumentReferenceScanner.references(in: joined, base: projectURL)
        ) { _ in true }
    }
```

> Net effect: main-thread `body` does pure scanner work only; `DocumentSummaryStore.request` does the off-main existence check; speculative cards appear once the store publishes a "file present" state. This is what keeps `testSpeculativeHiddenWhenMissingOrLoading` meaningful.

- [ ] **Step 4: Run test to verify it passes; build to confirm the SwiftUI wiring compiles.**

Run: `swift test --filter PipiUITests.DocumentFileCardStackTests`
Expected: PASS (all 4 cases).

Run: `swift build`
Expected: PASS (the new views compile; `AssistantSegmentsView` Equatable still holds because `DocumentFileCardStack` is itself `Equatable` on its references).

- [ ] **Step 5: Commit.**

```bash
git add Sources/PipiUI/Views/MessageViews.swift Tests/PipiUITests/DocumentFileCardStackTests.swift
git commit -m "feat(cards): add DocumentFileCardView/Stack and message-bottom wiring in AssistantSegmentsView"
```

---

## Task 5: Subagent worktree base resolution (AgentLogRow + [subagent-done] bubble)

**Files:**
- Modify: `Sources/PipiUI/Views/SubagentPanel.swift` (`AgentDetailView` → `AgentLogRow`: pass `base`; add `DocumentFileCardStack` under the default case).
- Modify: `Sources/PipiUI/Views/MessageViews.swift` (`SubagentDoneBubbleView`: accept `base: URL?`, add `DocumentFileCardStack`).
- Test: `Tests/PipiUITests/DocumentReferenceScannerTests.swift` (extend with a divergence test).

**Interfaces:**
- Consumes (Task 2): `DocumentReferenceScanner.effectiveBase(worktreePath:projectURL:)`, `DocumentReferenceScanner.references(in:base:)`.
- Consumes (Task 4): `DocumentFileCardStack`.
- Produces: subagent-authored text resolves relative document references against `agent.worktreePath` (fallback `projectURL`), proving the two surfaces diverge correctly.

- [ ] **Step 1: Write the failing test.**

Append to `Tests/PipiUITests/DocumentReferenceScannerTests.swift`:

```swift
    func testSubagentBaseDivergesFromProjectBase() throws {
        // Same relative mention, two surfaces → two different resolved files.
        let worktree = try tmpBase()
        let project = try tmpBase()
        try "wt".write(to: worktree.appendingPathComponent("out/r.txt"), atomically: true, encoding: .utf8)
        try "proj".write(to: project.appendingPathComponent("out/r.txt"), atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: worktree); try? FileManager.default.removeItem(at: project) }

        let subagentBase = DocumentReferenceScanner.effectiveBase(worktreePath: worktree.path, projectURL: project)
        let mainBase = DocumentReferenceScanner.effectiveBase(worktreePath: nil, projectURL: project)

        let subRefs = DocumentReferenceScanner.references(in: "see out/r.txt", base: subagentBase)
        let mainRefs = DocumentReferenceScanner.references(in: "see out/r.txt", base: mainBase)

        let subGated = DocumentReferenceScanner.filterExisting(subRefs) { FileManager.default.fileExists(atPath: $0.path) }
        let mainGated = DocumentReferenceScanner.filterExisting(mainRefs) { FileManager.default.fileExists(atPath: $0.path) }

        XCTAssertEqual(subGated.first?.url.path, worktree.appendingPathComponent("out/r.txt").path)
        XCTAssertEqual(mainGated.first?.url.path, project.appendingPathComponent("out/r.txt").path)
        XCTAssertNotEqual(subGated.first?.url.path, mainGated.first?.url.path,
                          "subagent text must resolve against its worktree, not the project root")
    }

    func testSubagentBaseFallsBackToProjectWhenNoWorktree() throws {
        let project = try tmpBase()
        try "x".write(to: project.appendingPathComponent("a.md"), atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: project) }
        let base = DocumentReferenceScanner.effectiveBase(worktreePath: nil, projectURL: project)
        let refs = DocumentReferenceScanner.references(in: "see a.md", base: base)
        let gated = DocumentReferenceScanner.filterExisting(refs) { FileManager.default.fileExists(atPath: $0.path) }
        XCTAssertEqual(gated.first?.url.path, project.appendingPathComponent("a.md").path)
    }
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `swift test --filter PipiUITests.DocumentReferenceScannerTests.testSubagentBaseDivergesFromProjectBase`
Expected: PASS already if `effectiveBase` is correct from Task 2 — but the test exists to lock in the wiring intent of THIS task. If it fails, `effectiveBase` is wrong; fix it per Task 2's spec before proceeding. (If it passes on Task 2's impl, this step is a green precondition gate for the UI wiring below.)

- [ ] **Step 3: Write minimal implementation (SwiftUI wiring).**

In `Sources/PipiUI/Views/SubagentPanel.swift`, thread a base into `AgentLogRow` from `AgentDetailView` and append a card stack under the default `MarkdownTextView` case:

```swift
private struct AgentDetailView: View {
    let agent: SubagentInfo
    @ObservedObject var store: SubagentStore
    var projectURL: URL
    // ...existing code...

    private var documentBase: URL? {
        DocumentReferenceScanner.effectiveBase(worktreePath: agent.worktreePath, projectURL: projectURL)
    }

    // Inside the LazyVStack ForEach, replace:
    //     AgentLogRow(item: item)
    // with:
    //     AgentLogRow(item: item, base: documentBase)
}

private struct AgentLogRow: View {
    let item: AgentLogItem
    var base: URL? = nil
    @State private var expanded = false

    var body: some View {
        switch item.kind {
        // ...thinking / tool / toolResult unchanged...
        default:
            VStack(alignment: .leading, spacing: 6) {
                MarkdownTextView(text: item.text)
                let cards = DocumentReferenceScanner.filterExisting(
                    DocumentReferenceScanner.references(in: item.text, base: base)
                ) { _ in true }
                if !cards.isEmpty {
                    DocumentFileCardStack(references: cards)
                }
            }
        }
    }
    // ...existing toolSummary / toolRow...
}
```

In `Sources/PipiUI/Views/MessageViews.swift`, give `SubagentDoneBubbleView` a base and a card stack. `MessageRow` already has `projectURL` and `subagents: [SubagentInfo]`; the `[subagent-done]` text is parsed by `SubagentDoneMessage.parse(text)` which yields `agentId`, so look up the matching agent's `worktreePath`:

```swift
struct SubagentDoneBubbleView: View {
    let text: String
    var base: URL? = nil            // NEW — effective worktree/project base
    var onFlash: ((String) -> Void)? = nil
    @State private var expanded = false
    // ...existing parsed / outcomeIcon / outcomeColor / outcomeLabel / summaryTitle...

    private var documentCards: [DocumentReference] {
        let bodyText = parsed?.result.isEmpty == false ? parsed!.result : text
        return DocumentReferenceScanner.filterExisting(
            DocumentReferenceScanner.references(in: bodyText, base: base)
        ) { _ in true }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // ...existing header row unchanged...
            if expanded {
                VStack(alignment: .leading, spacing: 8) {
                    // ...existing Task/PathLinkedText block unchanged...
                    if !documentCards.isEmpty {
                        DocumentFileCardStack(references: documentCards)
                    }
                }
                .padding(.top, 6)
            }
        }
        // ...existing padding/background/accessibility unchanged...
    }
}
```

And in `MessageRow.userBubble`, pass the base by resolving `SubagentDoneMessage.parse(userDisplayText)?.agentId` against `subagents`:

```swift
        if userDisplayText.hasPrefix("[subagent-done]") {
            let agentBase: URL? = {
                if let aid = SubagentDoneMessage.parse(userDisplayText)?.agentId,
                   let wt = subagents.first(where: { $0.id == aid })?.worktreePath {
                    return DocumentReferenceScanner.effectiveBase(worktreePath: wt, projectURL: projectURL)
                }
                return projectURL
            }()
            VStack(alignment: .trailing, spacing: 8) {
                userImageThumbnails
                SubagentDoneBubbleView(text: userDisplayText, base: agentBase, onFlash: onFlash)
            }
        }
```

- [ ] **Step 4: Run test to verify it passes; build to confirm wiring compiles.**

Run: `swift test --filter PipiUITests.DocumentReferenceScannerTests`
Expected: PASS (all scanner cases including the two new divergence/fallback ones).

Run: `swift build`
Expected: PASS (`AgentLogRow`/`SubagentDoneBubbleView` compile with the new base threading; no other call site breaks because `base` has a default `nil`).

- [ ] **Step 5: Commit.**

```bash
git add Sources/PipiUI/Views/SubagentPanel.swift Sources/PipiUI/Views/MessageViews.swift Tests/PipiUITests/DocumentReferenceScannerTests.swift
git commit -m "feat(cards): resolve subagent-authored document refs against worktree path"
```

---

## Acceptance & Verification (CONSTITUTION §2, §3)

**Worktree / worker (every task, and the whole feature):** `swift build` and `swift test` must pass. **Must NOT** run `make-app.sh` / `build-app.sh` or create `build/PipiUI.app`.

```bash
swift build                                  # exit 0
swift test                                   # exit 0 (full suite; no selection/path regression)
swift test --filter PipiUITests.DocumentReferenceScannerTests
swift test --filter PipiUITests.DocumentSummaryStoreTests
swift test --filter PipiUITests.DocumentFileCardStackTests
swift test --filter PipiUITests.DocumentStoreTests
swift test --filter PipiUITests.FileRevealTests               # absolute-path behavior unchanged
swift test --filter PipiUITests.MarkdownSelectionContentTests # single-NSTextStorage guarantee intact
```

Focused-test expectations: each filter exits 0 with all its cases passing.

**Primary checkout ONLY (after all five tasks land in `/Users/haoli/leehow/code/pipiui`):**

```bash
cd /Users/haoli/leehow/code/pipiui
./scripts/build-app.sh        # tests (optional skip via flag) then make-app.sh → build/PipiUI.app
./make-app.sh                 # sole release package location
stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' \
  build/PipiUI.app/Contents/MacOS/PipiUI \
  Sources/PipiUI/DocumentReferenceScanner.swift \
  Sources/PipiUI/DocumentSummaryStore.swift \
  Sources/PipiUI/DocumentStore.swift \
  Sources/PipiUI/Views/DocumentPanel.swift \
  Sources/PipiUI/Views/MessageViews.swift \
  Sources/PipiUI/Views/SubagentPanel.swift
```

The `build/PipiUI.app` binary MUST be newer than every changed source (CONSTITUTION §2). Do **not** report "done / open the app" based only on a fresh `.build/*`.

**Manual behavioral acceptance (design §10.2), each verified by the implementer on the packaged app:**

1. Agent message containing `see docs/spec.md` (relative) → a card titled `spec.md` with the project-root-resolved absolute path and a short summary; clicking opens the right `DocumentPanel` rendering the markdown.
2. Same for `.txt`/`.log` (plain) and `.pdf` (PDFKit).
3. Absolute `/Users/.../notes.md` and `file:///.../a.pdf` still produce cards and still ⌘+click-reveal in Finder (no regression).
4. `src/main.swift` / `config.yaml` produce **no** card; absolute-form ⌘+click still reveals in Finder.
5. Missing / too-large / unreadable references show the matching card body and still route to the panel's matching placeholder on click.
6. Subagent `[subagent-done]` result + `AgentLogRow` referencing a relative path resolve against that agent's `worktreePath`; if the worktree was merged/removed, the card shows "文件不存在" gracefully.
7. Cross-paragraph Markdown drag selection still copies the full selected range (cards are siblings — `MarkdownSelectionContentTests` green is the proof).
8. Streaming an assistant message that mentions the same file three times shows exactly one card, with no per-frame file reads (the card reads `DocumentSummaryStore.shared`, which only reads disk off-main).
9. `DocumentSummaryStore` cache hit on session switch (second open is instant).

---

## Self-Review (run by the plan author; design §12 parity)

### 1. Spec coverage

| Design requirement (spec §) | Implemented by |
|---|---|
| §2 recognize md/txt/log/basenames/**pdf**; cards; click→`DocumentPanel` | Task 1 (pdf kind/preview), Task 4 (card + openDocument wiring) |
| §2 / §5 absolute + `file://` pass through; relative/tilde resolution; subagent `worktreePath` base | Task 2 (`DocumentReferenceScanner`, `effectiveBase`), Task 5 (subagent wiring) |
| §3 code/config → no card; non-goals untouched | Task 2 (`DocumentDetector.kind` filter drops them) |
| §4 goals: relative→card; base unambiguous; no Markdown selection regression; no IO in `body`; bounded streaming cost | Task 4 (sibling stack, `visibleCards`, off-main store), Task 2 dedup, `MarkdownSelectionContentTests` green |
| §5 three layers + base table | Task 2 (layers 1–3 via `references` + `filterExisting`), Task 5 (subagent base = layer 2 subagent rule) |
| §6 PDF: `DocumentKind.pdf` + PDFKit + 50 MB attribute cap + minimal summary | Task 1 (kind, `PDFKitView`, `pdfMaxFileSize`, `readFromDisk` PDF branch), Task 3 (`computePDF`) |
| §7.1 `DocumentFileCardView` title/subtitle/summary + click→openDocument | Task 4 |
| §7.2 off-main cached summary store; truncation ≤240c/≤6L CJK-safe; `NSCache` by path; states mirror `LoadState`; no IO in `body` | Task 3 (`DocumentSummaryStore`, `DocumentSummaryTruncation`), Task 4 (`entry(for:)` read-only in body) |
| §7.3 UI states table | Task 4 `bodyText` switch (loading/loaded/missing/tooLarge/unreadable) |
| §8 placement: sibling stack, Markdown un-split; ≥2 alternatives recorded | Task 4 (sibling `DocumentFileCardStack`); design §8.2 (this plan inherits the recommended Alt C) |
| §8.3 streaming dedup + idempotent prefetch | Task 2 dedup by `id`; Task 4 `request` idempotency + `visibleCards` |
| §9 files-to-touch table | File Map above (incl. explicit "no change" for `FileReveal`/`PathLinkedText`/`MarkdownView`/`ChatDetailView`) |
| §10 tests (scanner/summary/detector) + behavioral + CONSTITUTION verify | Tasks 1–5 test files; Acceptance section |
| §11 follow-ups stay out of v1 | None of the follow-ups (relative ⌘+click, per-segment placement, PDF page count, tool-result cards) are implemented here |

No spec section is unaddressed.

### 2. Placeholder scan

Searched the plan for `TBD`, `TODO`, `implement later`, `fill in`, `add appropriate`, `handle edge cases`, `similar to Task`, and bare descriptive-without-code steps. **None present.** Every code/test step contains real, copy-pasteable Swift or shell. The one deliberate typo (`appendendingPathComponent`) in Task 1 Step 1 is flagged inline as a transcription note, not a placeholder.

### 3. Interface consistency

Cross-checked names/types used in later tasks against definitions in earlier tasks:

- `DocumentKind.pdf` — defined Task 1, used Task 1 (`readFromDisk`), Task 3 (`request(for:kind:)`/`compute`), Task 4 (`DocumentDetector.kind`).
- `DocumentDetector.pdfExtensions` — defined Task 1, used Task 2 (`reference(forToken:)` UI-fallback branch).
- `DocumentStore.pdfMaxFileSize` — defined Task 1, used Task 3 (`computePDF`).
- `DocumentReference` / `DocumentReference.Origin` (`.absolute/.fileURL/.tilde/.relativeResolved/.uiFallback`) — defined Task 2, used Tasks 4 & 5 (`visibleCards`, `documentCards`).
- `DocumentReferenceScanner.references(in:base:)` / `.filterExisting(_:fileExists:)` / `.effectiveBase(worktreePath:projectURL:)` — defined Task 2, used Tasks 4 & 5.
- `DocumentSummaryStore.shared` / `.Entry` / `.Entry.State` (`.loading/.loaded/.missing/.tooLarge/.unreadable`) / `.Summary` / `.entry(for:)` / `.request(for:kind:)` — defined Task 3, used Task 4 (`DocumentFileCardView`, `visibleCards`, test stub).
- `DocumentSummaryTruncation.truncate(_:maxChars:maxLines:)` — defined Task 3, used Task 3 (`computeText`).
- `DocumentFileCardStack(references:)` / `.visibleCards(_:entry:)` — defined Task 4, used Task 5 (`AgentLogRow`, `SubagentDoneBubbleView`).
- `PDFKitView(url:)` — defined Task 1, used Task 1 (`DocumentPanel.documentView` `.pdf`).

No `clearLayers`/`clearFullLayers`-style mismatches found.
