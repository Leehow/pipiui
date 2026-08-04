import XCTest
@testable import PipiUI

/// Provider routing + per-provider quota parsing for GLM / Claude / Codex.
final class MultiProviderQuotaTests: XCTestCase {

    override func setUp() {
        super.setUp()
        QuotaEnvFallback.envFileValues = { [:] }
    }

    override func tearDown() {
        QuotaEnvFallback.envFileValues = { EnvFileStore().all() }
        super.tearDown()
    }

    // MARK: - GLM .env fallback

    func testGLMKeyFallsBackToDotEnv() {
        QuotaEnvFallback.envFileValues = { ["Z_AI_API_KEY": "dotenv-glm"] }
        XCTAssertEqual(GLMAuthStore.load(env: [:]), "dotenv-glm")
    }

    func testGLMProcessEnvWinsOverDotEnv() {
        QuotaEnvFallback.envFileValues = { ["Z_AI_API_KEY": "dotenv-glm"] }
        XCTAssertEqual(GLMAuthStore.load(env: ["Z_AI_API_KEY": "process-glm"]), "process-glm")
    }

    func testGLMHostOverrideFromDotEnv() {
        QuotaEnvFallback.envFileValues = { ["Z_AI_API_HOST": "https://example.test"] }
        XCTAssertEqual(GLMAPIRegion.resolveHost(env: [:]), "https://example.test")
    }

    // MARK: - ModelInfo.quotaProvider routing

    func testQuotaProviderRouting() {
        // Direct providers → mapped.
        XCTAssertEqual(ModelInfo(provider: "xai", modelId: "grok-4.5", name: "Grok", contextWindow: nil).quotaProvider, .grok)
        XCTAssertEqual(ModelInfo(provider: "zai-coding-cn", modelId: "glm-5.2", name: "GLM", contextWindow: nil).quotaProvider, .glm)
        XCTAssertEqual(ModelInfo(provider: "zhipu-coding", modelId: "glm-5.2", name: "GLM", contextWindow: nil).quotaProvider, .glm)
        XCTAssertEqual(ModelInfo(provider: "anthropic", modelId: "claude-sonnet-4-5", name: "Claude", contextWindow: nil).quotaProvider, .claude)
        XCTAssertEqual(ModelInfo(provider: "openai-codex", modelId: "gpt-5.4", name: "GPT", contextWindow: nil).quotaProvider, .codex)
        XCTAssertEqual(ModelInfo(provider: "kimi-coding", modelId: "kimi-for-coding", name: "Kimi", contextWindow: nil).quotaProvider, .kimi)

        // Relays → nil (never show quota).
        XCTAssertNil(ModelInfo(provider: "grok-relay", modelId: "grok-4.5", name: "Grok", contextWindow: nil).quotaProvider)
        XCTAssertNil(ModelInfo(provider: "coding-relay", modelId: "gpt-5.6", name: "GPT", contextWindow: nil).quotaProvider)
        XCTAssertNil(ModelInfo(provider: "coding-relay-18890", modelId: "glm-5.2", name: "GLM", contextWindow: nil).quotaProvider)
        XCTAssertNil(ModelInfo(provider: "kimi-relay", modelId: "kimi-for-coding", name: "Kimi", contextWindow: nil).quotaProvider)

        // Unknown → nil.
        XCTAssertNil(ModelInfo(provider: "acme", modelId: "x", name: "x", contextWindow: nil).quotaProvider)

        // shouldShowAccountQuota agrees with quotaProvider != nil.
        XCTAssertTrue(ModelInfo(provider: "anthropic", modelId: "claude", name: "c", contextWindow: nil).shouldShowAccountQuota)
        XCTAssertTrue(ModelInfo(provider: "kimi-coding", modelId: "k3", name: "K3", contextWindow: nil).shouldShowAccountQuota)
        XCTAssertFalse(ModelInfo(provider: "grok-relay", modelId: "grok-4.5", name: "g", contextWindow: nil).shouldShowAccountQuota)
    }

    func testModelInfoQuotaProviderMatchesSharedRouting() {
        let providers = [
            "xai", "grok-relay", "zai-coding-cn", "zhipu-coding", "bigmodel",
            "anthropic", "claude-code", "openai-codex", "kimi-coding",
            "qoder-cn", "qwen-token-plan-cn", "deepseek", "acme",
        ]

        for provider in providers {
            let model = ModelInfo(
                provider: provider,
                modelId: "test-model",
                name: "Test",
                contextWindow: nil
            )
            XCTAssertEqual(
                model.quotaProvider,
                quotaProvider(for: provider),
                "routing mismatch for \(provider)"
            )
        }
    }

    func testQuotaProviderAccountLabel() {
        XCTAssertEqual(QuotaProvider.grok.accountLabel, "Grok 账号额度")
        XCTAssertEqual(QuotaProvider.glm.accountLabel, "GLM 账号额度")
        XCTAssertEqual(QuotaProvider.claude.accountLabel, "Claude 账号额度")
        XCTAssertEqual(QuotaProvider.codex.accountLabel, "Codex 账号额度")
        XCTAssertEqual(QuotaProvider.kimi.accountLabel, "Kimi 账号额度")
        XCTAssertEqual(QuotaProvider.qoder.accountLabel, "Qoder 账号额度")
        XCTAssertEqual(QuotaProvider.qwenTokenPlan.accountLabel, "Qwen Token Plan 额度")
    }

