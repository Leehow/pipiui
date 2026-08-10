import XCTest
@testable import PipiUI

/// Rail UI slice: node projection, current-style semantics, click callback,
/// and independence from the mounted transcript window.
final class UserPromptNavigationRailTests: XCTestCase {

    private func entry(_ id: String, _ summary: String) -> UserPromptIndex.Entry {
        UserPromptIndex.Entry(messageID: id, summary: summary)
    }

    // MARK: - Node projection

    func testNodesProjectFromIndexEntriesOldestToNewest() {
        let entries = [
            entry("u1", "第一问"),
            entry("u2", "第二问 with more text"),
            entry("u3", ""),
        ]
        let nodes = UserPromptNavigationRailModel.nodes(from: entries)
        XCTAssertEqual(nodes.map(\.id), ["u1", "u2", "u3"])
        XCTAssertEqual(nodes.map(\.summary), ["第一问", "第二问 with more text", ""])
    }

    func testEmptyEntriesProjectToEmptyNodes() {
        XCTAssertTrue(UserPromptNavigationRailModel.nodes(from: []).isEmpty)
    }

    func testProjectionDoesNotRequireMountedRangeOrTranscript() {
        // Nodes are a pure map of index entries — no viewport / seek range input.
        let entries = (0..<500).map { entry("u\($0)", "prompt \($0)") }
        let nodes = UserPromptNavigationRailModel.nodes(from: entries)
        XCTAssertEqual(nodes.count, 500)
        XCTAssertEqual(nodes.first?.id, "u0")
        XCTAssertEqual(nodes.last?.id, "u499")
        XCTAssertEqual(nodes[42].summary, "prompt 42")
    }

    // MARK: - Current node resolution

    func testResolvedCurrentPrefersLandedCurrentID() {
        let id = UserPromptNavigationRailModel.resolvedCurrentMessageID(
            currentUserPromptID: "u-landed",
            pendingUserPromptID: "u-pending",
            isSeeking: true,
            entryMessageIDs: ["u0", "u-landed", "u-pending", "u-last"]
        )
        XCTAssertEqual(id, "u-landed")
    }

    func testResolvedCurrentFallsBackToPendingWhileSeeking() {
        let id = UserPromptNavigationRailModel.resolvedCurrentMessageID(
            currentUserPromptID: nil,
            pendingUserPromptID: "u-pending",
            isSeeking: true,
            entryMessageIDs: ["u0", "u-pending", "u-last"]
        )
        XCTAssertEqual(id, "u-pending")
    }

    func testResolvedCurrentLiveLatestUsesLastUserNode() {
        let id = UserPromptNavigationRailModel.resolvedCurrentMessageID(
            currentUserPromptID: nil,
            pendingUserPromptID: nil,
            isSeeking: false,
            entryMessageIDs: ["u0", "u1", "u-last"]
        )
        XCTAssertEqual(id, "u-last")
    }

    func testResolvedCurrentSeekWithoutIDsHasNoHighlight() {
        let id = UserPromptNavigationRailModel.resolvedCurrentMessageID(
            currentUserPromptID: nil,
            pendingUserPromptID: nil,
            isSeeking: true,
            entryMessageIDs: ["u0", "u1", "u-last"]
        )
        XCTAssertNil(id)
    }

    func testResolvedCurrentEmptyEntriesIsNilEvenWhenLive() {
        let id = UserPromptNavigationRailModel.resolvedCurrentMessageID(
            currentUserPromptID: nil,
            pendingUserPromptID: nil,
            isSeeking: false,
            entryMessageIDs: []
        )
        XCTAssertNil(id)
    }

    // MARK: - Style semantics

    func testStyleRoleCurrentVsNormal() {
        XCTAssertEqual(
            UserPromptNavigationRailModel.styleRole(nodeID: "u1", currentMessageID: "u1"),
            .current
        )
        XCTAssertEqual(
            UserPromptNavigationRailModel.styleRole(nodeID: "u1", currentMessageID: "u2"),
            .normal
        )
        XCTAssertEqual(
            UserPromptNavigationRailModel.styleRole(nodeID: "u1", currentMessageID: nil),
            .normal
        )
    }

