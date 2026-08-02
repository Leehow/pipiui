import XCTest
import AppKit
import SwiftUI
@testable import PipiUI

/// Integration probe for the internal-anchor prepend-compensation geometry.
///
/// Two scenes, both run inside a real `NSScrollView` with an `NSHostingView`
/// document:
///
/// 1. **Legacy** (`LegacyProbeTranscriptContent`) — the previous production
///    shape: `ForEach { rows }.overlay { tracker }` flattened directly into
///    the eager outer VStack. SwiftUI expands that into ONE overlay host **per
///    row**, and the production coordinator's `anchorView` (the last
///    `updateNSView` call = the top-most row host) is REBOUND to a new host on
///    every prepend, so the tracked converted minY/maxY never move. This is
///    the measured reason the old compensation could never apply; kept as a
///    deterministic reproducer of the non-production contract.
///
/// 2. **Production** (`ProbeTranscriptContent`) — the settled `ForEach` lives
///    inside its own real eager `VStack` container and the tracker overlay is
///    attached to THAT container (exactly ONE overlay host), with an explicit
///    zero-height `sizeThatFits` on the representable. One tracker NSView,
///    stable identity across prepends, converted minY == maxY at the settled
///    container bottom, moving by exactly the prepended height.
///
/// Measured per phase, exactly like the production coordinator samples them:
/// - the tracked anchor's `frame` / `bounds` / `convert(bounds, to: document)`
/// - every overlay host's converted rect (before AND after, keeping the view
///   objects so identity and displacement are observable across the prepend)
/// - document `frame` / `bounds` / `isFlipped`, clip bounds origin
/// - `frameDidChange` / `boundsDidChange` notification counts on the tracked
///   anchor, the document, and the clip
@MainActor
final class OverlayAnchorGeometryIntegrationTests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        // XCTest 宿主默认没有 AppKit 主循环：先创建共享 NSApplication（route-2
        // 离屏窗口需要它才能真正 attach）。
        _ = NSApplication.shared
    }

    // MARK: - Legacy reproducer (non-production contract)

    /// The legacy shape (`ForEach { rows }.overlay { tracker }` inside the
    /// outer VStack) is measured to produce one overlay host PER ROW and to
    /// REBIND the tracked anchor to a new top-row host on every prepend — so
    /// the tracked converted minY/maxY never move and the prepend compensation
    /// can never apply. This test pins those facts as the non-production
    /// contract; the production-shape test below is the fix contract.
    func testLegacyForEachOverlayContractProducesPerRowHostsAndRebind() throws {
        let settled: [Int] = [1, 2, 3, 4, 5]
        let prepended: [Int] = [-2, -1, 0]

        let harness = try makeLegacyHarness()
        defer { harness.teardown() }

        harness.setRows(settled)
        let before = harness.settleAndSnapshot()
        let trackedBefore = before.allHosts.first?.view
        XCTAssertNotNil(trackedBefore, "legacy tracked anchor (top row host) must exist")

        let counter = NotificationCounter()
        defer { counter.teardown() }
        counter.observe(anchor: trackedBefore!, document: harness.host, clip: harness.scrollView.contentView)

        harness.setRows(prepended + settled)
        let after = harness.settleAndSnapshot()
        let trackedAfter = after.allHosts.first?.view

        print("LEGACY PROBE route: \(harness.routeDescription)")
        print("LEGACY PROBE hosts before=\(before.allHosts.count) after=\(after.allHosts.count)")
        print("LEGACY PROBE tracked identity: \(trackedAfter === trackedBefore ? "same view" : "REBOUND to a new (top row) host")")
        print("LEGACY PROBE converted before=\(NSStringFromRect(before.anchorConvertedRect)) after=\(NSStringFromRect(after.anchorConvertedRect))")
        print("LEGACY PROBE document frame notifications during prepend=\(counter.documentFrameCount)")

        // The legacy shape is the KNOWN-BROKEN non-production contract:
        XCTAssertEqual(
            before.allHosts.count, settled.count,
            "legacy ForEach.overlay must flatten into one overlay host per row"
        )
        XCTAssertFalse(
            trackedAfter === trackedBefore,
            "legacy tracked anchor must REBIND to a new top-row host after a prepend"
        )
        XCTAssertEqual(
            after.convertedMinY, before.convertedMinY, accuracy: 0.5,
            "legacy tracked anchor converted minY must not move under a head prepend"
        )
        XCTAssertEqual(
            after.convertedMaxY, before.convertedMaxY, accuracy: 0.5,
            "legacy tracked anchor converted maxY must not move under a head prepend"
        )
        XCTAssertGreaterThan(counter.documentFrameCount, 0, "document frameDidChange must fire on prepend")
    }

    // MARK: - Production-shape probe (the fix contract)

    /// Production contract: the settled `ForEach` sits inside its own real
    /// eager `VStack` and the tracker overlay chains to THAT container with an
    /// explicit zero-height representable. Exactly one tracker host/NSView,
    /// stable identity across a prepend, converted anchor point moving by
    /// exactly K * (row + spacing), and bottom-extras churn never moving it.
    func testProductionShapedSettledContainerOverlayAnchorGeometry() throws {
        let rowHeight = ProbeConstants.rowHeight
        let spacing = ProbeConstants.spacing
        let settled: [Int] = [1, 2, 3, 4, 5]
        let prepended: [Int] = [-2, -1, 0]

        let harness = try makeHarness(scene: .production)
        defer { harness.teardown() }

        // Phase A — initial settled window of 5 rows.
        harness.setRows(settled)
        let before = harness.settleAndSnapshot()
        let trackedBefore = before.allHosts.first?.view
        XCTAssertNotNil(trackedBefore, "production tracker host must exist")
        XCTAssertEqual(before.allHosts.count, 1, "production shape must mount exactly ONE tracker host")

        // Attach notification counters before the prepend so the prepend's own
        // document frameDidChange is observable.
        let counter = NotificationCounter()
        defer { counter.teardown() }
        counter.observe(anchor: trackedBefore!, document: harness.host, clip: harness.scrollView.contentView)

        // Phase B — prepend K = 3 older rows at the head; the settled rows keep
        // their identity and shift down by exactly K * (row + gap).
        harness.setRows(prepended + settled)
        let afterPrepend = harness.settleAndSnapshot()
        let trackedAfter = afterPrepend.allHosts.first?.view

        // Phase C — bottom extras alone grow taller by 150pt.
        counter.reset()
        harness.setBottomExtraHeight(ProbeConstants.bottomExtraHeight + 150)
        let afterChurn = harness.settleAndSnapshot()

        // ---- Raw numbers for the report ----
        let expectedDelta = CGFloat(prepended.count) * (rowHeight + spacing) // 3 * 39 = 117
        let actualDelta = afterPrepend.convertedMinY - before.convertedMinY
        print("PROBE route: \(harness.routeDescription)")
        print("PROBE constants: rowHeight=\(rowHeight) spacing=\(spacing) settled=\(settled.count) prepended=\(prepended.count) expectedDelta=\(expectedDelta)")
        print("PROBE tracked-anchor object after prepend: \(trackedAfter === trackedBefore ? "SAME view" : "REBOUND to a new host")")
        print("PROBE BEFORE (settled \(settled.count) rows):\n\(before)")
        print("PROBE AFTER-PREPEND (+\(prepended.count) rows):\n\(afterPrepend)")
        print("PROBE AFTER-BOTTOM-CHURN (extra +150):\n\(afterChurn)")
        print("PROBE anchor delta on prepend: \(actualDelta) (expected \(expectedDelta))")
        print("PROBE notifications during prepend: document frame=\(counter.documentFrameCount) bounds=\(counter.documentBoundsCount), "
            + "anchor frame=\(counter.anchorFrameCount) bounds=\(counter.anchorBoundsCount), clip bounds=\(counter.clipBoundsCount)")
        print("PROBE notifications during churn: document frame=\(counter.documentFrameCount) bounds=\(counter.documentBoundsCount), "
            + "anchor frame=\(counter.anchorFrameCount) bounds=\(counter.anchorBoundsCount), clip bounds=\(counter.clipBoundsCount)")

        // ---- Physical invariants ----

        // 1. Flipped, top-anchored document (NSHostingView is flipped).
        XCTAssertTrue(before.documentIsFlipped, "document must be flipped like a SwiftUI hosting document")

        // 2. Exactly ONE tracker host/NSView in every phase — the overlay must
        //    attach to the single settled container, not the ForEach.
        XCTAssertEqual(before.allHosts.count, 1, "production shape must mount exactly one tracker host")
        XCTAssertEqual(afterPrepend.allHosts.count, 1, "production shape must keep exactly one tracker host after a prepend")
        XCTAssertEqual(afterChurn.allHosts.count, 1, "production shape must keep exactly one tracker host after bottom churn")

        // 3. Anchor object identity is stable across the prepend.
        XCTAssertTrue(
            trackedAfter === trackedBefore,
            "production tracked anchor must be the SAME NSView after a prepend"
        )
        XCTAssertTrue(
            afterChurn.allHosts.first?.view === trackedBefore,
            "production tracked anchor must stay the SAME NSView through bottom churn"
        )

        // 4. Explicit zero height: anchor bounds height == 0 (converted rect
        //    height 0 too), so minY == maxY at the settled container bottom.
        XCTAssertEqual(before.anchorBounds.height, 0, accuracy: 0.5, "anchor bounds height must be exactly 0")
        XCTAssertEqual(afterPrepend.anchorConvertedRect.height, 0, accuracy: 0.5, "converted anchor rect height must be exactly 0")
        XCTAssertEqual(before.convertedMinY, before.convertedMaxY, accuracy: 0.5, "minY must equal maxY with zero height")
        XCTAssertEqual(afterPrepend.convertedMinY, afterPrepend.convertedMaxY, accuracy: 0.5, "minY must equal maxY with zero height")

        // 5. Prepend K=3 (row 30, spacing 9): the converted anchor point moves
        //    by exactly 3 * 39 = 117, and `targetOriginY` equals the old clip
        //    origin + 117 (unclamped: viewport 220 < content 372 after prepend).
        XCTAssertEqual(
            actualDelta, expectedDelta, accuracy: 0.5,
            "converted anchor delta under a K=3 prepend must equal K * (row + spacing)"
        )
        XCTAssertEqual(
            afterPrepend.documentHeight - before.documentHeight, expectedDelta, accuracy: 0.5,
            "document must grow by exactly the prepended rows + their gaps"
        )
        let clipOriginBefore: CGFloat = 20
        let target = PrependAnchorCompensation.targetOriginY(
            clipOriginYBefore: clipOriginBefore,
            anchorYBefore: before.convertedMinY,
            anchorYNow: afterPrepend.convertedMinY,
            contentHeight: afterPrepend.documentHeight,
            viewportHeight: harness.scrollView.contentView.bounds.height
        )
        XCTAssertEqual(
            target ?? .nan, clipOriginBefore + expectedDelta, accuracy: 0.5,
            "targetOriginY must equal the pre-prepend clip origin plus the anchor displacement"
        )

        // 6. Bottom-extra churn (+150): the document grows by exactly 150 but
        //    the anchor converted Y delta is 0, and the pure compensation must
        //    refuse to apply (returns nil).
        XCTAssertEqual(afterChurn.documentHeight - afterPrepend.documentHeight, 150, accuracy: 0.5)
        XCTAssertEqual(
            afterChurn.convertedMinY, afterPrepend.convertedMinY, accuracy: 0.02,
            "bottom-extras churn must never move the anchor"
        )
        XCTAssertNil(
            PrependAnchorCompensation.targetOriginY(
                clipOriginYBefore: clipOriginBefore,
                anchorYBefore: afterPrepend.convertedMinY,
                anchorYNow: afterChurn.convertedMinY,
                contentHeight: afterChurn.documentHeight,
                viewportHeight: harness.scrollView.contentView.bounds.height
            ),
            "a bottom-only churn must yield no compensation target"
        )

        // 7. Notification path: the *document* frameDidChange fires when the
        //    prepend layout lands (production schedules the top-edge evaluation
        //    / compensation attempt on it). The anchor's own frame notification
        //    is deliberately NOT required: SwiftUI moves the single overlay
        //    host, and the coordinator reads the anchor position live from the
        //    document coordinate at evaluation time.
        XCTAssertGreaterThan(
            counter.documentFrameCount, 0,
            "document frameDidChange must fire on prepend (schedules the compensation layout attempt)"
        )
    }

    // MARK: - Empty production shape (the reviewer's spacing gap)

    /// Empty production rows (the reachable initialization state) must not
    /// mount the settled container or its tracker: with the guard, `rows == []`
    /// yields exactly ONE outer spacing (before marker ↔ bottom-extra marker),
    /// while the pre-fix always-declared zero-height container was still a real
    /// outer-VStack child and added a SECOND spacing gap (the 16-28pt reviewer
    /// finding). Once rows become non-empty the same production probe must
    /// mount exactly one tracker; identity / +117 / churn-0 stay pinned by
    /// `testProductionShapedSettledContainerOverlayAnchorGeometry`.
    func testEmptyProductionShapeOmitsSettledContainerAndExtraOuterSpacing() throws {
        let harness = try makeHarness(scene: .production)
        defer { harness.teardown() }

        // Phase A — empty rows: zero tracker hosts, and the document height is
        // exactly before-marker + bottom-extra + ONE outer spacing. The
        // pre-fix shape would add the empty container (height 0) as a third
        // child and measure +`spacing` taller.
        harness.setRows([])
        let empty = harness.settleAndSnapshot()
        let singleSpacingHeight = ProbeConstants.beforeMarkerHeight
            + ProbeConstants.bottomExtraHeight
            + ProbeConstants.spacing
        print("EMPTY PROBE route: \(harness.routeDescription)")
        print("EMPTY PROBE hosts=\(empty.allHosts.count) docHeight=\(empty.documentHeight) "
            + "(single-spacing expected \(singleSpacingHeight))")
        XCTAssertEqual(
            empty.allHosts.count, 0,
            "empty production rows must mount ZERO tracker hosts"
        )
        XCTAssertEqual(
            empty.documentHeight, singleSpacingHeight, accuracy: 1.0,
            "empty shape must keep exactly ONE outer spacing — an always-declared zero-height settled container would add a second one"
        )

        // Phase B — rows arrive: exactly one tracker mounts and the document
        // grows by rows * (row + spacing): the settled window (5 rows + 4 inner
        // gaps) plus the one outer gap the container now legitimately gets.
        harness.setRows([1, 2, 3, 4, 5])
        let populated = harness.settleAndSnapshot()
        print("EMPTY PROBE populated hosts=\(populated.allHosts.count) "
            + "docHeight=\(populated.documentHeight) "
            + "delta=\(populated.documentHeight - empty.documentHeight) "
            + "(expected \(5 * (ProbeConstants.rowHeight + ProbeConstants.spacing)))")
        XCTAssertEqual(
            populated.allHosts.count, 1,
            "non-empty rows must mount exactly ONE tracker host"
        )
        XCTAssertEqual(
            populated.documentHeight - empty.documentHeight,
            5 * (ProbeConstants.rowHeight + ProbeConstants.spacing),
            accuracy: 1.0,
            "populating 5 rows must add exactly 5 * (row + spacing)"
        )
    }

    // MARK: - Harness routing

    /// Route 1: plain `NSHostingView` document, no window (repo precedent in
    /// `MarkdownLayoutSizingTests`). If the anchor never lays out or the model
    /// mutation never re-renders, retry once, then switch to route 2: an
    /// offscreen borderless window attached to the window server. At most two
    /// attempts per route.
    private func makeHarness(scene: ProbeScene) throws -> ProbeHarness<ProbeTranscriptContent> {
        for _ in 0..<2 {
            let model = ProbeModel()
            let harness = ProbeHarness(useWindow: false, model: model, rootView: ProbeTranscriptContent(model: model), sceneName: scene.rawValue)
            if harness.sanityPasses() { return harness }
            harness.teardown()
        }
        for _ in 0..<2 {
            let model = ProbeModel()
            let harness = ProbeHarness(useWindow: true, model: model, rootView: ProbeTranscriptContent(model: model), sceneName: scene.rawValue)
            if harness.sanityPasses() { return harness }
            harness.teardown()
        }
        XCTFail("probe harness could not lay out the anchor without a window (route 1) nor in an offscreen window (route 2)")
        throw ProbeError.harnessUnusable
    }

    private func makeLegacyHarness() throws -> ProbeHarness<LegacyProbeTranscriptContent> {
        for _ in 0..<2 {
            let model = ProbeModel()
            let harness = ProbeHarness(useWindow: false, model: model, rootView: LegacyProbeTranscriptContent(model: model), sceneName: "legacy")
            if harness.sanityPasses() { return harness }
            harness.teardown()
        }
        for _ in 0..<2 {
            let model = ProbeModel()
            let harness = ProbeHarness(useWindow: true, model: model, rootView: LegacyProbeTranscriptContent(model: model), sceneName: "legacy")
            if harness.sanityPasses() { return harness }
            harness.teardown()
        }
        XCTFail("legacy probe harness could not lay out the anchor without a window (route 1) nor in an offscreen window (route 2)")
        throw ProbeError.harnessUnusable
    }
}

