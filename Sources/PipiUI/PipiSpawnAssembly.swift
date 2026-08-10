import Foundation

/// Environment names owned by PipiUI built-in capabilities rather than by the
/// user's shell/model credentials. Stale values may survive in both
/// `~/.pi/agent/.env` and the GUI App's inherited parent environment; both base
/// layers must be stripped before the current assembly explicitly re-adds the
/// enabled capability values.
enum PipiSpawnEnvironmentPolicy {
    static let managedExactKeys: Set<String> = [
        "PIPIUI_AGENTS_DIR",
        "PIPIUI_BRIDGE_PORT",
        "PIPIUI_MAIN_CWD",
        "PIPIUI_MAIN_MODEL",
        "PIPIUI_MAIN_MODEL_FILE",
        "PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE",
        "PIPIUI_SESSION_KEY",
        "PIPIUI_SKILL_READ_BLOCK",
        "PIPIUI_WEB_ACCESS_EXT",
        "PIPIUI_ARXIV_EXT",
        "PIPIUI_WORKTREE",
    ]

    static let managedPrefixes = [
        "PIPIUI_AGENT_",
        "PIPIUI_MEMORY_",
        "PIPIUI_COMPUTER_",
        "PIPIUI_SEARCH_",
        // Retire the generated web and GitHub extension env names without
        // letting stale parent/.env values resurrect an old package.
        "PIPIUI_WEBSEARCH_",
        "PIPIUI_GITHUB_",
        "PIPIUI_SUBAGENT_",
        "PIPIUI_WORKTREE_",
        // Hermes is main-session-only. Strip any stale inherited values rather
        // than letting an older parent process smuggle an extension to a worker.
        "PIPIUI_HERMES_",
    ]

    static func isManagedKey(_ key: String) -> Bool {
        managedExactKeys.contains(key)
            || managedPrefixes.contains(where: { key.hasPrefix($0) })
    }

    static func sanitized(_ environment: [String: String]) -> [String: String] {
        environment.filter { !isManagedKey($0.key) }
    }
}

/// Pure, side-effect-free assembly of the pi subprocess `-e` extension args and
/// `PIPIUI_*` internal env from a resolved set of plugin paths plus the built-in
/// feature snapshot.
///
/// Extracted from `ChatSession.init` so the gating rules ("a disabled feature
/// must not mount its `-e` / env", "everything off ⇒ no PipiUI-owned `-e` at
/// all") can be unit-tested without spawning a process. `ChatSession` builds the
/// `Input` from its instance state and hands the resulting args/env to
/// `PiProcess`; AppStore keeps its own concerns (conflict detection, strategy
/// resolution, agents dir passing).
enum PipiSpawnAssembly {
    /// Resolved plugin paths. `nil` means the file is absent or the App decided
    /// not to offer it; the assembly still independently gates by `features`.
    struct Paths: Equatable, Sendable {
        var philosophy: String?
        var media: String?
        var git: String?
        var reload: String?
        /// Managed pi-web-access entry point (`web_search` / `fetch_content`).
        var webSearch: String?
        /// Local Pi package root (`package.json` → arxiv_fetch extension).
        var arxivFetchPackage: String? = nil
        var mcp: String?
        var skillLoader: String?
        /// Main bridged session only; never exported to dispatched workers.
        var planRuntime: String? = nil
        var searchScope: String?
        /// Formal PipiUI-managed local package. Only the main session mounts it;
        /// worker/operator capability environments come from the package itself.
        var memoryBroker: String? = nil
        var codexServerTools: String?
        var claudeServerTools: String?
        var computerUse: String?
        // Bridge-dependent:
        var webview: String?
        var subagentDir: String?
        var agentsDir: String?

        /// Resolve the AppStore plugin snapshot into explicit nil/path values.
        /// This is the first gate (before ChatSession construction); `assemble`
        /// independently checks the same immutable feature snapshot as defense in
        /// depth. Keeping this pure also makes AppStore's path filtering testable.
        static func resolved(
            installed: PiPlugin.Installed,
            features: BuiltInFeatureSettings.EnabledSet,
            philosophyExtension: String?,
            computerUseExtension: String?,
            memoryBrokerEntrypoint: String? = nil
        ) -> Paths {
            return Paths(
                philosophy: features.isEnabled(.philosophy) ? philosophyExtension : nil,
                media: features.isEnabled(.generateImage) ? installed.mediaExtension : nil,
                git: features.isEnabled(.git) ? installed.gitExtension : nil,
                reload: features.isEnabled(.reload) ? installed.reloadExtension : nil,
                webSearch: features.isEnabled(.webSearch) ? installed.webSearchExtension : nil,
                arxivFetchPackage: features.isEnabled(.arxivFetch)
                    ? installed.arxivFetchPackage : nil,
                mcp: features.isEnabled(.mcp) ? installed.mcpExtension : nil,
                skillLoader: features.isEnabled(.skillLoader) ? installed.skillLoaderExtension : nil,
                // Structured plan feed rides with philosophy / automatic planning.
                // All-features-off (bare pi) and philosophy-off must not mount it.
                planRuntime: features.isEnabled(.philosophy) ? installed.planRuntimeExtension : nil,
                searchScope: features.isEnabled(.searchScope) ? installed.searchScopeExtension : nil,
                memoryBroker: memoryBrokerEntrypoint,
                codexServerTools: features.isEnabled(.codexServerTools)
                    ? installed.codexServerToolsExtension : nil,
                claudeServerTools: features.isEnabled(.claudeServerTools)
                    ? installed.claudeServerToolsExtension : nil,
                computerUse: features.isEnabled(.computerUse) ? computerUseExtension : nil,
                webview: features.isEnabled(.browser) ? installed.webviewExtension : nil,
                subagentDir: features.isEnabled(.subagent) ? installed.subagentDir : nil,
                agentsDir: features.isEnabled(.subagent) ? installed.agentsDir : nil
            )
        }
    }

