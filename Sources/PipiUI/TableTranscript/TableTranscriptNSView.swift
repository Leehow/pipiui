import AppKit
import SwiftUI

/// AppKit virtualized transcript: plain NSTableView + single NSHostingView per cell.
///
/// Design notes (phase-1 POC):
/// - **Order**: oldest → newest (no 180° transform). Stick-to-bottom uses document end.
/// - **Reuse**: one `NSHostingView` per cell; `rootView` is replaced on configure (WWDC22).
/// - **Heights**: cache + `noteHeightOfRows` after hosting `fittingSize`; uncached rows
///   start from `TableTranscriptEntry.estimatedHeight`.
final class TableTranscriptNSView: NSView {
    typealias RowContentBuilder = (TableTranscriptEntry) -> AnyView

    private let scrollView = NSScrollView()
    private let tableView = NSTableView()
    private let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("transcript"))
    private let heightCache = TableTranscriptHeightCache()
    private var entries: [TableTranscriptEntry] = []
    private var contentBuilder: RowContentBuilder = { _ in AnyView(EmptyView()) }
    private var messageSpacing: CGFloat = 12
    private var contentInsets = NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)

    /// Mirrors `session.pinTranscriptToBottom`. Written from SwiftUI; read on scroll.
    var isPinned: Bool = true {
        didSet { if isPinned { scrollToBottom(animated: false) } }
    }
    var onPinChange: ((Bool) -> Void)?
    /// Fired when the user approaches visual history top (document start).
    var onApproachHistoryTop: (() -> Void)?

    private var liveScrollObs: NSObjectProtocol?
    private var endScrollObs: NSObjectProtocol?
    private var boundsObs: NSObjectProtocol?
    private var frameObs: NSObjectProtocol?
    private var hasObservedUserScroll = false
    private var topPrefetchState = TranscriptHistoryPrefetchTrigger.State()
    private var topLoadingEnabled = false
    private var pinFollowScheduled = false
    private var heightNoteGeneration: UInt64 = 0

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setup()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        detachScrollObservers()
    }

    // MARK: - Public API

    func update(
        entries: [TableTranscriptEntry],
        messageSpacing: CGFloat,
        isPinned: Bool,
        topLoadingEnabled: Bool,
        contentBuilder: @escaping RowContentBuilder
    ) {
        let previousIDs = Set(self.entries.map(\.id))
        let nextIDs = Set(entries.map(\.id))
        let removed = previousIDs.subtracting(nextIDs)
        if !removed.isEmpty {
            heightCache.remove(ids: removed)
        }

        let entriesChanged = self.entries != entries
        let spacingChanged = abs(self.messageSpacing - messageSpacing) >= 0.5
        self.entries = entries
        self.messageSpacing = messageSpacing
        self.contentBuilder = contentBuilder
        self.topLoadingEnabled = topLoadingEnabled
        if spacingChanged {
            tableView.intercellSpacing = NSSize(width: 0, height: messageSpacing)
        }
        // Assign through property so didSet can follow when pin flips true.
        if self.isPinned != isPinned {
            self.isPinned = isPinned
        }

        let width = max(1, tableView.bounds.width)
        heightCache.noteContentWidth(width)

        if entriesChanged || spacingChanged {
            // Full reload is fine for POC window sizes (≤ a few pages). Phase-2:
            // diff + insert/remove rows while preserving scroll anchor.
            tableView.reloadData()
            if self.isPinned {
                scrollToBottom(animated: false)
            }
        } else {
            // Same structure; streaming content may still need height refresh for
            // the last few rows. Force layout of visible cells via noteHeight.
            let visible = tableView.rows(in: tableView.visibleRect)
            if visible.length > 0 {
                tableView.noteHeightOfRows(withIndexesChanged: IndexSet(integersIn: visible.lowerBound..<(visible.lowerBound + visible.length)))
            }
            if self.isPinned {
                schedulePinnedFollow()
            }
        }
    }

    func scrollToBottom(animated: Bool) {
        guard !entries.isEmpty else { return }
        let last = entries.count - 1
        // Ensure layout has a row rect before scrolling.
        tableView.layoutSubtreeIfNeeded()
        if animated {
            tableView.scrollRowToVisible(last)
        } else {
            NSAnimationContext.beginGrouping()
            NSAnimationContext.current.duration = 0
            tableView.scrollRowToVisible(last)
            // Also pin clip origin exactly — scrollRowToVisible can stop short when
            // the last row height is still an estimate.
            if let document = scrollView.documentView {
                let clip = scrollView.contentView
                let maxY = max(0, document.frame.height - clip.bounds.height)
                clip.scroll(to: NSPoint(x: 0, y: maxY))
                scrollView.reflectScrolledClipView(clip)
            }
            NSAnimationContext.endGrouping()
        }
    }

    // MARK: - Setup

    private func setup() {
        wantsLayer = true

        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.borderType = .noBorder
        scrollView.drawsBackground = false
        scrollView.contentView.drawsBackground = false
        OverlayScrollers.apply(to: scrollView)

        tableView.headerView = nil
        tableView.allowsColumnReordering = false
        tableView.allowsColumnResizing = false
        tableView.allowsColumnSelection = false
        tableView.allowsEmptySelection = true
        tableView.allowsMultipleSelection = false
        tableView.allowsTypeSelect = false
        tableView.backgroundColor = .clear
        tableView.selectionHighlightStyle = .none
        tableView.focusRingType = .none
        tableView.intercellSpacing = NSSize(width: 0, height: messageSpacing)
        tableView.rowSizeStyle = .custom
        tableView.style = .plain
        tableView.usesAlternatingRowBackgroundColors = false
        tableView.gridStyleMask = []
        tableView.delegate = self
        tableView.dataSource = self
        tableView.columnAutoresizingStyle = .lastColumnOnlyAutoresizingStyle
        column.resizingMask = .autoresizingMask
        tableView.addTableColumn(column)
        tableView.setContentHuggingPriority(.defaultLow, for: .horizontal)
        tableView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        scrollView.documentView = tableView
        // Match legacy transcript `.padding(16)` as clip content insets (not per-row).
        scrollView.automaticallyAdjustsContentInsets = false
        scrollView.contentInsets = contentInsets
        scrollView.scrollerInsets = contentInsets
        addSubview(scrollView)
        NSLayoutConstraint.activate([
            scrollView.leadingAnchor.constraint(equalTo: leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: trailingAnchor),
            scrollView.topAnchor.constraint(equalTo: topAnchor),
            scrollView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])

        attachScrollObservers()
    }

    override func layout() {
        super.layout()
        let width = max(1, bounds.width)
        if abs(column.width - width) > 0.5 {
            column.width = width
            heightCache.noteContentWidth(width)
        }
        tableView.sizeLastColumnToFit()
    }

    // MARK: - Scroll / pin

    private func attachScrollObservers() {
        detachScrollObservers()
        let center = NotificationCenter.default
        liveScrollObs = center.addObserver(
            forName: NSScrollView.didLiveScrollNotification,
            object: scrollView,
            queue: .main
        ) { [weak self] _ in
            self?.handleUserScroll()
        }
        endScrollObs = center.addObserver(
            forName: NSScrollView.didEndLiveScrollNotification,
            object: scrollView,
            queue: .main
        ) { [weak self] _ in
            self?.handleUserScroll()
        }
        let clip = scrollView.contentView
        clip.postsBoundsChangedNotifications = true
        boundsObs = center.addObserver(
            forName: NSView.boundsDidChangeNotification,
            object: clip,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            self.evaluateHistoryTop()
            // Knob drag: mouse held + clip move ⇒ user scroll.
            if Int(NSEvent.pressedMouseButtons) != 0,
               self.window?.inLiveResize != true {
                self.handleUserScroll()
            } else if self.isPinned {
                self.schedulePinnedFollow()
            }
        }
        if let document = scrollView.documentView {
            document.postsFrameChangedNotifications = true
            frameObs = center.addObserver(
                forName: NSView.frameDidChangeNotification,
                object: document,
                queue: .main
            ) { [weak self] _ in
                guard let self else { return }
                self.evaluateHistoryTop()
                if self.isPinned {
                    self.schedulePinnedFollow()
                }
            }
        }
    }

    private func detachScrollObservers() {
        let center = NotificationCenter.default
        for obs in [liveScrollObs, endScrollObs, boundsObs, frameObs] {
            if let obs { center.removeObserver(obs) }
        }
        liveScrollObs = nil
        endScrollObs = nil
        boundsObs = nil
        frameObs = nil
    }

    private func handleUserScroll() {
        hasObservedUserScroll = true
        guard window?.inLiveResize != true else { return }
        let distance = distanceFromDocumentEnd()
        let desired = StickToBottomLogic.desiredPin(
            currentlyPinned: isPinned,
            distanceFromBottom: distance,
            userLiveScroll: true,
            allowUnpin: true
        )
        if let desired, desired != isPinned {
            isPinned = desired
            onPinChange?(desired)
        }
        evaluateHistoryTop()
    }

    private func schedulePinnedFollow() {
        guard isPinned, !pinFollowScheduled else { return }
        pinFollowScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.pinFollowScheduled = false
            guard self.isPinned, self.window?.inLiveResize != true else { return }
            self.scrollToBottom(animated: false)
        }
    }

    private func distanceFromDocumentEnd() -> CGFloat {
        let clip = scrollView.contentView
        let visible = clip.bounds
        let contentHeight = scrollView.documentView?.frame.height ?? visible.height
        // NSTableView's document is flipped.
        return StickToBottomLogic.distanceFromDocumentEnd(
            visible: visible,
            contentHeight: contentHeight,
            documentIsFlipped: true
        )
    }

    private func distanceFromDocumentStart() -> CGFloat {
        let clip = scrollView.contentView
        let visible = clip.bounds
        let contentHeight = scrollView.documentView?.frame.height ?? visible.height
        return StickToBottomLogic.distanceFromDocumentStart(
            visible: visible,
            contentHeight: contentHeight,
            documentIsFlipped: true
        )
    }

    private func evaluateHistoryTop() {
        let distance = distanceFromDocumentStart()
        let enabled = topLoadingEnabled && hasObservedUserScroll && !isPinned
        let shouldLoad = TranscriptHistoryPrefetchTrigger.step(
            state: &topPrefetchState,
            distanceFromDocumentStart: distance,
            enabled: enabled
        )
        if shouldLoad {
            onApproachHistoryTop?()
        }
    }

    // MARK: - Height reporting

    fileprivate func reportMeasuredHeight(row: Int, height: CGFloat) {
        guard entries.indices.contains(row) else { return }
        let id = entries[row].id
        let total = TableTranscriptHeightCache.clamp(height)
        guard heightCache.store(id: id, height: total) else { return }
        heightNoteGeneration &+= 1
        let generation = heightNoteGeneration
        // Coalesce noteHeight calls — streaming can measure every token.
        DispatchQueue.main.async { [weak self] in
            guard let self, generation == self.heightNoteGeneration else { return }
            self.tableView.noteHeightOfRows(withIndexesChanged: IndexSet(integer: row))
            if self.isPinned {
                self.schedulePinnedFollow()
            }
        }
    }
}

