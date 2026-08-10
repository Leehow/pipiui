import Foundation

/// Pure viewport / jump state slice (spec seam B).
///
/// Models `liveLatest`, unidirectional `history`, and directed bounded `seek`
/// without touching `ChatDetailView` or `ChatSession`. UI hosts reduce actions
/// and apply returned effects only when `sessionKey` + `generation` still match.
enum TranscriptViewport {
    /// Tunables for seek mounting and post-jump layout settling.
    struct Config: Equatable, Sendable {
        /// Max rows mounted around a seek target. Never grows to target→latest.
        var seekWindowSize: Int
        /// Finite layout-settling correction budget after the first scroll-to-target.
        var maxCorrectionSteps: Int

        static let `default` = Config(
            seekWindowSize: TranscriptRenderWindow.maxPages * TranscriptRenderWindow.pageSize,
            maxCorrectionSteps: 3
        )

        init(
            seekWindowSize: Int = Config.default.seekWindowSize,
            maxCorrectionSteps: Int = Config.default.maxCorrectionSteps
        ) {
            self.seekWindowSize = max(1, seekWindowSize)
            self.maxCorrectionSteps = max(0, maxCorrectionSteps)
        }
    }

    /// High-level mounted-window mode.
    enum Mode: Equatable, Sendable {
        /// Default live window ending at the newest item (pin / auto-stick eligible).
        case liveLatest
        /// Unidirectional older-page expansion from the live end.
        case history(oldestLoadedPage: Int)
        /// Directed bounded window around `targetIndex` (`range` always contains it).
        case seek(targetIndex: Int, range: Range<Int>)
    }

    /// Who may write scroll position. Seek grants this only to the jump
    /// coordinator until the user takes over or the jump is cancelled.
    enum ScrollOwner: Equatable, Sendable {
        case live
        case historyPager
        case jumpCoordinator
        case user
    }

    /// Host-facing snapshot. Cheap to store in `@State` beside existing window fields.
    struct State: Equatable, Sendable {
        var sessionKey: String
        var itemCount: Int
        var mode: Mode
        /// Monotonic per-host request generation; async work must carry and match it.
        var generation: UInt64
        var scrollOwner: ScrollOwner
        /// Live auto-stick / pin. Forced off on seek; restored on return-to-latest.
        var pinToBottom: Bool
        /// Remaining finite correction steps for the active coordinator-owned jump.
        var correctionsRemaining: Int

        static let empty = State(
            sessionKey: "",
            itemCount: 0,
            mode: .liveLatest,
            generation: 0,
            scrollOwner: .live,
            pinToBottom: true,
            correctionsRemaining: 0
        )

        init(
            sessionKey: String = "",
            itemCount: Int = 0,
            mode: Mode = .liveLatest,
            generation: UInt64 = 0,
            scrollOwner: ScrollOwner = .live,
            pinToBottom: Bool = true,
            correctionsRemaining: Int = 0
        ) {
            self.sessionKey = sessionKey
            self.itemCount = max(0, itemCount)
            self.mode = mode
            self.generation = generation
            self.scrollOwner = scrollOwner
            self.pinToBottom = pinToBottom
            self.correctionsRemaining = max(0, correctionsRemaining)
        }

        var isSeeking: Bool {
            if case .seek = mode { return true }
            return false
        }

        var isHistory: Bool {
            if case .history = mode { return true }
            return false
        }

        var seekTargetIndex: Int? {
            if case .seek(let target, _) = mode { return target }
            return nil
        }

        /// True while the coordinator still owns an in-flight jump (scroll + corrections).
        var isJumpCoordinatorActive: Bool {
            scrollOwner == .jumpCoordinator
        }

        /// History pager may expand / write scroll only outside seek.
        var historyPagerMayWriteScroll: Bool {
            !isSeeking
        }

        /// Live streaming may drive stick-to-bottom only in live pin mode.
        var streamingMayWriteScroll: Bool {
            if case .liveLatest = mode { return pinToBottom && scrollOwner == .live }
            return false
        }

        /// Jump coordinator is the sole scroll writer during an active seek jump.
        var jumpCoordinatorMayWriteScroll: Bool {
            scrollOwner == .jumpCoordinator
        }

        /// Rows the host should mount for the current mode.
        func mountedRange(config: Config = .default) -> Range<Int> {
            switch mode {
            case .liveLatest:
                return TranscriptRenderWindow.resolve(
                    itemCount: itemCount,
                    oldestLoadedPage: nil
                ).range
            case .history(let oldestLoadedPage):
                return TranscriptRenderWindow.resolve(
                    itemCount: itemCount,
                    oldestLoadedPage: oldestLoadedPage
                ).range
            case .seek(_, let range):
                return range
            }
        }
    }

    /// Inputs the host reduces into state. Keep this list small for ChatDetailView wiring.
    enum Action: Equatable, Sendable {
        /// Bind or switch session identity; always cancels in-flight jump work.
        case reset(sessionKey: String, itemCount: Int)
        /// Navigate to a transcript index (user-prompt nav click).
        case navigate(targetIndex: Int)
        /// Tear down seek/history and restore live pin semantics.
        case returnToLatest
        /// User-driven scroll; cancels pending jump corrections and takes ownership.
        case userScrolled
        /// A prepared history commit is about to mutate the bounded window while
        /// a real user already owns scroll. Detach synchronously before rows grow.
        case historyCommitBegan
        /// One-page older history admission (ignored while seeking).
        case requestHistoryPage
        /// Authoritative history head after an async page load (ignored while seeking).
        case applyHistoryPage(oldestLoadedPage: Int)
        /// Transcript grew (streaming / append). Does not transfer scroll ownership.
        case streamAppended(itemCount: Int)
        /// First scroll-to-target finished for `generation` → arm finite corrections.
        case jumpScrollApplied(generation: UInt64)
        /// One layout-settling correction tick for `generation`.
        case correctionApplied(generation: UInt64)
    }

