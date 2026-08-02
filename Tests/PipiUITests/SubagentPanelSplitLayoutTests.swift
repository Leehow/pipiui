import XCTest
@testable import PipiUI

final class SubagentPanelSplitLayoutTests: XCTestCase {
    func testPreferredRatioProducesComplementaryPaneHeights() {
        let sizing = SubagentPanelSplitSizing.resolve(
            containerHeight: 406,
            ratio: 0.45
        )

        XCTAssertEqual(sizing.availableHeight, 400, accuracy: 0.001)
        XCTAssertEqual(sizing.listHeight, 180, accuracy: 0.001)
        XCTAssertEqual(sizing.detailHeight, 220, accuracy: 0.001)
        XCTAssertEqual(
            sizing.listHeight + SubagentPanelSplitSizing.dividerHeight + sizing.detailHeight,
            406,
            accuracy: 0.001
        )
    }

    func testSizingClampsBothPaneMinimumsWhenSpaceAllows() {
        let listMinimum = SubagentPanelSplitSizing.resolve(
            containerHeight: 406,
            ratio: 0
        )
        XCTAssertEqual(
            listMinimum.listHeight,
            SubagentPanelSplitSizing.minimumListHeight,
            accuracy: 0.001
        )
        XCTAssertGreaterThanOrEqual(
            listMinimum.detailHeight,
            SubagentPanelSplitSizing.minimumDetailHeight
        )

        let detailMinimum = SubagentPanelSplitSizing.resolve(
            containerHeight: 406,
            ratio: 1
        )
        XCTAssertEqual(
            detailMinimum.detailHeight,
            SubagentPanelSplitSizing.minimumDetailHeight,
            accuracy: 0.001
        )
        XCTAssertGreaterThanOrEqual(
            detailMinimum.listHeight,
            SubagentPanelSplitSizing.minimumListHeight
        )
    }

    func testDragClampsAtPaneMinimumsAndReturnsPersistableRatio() {
        let upperClamp = SubagentPanelSplitSizing.draggedRatio(
            startRatio: 0.45,
            translation: 1_000,
            containerHeight: 406
        )
        let upperSizing = SubagentPanelSplitSizing.resolve(
            containerHeight: 406,
            ratio: upperClamp
        )
        XCTAssertEqual(
            upperSizing.detailHeight,
            SubagentPanelSplitSizing.minimumDetailHeight,
            accuracy: 0.001
        )

        let lowerClamp = SubagentPanelSplitSizing.draggedRatio(
            startRatio: 0.45,
            translation: -1_000,
            containerHeight: 406
        )
        let lowerSizing = SubagentPanelSplitSizing.resolve(
            containerHeight: 406,
            ratio: lowerClamp
        )
        XCTAssertEqual(
            lowerSizing.listHeight,
            SubagentPanelSplitSizing.minimumListHeight,
            accuracy: 0.001
        )
    }

    func testCompactHeightNeverProducesNegativeOrOverflowingPanes() {
        let sizing = SubagentPanelSplitSizing.resolve(
            containerHeight: 46,
            ratio: 0.45
        )

        XCTAssertGreaterThanOrEqual(sizing.listHeight, 0)
        XCTAssertGreaterThanOrEqual(sizing.detailHeight, 0)
        XCTAssertEqual(
            sizing.listHeight + SubagentPanelSplitSizing.dividerHeight + sizing.detailHeight,
            46,
            accuracy: 0.001
        )
    }

    func testPanelBodyUsesStableSplitWithoutGeometryReaderFrameFeedback() throws {
        let repositoryRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let sourceURL = repositoryRoot
            .appendingPathComponent("Sources/PipiUI/Views/SubagentPanel.swift")
        let source = try String(contentsOf: sourceURL, encoding: .utf8)

        let bodyStart = try XCTUnwrap(source.range(of: "var body: some View"))
        let marker = try XCTUnwrap(source.range(of: "// MARK: -", range: bodyStart.upperBound..<source.endIndex))
        let panelBody = String(source[bodyStart.lowerBound..<marker.lowerBound])

        XCTAssertTrue(panelBody.contains("StableSubagentSplitView("))
        XCTAssertFalse(panelBody.contains("GeometryReader"))
        XCTAssertFalse(panelBody.contains("geo.size.height"))
        XCTAssertFalse(panelBody.contains(".frame(height: listHeight)"))
    }
}
