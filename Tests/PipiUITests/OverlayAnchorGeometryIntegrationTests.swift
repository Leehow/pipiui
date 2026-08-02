import XCTest
import AppKit
import SwiftUI

/// Integration probe for the internal-anchor prepend-compensation geometry.
///
/// This is a *probe, not a fix*: it reproduces the production transcript shape
/// (eager VStack, settled ForEach of fixed-height rows, a bottom-aligned
/// NSViewRepresentable tracker overlay on that ForEach, fixed-height bottom
/// extras after it) inside a real `NSScrollView` with an `NSHostingView`
/// document, then records the raw geometry of the representable's host NSView
/// across (a) an initial settled window, (b) a K-row prepend at the head, and
/// (c) a bottom-extra-only height churn.
///
/// Observed structure (measured by this probe, mirroring production):
/// SwiftUI flattens `ForEach { rows }.overlay { tracker }` inside the VStack
/// into ONE overlay host **per row**, each filling exactly its own row. The
/// production coordinator's `anchorView` is the representable NSView of the
/// last `updateNSView` call, which this probe measures as the top-most row
/// host (updateNSView fires bottom-row-first).
///
/// Measured per phase, exactly like the production coordinator samples them:
/// - the tracked anchor's `frame` / `bounds` / `convert(bounds, to: document)`
/// - every per-row overlay host's converted rect (before AND after, keeping
///   the view objects so their displacement is observable across the prepend)
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

    // MARK: - The probe

    func testSettledForEachOverlayAnchorGeometry() throws {
        let rowHeight = ProbeConstants.rowHeight
        let spacing = ProbeConstants.spacing
        let settled: [Int] = [1, 2, 3, 4, 5]
        let prepended: [Int] = [-2, -1, 0]

        let harness = try makeHarness()
        defer { harness.teardown() }

        // Phase A — initial settled window of 5 rows.
        harness.setRows(settled)
        let before = harness.settleAndSnapshot()

        // Keep the Phase-A host objects: after the prepend they keep their
        // identity and shift down, so their live rects expose the true
        // displacement even though the *tracked* anchor may be rebound.
        let originalHosts = before.allHosts.map(\.view)
        let trackedBefore = before.allHosts.first?.view
        XCTAssertNotNil(trackedBefore, "tracked anchor (top row host) must exist")
        XCTAssertEqual(
            before.allHosts.count, settled.count,
            "SwiftUI must place one overlay host per settled row (ForEach flattens into the VStack)"
        )

        // Attach notification counters to the tracked anchor, document, clip.
        let counter = NotificationCounter()
        defer { counter.teardown() }
        counter.observe(anchor: trackedBefore!, document: harness.host, clip: harness.scrollView.contentView)

        // Phase B — prepend K = 3 older rows at the head; existing rows keep
        // their identity and shift down by the prepended height.
        harness.setRows(prepended + settled)
        let afterPrepend = harness.settleAndSnapshot()
        let trackedAfter = afterPrepend.allHosts.first?.view

        // Phase C — bottom extras alone grow taller by 150pt.
        counter.reset()
        harness.setBottomExtraHeight(ProbeConstants.bottomExtraHeight + 150)
        let afterChurn = harness.settleAndSnapshot()

        // ---- Raw numbers for the fix decision ----
        print("PROBE route: \(harness.routeDescription)")
        print("PROBE constants: rowHeight=\(rowHeight) spacing=\(spacing) settled=\(settled.count) prepended=\(prepended.count)")
        print("PROBE tracked-anchor object after prepend: \(trackedAfter === trackedBefore ? "same view" : "REBOUND to a new (top row) host")")
        print("PROBE BEFORE (settled \(settled.count) rows):\n\(before)")
        print("PROBE AFTER-PREPEND (+\(prepended.count) rows):\n\(afterPrepend)")
        print("PROBE AFTER-BOTTOM-CHURN (extra +150):\n\(afterChurn)")
        for (index, host) in originalHosts.enumerated() {
            let rect = host.convert(host.bounds, to: harness.host)
            let beforeRect = before.allHosts[index].rect
            let superview = host.superview
            print("PROBE originalHost[\(index)] frame \(NSStringFromRect(beforeRect)) → \(NSStringFromRect(rect)) "
                + "(delta \(rect.minY - beforeRect.minY)) "
                + "superview=\(type(of: superview ?? NSView())) "
                + "superviewFrame=\(superview.map { NSStringFromRect($0.frame) } ?? "none")")
        }
        print("PROBE notifications during prepend: tracked-anchor frame=\(counter.anchorFrameCount) bounds=\(counter.anchorBoundsCount), "
            + "document frame=\(counter.documentFrameCount) bounds=\(counter.documentBoundsCount), clip bounds=\(counter.clipBoundsCount)")
        print("PROBE notifications during churn: tracked-anchor frame=\(counter.anchorFrameCount) bounds=\(counter.anchorBoundsCount), "
            + "document frame=\(counter.documentFrameCount) bounds=\(counter.documentBoundsCount), clip bounds=\(counter.clipBoundsCount)")

        // ---- Physical invariants ----

        // 1. Flipped, top-anchored document (NSHostingView is flipped).
        XCTAssertTrue(before.documentIsFlipped, "document must be flipped like a SwiftUI hosting document")

        // 2. Per-row overlay hosts: each fills exactly its own row, stacked with
        //    the VStack spacing; the first row sits at the document top.
        XCTAssertEqual(before.allHosts.count, settled.count)
        for host in before.allHosts {
            XCTAssertEqual(host.rect.height, rowHeight, accuracy: 0.5, "host must fill its own row")
            XCTAssertEqual(host.rect.width, before.anchorConvertedRect.width, accuracy: 0.5)
        }
        XCTAssertEqual(before.allHosts.first?.rect.minY ?? CGFloat.nan, 0, accuracy: 0.5, "top row host must sit at the document top")
        for (index, host) in before.allHosts.enumerated().dropFirst() {
            XCTAssertEqual(
                host.rect.minY, before.allHosts[index - 1].rect.minY + rowHeight + spacing, accuracy: 0.5,
                "rows must stack with the VStack spacing"
            )
        }

        // 3. Prepend: the document grows; every kept row shifts down by exactly
        //    the document growth (flipped), and the settled region's visual
        //    bottom (the bottom-most kept host's maxY) moves by the same amount.
        let docDelta = afterPrepend.documentHeight - before.documentHeight
        let rawRows = CGFloat(prepended.count) * rowHeight
        XCTAssertGreaterThan(docDelta, 0, "prepend must grow the document")
        XCTAssertGreaterThanOrEqual(docDelta, rawRows, "document must grow by at least the raw row heights")
        XCTAssertLessThanOrEqual(
            docDelta, rawRows + CGFloat(prepended.count) * spacing + spacing,
            "document growth must not exceed rows + their gaps"
        )
        for (index, host) in originalHosts.enumerated() {
            let rect = host.convert(host.bounds, to: harness.host)
            XCTAssertEqual(
                rect.minY - before.allHosts[index].rect.minY, docDelta, accuracy: 0.5,
                "kept row \(index) must shift down by exactly the prepended height"
            )
        }
        let settledBottomBefore = before.allHosts.map(\.rect.maxY).max() ?? 0
        let settledBottomAfter = originalHosts.map { $0.convert($0.bounds, to: harness.host).maxY }.max() ?? 0
        XCTAssertEqual(
            settledBottomAfter - settledBottomBefore, docDelta, accuracy: 0.5,
            "settled region visual bottom must move by exactly the prepended height"
        )

        // 4. THE REGRESSION: the *tracked* anchor (last `updateNSView` = the top
        //    row host, the production sampling point) reports the same converted
        //    rect before and after the prepend — sampling its minY (current
        //    production code) yields delta 0, so compensation never applies.
        XCTAssertEqual(
            afterPrepend.convertedMinY, before.convertedMinY, accuracy: 0.5,
            "tracked anchor's converted minY must not move under a head prepend"
        )
        XCTAssertEqual(
            afterPrepend.convertedMaxY, before.convertedMaxY, accuracy: 0.5,
            "tracked anchor's converted maxY must not move under a head prepend"
        )

        // 5. Notification path: the *document* frameDidChange fires when the
        //    prepend layout lands (production schedules top-edge evaluation on
        //    it). The tracked anchor's own frameDidChange does NOT fire because
        //    SwiftUI keeps the inner NSView's frame and moves its container
        //    instead — printed as a finding for the fix decision.
        XCTAssertGreaterThan(counter.documentFrameCount, 0, "document frameDidChange must fire on prepend")

        // 6. Bottom-extra churn: document grows by exactly the extra height,
        //    but neither the tracked anchor nor the settled rows move a point.
        XCTAssertEqual(afterChurn.documentHeight - afterPrepend.documentHeight, 150, accuracy: 0.5)
        XCTAssertEqual(afterChurn.convertedMinY, afterPrepend.convertedMinY, accuracy: 0.02)
        XCTAssertEqual(afterChurn.convertedMaxY, afterPrepend.convertedMaxY, accuracy: 0.02)
        XCTAssertEqual(
            counter.anchorFrameCount, 0,
            "tracked anchor must not fire frameDidChange when only bottom extras change"
        )
    }

    // MARK: - Harness routing

    /// Route 1: plain `NSHostingView` document, no window (repo precedent in
    /// `MarkdownLayoutSizingTests`). If the anchor never lays out or the model
    /// mutation never re-renders, retry once, then switch to route 2: an
    /// offscreen borderless window attached to the window server. At most two
    /// attempts per route.
    private func makeHarness() throws -> ProbeHarness {
        for _ in 0..<2 {
            let harness = ProbeHarness(useWindow: false)
            if harness.sanityPasses() { return harness }
            harness.teardown()
        }
        for _ in 0..<2 {
            let harness = ProbeHarness(useWindow: true)
            if harness.sanityPasses() { return harness }
            harness.teardown()
        }
        XCTFail("probe harness could not lay out the anchor without a window (route 1) nor in an offscreen window (route 2)")
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

/// Mirror of production `StickToBottomTracker.makeNSView`: a zero-frame,
/// hidden NSView whose SwiftUI-placement is what we are measuring. Hidden
/// views are also what the probe's subview walk uses to find the anchors.
private struct ProbeAnchorRepresentable: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        view.isHidden = true
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}