    /// Side effects the host runs. Always re-check `isCurrent` before mutating UI.
    enum Effect: Equatable, Sendable {
        case cancelPendingJumpWork
        /// Drop production history-pager in-flight loading (60ms reveal) so a late
        /// complete cannot rewrite window state after seek / return / session switch.
        case invalidateHistoryPager
        /// Prepare seek window is already in state; host must wait for target mount
        /// ack (session+generation) then perform the first animation-free scroll.
        case scrollToIndex(Int, sessionKey: String, generation: UInt64)
        case runCorrection(sessionKey: String, generation: UInt64)
    }

    /// Token carried by async jump work.
    struct RequestToken: Equatable, Sendable {
        var sessionKey: String
        var generation: UInt64
    }

    // MARK: - Range math

    /// Configurable bounded seek window around `targetIndex`.
    ///
    /// Invariants:
    /// - empty transcript → empty range
    /// - non-empty → `targetIndex` clamped into `0..<itemCount` and contained by the result
    /// - `result.count <= windowSize` (and `== itemCount` only when the transcript itself is smaller)
    /// - never expands to a target→latest full span solely to reach the newest end
    static func seekRange(
        targetIndex: Int,
        itemCount: Int,
        windowSize: Int
    ) -> Range<Int> {
        let count = max(0, itemCount)
        guard count > 0 else { return 0..<0 }
        let size = max(1, windowSize)
        let target = min(max(0, targetIndex), count - 1)
        if count <= size {
            return 0..<count
        }
        // Center on target when possible; clamp so the window stays inside the transcript.
        var start = target - (size / 2)
        start = max(0, min(start, count - size))
        let end = start + size
        return start..<end
    }

    // MARK: - Reducer

    /// Pure reduce. Mutates `state` and returns effects for the host to execute in order.
    @discardableResult
    static func reduce(
        _ state: inout State,
        _ action: Action,
        config: Config = .default
    ) -> [Effect] {
        switch action {
        case let .reset(sessionKey, itemCount):
            return reset(&state, sessionKey: sessionKey, itemCount: itemCount)

        case let .navigate(targetIndex):
            return navigate(&state, targetIndex: targetIndex, config: config)

        case .returnToLatest:
            return returnToLatest(&state)

        case .userScrolled:
            return userScrolled(&state)

        case .historyCommitBegan:
            return historyCommitBegan(&state)

        case .requestHistoryPage:
            return requestHistoryPage(&state)

        case let .applyHistoryPage(oldestLoadedPage):
            return applyHistoryPage(&state, oldestLoadedPage: oldestLoadedPage)

        case let .streamAppended(itemCount):
            return streamAppended(&state, itemCount: itemCount, config: config)

        case let .jumpScrollApplied(generation):
            return jumpScrollApplied(&state, generation: generation, config: config)

        case let .correctionApplied(generation):
            return correctionApplied(&state, generation: generation)
        }
    }

    /// Whether an async callback may still apply against `state`.
    static func isCurrent(sessionKey: String, generation: UInt64, state: State) -> Bool {
        state.sessionKey == sessionKey && state.generation == generation
    }

    static func isCurrent(_ token: RequestToken, state: State) -> Bool {
        isCurrent(sessionKey: token.sessionKey, generation: token.generation, state: state)
    }

    static func token(for state: State) -> RequestToken {
        RequestToken(sessionKey: state.sessionKey, generation: state.generation)
    }
}

/// Single source of truth for prepared history pages. The host performs the
/// immutable snapshot/plan calculation between `.preparing` and `.ready`, then
/// commits only this reducer's matching request on a safe (non-live-scroll) turn.
enum TranscriptHistoryPreparation {
    struct Request: Equatable, Sendable {
        var sessionKey: String
        var viewportGeneration: UInt64
        var generation: UInt64
        var targetPage: Int
        var window: TranscriptRenderWindow
    }

    enum Phase: Equatable, Sendable {
        case idle
        case preparing(Request)
        case ready(Request)
        case committing(Request)
        case exhausted
    }

    struct State: Equatable, Sendable {
        var committedPage: Int?
        var nextGeneration: UInt64
        var phase: Phase

        init(committedPage: Int? = nil, nextGeneration: UInt64 = 0, phase: Phase = .idle) {
            self.committedPage = committedPage
            self.nextGeneration = nextGeneration
            self.phase = phase
        }

        var request: Request? {
            switch phase {
            case .preparing(let request), .ready(let request), .committing(let request): return request
            case .idle, .exhausted: return nil
            }
        }

        var isLoading: Bool {
            switch phase { case .preparing, .ready, .committing: return true; case .idle, .exhausted: return false }
        }
    }

