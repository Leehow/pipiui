import XCTest
@testable import PipiUI

final class ChatTypographyTests: XCTestCase {
    func testDefaultMakeUses15() {
        let t = ChatTypography.make(fontSize: ChatTypography.defaultFontSize)
        XCTAssertEqual(t.fontSize, 15)
        // CJK-friendly ~1.75× line-height: natural ~1.2× + 0.55× extra.
        XCTAssertEqual(t.lineSpacing, 15 * 0.55, accuracy: 0.001)
        XCTAssertEqual(t.paragraphSpacing, 6, accuracy: 0.001)
        XCTAssertEqual(t.listItemSpacing, 5, accuracy: 0.001)
        XCTAssertEqual(t.headingLineSpacing, 15 * 0.15, accuracy: 0.001)
        XCTAssertEqual(t.messageSpacing, 22, accuracy: 0.001)
        XCTAssertEqual(t.blockSpacing, 15, accuracy: 0.001)
    }

    func testSanitizedFontSizeClampsAndRounds() {
        XCTAssertEqual(ChatTypography.sanitizedFontSize(11), 12)
        XCTAssertEqual(ChatTypography.sanitizedFontSize(23), 22)
        XCTAssertEqual(ChatTypography.sanitizedFontSize(15.4), 15)
        XCTAssertEqual(ChatTypography.sanitizedFontSize(15.6), 16)
        XCTAssertEqual(ChatTypography.sanitizedFontSize(.nan), ChatTypography.defaultFontSize)
        XCTAssertEqual(ChatTypography.sanitizedFontSize(0), ChatTypography.defaultFontSize)
    }

    func testMessageSpacingClamped() {
        XCTAssertEqual(ChatTypography.make(fontSize: 12).messageSpacing, 16, accuracy: 0.001)
        XCTAssertEqual(ChatTypography.make(fontSize: 22).messageSpacing, 28, accuracy: 0.001)
    }

    func testBlockSpacingFloor() {
        // fontSize 12 → round(12)=12 → max(12,12)=12
        XCTAssertEqual(ChatTypography.make(fontSize: 12).blockSpacing, 12, accuracy: 0.001)
    }

    func testParagraphAndListSpacingScale() {
        let t = ChatTypography.make(fontSize: 20)
        XCTAssertEqual(t.paragraphSpacing, 8, accuracy: 0.001) // max(6, round(8))
        XCTAssertEqual(t.listItemSpacing, 6, accuracy: 0.001) // max(4, round(6))
    }
}