private enum ProbeError: Error {
    case harnessUnusable
}

// MARK: - Probe scene

private enum ProbeConstants {
    static let rowHeight: CGFloat = 30
    static let spacing: CGFloat = 9
    static let beforeMarkerHeight: CGFloat = 40
    static let bottomExtraHeight: CGFloat = 60
}

@MainActor
private final class ProbeModel: ObservableObject {
    @Published var rows: [Int] = []
    @Published var bottomExtraHeight: CGFloat = ProbeConstants.bottomExtraHeight
}

private struct ProbeRowView: View {
    let index: Int
    var body: some View {
        Rectangle()
            .fill(Color.blue.opacity(0.25))
            .frame(width: 300, height: ProbeConstants.rowHeight)
            .overlay(Text("row \(index)").font(.system(size: 9)))
    }
}

/// Mirror of the LEGACY production `StickToBottomTracker.makeNSView`: a
/// zero-frame, hidden NSView with NO explicit size — SwiftUI's overlay host
/// sizes it from the row, so the legacy ForEach.overlay flattens per row.
private struct ProbeLegacyAnchorRepresentable: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        view.isHidden = true
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}

/// Mirror of the FIXED production `StickToBottomTracker`: explicit zero-height
/// `sizeThatFits` (width follows the proposal). The overlay host is sized from
/// this answer, so the anchor has height 0 and minY == maxY at the settled
/// container bottom.
private struct ProbeAnchorRepresentable: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        view.isHidden = true
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}

    func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSView, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 0, height: 0)
    }
}

