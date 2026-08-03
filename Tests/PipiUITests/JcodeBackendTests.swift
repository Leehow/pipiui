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

    func testDecodeHandlesUTF8SplitAcrossChunks() {
        // A real JSON frame containing non-ASCII text, with the multibyte
        // sequence for 你 straddling the chunk boundary. The decoder must
        // buffer raw bytes and recover the full frame without dropping bytes.
        var codec = NdjsonCodec()
        let full = #"{"text":"hi你好"}"# + "\n"   // 你 = 0xE4 0xBD 0xA0 (3 bytes)
        let fullData = full.data(using: .utf8)!
        // "{\"text\":\"hi" = 11 ASCII bytes, then 你 starts at offset 11.
        // Split at offset 13: chunk1 keeps 你's first two bytes (0xE4 0xBD),
        // chunk2 begins at the third byte (0xA0) — a genuine multibyte straddle.
        let splitPoint = fullData.index(fullData.startIndex, offsetBy: 13)
        let chunk1 = fullData[..<splitPoint]
        let chunk2 = fullData[splitPoint...]
        let f1 = codec.push(Data(chunk1))
        XCTAssertTrue(f1.isEmpty, "partial frame should not be returned yet")
        let f2 = codec.push(Data(chunk2))
        XCTAssertEqual(f2.count, 1, "the complete frame should be decoded once the newline arrives")
        XCTAssertEqual(f2[0]["text"] as? String, "hi你好", "no UTF-8 bytes should be dropped at the chunk boundary")
    }
}
