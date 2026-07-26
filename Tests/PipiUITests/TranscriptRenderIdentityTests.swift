import XCTest
@testable import PipiUI

final class TranscriptRenderIdentityTests: XCTestCase {
    func testSameLocalItemIDIsDifferentAcrossSessions() {
        let first = TranscriptRenderIdentity.scoped(sessionKey: "session-a", localID: "item-1")
        let second = TranscriptRenderIdentity.scoped(sessionKey: "session-b", localID: "item-1")

        XCTAssertNotEqual(first, second)
    }

    func testRowAndAnchorIDsCannotAliasWithinOneSession() {
        let row = TranscriptRenderIdentity.scoped(sessionKey: "session-a", localID: "item-1")
        let bottom = TranscriptRenderIdentity.scoped(sessionKey: "session-a", localID: "bottom")
        let streaming = TranscriptRenderIdentity.scoped(sessionKey: "session-a", localID: "streaming")

        XCTAssertEqual(Set([row, bottom, streaming]).count, 3)
    }
}
