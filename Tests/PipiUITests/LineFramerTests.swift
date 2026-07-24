import XCTest
@testable import PipiUI

final class LineFramerTests: XCTestCase {
    func testSingleLineAcrossChunks() {
        var framer = LineFramer()
        var out: [Data] = []
        out += framer.push(Data("hel".utf8))
        out += framer.push(Data("lo".utf8))
        XCTAssertTrue(out.isEmpty, "no LF yet → no complete line")
        out += framer.push(Data("\n".utf8))
        XCTAssertEqual(out.map { String(data: $0, encoding: .utf8) }, ["hello"])
    }

    func testMultipleLinesInOneChunk() {
        var framer = LineFramer()
        let out = framer.push(Data("a\nb\nc\n".utf8))
        XCTAssertEqual(out.map { String(data: $0, encoding: .utf8) }, ["a", "b", "c"])
    }

    func testTrailingCRStripped() {
        var framer = LineFramer()
        let out = framer.push(Data("x\r\ny\r\n".utf8))
        XCTAssertEqual(out.map { String(data: $0, encoding: .utf8) }, ["x", "y"])
    }

    func testPartialLineRetainedThenCompleted() {
        var framer = LineFramer()
        XCTAssertEqual(framer.push(Data("partial".utf8)).count, 0)
        XCTAssertEqual(framer.pendingByteCount, 7)
        let out = framer.push(Data(" done\nnext".utf8))
        XCTAssertEqual(out.map { String(data: $0, encoding: .utf8) }, ["partial done"])
        XCTAssertEqual(framer.pendingByteCount, 4) // "next"
    }

    func testEmptyLinesPreserved() {
        var framer = LineFramer()
        let out = framer.push(Data("\n\n".utf8))
        XCTAssertEqual(out.count, 2)
        XCTAssertTrue(out.allSatisfy { $0.isEmpty })
    }

    /// The actual regression: one ~12 MB line delivered in 64 KB chunks, exactly
    /// how pi streams a long session's history. The old inline splitter rescanned
    /// the whole accumulator per chunk (O(n²)) and took tens of seconds; this must
    /// finish in well under a second.
    func testLargeSingleLineIsLinearAndFast() {
        let payloadSize = 12 * 1024 * 1024
        let chunkSize = 64 * 1024
        var payload = Data(count: payloadSize)
        // Non-LF bytes so the whole thing is one line until the final terminator.
        for i in stride(from: 0, to: payloadSize, by: 512) { payload[i] = 0x41 }

        var framer = LineFramer()
        let start = DispatchTime.now()
        var completed = 0
        var offset = 0
        while offset < payloadSize {
            let end = min(offset + chunkSize, payloadSize)
            completed += framer.push(payload.subdata(in: offset..<end)).count
            offset = end
        }
        completed += framer.push(Data([0x0A])).count
        let ms = Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000

        XCTAssertEqual(completed, 1)
        XCTAssertLessThan(ms, 1000, "framing 12MB took \(ms)ms — likely quadratic again")
    }
}
