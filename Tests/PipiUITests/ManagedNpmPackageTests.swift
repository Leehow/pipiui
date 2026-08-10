import XCTest
@testable import PipiUI

final class ManagedNpmPackageTests: XCTestCase {
    private var root: URL!
    private let fileManager = FileManager.default
    private let package = "pi-mcp-extension"
    private let version = "1.2.3"

    override func setUpWithError() throws {
        root = fileManager.temporaryDirectory
            .appendingPathComponent("pipiui-managed-npm-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { [root, fileManager] in
            if let root { try? fileManager.removeItem(at: root) }
        }
    }

    private var installRoot: URL {
        root.appendingPathComponent("managed-npm", isDirectory: true)
    }

    private var settingsURL: URL {
        root.appendingPathComponent("agent/settings.json")
    }

    private func write(_ text: String, to url: URL) throws {
        try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    private func packageURL() throws -> URL {
        try ManagedNpmPackage.managedPackageURL(
            package: package,
            version: version,
            in: installRoot
        )
    }

    @discardableResult
    private func makeManagedPackage(
        manifestName: String? = nil,
        manifestVersion: String? = nil,
        piExtensions: [String]? = ["./extensions/index.ts"],
        files: [String: String] = ["extensions/index.ts": "export default function () {}"]
    ) throws -> URL {
        let packageURL = try packageURL()
        try fileManager.createDirectory(at: packageURL, withIntermediateDirectories: true)
        var manifest: [String: Any] = [
            "name": manifestName ?? package,
            "version": manifestVersion ?? version,
        ]
        if let piExtensions {
            manifest["pi"] = ["extensions": piExtensions]
        }
        let data = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: packageURL.appendingPathComponent("package.json"), options: .atomic)
        for (relativePath, contents) in files {
            try write(contents, to: packageURL.appendingPathComponent(relativePath))
        }
        return packageURL
    }

