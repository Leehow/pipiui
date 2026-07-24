import AppKit
import XCTest
@testable import PipiUI

final class ImageDecodeCacheTests: XCTestCase {

    override func setUp() {
        super.setUp()
        ImageDecodeCache.shared.removeAllObjects()
    }

    func testHitReturnsSameInstance() {
        let data = Self.makePNG(red: 1, green: 0, blue: 0)
        let first = ImageDecodeCache.shared.image(for: data)
        let second = ImageDecodeCache.shared.image(for: data)
        XCTAssertNotNil(first)
        XCTAssertNotNil(second)
        XCTAssertTrue(first === second, "cache hit should return the same NSImage instance")
    }

    func testDifferentDataDoesNotCollide() {
        let red = Self.makePNG(red: 1, green: 0, blue: 0)
        let blue = Self.makePNG(red: 0, green: 0, blue: 1)
        XCTAssertNotEqual(red, blue)

        let redImage = ImageDecodeCache.shared.image(for: red)
        let blueImage = ImageDecodeCache.shared.image(for: blue)
        XCTAssertNotNil(redImage)
        XCTAssertNotNil(blueImage)
        XCTAssertFalse(redImage === blueImage, "distinct PNG payloads must not share a cache entry")
    }

    func testEmptyDataReturnsNil() {
        let result = ImageDecodeCache.shared.image(for: Data())
        XCTAssertNil(result)
    }

    // MARK: - Helpers

    /// Minimal solid-color PNG via AppKit (two different colors ⇒ two different byte sequences).
    private static func makePNG(red: CGFloat, green: CGFloat, blue: CGFloat) -> Data {
        let size = NSSize(width: 4, height: 4)
        let image = NSImage(size: size)
        image.lockFocus()
        NSColor(calibratedRed: red, green: green, blue: blue, alpha: 1).setFill()
        NSBezierPath(rect: NSRect(origin: .zero, size: size)).fill()
        image.unlockFocus()
        guard let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:])
        else {
            return Data([0x89, 0x50, 0x4E, 0x47]) // should not happen; fail decode path separately
        }
        return png
    }
}