/// The LEGACY transcript content: eager VStack with the settled ForEach +
/// bottom-aligned representable overlay DIRECTLY on the ForEach, then bottom
/// extras. Kept only as the non-production reproducer scene.
private struct LegacyProbeTranscriptContent: View {
    @ObservedObject var model: ProbeModel

    var body: some View {
        VStack(alignment: .leading, spacing: ProbeConstants.spacing) {
            ForEach(model.rows, id: \.self) { index in
                ProbeRowView(index: index)
            }
            .overlay(alignment: .bottom) {
                ProbeLegacyAnchorRepresentable()
            }
            // Bottom extras — after the settled ForEach, mirrors production's
            // streaming item / return button / bottom sentinel.
            Rectangle()
                .fill(Color.green.opacity(0.25))
                .frame(width: 300, height: model.bottomExtraHeight)
                .overlay(Text("bottom-extra").font(.system(size: 9)))
        }
    }
}

/// Mirror of the FIXED production transcript content: a fixed outer marker,
/// then the settled `ForEach` inside its own real eager `VStack` container
/// (same spacing as the outer VStack) guarded by `if !presentation.rows.isEmpty`
/// — empty rows (the reachable initialization state) must not mount the
/// container or its tracker at all, otherwise the outer VStack counts the
/// zero-height container as a real child and adds one extra spacing gap — and
/// the tracker overlay attaches to THAT container, with bottom extras
/// following after it in the outer VStack.
private struct ProbeTranscriptContent: View {
    @ObservedObject var model: ProbeModel