    static func request(
        state: inout State,
        sessionKey: String,
        viewportGeneration: UInt64,
        itemCount: Int
    ) -> Request? {
        guard case .idle = state.phase else { return nil }
        let current = state.committedPage ?? TranscriptRenderWindow.latestStartPage(itemCount: itemCount)
        guard let target = TranscriptHistoryExpander.expand(currentStartPage: current) else {
            state.phase = .exhausted
            return nil
        }
        state.nextGeneration &+= 1
        let request = Request(
            sessionKey: sessionKey,
            viewportGeneration: viewportGeneration,
            generation: state.nextGeneration,
            targetPage: target,
            window: TranscriptRenderWindow.resolve(itemCount: itemCount, oldestLoadedPage: target)
        )
        state.phase = .preparing(request)
        return request
    }

    static func prepared(_ request: Request, state: inout State) -> Bool {
        guard state.phase == .preparing(request) else { return false }
        state.phase = .ready(request)
        return true
    }

    static func beginCommit(_ request: Request, state: inout State) -> Bool {
        guard state.phase == .ready(request) else { return false }
        state.phase = .committing(request)
        return true
    }

    static func finishCommit(_ request: Request, state: inout State) -> Bool {
        guard state.phase == .committing(request) else { return false }
        state.committedPage = request.targetPage
        state.phase = request.targetPage == 0 ? .exhausted : .idle
        return true
    }

    static func invalidate(_ state: inout State, clearCommittedPage: Bool) {
        state.nextGeneration &+= 1
        if clearCommittedPage { state.committedPage = nil }
        state.phase = .idle
    }
}

// MARK: - Host navigation seam

/// High-level, UI-free host for user-prompt seek navigation.
///
/// `ChatDetailViewBody` owns one value and executes returned effects under
/// sessionKey + generation guards. Integration tests exercise this seam
/// directly without mounting SwiftUI.
struct UserPromptNavigationCoordinator: Equatable, Sendable {
    var viewport: TranscriptViewport.State
    var config: TranscriptViewport.Config
    /// Highlighted nav node after a seek scroll has landed.
    var currentUserPromptID: String?
    /// Message id for an in-flight navigate until the first guarded scroll lands.
    var pendingUserPromptID: String?

    init(
        viewport: TranscriptViewport.State = .empty,
        config: TranscriptViewport.Config = .default,
        currentUserPromptID: String? = nil,
        pendingUserPromptID: String? = nil
    ) {
        self.viewport = viewport
        self.config = config
        self.currentUserPromptID = currentUserPromptID
        self.pendingUserPromptID = pendingUserPromptID
    }

    var isSeeking: Bool { viewport.isSeeking }
    var pinToBottom: Bool { viewport.pinToBottom }
    var sessionKey: String { viewport.sessionKey }
    var generation: UInt64 { viewport.generation }
    var historyPagerMayWriteScroll: Bool { viewport.historyPagerMayWriteScroll }
    var streamingMayWriteScroll: Bool { viewport.streamingMayWriteScroll }
    var jumpCoordinatorMayWriteScroll: Bool { viewport.jumpCoordinatorMayWriteScroll }

    /// Seek slice when active; `nil` means the host should keep live/history
    /// `TranscriptRenderWindow` behavior.
    var seekMountedRange: Range<Int>? {
        if case .seek(_, let range) = viewport.mode { return range }
        return nil
    }

    var seekTargetIndex: Int? { viewport.seekTargetIndex }

    func isCurrent(sessionKey: String, generation: UInt64) -> Bool {
        TranscriptViewport.isCurrent(
            sessionKey: sessionKey,
            generation: generation,
            state: viewport
        )
    }

    /// Bind or switch session identity. Cancels in-flight jump work.
    @discardableResult
    mutating func reset(sessionKey: String, itemCount: Int) -> [TranscriptViewport.Effect] {
        pendingUserPromptID = nil
        currentUserPromptID = nil
        return TranscriptViewport.reduce(
            &viewport,
            .reset(sessionKey: sessionKey, itemCount: itemCount),
            config: config
        )
    }

    /// Fixed host order: resolve id → cancel/pin/seek via reducer → scroll effects.
    /// Caller must already have resolved `transcriptIndex` from `UserPromptIndex`
    /// (or pass `nil` to no-op).
    @discardableResult
    mutating func navigateToUserPrompt(
        messageID: String,
        transcriptIndex: Int?,
        itemCount: Int,
        sessionKey: String
    ) -> [TranscriptViewport.Effect] {
        if viewport.sessionKey != sessionKey {
            _ = reset(sessionKey: sessionKey, itemCount: itemCount)
        } else if viewport.itemCount != itemCount {
            _ = TranscriptViewport.reduce(
                &viewport,
                .streamAppended(itemCount: itemCount),
                config: config
            )
        }
        guard let transcriptIndex else { return [] }
        pendingUserPromptID = messageID
        return TranscriptViewport.reduce(
            &viewport,
            .navigate(targetIndex: transcriptIndex),
            config: config
        )
    }

    @discardableResult
    mutating func returnToLatest() -> [TranscriptViewport.Effect] {
        pendingUserPromptID = nil
        currentUserPromptID = nil
        return TranscriptViewport.reduce(&viewport, .returnToLatest, config: config)
    }

    @discardableResult
    mutating func userScrolled() -> [TranscriptViewport.Effect] {
        TranscriptViewport.reduce(&viewport, .userScrolled, config: config)
    }

