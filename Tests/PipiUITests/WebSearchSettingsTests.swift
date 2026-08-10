import XCTest
@testable import PipiUI

/// Contract tests for the managed pi-web-access replacement. The historical
/// filename stays stable so focused CI filters continue to find this suite.
final class WebSearchSettingsTests: XCTestCase {
    private func repositoryRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    func testPinnedPiWebAccessPackageMetadata() {
        XCTAssertEqual(WebAccessPackage.packageName, "pi-web-access")
        XCTAssertEqual(WebAccessPackage.packageVersion, "0.20.0")
    }

    func testManagedPackageEntrypointResolvesFromPiManifest() throws {
        let installRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-web-access-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: installRoot) }

        let packageURL = try ManagedNpmPackage.managedPackageURL(
            package: WebAccessPackage.packageName,
            version: WebAccessPackage.packageVersion,
            in: installRoot
        )
        try FileManager.default.createDirectory(at: packageURL, withIntermediateDirectories: true)
        let manifest: [String: Any] = [
            "name": WebAccessPackage.packageName,
            "version": WebAccessPackage.packageVersion,
            "pi": ["extensions": ["./index.ts"]],
        ]
        let manifestData = try JSONSerialization.data(withJSONObject: manifest)
        try manifestData.write(to: packageURL.appendingPathComponent("package.json"))
        let index = packageURL.appendingPathComponent("index.ts")
        try "export default () => {};\n".write(to: index, atomically: true, encoding: .utf8)

        let resolved = try ManagedNpmPackage.resolvedEntrypoint(
            package: WebAccessPackage.packageName,
            version: WebAccessPackage.packageVersion,
            in: installRoot
        )
        XCTAssertEqual(resolved, index.path)
    }

    func testPluginInstallsManagedPackageRatherThanGeneratingTypeScript() throws {
        let source = try String(
            contentsOf: repositoryRoot().appendingPathComponent("Sources/PipiUI/PiPlugin.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(source.contains("WebAccessPackage.ensureInstalled()"))
        XCTAssertTrue(source.contains("result.webSearchExtension = WebAccessPackage.ensureInstalled()"))
    }

    func testWebSearchGateMountsResolvedPackageEntrypoint() {
        let entrypoint = "/p/managed-npm/pi-web-access-0.20.0/node_modules/pi-web-access/index.ts"
        var input = PipiSpawnAssembly.Input(
            sessionPath: nil,
            bridgePort: 0,
            bridgeRoutingKey: "bridge",
            computerRoutingKey: "computer",
            grantSessionKey: "session",
            mainCWD: "/project",
            paths: .init(webSearch: entrypoint),
            features: .init(),
            computerDescriptor: nil,
            mainModelId: nil,
            excludeToolsArgs: []
        )

        let enabled = PipiSpawnAssembly.assemble(input)
        XCTAssertTrue(enabled.args.contains(entrypoint))
        XCTAssertEqual(enabled.extraEnv["PIPIUI_WEB_ACCESS_EXT"], entrypoint)

        input.features = .init(disabledIDs: [BuiltInFeatureSettings.FeatureID.webSearch.rawValue])
        let disabled = PipiSpawnAssembly.assemble(input)
        XCTAssertFalse(disabled.args.contains(entrypoint))
        XCTAssertNil(disabled.extraEnv["PIPIUI_WEB_ACCESS_EXT"])
    }

    func testWebAccessEnvironmentIsManaged() {
        let sanitized = PipiSpawnEnvironmentPolicy.sanitized([
            "PIPIUI_WEB_ACCESS_EXT": "/stale/web-access.ts",
            "UNRELATED": "kept",
        ])
        XCTAssertNil(sanitized["PIPIUI_WEB_ACCESS_EXT"])
        XCTAssertEqual(sanitized["UNRELATED"], "kept")
    }
}
