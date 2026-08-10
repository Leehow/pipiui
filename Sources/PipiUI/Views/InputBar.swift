import SwiftUI
import AppKit
import UniformTypeIdentifiers

/// Captures ⌘V while the composer is focused: images → attachments; large text → collapse marker.
final class ComposerPasteCatcher {
    var focused = false
    var onPasteImages: ([DraftImage]) -> Void = { _ in }
    /// Called with pasteboard string when it exceeds the large-paste threshold.
    var onPasteLargeText: (String) -> Void = { _ in }
    private var monitor: Any?

    func start() {
        stop()
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            guard self.focused,
                  event.modifierFlags.contains(.command),
                  !event.modifierFlags.contains(.shift),
                  !event.modifierFlags.contains(.option),
                  !event.modifierFlags.contains(.control),
                  event.charactersIgnoringModifiers?.lowercased() == "v"
            else { return event }

            // Images win (TextField would otherwise insert a path / file URL).
            if ImageAttachment.pasteboardHasImage() {
                let images = ImageAttachment.imagesFromPasteboard()
                guard !images.isEmpty else { return event }
                DispatchQueue.main.async { self.onPasteImages(images) }
                return nil
            }

            guard let text = NSPasteboard.general.string(forType: .string),
                  DraftPasteCollapse.isLargePaste(text)
            else { return event }

            DispatchQueue.main.async { self.onPasteLargeText(text) }
            return nil
        }
    }

    func stop() {
        if let monitor {
            NSEvent.removeMonitor(monitor)
            self.monitor = nil
        }
    }

    deinit { stop() }
}

/// Immutable ownership captured when a PDF selection/drop begins. Unlike normal
/// image drops, a late PDF completion must never follow whichever session the
/// warm-reused composer is displaying later.
final class ComposerPDFIngestionTarget {
    weak var session: ChatSession?
    let projectURL: URL

    init(session: ChatSession) {
        self.session = session
        self.projectURL = session.projectURL
    }
}

typealias ComposerPDFIngestionExecutor = (
    _ sourceURL: URL,
    _ projectURL: URL,
    _ progress: @escaping (NativePDFIngestion.Progress) -> Void
) throws -> NativePDFIngestion.SourceBundle

private struct PendingComposerPDFIngestion {
    let target: ComposerPDFIngestionTarget
    var status: String
}

private final class ComposerPDFIngestionError {
    weak var session: ChatSession?
    let message: String

    init(session: ChatSession, message: String) {
        self.session = session
        self.message = message
    }
}

/// Routes composer actions to the currently displayed session.
///
/// `InputBar` is intentionally warm-reused across session switches. Persistent key monitors
/// and asynchronous drop completions therefore capture this stable router, never an
/// `InputBar` value (which would strongly retain the session from that render).
final class ComposerSessionRouter: ObservableObject {
    private weak var session: ChatSession?

    @Published private(set) var slashMatches: [SlashCommand] = []
    @Published private(set) var slashSelectedIndex = 0
    @Published private(set) var slashPaletteVisible = false
    @Published private(set) var attachError: String?
    @Published private(set) var pdfIngestionStatus: String?
    @Published private(set) var pdfIngestionError: String?

    private var pendingPDFIngestions: [UUID: PendingComposerPDFIngestion] = [:]
    private var pdfIngestionErrors: [ObjectIdentifier: ComposerPDFIngestionError] = [:]

    func bind(to session: ChatSession) {
        guard self.session !== session else { return }
        self.session = session
        dismissSlashPalette()
        attachError = nil
        refreshPDFIngestionPresentation()
    }

    func route(images: [DraftImage]) {
        session?.draftImages.append(contentsOf: images)
        attachError = nil
    }

    func routeLargeText(_ text: String) {
        guard let session else { return }
        let marker = session.registerLargePaste(text)
        ComposerPasteInsertion.insertMarker(marker, draftText: &session.draftText)
        attachError = nil
    }

    func appendResults(_ results: [Result<DraftImage, ImageAttachment.LoadError>]) {
        guard let session else { return }
        var lastError: String?
        for result in results {
            switch result {
            case .success(let image):
                session.draftImages.append(image)
            case .failure(let error):
                lastError = error.localizedDescription
            }
        }
        attachError = lastError
        guard let lastError else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard self?.attachError == lastError else { return }
            self?.attachError = nil
        }
    }

    func clearAttachError() {
        attachError = nil
    }

    /// Capture a source session/project before an asynchronous file provider has
    /// delivered its URL. The target holds the session weakly, so a closed source
    /// session is discarded rather than being silently retargeted.
    func makePDFIngestionTarget(for session: ChatSession) -> ComposerPDFIngestionTarget {
        ComposerPDFIngestionTarget(session: session)
    }

    /// Start local PDFKit/Vision extraction off the main UI queue. Each selected
    /// file is handled serially in this batch to keep memory bounded for large
    /// scans while still leaving the composer responsive.
    func ingestPDFs(
        _ urls: [URL],
        target: ComposerPDFIngestionTarget,
        executor: @escaping ComposerPDFIngestionExecutor = { sourceURL, projectURL, progress in
            try NativePDFIngestion.ingest(
                sourceURL: sourceURL,
                projectURL: projectURL,
                progress: progress
            )
        }
    ) {
        guard let sourceSession = target.session else { return }
        guard sourceSession.composerMode == .chat else {
            presentPDFIngestionError("PDF 仅支持在对话模式中本地解析", target: target)
            return
        }
        let pdfURLs = urls.filter(NativePDFIngestion.isPDF)
        guard !pdfURLs.isEmpty else { return }

        let taskID = UUID()
        beginPDFIngestion(
            "正在准备本地 PDF 解析（0/\(pdfURLs.count) 个文件）…",
            taskID: taskID,
            target: target
        )

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var references: [String] = []
            var failures: [String] = []

            for (fileIndex, url) in pdfURLs.enumerated() {
                guard target.session != nil else { break }
                let prefix = pdfURLs.count > 1 ? "PDF \(fileIndex + 1)/\(pdfURLs.count)：" : ""
                self?.publishPDFIngestionStatus(
                    "\(prefix)正在准备本地解析…",
                    taskID: taskID,
                    target: target
                )
                do {
                    let bundle = try executor(
                        url,
                        target.projectURL,
                        { [weak self] progress in
                            self?.publishPDFIngestionStatus(
                                "\(prefix)\(progress.localizedDescription)",
                                taskID: taskID,
                                target: target
                            )
                        }
                    )
                    if target.session != nil {
                        references.append(bundle.draftReference())
                    }
                } catch {
                    failures.append("\(url.lastPathComponent)：\(error.localizedDescription)")
                }
            }

            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.finishPDFIngestion(taskID: taskID)
                guard let sourceSession = target.session else { return }

                if !references.isEmpty {
                    if sourceSession.composerMode == .chat {
                        let referenceText = references.joined(separator: "\n\n")
                        if sourceSession.draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            sourceSession.draftText = referenceText
                        } else {
                            sourceSession.draftText += "\n\n\(referenceText)"
                        }
                    } else {
                        self.presentPDFIngestionError(
                            "PDF 已完成本地解析，但未添加引用：会话已切换到图像或视频生成模式",
                            target: target
                        )
                    }
                }
                if !failures.isEmpty {
                    self.presentPDFIngestionError(
                        "PDF 本地解析失败：\(failures.joined(separator: "；"))",
                        target: target
                    )
                }
            }
        }
    }

    func refreshSlashPalette(disabledSkills: Set<String>) {
        guard let session,
              session.composerMode == .chat,
              session.draftImages.isEmpty,
              let query = SlashPaletteQuery.paletteQuery(from: session.draftText)
        else {
            dismissSlashPalette()
            return
        }

        let availableCommands = session.availableCommands.filter { command in
            command.source != .skill || !disabledSkills.contains(command.name)
        }
        slashMatches = SlashFuzzy.filter(
            commands: BuiltinCommands.all + availableCommands,
            query: query
        )
        slashPaletteVisible = !slashMatches.isEmpty
        if slashSelectedIndex >= slashMatches.count {
            slashSelectedIndex = max(0, slashMatches.count - 1)
        }
    }

    func moveSlashSelection(by delta: Int) {
        guard !slashMatches.isEmpty else { return }
        let next = slashSelectedIndex + delta
        slashSelectedIndex = min(max(0, next), slashMatches.count - 1)
    }

    func dismissSlashPalette() {
        slashPaletteVisible = false
        slashMatches = []
        slashSelectedIndex = 0
    }

    @discardableResult
    func completeSelectedSlash() -> Bool {
        guard slashPaletteVisible,
              slashMatches.indices.contains(slashSelectedIndex) else { return false }
        return completeSlash(slashMatches[slashSelectedIndex])
    }

    @discardableResult
    func completeSlash(_ command: SlashCommand) -> Bool {
        guard let session else { return false }
        session.draftText = "/\(command.name) "
        dismissSlashPalette()
        return true
    }

    @discardableResult
    func executeSelectedSlash() -> Bool {
        guard slashPaletteVisible,
              slashMatches.indices.contains(slashSelectedIndex) else { return false }
        return executeSlash(slashMatches[slashSelectedIndex])
    }

    @discardableResult
    func executeSlash(_ command: SlashCommand) -> Bool {
        guard let session, !isPDFIngestionPending(for: session) else { return false }
        let args: String
        if let invocation = BuiltinCommands.parseInvocation(session.draftText),
           invocation.name == command.name {
            args = invocation.args
        } else {
            args = ""
        }

        session.draftText = ""
        session.draftImages = []
        session.clearDraftPastes()
        dismissSlashPalette()

        if command.source == .builtin {
            _ = BuiltinCommands.execute(name: command.name, args: args, host: session)
        } else {
            let message = args.isEmpty
                ? "/\(command.name)"
                : "/\(command.name) \(args)"
            session.sendPrompt(message, images: [])
        }
        return true
    }

    var canSend: Bool {
        guard let session,
              !session.mediaBusy,
              !isPDFIngestionPending(for: session)
        else { return false }
        let hasText = !session.draftText
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty
        let hasImages = !session.draftImages.isEmpty
        switch session.composerMode {
        case .generateImage, .generateVideo:
            return hasText
        case .chat:
            return session.processAlive && (hasText || hasImages)
        }
    }

    @discardableResult
    func send() -> Bool {
        guard let session, !isPDFIngestionPending(for: session) else { return false }
        if executeSelectedSlash() {
            return true
        }
        guard canSend else { return false }
        let images = session.draftImages
        // Expand before clearing draftText — onChange prune would otherwise wipe draftPastes.
        let text = session.expandedDraftText(from: session.draftText)
        session.draftText = ""
        session.draftImages = []
        session.clearDraftPastes()
        attachError = nil
        session.sendPrompt(text, images: images)
        return true
    }

    func isPDFIngestionPending(for session: ChatSession) -> Bool {
        pendingPDFIngestions.values.contains { $0.target.session === session }
    }

    private func publishPDFIngestionStatus(
        _ status: String,
        taskID: UUID,
        target: ComposerPDFIngestionTarget
    ) {
        DispatchQueue.main.async { [weak self] in
            self?.setPDFIngestionStatus(status, taskID: taskID, target: target)
        }
    }

    private func setPDFIngestionStatus(
        _ status: String,
        taskID: UUID,
        target: ComposerPDFIngestionTarget
    ) {
        guard var ingestion = pendingPDFIngestions[taskID], ingestion.target === target else { return }
        ingestion.status = status
        pendingPDFIngestions[taskID] = ingestion
        refreshPDFIngestionPresentation()
    }

    private func beginPDFIngestion(
        _ status: String,
        taskID: UUID,
        target: ComposerPDFIngestionTarget
    ) {
        pendingPDFIngestions[taskID] = PendingComposerPDFIngestion(
            target: target,
            status: status
        )
        refreshPDFIngestionPresentation()
    }

    private func finishPDFIngestion(taskID: UUID) {
        pendingPDFIngestions[taskID] = nil
        refreshPDFIngestionPresentation()
    }

    private func refreshPDFIngestionPresentation() {
        guard let session else {
            pdfIngestionStatus = nil
            pdfIngestionError = nil
            return
        }
        pdfIngestionStatus = pendingPDFIngestions.values.first(where: {
            $0.target.session === session
        })?.status

        let identity = ObjectIdentifier(session)
        if let error = pdfIngestionErrors[identity], error.session === session {
            pdfIngestionError = error.message
        } else {
            pdfIngestionErrors[identity] = nil
            pdfIngestionError = nil
        }
    }

    private func presentPDFIngestionError(
        _ message: String,
        target: ComposerPDFIngestionTarget
    ) {
        guard let sourceSession = target.session else { return }
        let identity = ObjectIdentifier(sourceSession)
        let error = ComposerPDFIngestionError(session: sourceSession, message: message)
        pdfIngestionErrors[identity] = error
        refreshPDFIngestionPresentation()
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self, weak error] in
            guard let self,
                  let error,
                  self.pdfIngestionErrors[identity] === error
            else {
                return
            }
            self.pdfIngestionErrors[identity] = nil
            self.refreshPDFIngestionPresentation()
        }
    }

    private func presentAttachError(_ message: String) {
        attachError = message
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            guard self?.attachError == message else { return }
            self?.attachError = nil
        }
    }
}

