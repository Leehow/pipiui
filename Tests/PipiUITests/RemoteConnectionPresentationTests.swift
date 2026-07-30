import XCTest
@testable import PipiUI

final class RemoteConnectionPresentationTests: XCTestCase {
    private func repositoryRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    func testLoopbackLocalURLsNeverBecomeMobilePairingPayloads() throws {
        let loopbackURLs = [
            try XCTUnwrap(URL(string: "http://127.0.0.1:43123/")),
            try XCTUnwrap(URL(string: "http://127.1:43123/")),
            try XCTUnwrap(URL(string: "http://localhost:43123/")),
            try XCTUnwrap(URL(string: "http://[::1]:43123/")),
        ]

        for url in loopbackURLs {
            XCTAssertTrue(RemotePairingPayloadPolicy.isLoopbackURL(url))
            XCTAssertNil(
                RemotePairingPayloadPolicy.validatedPayload(url.absoluteString),
                "\(url) must never become a phone QR payload"
            )
        }
    }

    func testHTTPSPairingPayloadCanReachRenderer() throws {
        let payload = "https://relay.example/pair#opaque-once"
        XCTAssertEqual(RemotePairingPayloadPolicy.validatedPayload(payload), payload)

        let image = try XCTUnwrap(RemoteQRCodeView.makeImage(payload: payload))
        XCTAssertGreaterThan(image.size.width, 0)
        XCTAssertGreaterThan(image.size.height, 0)
    }

    func testPrivateLANHTTPPairingPayloadCanReachRenderer() throws {
        let secret = String(repeating: "a", count: 64)
        let payload = "http://192.168.43.200:43123/?pair=\(secret)"
        XCTAssertEqual(RemotePairingPayloadPolicy.validatedPayload(payload), payload)

        let image = try XCTUnwrap(RemoteQRCodeView.makeImage(payload: payload))
        XCTAssertGreaterThan(image.size.width, 0)
        XCTAssertGreaterThan(image.size.height, 0)
    }

    func testPairingPayloadRejectsInsecureOrLoopbackHTTPSURLs() {
        XCTAssertNil(RemotePairingPayloadPolicy.validatedPayload(nil))
        XCTAssertNil(RemotePairingPayloadPolicy.validatedPayload(""))
        XCTAssertNil(
            RemotePairingPayloadPolicy.validatedPayload(
                "http://relay.example/pair#opaque-once"
            )
        )
        XCTAssertNil(
            RemotePairingPayloadPolicy.validatedPayload(
                "https://127.0.0.1/pair#opaque-once"
            )
        )
        let secret = String(repeating: "a", count: 64)
        XCTAssertNil(
            RemotePairingPayloadPolicy.validatedPayload(
                "http://8.8.8.8:43123/?pair=\(secret)"
            )
        )
        XCTAssertNil(
            RemotePairingPayloadPolicy.validatedPayload(
                "http://localhost:43123/?pair=\(secret)"
            )
        )
        XCTAssertNil(
            RemotePairingPayloadPolicy.validatedPayload(
                "http://192.168.43.200:43123/"
            )
        )
        XCTAssertNil(
            RemotePairingPayloadPolicy.validatedPayload(
                "http://192.168.43.200:43123/?pair=too-short"
            )
        )
        XCTAssertNil(
            RemotePairingPayloadPolicy.validatedPayload(
                "http://192.168.43.200:43123/?pair=\(secret)&extra=1"
            )
        )
    }

    func testConnectionIndicatorDistinguishesAllListenerStates() throws {
        XCTAssertEqual(
            LocalRemoteConnectionIndicator.resolve(
                enabled: false,
                url: nil,
                status: "已关闭"
            ),
            .off
        )
        XCTAssertEqual(
            LocalRemoteConnectionIndicator.resolve(
                enabled: true,
                url: nil,
                status: "正在启动…"
            ),
            .starting
        )
        XCTAssertEqual(
            LocalRemoteConnectionIndicator.resolve(
                enabled: true,
                url: try XCTUnwrap(URL(string: "http://127.0.0.1:43123/")),
                status: "仅监听 127.0.0.1"
            ),
            .listening
        )
        XCTAssertEqual(
            LocalRemoteConnectionIndicator.resolve(
                enabled: false,
                url: nil,
                status: "启动失败：端口不可用"
            ),
            .failed
        )
    }

    func testAccessibilityContractHasStableExplicitLabels() {
        XCTAssertEqual(RemoteConnectionAccessibility.sidebarButtonLabel, "远程连接")
        XCTAssertEqual(
            RemoteConnectionAccessibility.sheetIdentifier,
            "PipiUI.RemoteConnectionSheet"
        )
        XCTAssertEqual(
            RemoteConnectionAccessibility.unavailablePairingActionLabel,
            "生成二维码（需开启局域网测试或 Relay）"
        )
        XCTAssertEqual(RemoteConnectionAccessibility.lanToggleLabel, "启用局域网测试")
        XCTAssertEqual(
            RemoteConnectionAccessibility.copyLANAddressLabel,
            "复制局域网测试地址"
        )
    }

    func testSidebarAndSheetWireTheAccessibilityContract() throws {
        let root = repositoryRoot()
        let sidebar = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/Views/SidebarView.swift"),
            encoding: .utf8
        )
        let sheet = try String(
            contentsOf: root.appendingPathComponent(
                "Sources/PipiUI/Views/RemoteConnectionSheet.swift"
            ),
            encoding: .utf8
        )

        XCTAssertTrue(
            sidebar.contains(
                ".accessibilityLabel(RemoteConnectionAccessibility.sidebarButtonLabel)"
            )
        )
        XCTAssertTrue(sidebar.contains(".sheet(isPresented: $showRemoteConnection)"))
        XCTAssertTrue(
            sheet.contains(
                ".accessibilityIdentifier(RemoteConnectionAccessibility.sheetIdentifier)"
            )
        )
        XCTAssertTrue(
            sheet.contains(
                ".accessibilityLabel(RemoteConnectionAccessibility.localToggleLabel)"
            )
        )
        XCTAssertTrue(
            sheet.contains(
                ".accessibilityLabel(RemoteConnectionAccessibility.lanToggleLabel)"
            )
        )
        XCTAssertTrue(
            sheet.contains(
                ".accessibilityLabel(RemoteConnectionAccessibility.copyLANAddressLabel)"
            )
        )
    }
}