    // MARK: - GLM parsing

    /// Ported from CodexBar's ZaiLimitEntry.computedUsedPercent: limit 1000, remaining 750
    /// → used 250 → 25%.
    func testGLMPercentFromRemaining() {
        let limit = GLMRateLimit(kind: .tokensLimit, unit: 3, number: 5, limit: 1000,
                                 currentValue: nil, remaining: 750, percentage: nil,
                                 nextResetTime: nil)
        XCTAssertEqual(limit.usedPercent ?? -1, 25, accuracy: 0.01)
    }

    /// currentValue dominates when both remaining and currentValue present: used = max(1000-100, 800).
    func testGLMPercentCurrentValueDominates() {
        // remaining=100 → usedFromRemaining=900; currentValue=800 → max=900 → 90%.
        let l1 = GLMRateLimit(kind: .tokensLimit, unit: 3, number: 5, limit: 1000,
                              currentValue: 800, remaining: 100, percentage: nil,
                              nextResetTime: nil)
        XCTAssertEqual(l1.usedPercent ?? -1, 90, accuracy: 0.01)
    }

    /// Falls back to the API `percentage` field when remaining/currentValue absent.
    func testGLMPercentFallback() {
        let l = GLMRateLimit(kind: .timeLimit, unit: 1, number: 30, limit: 0,
                             currentValue: nil, remaining: nil, percentage: 42,
                             nextResetTime: nil)
        XCTAssertEqual(l.usedPercent ?? -1, 42, accuracy: 0.01)
    }

    func testGLMParseLimitsAndSnapshot() throws {
        // 5h token limit (300 min) 30% used, plus a weekly one.
        let json = """
        {"code":200,"success":true,"data":{"limits":[
          {"type":"TOKENS_LIMIT","unit":3,"number":5,"usage":10000,"remaining":7000,"percentage":30,"nextResetTime":1785000000000},
          {"type":"TOKENS_LIMIT","unit":6,"number":1,"usage":50000,"remaining":40000,"percentage":20,"nextResetTime":1785000000000}
        ]}}
        """
        let limits = try GLMWebBilling.parseLimits(from: Data(json.utf8))
        XCTAssertEqual(limits.count, 2)
        // Both windows surface; default capsule = highest-usage (the 5h at 30%).
        let snap = try XCTUnwrap(GLMWebBilling.snapshot(from: limits))
        XCTAssertEqual(snap.windows.count, 2)
        XCTAssertEqual(snap.capsule?.usedPercent ?? -1, 30, accuracy: 0.01)
        XCTAssertEqual(snap.capsule?.label, "5h")
        // Picking the weekly window reflects its 20%.
        let weekly = snap.copy(selectedWindowId: snap.windows.first { $0.label == "周" }!.id)
        XCTAssertEqual(weekly.capsule?.usedPercent ?? -1, 20, accuracy: 0.01)
    }

    func testGLMLabelForWindow() {
        // 5 hours → "5h"
        let fiveH = GLMRateLimit(kind: .tokensLimit, unit: 3, number: 5, limit: 100,
                                 currentValue: nil, remaining: nil, percentage: nil, nextResetTime: nil)
        XCTAssertEqual(GLMWebBilling.label(for: fiveH), "5h")
        // 7 days → "周"
        let weekly = GLMRateLimit(kind: .tokensLimit, unit: 6, number: 1, limit: 100,
                                  currentValue: nil, remaining: nil, percentage: nil, nextResetTime: nil)
        XCTAssertEqual(GLMWebBilling.label(for: weekly), "周")
    }

    // MARK: - Codex parsing

    func testCodexParsePrimaryWindow() throws {
        // used_percent is an int 0-100, reset_at epoch seconds, limit_window_seconds=18000 (5h).
        let json = """
        {"plan_type":"pro","rate_limit":{"primary_window":{"used_percent":73,"reset_at":1785000000,"limit_window_seconds":18000}},"credits":{"has_credits":true,"unlimited":false,"balance":5.0}}
        """
        let windows = try CodexWebBilling.parseWindows(from: Data(json.utf8))
        XCTAssertEqual(windows.count, 1)
        XCTAssertEqual(windows[0].usedPercent, 73, accuracy: 0.01)
        XCTAssertEqual(windows[0].windowSeconds, 18000)
        let snap = try XCTUnwrap(CodexWebBilling.snapshot(from: windows))
        XCTAssertEqual(snap.capsule?.label, "5h")
        XCTAssertEqual(snap.capsule?.usedPercent ?? -1, 73, accuracy: 0.01)
    }