    /// Prepared history is a structural append, not a live-scroll writer. When
    /// it was admitted by a real user gesture, make the deferred detach durable
    /// before the host commits its new mounted range.
    @discardableResult
    mutating func historyCommitBegan() -> [TranscriptViewport.Effect] {
        TranscriptViewport.reduce(&viewport, .historyCommitBegan, config: config)
    }

    @discardableResult
    mutating func streamAppended(itemCount: Int) -> [TranscriptViewport.Effect] {
        TranscriptViewport.reduce(
            &viewport,
            .streamAppended(itemCount: itemCount),
            config: config
        )
    }

    /// First animation-free scroll-to-target finished for `generation`.
    @discardableResult
    mutating func jumpScrollApplied(generation: UInt64) -> [TranscriptViewport.Effect] {
        let effects = TranscriptViewport.reduce(
            &viewport,
            .jumpScrollApplied(generation: generation),
            config: config
        )
        if isCurrent(sessionKey: viewport.sessionKey, generation: generation),
           let pending = pendingUserPromptID {
            currentUserPromptID = pending
            pendingUserPromptID = nil
        }
        return effects
    }

    @discardableResult
    mutating func correctionApplied(generation: UInt64) -> [TranscriptViewport.Effect] {
        TranscriptViewport.reduce(
            &viewport,
            .correctionApplied(generation: generation),
            config: config
        )
    }

    /// Whether mounted-visibility association may rewrite `currentUserPromptID`.
    ///
    /// Programmatic jump (coordinator-owned / in-flight pending) keeps the target.
    /// Only after the user takes over scroll do we follow the reading baseline
    /// inside the already-mounted window — never expand the window or scan full history.
    var mayUpdateCurrentFromVisibleAnchors: Bool {
        pendingUserPromptID == nil
            && viewport.scrollOwner == .user
            && !viewport.jumpCoordinatorMayWriteScroll
    }

    /// Compatibility path for callers that already have *visual viewport-space*
    /// midpoints. Production uses the layout-viewport overload below so scrolling
    /// never depends on SwiftUI re-emitting a preference.
    @discardableResult
    mutating func applyVisibleUserPromptAnchors(
        _ anchors: [UserPromptCurrentAssociation.Anchor],
        viewportHeight: CGFloat,
        baselineFraction: CGFloat = UserPromptCurrentAssociation.defaultBaselineFraction
    ) -> Bool {
        guard mayUpdateCurrentFromVisibleAnchors else { return false }
        guard viewportHeight.isFinite, viewportHeight > 1 else { return false }
        let next = UserPromptCurrentAssociation.nearestMessageID(
            anchors: anchors,
            baselineY: UserPromptCurrentAssociation.baselineY(
                viewportHeight: viewportHeight,
                fraction: baselineFraction
            )
        )
        guard let next, next != currentUserPromptID else { return false }
        currentUserPromptID = next
        return true
    }

    /// Production path: anchors are cached in pre-flip document layout space and
    /// AppKit supplies the current document clip for each attributed user scroll.
    /// This keeps a seek target selected during programmatic movement, then follows
    /// the reading line immediately once a real user gesture takes ownership.
    @discardableResult
    mutating func applyVisibleUserPromptAnchors(
        _ anchors: [UserPromptCurrentAssociation.Anchor],
        viewport: UserPromptCurrentAssociation.Viewport,
        baselineFraction: CGFloat = UserPromptCurrentAssociation.defaultBaselineFraction
    ) -> Bool {
        guard mayUpdateCurrentFromVisibleAnchors else { return false }
        let next = UserPromptCurrentAssociation.nearestVisibleMessageID(
            anchors: anchors,
            viewport: viewport,
            baselineFraction: baselineFraction
        )
        guard let next, next != currentUserPromptID else { return false }
        currentUserPromptID = next
        return true
    }
}

// MARK: - Current node association (mounted window only)

/// Pure strategy for the flipped transcript. Geometry is stored in **layout**
/// (document) coordinates before `.transcriptFlip()`; layout Y grows from the
/// newest/layout-start edge toward older rows. The outer flip makes visual top
/// correspond to `layoutVisibleRect.maxY`, so the visual reading line at one
/// third down maps back into layout space before association.
enum UserPromptCurrentAssociation {
    /// Fraction of viewport height from the visual top used as the reading line.
    static let defaultBaselineFraction: CGFloat = 0.33

    /// Current clip in pre-flip document layout coordinates.
    struct Viewport: Equatable, Sendable {
        var layoutVisibleRect: CGRect

        init(layoutVisibleRect: CGRect) {
            self.layoutVisibleRect = layoutVisibleRect.standardized
        }

        var height: CGFloat { layoutVisibleRect.height }

        var isUsable: Bool {
            layoutVisibleRect.minY.isFinite
                && layoutVisibleRect.maxY.isFinite
                && layoutVisibleRect.height.isFinite
                && layoutVisibleRect.height > 1
        }
    }

    /// One mounted user-authored prompt's rect in pre-flip document layout space.
    struct Anchor: Equatable, Sendable {
        var messageID: String
        var layoutFrame: CGRect

        init(messageID: String, layoutFrame: CGRect) {
            self.messageID = messageID
            self.layoutFrame = layoutFrame.standardized
        }

        /// Compatibility initializer for viewport-space midpoint tests/callers.
        init(messageID: String, midY: CGFloat) {
            self.init(
                messageID: messageID,
                layoutFrame: CGRect(x: 0, y: midY - 0.5, width: 1, height: 1)
            )
        }

