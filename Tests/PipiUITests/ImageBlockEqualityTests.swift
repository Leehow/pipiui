import XCTest
@testable import PipiUI

/// `ImageBlock.==` runs once per image per SwiftUI diff pass, i.e. once per
/// streaming chunk. These tests pin the identity-based contract that keeps it O(1).
final class ImageBlockEqualityTests: XCTestCase {
    private func block(
        id: String = "img-1",
        bytes: Int = 1024,
        fill: UInt8 = 0,
        mime: String = "image/png",
        path: String? = nil
    ) -> ImageBlock {
        ImageBlock(
            id: id,
            data: Data(repeating: fill, count: bytes),
            mimeType: mime,
            path: path
        )
    }

    func testSameIdentityIsEqual() {
        XCTAssertEqual(block(), block())
    }

    func testDifferentIdIsNotEqual() {
        XCTAssertNotEqual(block(id: "a"), block(id: "b"))
    }

    func testDifferentByteCountIsNotEqual() {
        XCTAssertNotEqual(block(bytes: 1024), block(bytes: 2048))
    }

    func testDifferentMimeTypeIsNotEqual() {
        XCTAssertNotEqual(block(mime: "image/png"), block(mime: "image/jpeg"))
    }

    func testDifferentPathIsNotEqual() {
        XCTAssertNotEqual(block(path: nil), block(path: "/tmp/a.png"))
    }

    /// The deliberate trade-off: same id and same length are treated as the same
    /// image without touching the bytes. An id is minted per parsed block, so two
    /// different images never share one.
    func testSameIdAndSizeWithDifferentBytesIsTreatedAsEqual() {
        XCTAssertEqual(block(fill: 0x00), block(fill: 0xFF))
    }

    /// Guards the actual regression: comparing large images must not walk the bytes.
    /// 64 MB of memcmp per call would dwarf this budget many times over.
    func testLargeImageComparisonIsCheap() {
        let a = block(bytes: 32 * 1024 * 1024, fill: 0x01)
        let b = block(bytes: 32 * 1024 * 1024, fill: 0x02)

        let start = DispatchTime.now().uptimeNanoseconds
        for _ in 0..<1000 {
            XCTAssertTrue(a == b)
        }
        let elapsedMs = Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000

        XCTAssertLessThan(elapsedMs, 50, "1000 comparisons took \(elapsedMs)ms — equality is walking the bytes")
    }

    /// `ToolRun` carries images too, so tool output updates inherit the same cost.
    func testToolRunEqualityUsesImageIdentity() {
        let run = ToolRun(isRunning: false, isError: false, output: "ok", images: [block(fill: 0x00)])
        let same = ToolRun(isRunning: false, isError: false, output: "ok", images: [block(fill: 0xFF)])
        XCTAssertEqual(run, same)
    }
}
