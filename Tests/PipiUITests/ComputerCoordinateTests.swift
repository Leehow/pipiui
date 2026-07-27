import XCTest
import CoreGraphics
@testable import PipiUI

final class ComputerCoordinateTests: XCTestCase {
    func testMapsImagePixelsIntoOffsetGlobalDisplayBounds() throws {
        let point = try ComputerCoordinateMap.globalPoint(
            imagePoint: .init(x: 720, y: 450),
            imageSize: .init(width: 1440, height: 900),
            displayBounds: CGRect(x: -1920, y: 0, width: 1920, height: 1200)
        )
        XCTAssertEqual(point.x, -960, accuracy: 0.001)
        XCTAssertEqual(point.y, 600, accuracy: 0.001)
    }

    func testRejectsNegativeAndRightBottomExclusiveCoordinates() {
        let size = ComputerImageSize(width: 100, height: 50)
        let bounds = CGRect(x: 0, y: 0, width: 200, height: 100)
        XCTAssertThrowsError(try ComputerCoordinateMap.globalPoint(
            imagePoint: .init(x: -1, y: 0),
            imageSize: size,
            displayBounds: bounds
        ))
        XCTAssertThrowsError(try ComputerCoordinateMap.globalPoint(
            imagePoint: .init(x: 100, y: 49),
            imageSize: size,
            displayBounds: bounds
        ))
        XCTAssertThrowsError(try ComputerCoordinateMap.globalPoint(
            imagePoint: .init(x: 99, y: 50),
            imageSize: size,
            displayBounds: bounds
        ))
    }

    func testClampPolicyClampsBeforeMapping() throws {
        let point = try ComputerCoordinateMap.globalPoint(
            imagePoint: .init(x: 500, y: -20),
            imageSize: .init(width: 100, height: 50),
            displayBounds: CGRect(x: 10, y: 20, width: 200, height: 100),
            policy: .clamp
        )
        XCTAssertEqual(point.x, 208, accuracy: 0.001)
        XCTAssertEqual(point.y, 20, accuracy: 0.001)
    }
}