        var midY: CGFloat {
            get { layoutFrame.midY }
            set { layoutFrame.origin.y = newValue - layoutFrame.height / 2 }
        }

        var isUsable: Bool {
            layoutFrame.minY.isFinite
                && layoutFrame.maxY.isFinite
                && layoutFrame.height.isFinite
                && layoutFrame.height > 0
        }
    }

    /// Convert an AppKit document clip into the SwiftUI pre-flip layout axis.
    /// `NSHostingView` is normally flipped; the non-flipped branch keeps this
    /// contract explicit rather than silently assuming a document orientation.
    static func layoutVisibleRect(
        documentVisibleRect: CGRect,
        documentBounds: CGRect,
        documentIsFlipped: Bool
    ) -> CGRect {
        guard !documentIsFlipped else { return documentVisibleRect.standardized }
        return CGRect(
            x: documentVisibleRect.minX,
            y: documentBounds.maxY - documentVisibleRect.maxY,
            width: documentVisibleRect.width,
            height: documentVisibleRect.height
        ).standardized
    }

    /// Visual Y (origin at visual top) for a pre-flip layout Y in `viewport`.
    static func visualY(forLayoutY layoutY: CGFloat, viewport: Viewport) -> CGFloat {
        viewport.layoutVisibleRect.maxY - layoutY
    }

    /// Pre-flip layout Y for a visual Y whose origin is the visual top.
    static func layoutY(forVisualY visualY: CGFloat, viewport: Viewport) -> CGFloat {
        viewport.layoutVisibleRect.maxY - visualY
    }

    /// Convert a pre-flip layout rect into a rect relative to the visual viewport.
    static func visualFrame(for layoutFrame: CGRect, viewport: Viewport) -> CGRect {
        let frame = layoutFrame.standardized
        return CGRect(
            x: frame.minX,
            y: visualY(forLayoutY: frame.maxY, viewport: viewport),
            width: frame.width,
            height: frame.height
        )
    }

    /// Legacy visual-space baseline helper kept for callers that supply visual midpoints.
    static func baselineY(viewportHeight: CGFloat, fraction: CGFloat = defaultBaselineFraction) -> CGFloat {
        let h = max(0, viewportHeight)
        let f = min(max(fraction, 0), 1)
        return h * f
    }

    /// The visual reading line mapped into pre-flip document layout coordinates.
    static func layoutBaselineY(
        viewport: Viewport,
        fraction: CGFloat = defaultBaselineFraction
    ) -> CGFloat {
        layoutY(
            forVisualY: baselineY(viewportHeight: viewport.height, fraction: fraction),
            viewport: viewport
        )
    }

    /// Nearest mounted anchor to `baselineY`. Empty input → nil. Tie → smaller |Δ|,
    /// then stable by first occurrence in `anchors` order.
    static func nearestMessageID(
        anchors: [Anchor],
        baselineY: CGFloat
    ) -> String? {
        guard !anchors.isEmpty else { return nil }
        var bestID: String?
        var bestDistance = CGFloat.infinity
        for anchor in anchors where anchor.isUsable {
            let distance = abs(anchor.midY - baselineY)
            if distance < bestDistance {
                bestDistance = distance
                bestID = anchor.messageID
            }
        }
        return bestID
    }

    /// Only mounted user rows that actually intersect the current clip may compete.
    /// Rows just outside the viewport are deliberately excluded even if their centers
    /// are numerically nearer to the reading baseline than a visible row.
    static func visibleAnchors(
        _ anchors: [Anchor],
        in viewport: Viewport
    ) -> [Anchor] {
        guard viewport.isUsable else { return [] }
        let visible = viewport.layoutVisibleRect
        return anchors.filter { anchor in
            guard anchor.isUsable else { return false }
            let frame = anchor.layoutFrame
            return frame.maxY > visible.minY && frame.minY < visible.maxY
        }
    }

    /// Nearest visible mounted row to the visual-top reading baseline after the
    /// `.transcriptFlip()` visual↔layout conversion.
    static func nearestVisibleMessageID(
        anchors: [Anchor],
        viewport: Viewport,
        baselineFraction: CGFloat = defaultBaselineFraction
    ) -> String? {
        guard viewport.isUsable else { return nil }
        return nearestMessageID(
            anchors: visibleAnchors(anchors, in: viewport),
            baselineY: layoutBaselineY(viewport: viewport, fraction: baselineFraction)
        )
    }

    /// Filter anchors whose message IDs are in the allowed mounted set (optional).
    /// When `allowedMessageIDs` is nil, all anchors are considered.
    static func anchorsInMountedSet(
        _ anchors: [Anchor],
        allowedMessageIDs: Set<String>?
    ) -> [Anchor] {
        guard let allowedMessageIDs else { return anchors }
        return anchors.filter { allowedMessageIDs.contains($0.messageID) }
    }
}

/// Production bridge between SwiftUI's mounted-row preferences and AppKit's
/// attributed scroll notifications. It caches document-space row geometry even
/// while live/jump code owns scrolling; a real user event then uses the latest
/// cache plus the current clip without waiting for another Preference emission.
///
/// Every cache entry is scoped to its bounded mounted raw-item range. A history
/// page/window can therefore replace rows without an old preference ever winning
/// against the new clip; selection stays unchanged until geometry for the current
/// range is available rather than falling back to the transcript's latest prompt.
struct MountedUserPromptCurrentTracker: Equatable, Sendable {
    private static let unscopedMountedRange = 0..<0

