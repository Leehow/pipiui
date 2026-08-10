import XCTest
@testable import PipiUI

/// Pure assembly of pi spawn args/env: proves a disabled built-in feature never
/// mounts its `-e` extension or `PIPIUI_*` env, and that "everything off" yields
/// a bare-pi command line with zero PipiUI-owned `-e` flags.
final class PipiSpawnAssemblyTests: XCTestCase {
    private func fullyPopulatedPaths() -> PipiSpawnAssembly.Paths {
        PipiSpawnAssembly.Paths(
            philosophy: "/p/philosophy.ts",
            media: "/p/media.ts",
            git: "/p/git.ts",
            reload: "/p/reload.ts",
            webSearch: "/p/websearch.ts",
            arxivFetchPackage: "/p/packages/arxiv-fetch",
            mcp: "/p/mcp.ts",
            skillLoader: "/p/skills.ts",
            planRuntime: "/p/plan-runtime.ts",
            searchScope: "/p/searchscope.ts",
            codexServerTools: "/p/codex.ts",
            claudeServerTools: "/p/claude.ts",
            computerUse: "/p/computer.ts",
            webview: "/p/webview.ts",
            subagentDir: "/p/subagent",
            agentsDir: "/p/agents"
        )
    }

    private func allEnabledInput(paths: PipiSpawnAssembly.Paths) -> PipiSpawnAssembly.Input {
        PipiSpawnAssembly.Input(
            sessionPath: "/s/session.jsonl",
            bridgePort: 1,
            bridgeRoutingKey: "bridge",
            computerRoutingKey: "computer",
            grantSessionKey: "session-key",
            mainCWD: "/proj",
            paths: paths,
            features: .init(),
            computerDescriptor: ComputerCaptureDescriptor(
                displayID: 1,
                outputSize: ComputerImageSize(width: 100, height: 100),
                globalBounds: CGRect(x: 0, y: 0, width: 100, height: 100)
            ),
            mainModelId: "provider/model",
            excludeToolsArgs: []
        )
    }

    func testResolvedPathsAreExplicitlyNilWhenAllFeaturesDisabled() {
        var installed = PiPlugin.Installed()
        installed.subagentDir = "/p/subagent"
        installed.agentsDir = "/p/agents"
        installed.webviewExtension = "/p/webview.ts"
        installed.mediaExtension = "/p/media.ts"
        installed.gitExtension = "/p/git.ts"
        installed.reloadExtension = "/p/reload.ts"
        installed.webSearchExtension = "/p/websearch.ts"
        installed.arxivFetchPackage = "/p/packages/arxiv-fetch"
        installed.mcpExtension = "/p/mcp.ts"
        installed.skillLoaderExtension = "/p/skills.ts"
        installed.planRuntimeExtension = "/p/plan-runtime.ts"
        installed.searchScopeExtension = "/p/searchscope.ts"
        installed.codexServerToolsExtension = "/p/codex.ts"
        installed.claudeServerToolsExtension = "/p/claude.ts"
        installed.computerUseExtension = "/p/computer.ts"
        let disabled = BuiltInFeatureSettings.EnabledSet(
            disabledIDs: BuiltInFeatureSettings.FeatureID.allCases.map(\.rawValue)
        )

        let paths = PipiSpawnAssembly.Paths.resolved(
            installed: installed,
            features: disabled,
            philosophyExtension: "/p/philosophy.ts",
            computerUseExtension: "/p/computer.ts"
        )

        XCTAssertNil(paths.philosophy)
        XCTAssertNil(paths.subagentDir)
        XCTAssertNil(paths.agentsDir)
        XCTAssertNil(paths.webview)
        XCTAssertNil(paths.media)
        XCTAssertNil(paths.git)
        XCTAssertNil(paths.reload)
        XCTAssertNil(paths.webSearch)
        XCTAssertNil(paths.arxivFetchPackage)
        XCTAssertNil(paths.mcp)
        XCTAssertNil(paths.skillLoader)
        // Plan runtime is gated with philosophy / automatic planning — bare pi drops it.
        XCTAssertNil(paths.planRuntime)
        XCTAssertNil(paths.searchScope)
        XCTAssertNil(paths.codexServerTools)
        XCTAssertNil(paths.claudeServerTools)
        XCTAssertNil(paths.computerUse)
    }

