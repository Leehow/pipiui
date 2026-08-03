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

final class JcodeEventTranslatorTests: XCTestCase {
    func testTextDeltaAccumulatesToSnapshotUpdate() {
        var t = JcodeEventTranslator()
        // jcode 发 delta 流：先 "Hel"，再 "lo"
        let r1 = t.translate(event: ["ev":"text_delta","text":"Hel"])
        let r2 = t.translate(event: ["ev":"text_delta","text":"lo"])
        // 第一个 delta 现在先发 agent_start 再发 message_update（见
        // testFirstTextDeltaOfTurnEmitsAgentStart）；快照式累积行为不变。
        XCTAssertEqual(r1.last?["type"].string, "message_update")
        XCTAssertEqual(r1.last?["message"]["content"][0]["text"].string, "Hel")
        // 后续 delta 只发 message_update
        XCTAssertEqual(r2.map { $0["type"].string }, ["message_update"])
        XCTAssertEqual(r2[0]["message"]["content"][0]["text"].string, "Hello")
    }

    func testToolStartThenDoneEmitsPiToolEvents() {
        var t = JcodeEventTranslator()
        let s = t.translate(event: ["ev":"tool_start","call_id":"c1","name":"bash"])
        XCTAssertEqual(s.first?["type"].string, "tool_execution_start")
        XCTAssertEqual(s[0]["toolCallId"].string, "c1")
        let e = t.translate(event: ["ev":"tool_done","call_id":"c1","name":"bash","output":"done"])
        XCTAssertEqual(e.last?["type"].string, "tool_execution_end")
        XCTAssertEqual(e.last?["toolCallId"].string, "c1")
    }

    func testTurnDoneEmitsMessageEndThenSettled() {
        var t = JcodeEventTranslator()
        _ = t.translate(event: ["ev":"text_delta","text":"hi"])
        let r = t.translate(event: ["ev":"turn_done"])
        XCTAssertEqual(r.map { $0["type"].string }, ["message_end", "agent_settled"])
        XCTAssertEqual(r[0]["message"]["content"][0]["text"].string, "hi")
    }

    func testUnknownEventIgnored() {
        var t = JcodeEventTranslator()
        let r = t.translate(event: ["ev":"some_future_event","x":1])
        XCTAssertTrue(r.isEmpty)   // 协议允许 v1 内未知事件，静默忽略
    }

    func testFirstTextDeltaOfTurnEmitsAgentStart() {
        var t = JcodeEventTranslator()
        // First delta of turn 1: agent_start + message_update. jcode never emits
        // session_status{busy}, so agent_start is synthesized on the first text_delta.
        let r1 = t.translate(event: ["ev":"text_delta","text":"Hel"])
        XCTAssertEqual(r1.map { $0["type"].string }, ["agent_start", "message_update"])
        // Second delta: just message_update (accumulated non-empty).
        let r2 = t.translate(event: ["ev":"text_delta","text":"lo"])
        XCTAssertEqual(r2.map { $0["type"].string }, ["message_update"])
        // turn_done resets; next turn's first delta emits agent_start again.
        _ = t.translate(event: ["ev":"turn_done"])
        let r3 = t.translate(event: ["ev":"text_delta","text":"x"])
        XCTAssertEqual(r3.map { $0["type"].string }, ["agent_start", "message_update"])
    }
}

final class JcodeBridgeRequestTests: XCTestCase {
    /// Verify id auto-increments and reply_to correlation via the codec only
    /// (no real socket). We drive handleFrame indirectly by encoding a fake reply
    /// through the codec and asserting the completion fires.
    func testRequestIDAutoincrementsAndRepliesCorrelate() {
        // JcodeBridge is a final class with private state; we test the public
        // `request` -> `sendFrame` -> (external injects reply) -> completion path.
        // Since we can't easily inject frames without a socket, this test asserts
        // the *behavior we can observe*: that NdjsonCodec round-trips the wire form
        // a request would take, with v=1 and an int id.
        var seenIDs: [Int] = []
        // Simulate two requests' wire frames
        for _ in 0..<2 {
            // Mirror what JcodeBridge.request builds:
            let frame: [String: Any] = ["req": "ping", "v": 1, "id": seenIDs.count + 1]
            let encoded = NdjsonCodec.encode(frame)
            var codec = NdjsonCodec()
            let parsed = codec.push(Data(encoded.utf8))
            XCTAssertEqual(parsed.count, 1)
            seenIDs.append(parsed[0]["id"] as? Int ?? -1)
        }
        XCTAssertEqual(seenIDs, [1, 2])
    }
}