    /// Most recently received anchors (diagnostic/test seam). Association uses
    /// the active range cache below, never this unscoped convenience snapshot.
    private(set) var mountedAnchors: [UserPromptCurrentAssociation.Anchor] = []
    private(set) var latestViewport: UserPromptCurrentAssociation.Viewport?
    private(set) var activeMountedRange: Range<Int>?
    private var mostRecentMountedRange: Range<Int>?
    private var anchorsByMountedRange: [Range<Int>: [UserPromptCurrentAssociation.Anchor]] = [:]

    mutating func replaceMountedAnchors(
        _ anchors: [UserPromptCurrentAssociation.Anchor],
        mountedRange: Range<Int> = unscopedMountedRange
    ) {
        var seenIDs: Set<String> = []
        let sanitized = anchors.filter { anchor in
            anchor.isUsable && seenIDs.insert(anchor.messageID).inserted
        }
        mountedAnchors = sanitized
        mostRecentMountedRange = mountedRange
        anchorsByMountedRange[mountedRange] = sanitized
    }

    /// Notice a bounded mounted-window replacement. Keep both the new range and
    /// a currently active old range during the SwiftUI transition; an incoming
    /// stale preference cannot become current because `refreshCurrent` always
    /// looks up the AppKit event's active range exactly.
    mutating func mountedWindowDidChange(_ range: Range<Int>) {
        pruneRanges(keeping: [range, activeMountedRange].compactMap { $0 })
        if mostRecentMountedRange != range,
           activeMountedRange != mostRecentMountedRange {
            mountedAnchors = []
            mostRecentMountedRange = nil
        }
    }

    /// Hard teardown / test reset.
    mutating func invalidateMountedAnchors() {
        mountedAnchors = []
        mostRecentMountedRange = nil
        activeMountedRange = nil
        anchorsByMountedRange = [:]
    }

    mutating func reset() {
        invalidateMountedAnchors()
        latestViewport = nil
    }

    mutating func recordViewport(_ viewport: UserPromptCurrentAssociation.Viewport) {
        latestViewport = viewport
    }

    /// Re-associate only when navigation has already been handed to a real user.
    @discardableResult
    func refreshCurrent(
        navigation: inout UserPromptNavigationCoordinator
    ) -> Bool {
        guard let latestViewport,
              let activeMountedRange,
              let anchors = anchorsByMountedRange[activeMountedRange]
        else { return false }
        return navigation.applyVisibleUserPromptAnchors(
            anchors,
            viewport: latestViewport
        )
    }

    /// AppKit calls this only for wheel/trackpad/knob scrolls it can attribute to
    /// the user. Programmatic `scrollTo` never takes this path.
    @discardableResult
    mutating func userScrolled(
        navigation: inout UserPromptNavigationCoordinator,
        viewport: UserPromptCurrentAssociation.Viewport,
        mountedRange: Range<Int> = unscopedMountedRange
    ) -> [TranscriptViewport.Effect] {
        activeMountedRange = mountedRange
        pruneRanges(keeping: [mountedRange])
        recordViewport(viewport)
        let effects = navigation.userScrolled()
        _ = refreshCurrent(navigation: &navigation)
        return effects
    }

    private mutating func pruneRanges(keeping ranges: [Range<Int>]) {
        anchorsByMountedRange = anchorsByMountedRange.filter { key, _ in
            ranges.contains(key)
        }
    }
}

/// Reference holder for the production SwiftUI host. It is deliberately not
/// observable: AppKit may deliver dozens of clip updates per gesture, while the
/// view only needs invalidation when `UserPromptNavigationCoordinator` changes a
/// discrete current id. Pure tests use `MountedUserPromptCurrentTracker` directly.
@MainActor
final class MountedUserPromptCurrentTrackerStore {
    var tracker = MountedUserPromptCurrentTracker()
}

// MARK: - Private transitions

private extension TranscriptViewport {
    static func bumpGeneration(_ state: inout State) {
        state.generation &+= 1
        state.correctionsRemaining = 0
    }

    static func reset(
        _ state: inout State,
        sessionKey: String,
        itemCount: Int
    ) -> [Effect] {
        // Always bump generation so prior-session (or same-key reuse) late work is stale.
        state = State(
            sessionKey: sessionKey,
            itemCount: max(0, itemCount),
            mode: .liveLatest,
            generation: state.generation &+ 1,
            scrollOwner: .live,
            pinToBottom: true,
            correctionsRemaining: 0
        )
        return [.cancelPendingJumpWork, .invalidateHistoryPager]
    }

    static func navigate(
        _ state: inout State,
        targetIndex: Int,
        config: Config
    ) -> [Effect] {
        let count = state.itemCount
        guard count > 0 else { return [] }
        let target = min(max(0, targetIndex), count - 1)
        let range = seekRange(
            targetIndex: target,
            itemCount: count,
            windowSize: config.seekWindowSize
        )
        bumpGeneration(&state)
        state.mode = .seek(targetIndex: target, range: range)
        state.pinToBottom = false
        state.scrollOwner = .jumpCoordinator
        state.correctionsRemaining = 0
        let token = token(for: state)
        return [
            .cancelPendingJumpWork,
            .invalidateHistoryPager,
            .scrollToIndex(target, sessionKey: token.sessionKey, generation: token.generation),
        ]
    }

