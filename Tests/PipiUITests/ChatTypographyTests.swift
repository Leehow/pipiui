import XCTest
@testable import PipiUI

final class ChatTypographyTests: XCTestCase {
    func testDefaultMakeUses15() {
        let t = ChatTypography.make(fontSize: ChatTypography.defaultFontSize)
        XCTAssertEqual(t.fontSize, 15)
        XCTAssertEqual(t.lineSpacing, 15 * 0.3, accuracy: 0.001)
        XCTAssertEqual(t.messageSpacing, 22, accuracy: 0.001)
        XCTAssertEqual(t.blockSpacing, 10, accuracy: 0.001)
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
        // fontSize 12 → round(7.8)=8 → max(8,8)=8
        XCTAssertEqual(ChatTypography.make(fontSize: 12).blockSpacing, 8, accuracy: 0.001)
    }
}