    var body: some View {
        VStack(alignment: .leading, spacing: ProbeConstants.spacing) {
            // Fixed before marker — always present above the settled window,
            // mirrors the outer VStack's pinned-gravity spacer / init state.
            Rectangle()
                .fill(Color.purple.opacity(0.25))
                .frame(width: 300, height: ProbeConstants.beforeMarkerHeight)
                .overlay(Text("before-marker").font(.system(size: 9)))
            if !model.rows.isEmpty {
                VStack(alignment: .leading, spacing: ProbeConstants.spacing) {
                    ForEach(model.rows, id: \.self) { index in
                        ProbeRowView(index: index)
                    }
                }
                .overlay(alignment: .bottom) {
                    ProbeAnchorRepresentable()
                }
            }
            // Bottom extras — after the settled container, mirrors production's
            // streaming item / return button / bottom sentinel.
            Rectangle()
                .fill(Color.green.opacity(0.25))
                .frame(width: 300, height: model.bottomExtraHeight)
                .overlay(Text("bottom-extra").font(.system(size: 9)))
        }
    }
}

// MARK: - Harness

private enum ProbeScene: String {
    case legacy
    case production
}

/// One overlay host + its converted rect, sorted top→bottom.
private struct AnchorHost {
    let view: NSView
    let rect: CGRect
}

