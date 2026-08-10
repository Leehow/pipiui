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

    func testSourceContainsURLAtomThrottleAndHTMLFallbackContracts() throws {
        let s = try source()
        for needle in ["name: \"arxiv_fetch\"", "function parseArxivURL", "src/e-print/ps/dvi", "\\d{4}\\.\\d{4,5}", "[a-z-]+\\/\\d{7}", "https://export.arxiv.org/api/query?id_list=", "API_GAP_MS = 3000", "inflight", "cache", "content_source", "https://arxiv.org", "https://ar5iv.labs.arxiv.org", "fetch_content", "shared 30s request budget exhausted", "unsupported URL: use fetch_content"] {
            XCTAssertTrue(s.contains(needle), "missing contract: \(needle)")
        }
        for forbidden in ["docparser", "spawn("] {
            XCTAssertFalse(s.contains(forbidden), "unexpected local helper dependency: \(forbidden)")
        }
    }

    func testFeatureAndSpawnExposeArxivWithoutCustomPDFRoute() throws {
        let spawn = try String(contentsOf: root().appendingPathComponent("Sources/PipiUI/PipiSpawnAssembly.swift"))
        XCTAssertTrue(spawn.contains("PIPIUI_ARXIV_EXT"))
        XCTAssertTrue(BuiltInFeatureSettings.EnabledSet().isEnabled(.arxivFetch))
        XCTAssertTrue(BuiltInFeatureSettings.EnabledSet().isEnabled(.pdfExtract),
                      "the persisted compatibility ID remains recognized")
    }
}