// MARK: - NSTableViewDataSource & Delegate

extension TableTranscriptNSView: NSTableViewDataSource, NSTableViewDelegate {
    func numberOfRows(in tableView: NSTableView) -> Int {
        entries.count
    }

    func tableView(_ tableView: NSTableView, heightOfRow row: Int) -> CGFloat {
        guard entries.indices.contains(row) else {
            return TableTranscriptHeightCache.defaultEstimate
        }
        let entry = entries[row]
        if let cached = heightCache.height(for: entry.id) {
            return cached
        }
        // Prefer coarse per-entry estimate before the first hosting measurement.
        return entry.estimatedHeight
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let identifier = NSUserInterfaceItemIdentifier("TableTranscriptCell")
        let cell: TableTranscriptCellView
        if let reused = tableView.makeView(withIdentifier: identifier, owner: nil) as? TableTranscriptCellView {
            cell = reused
        } else {
            cell = TableTranscriptCellView()
            cell.identifier = identifier
        }
        guard entries.indices.contains(row) else { return cell }
        let entry = entries[row]
        // Horizontal inset is owned by scrollView.contentInsets; cells span the full
        // table width so height measurement matches the visible text column.
        let contentWidth = max(1, tableView.bounds.width)
        let view = contentBuilder(entry)
        cell.configure(
            rootView: view,
            contentWidth: contentWidth,
            onMeasuredHeight: { [weak self] height in
                self?.reportMeasuredHeight(row: row, height: height)
            }
        )
        return cell
    }

