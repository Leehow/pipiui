import XCTest
@testable import PipiUI

/// T17: `~/.pi/agent/.env` keys are injected into spawned pi subprocess env,
/// always layered UNDER the internal `PIPIUI_*` keys.
final class SpawnEnvMergeTests: XCTestCase {

    func testDotEnvKeysAreInjected() {
        let merged = ChatSession.mergedSpawnEnv(
            dotEnv: ["TEST_KEY": "xxx", "OPENAI_API_KEY": "sk-test"],
            internal: [:]
        )
        XCTAssertEqual(merged["TEST_KEY"], "xxx")
        XCTAssertEqual(merged["OPENAI_API_KEY"], "sk-test")
    }

    func testInternalKeysOverrideDotEnv() {
        let merged = ChatSession.mergedSpawnEnv(
            dotEnv: ["PIPIUI_BRIDGE_PORT": "9999", "TEST_KEY": "xxx"],
            internal: ["PIPIUI_BRIDGE_PORT": "1234"]
        )
        XCTAssertEqual(merged["PIPIUI_BRIDGE_PORT"], "1234")
        XCTAssertEqual(merged["TEST_KEY"], "xxx")
    }

    func testEmptyDotEnvKeepsInternal() {
        let merged = ChatSession.mergedSpawnEnv(
            dotEnv: [:],
            internal: ["PIPIUI_SESSION_KEY": "abc"]
        )
        XCTAssertEqual(merged, ["PIPIUI_SESSION_KEY": "abc"])
    }
}