/// Installs the callbacks that outlive an individual `InputBar` render.
///
/// Keeping the production wiring here makes its capture graph directly testable: the
/// callbacks retain only the stable router and, where needed, the monitor weakly.
enum ComposerPersistentCallbackBinder {
    static func install(
        pasteCatcher: ComposerPasteCatcher,
        slashKeyMonitor: ComposerSlashKeyMonitor,
        router: ComposerSessionRouter
    ) {
        pasteCatcher.onPasteImages = { [router] images in
            router.route(images: images)
        }
        pasteCatcher.onPasteLargeText = { [router] text in
            router.routeLargeText(text)
        }

        slashKeyMonitor.onMove = { [router] delta in
            router.moveSlashSelection(by: delta)
        }
        slashKeyMonitor.onEscape = { [router, weak slashKeyMonitor] in
            router.dismissSlashPalette()
            slashKeyMonitor?.isActive = false
        }
        slashKeyMonitor.onTab = { [router, weak slashKeyMonitor] in
            if router.completeSelectedSlash() {
                slashKeyMonitor?.isActive = false
            }
        }
        slashKeyMonitor.onReturn = { [router, weak slashKeyMonitor] in
            let handled = router.executeSelectedSlash()
            if handled {
                slashKeyMonitor?.isActive = false
            }
            return handled
        }
    }
}

enum ComposerPasteInsertion {
    /// Insert `marker` at the focused text field's selection; fall back to appending on `draftText`.
    static func insertMarker(_ marker: String, draftText: inout String) {
        if let textView = NSApp?.keyWindow?.firstResponder as? NSTextView,
           textView.isEditable {
            let range = textView.selectedRange()
            if textView.shouldChangeText(in: range, replacementString: marker) {
                textView.replaceCharacters(in: range, with: marker)
                textView.didChangeText()
            }
            // Keep SwiftUI binding in sync when the field is the draft composer.
            draftText = textView.string
            return
        }
        if let field = NSApp?.keyWindow?.firstResponder as? NSTextField {
            let editor = field.currentEditor()
            let ns = (editor?.string ?? field.stringValue) as NSString
            let range = editor?.selectedRange ?? NSRange(location: ns.length, length: 0)
            let updated = ns.replacingCharacters(in: range, with: marker)
            field.stringValue = updated
            draftText = updated
            if let editor {
                let cursor = range.location + (marker as NSString).length
                editor.selectedRange = NSRange(location: cursor, length: 0)
            }
            return
        }
        draftText += marker
    }
}

enum ComposerTextViewLayout {
    static let minimumLines = 1
    static let maximumLines = 10
    static let verticalInset: CGFloat = 2
    static let minimumControlHeight: CGFloat = 20

    static func lineHeight(for font: NSFont) -> CGFloat {
        NSLayoutManager().defaultLineHeight(for: font)
    }

    static func minimumHeight(for font: NSFont) -> CGFloat {
        max(
            minimumControlHeight,
            ceil(lineHeight(for: font) * CGFloat(minimumLines) + verticalInset * 2)
        )
    }

    static func maximumHeight(for font: NSFont) -> CGFloat {
        ceil(lineHeight(for: font) * CGFloat(maximumLines) + verticalInset * 2)
    }

    static func visibleHeight(usedTextHeight: CGFloat, font: NSFont) -> CGFloat {
        let contentHeight = ceil(max(lineHeight(for: font), usedTextHeight) + verticalInset * 2)
        return min(maximumHeight(for: font), max(minimumHeight(for: font), contentHeight))
    }
}

final class ComposerNSTextView: NSTextView {
    var onSubmit: () -> Void = {}
    var onDidChangeText: (ComposerNSTextView) -> Void = { _ in }

    override func mouseMoved(with event: NSEvent) {
        // NSTextView's default hover handling asks AppKit for sharing services.
        // That lookup can synchronously wait on extension XPC, freezing the
        // composer while the pointer is over it. The composer has no hover
        // affordances, so retain its normal text cursor without forwarding the
        // event into NSTextView.
        NSCursor.iBeam.set()
    }