    func tableView(_ tableView: NSTableView, shouldSelectRow row: Int) -> Bool {
        false
    }

    func tableView(_ tableView: NSTableView, rowViewForRow row: Int) -> NSTableRowView? {
        let identifier = NSUserInterfaceItemIdentifier("TableTranscriptRow")
        if let reused = tableView.makeView(withIdentifier: identifier, owner: nil) as? TableTranscriptRowView {
            return reused
        }
        let rowView = TableTranscriptRowView()
        rowView.identifier = identifier
        return rowView
    }
}

// MARK: - Row / Cell

/// Non-highlighting row chrome.
private final class TableTranscriptRowView: NSTableRowView {
    override var isEmphasized: Bool {
        get { false }
        set {}
    }

    override func drawSelection(in dirtyRect: NSRect) {}
    override func drawBackground(in dirtyRect: NSRect) {}
}

/// Single-hosting-view cell. Reuse updates `rootView` only — never add/remove
/// hosting subviews during scroll (WWDC22-10075).
private final class TableTranscriptCellView: NSTableCellView {
    private var hostingView: NSHostingView<AnyView>?
    private var onMeasuredHeight: ((CGFloat) -> Void)?
    private var measureWorkItem: DispatchWorkItem?
    private var contentWidth: CGFloat = 0

