import XCTest
@testable import PipiUI

final class UpdateCenterSheetLayoutTests: XCTestCase {
    func testUpdateCenterSheetKeepsCardsScrollableAndSupportsOutsideDismissal() throws {
        let source = try updateCenterSheetSource()

        XCTAssertTrue(source.contains("ScrollView {"))
        XCTAssertTrue(source.contains(".frame(idealHeight: 380, maxHeight: 460)"))
        XCTAssertFalse(source.contains(".frame(width: 460, height: 360)"))
        XCTAssertTrue(
            source.contains(".dismissOnOutsideClick { store.isUpdateCenterPresented = false }"),
            "Clicking the parent overlay must close Update Center."
        )
    }

    private func updateCenterSheetSource() throws -> String {
        let repositoryRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        return try String(
            contentsOf: repositoryRoot
                .appendingPathComponent("Sources/PipiUI/Views/UpdateCenterSheet.swift"),
            encoding: .utf8
        )
    }
}
