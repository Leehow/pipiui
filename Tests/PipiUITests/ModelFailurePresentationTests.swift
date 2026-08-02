import XCTest
@testable import PipiUI

final class ModelFailurePresentationTests: XCTestCase {
    func testRealKimiOverloadPayloadIsActionableAndIdentified() {
        let message = errorMessage(
            provider: "kimi-coding",
            model: "k3",
            error: #"429 {"error":{"type":"rate_limit_error","message":"The engine is currently overloaded, please try again later"},"type":"error"}"#
        )

        let warning = ChatSession.modelFailureWarning(for: message)

        XCTAssertEqual(warning, "⚠️ kimi-coding/k3 服务当前繁忙或过载，请稍后重试或切换模型。")
        XCTAssertFalse(warning.contains("扩展冲突"))
        XCTAssertFalse(warning.contains("{"))
    }

    func testTimeoutHasDedicatedMessage() {
        let warning = ChatSession.modelFailureWarning(
            for: errorMessage(error: "The upstream request timed out after 30 seconds")
        )

        XCTAssertEqual(warning, "⚠️ 请求超时，请稍后重试。")
    }

    func testConnectionFailureHasDedicatedMessage() {
        let warning = ChatSession.modelFailureWarning(
            for: errorMessage(error: "TypeError: fetch failed because of a network connection error")
        )

        XCTAssertEqual(warning, "⚠️ 网络或连接失败，请检查网络后重试。")
    }

    func testAuthenticationFailureHasDedicatedMessage() {
        let warning = ChatSession.modelFailureWarning(
            for: errorMessage(error: "401 unauthorized: invalid API key sk-super-secret-value")
        )

        XCTAssertEqual(warning, "⚠️ 认证失败，请检查 API Key 或登录状态。")
        XCTAssertFalse(warning.contains("sk-super-secret-value"))
    }

    func testToolConflictIncludesCompactUsefulDetail() {
        let warning = ChatSession.modelFailureWarning(
            for: errorMessage(
                provider: "openai",
                model: "gpt-test",
                error: "Schema validation failed: duplicate tool names: search"
            )
        )

        XCTAssertEqual(
            warning,
            "⚠️ openai/gpt-test 扩展/工具兼容性冲突：Schema validation failed: duplicate tool names: search"
        )
    }

    func testLongFallbackIsSanitizedAndTruncated() {
        let secret = "Bearer abcdefghijklmnopqrstuvwxyz"
        let requestID = "request_id=req_123456789"
        let warning = ChatSession.modelFailureWarning(
            for: errorMessage(
                error: "Unexpected provider failure \(secret) \(requestID) " + String(repeating: "x", count: 800)
            )
        )

        XCTAssertTrue(warning.hasPrefix("⚠️ 模型请求失败：Unexpected provider failure"))
        XCTAssertTrue(warning.hasSuffix("…"))
        XCTAssertLessThanOrEqual(warning.count, 312)
        XCTAssertFalse(warning.contains("abcdefghijklmnopqrstuvwxyz"))
        XCTAssertFalse(warning.contains("req_123456789"))
    }

    func testProviderAndObjectModelLabel() {
        let message = J([
            "role": "assistant",
            "content": [],
            "stopReason": "error",
            "provider": "acme",
            "model": ["id": "m-1"],
            "errorMessage": "unknown failure",
        ])

        XCTAssertEqual(
            ChatSession.modelFailureWarning(for: message),
            "⚠️ acme/m-1 模型请求失败：unknown failure"
        )
    }

    func testOpaqueHugeJSONDoesNotLeakRawBlob() {
        let raw = #"500 {"padding":""# + String(repeating: "z", count: 4_000) + #""}"#
        let warning = ChatSession.modelFailureWarning(for: errorMessage(error: raw))

        XCTAssertEqual(warning, "⚠️ 模型请求失败：服务返回了无法解析的错误信息")
        XCTAssertFalse(warning.contains("padding"))
        XCTAssertFalse(warning.contains("{"))
    }

    func testHistoryBuildUsesSameWarningForEmptyError() {
        let built = ChatSession.buildTranscript(from: [
            errorMessage(
                provider: "kimi-coding",
                model: "k3",
                error: #"429 {"error":{"type":"rate_limit_error","message":"The engine is currently overloaded, please try again later"},"type":"error"}"#
            ),
        ])

        XCTAssertEqual(built.items.count, 1)
        XCTAssertEqual(built.items[0].role, "system")
        XCTAssertEqual(
            ChatSession.plainText(of: built.items[0]),
            "⚠️ kimi-coding/k3 服务当前繁忙或过载，请稍后重试或切换模型。"
        )
    }

    func testHistoryBoundaryLeavesPartialAndAbortedAssistantMessagesUnchanged() {
        let built = ChatSession.buildTranscript(from: [
            J([
                "role": "assistant",
                "content": [["type": "text", "text": "partial answer"]],
                "stopReason": "error",
                "errorMessage": "timeout",
            ]),
            J([
                "role": "assistant",
                "content": [],
                "stopReason": "aborted",
                "errorMessage": "cancelled",
            ]),
        ])

        XCTAssertEqual(built.items.map(\.role), ["assistant", "assistant"])
        XCTAssertEqual(ChatSession.plainText(of: built.items[0]), "partial answer")
        XCTAssertTrue(built.items[1].blocks.isEmpty)
    }

    private func errorMessage(
        provider: String? = nil,
        model: String? = nil,
        error: String
    ) -> J {
        var raw: [String: Any] = [
            "role": "assistant",
            "content": [],
            "stopReason": "error",
            "errorMessage": error,
        ]
        if let provider { raw["provider"] = provider }
        if let model { raw["model"] = model }
        return J(raw)
    }
}
