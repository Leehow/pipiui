import XCTest
import AppKit
import SwiftUI
@testable import PipiUI

/// Runtime proof for the inverted, newest-first eager transcript route.
/// History grows by appending older rows to the layout end; no prepend or
/// post-mutation clip correction is permitted in this probe.
@MainActor
final class InvertedTranscriptAppendIntegrationTests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        _ = NSApplication.shared
    }

    func testThreeOlderAppendsKeepPartialVisibleTargetWithinOnePoint() throws {
        let harness = InvertedProbeHarness(rows: (30..<60).reversed().map(InvertedProbeRow.init(index:)))
        defer { harness.teardown() }

        harness.settle()
        let scrollView = try XCTUnwrap(harness.scrollView)
        let clip = scrollView.contentView

        // Setup only: move off the exact initial boundary so one existing row
        // is clipped at a viewport edge. No clip mutation occurs after history
        // starts appending.
        clip.scroll(to: CGPoint(x: clip.bounds.origin.x, y: clip.bounds.origin.y + 19))
        scrollView.reflectScrolledClipView(clip)
        harness.settle()

        let target = try XCTUnwrap(
            harness.partiallyVisibleMessageID(),
            "probe could not establish a partially visible existing row"
        )
        var previousY = try harness.windowRelativeMinY(id: target)

        let olderBatches = [
            (20..<30).reversed().map(InvertedProbeRow.init(index:)),
            (10..<20).reversed().map(InvertedProbeRow.init(index:)),
            (0..<10).reversed().map(InvertedProbeRow.init(index:)),
        ]

        for (page, batch) in olderBatches.enumerated() {
            harness.model.rows.append(contentsOf: batch)
            harness.settle()

            let currentY = try harness.windowRelativeMinY(id: target)
            let drift = abs(currentY - previousY)
            print("INVERTED APPEND page=\(page + 1) target=\(target) y=\(previousY)->\(currentY) drift=\(drift)")
            XCTAssertLessThanOrEqual(
                drift,
                1,
                "older append \(page + 1) moved \(target) by \(drift)pt (\(previousY) -> \(currentY))"
            )
            previousY = currentY
        }
    }

    func testNewestFirstLayoutReadsOldestAtVisualTopAndNewestAtBottom() throws {
        let harness = InvertedProbeHarness(rows: (0..<4).reversed().map(InvertedProbeRow.init(index:)))
        defer { harness.teardown() }
        harness.settle()

        let oldestY = try harness.windowRelativeMinY(id: "row-0")
        let newestY = try harness.windowRelativeMinY(id: "row-3")
        let bottomExtraY = try harness.windowRelativeMinY(id: InvertedProbeHarness.bottomExtraID)

        // NSHostingView is flipped: smaller window-relative Y is visually higher.
        XCTAssertLessThan(oldestY, newestY, "oldest message must read at the visual top")
        XCTAssertLessThan(newestY, bottomExtraY, "newest message must remain above the bottom extra")
    }

    func testRoleScopedLayoutTopInitialAnchorShowsVisualBottomExtra() throws {
        guard #available(macOS 15.0, *) else { throw XCTSkip("initialOffset role requires macOS 15") }
        let harness = InvertedProbeHarness(rows: (0..<24).reversed().map(InvertedProbeRow.init(index:)))
        defer { harness.teardown() }
        harness.settle()

        let rect = try harness.windowRelativeRect(id: InvertedProbeHarness.bottomExtraID)
        let viewportHeight = try XCTUnwrap(harness.window.contentView).bounds.height
        XCTAssertGreaterThan(rect.maxY, viewportHeight - 30)
        XCTAssertLessThanOrEqual(rect.maxY, viewportHeight + 1)
    }

    func testDecreasingDocumentOriginMovesContentTowardVisualTopOneForOne() throws {
        let harness = InvertedProbeHarness(rows: (0..<20).reversed().map(InvertedProbeRow.init(index:)))
        defer { harness.teardown() }
        harness.settle()

        let scrollView = try XCTUnwrap(harness.scrollView)
        let clip = scrollView.contentView
        clip.scroll(to: CGPoint(x: clip.bounds.origin.x, y: clip.bounds.origin.y + 80))
        scrollView.reflectScrolledClipView(clip)
        harness.settle()

        let target = "row-12"
        let before = try harness.windowRelativeMinY(id: target)
        let scrolledOrigin = clip.bounds.origin
        clip.scroll(to: CGPoint(x: scrolledOrigin.x, y: scrolledOrigin.y - 31))
        scrollView.reflectScrolledClipView(clip)
        harness.settle()
        let after = try harness.windowRelativeMinY(id: target)

        XCTAssertEqual(after - before, -31, accuracy: 1)
    }

    func testNonScrollableCollapsedWindowAutoBackfillsOnceAndShowsLoading() throws {
        let harness = HistoryBackfillProbeHarness(rowCount: 1)
        defer { harness.teardown() }
        harness.settle()

        XCTAssertEqual(harness.model.requestCount, 1)
        XCTAssertTrue(harness.model.loading)
        XCTAssertNotNil(harness.registry.views[HistoryBackfillProbe.loadingID]?.view)

        // More frame/bounds churn while the explicit loading gate is closed
        // cannot admit a duplicate page.
        for _ in 0..<5 {
            harness.host.needsLayout = true
            harness.host.layoutSubtreeIfNeeded()
            NotificationCenter.default.post(
                name: NSView.frameDidChangeNotification,
                object: harness.scrollView?.documentView
            )
        }
        harness.settle(rounds: 10)
        XCTAssertEqual(harness.model.requestCount, 1)
    }

    func testScrollableWindowPrefetchesBeforeHardHistoryEdge() throws {
        let harness = HistoryBackfillProbeHarness(rowCount: 28)
        defer { harness.teardown() }
        harness.settle()
        XCTAssertEqual(harness.model.requestCount, 0)

        let scrollView = try XCTUnwrap(harness.scrollView)
        let clip = scrollView.contentView
        let contentHeight = try XCTUnwrap(scrollView.documentView).bounds.height
        let targetDistance: CGFloat = 240
        let targetOrigin = max(0, contentHeight - clip.bounds.height - targetDistance)
        clip.scroll(to: CGPoint(x: clip.bounds.origin.x, y: targetOrigin))
        scrollView.reflectScrolledClipView(clip)
        NotificationCenter.default.post(
            name: NSScrollView.didLiveScrollNotification,
            object: scrollView
        )
        harness.settle(rounds: 20)

        XCTAssertEqual(harness.model.requestCount, 1)
        XCTAssertGreaterThan(targetDistance, 4, "prefetch must happen before the legacy hard edge")
    }
}