    func testResolvedPlanRuntimeMountsWhenPhilosophyEnabled() {
        var installed = PiPlugin.Installed()
        installed.planRuntimeExtension = "/p/plan-runtime.ts"
        let enabled = BuiltInFeatureSettings.EnabledSet()
        let paths = PipiSpawnAssembly.Paths.resolved(
            installed: installed,
            features: enabled,
            philosophyExtension: "/p/philosophy.ts",
            computerUseExtension: nil
        )
        XCTAssertEqual(paths.philosophy, "/p/philosophy.ts")
        XCTAssertEqual(paths.planRuntime, "/p/plan-runtime.ts")
    }

    func testRetiredGitHubPreferenceDoesNotSuppressWebAccess() {
        var installed = PiPlugin.Installed()
        installed.webSearchExtension = "/p/websearch.ts"
        let paths = PipiSpawnAssembly.Paths.resolved(
            installed: installed,
            features: .init(disabledIDs: [BuiltInFeatureSettings.FeatureID.githubFetch.rawValue]),
            philosophyExtension: nil,
            computerUseExtension: nil
        )
        XCTAssertEqual(paths.webSearch, "/p/websearch.ts")
    }

    func testRetiredPDFPreferenceDoesNotSuppressArxivFeature() {
        var installed = PiPlugin.Installed()
        installed.arxivFetchPackage = "/p/packages/arxiv-fetch"

        let enabled = PipiSpawnAssembly.Paths.resolved(
            installed: installed,
            features: .init(),
            philosophyExtension: nil,
            computerUseExtension: nil
        )
        let retiredPDFDisabled = PipiSpawnAssembly.Paths.resolved(
            installed: installed,
            features: .init(disabledIDs: [BuiltInFeatureSettings.FeatureID.pdfExtract.rawValue]),
            philosophyExtension: nil,
            computerUseExtension: nil
        )

        XCTAssertEqual(enabled.arxivFetchPackage, "/p/packages/arxiv-fetch")
        XCTAssertEqual(retiredPDFDisabled.arxivFetchPackage, "/p/packages/arxiv-fetch")
    }

    func testLateSubagentConflictResultRequiresCurrentGenerationAndFeature() {
        let current = UUID()
        XCTAssertTrue(PipiSpawnAssembly.shouldApplySubagentConflictResult(
            expectedGeneration: current,
            currentGeneration: current,
            subagentEnabled: true,
            sessionExists: true
        ))
        XCTAssertFalse(PipiSpawnAssembly.shouldApplySubagentConflictResult(
            expectedGeneration: UUID(),
            currentGeneration: current,
            subagentEnabled: true,
            sessionExists: true
        ), "old callback must not update a restarted same-key session")
        XCTAssertFalse(PipiSpawnAssembly.shouldApplySubagentConflictResult(
            expectedGeneration: current,
            currentGeneration: current,
            subagentEnabled: false,
            sessionExists: true
        ), "disabling built-in subagent invalidates an in-flight scan")
        XCTAssertFalse(PipiSpawnAssembly.shouldApplySubagentConflictResult(
            expectedGeneration: current,
            currentGeneration: current,
            subagentEnabled: true,
            sessionExists: false
        ))
    }

    func testSubagentOffThenOnWithoutNewSessionStillRejectsOldCallback() {
        let oldScan = UUID()
        var currentGeneration: UUID? = oldScan
        XCTAssertTrue(PipiSpawnAssembly.shouldApplySubagentConflictResult(
            expectedGeneration: oldScan,
            currentGeneration: currentGeneration,
            subagentEnabled: true,
            sessionExists: true
        ))

        // AppStore's off action revokes every token immediately. Rapidly turning
        // back on does not create a generation until makeSession starts again.
        currentGeneration = nil
        XCTAssertFalse(PipiSpawnAssembly.shouldApplySubagentConflictResult(
            expectedGeneration: oldScan,
            currentGeneration: currentGeneration,
            subagentEnabled: true,
            sessionExists: true
        ))

        let newScan = UUID()
        currentGeneration = newScan
        XCTAssertTrue(PipiSpawnAssembly.shouldApplySubagentConflictResult(
            expectedGeneration: newScan,
            currentGeneration: currentGeneration,
            subagentEnabled: true,
            sessionExists: true
        ))
    }

