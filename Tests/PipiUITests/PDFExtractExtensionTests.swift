import XCTest
@testable import PipiUI

final class PDFExtractExtensionTests: XCTestCase {
    private func generatedSource() throws -> String {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-pdf-ext-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let path = try XCTUnwrap(PDFExtractExtension.install(into: dir))
        return try String(contentsOfFile: path, encoding: .utf8)
    }

    private func repositoryRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // PipiUITests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // repository root
    }

    func testGeneratedSourceRegistersPDFExtractAndStableParameters() throws {
        let source = try generatedSource()
        for needle in [
            "name: \"pdf_extract\"",
            "source: Type.String",
            "mode: Type.Optional",
            "pages: Type.Optional(Type.Array(Type.Integer",
            "max_length: Type.Optional(Type.Integer",
            "Type.Literal(\"auto\")",
            "Type.Literal(\"text\")",
            "Type.Literal(\"ocr\")",
            "PDFKit text first",
            "on-device Vision OCR",
            "no cloud upload or API key",
        ] {
            XCTAssertTrue(source.contains(needle), "pdf_extract source contract missing: \(needle)")
        }
    }

    func testGeneratedSourceSpawnsEnvConfiguredHelperWithoutNpm() throws {
        let source = try generatedSource()
        for needle in [
            "const HELPER_ENV = \"PIPIUI_PDF_HELPER\"",
            "process.env[HELPER_ENV]",
            "spawn(helper, [], {",
            "shell: false",
            "stdio: [\"pipe\", \"pipe\", \"pipe\"]",
            "JSON.parse(stdout.trim())",
            "local PDF helper returned invalid JSON",
            "MAX_HELPER_STDOUT_BYTES",
        ] {
            XCTAssertTrue(source.contains(needle), "helper spawn contract missing: \(needle)")
        }
        XCTAssertFalse(source.lowercased().contains("npm install"), "extension must never install packages at runtime")
    }

    func testGeneratedSourceOwnsBoundedHTTPDownloadAndCleanup() throws {
        let source = try generatedSource()
        for needle in [
            "const MAX_PDF_BYTES = 50 * 1024 * 1024",
            "const DOWNLOAD_TIMEOUT_MS = 30_000",
            "new URL(source)",
            "parsed.protocol !== \"http:\" && parsed.protocol !== \"https:\"",
            "content-type",
            "content-length",
            "%PDF-",
            "response.body.getReader()",
            "byteCount > MAX_PDF_BYTES",
            "mkdtemp(join(tmpdir(), \"pipiui-pdf-\"))",
            "await rm(tempDir, { recursive: true, force: true })",
            "await resolved.cleanup?.()",
        ] {
            XCTAssertTrue(source.contains(needle), "URL boundary/cleanup contract missing: \(needle)")
        }
    }

    func testHelperPathSeamUsesPackagedHelperAndEnvironmentKey() {
        let app = URL(fileURLWithPath: "/tmp/PipiUI.app", isDirectory: true)
        let expected = "/tmp/PipiUI.app/Contents/Helpers/pipiui-pdf-helper"
        XCTAssertEqual(PDFExtractExtension.helperPath(appBundleURL: app), expected)
        XCTAssertEqual(
            PDFExtractExtension.helperEnvironment(appBundleURL: app),
            ["PIPIUI_PDF_HELPER": expected]
        )
    }

    func testPackageAndPackagingScriptDeclareCopyAndSignTheHelper() throws {
        let root = repositoryRoot()
        let package = try String(contentsOf: root.appendingPathComponent("Package.swift"), encoding: .utf8)
        let packaging = try String(contentsOf: root.appendingPathComponent("make-app.sh"), encoding: .utf8)

        for needle in [
            ".executable(name: \"pipiui-pdf-helper\", targets: [\"PipiUIPDFHelper\"])",
            "name: \"PipiPDFCore\"",
            "name: \"PipiUIPDFHelper\"",
            "dependencies: [\"PipiPDFCore\"]",
        ] {
            XCTAssertTrue(package.contains(needle), "SwiftPM helper contract missing: \(needle)")
        }
        for needle in [
            "swift build -c release --product pipiui-pdf-helper",
            "PDF_HELPER=\"$APP/Contents/Helpers/pipiui-pdf-helper\"",
            "cp .build/release/pipiui-pdf-helper \"$PDF_HELPER\"",
            "codesign --force --sign \"$CODE_SIGN_ID\" \"$PDF_HELPER\"",
            "codesign --verify --strict --verbose=2 \"$PDF_HELPER\"",
        ] {
            XCTAssertTrue(packaging.contains(needle), "packaging/signing contract missing: \(needle)")
        }
    }
}
