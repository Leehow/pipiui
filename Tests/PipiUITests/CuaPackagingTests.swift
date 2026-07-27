import XCTest

final class CuaPackagingTests: XCTestCase {
    func testPinnedHelperAndNestedSigningContract() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let fetch = try String(contentsOf:
            root.appendingPathComponent("scripts/fetch-cua-driver.sh"))
        let packaging = try String(contentsOf:
            root.appendingPathComponent("make-app.sh"))
        let notice = try String(contentsOf:
            root.appendingPathComponent(
                "ThirdPartyNotices/CuaDriver-LICENSE.txt"
            ))

        XCTAssertTrue(fetch.contains(#"VERSION="0.12.5""#))
        XCTAssertTrue(fetch.contains(#"TAG="cua-driver-rs-v${VERSION}""#))
        XCTAssertTrue(fetch.contains(
            #"SHA256="898a143559694d6083feb89e3991581c87f5c9adf997876588cc262ade529e35""#
        ))
        XCTAssertTrue(fetch.contains("shasum -a 256"))
        XCTAssertTrue(fetch.contains("install -m 755"))
        XCTAssertTrue(packaging.contains(
            #"CUA_HELPER="$APP/Contents/Helpers/cua-driver""#
        ))
        XCTAssertTrue(packaging.contains(
            "--preserve-metadata=identifier,entitlements,flags,runtime"
        ))
        XCTAssertTrue(packaging.contains(
            #"codesign --verify --strict --verbose=2 "$CUA_HELPER""#
        ))
        let helperSign = try XCTUnwrap(packaging.range(
            of: #"--preserve-metadata=identifier,entitlements,flags,runtime"#
        ))
        let appSign = try XCTUnwrap(packaging.range(
            of: #"codesign --force --sign "$CODE_SIGN_ID" "$APP""#
        ))
        XCTAssertLessThan(helperSign.lowerBound, appSign.lowerBound)
        XCTAssertTrue(packaging.contains(
            "ThirdPartyNotices/CuaDriver-LICENSE.txt"
        ))
        XCTAssertTrue(packaging.contains(
            "NSScreenCaptureUsageDescription"
        ))
        XCTAssertTrue(notice.contains("MIT License"))
        XCTAssertTrue(notice.contains("Cua AI"))
    }
}