@MainActor
private final class ProbeHarness<Content: View> {
    let model: ProbeModel
    let scrollView: NSScrollView
    let host: NSHostingView<Content>
    let window: NSWindow?
    let routeDescription: String

    init(useWindow: Bool, model: ProbeModel, rootView: Content, sceneName: String) {
        routeDescription = (useWindow ? "route2-offscreen-window" : "route1-no-window") + "/\(sceneName)"
        self.model = model
        scrollView = NSScrollView(frame: CGRect(x: 0, y: 0, width: 520, height: 220))
        host = NSHostingView(rootView: rootView)
        host.autoresizingMask = []
        host.setFrameSize(NSSize(width: 300, height: 200))
        scrollView.documentView = host
        scrollView.hasVerticalScroller = true
        scrollView.contentView.postsBoundsChangedNotifications = true
        if useWindow {
            let w = NSWindow(
                contentRect: CGRect(x: -20_000, y: -20_000, width: 520, height: 220),
                styleMask: [.borderless],
                backing: .buffered,
                defer: false
            )
            w.isReleasedWhenClosed = false
            w.contentView = scrollView
            w.orderFront(nil)
            window = w
        } else {
            window = nil
        }
    }

    /// The anchor must lay out *and* re-render on model mutation, otherwise the
    /// harness cannot observe prepend geometry at all.
    func sanityPasses() -> Bool {
        setRows([1, 2, 3, 4, 5])
        let first = settleAndSnapshot()
        let anchorOK = !first.allHosts.isEmpty
            && first.allHosts[0].rect.width > 1
            && first.documentHeight > 1
        print("PROBE sanity \(routeDescription): anchors=\(first.allHosts.count) "
            + "docHeight=\(first.documentHeight) trackedConverted=\(NSStringFromRect(first.anchorConvertedRect))")
        guard anchorOK else { return false }
        setRows([1, 2, 3, 4, 5, 6])
        let second = settleAndSnapshot()
        let grew = second.documentHeight > first.documentHeight + rowHeightGap() - 1
        print("PROBE sanity re-render: grew=\(grew) docHeight \(first.documentHeight) → \(second.documentHeight)")
        return grew
    }

