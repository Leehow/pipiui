import XCTest
@testable import PipiUI

/// T17: `~/.pi/agent/.env` keys are injected into spawned pi subprocess env,
/// always layered UNDER the internal `PIPIUI_*` keys.
final class SpawnEnvMergeTests: XCTestCase {

    func testDotEnvKeysAreInjected() {
        let merged = ChatSession.mergedSpawnEnv(
            dotEnv: ["TEST_KEY": "xxx", "OPENAI_API_KEY": "sk-test"],
            internal: [:]
        )
        XCTAssertEqual(merged["TEST_KEY"], "xxx")
        XCTAssertEqual(merged["OPENAI_API_KEY"], "sk-test")
    }

    func testInternalKeysOverrideDotEnv() {
        let merged = ChatSession.mergedSpawnEnv(
            dotEnv: ["PIPIUI_BRIDGE_PORT": "9999", "TEST_KEY": "xxx"],
            internal: ["PIPIUI_BRIDGE_PORT": "1234"]
        )
        XCTAssertEqual(merged["PIPIUI_BRIDGE_PORT"], "1234")
        XCTAssertEqual(merged["TEST_KEY"], "xxx")
    }

    func testEmptyDotEnvKeepsInternal() {
        let merged = ChatSession.mergedSpawnEnv(
            dotEnv: [:],
            internal: ["PIPIUI_SESSION_KEY": "abc"]
        )
        XCTAssertEqual(merged, ["PIPIUI_SESSION_KEY": "abc"])
    }

    func testAllDisabledStripsManagedKeysFromDotEnvAndParent() {
        let stale: [String: String] = [
            "PIPIUI_SUBAGENT_EXT": "/old/subagent",
            "PIPIUI_SEARCH_SCOPE_EXT": "/old/search.ts",
            "PIPIUI_SEARCH_GRANT_FILE": "/old/grant.json",
            "PIPIUI_COMPUTER_EXT": "/old/computer.ts",
            "PIPIUI_COMPUTER_CAPABILITY": "old-token",
            "PIPIUI_AGENTS_DIR": "/old/agents",
            "PIPIUI_AGENT_ROLE": "old-worker",
            "PIPIUI_MAIN_CWD": "/old/project",
            "PIPIUI_MAIN_MODEL": "old/model",
            "PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE": "/old/subagent-model-capabilities.json",
            "PIPIUI_MEMORY_BROKER_ENABLED": "1",
            "PIPIUI_MEMORY_BROKER_CAPABILITY": "old-memory-token",
            "PIPIUI_WEBSEARCH_CONFIG_FILE": "/old/websearch.json",
            "PIPIUI_GITHUB_EXT": "/old/packages/github-fetch",
            "PIPIUI_ARXIV_EXT": "/old/packages/arxiv-fetch",
            "PIPIUI_PDF_EXT": "/old/pdf-extract.ts",
            "PIPIUI_PDF_HELPER": "/old/pipiui-pdf-helper",
            "PIPIUI_WORKTREE": "1",
        ]
        let disabled = BuiltInFeatureSettings.EnabledSet(
            disabledIDs: BuiltInFeatureSettings.FeatureID.allCases.map(\.rawValue)
        )
        let assembly = PipiSpawnAssembly.assemble(
            PipiSpawnAssembly.Input(
                sessionPath: nil,
                bridgePort: 1,
                bridgeRoutingKey: "bridge",
                computerRoutingKey: "computer",
                grantSessionKey: "session",
                mainCWD: "/project",
                paths: .init(
                    philosophy: "/p/philosophy.ts",
                    media: "/p/media.ts",
                    git: "/p/git.ts",
                    reload: "/p/reload.ts",
                    webSearch: "/p/websearch.ts",
                    githubFetchPackage: "/p/packages/github-fetch",
                    arxivFetchPackage: "/p/packages/arxiv-fetch",
                    pdfExtract: "/p/pdf-extract.ts",
                    mcp: "/p/mcp.ts",
                    skillLoader: "/p/skills.ts",
                    searchScope: "/p/search.ts",
                    codexServerTools: "/p/codex.ts",
                    claudeServerTools: "/p/claude.ts",
                    computerUse: "/p/computer.ts",
                    webview: "/p/webview.ts",
                    subagentDir: "/p/subagent",
                    agentsDir: "/p/agents"
                ),
                features: disabled,
                computerDescriptor: nil,
                mainModelId: nil,
                excludeToolsArgs: [],
                webSearchConfigFile: "/p/websearch.json",
                mcpConfigFile: "/p/mcp.json"
            )
        )
        var dotEnv = stale
        dotEnv["OPENAI_API_KEY"] = "dot-key"
        dotEnv["PIPIUI_SKILL_ROOTS"] = "/user/skills"
        let extra = ChatSession.mergedSpawnEnv(
            dotEnv: dotEnv,
            internal: assembly.extraEnv
        )
        var parent = stale
        parent["ANTHROPIC_API_KEY"] = "parent-key"
        let final = PiProcess.mergedProcessEnvironment(parent: parent, extraEnv: extra)

        for key in stale.keys {
            XCTAssertNil(final[key], "stale managed key leaked: \(key)")
        }
        XCTAssertEqual(final["OPENAI_API_KEY"], "dot-key")
        XCTAssertEqual(final["ANTHROPIC_API_KEY"], "parent-key")
        XCTAssertEqual(final["PIPIUI_SKILL_ROOTS"], "/user/skills")
        XCTAssertEqual(final["PIPIUI_BRIDGE_PORT"], "1", "RPC/UI plumbing remains")
    }