    override func didChangeText() {
        super.didChangeText()

        // AppKit suppresses NSTextDidChangeNotification while an input method owns
        // marked text, so the delegate cannot update the binding or placeholder.
        // Limit this hook to composition changes to avoid duplicating ordinary
        // delegate notifications.
        if hasMarkedText() {
            onDidChangeText(self)
        }
    }

    override func doCommand(by commandSelector: Selector) {
        if commandSelector == #selector(insertNewlineIgnoringFieldEditor(_:)) {
            super.doCommand(by: commandSelector)
            return
        }

        guard commandSelector == #selector(insertNewline(_:)) else {
            super.doCommand(by: commandSelector)
            return
        }

        // The input context normally consumes candidate confirmation before this
        // command reaches NSTextView. If it does arrive with marked text active,
        // do nothing: calling super would replace the marked range with a newline.
        guard !hasMarkedText() else { return }

        let modifiers = NSApp.currentEvent?.modifierFlags
            .intersection(.deviceIndependentFlagsMask) ?? []
        if modifiers.contains(.shift) || modifiers.contains(.option) {
            super.doCommand(by: commandSelector)
            return
        }

        // Matches the previous TextField.onSubmit contract: plain Return sends
        // (and Command-Return still reaches the existing button key equivalent).
        onSubmit()
    }
}

final class ComposerPlaceholderLabel: NSTextField {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

final class ComposerUndoManager: UndoManager {
    var onUndoOrRedo: () -> Void = {}

    override func undo() {
        super.undo()
        onUndoOrRedo()
    }

    override func redo() {
        super.redo()
        onUndoOrRedo()
    }
}

class ComposerTextViewHost: NSView {
    let scrollView = NSScrollView(frame: .zero)
    let textView = ComposerNSTextView(frame: .zero)
    let placeholderLabel = ComposerPlaceholderLabel(labelWithString: "")
    var onHeightChange: (CGFloat) -> Void = { _ in }
    var onMoveToWindow: () -> Void = {}

    private(set) var visibleTextHeight: CGFloat
    private(set) var documentTextHeight: CGFloat = 0
    private let composerFont: NSFont

    override var isFlipped: Bool { true }

    init(font: NSFont = .systemFont(ofSize: NSFont.systemFontSize)) {
        composerFont = font
        visibleTextHeight = ComposerTextViewLayout.minimumHeight(for: font)
        super.init(frame: .zero)

        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor

        scrollView.borderType = .noBorder
        scrollView.drawsBackground = false
        scrollView.contentView.drawsBackground = false
        scrollView.hasHorizontalScroller = false
        scrollView.horizontalScrollElasticity = .none
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.scrollerStyle = .overlay
        scrollView.verticalScrollElasticity = .none

        textView.delegate = nil
        textView.isEditable = true
        textView.isSelectable = true
        textView.isRichText = false
        textView.importsGraphics = false
        textView.drawsBackground = false
        textView.backgroundColor = .clear
        textView.font = font
        textView.textColor = .labelColor
        textView.insertionPointColor = .labelColor
        textView.textContainerInset = NSSize(
            width: 0,
            height: ComposerTextViewLayout.verticalInset
        )
        textView.textContainer?.lineFragmentPadding = 0
        textView.textContainer?.widthTracksTextView = true
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        textView.autoresizingMask = [.width]
        textView.minSize = .zero
        textView.maxSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.allowsUndo = true
        textView.typingAttributes = [
            .font: font,
            .foregroundColor: NSColor.labelColor,
        ]
        textView.setAccessibilityLabel("消息输入框")

        placeholderLabel.font = font
        placeholderLabel.textColor = .placeholderTextColor
        placeholderLabel.backgroundColor = .clear
        placeholderLabel.isBordered = false
        placeholderLabel.isEditable = false
        placeholderLabel.isSelectable = false
        placeholderLabel.lineBreakMode = .byTruncatingTail

        scrollView.documentView = textView
        addSubview(scrollView)
        addSubview(placeholderLabel)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var intrinsicContentSize: NSSize {
        NSSize(width: NSView.noIntrinsicMetric, height: visibleTextHeight)
    }

    var shouldScrollSelectionDuringLayout: Bool {
        window?.firstResponder === textView
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        onMoveToWindow()
    }

    override func layout() {
        super.layout()
        scrollView.frame = bounds
        let lineHeight = ComposerTextViewLayout.lineHeight(for: composerFont)
        placeholderLabel.frame = NSRect(
            x: 0,
            y: ComposerTextViewLayout.verticalInset,
            width: bounds.width,
            height: ceil(lineHeight)
        )
        refreshLayout(scrollSelection: shouldScrollSelectionDuringLayout)
    }

    func updatePlaceholder(_ placeholder: String) {
        placeholderLabel.stringValue = placeholder
        placeholderLabel.isHidden = !textView.string.isEmpty || textView.hasMarkedText()
    }

    @discardableResult
    func refreshLayout(scrollSelection: Bool) -> CGFloat {
        let viewportWidth = scrollView.contentSize.width
        guard viewportWidth > 1 else { return visibleTextHeight }
        guard let textContainer = textView.textContainer,
              let layoutManager = textView.layoutManager else {
            return visibleTextHeight
        }

        var textFrame = textView.frame
        textFrame.size.width = viewportWidth
        textFrame.size.height = max(textFrame.height, scrollView.contentSize.height)
        textView.frame = textFrame
        textContainer.containerSize = NSSize(
            width: viewportWidth,
            height: CGFloat.greatestFiniteMagnitude
        )
        textContainer.widthTracksTextView = true

        layoutManager.ensureLayout(for: textContainer)
        let usedRect = layoutManager.usedRect(for: textContainer)
        let lineHeight = ComposerTextViewLayout.lineHeight(for: composerFont)
        documentTextHeight = ceil(
            max(lineHeight, usedRect.height) + ComposerTextViewLayout.verticalInset * 2
        )

        if abs(textView.frame.height - documentTextHeight) > 0.5 {
            textFrame.size.height = max(documentTextHeight, scrollView.contentSize.height)
            textView.frame = textFrame
        }

        let nextVisibleHeight = ComposerTextViewLayout.visibleHeight(
            usedTextHeight: usedRect.height,
            font: composerFont
        )
        if abs(nextVisibleHeight - visibleTextHeight) > 0.5 {
            visibleTextHeight = nextVisibleHeight
            invalidateIntrinsicContentSize()
            onHeightChange(nextVisibleHeight)
        }

        updatePlaceholder(placeholderLabel.stringValue)

        if documentTextHeight <= nextVisibleHeight + 0.5 {
            // When all content fits, pin the document to its top. A stale field-editor
            // scroll origin is what visually clips the previous line during growth.
            scrollView.contentView.scroll(to: .zero)
            scrollView.reflectScrolledClipView(scrollView.contentView)
        } else if scrollSelection {
            textView.scrollRangeToVisible(textView.selectedRange())
        }

        return nextVisibleHeight
    }
}

struct ComposerTextView: NSViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool
    @Binding var height: CGFloat
    let sessionIdentity: ObjectIdentifier
    let placeholder: String
    let onSubmit: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeNSView(context: Context) -> ComposerTextViewHost {
        let host = ComposerTextViewHost()
        context.coordinator.host = host
        host.textView.delegate = context.coordinator
        host.textView.onDidChangeText = { [weak coordinator = context.coordinator] textView in
            coordinator?.textViewDidChangeText(textView)
        }
        host.onHeightChange = { [weak coordinator = context.coordinator] height in
            coordinator?.receiveHeight(height)
        }
        host.onMoveToWindow = { [weak coordinator = context.coordinator, weak host] in
            guard let coordinator, let host else { return }
            coordinator.synchronizeFocus(host)
        }
        context.coordinator.synchronize(host)
        return host
    }

    func updateNSView(_ host: ComposerTextViewHost, context: Context) {
        context.coordinator.parent = self
        context.coordinator.synchronize(host)
    }

