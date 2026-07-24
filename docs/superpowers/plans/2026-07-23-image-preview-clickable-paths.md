# Image Preview + Clickable Paths

## Goal
Thumbnails enlarge in lightbox; images and absolute paths reveal in Finder; ImageBlock optional path.

## Boss decisions
1. Lightbox: user + assistant + tool images
2. Reveal = NSWorkspace.shared.activateFileViewerSelecting (not open) unless separate "打开"
3. ImageBlock.path: String? optional
4. Missing path: match .pi/attachments by content; else 存储… NSSavePanel
5. Clickable absolute paths + file:// in markdown prose, tool text; NOT aggressive inside fenced code
6. Shared FileReveal helpers
7. fullScreenCover lightbox; contextMenu on images
8. Composer drafts: enlarge OK; reveal only if path known
9. Unit tests for path detection
10. Update README known-limits

## Files
- NEW Sources/PipiUI/FileReveal.swift
- NEW Sources/PipiUI/ImagePathResolver.swift
- NEW Sources/PipiUI/Views/ImagePreview.swift
- NEW Sources/PipiUI/Views/PathLinkedText.swift
- NEW Tests/PipiUITests/FileRevealTests.swift
- NEW Tests/PipiUITests/ImagePathResolverTests.swift
- MOD Sources/PipiUI/ChatSession.swift
- MOD Sources/PipiUI/ImageAttachment.swift
- MOD Sources/PipiUI/Views/MessageViews.swift
- MOD Sources/PipiUI/Views/MarkdownView.swift
- MOD Sources/PipiUI/Views/InputBar.swift
- MOD Sources/PipiUI/Views/ChatDetailView.swift
- MOD Sources/PipiUI/SelfTest.swift (if needed)
- MOD README.md

## Implementation details

### FileReveal.swift
```swift
enum FileReveal {
    @discardableResult static func revealInFinder(path: String) -> Bool
    @discardableResult static func revealInFinder(url: URL) -> Bool
    @discardableResult static func open(path: String) -> Bool
    static func isAbsoluteFilePath(_ string: String) -> Bool
    static func fileURL(fromCandidate: String) -> URL?
    static func absolutePathMatches(in text: String) -> [Range<String.Index>]
    static func attributedStringLinkingPaths(_ text: String, base: AttributeContainer = .init()) -> AttributedString
    static func missingPathMessage(_ path: String) -> String // "找不到文件：…"
}
```
- Reveal pattern: guard exists then NSWorkspace.shared.activateFileViewerSelecting([url])
- Path detection: file:// URLs; POSIX absolute with common roots (/Users/, /tmp/, /private/, /var/, /Volumes/, /Applications/, /System/, /Library/, /opt/, /usr/, ...) requiring ≥2 path components
- No unquoted spaces in paths v1
- Strip trailing punctuation including CJK ，。；：、）】》
- Reject http/https

### ImagePathResolver.swift
```swift
enum ImagePathResolver {
    static func resolve(data: Data, knownPath: String?, footnotePaths: [String], imageIndex: Int, projectURL: URL?) -> String?
    static func attachmentPaths(fromMessageText text: String) -> [String]
    static func matchAttachment(data: Data, projectURL: URL) -> String?
}
```
- resolve order: knownPath (if exists) → footnotePaths[index] → hash/content match in project/.pi/attachments → nil
- match: size prefilter, content equality, cap ~200 files

### ImageBlock change in ChatSession.swift
```swift
struct ImageBlock: Identifiable, Equatable {
    let id: String
    let data: Data
    let mimeType: String
    var path: String? = nil
}
```
- parseImageBlock: optional path/filePath keys
- appendMediaResult / wherever media images created: set path
- Fix all ImageBlock inits to compile

### ImageAttachment.swift
- Export or add attachmentPaths(fromMessageText:) matching the footnote formats used by messageWithAttachmentPaths / stripAttachmentPathsForDisplay
- ImagePathResolver can call into ImageAttachment if paths already parsed there

### ImagePreview.swift
- ImageThumbnailView: tap → fullScreenCover lightbox; contextMenu: 在访达中显示 / 打开 / 存储…
- ImageLightbox: dimmed bg, fit image, x button, Esc cancel, tap outside dismiss
- Resolve path via ImagePathResolver before reveal

### PathLinkedText.swift
- AttributedString with file links, accent+underline
- openURL environment: file URLs → revealInFinder or onFlash missing

### MarkdownView.swift
- For paragraph/heading/list/quote: link paths when text is plain or carefully merge
- Pragmatic: if no markdown markers, use PathLinkedText; else try inject links on plain ranges after inline markdown
- Do NOT path-link inside fenced code bodies

### MessageViews.swift
- Replace Image(nsImage:) sites with ImageThumbnailView (user, assistant, tool)
- Pass projectURL and onFlash
- Tool argsSummary and output: PathLinkedText where appropriate
- MessageRow: add projectURL, onFlash (don't put onFlash in Equatable)

### ChatDetailView.swift
- Pass session.projectURL and { session.flash($0) } into MessageRow

### InputBar.swift
- Draft thumbs use ImageThumbnailView for enlarge; path nil; 存储… still available

### Tests
Write and run FileRevealTests and ImagePathResolverTests as described in the plan (isAbsoluteFilePath, file URL decode, extract from prose, CJK punct, reveal missing/existing, match attachment by content, resolve order).

### README
Update known limits about no zoom / tool images not rendering.

## Verification (REQUIRED — report actual output)
```bash
cd /Users/haoli/leehow/code/pipiui
swift test --filter FileRevealTests
swift test --filter ImagePathResolverTests
swift test
swift build -c debug
```

## Constraints
- Do NOT break existing image send/paste/drop
- Do NOT show stripped attachment footnotes again in user bubbles
- Chinese UI strings for menus: 在访达中显示, 打开, 存储…
- Prefer matching existing code style
- Commit is optional; focus on working code + green tests
- If Package.swift needs to list new files — SPM usually auto-discovers under Sources/

## Task checklist

- [x] Save plan (this file)
- [x] FileReveal + unit tests
- [x] ImagePathResolver + unit tests (+ ImageAttachment.attachmentPaths)
- [x] ImageBlock.path + parseImageBlock + media path
- [x] ImagePreview + PathLinkedText views
- [x] Wire MessageViews / MarkdownView / InputBar / ChatDetailView
- [x] README known limits
- [x] swift test + swift build green

## Deviations
- Lightbox uses `.sheet` instead of `.fullScreenCover` because `fullScreenCover` is unavailable on macOS.