/// Mirror of the production transcript content: eager VStack, settled ForEach
/// of fixed-height rows with a bottom-aligned representable overlay, then
/// bottom extras after it.
private struct ProbeTranscriptContent: View {
    @ObservedObject var model: ProbeModel

    var body: some View {
        VStack(alignment: .leading, spacing: ProbeConstants.spacing) {
            ForEach(model.rows, id: \.self) { index in
                ProbeRowView(index: index)
            }
            .overlay(alignment: .bottom) {
                ProbeAnchorRepresentable()
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

// MARK: - Harness

@MainActor
private final class ProbeHarness {
    let model = ProbeModel()
    let scrollView: NSScrollView
    let host: NSHostingView<ProbeTranscriptContent>
    let window: NSWindow?
    let routeDescription: String

    /// One overlay host + its converted rect, sorted top→bottom.
    struct AnchorHost {
        let view: NSView
        let rect: CGRect
    }

    init(useWindow: Bool) {
        routeDescription = useWindow ? "route2-offscreen-window" : "route1-no-window"
        scrollView = NSScrollView(frame: CGRect(x: 0, y: 0, width: 520, height: 420))
        host = NSHostingView(rootView: ProbeTranscriptContent(model: model))
        host.autoresizingMask = []
        host.setFrameSize(NSSize(width: 300, height: 200))
        scrollView.documentView = host
        scrollView.hasVerticalScroller = true
        scrollView.contentView.postsBoundsChangedNotifications = true
        if useWindow {
            let w = NSWindow(
                contentRect: CGRect(x: -20_000, y: -20_000, width: 520, height: 420),
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
    var allHosts: [ProbeHarness.AnchorHost]
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
