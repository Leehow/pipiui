import XCTest
@testable import PipiUI

final class ArXivFetchPackageTests: XCTestCase {
    private func root() -> URL { URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent() }
    private func source() throws -> String { try String(contentsOf: root().appendingPathComponent("Sources/PipiUI/PiExt/packages/arxiv-fetch/extensions/arxiv-fetch.ts")) }

    func testPackageIsCompleteAndVersionedWithoutRuntimeNPM() throws {
        let package = root().appendingPathComponent("Sources/PipiUI/PiExt/packages/arxiv-fetch")
        let json = try JSONSerialization.jsonObject(with: Data(contentsOf: package.appendingPathComponent("package.json"))) as! [String: Any]
        XCTAssertEqual(json["name"] as? String, ArxivFetchPackage.packageName)
        XCTAssertEqual(json["version"] as? String, "0.1.0")
        XCTAssertNil(json["dependencies"])
        XCTAssertEqual(((json["pi"] as? [String: Any])?["extensions"] as? [String]), ["./extensions/arxiv-fetch.ts"])
        XCTAssertNotNil(ArxivFetchPackage.installedPath(in: root().appendingPathComponent("Sources/PipiUI/PiExt")))
    }

    func testSourceContainsURLAtomThrottleAndBoundedFallbackContracts() throws {
        let s = try source()
        for needle in ["name:\"arxiv_fetch\"", "function parseArxivURL", "src/e-print/ps/dvi", "\\d{4}\\.\\d{4,5}", "[a-z-]+\\/\\d{7}", "https://export.arxiv.org/api/query?id_list=", "API_GAP_MS = 3000", "inflight", "cache", "content_source", "https://arxiv.org", "https://ar5iv.labs.arxiv.org", "PIPIUI_PDF_HELPER", "MAX_PDF_BYTES", "OFFICIAL_PDF_HOSTS", "getReader", "reader.cancel", "final PDF URL", "bounded content-length", "%PDF-", "mkdtemp", "finally { if(timer) clearTimeout(timer)", "shell:false", "unsupported URL: use web_fetch", "github_fetch"] {
            XCTAssertTrue(s.contains(needle), "missing contract: \(needle)")
        }
        XCTAssertFalse(s.contains("Buffer.from(await r.arrayBuffer())"), "PDF download must not aggregate an unbounded response before enforcing its cap")
    }

    func testFeatureAndSpawnExposeIndependentArxivAndPDFSeams() throws {
        let spawn = try String(contentsOf: root().appendingPathComponent("Sources/PipiUI/PipiSpawnAssembly.swift"))
        XCTAssertTrue(spawn.contains("PIPIUI_ARXIV_EXT"))
        XCTAssertTrue(spawn.contains("PIPIUI_PDF_EXT"))
        XCTAssertTrue(spawn.contains("PDFExtractExtension.helperEnvironment()"))
        XCTAssertTrue(BuiltInFeatureSettings.EnabledSet().isEnabled(.arxivFetch))
        XCTAssertTrue(BuiltInFeatureSettings.EnabledSet().isEnabled(.pdfExtract))
    }
}
