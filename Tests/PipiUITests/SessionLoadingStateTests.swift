import XCTest
@testable import PipiUI

/// The "正在启动会话…" placeholder is gated on `isInitializing`. If that flag ever
/// stuck at true the pane would spin forever, so pin the terminal transitions.
final class SessionLoadingStateTests: XCTestCase {
    /// A session blocked before spawn (e.g. extension name clash) has nothing to
    /// wait for — it must not show the spinner, only its fixable error.
    func testBlockedSessionIsNotInitializing() {
        let session = ChatSession(
            id: "blocked-1",
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "扩展撞名"
        )
        XCTAssertFalse(session.isInitializing)
        XCTAssertFalse(session.processAlive)
        XCTAssertEqual(session.lastError, "扩展撞名")
    }
}
