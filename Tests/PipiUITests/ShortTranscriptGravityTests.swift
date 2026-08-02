import Foundation
import XCTest
@testable import PipiUI

/// Regression contract for the pinned short-transcript layout gravity.
///
/// Root cause of the fold/unfold jump: a short transcript had no layout-level
/// bottom alignment, so `StickToBottomTracker` could not express "glued to the
/// bottom" (no clip offset exists when contentHeight <= viewport) and the
/// natural top-anchored layout grabbed gravity after a height change. The fix
/// gates a viewport min-height + top flexible space on the pin state inside
/// `ChatDetailView`.
final class ShortTranscriptGravityTests: XCTestCase {
    private var repositoryRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    // MARK: - Layout contract (pure logic)

    func testPinnedSessionWithMeasuredViewportGetsLayoutGravity() {
        XCTAssertEqual(
            ShortTranscriptGravity.viewportMinHeight(pinned: true, viewportHeight: 720),
            720
        )
        XCTAssertTrue(
            ShortTranscriptGravity.usesTopFlexibleSpace(pinned: true, viewportHeight: 720)
        )
    }

    func testUnpinnedSessionKeepsNaturalTopLayout() {
        // User scrolled away: gravity must never force content to the bottom.
        XCTAssertNil(ShortTranscriptGravity.viewportMinHeight(pinned: false, viewportHeight: 720))
        XCTAssertFalse(
            ShortTranscriptGravity.usesTopFlexibleSpace(pinned: false, viewportHeight: 720)
        )
        XCTAssertNil(ShortTranscriptGravity.viewportMinHeight(pinned: false, viewportHeight: nil))
        XCTAssertFalse(
            ShortTranscriptGravity.usesTopFlexibleSpace(pinned: false, viewportHeight: nil)
        )
    }

    func testGravityRequiresARealViewportMeasurement() {
        // The viewport height is measured at the scroll-container level; until a
        // real measurement lands (or when it is invalid), fall back to natural
        // layout instead of trusting an unstable proposal.
        let invalidViewports: [CGFloat] = [0, -1, .nan, .infinity, -CGFloat.infinity]
        for invalid in invalidViewports {
            XCTAssertNil(
                ShortTranscriptGravity.viewportMinHeight(pinned: true, viewportHeight: invalid),
                "viewport=\(invalid)"
            )
            XCTAssertFalse(
                ShortTranscriptGravity.usesTopFlexibleSpace(pinned: true, viewportHeight: invalid),
                "viewport=\(invalid)"
            )
        }
        XCTAssertNil(ShortTranscriptGravity.viewportMinHeight(pinned: true, viewportHeight: nil))
        XCTAssertFalse(
            ShortTranscriptGravity.usesTopFlexibleSpace(pinned: true, viewportHeight: nil)
        )
    }

    func testTopFlexibleSpaceAlwaysMatchesMinHeight() {
        // The spacer and the min-height must never diverge: one without the other
        // would either leave rows at the document top or stranded mid-document,
        // reintroducing the fold/unfold top↔bottom jump.
        let viewports: [CGFloat?] = [nil, 0, 1, 2, 320, 700, 1_080, .nan, -5]
        for pinned in [false, true] {
            for viewport in viewports {
                let minHeight = ShortTranscriptGravity.viewportMinHeight(
                    pinned: pinned,
                    viewportHeight: viewport
                )
                XCTAssertEqual(
                    minHeight != nil,
                    ShortTranscriptGravity.usesTopFlexibleSpace(
                        pinned: pinned,
                        viewportHeight: viewport
                    ),
                    "pinned=\(pinned) viewport=\(String(describing: viewport))"
                )
                if let minHeight {
                    XCTAssertEqual(minHeight, viewport)
                }
            }
        }
    }

    // MARK: - Fold/unfold regression

    func testFoldShrinkKeepsPinnedShortContentGluedToBottom() {
        // Folding a user turn / Thinking block shrinks the rendered content far
        // below the viewport. While pinned, the transcript keeps the viewport
        // min-height, so the document height stays at the viewport height: there
        // is zero clip travel for the `.top` scroll anchor to steal, which is the
        // exact failure mode being fixed (content bouncing to the viewport top).
        let viewport: CGFloat = 700
        let foldedContent: CGFloat = 260
        let minHeight = ShortTranscriptGravity.viewportMinHeight(
            pinned: true,
            viewportHeight: viewport
        )
        let documentHeight = max(foldedContent, minHeight ?? 0)
        XCTAssertEqual(documentHeight, viewport)
        // Bottom gravity holds with no possible offset: pinnedOriginY clamps to 0.
        XCTAssertEqual(
            StickToBottomLogic.pinnedOriginY(
                contentHeight: documentHeight,
                visibleHeight: viewport,
                documentIsFlipped: true,
                pinEdge: .documentEnd
            ),
            0
        )
    }