    struct Input: Equatable, Sendable {
        var sessionPath: String?
        var bridgePort: UInt16
        var bridgeRoutingKey: String
        var computerRoutingKey: String
        var grantSessionKey: String
        var mainCWD: String
        var paths: Paths
        var features: BuiltInFeatureSettings.EnabledSet
        var computerDescriptor: ComputerCaptureDescriptor?
        var mainModelId: String?
        var excludeToolsArgs: [String]
        /// App-owned, session-scoped state directory for package status/import receipts.
        var memoryBrokerStateDirectory: String? = nil
        var memoryBrokerImportFile: String? = nil
        var memoryBrokerImportReceiptFile: String? = nil
    }

    struct Output: Equatable, Sendable {
        var args: [String]
        var extraEnv: [String: String]
    }

    /// A late async conflict result belongs to exactly one session generation.
    /// It is stale when the key was restarted/rebound/closed, or when the
    /// subagent master feature was disabled while the scan was running.
    static func shouldApplySubagentConflictResult(
        expectedGeneration: UUID,
        currentGeneration: UUID?,
        subagentEnabled: Bool,
        sessionExists: Bool
    ) -> Bool {
        subagentEnabled
            && sessionExists
            && currentGeneration == expectedGeneration
    }

    /// The conflict scanner protects the patched App-owned subagent extension.
    /// If that feature/path is absent, a user's same-name extension must not
    /// block a bare/native-pi session.
    static func shouldDetectSubagentConflicts(
        subagentDir: String?,
        features: BuiltInFeatureSettings.EnabledSet
    ) -> Bool {
        features.isEnabled(.subagent) && subagentDir != nil
    }

    /// SearchScope's session grant file is App-owned state; bare-pi mode must
    /// neither export it nor reset/create it. Kept pure for lifecycle tests.
    static func shouldResetSearchGrant(
        searchScopeExtension: String?,
        features: BuiltInFeatureSettings.EnabledSet
    ) -> Bool {
        features.isEnabled(.searchScope) && searchScopeExtension != nil
    }

