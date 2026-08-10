import XCTest
@testable import PipiUI

/// Contract tests for the standalone local Pi package that owns `github_fetch`.
/// These read the checked-in package source instead of networking to GitHub.
final class GitHubFetchPackageTests: XCTestCase {
    private func repositoryRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    private func packageRoot() -> URL {
        repositoryRoot()
            .appendingPathComponent("Sources/PipiUI/PiExt/packages/github-fetch", isDirectory: true)
    }

    private func source() throws -> String {
        try String(
            contentsOf: packageRoot().appendingPathComponent("extensions/github-fetch.ts"),
            encoding: .utf8
        )
    }

    func testPackageManifestIsVersionedPiPackageWithoutRuntimeNPMInstall() throws {
        let manifestURL = packageRoot().appendingPathComponent("package.json")
        let data = try Data(contentsOf: manifestURL)
        let manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(manifest["name"] as? String, GitHubFetchPackage.packageName)
        XCTAssertEqual(manifest["version"] as? String, "0.1.0")
        XCTAssertEqual(manifest["license"] as? String, "Apache-2.0")
        XCTAssertTrue((manifest["keywords"] as? [String] ?? []).contains("pi-package"))
        XCTAssertNil(manifest["dependencies"], "the installed package must not require npm at runtime")
        XCTAssertEqual(
            ((manifest["pi"] as? [String: Any])?["extensions"] as? [String]),
            ["./extensions/github-fetch.ts"]
        )
        let peers = manifest["peerDependencies"] as? [String: String]
        XCTAssertEqual(peers?["@earendil-works/pi-coding-agent"], "*")
        XCTAssertEqual(peers?["typebox"], "*")

        let readme = try String(contentsOf: packageRoot().appendingPathComponent("README.md"), encoding: .utf8)
        XCTAssertTrue(readme.contains("not generated at runtime"))
        XCTAssertTrue(readme.contains("PIPIUI_GITHUB_EXT"))
        XCTAssertTrue(readme.contains("fixed `https://github.com/...` anonymous shallow clone"))
        XCTAssertTrue(readme.contains("`GIT_HTTP_*` override"))
        XCTAssertTrue(readme.contains("tokens are used only for optional `api.github.com` Contents API authorization"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: packageRoot().appendingPathComponent("LICENSE").path))
    }

    func testPackageLocatorRequiresCompleteLocalPackage() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-github-package-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let packageURL = root.appendingPathComponent(GitHubFetchPackage.relativePiExtPath, isDirectory: true)

        for relative in GitHubFetchPackage.requiredRelativePaths {
            let file = packageURL.appendingPathComponent(relative)
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try "fixture".write(to: file, atomically: true, encoding: .utf8)
        }
        XCTAssertEqual(GitHubFetchPackage.installedPath(in: root), packageURL.path)