    private func rowHeightGap() -> CGFloat {
        ProbeConstants.rowHeight + ProbeConstants.spacing
    }

    func setRows(_ rows: [Int]) { model.rows = rows }
    func setBottomExtraHeight(_ height: CGFloat) { model.bottomExtraHeight = height }

    /// Drives layout/runloop until the geometry stops changing, then returns
    /// the measured snapshot.
    func settleAndSnapshot(rounds: Int = 40) -> AnchorGeometrySnapshot {
        var previous: AnchorGeometrySnapshot?
        for _ in 0..<rounds {
            RunLoop.main.run(until: Date().addingTimeInterval(0.004))
            let fitting = host.fittingSize
            if fitting.width > 1, fitting.height > 1,
               abs(fitting.width - host.frame.width) > 0.01 || abs(fitting.height - host.frame.height) > 0.01 {
                host.setFrameSize(fitting)
            }
            host.needsLayout = true
            host.layoutSubtreeIfNeeded()
            let snap = snapshot()
            if let previous, snap.isApproximately(previous) {
                return snap
            }
            previous = snap
        }
        return snapshot()
    }

    /// All probe-anchor views in the document subtree (the only hidden views
    /// in the probe tree), sorted top→bottom by their converted minY.
    func allAnchorHosts() -> [AnchorHost] {
        var found: [AnchorHost] = []
        func walk(_ view: NSView) {
            if view.isHidden {
                found.append(AnchorHost(view: view, rect: view.convert(view.bounds, to: host)))
            }
            for sub in view.subviews {
                walk(sub)
            }
        }
        walk(host)
        return found.sorted { $0.rect.minY < $1.rect.minY }
    }