    func testUnfoldGrowthKeepsPinnedShortContentBottomAligned() {
        // Expanding a folded turn grows content that is still shorter than the
        // viewport: the document must stay at the viewport height (no jump).
        let viewport: CGFloat = 700
        let expandedStillShort: CGFloat = 640
        let documentHeight = max(
            expandedStillShort,
            ShortTranscriptGravity.viewportMinHeight(pinned: true, viewportHeight: viewport) ?? 0
        )
        XCTAssertEqual(documentHeight, viewport)
    }

    func testGravityIsANoOpForLongTranscripts() {
        // Long transcripts: the min-height must not inflate the document — the
        // existing StickToBottomTracker clip-follow owns the pin edge.
        let viewport: CGFloat = 700
        let longContent: CGFloat = 2_000
        let documentHeight = max(
            longContent,
            ShortTranscriptGravity.viewportMinHeight(pinned: true, viewportHeight: viewport) ?? 0
        )
        XCTAssertEqual(documentHeight, longContent)
    }

    // MARK: - Source wiring contract

    func testGravityIsMeasuredAtScrollContainerAndGatedOnPin() throws {
        let source = try chatDetailSource()

        // Viewport is measured at the scroll-container level (parent-driven
        // frame), then passed explicitly into the rows — never derived from an
        // unstable in-content GeometryReader proposal.
        XCTAssertTrue(source.contains("TranscriptViewportHeightKey"))
        XCTAssertTrue(source.contains("viewportHeight: transcriptViewportHeight"))
        XCTAssertTrue(source.contains("let viewportHeight: CGFloat"))

        // The rows gate the top flexible space on the pin state via the shared
        // contract, and only that gate may introduce the spacer.
        let rowsStart = try XCTUnwrap(
            source.range(of: "private struct StreamingTranscriptRows: View")?.lowerBound
        )
        let rowsEnd = try XCTUnwrap(
            source.range(
                of: "private struct TranscriptLoadingOverlay: View",
                range: rowsStart..<source.endIndex
            )?.lowerBound
        )
        let rows = String(source[rowsStart..<rowsEnd])
        XCTAssertTrue(rows.contains("ShortTranscriptGravity.usesTopFlexibleSpace"))
        XCTAssertTrue(rows.contains("Spacer(minLength: 0)"))
        XCTAssertTrue(rows.contains("session.pinTranscriptToBottom"))

        // The container applies the viewport min-height with bottom-leading
        // alignment, keeping the pinned bottom gravity at layout level.
        let contentStart = try XCTUnwrap(
            source.range(of: "private var transcriptContent: some View")?.lowerBound
        )
        let contentEnd = try XCTUnwrap(
            source.range(
                of: "private func scheduleChatColumnWidthSettleRepin",
                range: contentStart..<source.endIndex
            )?.lowerBound
        )
        let content = String(source[contentStart..<contentEnd])
        XCTAssertTrue(content.contains("ShortTranscriptGravity.viewportMinHeight"))
        XCTAssertTrue(content.contains("alignment: .bottomLeading"))
        XCTAssertTrue(content.contains("GeometryReader"))
        XCTAssertTrue(content.contains(".onPreferenceChange(TranscriptViewportHeightKey.self)"))

        // Unrelated scroll-identity guarantees stay intact: no id-based anchor,
        // the explicit bottom jump, and the per-session scroll root must not be
        // weakened by the gravity change. The unconditional default bottom
        // anchor is gone — bottom pinning is owned by the explicit
        // `scrollTo("bottom")` + StickToBottomTracker, so it cannot fight the
        // user while browsing history (scroll-oscillation fix). Only the
        // macOS 15+ role-scoped *initial-offset* anchor is allowed.
        XCTAssertFalse(content.contains(".scrollPosition(id:"))
        XCTAssertFalse(content.contains("scrollTopID"))
        XCTAssertFalse(content.contains(".defaultScrollAnchor(.bottom)"))
        XCTAssertTrue(source.contains(".defaultScrollAnchor(.bottom, for: .initialOffset)"))
        XCTAssertTrue(source.contains("scrollTo(transcriptID(\"bottom\"), anchor: .bottom)"))
        XCTAssertTrue(content.contains(".id(TranscriptSessionRootIdentity(sessionKey: session.bridgeRoutingKey))"))
    }

    private func chatDetailSource() throws -> String {
        try String(
            contentsOf: repositoryRoot
                .appendingPathComponent("Sources/PipiUI/Views/ChatDetailView.swift"),
            encoding: .utf8
        )
    }
}
