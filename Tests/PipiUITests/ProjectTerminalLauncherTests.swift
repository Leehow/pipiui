import XCTest
@testable import PipiUI

final class ProjectTerminalLauncherTests: XCTestCase {

    func testOpenSeamAndMissingDirectory() {
        var opened: [URL] = []
        let original = ProjectTerminalLauncher.openHandler
        ProjectTerminalLauncher.openHandler = { opened.append($0) }
        defer { ProjectTerminalLauncher.openHandler = original }

        let directory = FileManager.default.temporaryDirectory
        XCTAssertTrue(ProjectTerminalLauncher.open(at: directory))
        XCTAssertEqual(opened, [directory])

        let missing = directory.appendingPathComponent("definitely-not-here-\(UUID().uuidString)")
        XCTAssertFalse(ProjectTerminalLauncher.open(at: missing))
        XCTAssertEqual(opened.count, 1)
    }
}
