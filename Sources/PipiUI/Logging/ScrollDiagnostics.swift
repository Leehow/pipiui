import AppKit
import Combine

/// Explains the "切进会话先白屏、拖一下滚动条才出字" report.
///
/// Root cause (confirmed by logs: `document=10403 visible=9585..10403 (818) subviews=1`):
/// the transcript was a `LazyVStack` inside a bottom-anchored `ScrollView`. On
/// session switch `proxy.scrollTo("bottom")` lands the clip view on the bottom
/// anchor (`overshoot=0`), but a LazyVStack does not realize the message rows
/// sitting in the visible rectangle above that anchor — only the anchor row
/// itself gets realized (`subviews=1`), so the pane stays blank until a real
/// scroll event (dragging the scrollbar) forces the lazy stack to populate.
/// Fix: the transcript now uses a non-lazy `VStack`; realized-row budget is the
/// same because `transcriptVisibleCount` already caps `ForEach` to `suffix(~150)`.
///
/// This observer records the three numbers that tell those cases apart:
/// document height, visible rectangle, and how far the visible rectangle sits
/// outside the document. No view code is involved, so it stays out of the way of
/// whatever the transcript view is doing.
public final class ScrollDiagnostics {
    public static let shared = ScrollDiagnostics()

    /// Delays after a session switch at which the scroll state is sampled.
    public static let sampleDelays: [TimeInterval] = [0.15, 0.6]

    /// A clip-view move within this window of a live-scroll notification is
    /// considered "the same scroll", i.e. one the pin tracker did observe.
    public static let liveScrollAttributionWindow: TimeInterval = 0.15
    /// Minimum gap between two "invisible scroll" log lines.
    public static let invisibleScrollLogInterval: TimeInterval = 1.0

    private var isInstalled = false
    private var cancellables: Set<AnyCancellable> = []
    private var observers: [NSObjectProtocol] = []
    private var lastLiveScroll: Date = .distantPast
    private var lastInvisibleScrollLog: Date = .distantPast

    private init() {}

    /// Idempotent. Main thread.
    func install(store: AppStore = .shared) {
        guard !isInstalled else { return }
        isInstalled = true

        store.$selectedSessionKey
            .removeDuplicates()
            .sink { [weak self] key in
                guard let key else { return }
                Log.info("session switch → \(key)", category: .session)
                self?.scheduleSamples(label: "after session switch")
            }
            .store(in: &cancellables)

        installScrollSourceObservers()
    }

    /// Distinguishes scrolls the stick-to-bottom tracker can see from ones it cannot.
    ///
    /// `StickToBottomTracker` unpins only on `didLiveScroll`, which AppKit posts for
    /// wheel/trackpad gestures. Dragging the scroller knob moves the clip view without
    /// that notification, so the view stays "pinned" and every streaming chunk yanks
    /// it back to the bottom while the user is still dragging. This logs exactly that
    /// mismatch instead of leaving it to guesswork.
    private func installScrollSourceObservers() {
        let center = NotificationCenter.default
        observers.append(
            center.addObserver(
                forName: NSScrollView.didLiveScrollNotification, object: nil, queue: .main
            ) { [weak self] _ in
                self?.lastLiveScroll = Date()
            }
        )
        observers.append(
            center.addObserver(
                forName: NSView.boundsDidChangeNotification, object: nil, queue: .main
            ) { [weak self] notification in
                guard let self, notification.object is NSClipView else { return }
                self.noteClipViewMoved()
            }
        )
    }

    private func noteClipViewMoved() {
        let now = Date()
        guard now.timeIntervalSince(lastLiveScroll) > Self.liveScrollAttributionWindow else { return }
        guard now.timeIntervalSince(lastInvisibleScrollLog) > Self.invisibleScrollLogInterval else { return }
        lastInvisibleScrollLog = now
        Log.debug(
            "scroll moved without a live-scroll notification (scroller drag or programmatic scrollTo) — "
                + "stick-to-bottom cannot see this one",
            category: .ui
        )
    }

    private func scheduleSamples(label: String) {
        for delay in Self.sampleDelays {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                Self.sample(label: "\(label) t+\(delay)s")
            }
        }
    }

    /// Logs every sizeable scroll view in the key window.
    public static func sample(label: String) {
        guard let window = NSApp?.keyWindow ?? NSApp?.windows.first(where: { $0.isVisible }),
              let root = window.contentView else {
            Log.debug("scroll sample \(label): no window", category: .ui)
            return
        }

        let scrollViews = collectScrollViews(in: root)
            .filter { $0.bounds.width >= 200 && $0.bounds.height >= 200 }

        if scrollViews.isEmpty {
            Log.warn("scroll sample \(label): no transcript-sized scroll view found", category: .ui)
            return
        }

        for scrollView in scrollViews {
            let state = ScrollState(scrollView)
            if state.isBlankSignature {
                Log.warn("scroll sample \(label): \(state.description) — BLANK signature", category: .ui)
            } else {
                Log.info("scroll sample \(label): \(state.description)", category: .ui)
            }
        }
    }

    static func collectScrollViews(in view: NSView, limit: Int = 8) -> [NSScrollView] {
        var found: [NSScrollView] = []
        var queue: [NSView] = [view]
        while !queue.isEmpty, found.count < limit {
            let current = queue.removeFirst()
            if let scrollView = current as? NSScrollView {
                found.append(scrollView)
            }
            queue.append(contentsOf: current.subviews)
        }
        return found
    }
}

/// Snapshot of one scroll view, plus the rule that decides whether it looks blank.
struct ScrollState {
    let documentHeight: CGFloat
    let visibleRect: NSRect
    /// Rendered subview count of the document view — 0 means nothing was realized.
    let realizedSubviews: Int

    init(_ scrollView: NSScrollView) {
        let document = scrollView.documentView
        documentHeight = document?.frame.height ?? 0
        visibleRect = scrollView.documentVisibleRect
        realizedSubviews = document?.subviews.count ?? 0
    }

    init(documentHeight: CGFloat, visibleRect: NSRect, realizedSubviews: Int) {
        self.documentHeight = documentHeight
        self.visibleRect = visibleRect
        self.realizedSubviews = realizedSubviews
    }

    /// How far the visible rectangle reaches past the end of the document.
    var overshoot: CGFloat {
        max(0, visibleRect.maxY - documentHeight)
    }

    /// The state that reads as "白屏": there is content, the viewport has a real
    /// size, yet nothing is placed where the user is looking.
    var isBlankSignature: Bool {
        guard visibleRect.height >= 1 else { return false }
        if documentHeight <= 1 { return true }
        if realizedSubviews == 0 { return true }
        // The transcript is bottom-anchored, so `realizedSubviews == 1` means only
        // the `Color.clear.id("bottom")` anchor row was realized while the message
        // rows in the visible rectangle stayed virtual — the signature produced by a
        // programmatic `scrollTo("bottom")` that a LazyVStack did not follow.
        if realizedSubviews == 1, documentHeight > visibleRect.height { return true }
        return overshoot >= visibleRect.height
    }

    var description: String {
        String(
            format: "document=%.0fpt visible=%.0f..%.0f (%.0fpt) subviews=%d overshoot=%.0f",
            documentHeight,
            visibleRect.minY, visibleRect.maxY, visibleRect.height,
            realizedSubviews,
            overshoot
        )
    }
}