    func testAppStoreSubagentOffRevokesScansBeforePersistAndUIUsesSetter() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let appStore = try String(contentsOf:
            root.appendingPathComponent("Sources/PipiUI/AppStore.swift"))
        let settings = try String(contentsOf:
            root.appendingPathComponent("Sources/PipiUI/Views/SettingsSheet.swift"))
        XCTAssertTrue(appStore.contains(
            "if id == .subagent, !enabled {\n            extensionConflictScanGenerations.removeAll()\n        }\n        BuiltInFeatureSettings.setEnabled"
        ))
        XCTAssertTrue(settings.contains("store.setBuiltInFeatureEnabled(enabled, id: id)"))
    }

    func testSubagentConflictDetectionRequiresEnabledInjectedSubagent() {
        XCTAssertTrue(PipiSpawnAssembly.shouldDetectSubagentConflicts(
            subagentDir: "/p/subagent",
            features: .init()
        ))
        XCTAssertFalse(PipiSpawnAssembly.shouldDetectSubagentConflicts(
            subagentDir: nil,
            features: .init()
        ))
        XCTAssertFalse(PipiSpawnAssembly.shouldDetectSubagentConflicts(
            subagentDir: "/p/subagent",
            features: .init(disabledIDs: [
                BuiltInFeatureSettings.FeatureID.subagent.rawValue
            ])
        ))
    }

    func testSearchGrantResetRequiresEnabledFeatureAndInjectedPath() {
        XCTAssertTrue(PipiSpawnAssembly.shouldResetSearchGrant(
            searchScopeExtension: "/p/searchscope.ts",
            features: .init()
        ))
        XCTAssertFalse(PipiSpawnAssembly.shouldResetSearchGrant(
            searchScopeExtension: nil,
            features: .init()
        ))
        XCTAssertFalse(PipiSpawnAssembly.shouldResetSearchGrant(
            searchScopeExtension: "/p/searchscope.ts",
            features: .init(disabledIDs: [
                BuiltInFeatureSettings.FeatureID.searchScope.rawValue
            ])
        ))
    }

    /// Every PipiUI `-e` and its env show up when all features are enabled.
    func testAllEnabledMountsEverything() {
        let out = PipiSpawnAssembly.assemble(allEnabledInput(paths: fullyPopulatedPaths()))
        XCTAssertTrue(out.args.contains("-e"))
        XCTAssertTrue(out.args.contains("/p/philosophy.ts"))
        XCTAssertTrue(out.args.contains("/p/webview.ts"))
        XCTAssertTrue(out.args.contains("/p/subagent"))
        XCTAssertTrue(out.args.contains("/p/searchscope.ts"))
        XCTAssertTrue(out.args.contains("/p/plan-runtime.ts"),
                      "main bridged session mounts plan runtime: \(out.args)")
        XCTAssertTrue(out.args.contains("/p/websearch.ts"))
        XCTAssertTrue(out.args.contains("/p/packages/arxiv-fetch"))
        XCTAssertEqual(out.extraEnv["PIPIUI_WEB_ACCESS_EXT"], "/p/websearch.ts")
        XCTAssertEqual(out.extraEnv["PIPIUI_ARXIV_EXT"], "/p/packages/arxiv-fetch")
        XCTAssertNil(out.extraEnv["PIPIUI_PLAN_RUNTIME_EXT"],
                     "plan runtime must not be re-exported to workers")
        XCTAssertEqual(out.extraEnv["PIPIUI_SEARCH_SCOPE_EXT"], "/p/searchscope.ts")
        XCTAssertNotNil(out.extraEnv["PIPIUI_SEARCH_GRANT_FILE"])
        XCTAssertEqual(out.extraEnv["PIPIUI_SUBAGENT_EXT"], "/p/subagent")
        XCTAssertEqual(out.extraEnv["PIPIUI_AGENTS_DIR"], "/p/agents")
        XCTAssertNotNil(out.extraEnv["PIPIUI_SUBAGENT_MODELS_FILE"])
        XCTAssertNotNil(out.extraEnv["PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE"])
        XCTAssertEqual(out.extraEnv["PIPIUI_MAIN_CWD"], "/proj")
        XCTAssertEqual(out.extraEnv["PIPIUI_MAIN_MODEL"], "provider/model")
        XCTAssertTrue(out.args.contains("/p/mcp.ts"))
        // Main session exports desktop env for nested hostAvailable / grant injection,
        // but never mounts the computer-use extension itself.
        XCTAssertFalse(out.args.contains("/p/computer.ts"),
                       "main session must not -e computer-use: \(out.args)")
        XCTAssertEqual(out.extraEnv["PIPIUI_COMPUTER_EXT"], "/p/computer.ts")
        XCTAssertEqual(out.extraEnv["PIPIUI_COMPUTER_CAPABILITY"], "computer")
        XCTAssertEqual(out.extraEnv["PIPIUI_COMPUTER_DISPLAY_ID"], "1")
        XCTAssertEqual(out.extraEnv["PIPIUI_COMPUTER_WIDTH"], "100")
        XCTAssertEqual(out.extraEnv["PIPIUI_COMPUTER_HEIGHT"], "100")
    }

    /// Global Computer Use on ⇒ env exported for nested subagents; main args never get `-e`.
    func testComputerUseExportsEnvWithoutMountingMainExtension() {
        let out = PipiSpawnAssembly.assemble(allEnabledInput(paths: fullyPopulatedPaths()))
        XCTAssertFalse(out.args.contains("/p/computer.ts"))
        // Ensure no -e pairs the computer path (belt-and-suspenders with contains above).
        for (index, arg) in out.args.enumerated() where arg == "-e" {
            let next = index + 1 < out.args.count ? out.args[index + 1] : ""
            XCTAssertNotEqual(next, "/p/computer.ts",
                              "main session must not pass -e computer-use")
        }
        XCTAssertEqual(out.extraEnv["PIPIUI_COMPUTER_EXT"], "/p/computer.ts")
        XCTAssertEqual(out.extraEnv["PIPIUI_COMPUTER_CAPABILITY"], "computer")
        XCTAssertNotNil(out.extraEnv["PIPIUI_COMPUTER_RUNTIME_PROTOCOL"])
        XCTAssertEqual(out.extraEnv["PIPIUI_COMPUTER_DISPLAY_ID"], "1")
        XCTAssertEqual(out.extraEnv["PIPIUI_COMPUTER_WIDTH"], "100")
        XCTAssertEqual(out.extraEnv["PIPIUI_COMPUTER_HEIGHT"], "100")
    }

    func testWebSearchDisabledDropsManagedWebAccessRoute() {
        var input = allEnabledInput(paths: fullyPopulatedPaths())
        input.features = .init(disabledIDs: [BuiltInFeatureSettings.FeatureID.webSearch.rawValue])

        let out = PipiSpawnAssembly.assemble(input)
        XCTAssertFalse(out.args.contains("/p/websearch.ts"))
        XCTAssertNil(out.extraEnv["PIPIUI_WEB_ACCESS_EXT"])
    }

    func testArxivFeatureGateIsIndependentFromRetiredPDFPreference() {
        let cases: [(disabled: [String], arxiv: Bool)] = [
            ([], true),
            ([BuiltInFeatureSettings.FeatureID.arxivFetch.rawValue], false),
            ([BuiltInFeatureSettings.FeatureID.pdfExtract.rawValue], true),
            ([
                BuiltInFeatureSettings.FeatureID.arxivFetch.rawValue,
                BuiltInFeatureSettings.FeatureID.pdfExtract.rawValue,
            ], false),
        ]

        for scenario in cases {
            var input = allEnabledInput(paths: fullyPopulatedPaths())
            input.features = .init(disabledIDs: scenario.disabled)
            let out = PipiSpawnAssembly.assemble(input)

            XCTAssertEqual(out.args.contains("/p/packages/arxiv-fetch"), scenario.arxiv)
            XCTAssertEqual(out.extraEnv["PIPIUI_ARXIV_EXT"] != nil, scenario.arxiv)
        }
    }

    func testRetiredGitHubPreferenceKeepsManagedWebAccessRoute() {
        var input = allEnabledInput(paths: fullyPopulatedPaths())
        input.features = .init(disabledIDs: [BuiltInFeatureSettings.FeatureID.githubFetch.rawValue])

        let out = PipiSpawnAssembly.assemble(input)
        XCTAssertTrue(out.args.contains("/p/websearch.ts"))
        XCTAssertEqual(out.extraEnv["PIPIUI_WEB_ACCESS_EXT"], "/p/websearch.ts")
    }

    func testMCPDisabledDropsExtension() {
        var input = allEnabledInput(paths: fullyPopulatedPaths())
        input.features = .init(disabledIDs: [BuiltInFeatureSettings.FeatureID.mcp.rawValue])

        let out = PipiSpawnAssembly.assemble(input)
        XCTAssertFalse(out.args.contains("/p/mcp.ts"))
    }

    func testSearchScopeDisabledDropsEverything() {
        var input = allEnabledInput(paths: fullyPopulatedPaths())
        input.features = .init(disabledIDs: [BuiltInFeatureSettings.FeatureID.searchScope.rawValue])

        let out = PipiSpawnAssembly.assemble(input)
        XCTAssertFalse(out.args.contains("/p/searchscope.ts"))
        XCTAssertNil(out.extraEnv["PIPIUI_SEARCH_SCOPE_EXT"])
        XCTAssertNil(out.extraEnv["PIPIUI_SEARCH_GRANT_FILE"])
    }

    func testSubagentDisabledDropsAgentsAndModelsEnv() {
        var input = allEnabledInput(paths: fullyPopulatedPaths())
        input.features = .init(disabledIDs: [BuiltInFeatureSettings.FeatureID.subagent.rawValue])

        let out = PipiSpawnAssembly.assemble(input)
        XCTAssertFalse(out.args.contains("/p/subagent"))
        XCTAssertNil(out.extraEnv["PIPIUI_SUBAGENT_EXT"])
        XCTAssertNil(out.extraEnv["PIPIUI_AGENTS_DIR"])
        XCTAssertNil(out.extraEnv["PIPIUI_SUBAGENT_MODELS_FILE"])
        XCTAssertNil(out.extraEnv["PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE"])
        XCTAssertNil(out.extraEnv["PIPIUI_MAIN_CWD"])
        XCTAssertNil(out.extraEnv["PIPIUI_MAIN_MODEL"])
        // Bridge plumbing is independent of the subagent feature and stays.
        XCTAssertNotNil(out.extraEnv["PIPIUI_BRIDGE_PORT"])
    }

    func testPhilosophyDisabledDropsFallbackEAndPlanRuntime() {
        var input = allEnabledInput(paths: fullyPopulatedPaths())
        input.features = .init(disabledIDs: [BuiltInFeatureSettings.FeatureID.philosophy.rawValue])

        let out = PipiSpawnAssembly.assemble(input)
        XCTAssertFalse(out.args.contains("/p/philosophy.ts"))
        XCTAssertFalse(out.args.contains("/p/plan-runtime.ts"),
                       "plan runtime rides with philosophy: \(out.args)")
    }

    func testComputerUseDisabledDropsExtensionAndEnv() {
        var input = allEnabledInput(paths: fullyPopulatedPaths())
        input.features = .init(disabledIDs: [BuiltInFeatureSettings.FeatureID.computerUse.rawValue])

        let out = PipiSpawnAssembly.assemble(input)
        XCTAssertFalse(out.args.contains("/p/computer.ts"))
        XCTAssertNil(out.extraEnv["PIPIUI_COMPUTER_EXT"])
        XCTAssertNil(out.extraEnv["PIPIUI_COMPUTER_CAPABILITY"])
    }

    /// Turning every master switch off must produce a command line with NO
    /// PipiUI `-e` extension, including plan runtime (philosophy-gated).
    func testAllDisabledIsBarePi() {
        let allIDs = BuiltInFeatureSettings.FeatureID.allCases.map(\.rawValue)
        // Paths still carry planRuntime from the populated fixture; assemble must
        // still drop it because philosophy is off — do not manually nil the path.
        var input = allEnabledInput(paths: fullyPopulatedPaths())
        input.features = .init(disabledIDs: allIDs)

        let out = PipiSpawnAssembly.assemble(input)
        XCTAssertFalse(out.args.contains("-e"), "no PipiUI-owned -e when all features off: \(out.args)")
        XCTAssertFalse(out.args.contains("/p/plan-runtime.ts"))
        XCTAssertNil(out.extraEnv["PIPIUI_SEARCH_SCOPE_EXT"])
        XCTAssertNil(out.extraEnv["PIPIUI_SEARCH_GRANT_FILE"])
        XCTAssertNil(out.extraEnv["PIPIUI_SUBAGENT_EXT"])
        XCTAssertNil(out.extraEnv["PIPIUI_AGENTS_DIR"])
        XCTAssertNil(out.extraEnv["PIPIUI_COMPUTER_EXT"])
        XCTAssertNil(out.extraEnv["PIPIUI_WEB_ACCESS_EXT"])
        XCTAssertNil(out.extraEnv["PIPIUI_ARXIV_EXT"])
        XCTAssertNil(out.extraEnv["PIPIUI_SUBAGENT_MODELS_FILE"])
        XCTAssertNil(out.extraEnv["PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE"])
        XCTAssertNil(out.extraEnv["PIPIUI_MAIN_CWD"])
        // Session path still threaded.
        XCTAssertTrue(out.args.contains("--session"))
    }

    /// When the bridge is inactive (dispatched worker), only the standalone
    /// extensions are mounted; bridge-only ones (browser/subagent/plan) are not.
    func testNoBridgeSkipsBridgeOnlyExtensions() {
        var input = allEnabledInput(paths: fullyPopulatedPaths())
        input.bridgePort = 0

        let out = PipiSpawnAssembly.assemble(input)
        XCTAssertFalse(out.args.contains("/p/webview.ts"))
        XCTAssertFalse(out.args.contains("/p/subagent"))
        XCTAssertFalse(out.args.contains("/p/plan-runtime.ts"),
                       "plan runtime is main-bridged only: \(out.args)")
        XCTAssertNil(out.extraEnv["PIPIUI_BRIDGE_PORT"])
        XCTAssertNil(out.extraEnv["PIPIUI_PLAN_RUNTIME_EXT"])
        // Standalone extensions remain.
        XCTAssertTrue(out.args.contains("/p/media.ts"))
    }

    func testPlanRuntimeMountsOnlyWhenPathPresentOnBridge() {
        var withPath = allEnabledInput(paths: fullyPopulatedPaths())
        let mounted = PipiSpawnAssembly.assemble(withPath)
        XCTAssertTrue(mounted.args.contains("/p/plan-runtime.ts"))

        var paths = fullyPopulatedPaths()
        paths.planRuntime = nil
        let withoutPath = allEnabledInput(paths: paths)
        let skipped = PipiSpawnAssembly.assemble(withoutPath)
        XCTAssertFalse(skipped.args.contains("/p/plan-runtime.ts"))

        // Path present but no bridge ⇒ still skipped.
        withPath.bridgePort = 0
        let noBridge = PipiSpawnAssembly.assemble(withPath)
        XCTAssertFalse(noBridge.args.contains("/p/plan-runtime.ts"))
    }

    /// Computer Use requires both the feature flag AND a capture descriptor:
    /// feature on but descriptor nil (e.g. no display geometry) ⇒ no mount.
    func testComputerUseRequiresDescriptor() {
        var input = allEnabledInput(paths: fullyPopulatedPaths())
        input.computerDescriptor = nil

        let out = PipiSpawnAssembly.assemble(input)
        XCTAssertFalse(out.args.contains("/p/computer.ts"))
        XCTAssertNil(out.extraEnv["PIPIUI_COMPUTER_EXT"])
    }
}
