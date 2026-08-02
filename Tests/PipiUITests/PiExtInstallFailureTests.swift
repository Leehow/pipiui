import XCTest
@testable import PipiUI

/// A failed PiExt install used to be indistinguishable from a clean one.
///
/// One `chflags uchg` on `pi-ext/subagent/index.ts` was enough: the remove failed, the copy
/// then failed because the destination still existed, and both were swallowed. Sessions kept
/// working — the bundle fallbacks carried them, so they ran current code the whole time — which
/// is exactly why it lasted six days. What was left behind was a stale tree under Application
/// Support that reads like the live one, and a fingerprint marker claiming a clean install.
///
/// `installAll` reaches Application Support directly, so the invariants are pinned in source
/// the way this package pins the PiExt contracts.
final class PiExtInstallFailureTests: XCTestCase {
    private func pluginSource() throws -> String {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        return try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PiPlugin.swift"),
            encoding: .utf8
        )
    }

    func testInstallFailureIsRecordedRatherThanSwallowed() throws {
        let s = try pluginSource()
        XCTAssertTrue(s.contains("var piExtFailure: String?"))
        // The remove is no longer `try?`: an undeletable file there is the whole failure mode.
        XCTAssertFalse(s.contains("try? fm.removeItem(at: dest)"),
                       "a swallowed remove is what hid the locked file")
        XCTAssertTrue(s.contains("} catch CocoaError.fileNoSuchFile {"),
                      "a first install has nothing to remove and must not report a failure")
        XCTAssertTrue(s.contains("check `ls -lO` for a uchg flag"))
        XCTAssertTrue(s.contains("is now stale and must not be read as what sessions run"))
        XCTAssertTrue(s.contains("A fallback that quietly becomes the permanent path is not a fallback."))
    }

    /// The marker means "this fingerprint is installed". Writing it after a failed copy is what
    /// turned one error into a permanent one; removing it makes the next launch retry.
    func testFingerprintIsNotPersistedAfterAFailedInstall() throws {
        let s = try pluginSource()
        XCTAssertTrue(s.contains("if result.piExtFailure == nil {"))
        XCTAssertTrue(s.contains("try? fm.removeItem(at: markerURL)"))
        let marker = "try? fingerprint.write(to: markerURL, atomically: true, encoding: .utf8)"
        XCTAssertEqual(s.components(separatedBy: marker).count - 1, 1,
                       "the marker must be written on exactly one path, the success path")
    }
}