    func testEnabledAssemblyValuesOverrideStaleDotEnvAndParent() {
        let descriptor = ComputerCaptureDescriptor(
            displayID: 7,
            outputSize: ComputerImageSize(width: 800, height: 600),
            globalBounds: CGRect(x: 0, y: 0, width: 800, height: 600)
        )
        let assembly = PipiSpawnAssembly.assemble(
            PipiSpawnAssembly.Input(
                sessionPath: nil,
                bridgePort: 1,
                bridgeRoutingKey: "bridge",
                computerRoutingKey: "current-computer-token",
                grantSessionKey: "session",
                mainCWD: "/project",
                paths: .init(
                    philosophy: nil,
                    media: nil,
                    git: nil,
                    reload: nil,
                    webSearch: nil,
                    githubFetchPackage: "/current/packages/github-fetch",
                    arxivFetchPackage: "/current/packages/arxiv-fetch",
                    pdfExtract: "/current/pdf-extract.ts",
                    mcp: nil,
                    skillLoader: nil,
                    searchScope: "/current/search.ts",
                    codexServerTools: nil,
                    claudeServerTools: nil,
                    computerUse: "/current/computer.ts",
                    webview: nil,
                    subagentDir: "/current/subagent",
                    agentsDir: "/current/agents"
                ),
                features: .init(),
                computerDescriptor: descriptor,
                mainModelId: "current/model",
                excludeToolsArgs: [],
                webSearchConfigFile: "/current/websearch.json",
                mcpConfigFile: "/current/mcp.json"
            )
        )
        let stale: [String: String] = [
            "PIPIUI_SUBAGENT_EXT": "/old/subagent",
            "PIPIUI_SEARCH_SCOPE_EXT": "/old/search.ts",
            "PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE": "/old/subagent-model-capabilities.json",
            "PIPIUI_MEMORY_BROKER_ENABLED": "0",
            "PIPIUI_MEMORY_BROKER_CAPABILITY": "old-memory-token",
            "PIPIUI_GITHUB_EXT": "/old/packages/github-fetch",
            "PIPIUI_ARXIV_EXT": "/old/packages/arxiv-fetch",
            "PIPIUI_PDF_EXT": "/old/pdf-extract.ts",
            "PIPIUI_PDF_HELPER": "/old/pipiui-pdf-helper",
            "PIPIUI_COMPUTER_EXT": "/old/computer.ts",
            "PIPIUI_COMPUTER_CAPABILITY": "old-token",
        ]
        let extra = ChatSession.mergedSpawnEnv(dotEnv: stale, internal: assembly.extraEnv)
        let final = PiProcess.mergedProcessEnvironment(parent: stale, extraEnv: extra)

        XCTAssertEqual(final["PIPIUI_SUBAGENT_EXT"], "/current/subagent")
        XCTAssertEqual(final["PIPIUI_SEARCH_SCOPE_EXT"], "/current/search.ts")
        XCTAssertNil(final["PIPIUI_MEMORY_BROKER_ENABLED"],
                     "non-Hermes assembly must not inherit a stale broker route")
        XCTAssertNil(final["PIPIUI_MEMORY_BROKER_CAPABILITY"],
                     "dispatcher-only capability must never come from parent/.env")
        XCTAssertEqual(
            final["PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE"],
            SubagentModelSettings.capabilityCatalogFileURL().path
        )
        XCTAssertEqual(final["PIPIUI_GITHUB_EXT"], "/current/packages/github-fetch")
        XCTAssertEqual(final["PIPIUI_ARXIV_EXT"], "/current/packages/arxiv-fetch")
        XCTAssertEqual(final["PIPIUI_PDF_EXT"], "/current/pdf-extract.ts")
        XCTAssertNotEqual(final["PIPIUI_PDF_HELPER"], "/old/pipiui-pdf-helper")
        XCTAssertEqual(final["PIPIUI_COMPUTER_EXT"], "/current/computer.ts")
        XCTAssertEqual(final["PIPIUI_COMPUTER_CAPABILITY"], "current-computer-token")
    }
}