    /// Assemble the full extension arg list + internal env block. Every PipiUI
    /// `-e` and `PIPIUI_*` key is gated by both its path being present AND the
    /// corresponding built-in feature being enabled.
    static func assemble(_ input: Input) -> Output {
        var args: [String] = []
        var env: [String: String] = [:]
        let f = input.features

        if let sessionPath = input.sessionPath { args += ["--session", sessionPath] }

        // Standalone extensions (no bridge dependency).
        if f.isEnabled(.philosophy), let p = input.paths.philosophy { args += ["-e", p] }
        if f.isEnabled(.generateImage), let p = input.paths.media { args += ["-e", p] }
        if f.isEnabled(.git), let p = input.paths.git { args += ["-e", p] }
        if f.isEnabled(.reload), let p = input.paths.reload { args += ["-e", p] }

        // pi-web-access supplies web_search, fetch_content, GitHub clone, and PDF
        // extraction. Re-export its resolved entry point so dispatched workers mount
        // the same pinned package when their role allowlist selects a web tool.
        if f.isEnabled(.webSearch), let p = input.paths.webSearch {
            args += ["-e", p]
            env["PIPIUI_WEB_ACCESS_EXT"] = p
        }

        // arXiv owns specialized metadata/content routing. Its package path is re-exported
        // independently so a missing/disabled PDF bridge never suppresses HTML/Atom retrieval.
        if f.isEnabled(.arxivFetch), let p = input.paths.arxivFetchPackage {
            args += ["-e", p]
            env["PIPIUI_ARXIV_EXT"] = p
        }

        // MCP: pi-mcp-extension reads the standard ~/.pi/agent/mcp.json itself.
        // It is mounted only in the main session; dispatched workers do not inherit it.
        if f.isEnabled(.mcp), let p = input.paths.mcp {
            args += ["-e", p]
        }

        // Main session only: dispatched workers stay fully skill-free.
        if f.isEnabled(.skillLoader), let p = input.paths.skillLoader { args += ["-e", p] }

        // Project search boundary: -e + grant file + nested-process re-export env.
        if f.isEnabled(.searchScope), let p = input.paths.searchScope {
            args += ["-e", p]
            env["PIPIUI_SEARCH_GRANT_FILE"] =
                SearchScopeExtension.grantFileURL(sessionKey: input.grantSessionKey).path
            env["PIPIUI_SEARCH_SCOPE_EXT"] = p
        }

        if f.isEnabled(.codexServerTools), let p = input.paths.codexServerTools { args += ["-e", p] }
        if f.isEnabled(.claudeServerTools), let p = input.paths.claudeServerTools { args += ["-e", p] }

        // Computer Use: requires both the feature flag AND a resolved capture
        // descriptor (TCC/geometry may be unavailable). The main session never
        // mounts the extension (`-e`); it only exports `PIPIUI_COMPUTER_*` env so
        // nested pi can host-check and inject computer/open_application into
        // desktop-authorized subagents (operator). Tools stay off the main tool list.
        let computerEnvReady: Bool
        if f.isEnabled(.computerUse),
           input.computerDescriptor != nil,
           input.paths.computerUse != nil {
            computerEnvReady = true
        } else {
            computerEnvReady = false
        }

        // Fine-grained tool denylist (--exclude-tools) is orthogonal to feature mounting.
        args += input.excludeToolsArgs

        let bridgeActive = input.bridgePort > 0
        guard bridgeActive else {
            return Output(args: args, extraEnv: env)
        }

        // Bridge-dependent extensions + routing env.
        // The formal package is mounted once in the main process. It owns Hermes,
        // ACLs, loopback transport, and all worker/operator capability issuance;
        // Swift exports only launch identity and an app-owned status directory.
        if let p = input.paths.memoryBroker {
            args += ["-e", p]
            env["PIPIUI_MEMORY_BROKER_MODE"] = "main"
            env["PIPIUI_MEMORY_PROJECT_ROOT"] = input.mainCWD
            if let stateDirectory = input.memoryBrokerStateDirectory {
                env["PIPIUI_MEMORY_BROKER_STATE_DIR"] = stateDirectory
            }
            if let importFile = input.memoryBrokerImportFile,
               let receiptFile = input.memoryBrokerImportReceiptFile {
                env["PIPIUI_MEMORY_BROKER_IMPORT_FILE"] = importFile
                env["PIPIUI_MEMORY_BROKER_IMPORT_RECEIPT_FILE"] = receiptFile
            }
        }
        if f.isEnabled(.browser), let p = input.paths.webview { args += ["-e", p] }
        // Main bridged session only: plan tools POST plan_event. Path is already
        // philosophy-gated in Paths.resolved. Do not re-export via PIPIUI_*_EXT —
        // dispatched workers must not receive this extension.
        if f.isEnabled(.philosophy), let p = input.paths.planRuntime { args += ["-e", p] }
        if f.isEnabled(.subagent), let p = input.paths.subagentDir {
            args += ["-e", p]
            env["PIPIUI_SUBAGENT_EXT"] = p
        }
        env["PIPIUI_BRIDGE_PORT"] = String(input.bridgePort)
        env["PIPIUI_SESSION_KEY"] = input.bridgeRoutingKey

        if computerEnvReady, let descriptor = input.computerDescriptor, let p = input.paths.computerUse {
            env["PIPIUI_COMPUTER_EXT"] = p
            env["PIPIUI_COMPUTER_CAPABILITY"] = input.computerRoutingKey
            env["PIPIUI_COMPUTER_RUNTIME_PROTOCOL"] = String(ComputerRuntimeContract.version)
            env["PIPIUI_COMPUTER_DISPLAY_ID"] = String(descriptor.displayID)
            env["PIPIUI_COMPUTER_WIDTH"] = String(descriptor.outputSize.width)
            env["PIPIUI_COMPUTER_HEIGHT"] = String(descriptor.outputSize.height)
        }

        // Main root, App-owned agents, and model-selection files are all read
        // only by the patched subagent extension; keep the entire block gated.
        if f.isEnabled(.subagent) {
            env["PIPIUI_MAIN_CWD"] = input.mainCWD
            if let agentsDir = input.paths.agentsDir {
                env["PIPIUI_AGENTS_DIR"] = agentsDir
            }
            env["PIPIUI_SUBAGENT_MODELS_FILE"] =
                SubagentModelSettings.overridesFileURL().path
            env["PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE"] =
                SubagentModelSettings.capabilityCatalogFileURL().path
            env["PIPIUI_MAIN_MODEL_FILE"] =
                SubagentModelSettings.mainModelFileURL().path
            if let mid = input.mainModelId, !mid.isEmpty {
                env["PIPIUI_MAIN_MODEL"] = mid
            }
        }

        return Output(args: args, extraEnv: env)
    }
}
