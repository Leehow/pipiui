import AppKit
import XCTest
@testable import PipiUI

final class PathLinkLayoutTests: XCTestCase {

    func testPathTargetAtCharacterIndex() {
        let text = "see /Users/alice/a.txt end"
        let targets = FileReveal.pathTargets(in: text)
        XCTAssertEqual(targets.count, 1)
        let path = targets[0]

        // Before path
        XCTAssertNil(PathLinkHitTest.pathTarget(atCharacterIndex: 0, targets: targets))
        // Inside path
        XCTAssertEqual(
            PathLinkHitTest.pathTarget(atCharacterIndex: path.range.location, targets: targets)?.path,
            "/Users/alice/a.txt"
        )
        XCTAssertEqual(
            PathLinkHitTest.pathTarget(
                atCharacterIndex: path.range.location + path.range.length / 2,
                targets: targets
            )?.path,
            "/Users/alice/a.txt"
        )
        // Just after path
        XCTAssertNil(
            PathLinkHitTest.pathTarget(
                atCharacterIndex: path.range.location + path.range.length,
                targets: targets
            )
        )
        // Negative
        XCTAssertNil(PathLinkHitTest.pathTarget(atCharacterIndex: -1, targets: targets))
    }

    func testCharacterIndexMapsIntoPathRange() {
        let text = "prefix /Users/alice/proj/file.swift suffix"
        let targets = FileReveal.pathTargets(in: text)
        XCTAssertEqual(targets.count, 1)
        let path = targets[0]
        let font = NSFont.systemFont(ofSize: 13)

        // Lay out at a comfortable width so the line stays single-line.
        let size = CGSize(width: 800, height: 40)
        let storage = NSTextStorage(attributedString: NSAttributedString(
            string: text,
            attributes: [.font: font]
        ))
        let lm = NSLayoutManager()
        let container = NSTextContainer(size: size)
        container.lineFragmentPadding = 0
        lm.addTextContainer(container)
        storage.addLayoutManager(lm)
        lm.ensureLayout(for: container)

        // Glyph rect for a character mid-path → point should resolve to that index.
        let midChar = path.range.location + min(5, max(0, path.range.length - 1))
        let glyphRange = lm.glyphRange(
            forCharacterRange: NSRange(location: midChar, length: 1),
            actualCharacterRange: nil
        )
        let rect = lm.boundingRect(forGlyphRange: glyphRange, in: container)
        let point = CGPoint(x: rect.midX, y: rect.midY)

        let index = PathLinkHitTest.characterIndex(
            at: point,
            text: text,
            size: size,
            font: font
        )
        XCTAssertNotNil(index)
        if let index {
            XCTAssertTrue(
                NSLocationInRange(index, path.range),
                "index \(index) not in path range \(path.range)"
            )
            XCTAssertEqual(
                PathLinkHitTest.pathURL(
                    at: point,
                    text: text,
                    targets: targets,
                    size: size,
                    font: font
                )?.path,
                "/Users/alice/proj/file.swift"
            )
        }
    }

    func testCharacterIndexNilOutsideGlyphs() {
        let text = "hi /Users/bob/x"
        let font = NSFont.systemFont(ofSize: 13)
        let size = CGSize(width: 400, height: 30)
        // Far below the line
        let index = PathLinkHitTest.characterIndex(
            at: CGPoint(x: 10, y: 200),
            text: text,
            size: size,
            font: font
        )
        XCTAssertNil(index)
    }

    func testEmptyTextNoIndex() {
        XCTAssertNil(
            PathLinkHitTest.characterIndex(
                at: CGPoint(x: 5, y: 5),
                text: "",
                size: CGSize(width: 100, height: 20),
                font: .systemFont(ofSize: 13)
            )
        )
    }
}