        try FileManager.default.removeItem(at: packageURL.appendingPathComponent("README.md"))
        XCTAssertNil(GitHubFetchPackage.installedPath(in: root), "partial package must not mount")
    }

    func testBundledPiExtAndPiPluginExposeTheLocalPackagePath() throws {
        let bundlePiExt = try XCTUnwrap(PipiResourceBundle.shared.url(forResource: "PiExt", withExtension: nil))
        XCTAssertNotNil(GitHubFetchPackage.installedPath(in: bundlePiExt),
                        "SwiftPM resource copy must include the local Pi package")

        let plugin = try String(
            contentsOf: repositoryRoot().appendingPathComponent("Sources/PipiUI/PiPlugin.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(plugin.contains("var githubFetchPackage: String?"))
        XCTAssertTrue(plugin.contains("GitHubFetchPackage.installedPath(in: dest)"))
        XCTAssertTrue(plugin.contains("GitHubFetchPackage.installedPath(in: bundledPiExt)"))

        let appStore = try String(
            contentsOf: repositoryRoot().appendingPathComponent("Sources/PipiUI/AppStore.swift"),
            encoding: .utf8
        )
        let chat = try String(
            contentsOf: repositoryRoot().appendingPathComponent("Sources/PipiUI/ChatSession.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(appStore.contains("githubFetchPackage: paths.githubFetchPackage"))
        XCTAssertTrue(chat.contains("githubFetchPackage: githubFetchPackage"))
        XCTAssertTrue(chat.contains("githubFetchPackage: String? = nil"))
    }

    func testDedicatedToolRegistrationAndClearGitHubRouting() throws {
        let package = try source()
        XCTAssertEqual(package.components(separatedBy: "pi.registerTool(").count - 1, 1)
        XCTAssertEqual(package.components(separatedBy: "name: \"github_fetch\"").count - 1, 1)
        XCTAssertFalse(package.contains("name: \"web_fetch\""),
                       "the package must never collide with generic web_fetch")
        XCTAssertTrue(package.contains("Use github_fetch for GitHub repository roots and /blob/ or /tree/ URLs."))
        XCTAssertTrue(package.contains("Use web_fetch, not github_fetch, for GitHub issues, pull requests, discussions, wikis, releases"))
        XCTAssertTrue(package.contains("github_fetch supports GitHub repository, /blob/, and /tree/ URLs."))
        XCTAssertTrue(package.contains("GH_TOKEN or GITHUB_TOKEN"), "token stays optional")
        XCTAssertTrue(package.contains("max_length: Type.Optional("))
        XCTAssertTrue(package.contains("Math.min(Math.max(Math.round(params.max_length || 20000), 1000), 100000)"))
    }

    func testGitHubURLParserAndContentsApiSafetyContract() throws {
        let package = try source()
        for needle in [
            "function parseGitHubCodeURL",
            "url.hostname.toLowerCase() !== \"github.com\"",
            "parts[1].endsWith(\".git\")",
            "kind !== \"blob\" && kind !== \"tree\"",
            "kind: \"repo\"",
            "refCandidates",
            "safeGitHubPath",
            "part === \"..\"",
            "GitHub does not delimit refs",
            "ambiguous because its branch/ref may contain '/'",
            "/contents/${candidate.path",
            "api.github.com/repos/",
            "GH_TOKEN || process.env.GITHUB_TOKEN",
            "Authorization: `Bearer ${token}`",
            "Buffer.from(item.content.replace(/\\n/g, \"\"), \"base64\")",
            "function isBinary",
            "Git LFS pointer",
            "GitHub API denied request",
        ] {
            XCTAssertTrue(package.contains(needle), "GitHub parser/API contract missing: \(needle)")
        }
    }

    func testCloneEnvironmentDoesNotInheritCredentialsOrHooks() throws {
        let package = try source()
        for needle in [
            "function gitCloneEnvironment",
            "function isUnsafeGitCloneEnvironmentName",
            "GIT_ASKPASS",
            "SSH_ASKPASS",
            "GIT_SSH",
            "GIT_SSH_COMMAND",
            "GIT_CONFIG_COUNT",
            "GIT_CONFIG_PARAMETERS",
            "GH_TOKEN",
            "GITHUB_TOKEN",
            "name.startsWith(\"GIT_HTTP_\")",
            "env: gitCloneEnvironment()",
            "GIT_CONFIG_GLOBAL: \"/dev/null\"",
            "GIT_CONFIG_NOSYSTEM: \"1\"",
        ] {
            XCTAssertTrue(package.contains(needle), "Git clone environment contract missing: \(needle)")
        }
        XCTAssertTrue(package.contains("/^GIT_CONFIG_(?:KEY|VALUE)_\\d+$/"),
                      "all injected GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n variables must be removed")
        XCTAssertFalse(package.contains("env: { ...process.env"),
                       "git must receive a filtered environment rather than inheriting process.env directly")
    }

    func testCloneJailBudgetAndBoundedFallbackContract() throws {
        let package = try source()
        for needle in [
            "spawn(\"git\", args, {",
            "shell: false",
            "\"clone\", \"--depth\", \"1\", \"--single-branch\"",
            "GIT_TERMINAL_PROMPT: \"0\"",
            "GCM_INTERACTIVE: \"Never\"",
            "GIT_CONFIG_NOSYSTEM: \"1\"",
            "mkdtemp(join(tmpdir(), \"pipiui-github-\"))",
            "child.kill(\"SIGTERM\")",
            "finally {\n    await rm(tempRoot, { recursive: true, force: true });",
            "function insideRoot",
            "await realpath(root)",
            "NOISY_GITHUB_DIRS",
            "MAX_GITHUB_ENTRIES",
            "MAX_GITHUB_FILES",
            "MAX_GITHUB_FILE_CHARS",
            "truncate(body, MAX_GITHUB_FILE_CHARS)",
            "const MAX_GITHUB_REF_CANDIDATES = 3",
            "const GITHUB_TOTAL_BUDGET_MS = 30000",
            "function remainingGitHubBudget",
            "const remaining = remainingGitHubBudget(deadline)",
            "setTimeout(() => controller.abort(), remaining)",
            "}, remaining);",
            "candidateOverflow",
        ] {
            XCTAssertTrue(package.contains(needle), "GitHub clone/budget contract missing: \(needle)")
        }

        // Specialized routes share one 30s budget. A failure then gets one small,
        // independent HTML fallback without recursively re-parsing the URL.
        XCTAssertTrue(package.contains("async function fetchGenericGitHubURL"))
        XCTAssertTrue(package.contains("function lightweightHTMLToText"))
        XCTAssertTrue(package.contains("MAX_FALLBACK_RESPONSE_BYTES = 5 * 1024 * 1024"))
        XCTAssertFalse(package.contains("function extractMainContent"),
                       "do not copy the full generic web core into this package")
        XCTAssertFalse(package.contains("function extractRSCText"),
                       "do not copy the full generic web core into this package")
        XCTAssertEqual(package.components(separatedBy: "parseGitHubCodeURL(parsed)").count - 1, 1,
                       "only the outer handler may invoke the GitHub router")
        XCTAssertEqual(package.components(separatedBy: "fetchGenericGitHubURL(parsed, maxLength)").count - 1, 1,
                       "specialized failure gets exactly one fallback")
        XCTAssertTrue(package.contains("Date.now() + GITHUB_TOTAL_BUDGET_MS"))
        XCTAssertTrue(package.contains("github_fetch GitHub rejected"),
                      "unsafe GitHub URLs must not fall back")
    }
}
