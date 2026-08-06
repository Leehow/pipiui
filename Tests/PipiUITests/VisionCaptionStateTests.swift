import XCTest
import AppKit
@testable import PipiUI

/// Vision-fallback caption 的会话级状态流转：识别中占位（visionCaptionInProgress）与
/// 乐观气泡展开标记（visionCaptionOptimisticID）的置位/复位。
/// 不调真实云端 API：用无效图片让 OCR 快速失败 → caption 原文兜底，验证状态生命周期。
final class VisionCaptionStateTests: XCTestCase {

    private func makeSession() -> ChatSession {
        ChatSession(
            id: UUID().uuidString,
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "vision-caption-state-test"
        )
    }

    private func nonVisionModel() -> ModelInfo {
        ModelInfo(
            provider: "deepseek",
            modelId: "deepseek-chat",
            name: "DeepSeek",
            contextWindow: nil,
            supportsImages: false
        )
    }

    private func invalidImage() -> DraftImage {
        DraftImage(
            data: Data([1]),
            mimeType: "image/png",
            preview: NSImage(size: NSSize(width: 1, height: 1))
        )
    }

    /// Caption 分支进入时点亮占位状态，异步 OCR（无效图快速失败）结束后复位。
    func testCaptionInProgressLightsUpThenClears() async throws {
        let session = makeSession()
        session.model = nonVisionModel()
        // Busy 会话：finishVisionFallbackDelivery 走 queue 入队，不 spawn 标题进程。
        session.isStreaming = true

        let original = VisionFallbackSettings.load(defaults: .standard)
        defer { VisionFallbackSettings.save(original, defaults: .standard) }
        VisionFallbackSettings.setMode(.ocrOnly, defaults: .standard)

        let countBefore = session.transcript.count
        session.deliverAfterOptionalVisionFallback(
            preparedMessage: "看图",
            images: [invalidImage()]
        )

        // 同步：caption 分支已进入 → 占位状态点亮、乐观气泡已上屏。
        XCTAssertTrue(session.visionCaptionInProgress)
        let optimisticID = session.transcript.last?.id
        XCTAssertEqual(session.visionCaptionOptimisticID, optimisticID)
        XCTAssertEqual(session.transcript.count, countBefore + 1)

        // 异步等 caption 落地（OCR 失败 → 原文兜底 → 状态复位）。
        let finished = expectation(description: "caption finished")
        Task { @MainActor in
            while session.visionCaptionInProgress {
                try? await Task.sleep(nanoseconds: 10_000_000)
            }
            finished.fulfill()
        }
        await fulfillment(of: [finished], timeout: 5)

        XCTAssertFalse(session.visionCaptionInProgress)
        // 气泡文本原地更新为原文（OCR 失败不注入 caption）；展开标记保留到 ingest 回显。
        XCTAssertEqual(session.visionCaptionOptimisticID, optimisticID)
        let bubbleText = session.transcript.compactMap { item -> String? in
            guard item.id == optimisticID else { return nil }
            if case .text(let t) = item.blocks.last { return t }
            return nil
        }.first
        XCTAssertEqual(bubbleText, "看图")

        // 服务端回首条 user 消息回显（ingest 替换乐观气泡）→ 展开标记清除。
        session.handleEvent(J([
            "type": "message_end",
            "message": [
                "role": "user",
                "content": [
                    ["type": "text", "text": "看图"],
                ],
            ],
        ]))
        XCTAssertNil(session.visionCaptionOptimisticID)
        XCTAssertEqual(session.transcript.last?.id, optimisticID, "乐观气泡被回显 in-place 替换，id 保持不变")
    }

    /// 视觉模型带图：不进 caption 分支，占位状态保持关闭。
    func testCaptionStateOffWhenModelSupportsImages() {
        let session = makeSession()
        session.model = ModelInfo(
            provider: "openai",
            modelId: "gpt-4o",
            name: "GPT-4o",
            contextWindow: nil,
            supportsImages: true
        )
        session.deliverAfterOptionalVisionFallback(
            preparedMessage: "看图",
            images: [invalidImage()]
        )
        XCTAssertFalse(session.visionCaptionInProgress)
        XCTAssertNil(session.visionCaptionOptimisticID)
    }
}