    static func dismantleNSView(_ host: ComposerTextViewHost, coordinator: Coordinator) {
        host.textView.delegate = nil
        host.textView.onSubmit = {}
        host.textView.onDidChangeText = { _ in }
        host.onHeightChange = { _ in }
        host.onMoveToWindow = {}
        coordinator.dismantle()
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: ComposerTextView
        weak var host: ComposerTextViewHost?

        private var boundSessionIdentity: ObjectIdentifier
        private var pendingExternalText: String?
        /// The last value coordinated between AppKit and the SwiftUI binding. While an
        /// IME owns marked text, a matching binding value is a stale render echo, not
        /// an external draft replacement.
        private var lastKnownText: String
        /// State last handled by `synchronize`. A ChatSession draft write re-renders
        /// InputBar, but should not force TextKit layout when AppKit already owns the
        /// matching text/selection/geometry.
        private var lastSynchronizedPlaceholder: String?
        private var lastSynchronizedFocus: Bool?
        private var lastSynchronizedViewportWidth: CGFloat?
        private var lastSynchronizedSelection: NSRange?
        private var pendingHeight: CGFloat?
        private var pendingTextApplicationScheduled = false
        private var focusRequestScheduled = false
        private var applyingProgrammaticText = false
        private var isDismantled = false
        private let composerUndoManager = ComposerUndoManager()
        var appIsActiveProvider: () -> Bool = { NSApp.isActive }
        var windowIsKeyProvider: (NSWindow) -> Bool = { $0.isKeyWindow }
        var makeFirstResponder: (NSWindow, NSTextView) -> Void = {
            window,
            textView in
            window.makeFirstResponder(textView)
        }
        /// `discardMarkedText()` can synchronously wait on the selected IME's XPC
        /// service. Keep it off the common session-rebind path and injectable so the
        /// marked-text ownership boundary is executable without timing-based tests.
        var discardMarkedText: (NSTextView) -> Void = { textView in
            textView.inputContext?.discardMarkedText()
        }

        init(parent: ComposerTextView) {
            self.parent = parent
            boundSessionIdentity = parent.sessionIdentity
            lastKnownText = parent.text
            super.init()
            composerUndoManager.onUndoOrRedo = { [weak self] in
                self?.synchronizeAfterUndoOrRedo()
            }
        }

        func synchronize(_ host: ComposerTextViewHost) {
            guard !isDismantled else { return }
            self.host = host

            let sessionChanged = boundSessionIdentity != parent.sessionIdentity
            let placeholderChanged = lastSynchronizedPlaceholder != parent.placeholder
            let viewportWidth = host.scrollView.contentSize.width
            let widthChanged = lastSynchronizedViewportWidth.map {
                abs($0 - viewportWidth) > 0.5
            } ?? true
            let selectionChanged = lastSynchronizedSelection.map {
                !NSEqualRanges($0, host.textView.selectedRange())
            } ?? true
            let textNeedsSynchronization = host.textView.string != parent.text
            let focusNeedsSynchronization = needsFocusSynchronization(host)

            // A keystroke first changes TextKit and then writes the binding. Its
            // resulting ChatSession publish must not re-run ensureLayout/scrolling
            // when text, width, placeholder, focus, and selection are unchanged.
            guard sessionChanged
                    || placeholderChanged
                    || widthChanged
                    || selectionChanged
                    || textNeedsSynchronization
                    || pendingExternalText != nil
                    || focusNeedsSynchronization
            else { return }

            host.textView.onSubmit = { [weak self] in
                self?.parent.onSubmit()
            }
            if placeholderChanged {
                host.updatePlaceholder(parent.placeholder)
            }

            var needsLayout = widthChanged || selectionChanged
            if sessionChanged {
                // The InputBar is warm-reused. Never let marked text from the old
                // session commit into the newly rebound draft. A normal session switch
                // is identity-scoped at the SwiftUI call site and creates a fresh native
                // host; this guarded branch is only the fallback for an unexpectedly
                // warm-reused coordinator. Do not synchronously contact the IME when
                // there is no marked text to discard.
                boundSessionIdentity = parent.sessionIdentity
                pendingExternalText = nil
                applyingProgrammaticText = true
                if host.textView.hasMarkedText() {
                    discardMarkedText(host.textView)
                }
                apply(parent.text, to: host.textView, moveCursorToEnd: true)
                applyingProgrammaticText = false
                lastKnownText = parent.text
                needsLayout = true
            } else if textNeedsSynchronization {
                if host.textView.hasMarkedText() {
                    // NSTextView.string includes the IME-owned marked range. A render
                    // with the text we last synchronized is therefore a stale binding
                    // echo, not an external replacement; keep the binding current so
                    // subsequent streaming renders cannot queue that stale value.
                    if parent.text == lastKnownText {
                        synchronizeBinding(with: host.textView.string)
                    } else {
                        // A different value was written by code while composition is
                        // active. Preserve it and apply it after the IME commits.
                        pendingExternalText = parent.text
                    }
                } else {
                    let replacement = pendingExternalText ?? parent.text
                    pendingExternalText = nil
                    apply(replacement, to: host.textView, moveCursorToEnd: false)
                    lastKnownText = replacement
                    needsLayout = true
                }
            }

            if needsLayout {
                refreshLayout(host, scrollSelection: true)
            }
            if focusNeedsSynchronization || lastSynchronizedFocus != parent.isFocused {
                synchronizeFocus(host)
            }
            recordSynchronizedState(for: host)
        }

        func textDidBeginEditing(_ notification: Notification) {
            guard !isDismantled else { return }
            guard !parent.isFocused else { return }
            parent.isFocused = true
        }

        func textDidEndEditing(_ notification: Notification) {
            guard !isDismantled else { return }
            if pendingExternalText != nil, let host {
                schedulePendingTextApplication(on: host)
            }
            if parent.isFocused {
                parent.isFocused = false
            }
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            textViewDidChangeText(textView)
        }

        func textViewDidChangeText(_ textView: NSTextView) {
            guard !isDismantled,
                  !applyingProgrammaticText,
                  let host,
                  host.textView === textView else { return }

            // Keep SwiftUI current even during composition. NSTextView.string includes
            // marked text, and writing it back prevents a high-frequency unrelated
            // render (such as streaming output) from mistaking an old binding value
            // for an external replacement.
            synchronizeBinding(with: textView.string)

            if pendingExternalText != nil, !textView.hasMarkedText() {
                // NSTextView can notify delegates before an IME unmark operation
                // finishes mutating storage. Apply on the next run loop so the
                // committed marked string cannot overwrite the external update.
                schedulePendingTextApplication(on: host)
            }

            refreshLayout(host, scrollSelection: true)
        }

        func undoManager(for view: NSTextView) -> UndoManager? {
            composerUndoManager
        }

        private func synchronizeAfterUndoOrRedo() {
            guard !isDismantled, !applyingProgrammaticText, let host else { return }
            synchronizeBinding(with: host.textView.string)
            refreshLayout(host, scrollSelection: true)
        }

        private func refreshLayout(
            _ host: ComposerTextViewHost,
            scrollSelection: Bool
        ) {
            host.refreshLayout(scrollSelection: scrollSelection)
            recordSynchronizedState(for: host)
        }

        private func recordSynchronizedState(for host: ComposerTextViewHost) {
            lastSynchronizedPlaceholder = parent.placeholder
            lastSynchronizedFocus = parent.isFocused
            lastSynchronizedViewportWidth = host.scrollView.contentSize.width
            lastSynchronizedSelection = host.textView.selectedRange()
        }

        private func needsFocusSynchronization(_ host: ComposerTextViewHost) -> Bool {
            if lastSynchronizedFocus != parent.isFocused { return true }
            guard let window = host.window else { return false }
            if parent.isFocused {
                return window.firstResponder !== host.textView
            }
            return window.firstResponder === host.textView
        }

        private func synchronizeBinding(with text: String) {
            lastKnownText = text
            if parent.text != text {
                parent.text = text
            }
        }

        func receiveHeight(_ newHeight: CGFloat) {
            guard !isDismantled,
                  abs(parent.height - newHeight) > 0.5,
                  pendingHeight != newHeight else { return }
            pendingHeight = newHeight
            DispatchQueue.main.async { [weak self] in
                guard let self,
                      !self.isDismantled,
                      self.pendingHeight == newHeight else { return }
                self.pendingHeight = nil
                if abs(self.parent.height - newHeight) > 0.5 {
                    self.parent.height = newHeight
                }
            }
        }

        private func schedulePendingTextApplication(on host: ComposerTextViewHost) {
            guard !pendingTextApplicationScheduled else { return }
            pendingTextApplicationScheduled = true
            DispatchQueue.main.async { [weak self, weak host] in
                guard let self, let host else { return }
                self.pendingTextApplicationScheduled = false
                guard !self.isDismantled,
                      let pendingExternalText = self.pendingExternalText,
                      !host.textView.hasMarkedText() else { return }
                self.pendingExternalText = nil
                self.apply(
                    pendingExternalText,
                    to: host.textView,
                    moveCursorToEnd: false
                )
                self.synchronizeBinding(with: pendingExternalText)
                self.refreshLayout(host, scrollSelection: true)
            }
        }

        func synchronizeFocus(_ host: ComposerTextViewHost) {
            guard !isDismantled else { return }
            if parent.isFocused {
                guard appIsActiveProvider(),
                      let window = host.window,
                      windowIsKeyProvider(window),
                      window.firstResponder !== host.textView,
                      !focusRequestScheduled else { return }
                focusRequestScheduled = true
                DispatchQueue.main.async { [weak self, weak host] in
                    guard let self, let host else { return }
                    self.focusRequestScheduled = false
                    guard !self.isDismantled,
                          self.parent.isFocused,
                          self.appIsActiveProvider(),
                          let window = host.window,
                          self.windowIsKeyProvider(window),
                          window.firstResponder !== host.textView else {
                        return
                    }
                    self.makeFirstResponder(window, host.textView)
                }
            } else if host.window?.firstResponder === host.textView {
                host.window?.makeFirstResponder(nil)
            }
        }

        private func apply(
            _ newText: String,
            to textView: NSTextView,
            moveCursorToEnd: Bool
        ) {
            // Every call represents an external whole-draft boundary, including
            // an equal-string session rebind. Old range-based typing actions must
            // never survive into the replacement/session on the other side.
            composerUndoManager.removeAllActions()
            guard textView.string != newText else { return }
            let oldSelection = textView.selectedRange()
            let oldLength = (textView.string as NSString).length
            guard let storage = textView.textStorage else { return }
            let wasApplyingProgrammaticText = applyingProgrammaticText
            applyingProgrammaticText = true
            composerUndoManager.disableUndoRegistration()
            storage.beginEditing()
            storage.replaceCharacters(
                in: NSRange(location: 0, length: storage.length),
                with: NSAttributedString(
                    string: newText,
                    attributes: textView.typingAttributes
                )
            )
            storage.endEditing()
            composerUndoManager.enableUndoRegistration()
            composerUndoManager.removeAllActions()
            applyingProgrammaticText = wasApplyingProgrammaticText

            let length = (newText as NSString).length
            if moveCursorToEnd {
                textView.setSelectedRange(NSRange(location: length, length: 0))
            } else if oldSelection.length == 0, oldSelection.location == oldLength {
                // Preserve the semantic "end of draft" caret across replacements
                // such as slash completion: "/na" becomes "/name " and arguments
                // must continue after the trailing space.
                textView.setSelectedRange(NSRange(location: length, length: 0))
            } else {
                let location = min(oldSelection.location, length)
                let selectionLength = min(oldSelection.length, length - location)
                textView.setSelectedRange(
                    NSRange(location: location, length: selectionLength)
                )
            }
        }

        func dismantle() {
            isDismantled = true
            pendingExternalText = nil
            pendingHeight = nil
            composerUndoManager.onUndoOrRedo = {}
            composerUndoManager.removeAllActions()
            host = nil
        }
    }
}

/// Arrow/Tab/Return/Esc while slash palette is open. Mirrors ComposerPasteCatcher lifecycle.
final class ComposerSlashKeyMonitor {
    var isActive = false
    var onMove: (Int) -> Void = { _ in }
    var onEscape: () -> Void = {}
    var onTab: () -> Void = {}
    /// Return true if the key was handled and should not propagate.
    var onReturn: () -> Bool = { false }
    private var monitor: Any?