    func testCodexTwoWindowsSelectable() throws {
        // primary 5h @ 90%, secondary weekly @ 40%.
        let json = """
        {"rate_limit":{"primary_window":{"used_percent":90,"reset_at":1785000000,"limit_window_seconds":18000},
                       "secondary_window":{"used_percent":40,"reset_at":1785600000,"limit_window_seconds":604800}}}
        """
        let windows = try CodexWebBilling.parseWindows(from: Data(json.utf8))
        XCTAssertEqual(windows.count, 2)
        let snap = try XCTUnwrap(CodexWebBilling.snapshot(from: windows))
        // Default capsule = highest-usage = primary (90%).
        XCTAssertEqual(snap.capsule?.usedPercent ?? -1, 90, accuracy: 0.01)
        // Selecting the weekly window (window1) shows 40%.
        let weekly = snap.copy(selectedWindowId: "window1")
        XCTAssertEqual(weekly.capsule?.usedPercent ?? -1, 40, accuracy: 0.01)
        XCTAssertEqual(weekly.capsule?.label, "周")
    }

    func testCodexFallsBackToSecondaryWindow() throws {
        let json = """
        {"rate_limit":{"secondary_window":{"used_percent":40,"reset_at":1785000000,"limit_window_seconds":604800}}}
        """
        let windows = try CodexWebBilling.parseWindows(from: Data(json.utf8))
        XCTAssertEqual(windows.count, 1)
        let snap = try XCTUnwrap(CodexWebBilling.snapshot(from: windows))
        // 604800 s = 7 days → "周"
        XCTAssertEqual(snap.capsule?.label, "周")
    }

    func testCodexCredentialTokenShape() throws {
        let json = """
        {"tokens":{"access_token":"atk","refresh_token":"rtk","account_id":"acct-1"},"last_refresh":"2026-07-20T00:00:00Z"}
        """
        let creds = try XCTUnwrap(CodexAuthStore.parse(data: Data(json.utf8)))
        XCTAssertEqual(creds.accessToken, "atk")
        XCTAssertEqual(creds.accountId, "acct-1")
    }

    func testCodexCredentialAPIKeyShape() throws {
        let json = #"{"OPENAI_API_KEY":"sk-xxx"}"#
        let creds = try XCTUnwrap(CodexAuthStore.parse(data: Data(json.utf8)))
        XCTAssertEqual(creds.accessToken, "sk-xxx")
        XCTAssertNil(creds.accountId)
    }

    // MARK: - Claude parsing

    /// Verified empirically: utilization is 0-100 (e.g. 16.0 = 16%).
    func testClaudeParseSevenDay() throws {
        let json = """
        {"five_hour":{"utilization":0.0,"resets_at":null},
         "seven_day":{"utilization":16.0,"resets_at":"2026-07-27T21:59:59+00:00"}}
        """
        let windows = try ClaudeWebBilling.parseWindows(from: Data(json.utf8))
        XCTAssertEqual(windows.count, 2)
        let sevenDay = try XCTUnwrap(windows.first { $0.kind == .sevenDay })
        XCTAssertEqual(sevenDay.usedPercent, 16, accuracy: 0.01)
        XCTAssertNotNil(sevenDay.resetsAt)
        let snap = try XCTUnwrap(ClaudeWebBilling.snapshot(from: windows))
        // Default capsule = highest-usage = seven_day (16%, vs 5h 0%).
        XCTAssertEqual(snap.capsule?.usedPercent ?? -1, 16, accuracy: 0.01)
        XCTAssertEqual(snap.capsule?.label, "周")
        // Selecting 5h shows 0%.
        let fiveH = snap.copy(selectedWindowId: "fiveHour")
        XCTAssertEqual(fiveH.capsule?.usedPercent ?? -1, 0, accuracy: 0.01)
        XCTAssertEqual(fiveH.capsule?.label, "5h")
    }

    func testClaudeFallsBackToFiveHour() throws {
        let json = """
        {"five_hour":{"utilization":82.5,"resets_at":"2026-07-24T12:00:00+00:00"},"seven_day":null}
        """
        let windows = try ClaudeWebBilling.parseWindows(from: Data(json.utf8))
        XCTAssertEqual(windows.count, 1) // only five_hour present
        XCTAssertEqual(windows[0].usedPercent, 82.5, accuracy: 0.01)
        let snap = try XCTUnwrap(ClaudeWebBilling.snapshot(from: windows))
        XCTAssertEqual(snap.capsule?.label, "5h")
    }

    func testClaudeCredentialPiAuthShape() throws {
        // The exact shape stored by pi at ~/.pi/agent/auth.json.
        let json = """
        {"anthropic":{"type":"oauth","refresh":"r-token","access":"a-token","expires":2000000000000}}
        """
        let creds = try XCTUnwrap(ClaudeAuthStore.parse(data: Data(json.utf8)))
        XCTAssertEqual(creds.accessToken, "a-token")
        XCTAssertNotNil(creds.expiresAt)
        XCTAssertFalse(creds.isExpired) // 2000000000000ms = 2033-05，远未来（原为 2026-07-24，已过期）
    }

    func testClaudeCredentialRejectsNonOAuth() {
        let json = #"{"anthropic":{"type":"api_key","key":"sk-ant"}}"#
        XCTAssertNil(ClaudeAuthStore.parse(data: Data(json.utf8)))
    }
}