    func snapshot() -> AnchorGeometrySnapshot {
        let allHosts = allAnchorHosts()
        let anchor = allHosts.first?.view ?? NSView(frame: .zero)
        var ancestors: [String] = []
        var current: NSView? = anchor.superview
        var depth = 0
        while let c = current, depth < 8 {
            ancestors.append("\(type(of: c)) frame=\(NSStringFromRect(c.frame)) flipped=\(c.isFlipped)")
            if c === host { break }
            current = c.superview
            depth += 1
        }
        return AnchorGeometrySnapshot(
            documentFrame: host.frame,
            documentBounds: host.bounds,
            documentIsFlipped: host.isFlipped,
            anchorFrame: anchor.frame,
            anchorBounds: anchor.bounds,
            anchorConvertedRect: anchor.convert(anchor.bounds, to: host),
            allHosts: allHosts,
            anchorSuperviews: ancestors,
            clipOrigin: scrollView.contentView.bounds.origin
        )
    }

    func teardown() {
        window?.orderOut(nil)
        window?.close()
    }
}

// MARK: - Snapshot

private struct AnchorGeometrySnapshot: CustomStringConvertible {
    var documentFrame: CGRect
    var documentBounds: CGRect
    var documentIsFlipped: Bool
    var anchorFrame: CGRect
    var anchorBounds: CGRect
    var anchorConvertedRect: CGRect
    var allHosts: [AnchorHost]
    var anchorSuperviews: [String]
    var clipOrigin: CGPoint

    var documentHeight: CGFloat { documentBounds.height }
    var convertedMinY: CGFloat { anchorConvertedRect.minY }
    var convertedMaxY: CGFloat { anchorConvertedRect.maxY }