    func testTickStyleCurrentIsLongerAndDarkerThanNormal() {
        let normal = UserPromptNavigationRailModel.tickStyle(role: .normal, isHovered: false)
        let current = UserPromptNavigationRailModel.tickStyle(role: .current, isHovered: false)

        XCTAssertGreaterThan(current.width, normal.width)
        XCTAssertGreaterThan(current.opacity, normal.opacity)
        XCTAssertEqual(normal.width, UserPromptNavigationRailModel.normalTickWidth)
        XCTAssertEqual(current.width, UserPromptNavigationRailModel.currentTickWidth)
        XCTAssertFalse(normal.hoverBoost)
        XCTAssertFalse(current.hoverBoost)
    }

    func testTickStyleHoverBoostsNormalAndCurrent() {
        let normalRest = UserPromptNavigationRailModel.tickStyle(role: .normal, isHovered: false)
        let normalHover = UserPromptNavigationRailModel.tickStyle(role: .normal, isHovered: true)
        let currentRest = UserPromptNavigationRailModel.tickStyle(role: .current, isHovered: false)
        let currentHover = UserPromptNavigationRailModel.tickStyle(role: .current, isHovered: true)

        XCTAssertGreaterThan(normalHover.width, normalRest.width)
        XCTAssertGreaterThan(normalHover.opacity, normalRest.opacity)
        XCTAssertTrue(normalHover.hoverBoost)

        XCTAssertGreaterThanOrEqual(currentHover.width, currentRest.width)
        XCTAssertGreaterThanOrEqual(currentHover.opacity, currentRest.opacity)
        XCTAssertTrue(currentHover.hoverBoost)

        // Current remains the primary identity even under hover (still ≥ normal hover).
        XCTAssertGreaterThanOrEqual(currentHover.width, normalHover.width)
        XCTAssertGreaterThan(currentHover.opacity, normalHover.opacity)
    }

    // MARK: - Click callback (pure host seam)

    func testSelectCallbackReceivesMessageID() {
        var selected: [String] = []
        let onSelect: (String) -> Void = { selected.append($0) }

        let nodes = UserPromptNavigationRailModel.nodes(from: [
            entry("a", "alpha"),
            entry("b", "beta"),
        ])
        // Simulate rail tick actions without mounting SwiftUI.
        onSelect(nodes[0].id)
        onSelect(nodes[1].id)

        XCTAssertEqual(selected, ["a", "b"])
    }

    // MARK: - Layout constants / width math

    func testRailWidthFitsMaxTickPlusHorizontalHitSlop() {
        let needed =
            UserPromptNavigationRailModel.maxVisualTickWidth
            + UserPromptNavigationRailModel.hitSlopHorizontal * 2
        XCTAssertEqual(UserPromptNavigationRailModel.railWidth, needed)
        XCTAssertGreaterThanOrEqual(
            UserPromptNavigationRailModel.railWidth,
            UserPromptNavigationRailModel.currentTickWidth
                + UserPromptNavigationRailModel.hitSlopHorizontal * 2
        )
        // Hovered current tick must still fit.
        let hoveredCurrent = UserPromptNavigationRailModel.tickStyle(
            role: .current,
            isHovered: true
        )
        XCTAssertLessThanOrEqual(
            hoveredCurrent.width + UserPromptNavigationRailModel.hitSlopHorizontal * 2,
            UserPromptNavigationRailModel.railWidth
        )
        XCTAssertGreaterThan(
            UserPromptNavigationRailModel.minNodeHitHeight,
            UserPromptNavigationRailModel.tickHeight
        )
    }

    func testTranscriptLeadingGutterReservesIndependentRailHitArea() {
        let gutter = UserPromptNavigationRailModel.transcriptLeadingGutter
        XCTAssertGreaterThan(
            gutter,
            UserPromptNavigationRailModel.railWidth,
            "gutter must include rail column plus edge gap"
        )
        XCTAssertGreaterThanOrEqual(
            gutter,
            UserPromptNavigationRailModel.hostLeadingInset
                + UserPromptNavigationRailModel.railWidth
        )
    }

