import XCTest
import PipiUI
import Foundation

final class ProviderEnvMapTests: XCTestCase {

    /// Provider IDs actually referenced by the repo (SettingsSheet /
    /// PiAuthHelper / ChatSession / quota modules).
    func testCoversRepoProviders() {
        let repoProviders = [
            "anthropic",
            "openai",
            "openai-codex",
            "google",
            "xai",
            "kimi-coding",
            "moonshot",
            "zai",
            "zai-coding-cn",
            "zhipu",
        ]
        for p in repoProviders {
            XCTAssertTrue(ProviderEnvMap.isKnown(provider: p), "missing provider \(p)")
            XCTAssertNotNil(ProviderEnvMap.envVar(forProvider: p), "no env var for \(p)")
        }
    }

    func testCanonicalMappings() {
        XCTAssertEqual(ProviderEnvMap.envVar(forProvider: "anthropic"), "ANTHROPIC_API_KEY")
        XCTAssertEqual(ProviderEnvMap.envVar(forProvider: "openai"), "OPENAI_API_KEY")
        XCTAssertEqual(ProviderEnvMap.envVar(forProvider: "google"), "GEMINI_API_KEY")
        XCTAssertEqual(ProviderEnvMap.envVar(forProvider: "xai"), "XAI_API_KEY")
        XCTAssertEqual(ProviderEnvMap.envVar(forProvider: "kimi-coding"), "KIMI_API_KEY")
        XCTAssertEqual(ProviderEnvMap.envVar(forProvider: "zai"), "ZAI_API_KEY")
        XCTAssertEqual(ProviderEnvMap.envVar(forProvider: "zai-coding-cn"), "ZAI_CODING_CN_API_KEY")
        XCTAssertEqual(ProviderEnvMap.envVar(forProvider: "groq"), "GROQ_API_KEY")
        XCTAssertEqual(ProviderEnvMap.envVar(forProvider: "openrouter"), "OPENROUTER_API_KEY")
        XCTAssertEqual(ProviderEnvMap.envVar(forProvider: "deepseek"), "DEEPSEEK_API_KEY")
    }

    func testUnknownProvider() {
        XCTAssertFalse(ProviderEnvMap.isKnown(provider: "not-a-provider"))
        XCTAssertNil(ProviderEnvMap.envVar(forProvider: "not-a-provider"))
        XCTAssertEqual(ProviderEnvMap.envVars(forProvider: "not-a-provider"), [])
    }

    func testReverseLookupConsistency() {
        // Every provider must be reachable back from each of its env vars.
        for (provider, vars) in ProviderEnvMap.envVarsByProvider {
            for v in vars {
                XCTAssertTrue(ProviderEnvMap.providers(forEnvVar: v).contains(provider),
                              "\(provider) missing from reverse lookup of \(v)")
            }
        }
        XCTAssertEqual(ProviderEnvMap.providers(forEnvVar: "ANTHROPIC_API_KEY"), ["anthropic"])
        XCTAssertTrue(ProviderEnvMap.providers(forEnvVar: "OPENAI_API_KEY").contains("openai"))
        XCTAssertTrue(ProviderEnvMap.providers(forEnvVar: "OPENAI_API_KEY").contains("openai-codex"))
        XCTAssertTrue(ProviderEnvMap.providers(forEnvVar: "KIMI_API_KEY").contains("kimi-coding"))
        XCTAssertTrue(ProviderEnvMap.providers(forEnvVar: "KIMI_API_KEY").contains("moonshot"))
    }

    func testNoDuplicateEnvVarEntriesWithinProvider() {
        for (provider, vars) in ProviderEnvMap.envVarsByProvider {
            XCTAssertEqual(vars.count, Set(vars).count, "duplicate env vars for \(provider)")
        }
    }
}