    private func makeNpmStub() throws -> URL {
        let npmURL = root.appendingPathComponent("bin/npm")
        try write("#!/bin/sh\nexit 0\n", to: npmURL)
        try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: npmURL.path)
        return npmURL
    }

    func testMatchingVersionSkipsNpmInstall() throws {
        let packageURL = try makeManagedPackage()
        let npm = try makeNpmStub()
        var commandCount = 0

        let installation = try ManagedNpmPackage.ensureInstalled(
            package: package,
            version: version,
            in: installRoot,
            npmExecutable: npm,
            commandRunner: { _, _ in
                commandCount += 1
                return .init(status: 0, stdout: "", stderr: "")
            }
        )

        XCTAssertEqual(commandCount, 0, "matching package.json identity must not run npm")
        XCTAssertEqual(installation.state, .alreadyInstalled)
        XCTAssertEqual(installation.packageURL, packageURL.path)
        XCTAssertEqual(installation.entrypoint, packageURL.appendingPathComponent("extensions/index.ts").path)
    }

    func testMismatchedVersionReinstallsIntoPrivatePrefix() throws {
        let npm = try makeNpmStub()
        _ = try makeManagedPackage(manifestVersion: "1.2.2")
        let targetURL = try ManagedNpmPackage.installDirectoryURL(
            package: package,
            version: version,
            in: installRoot
        )
        let expectedPackageURL = try packageURL()
        var commandCount = 0

        let installation = try ManagedNpmPackage.ensureInstalled(
            package: package,
            version: version,
            in: installRoot,
            npmExecutable: npm,
            commandRunner: { executable, arguments in
                commandCount += 1
                XCTAssertEqual(executable.path, npm.path)
                XCTAssertEqual(arguments, [
                    "install",
                    "--prefix", targetURL.path,
                    "pi-mcp-extension@1.2.3",
                ])
                _ = try self.makeManagedPackage()
                return .init(status: 0, stdout: "added 1 package", stderr: "")
            }
        )

        XCTAssertEqual(commandCount, 1)
        XCTAssertEqual(installation.state, .installed)
        XCTAssertEqual(installation.packageURL, expectedPackageURL.path)
        XCTAssertEqual(installation.entrypoint, expectedPackageURL.appendingPathComponent("extensions/index.ts").path)
    }

    func testResolvesManifestAndKnownRelativeEntrypointsToAbsolutePaths() throws {
        let packageURL = try makeManagedPackage(
            piExtensions: ["./extensions/from-manifest.ts"],
            files: [
                "extensions/from-manifest.ts": "export default function () {}",
                "known/entry.ts": "export default function () {}",
            ]
        )

        XCTAssertEqual(
            try ManagedNpmPackage.resolvedEntrypoint(
                package: package,
                version: version,
                in: installRoot
            ),
            packageURL.appendingPathComponent("extensions/from-manifest.ts").path
        )
        XCTAssertEqual(
            try ManagedNpmPackage.resolvedEntrypoint(
                package: package,
                version: version,
                entrypoint: "./known/entry.ts",
                in: installRoot
            ),
            packageURL.appendingPathComponent("known/entry.ts").path
        )
    }

    func testGlobalRegistrationReportsManualPiInstallWithoutWritingSettings() throws {
        try write(
            #"{"packages":["npm:pi-web-access@0.1.0",{"source":"npm:pi-mcp-extension@1.2.3"}]}"#,
            to: settingsURL
        )

        XCTAssertEqual(
            ManagedNpmPackage.globalRegistration(package: package, settingsURL: settingsURL),
            .registered(source: "npm:pi-mcp-extension@1.2.3", version: "1.2.3")
        )
        let data = try Data(contentsOf: settingsURL)
        XCTAssertEqual(
            String(data: data, encoding: .utf8),
            #"{"packages":["npm:pi-web-access@0.1.0",{"source":"npm:pi-mcp-extension@1.2.3"}]}"#
        )
    }

    func testRemoveInstalledCleansOnlyTheManagedPrivateDirectory() throws {
        _ = try makeManagedPackage()
        let targetURL = try ManagedNpmPackage.installDirectoryURL(
            package: package,
            version: version,
            in: installRoot
        )

        XCTAssertTrue(try ManagedNpmPackage.removeInstalled(
            package: package,
            version: version,
            in: installRoot
        ))
        XCTAssertFalse(fileManager.fileExists(atPath: targetURL.path))
        XCTAssertFalse(try ManagedNpmPackage.removeInstalled(
            package: package,
            version: version,
            in: installRoot
        ))
    }

    func testUnavailableNpmFailsClearlyWithoutCallingRunner() throws {
        let missingNpm = root.appendingPathComponent("missing/npm")

        XCTAssertThrowsError(
            try ManagedNpmPackage.ensureInstalled(
                package: package,
                version: version,
                in: installRoot,
                npmExecutable: missingNpm,
                commandRunner: { _, _ in
                    XCTFail("runner must not be called when npm is unavailable")
                    return .init(status: 0, stdout: "", stderr: "")
                }
            )
        ) { error in
            XCTAssertEqual(error as? ManagedNpmPackage.PackageError, .npmUnavailable)
            XCTAssertTrue(error.localizedDescription.contains("npm"))
        }
    }

    func testNpmFailureIncludesExitStatusAndDiagnostic() throws {
        let npm = try makeNpmStub()
        let targetURL = try ManagedNpmPackage.installDirectoryURL(
            package: package,
            version: version,
            in: installRoot
        )

        XCTAssertThrowsError(
            try ManagedNpmPackage.ensureInstalled(
                package: package,
                version: version,
                in: installRoot,
                npmExecutable: npm,
                commandRunner: { _, _ in
                    .init(status: 42, stdout: "", stderr: "registry unavailable")
                }
            )
        ) { error in
            XCTAssertEqual(
                error as? ManagedNpmPackage.PackageError,
                .npmInstallFailed(
                    package: "pi-mcp-extension",
                    version: "1.2.3",
                    status: 42,
                    detail: "registry unavailable"
                )
            )
            XCTAssertTrue(error.localizedDescription.contains("exit status 42"))
        }
        XCTAssertFalse(fileManager.fileExists(atPath: targetURL.path), "failed installs must not leave a private partial tree")
    }

    func testSuccessfulNpmWithoutManifestReportsManifestFailure() throws {
        let npm = try makeNpmStub()
        let expectedPackageURL = try packageURL()

        XCTAssertThrowsError(
            try ManagedNpmPackage.ensureInstalled(
                package: package,
                version: version,
                in: installRoot,
                npmExecutable: npm,
                commandRunner: { _, _ in
                    try self.fileManager.createDirectory(at: expectedPackageURL, withIntermediateDirectories: true)
                    return .init(status: 0, stdout: "", stderr: "")
                }
            )
        ) { error in
            XCTAssertEqual(
                error as? ManagedNpmPackage.PackageError,
                .manifestMissing(path: expectedPackageURL.appendingPathComponent("package.json").path)
            )
            XCTAssertTrue(error.localizedDescription.contains("package.json"))
        }
    }
}