    var description: String {
        let hostLines = allHosts
            .map { "  hostConverted=\(NSStringFromRect($0.rect))" }
            .joined(separator: "\n")
        let superviewLines = anchorSuperviews.isEmpty
            ? "  (none)"
            : anchorSuperviews.map { "  \($0)" }.joined(separator: "\n")
        return """
          documentFrame=\(NSStringFromRect(documentFrame)) bounds=\(NSStringFromRect(documentBounds)) flipped=\(documentIsFlipped)
          trackedAnchorFrame=\(NSStringFromRect(anchorFrame)) bounds=\(NSStringFromRect(anchorBounds))
          trackedAnchorConverted=\(NSStringFromRect(anchorConvertedRect)) (minY=\(anchorConvertedRect.minY) maxY=\(anchorConvertedRect.maxY))
          allOverlayHosts(\(allHosts.count)):
        \(hostLines)
          trackedAnchorSuperviews:
        \(superviewLines)
          clipOrigin=\(NSStringFromPoint(clipOrigin))
        """
    }

    func isApproximately(_ other: AnchorGeometrySnapshot, tolerance: CGFloat = 0.02) -> Bool {
        documentFrame.isApproximately(other.documentFrame, tolerance: tolerance)
            && documentBounds.isApproximately(other.documentBounds, tolerance: tolerance)
            && anchorFrame.isApproximately(other.anchorFrame, tolerance: tolerance)
            && anchorBounds.isApproximately(other.anchorBounds, tolerance: tolerance)
            && anchorConvertedRect.isApproximately(other.anchorConvertedRect, tolerance: tolerance)
    }
}

private extension CGRect {
    func isApproximately(_ other: CGRect, tolerance: CGFloat) -> Bool {
        abs(origin.x - other.origin.x) <= tolerance
            && abs(origin.y - other.origin.y) <= tolerance
            && abs(width - other.width) <= tolerance
            && abs(height - other.height) <= tolerance
    }
}

// MARK: - Notification counting

/// Plain (non-isolated) counter: only ever touched from the main thread where
/// the notifications are delivered.
private final class NotificationCounter {
    private(set) var anchorFrameCount = 0
    private(set) var anchorBoundsCount = 0
    private(set) var documentFrameCount = 0
    private(set) var documentBoundsCount = 0
    private(set) var clipBoundsCount = 0
    private var observers: [NSObjectProtocol] = []

    func observe(anchor: NSView, document: NSView, clip: NSView) {
        anchor.postsFrameChangedNotifications = true
        anchor.postsBoundsChangedNotifications = true
        document.postsFrameChangedNotifications = true
        document.postsBoundsChangedNotifications = true
        clip.postsBoundsChangedNotifications = true
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: NSView.frameDidChangeNotification, object: anchor, queue: .main
        ) { [weak self] _ in self?.anchorFrameCount += 1 })
        observers.append(center.addObserver(
            forName: NSView.boundsDidChangeNotification, object: anchor, queue: .main
        ) { [weak self] _ in self?.anchorBoundsCount += 1 })
        observers.append(center.addObserver(
            forName: NSView.frameDidChangeNotification, object: document, queue: .main
        ) { [weak self] _ in self?.documentFrameCount += 1 })
        observers.append(center.addObserver(
            forName: NSView.boundsDidChangeNotification, object: document, queue: .main
        ) { [weak self] _ in self?.documentBoundsCount += 1 })
        observers.append(center.addObserver(
            forName: NSView.boundsDidChangeNotification, object: clip, queue: .main
        ) { [weak self] _ in self?.clipBoundsCount += 1 })
    }

    func reset() {
        anchorFrameCount = 0
        anchorBoundsCount = 0
        documentFrameCount = 0
        documentBoundsCount = 0
        clipBoundsCount = 0
    }

    func teardown() {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        observers = []
    }
}