private struct InvertedProbeRow: Identifiable, Equatable {
    let id: String
    let text: String
    let verticalPadding: CGFloat

    init(index: Int) {
        id = "row-\(index)"
        text = String(
            repeating: "dynamic inverted row \(index) has measured wrapping content. ",
            count: 1 + index % 4
        )
        verticalPadding = CGFloat(5 + index % 5)
    }
}

@MainActor
private final class InvertedProbeModel: ObservableObject {
    @Published var rows: [InvertedProbeRow]

    init(rows: [InvertedProbeRow]) {
        self.rows = rows
    }
}

@MainActor
private final class InvertedProbeRegistry {
    final class WeakMarker {
        weak var view: NSView?
        init(_ view: NSView) { self.view = view }
    }

    var views: [String: WeakMarker] = [:]
}

private struct InvertedProbeMarker: NSViewRepresentable {
    let id: String
    let registry: InvertedProbeRegistry

    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        registry.views[id] = .init(view)
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        registry.views[id] = .init(nsView)
    }
}

private struct InvertedTranscriptProbe: View {
    @ObservedObject var model: InvertedProbeModel
    let registry: InvertedProbeRegistry

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 9) {
                Text("bottom extra")
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(InvertedProbeMarker(
                        id: InvertedProbeHarness.bottomExtraID,
                        registry: registry
                    ))
                    .transcriptFlip()

                ForEach(model.rows) { row in
                    Text(row.text)
                        .font(.system(size: 13))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.vertical, row.verticalPadding)
                        .padding(.horizontal, 12)
                        .background(InvertedProbeMarker(id: row.id, registry: registry))
                        .transcriptFlip()
                }
            }
            .padding(12)
        }
        .transcriptFlip()
        .modifier(InvertedProbeInitialOffsetAnchor())
    }
}

private struct InvertedProbeInitialOffsetAnchor: ViewModifier {
    func body(content: Content) -> some View {
        if #available(macOS 15.0, *) {
            content.defaultScrollAnchor(.top, for: .initialOffset)
        } else {
            content
        }
    }
}

@MainActor
private final class InvertedProbeHarness {
    static let bottomExtraID = "bottom-extra"

    let model: InvertedProbeModel
    let registry = InvertedProbeRegistry()
    let host: NSHostingView<InvertedTranscriptProbe>
    let window: NSWindow