    static func returnToLatest(_ state: inout State) -> [Effect] {
        // Repeated near-bottom / explicit-latest callbacks are common while the
        // clip settles. Once live ownership is already restored they must not
        // keep invalidating generations or re-running host cancellation effects.
        guard state.mode != .liveLatest
                || !state.pinToBottom
                || state.scrollOwner != .live
                || state.correctionsRemaining != 0
        else { return [] }
        bumpGeneration(&state)
        state.mode = .liveLatest
        state.pinToBottom = true
        state.scrollOwner = .live
        state.correctionsRemaining = 0
        return [.cancelPendingJumpWork, .invalidateHistoryPager]
    }

    static func userScrolled(_ state: inout State) -> [Effect] {
        // Live pin/unpin stays with StickToBottomLogic. This action only hands
        // navigation current-association ownership to the user, and cancels
        // in-flight seek jump write rights / finite corrections when active.
        guard state.isSeeking || state.isJumpCoordinatorActive || state.correctionsRemaining > 0 else {
            // live/history (and any non-seek owner): real user scroll → .user.
            // Do not force pin off or expand windows.
            if state.scrollOwner != .user {
                state.scrollOwner = .user
            }
            return []
        }
        // Already user-owned with no residual corrections: ignore high-frequency
        // knob/bounds repeats so generation stays stable while browsing seek.
        if state.scrollOwner == .user && state.correctionsRemaining == 0 {
            return []
        }
        bumpGeneration(&state)
        state.scrollOwner = .user
        state.correctionsRemaining = 0
        // Stay in seek (or history); only coordinator write rights are revoked.
        // Also drop any in-flight history pager work that was admitted pre-seek.
        return [.cancelPendingJumpWork, .invalidateHistoryPager]
    }

    static func historyCommitBegan(_ state: inout State) -> [Effect] {
        // Only a real user-owned viewport needs this pre-threshold detach. Keep
        // safety backfill on the normal pinned/live path, and never interfere
        // with directed seek ownership. Repeated geometry callbacks after the
        // detach are reducer no-ops.
        guard !state.isSeeking,
              state.scrollOwner == .user,
              state.pinToBottom
        else { return [] }
        state.pinToBottom = false
        return []
    }

    static func requestHistoryPage(_ state: inout State) -> [Effect] {
        // Seek: history pager must not obtain scroll ownership or grow via unidirectional pager.
        guard state.historyPagerMayWriteScroll else { return [] }

        let currentPage: Int
        switch state.mode {
        case .liveLatest:
            currentPage = TranscriptRenderWindow.latestStartPage(itemCount: state.itemCount)
        case .history(let page):
            currentPage = page
        case .seek:
            return []
        }

        guard let older = TranscriptHistoryExpander.expand(currentStartPage: currentPage) else {
            return []
        }
        state.mode = .history(oldestLoadedPage: older)
        state.pinToBottom = false
        if state.scrollOwner == .live {
            state.scrollOwner = .historyPager
        }
        return []
    }

    static func applyHistoryPage(
        _ state: inout State,
        oldestLoadedPage: Int
    ) -> [Effect] {
        guard state.historyPagerMayWriteScroll else { return [] }
        let lastPage = TranscriptRenderWindow.latestPage(itemCount: state.itemCount)
        let page = min(max(0, oldestLoadedPage), lastPage)
        state.mode = .history(oldestLoadedPage: page)
        state.pinToBottom = false
        if state.scrollOwner == .live {
            state.scrollOwner = .historyPager
        }
        return []
    }

    static func streamAppended(
        _ state: inout State,
        itemCount: Int,
        config: Config
    ) -> [Effect] {
        let count = max(0, itemCount)
        guard state.itemCount != count else { return [] }
        state.itemCount = count
        switch state.mode {
        case .liveLatest, .history:
            // Live/history windows are derived from itemCount + head; no ownership change.
            return []
        case .seek(let target, let range):
            // Streaming may append into the session but must not stick-to-bottom or
            // seize scroll ownership. Keep the mounted slice stable when still valid.
            let next = stabilizeSeek(
                targetIndex: target,
                range: range,
                itemCount: count,
                windowSize: config.seekWindowSize
            )
            state.mode = .seek(targetIndex: next.target, range: next.range)
            return []
        }
    }

    static func jumpScrollApplied(
        _ state: inout State,
        generation: UInt64,
        config: Config
    ) -> [Effect] {
        guard isCurrent(sessionKey: state.sessionKey, generation: generation, state: state),
              state.scrollOwner == .jumpCoordinator,
              state.isSeeking
        else { return [] }

        let steps = config.maxCorrectionSteps
        state.correctionsRemaining = steps
        guard steps > 0 else { return [] }
        return [.runCorrection(sessionKey: state.sessionKey, generation: state.generation)]
    }

    static func correctionApplied(
        _ state: inout State,
        generation: UInt64
    ) -> [Effect] {
        guard isCurrent(sessionKey: state.sessionKey, generation: generation, state: state),
              state.scrollOwner == .jumpCoordinator,
              state.correctionsRemaining > 0
        else { return [] }

        state.correctionsRemaining -= 1
        guard state.correctionsRemaining > 0 else { return [] }
        return [.runCorrection(sessionKey: state.sessionKey, generation: state.generation)]
    }

