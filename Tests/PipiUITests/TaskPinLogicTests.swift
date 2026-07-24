import XCTest
@testable import PipiUI

final class TaskPinLogicTests: XCTestCase {
    private func user(_ text: String, id: String = "u", images: [ImageBlock] = []) -> ChatItem {
        var blocks: [ChatBlock] = []
        if !text.isEmpty { blocks.append(.text(text)) }
        blocks.append(contentsOf: images.map { .image($0) })
        return ChatItem(id: id, role: "user", blocks: blocks)
    }

    func testBlacklistNotPinnable() {
        for s in ["好的", "好", "继续", "ok", "OK", "okay", "yes", "y", "a", "b", "嗯", "行"] {
            XCTAssertFalse(TaskPinLogic.isPinnable(user(s)), s)
        }
    }

    func testTwoCharOrLessWithoutAttachmentNotPinnable() {
        XCTAssertFalse(TaskPinLogic.isPinnable(user("嗯嗯")))
        XCTAssertFalse(TaskPinLogic.isPinnable(user("  x  ")))
    }

    func testShortRealTaskIsPinnable() {
        XCTAssertTrue(TaskPinLogic.isPinnable(user("修滚动")))
        XCTAssertTrue(TaskPinLogic.isPinnable(user("用方案 A")))
    }

    func testNewlineOrImageIsPinnable() {
        XCTAssertTrue(TaskPinLogic.isPinnable(user("看\n这个")))
        let img = ImageBlock(id: "i1", data: Data([0]), mimeType: "image/png", path: nil)
        XCTAssertTrue(TaskPinLogic.isPinnable(user("", images: [img])))
        XCTAssertTrue(TaskPinLogic.isPinnable(user("a", images: [img]))) // short text + image
    }

    func testInternalAndSubagentDoneNeverPinnable() {
        XCTAssertFalse(TaskPinLogic.isPinnable(user("[subagent-done] done")))
        XCTAssertFalse(TaskPinLogic.isPinnable(user("PipiUI internal — session title")))
    }

    func testLatestPinnableSkipsAcksAndNonUsers() {
        let items: [ChatItem] = [
            user("右下角额度切模型不更新", id: "t1"),
            ChatItem(id: "a1", role: "assistant", blocks: [.text("ok")]),
            user("继续", id: "ack"),
            ChatItem(id: "a2", role: "assistant", blocks: [.text("…")]),
            user("好的", id: "ack2"),
        ]
        XCTAssertEqual(TaskPinLogic.latestPinnableUser(in: items)?.id, "t1")
    }

    func testLatestPinnableUpdatesToNewTask() {
        let items = [
            user("旧任务内容足够长", id: "old"),
            user("新任务：改成蓝色按钮", id: "new"),
        ]
        XCTAssertEqual(TaskPinLogic.latestPinnableUser(in: items)?.id, "new")
    }
}
