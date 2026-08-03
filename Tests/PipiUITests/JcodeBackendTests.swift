import XCTest
@testable import PipiUI

final class NdjsonCodecTests: XCTestCase {
    func testEncodeAddsNewline() {
        let frame: [String: Any] = ["req": "hello", "v": 1, "id": 1]
        let encoded = NdjsonCodec.encode(frame)
        XCTAssertTrue(encoded.hasSuffix("\n"))
        XCTAssertNoThrow(try JSONSerialization.jsonObject(with: Data(encoded.dropLast().utf8)))
    }

    func testDecodeSplitsOnNewline() {
        var codec = NdjsonCodec()
        // 两帧粘在一个 chunk，第二帧不完整
        let chunk = #"{"v":1,"id":1,"ev":"hello_ok"}\n{"v":1,"ev":"partial"#.replacingOccurrences(of: "\\n", with: "\n")
        let frames = codec.push(Data(chunk.utf8))
        XCTAssertEqual(frames.count, 1)  // 只有第一帧完整
        XCTAssertEqual(frames[0]["ev"] as? String, "hello_ok")
        // 再 push 完成第二帧
        let rest = Data("\"}\n".utf8)
        let frames2 = codec.push(rest)
        XCTAssertEqual(frames2.count, 1)
    }

    func testDecodeIgnoresBlankLines() {
        var codec = NdjsonCodec()
        let frames = codec.push(Data("\n\n{\"ev\":\"x\"}\n\n".utf8))
        XCTAssertEqual(frames.count, 1)
    }
}