    /// Keep a seek slice stable across appends; re-center only when invariants break.
    static func stabilizeSeek(
        targetIndex: Int,
        range: Range<Int>,
        itemCount: Int,
        windowSize: Int
    ) -> (target: Int, range: Range<Int>) {
        let count = max(0, itemCount)
        guard count > 0 else { return (0, 0..<0) }
        let target = min(max(0, targetIndex), count - 1)
        let size = max(1, windowSize)
        if range.lowerBound >= 0,
           range.upperBound <= count,
           range.contains(target),
           range.count <= size {
            return (target, range)
        }
        return (target, seekRange(targetIndex: target, itemCount: count, windowSize: size))
    }
}

// MARK: - First-scroll pipeline (prepare → mounted → scroll)

/// Finite, cancelable first seek scroll after the host has prepared the seek window.
///
/// Production and tests inject mount-wait + scroll behavior. Order is always:
/// `prepare` → (`mounted` | skip) → `scroll` (scroll only after a successful mount
/// ack for the current session+generation; timeout/cancel/stale never scroll).
@MainActor
enum SeekFirstScrollPipeline {
    struct Request: Equatable, Sendable {
        var targetIndex: Int
        var targetRowID: String
        var sessionKey: String
        var generation: UInt64
    }

    enum MountResult: Equatable, Sendable {
        /// Target row reported mounted for this request.
        case mounted
        /// Wait ended without mount (host timeout). No scroll.
        case timedOut
        /// Caller cancelled the wait (new navigate / return / session switch).
        case cancelled
    }

    enum SkipReason: Equatable, Sendable {
        case cancelled
        case stale
        case timedOut
        case notMounted
    }

    enum Event: Equatable, Sendable {
        case prepare(sessionKey: String, generation: UInt64, targetIndex: Int)
        case mounted(sessionKey: String, generation: UInt64, targetIndex: Int)
        case scroll(sessionKey: String, generation: UInt64, targetIndex: Int)
        case skipped(SkipReason)
    }

    /// Injectable host seams — unit tests supply immediate/async fakes; UI supplies
    /// row onAppear / preference ack + ScrollViewProxy.
    struct Host {
        var waitForMount: (Request) async -> MountResult
        var performScroll: (Request) -> Void

        init(
            waitForMount: @escaping (Request) async -> MountResult,
            performScroll: @escaping (Request) -> Void
        ) {
            self.waitForMount = waitForMount
            self.performScroll = performScroll
        }
    }

    /// Run one first-scroll attempt. Returns `true` only when a scroll was performed.
    @discardableResult
    static func run(
        request: Request,
        isCurrent: () -> Bool,
        host: Host,
        onEvent: ((Event) -> Void)? = nil
    ) async -> Bool {
        onEvent?(.prepare(
            sessionKey: request.sessionKey,
            generation: request.generation,
            targetIndex: request.targetIndex
        ))

        guard isCurrent() else {
            onEvent?(.skipped(.stale))
            return false
        }

        let mount = await host.waitForMount(request)

        // Re-check after the await — cancel / session switch / newer navigate.
        guard isCurrent() else {
            onEvent?(.skipped(.stale))
            return false
        }

        switch mount {
        case .cancelled:
            onEvent?(.skipped(.cancelled))
            return false
        case .timedOut:
            onEvent?(.skipped(.timedOut))
            return false
        case .mounted:
            onEvent?(.mounted(
                sessionKey: request.sessionKey,
                generation: request.generation,
                targetIndex: request.targetIndex
            ))
            guard isCurrent() else {
                onEvent?(.skipped(.stale))
                return false
            }
            host.performScroll(request)
            onEvent?(.scroll(
                sessionKey: request.sessionKey,
                generation: request.generation,
                targetIndex: request.targetIndex
            ))
            return true
        }
    }
}

/// MainActor box holding a single cancelable mount continuation for production UI.
///
/// ChatDetailView keeps at most one box; row onAppear / preference calls
/// `acknowledge(rowID:)` when the target identity is in the tree. `cancel()` and
/// timeout both finish the wait without scrolling.
@MainActor
final class SeekMountAcknowledgementBox {
    let request: SeekFirstScrollPipeline.Request
    private var continuation: CheckedContinuation<SeekFirstScrollPipeline.MountResult, Never>?
    private var finished: SeekFirstScrollPipeline.MountResult?
    private var timeoutTask: Task<Void, Never>?

    init(request: SeekFirstScrollPipeline.Request) {
        self.request = request
    }

    /// Wait until mount ack, cancel, or `timeoutNanoseconds`.
    func wait(timeoutNanoseconds: UInt64) async -> SeekFirstScrollPipeline.MountResult {
        if let finished { return finished }
        return await withCheckedContinuation { cont in
            self.continuation = cont
            self.timeoutTask = Task { @MainActor in
                try? await Task.sleep(nanoseconds: timeoutNanoseconds)
                self.finish(.timedOut)
            }
        }
    }

    /// Row mount signal (onAppear / preference). Only the matching row id completes.
    func acknowledge(rowID: String) {
        guard rowID == request.targetRowID else { return }
        finish(.mounted)
    }

    func cancel() {
        finish(.cancelled)
    }

    private func finish(_ result: SeekFirstScrollPipeline.MountResult) {
        guard finished == nil else { return }
        finished = result
        timeoutTask?.cancel()
        timeoutTask = nil
        continuation?.resume(returning: result)
        continuation = nil
    }
}