    func start() {
        stop()
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, self.isActive else { return event }
            let mods = event.modifierFlags.intersection([.command, .option, .control])
            guard mods.isEmpty else { return event }

            switch event.keyCode {
            case 126: // up
                self.onMove(-1)
                return nil
            case 125: // down
                self.onMove(1)
                return nil
            case 53: // escape
                self.onEscape()
                return nil
            case 48: // tab
                self.onTab()
                return nil
            case 36, 76: // return / keypad enter
                if self.onReturn() { return nil }
                return event
            default:
                return event
            }
        }
    }

    func stop() {
        if let monitor {
            NSEvent.removeMonitor(monitor)
            self.monitor = nil
        }
    }

    deinit { stop() }
}

struct InputBar: View {
    @EnvironmentObject var store: AppStore
    @ObservedObject var session: ChatSession
    /// Draft typing is intentionally isolated from `ChatSession.objectWillChange`.
    /// Observe the session-owned composer state so external restores/sends still
    /// update this warm-reused input bar without invalidating the transcript.
    @ObservedObject private var draftState: ComposerDraftState
    @State private var focused = false
    @State private var composerTextHeight = ComposerTextViewLayout.minimumHeight(
        for: .systemFont(ofSize: NSFont.systemFontSize)
    )
    @State private var pasteCatcher = ComposerPasteCatcher()
    @StateObject private var composerRouter = ComposerSessionRouter()
    @State private var slashKeyMonitor = ComposerSlashKeyMonitor()
    @State private var showQuotaPopover: Bool = false
    @State private var showContextPopover: Bool = false
    @State private var showBalancePopover: Bool = false
    @State private var showToolStats: Bool = false
    /// Observes the shared singleton trigger; the sheet computes from the live session.
    @ObservedObject private var toolStatsPresenter = ToolStatsPresenter.shared
    /// 30-day ledger total (CNY) for the balance popover, refreshed on each open
    /// and every few seconds while the popover stays open.
    @State private var balanceLast30Days: Double?
    /// Guards against overlapping refreshes when the periodic popover timer fires
    /// while a previous reload is still computing.
    @State private var balanceReloadInFlight: Bool = false
    /// Measured width of the status row; drives compact vs wide without ViewThatFits.
    @State private var statusBarWidth: CGFloat = 0
    /// Whether the queue strip preview shows the full head text instead of the one-liner.
    @State private var queuePreviewExpanded = false

    init(session: ChatSession) {
        self.session = session
        _draftState = ObservedObject(wrappedValue: session.composerDraft)
    }

    var body: some View {
        VStack(spacing: 8) {
            if !session.messageQueue.isEmpty {
                queueStrip
            }

            if !session.draftImages.isEmpty {
                attachmentStrip
            }

            if session.composerMode != .chat {
                mediaModeStrip
            }

            if let attachError = composerRouter.attachError {
                Text(attachError)
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            if let pdfError = composerRouter.pdfIngestionError {
                Text(pdfError)
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            if let status = composerRouter.pdfIngestionStatus {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.mini)
                    Text(status)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if let status = session.mediaStatus {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.mini)
                    Text(status)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if composerRouter.slashPaletteVisible && !composerRouter.slashMatches.isEmpty {
                SlashPalette(
                    commands: composerRouter.slashMatches,
                    selectedIndex: composerRouter.slashSelectedIndex,
                    onSelect: { completeSlash($0) }
                )
                .frame(maxWidth: .infinity, alignment: .leading)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }

            composerShell

            responsiveStatus
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 12)
        .background(.bar)
        .onDrop(of: [.image, .fileURL], isTargeted: nil, perform: handleDrop)
        .onAppear {
            let mayFocus = NSApp.isActive
                && NSApp.keyWindow?.isKeyWindow == true
            focused = mayFocus
            pasteCatcher.focused = mayFocus
            composerRouter.bind(to: session)
            ComposerPersistentCallbackBinder.install(
                pasteCatcher: pasteCatcher,
                slashKeyMonitor: slashKeyMonitor,
                router: composerRouter
            )
            pasteCatcher.start()
            slashKeyMonitor.start()
            refreshSlashPalette()
            refreshSlashKeyMonitorActive()
        }
        .onChange(of: focused) { _, isFocused in
            pasteCatcher.focused = isFocused
            refreshSlashKeyMonitorActive()
        }
        .onChange(of: ObjectIdentifier(session)) { _, _ in
            composerRouter.bind(to: session)
            refreshSlashPalette()
        }
        .onChange(of: session.messageQueue.count) { _, _ in
            queuePreviewExpanded = false
        }
        .onChange(of: session.messageQueue.first?.id) { _, _ in
            queuePreviewExpanded = false
        }
        .onChange(of: draftState.text) { _, _ in
            session.pruneOrphanDraftPastes()
            refreshSlashPalette()
            composerRouter.clearAttachError()
        }
        .onChange(of: draftState.focusRequestToken) { _, _ in
            focused = true
        }
        .onChange(of: session.availableCommands) { _, _ in
            refreshSlashPalette()
        }
        .onChange(of: store.skillVisibilityRevision) { _, _ in
            refreshSlashPalette()
        }
        .onChange(of: session.composerMode) { _, _ in
            refreshSlashPalette()
        }
        .onChange(of: session.draftImages.count) { _, _ in
            refreshSlashPalette()
            composerRouter.clearAttachError()
        }
        .onChange(of: toolStatsPresenter.requestID) { _, _ in
            showToolStats = true
        }
        .sheet(isPresented: $showToolStats) {
            ToolStatsSheetView(session: session)
        }
        .onDisappear {
            pasteCatcher.stop()
            slashKeyMonitor.stop()
        }
    }

    // MARK: - Queue strip

    private var queueStrip: some View {
        HStack(spacing: 10) {
            Image(systemName: "tray")
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text("排队 \(session.messageQueue.count) 条")
                    .font(.caption.weight(.semibold))
                if let preview = queuePreview {
                    Button {
                        queuePreviewExpanded.toggle()
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text(queuePreviewExpanded ? queueFullText : preview)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(queuePreviewExpanded ? nil : 1)
                                .multilineTextAlignment(.leading)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Image(systemName: "chevron.down")
                                .font(.system(size: 8, weight: .semibold))
                                .foregroundStyle(.tertiary)
                                .rotationEffect(.degrees(queuePreviewExpanded ? 180 : 0))
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("队首消息预览")
                    .accessibilityValue(queuePreviewExpanded ? "已展开" : "已收起")
                    .accessibilityHint("点击展开或收起队首完整内容")
                }
            }
            Spacer()
            HStack(spacing: 12) {
                Button("插队") {
                    session.cutInQueueHead()
                }
                .font(.caption.weight(.medium))
                .help("中止当前回复并批量发送全部排队消息")

                Button("撤回编辑") {
                    let restored = session.restoreQueueToDraft()
                    if session.draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        session.draftText = restored.text
                    } else if !restored.text.isEmpty {
                        session.draftText = session.draftText + "\n\n" + restored.text
                    }
                    session.draftImages.append(contentsOf: restored.images)
                }
                .font(.caption.weight(.medium))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.accentColor.opacity(0.08))
        )
    }

    private var queuePreview: String? {
        guard let text = session.messageQueue.first?.text else { return nil }
        let firstLine = text.split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? text
        let trimmed = firstLine.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return session.messageQueue.first?.images.isEmpty == false ? "(图片)" : nil
        }
        if trimmed.count <= 40 { return "「\(trimmed)」" }
        return "「\(trimmed.prefix(40))…」"
    }