    // MARK: - Dense track layout (spacing / compression)

    func testTrackLayoutDefaultPitchIsDenseNotSparse() {
        let layout = UserPromptNavigationRailModel.trackLayout(
            nodeCount: 12,
            availableHeight: UserPromptNavigationRailModel.maxRailHeight
        )
        XCTAssertEqual(layout.nodePitch, UserPromptNavigationRailModel.preferredNodePitch)
        XCTAssertLessThanOrEqual(layout.nodePitch, UserPromptNavigationRailModel.maxNodePitch)
        // Must stay a tight Claude-style strip — nowhere near ~38pt row pitch.
        XCTAssertLessThan(layout.nodePitch, 14)
        XCTAssertLessThan(
            layout.contentHeight,
            CGFloat(12) * 20,
            "12 nodes must pack well under a sparse 20pt-class list"
        )
        XCTAssertTrue(layout.fitsWithoutScroll)
        XCTAssertEqual(layout.viewportHeight, layout.contentHeight)
    }

    func testTrackLayoutFewNodesStayCompactShortTrack() {
        let layout = UserPromptNavigationRailModel.trackLayout(
            nodeCount: 3,
            availableHeight: UserPromptNavigationRailModel.maxRailHeight
        )
        XCTAssertLessThanOrEqual(layout.nodePitch, UserPromptNavigationRailModel.maxNodePitch)
        XCTAssertLessThan(
            layout.viewportHeight,
            80,
            "few nodes should form a short track, not fill maxRailHeight"
        )
        XCTAssertTrue(layout.fitsWithoutScroll)
    }

    func testTrackLayoutCompressesPitchToFitAvailableHeight() {
        // 40 nodes × preferred 6 = 240 + pad > 200 → must compress, still no scroll.
        // usable 196 / 40 = 4.9 ≥ minPitch 4, so fit-without-scroll path.
        let available: CGFloat = 200
        let layout = UserPromptNavigationRailModel.trackLayout(
            nodeCount: 40,
            availableHeight: available
        )
        XCTAssertTrue(layout.fitsWithoutScroll)
        XCTAssertLessThan(layout.nodePitch, UserPromptNavigationRailModel.preferredNodePitch)
        XCTAssertGreaterThanOrEqual(layout.nodePitch, UserPromptNavigationRailModel.minNodePitch)
        XCTAssertLessThanOrEqual(layout.contentHeight, available + 0.5)
        XCTAssertLessThanOrEqual(layout.viewportHeight, available + 0.5)
    }

    func testTrackLayoutScrollsOnlyBelowMinPitch() {
        let available: CGFloat = 100
        // Even at min pitch 4, 80 nodes need 320+ content → must scroll.
        let layout = UserPromptNavigationRailModel.trackLayout(
            nodeCount: 80,
            availableHeight: available
        )
        XCTAssertFalse(layout.fitsWithoutScroll)
        XCTAssertEqual(layout.nodePitch, UserPromptNavigationRailModel.minNodePitch)
        XCTAssertGreaterThan(layout.contentHeight, layout.viewportHeight)
        XCTAssertEqual(layout.viewportHeight, available)
    }

    func testTrackLayoutEmptyNodesIsDegenerateShort() {
        let layout = UserPromptNavigationRailModel.trackLayout(nodeCount: 0)
        XCTAssertTrue(layout.fitsWithoutScroll)
        XCTAssertEqual(
            layout.contentHeight,
            UserPromptNavigationRailModel.contentVerticalPadding * 2
        )
    }

    func testScrollIndicatorsConstantIsAlwaysHidden() {
        XCTAssertFalse(UserPromptNavigationRailModel.showsScrollIndicators)
    }

    // MARK: - Hover summary semantics