    init(rows: [InvertedProbeRow]) {
        model = InvertedProbeModel(rows: rows)
        host = NSHostingView(rootView: InvertedTranscriptProbe(model: model, registry: registry))
        host.frame = CGRect(x: 0, y: 0, width: 420, height: 280)
        window = NSWindow(
            contentRect: CGRect(x: -20_000, y: -20_000, width: 420, height: 280),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.orderFront(nil)
    }

    var scrollView: NSScrollView? { firstScrollView(in: host) }

    func settle(rounds: Int = 45) {
        for _ in 0..<rounds {
            RunLoop.main.run(until: Date().addingTimeInterval(0.004))
            host.needsLayout = true
            host.layoutSubtreeIfNeeded()
        }
    }

    func windowRelativeMinY(id: String) throws -> CGFloat {
        try windowRelativeRect(id: id).minY
    }

    func windowRelativeRect(id: String) throws -> CGRect {
        let marker = try XCTUnwrap(registry.views[id]?.view, "missing marker for \(id)")
        let content = try XCTUnwrap(window.contentView)
        return marker.convert(marker.bounds, to: content)
    }

    func partiallyVisibleMessageID() -> String? {
        guard let content = window.contentView else { return nil }
        let viewport = content.bounds
        return model.rows.lazy.compactMap { row -> String? in
            guard let marker = self.registry.views[row.id]?.view else { return nil }
            let rect = marker.convert(marker.bounds, to: content)
            let intersects = rect.maxY > viewport.minY && rect.minY < viewport.maxY
            let clipped = rect.minY < viewport.minY || rect.maxY > viewport.maxY
            return intersects && clipped ? row.id : nil
        }.first
    }

    func teardown() {
        window.orderOut(nil)
        window.close()
    }

    private func firstScrollView(in view: NSView) -> NSScrollView? {
        if let scrollView = view as? NSScrollView { return scrollView }
        for subview in view.subviews {
            if let found = firstScrollView(in: subview) { return found }
        }
        return nil
    }
}

@MainActor
private final class HistoryBackfillProbeModel: ObservableObject {
    @Published var loading = false
    @Published var pinned = true
    @Published var requestCount = 0
    let rows: [InvertedProbeRow]

    init(rowCount: Int) {
        rows = (0..<rowCount).reversed().map(InvertedProbeRow.init(index:))
    }

    func requestPage() -> Bool {
        guard !loading else { return false }
        loading = true
        requestCount += 1
        return true
    }
}

private struct HistoryBackfillProbe: View {
    static let loadingID = "history-loading"

    @ObservedObject var model: HistoryBackfillProbeModel
    let registry: InvertedProbeRegistry

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 9) {
                Text("bottom")
                    .transcriptFlip()

                ForEach(model.rows) { row in
                    Text(row.text)
                        .font(.system(size: 13))
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.vertical, row.verticalPadding)
                        .transcriptFlip()
                }

                if model.loading {
                    HStack {
                        ProgressView().controlSize(.small)
                        Text("正在加载更早消息…")
                    }
                    .background(InvertedProbeMarker(id: Self.loadingID, registry: registry))
                    .transcriptFlip()
                }
            }
            .frame(maxWidth: .infinity, minHeight: 260, alignment: .bottomLeading)
            .overlay(alignment: .bottom) {
                StickToBottomTracker(
                    isPinned: $model.pinned,
                    pinEdge: .documentStart,
                    topLoadingEnabled: !model.loading,
                    onReachedTop: model.requestPage
                )
            }
            .padding(10)
        }
        .transcriptFlip()
    }
}

@MainActor
private final class HistoryBackfillProbeHarness {
    let model: HistoryBackfillProbeModel
    let registry = InvertedProbeRegistry()
    let host: NSHostingView<HistoryBackfillProbe>
    let window: NSWindow

    init(rowCount: Int) {
        model = HistoryBackfillProbeModel(rowCount: rowCount)
        host = NSHostingView(rootView: HistoryBackfillProbe(model: model, registry: registry))
        host.frame = CGRect(x: 0, y: 0, width: 420, height: 280)
        window = NSWindow(
            contentRect: CGRect(x: -20_000, y: -20_000, width: 420, height: 280),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.orderFront(nil)
    }

    var scrollView: NSScrollView? { firstScrollView(in: host) }

    func settle(rounds: Int = 45) {
        for _ in 0..<rounds {
            RunLoop.main.run(until: Date().addingTimeInterval(0.004))
            host.needsLayout = true
            host.layoutSubtreeIfNeeded()
        }
    }

    func teardown() {
        window.orderOut(nil)
        window.close()
    }

    private func firstScrollView(in view: NSView) -> NSScrollView? {
        if let scrollView = view as? NSScrollView { return scrollView }
        for subview in view.subviews {
            if let found = firstScrollView(in: subview) { return found }
        }
        return nil
    }
}
