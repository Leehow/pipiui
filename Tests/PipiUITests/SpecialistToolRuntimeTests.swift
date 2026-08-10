import XCTest
@testable import PipiUI

/// Executes the actual generated/bundled specialist extensions under Node with
/// only local mocks. The harness replaces `fetch` and `node:child_process`, so
/// this is a runtime behavior test rather than a generated-TS string check.
final class SpecialistToolRuntimeTests: XCTestCase {
    private func repositoryRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // PipiUITests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // repository root
    }

    func testSpecialistToolsExecuteAgainstMockedRuntime() throws {
        let fileManager = FileManager.default
        let runtime = fileManager.temporaryDirectory
            .appendingPathComponent("pipiui-specialist-runtime-\(UUID().uuidString)", isDirectory: true)
        defer { try? fileManager.removeItem(at: runtime) }

        let extensions = runtime.appendingPathComponent("extensions", isDirectory: true)
        let packages = runtime.appendingPathComponent("packages", isDirectory: true)
        try fileManager.createDirectory(at: extensions, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: packages, withIntermediateDirectories: true)

        let webSource = try XCTUnwrap(WebSearchExtension.install(into: extensions))
        let pdfSource = try XCTUnwrap(PDFExtractExtension.install(into: extensions))
        XCTAssertTrue(fileManager.fileExists(atPath: webSource))
        XCTAssertTrue(fileManager.fileExists(atPath: pdfSource))

        let repository = repositoryRoot()
        let sourcePackages = repository.appendingPathComponent(
            "Sources/PipiUI/PiExt/packages",
            isDirectory: true
        )
        for package in ["github-fetch", "arxiv-fetch"] {
            try fileManager.copyItem(
                at: sourcePackages.appendingPathComponent(package, isDirectory: true),
                to: packages.appendingPathComponent(package, isDirectory: true)
            )
        }

        let fixtureDirectory = try XCTUnwrap(
            Bundle.module.url(forResource: "Fixtures", withExtension: nil)
        )
        let harness = fixtureDirectory.appendingPathComponent("SpecialistToolRuntimeHarness.mjs")
        let loader = fixtureDirectory.appendingPathComponent("SpecialistToolRuntimeLoader.mjs")
        XCTAssertTrue(fileManager.fileExists(atPath: harness.path))
        XCTAssertTrue(fileManager.fileExists(atPath: loader.path))

        var environment = ProcessInfo.processInfo.environment
        environment.removeValue(forKey: "PIPIUI_PDF_HELPER")
        environment.removeValue(forKey: "GH_TOKEN")
        environment.removeValue(forKey: "GITHUB_TOKEN")
        environment["TMPDIR"] = runtime.appendingPathComponent("tmp", isDirectory: true).path

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = [
            "node",
            "--experimental-default-type=module",
            "--experimental-strip-types",
            "--experimental-loader", loader.path,
            harness.path,
            runtime.path,
        ]
        process.currentDirectoryURL = runtime
        process.environment = environment
        let output = Pipe()
        let errors = Pipe()
        process.standardOutput = output
        process.standardError = errors
        try process.run()
        process.waitUntilExit()

        let stdout = output.fileHandleForReading.readDataToEndOfFile()
        let stderr = String(
            data: errors.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        ) ?? ""
        guard process.terminationStatus == 0 else {
            XCTFail(
                "Specialist runtime harness failed:\n\(stderr)\n\(String(data: stdout, encoding: .utf8) ?? "")"
            )
            return
        }

        let report = try XCTUnwrap(
            JSONSerialization.jsonObject(with: stdout) as? [String: Any],
            "runtime harness did not emit JSON: \(String(data: stdout, encoding: .utf8) ?? "")"
        )
        XCTAssertEqual(report["ok"] as? Bool, true)
        XCTAssertEqual(
            Set(report["scenarios"] as? [String] ?? []),
            Set([
                "registration uniqueness and recoverable specialist routing",
                "web_fetch HTML RSC text JSON limits and HTTP boundaries",
                "web_search force and parameter compatibility",
                "github Contents API base64 and bounded fallback",
                "github clone arguments jail timeout and cleanup",
                "arxiv IDs metadata HTML fallbacks PDF helper and throttle",
                "pdf_extract local URL helpers validation limits and cleanup",
            ])
        )
    }
}
