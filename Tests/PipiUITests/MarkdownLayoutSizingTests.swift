import AppKit
import XCTest
@testable import PipiUI

final class MarkdownLayoutSizingTests: XCTestCase {
    func testNormalizesWidthAtOneX() {
        XCTAssertEqual(
            MarkdownLayoutSizing.normalizedWidth(
                640.99,
                backingScale: 1
            ),
            640
        )
    }

    func testNormalizesWidthAtTwoX() {
        XCTAssertEqual(
            MarkdownLayoutSizing.normalizedWidth(
                640.74,
                backingScale: 2
            ),
            640.5
        )
    }

    func testNormalizesWidthAtThreeX() {
        XCTAssertEqual(
            MarkdownLayoutSizing.normalizedWidth(
                640.4,
                backingScale: 3
            ),
            640 + 1.0 / 3.0,
            accuracy: 0.000_001
        )
    }

    func testScaleTransitionUpdatesToDifferentNormalizedGrid() {
        let container = NSTextContainer()

        XCTAssertTrue(MarkdownLayoutSizing.updateContainerIfNeeded(
            container,
            proposedWidth: 640.4,
            backingScale: 2
        ))
        XCTAssertEqual(container.containerSize.width, 640)

        XCTAssertTrue(MarkdownLayoutSizing.updateContainerIfNeeded(
            container,
            proposedWidth: 640.4,
            backingScale: 3
        ))
        XCTAssertEqual(
            container.containerSize.width,
            640 + 1.0 / 3.0,
            accuracy: 0.000_001
        )
    }

    func testOneBackingPixelWidthChangeAtThreeXIsNotIgnored() {
        let container = NSTextContainer()

        XCTAssertTrue(MarkdownLayoutSizing.updateContainerIfNeeded(
            container,
            proposedWidth: 640,
            backingScale: 3
        ))
        XCTAssertTrue(MarkdownLayoutSizing.updateContainerIfNeeded(
            container,
            proposedWidth: 640.34,
            backingScale: 3
        ))
        XCTAssertEqual(
            container.containerSize.width,
            640 + 1.0 / 3.0,
            accuracy: 0.000_001
        )
    }

    func testSubpixelJitterOnSameThreeXGridDoesNotUpdate() {
        let container = NSTextContainer()

        XCTAssertTrue(MarkdownLayoutSizing.updateContainerIfNeeded(
            container,
            proposedWidth: 640.34,
            backingScale: 3
        ))
        XCTAssertFalse(MarkdownLayoutSizing.updateContainerIfNeeded(
            container,
            proposedWidth: 640.65,
            backingScale: 3
        ))
    }

    func testRepeatedSameNormalizedTargetDoesNotMutateContainer() {
        let container = NSTextContainer()

        XCTAssertTrue(MarkdownLayoutSizing.updateContainerIfNeeded(
            container,
            proposedWidth: 639.99,
            backingScale: 2
        ))
        let target = container.containerSize

        for _ in 0..<100 {
            XCTAssertFalse(MarkdownLayoutSizing.updateContainerIfNeeded(
                container,
                proposedWidth: 639.91,
                backingScale: 2
            ))
            XCTAssertEqual(container.containerSize, target)
        }
    }

    func testAcceptanceSizedMarkdownKeepsUsedRectStable() {
        var lines = Array(
            repeating: "- 北京 " + String(repeating: "x", count: 40),
            count: 136
        )
        lines[0] += "xxxxxx"
        let source = lines.joined(separator: "\n")
        let attributed = MarkdownSelectionContent.attributedString(
            for: source
        )
        let storage = NSTextStorage(attributedString: attributed)
        let manager = NSLayoutManager()
        let container = NSTextContainer()
        container.widthTracksTextView = false
        storage.addLayoutManager(manager)
        manager.addTextContainer(container)

        XCTAssertEqual(source.utf8.count, 6_805)
        XCTAssertEqual(lines.count, 136)
        XCTAssertTrue(MarkdownLayoutSizing.updateContainerIfNeeded(
            container,
            proposedWidth: 640,
            backingScale: 2
        ))
        manager.ensureLayout(for: container)
        let first = manager.usedRect(for: container)

        for _ in 0..<100 {
            XCTAssertFalse(MarkdownLayoutSizing.updateContainerIfNeeded(
                container,
                proposedWidth: 640.24,
                backingScale: 2
            ))
            manager.ensureLayout(for: container)
            XCTAssertEqual(manager.usedRect(for: container), first)
        }
        XCTAssertTrue(first.height.isFinite)
        XCTAssertGreaterThan(first.height, 0)
    }
}