    func testHoverSummaryUsesPlainTextAndOrdinalFallback() {
        XCTAssertEqual(
            UserPromptNavigationRailModel.hoverSummaryText(
                summary: "  hello rail  ",
                index: 2,
                total: 9
            ),
            "hello rail"
        )
        XCTAssertEqual(
            UserPromptNavigationRailModel.hoverSummaryText(
                summary: "",
                index: 0,
                total: 3
            ),
            "用户输入 1/3"
        )
        XCTAssertEqual(
            UserPromptNavigationRailModel.hoverSummaryText(
                summary: "   \n\t",
                index: 4,
                total: 10
            ),
            "用户输入 5/10"
        )
    }

    func testHoverSummaryTruncatesLongPlainText() {
        let long = String(
            repeating: "x",
            count: UserPromptNavigationRailModel.maxTooltipSummaryLength + 25
        )
        let text = UserPromptNavigationRailModel.hoverSummaryText(
            summary: long,
            index: 0,
            total: 1
        )
        XCTAssertTrue(text.hasSuffix("…"))
        XCTAssertEqual(
            text.count,
            UserPromptNavigationRailModel.maxTooltipSummaryLength + 1
        )
    }

    // MARK: - Current scroll request (rail viewport)

    func testScrollRequestWhenCurrentLeavesVisibleSet() {
        let request = UserPromptNavigationRailModel.scrollRequestIfNeeded(
            currentMessageID: "u-last",
            previousVisibleIDs: ["u0", "u1"],
            generation: 3
        )
        XCTAssertEqual(request?.messageID, "u-last")
        XCTAssertEqual(request?.generation, 3)

        let none = UserPromptNavigationRailModel.scrollRequestIfNeeded(
            currentMessageID: "u1",
            previousVisibleIDs: ["u0", "u1", "u2"],
            generation: 4
        )
        XCTAssertNil(none)
    }

    func testScrollRequestOnUnknownVisibleSetForLiveLatestCurrent() {
        // Initial live long session: visible set unknown → request latest current.
        let request = UserPromptNavigationRailModel.scrollRequestIfNeeded(
            currentMessageID: "u-499",
            previousVisibleIDs: nil,
            generation: 1
        )
        XCTAssertEqual(request?.messageID, "u-499")
        XCTAssertNil(
            UserPromptNavigationRailModel.scrollRequestIfNeeded(
                currentMessageID: nil,
                previousVisibleIDs: nil,
                generation: 1
            )
        )
    }

    func testFitLayoutNeverEmitsRailScrollRequest() {
        let layout = UserPromptNavigationRailModel.trackLayout(nodeCount: 12)
        XCTAssertTrue(layout.fitsWithoutScroll)
        XCTAssertNil(
            UserPromptNavigationRailModel.scrollRequestIfNeeded(
                currentMessageID: "u11",
                previousVisibleIDs: nil,
                allowsScroll: !layout.fitsWithoutScroll,
                generation: 1
            )
        )
    }

    func testContinuousCurrentChangesOnlyRequestWhenLeavingVisibleIDsAndNeverRepeatID() {
        let visible: Set<String> = ["u1", "u2", "u3"]
        XCTAssertNil(
            UserPromptNavigationRailModel.scrollRequestIfNeeded(
                currentMessageID: "u2",
                previousVisibleIDs: visible,
                generation: 1
            )
        )
        let first = UserPromptNavigationRailModel.scrollRequestIfNeeded(
            currentMessageID: "u4",
            previousVisibleIDs: visible,
            generation: 2
        )
        XCTAssertEqual(first?.messageID, "u4")
        XCTAssertNil(
            UserPromptNavigationRailModel.scrollRequestIfNeeded(
                currentMessageID: "u4",
                previousVisibleIDs: visible,
                lastRequestedID: first?.messageID,
                generation: 3
            )
        )
    }

    func testRailSelectHostSurvivesScrollRootDisappearAndRebuild() {
        var host = UserPromptRailSelectHostState()
        XCTAssertFalse(host.isBound)
        host.bind()
        XCTAssertTrue(host.isBound)
        host.scrollRootDidDisappear()
        XCTAssertTrue(host.isBound, "teardown must not permanently disable rail hit testing")
        host.bind()
        XCTAssertTrue(host.isBound, "replacement root restores the proxy binding")
    }