    func configure(
        rootView: AnyView,
        contentWidth: CGFloat,
        onMeasuredHeight: @escaping (CGFloat) -> Void
    ) {
        self.onMeasuredHeight = onMeasuredHeight
        self.contentWidth = contentWidth

        if let hostingView {
            hostingView.rootView = rootView
        } else {
            let host = NSHostingView(rootView: rootView)
            // Keep a single hosting view for the cell lifetime; only rootView updates
            // on reuse (WWDC22-10075). intrinsicContentSize drives row height measure.
            if #available(macOS 13.0, *) {
                host.sizingOptions = [.intrinsicContentSize]
            }
            host.translatesAutoresizingMaskIntoConstraints = false
            addSubview(host)
            NSLayoutConstraint.activate([
                host.leadingAnchor.constraint(equalTo: leadingAnchor),
                host.trailingAnchor.constraint(equalTo: trailingAnchor),
                host.topAnchor.constraint(equalTo: topAnchor),
                host.bottomAnchor.constraint(equalTo: bottomAnchor),
            ])
            hostingView = host
        }

        scheduleMeasure()
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        measureWorkItem?.cancel()
        measureWorkItem = nil
        onMeasuredHeight = nil
    }

    override func layout() {
        super.layout()
        scheduleMeasure()
    }

    private func scheduleMeasure() {
        measureWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.publishMeasuredHeight()
        }
        measureWorkItem = work
        DispatchQueue.main.async(execute: work)
    }

    private func publishMeasuredHeight() {
        guard let hostingView, contentWidth > 1 else { return }
        // Pin width so SwiftUI/AppKit layout resolves markdown height for this column.
        let previousHeight = hostingView.frame.height
        hostingView.frame = CGRect(x: 0, y: 0, width: contentWidth, height: previousHeight)
        hostingView.layoutSubtreeIfNeeded()
        var height = hostingView.fittingSize.height
        if !height.isFinite || height < 1 {
            height = hostingView.intrinsicContentSize.height
        }
        if !height.isFinite || height < 1 {
            height = TableTranscriptHeightCache.defaultEstimate
        }
        onMeasuredHeight?(height)
    }
}

// MARK: - NSViewRepresentable bridge

struct TableTranscriptRepresentable: NSViewRepresentable {
    let entries: [TableTranscriptEntry]
    let messageSpacing: CGFloat
    @Binding var isPinned: Bool
    let topLoadingEnabled: Bool
    let onApproachHistoryTop: () -> Void
    let contentBuilder: (TableTranscriptEntry) -> AnyView

    func makeCoordinator() -> Coordinator {
        Coordinator(isPinned: $isPinned, onApproachHistoryTop: onApproachHistoryTop)
    }

    func makeNSView(context: Context) -> TableTranscriptNSView {
        let view = TableTranscriptNSView(frame: .zero)
        context.coordinator.attach(to: view)
        return view
    }

    func updateNSView(_ nsView: TableTranscriptNSView, context: Context) {
        context.coordinator.isPinned = $isPinned
        context.coordinator.onApproachHistoryTop = onApproachHistoryTop
        nsView.onPinChange = { [weak coordinator = context.coordinator] pinned in
            coordinator?.writePin(pinned)
        }
        nsView.onApproachHistoryTop = { [weak coordinator = context.coordinator] in
            coordinator?.onApproachHistoryTop()
        }
        nsView.update(
            entries: entries,
            messageSpacing: messageSpacing,
            isPinned: isPinned,
            topLoadingEnabled: topLoadingEnabled,
            contentBuilder: contentBuilder
        )
    }

    static func dismantleNSView(_ nsView: TableTranscriptNSView, coordinator: Coordinator) {
        nsView.onPinChange = nil
        nsView.onApproachHistoryTop = nil
    }

    final class Coordinator {
        var isPinned: Binding<Bool>
        var onApproachHistoryTop: () -> Void
        private var pinWriteScheduled = false
        private var pendingPin: Bool?

        init(isPinned: Binding<Bool>, onApproachHistoryTop: @escaping () -> Void) {
            self.isPinned = isPinned
            self.onApproachHistoryTop = onApproachHistoryTop
        }

        func attach(to view: TableTranscriptNSView) {
            view.onPinChange = { [weak self] pinned in
                self?.writePin(pinned)
            }
        }

        func writePin(_ pinned: Bool) {
            pendingPin = pinned
            guard !pinWriteScheduled else { return }
            pinWriteScheduled = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.pinWriteScheduled = false
                if let value = self.pendingPin, self.isPinned.wrappedValue != value {
                    self.isPinned.wrappedValue = value
                }
                self.pendingPin = nil
            }
        }
    }
}