    /// Full head queued text for the expanded strip, with attachment path footnotes
    /// stripped the same way `restoreQueueToDraft` does for the composer.
    private var queueFullText: String {
        guard let text = session.messageQueue.first?.text else { return "" }
        let stripped = ImageAttachment.stripAttachmentPathsForDisplay(text)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if stripped.isEmpty {
            return session.messageQueue.first?.images.isEmpty == false ? "(图片)" : ""
        }
        return "「\(stripped)」"
    }

    // MARK: - Attachment strip

    private var attachmentStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(session.draftImages) { img in
                    ZStack(alignment: .topTrailing) {
                        // Enlarge OK; path unknown for drafts → reveal disabled via content match off.
                        ImageThumbnailView(
                            data: img.data,
                            mimeType: img.mimeType,
                            path: nil,
                            fillSize: CGSize(width: 64, height: 64),
                            projectURL: session.projectURL,
                            onFlash: { session.flash($0) },
                            allowContentMatch: false
                        )

                        Button {
                            session.draftImages.removeAll { $0.id == img.id }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, .black.opacity(0.55))
                                .font(.system(size: 16))
                        }
                        .buttonStyle(.plain)
                        .offset(x: 6, y: -6)
                    }
                }
            }
            .padding(.vertical, 2)
            .padding(.trailing, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Composer shell (Cursor-style capsule)

    private var composerShell: some View {
        HStack(alignment: .bottom, spacing: 10) {
            plusMenu

            ComposerTextView(
                text: $draftState.text,
                isFocused: $focused,
                height: $composerTextHeight,
                sessionIdentity: ObjectIdentifier(session),
                placeholder: fieldPlaceholder,
                onSubmit: { [router = composerRouter] in
                    router.send()
                }
            )
                // A session owns its native editor and NSTextInputContext. Replacing the
                // representable host on a real switch avoids synchronously rebinding the
                // previous session's IME context on SwiftUI's update pass.
                .id(ObjectIdentifier(session))
                .frame(maxWidth: .infinity)
                .frame(height: composerTextHeight, alignment: .leading)
                .layoutPriority(1)
                .padding(.vertical, 6)

            if session.isStreaming || session.isSendingFromQueue || session.isStopping || session.isCompacting {
                Button(action: { session.abort() }) {
                    Group {
                        if session.isStopping {
                            ProgressView()
                                .controlSize(.small)
                                .tint(.white)
                        } else {
                            Image(systemName: "stop.fill")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(.white)
                        }
                    }
                    .opacity(session.isStopping ? 0.6 : 1)
                    .frame(width: 28, height: 28)
                    .background(Circle().fill(Color.primary))
                }
                .buttonStyle(.plain)
                .help(session.isStopping
                      ? "正在停止…"
                      : (session.isCompacting
                          ? "停止压缩（数秒内恢复）"
                          : (session.messageQueue.isEmpty ? "中止当前回复" : "中止并发送队首")))
            }

            Button(action: { [router = composerRouter] in router.send() }) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(canSend ? Color(nsColor: .windowBackgroundColor) : Color.secondary.opacity(0.55))
                    .frame(width: 28, height: 28)
                    .background(
                        Circle().fill(canSend ? Color.primary : Color.primary.opacity(0.12))
                    )
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .keyboardShortcut(.return, modifiers: .command)
        }
        .padding(.leading, 10)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor))
                .shadow(color: Color.black.opacity(0.06), radius: 8, y: 2)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.12), lineWidth: 1)
        )
    }

    // MARK: - Plus menu & media mode

    private var plusMenu: some View {
        Menu {
            Button {
                pickFiles()
            } label: {
                Label("上传图片或 PDF", systemImage: "doc.on.doc")
            }
            Divider()
            Button {
                session.composerMode = .generateImage
                if MediaModelCatalog.models(for: .generateImage).allSatisfy({ $0.id != session.imageMediaModel.id }) {
                    session.imageMediaModel = MediaModelCatalog.defaultModel(for: .generateImage)!
                }
            } label: {
                Label("生成图像", systemImage: "wand.and.stars")
            }
            Button {
                session.composerMode = .generateVideo
                if MediaModelCatalog.models(for: .generateVideo).allSatisfy({ $0.id != session.videoMediaModel.id }) {
                    session.videoMediaModel = MediaModelCatalog.defaultModel(for: .generateVideo)!
                }
            } label: {
                Label("生成视频", systemImage: "film")
            }
        } label: {
            ZStack {
                Circle().fill(
                    session.composerMode == .chat
                        ? Color.primary.opacity(0.06)
                        : Color.accentColor.opacity(0.15)
                )
                // Drawn plus stays optically centered; SF "plus" + Menu chrome looked skewed.
                PlusGlyph(
                    color: session.composerMode == .chat ? Color.secondary : Color.accentColor
                )
            }
            .frame(width: 28, height: 28)
            .contentShape(Circle())
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("上传图片或 PDF / 生成图像 / 生成视频")
        .disabled(session.mediaBusy || composerRouter.isPDFIngestionPending(for: session))
    }

    private var mediaModeStrip: some View {
        HStack(spacing: 10) {
            Image(systemName: session.composerMode == .generateVideo ? "film" : "wand.and.stars")
                .foregroundStyle(Color.accentColor)
            Text(session.composerMode.label)
                .font(.caption.weight(.semibold))
            mediaModelMenu
            Spacer()
            if session.mediaBusy {
                ProgressView().controlSize(.mini)
            }
            Button {
                session.composerMode = .chat
                session.mediaStatus = nil
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .help("退出生成模式，回到对话")
            .disabled(session.mediaBusy || composerRouter.isPDFIngestionPending(for: session))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.accentColor.opacity(0.08))
        )
    }

    private var mediaModelMenu: some View {
        let models = MediaModelCatalog.models(for: session.composerMode)
        return Menu {
            ForEach(models) { m in
                Button {
                    if session.composerMode == .generateVideo {
                        session.videoMediaModel = m
                    } else {
                        session.imageMediaModel = m
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(m.name)
                            if currentMediaModel?.id == m.id {
                                Image(systemName: "checkmark")
                            }
                        }
                        Text(m.detail)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(currentMediaModel?.name ?? "选择模型")
                    .lineLimit(1)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2)
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Capsule().fill(Color.primary.opacity(0.06)))
        }
        .menuStyle(.borderlessButton)
        .disabled(session.mediaBusy)
        .help(currentMediaModel?.detail ?? "选择生成模型")
    }

    private var currentMediaModel: MediaModel? {
        switch session.composerMode {
        case .generateImage: return session.imageMediaModel
        case .generateVideo: return session.videoMediaModel
        case .chat: return nil
        }
    }

    private var fieldPlaceholder: String {
        if session.composerMode != .chat {
            return session.composerMode.placeholder
        }
        return session.isStreaming ? "输入将排队，完成后发送…" : "输入消息…"
    }

    // MARK: - Slash palette

    private func refreshSlashPalette() {
        composerRouter.refreshSlashPalette(disabledSkills: ToolSkillSettings.disabledSkills())
        refreshSlashKeyMonitorActive()
    }

    private func refreshSlashKeyMonitorActive() {
        slashKeyMonitor.isActive = focused
            && composerRouter.slashPaletteVisible
            && !composerRouter.slashMatches.isEmpty
    }

    /// Tab / click: fill `/name ` and keep focus for args.
    private func completeSlash(_ cmd: SlashCommand) {
        if composerRouter.completeSlash(cmd) {
            focused = true
        }
        refreshSlashKeyMonitorActive()
    }

    // MARK: - Send

    private var canSend: Bool {
        composerRouter.canSend
    }

    // MARK: - Pick / paste / drop

    private func pickFiles() {
        let pdfTarget = composerRouter.makePDFIngestionTarget(for: session)
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        panel.allowedContentTypes = [.image, .pdf]
        panel.prompt = "添加"
        panel.message = "选择要发送的图片或本地解析的 PDF"
        guard panel.runModal() == .OK else { return }
        let pdfURLs = panel.urls.filter(NativePDFIngestion.isPDF)
        let imageURLs = panel.urls.filter { !NativePDFIngestion.isPDF($0) }
        composerRouter.appendResults(imageURLs.map { ImageAttachment.make(from: $0) })
        composerRouter.ingestPDFs(pdfURLs, target: pdfTarget)
    }

    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        // Capture before NSItemProvider's asynchronous callback so an A → B
        // session switch cannot move a PDF source bundle into B's project.
        let pdfTarget = composerRouter.makePDFIngestionTarget(for: session)
        var handled = false
        let group = DispatchGroup()
        var results: [Result<DraftImage, ImageAttachment.LoadError>] = []
        var pdfURLs: [URL] = []
        let lock = NSLock()

        for provider in providers {
            // A dropped file URL is authoritative. Check its extension before
            // attempting image decode so PDFs never fall through to the image
            // attachment path.
            if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                handled = true
                group.enter()
                provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
                    defer { group.leave() }
                    let url: URL?
                    if let data = item as? Data {
                        url = URL(dataRepresentation: data, relativeTo: nil)
                    } else {
                        url = item as? URL
                    }
                    lock.lock()
                    if let url, NativePDFIngestion.isPDF(url) {
                        pdfURLs.append(url)
                    } else {
                        results.append(url.map(ImageAttachment.make(from:)) ?? .failure(.corrupt))
                    }
                    lock.unlock()
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                handled = true
                group.enter()
                provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in
                    defer { group.leave() }
                    let result: Result<DraftImage, ImageAttachment.LoadError>
                    if let data {
                        result = ImageAttachment.make(from: data)
                    } else {
                        result = .failure(.corrupt)
                    }
                    lock.lock(); results.append(result); lock.unlock()
                }
            }
        }

        guard handled else { return false }
        let router = composerRouter
        group.notify(queue: .main) {
            router.appendResults(results)
            router.ingestPDFs(pdfURLs, target: pdfTarget)
        }
        return true
    }

    // MARK: - Menus

    /// Width-threshold layout (not `ViewThatFits`). Size-fitting against borderless
    /// `Menu` + `.fixedSize()` previously cycled AttributeGraph and hung the main
    /// thread on session switch (~55s hang, 2026-07-24).
    private var responsiveStatus: some View {
        Group {
            if InputBarStatusLayout.isCompact(width: statusBarWidth) {
                compactStatus
            } else {
                wideStatus
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            GeometryReader { geo in
                Color.clear.preference(key: InputBarStatusWidthKey.self, value: geo.size.width)
            }
        )
        .onPreferenceChange(InputBarStatusWidthKey.self) { statusBarWidth = $0 }
    }

    /// Wide: model + thinking glued left; activity/metrics on the trailing edge.
    /// Inner fixedSize HStack prevents borderless Menu from claiming extra width.
    private var wideStatus: some View {
        HStack(spacing: 12) {
            HStack(spacing: 8) {
                modelMenu
                    .fixedSize()
                thinkingMenu
                    .fixedSize()
            }
            .fixedSize(horizontal: true, vertical: false)

            Spacer(minLength: 12)

            activityStatus
            metricsStatus
        }
    }

    private var compactStatus: some View {
        VStack(spacing: 6) {
            HStack(spacing: 8) {
                HStack(spacing: 8) {
                    modelMenu
                        .fixedSize()
                    thinkingMenu
                        .fixedSize()
                }
                .fixedSize(horizontal: true, vertical: false)

                Spacer(minLength: 0)
            }
            HStack(spacing: 8) {
                activityStatus
                Spacer(minLength: 4)
                metricsStatus
            }
        }
    }

    @ViewBuilder
    private var activityStatus: some View {
        if session.isStreaming {
            Text(session.messageQueue.isEmpty
                 ? "生成中…"
                 : "生成中 · \(session.messageQueue.count) 条排队")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        if !session.processAlive {
            Text("进程已退出")
                .font(.caption)
                .foregroundStyle(.red)
                .lineLimit(1)
        }
    }

    /// Ring fraction + footer label. Full data → ring + "38k/262k" (no percent,
    /// the ring already encodes it); degraded forms fall back to contextStatusText.
    private var contextMetric: (ring: Double?, text: String)? {
        if let t = session.contextTokens, let w = session.contextWindow, w > 0 {
            return (Double(t) / Double(w), "\(TokenFormat.compact(t))/\(TokenFormat.compact(w))")
        }
        if let text = session.contextStatusText {
            return (nil, text)
        }
        return nil
    }

    private var metricsStatus: some View {
        HStack(spacing: 8) {
            if let ctx = contextMetric {
                let hot = (ctx.ring ?? 0) > 0.8
                HStack(spacing: 4) {
                    if let ring = ctx.ring {
                        ContextRing(progress: ring, hot: hot)
                    }
                    Text(ctx.text)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(hot ? .orange : .secondary)
                }
                .help("上下文占用")
                .contentShape(Rectangle())
                .onTapGesture { showContextPopover.toggle() }
                .popover(isPresented: $showContextPopover, arrowEdge: .bottom) {
                    contextPopover
                        .frame(width: 264)
                        .padding(10)
                }
            }
            if let quota = session.quotaPercent, session.model?.shouldShowAccountQuota == true {
                let label = session.quotaPeriodLabel ?? "额"
                let help = session.quotaPeriodHelp ?? "额度"
                Text("\(label) \(Int(quota.rounded()))%")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(quota > 80 ? .orange : .secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Color.primary.opacity(0.06)))
                    .help(help)
                    .contentShape(Capsule())
                    .onTapGesture { showQuotaPopover.toggle() }
                    .popover(isPresented: $showQuotaPopover, arrowEdge: .bottom) {
                        quotaPopover
                            .frame(width: 264)
                            .padding(10)
                    }
            } else if let balance = session.accountBalance {
                Text(balance)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Color.primary.opacity(0.06)))
                    .help("账户余额")
                    .contentShape(Capsule())
                    .onTapGesture { showBalancePopover.toggle() }
                    .popover(isPresented: $showBalancePopover, arrowEdge: .bottom) {
                        balancePopover
                            .frame(width: 264)
                            .padding(10)
                    }
            } else if session.quotaProvider == .qwenTokenPlan
                    && session.model?.shouldShowAccountQuota == true
                    && session.quotaPercent == nil {
                // 未登录（无账号配额数据）时显示「登录 Token Plan」胶囊，点击打开内置浏览器到百炼登录页。
                Text("Token Plan 登录")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Color.primary.opacity(0.06)))
                    .help("登录阿里云百炼以查看 Token Plan 额度")
                    .contentShape(Capsule())
                    .onTapGesture { session.openEmbeddedBrowser(url: bailianTokenPlanURL) }
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private var quotaPopover: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(session.quotaProvider?.accountLabel ?? "账号额度")
                .font(.caption.bold())
                .foregroundStyle(.secondary)
            if session.quotaWindows.isEmpty {
                Text("暂无用量数据")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 6)
            } else {
                ForEach(session.quotaWindows) { w in
                    quotaWindowRow(w)
                }
            }
        }
    }

    private var balancePopover: some View {
        // Re-read unit + rate at render time so a settings change shows up
        // immediately on the next popover open.
        let unit = PricingSettings.unit()
        let display = BalanceSpendDisplay(
            sessionCostUSD: session.cost,
            last30DaysUSD: balanceLast30Days ?? 0,
            unit: unit,
            rate: ModelPricing.Catalog.shared.exchangeRate
        )
        return VStack(alignment: .leading, spacing: 8) {
            Text("账户余额")
                .font(.caption.bold())
                .foregroundStyle(.secondary)
            contextDetailRow("本会话消耗", display.sessionSpend)
            contextDetailRow("30天内消耗", balanceLast30Days == nil ? "…" : display.last30DaysSpend)
        }
        // 只在 popover 打开期间刷新：任务随 popover 关闭自动取消，未开 popover
        // 的会话不产生任何计算；同时打开多个 popover 也各自只刷新自己的数字。
        .task {
            while !Task.isCancelled {
                reloadBalanceLast30Days()
                try? await Task.sleep(for: .seconds(15))
            }
        }
    }

    /// Lazy, non-blocking refresh of the 30-day total in raw pi USD (`.ledger`)
    /// + pi main-session backfill; the popover converts to the display unit at
    /// render time. Mirrors SettingsSheet.reloadUsage: detached utility task +
    /// MainActor hop.
    private func reloadBalanceLast30Days() {
        guard !balanceReloadInFlight else { return }
        balanceReloadInFlight = true
        // 只统计当前余额提供方（deepseek/moonshot/siliconflow/openrouter）自己账户的
        // 消耗：ledger 行按 model id 归属过滤，pi 会话回填按 message.provider 过滤。
        let bp = session.model?.balanceProvider
        Task.detached(priority: .utility) {
            guard let bp else {
                await MainActor.run {
                    balanceLast30Days = 0
                    balanceReloadInFlight = false
                }
                return
            }
            let records = TokenUsageStats.loadSharedRecords()
                .filter { bp.matches(modelId: $0.model) }
            let report = TokenUsageStats.aggregate(
                records: records,
                period: .last30Days,
                groupBy: .model,
                costMode: .ledger
            )
            // 回填从未经 ledger 记账的 pi 主会话消耗（headless/CLI 会话、旧历史）：
            // 凡与 ledger 主通道会话（resume: 精确路径 / new: 时间窗口）对得上的
            // pi 会话文件被跳过，避免重复计费；其余文件只计 30 天窗口内、且属于
            // 当前余额提供方的用量。
            let meta = PiMainUsageBackfill.ledgerMainSessionMeta()
            let backfill = PiMainUsageBackfill.sumLast30Days(
                ledgerMainSessions: meta.mainSessions,
                newSessionFirstTs: meta.newSessionFirstTs,
                balanceProvider: bp
            )
            await MainActor.run {
                balanceLast30Days = report.total.cost + backfill
                balanceReloadInFlight = false
            }
        }
    }

    private func quotaWindowRow(_ w: QuotaWindow) -> some View {
        let selected = session.quotaSelectedWindowId == w.id
        return HStack(alignment: .top, spacing: 8) {
            Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(selected ? Color.accentColor : Color.secondary)
                .font(.caption)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(w.title).font(.caption.bold())
                    Spacer()
                    Text("\(Int(w.usedPercent.rounded()))%")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(w.usedPercent > 80 ? Color.orange : Color.secondary)
                }
                ProgressView(value: w.usedPercent, total: 100)
                    .tint(w.usedPercent > 80 ? Color.orange : Color.accentColor)
                if let reset = w.resetsAt {
                    Text("重置于 \(Self.quotaDateFmt.string(from: reset))")
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary.opacity(0.7))
                }
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { session.selectQuotaWindow(id: w.id) }
    }

    private static let quotaDateFmt: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MM-dd HH:mm"
        return f
    }()

    private var contextPopover: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("上下文占用")
                .font(.caption.bold())
                .foregroundStyle(.secondary)
            if let t = session.contextTokens, let w = session.contextWindow, w > 0 {
                let pct = Double(t) / Double(w) * 100
                HStack {
                    Text("\(TokenFormat.compact(t)) / \(TokenFormat.compact(w))")
                        .font(.caption.monospacedDigit())
                    Spacer()
                    Text("\(Int(pct.rounded()))%")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(pct > 80 ? Color.orange : Color.secondary)
                }
                ProgressView(value: pct, total: 100)
                    .tint(pct > 80 ? Color.orange : Color.accentColor)
            } else {
                Text("暂无上下文数据")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Divider()
            Text("本次会话")
                .font(.caption.bold())
                .foregroundStyle(.secondary)
            contextDetailRow("输入", TokenFormat.compact(session.sessionInput))
            contextDetailRow("输出", TokenFormat.compact(session.sessionOutput))
            contextDetailRow("缓存读取", TokenFormat.compact(session.sessionCacheRead))
            let cacheDenom = session.sessionInput + session.sessionCacheRead + session.sessionCacheWrite
            if cacheDenom > 0 {
                let hit = Double(session.sessionCacheRead) / Double(cacheDenom)
                contextDetailRow("缓存命中率", "\(Int((hit * 100).rounded()))%")
            }
            contextDetailRow(
                "累计花费",
                formatSpend(
                    usdCost: session.cost,
                    unit: PricingSettings.unit(),
                    rate: ModelPricing.Catalog.shared.exchangeRate
                )
            )
            if let stats = session.currentModelSpeed {
                Divider()
                HStack {
                    Text("当前模型")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("\(stats.sampleCount) 次采样")
                        .font(.caption2)
                        .foregroundStyle(.secondary.opacity(0.7))
                }
                contextDetailRow("平均首字", formatTTFT(stats.avgTTFT))
                contextDetailRow("生成速度", formatTokensPerSecond(stats.avgTokensPerSecond))
            }
        }
    }

    private func contextDetailRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.caption.monospacedDigit())
        }
    }

    private var modelMenu: some View {
        // Read revision so toggles in Settings refresh this menu immediately.
        let _ = store.modelVisibilityRevision
        let visible = ModelVisibility.pickerModels(
            from: session.availableModels,
            selectedId: session.model?.id
        )
        let providers = ModelVisibility.pickerProviders(
            from: session.availableModels,
            selectedId: session.model?.id
        )
        return Menu {
            ForEach(providers, id: \.self) { provider in
                Section(provider) {
                    ForEach(visible.filter { $0.provider == provider }) { m in
                        Button {
                            session.setModel(m)
                        } label: {
                            HStack(spacing: 6) {
                                ProviderLogo(model: m, size: 12)
                                Text(m.name)
                                if ModelCapabilities.isRecommended(.boss, for: m.id) {
                                    ModelRoleBadge(role: .boss)
                                }
                                if m.id == session.model?.id {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                if let model = session.model {
                    ProviderLogo(model: model, size: 12)
                } else {
                    Image(systemName: "cpu")
                        .font(.caption)
                }
                Text(session.model?.name ?? "选择模型")
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(Color.primary.opacity(0.06)))
        }
        .menuStyle(.borderlessButton)
    }

    private var thinkingMenu: some View {
        Menu {
            ForEach(session.thinkingLevels, id: \.self) { level in
                Button {
                    session.setThinkingLevel(level)
                } label: {
                    if level == session.thinkingLevel {
                        Label(level, systemImage: "checkmark")
                    } else {
                        Text(level)
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "brain")
                Text(session.thinkingLevel)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(Color.primary.opacity(0.06)))
        }
        .menuStyle(.borderlessButton)
        .disabled(session.thinkingLevels == ["off"])
    }

}

/// Optically centered + for the composer attach control (SF Symbol looked skewed in Menu label).
private struct PlusGlyph: View {
    var color: Color
    var arm: CGFloat = 5
    var lineWidth: CGFloat = 1.6

    var body: some View {
        Canvas { context, size in
            let mid = CGPoint(x: size.width / 2, y: size.height / 2)
            var horizontal = Path()
            horizontal.move(to: CGPoint(x: mid.x - arm, y: mid.y))
            horizontal.addLine(to: CGPoint(x: mid.x + arm, y: mid.y))
            var vertical = Path()
            vertical.move(to: CGPoint(x: mid.x, y: mid.y - arm))
            vertical.addLine(to: CGPoint(x: mid.x, y: mid.y + arm))
            let style = StrokeStyle(lineWidth: lineWidth, lineCap: .round)
            context.stroke(horizontal, with: .color(color), style: style)
            context.stroke(vertical, with: .color(color), style: style)
        }
        .frame(width: 14, height: 14)
        .accessibilityHidden(true)
    }
}

/// Caption-row-sized circular progress ring for context window usage.
private struct ContextRing: View {
    var progress: Double
    var hot: Bool

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.primary.opacity(0.12), lineWidth: 2.5)
            Circle()
                .trim(from: 0, to: min(max(progress, 0), 1))
                .stroke(hot ? Color.orange : Color.accentColor,
                        style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: 14, height: 14)
        .accessibilityHidden(true)
    }
}

private struct InputBarStatusWidthKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}