    // MARK: - Production current-to-rail wiring

    /// Behavior-level wiring: mounted geometry arrives while live ownership is
    /// active, AppKit's real-user scroll handoff changes the coordinator, and the
    /// rail model reflects that new current node. No source-text inspection.
    func testRailCurrentReflectsProductionMountedScrollTracking() {
        var nav = UserPromptNavigationCoordinator(
            config: .init(seekWindowSize: 64, maxCorrectionSteps: 0)
        )
        _ = nav.reset(sessionKey: "s1", itemCount: 800)
        nav.currentUserPromptID = "u-last"
        var tracker = MountedUserPromptCurrentTracker()
        let range = 768..<800
        tracker.replaceMountedAnchors([
            .init(messageID: "u-reading", layoutFrame: CGRect(x: 0, y: 250, width: 300, height: 40)),
            .init(messageID: "u-last", layoutFrame: CGRect(x: 0, y: 40, width: 300, height: 40)),
        ], mountedRange: range)

        _ = tracker.userScrolled(
            navigation: &nav,
            viewport: .init(layoutVisibleRect: CGRect(x: 0, y: 0, width: 600, height: 400)),
            mountedRange: range
        )
        let current = UserPromptNavigationRailModel.resolvedCurrentMessageID(
            currentUserPromptID: nav.currentUserPromptID,
            pendingUserPromptID: nav.pendingUserPromptID,
            isSeeking: nav.isSeeking,
            entryMessageIDs: ["u-reading", "u-last"]
        )
        XCTAssertEqual(current, "u-reading")
        XCTAssertEqual(
            UserPromptNavigationRailModel.styleRole(nodeID: "u-reading", currentMessageID: current),
            .current
        )
        XCTAssertEqual(
            UserPromptNavigationRailModel.styleRole(nodeID: "u-last", currentMessageID: current),
            .normal
        )
    }

    func testRailSourceAvoidsMessageRowAndMarkdown() throws {
        let source = try String(
            contentsOf: repositoryRoot
                .appendingPathComponent("Sources/PipiUI/Views/UserPromptNavigationRail.swift"),
            encoding: .utf8
        )
        XCTAssertFalse(source.contains("MessageRow"))
        XCTAssertFalse(source.contains("MarkdownView"))
        XCTAssertFalse(source.contains("StreamingTranscriptRows"))
        XCTAssertTrue(source.contains("VStack"))
        XCTAssertFalse(source.contains("LazyVStack"))
        XCTAssertTrue(source.contains("if layout.fitsWithoutScroll"))
        XCTAssertTrue(source.contains("ScrollViewReader"))
        XCTAssertTrue(source.contains("maxRailHeight"))
        XCTAssertTrue(source.contains("accessibilityLabel"))
        XCTAssertTrue(source.contains("scrollRequestIfNeeded"))
        XCTAssertTrue(source.contains("railWidth"))
        // Dense adaptive track + always-hidden scroller + custom hover tooltip.
        XCTAssertTrue(source.contains("trackLayout"))
        XCTAssertTrue(source.contains("showsIndicators: false"))
        XCTAssertTrue(source.contains(".scrollIndicators(.hidden)"))
        XCTAssertFalse(source.contains("scrollClipDisabled"))
        XCTAssertTrue(source.contains("UserPromptNavigationRailTooltip"))
        XCTAssertTrue(source.contains(".allowsHitTesting(false)"))
        XCTAssertTrue(source.contains("hoverSummaryText"))
        XCTAssertFalse(
            source.contains(".help("),
            "must not rely on delayed native .help for node summaries"
        )
        XCTAssertFalse(source.contains("overlayScrollers"))
    }

    // MARK: - Helpers

    private var repositoryRoot: URL {
        var url = URL(fileURLWithPath: #filePath)
        while url.pathComponents.count > 1 {
            url.deleteLastPathComponent()
            let package = url.appendingPathComponent("Package.swift")
            if FileManager.default.fileExists(atPath: package.path) {
                return url
            }
        }
        return URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }
}
