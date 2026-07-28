import XCTest
import CoreGraphics
@testable import PipiUI

final class ComputerRuntimeStrategyTests: XCTestCase {
    private func defaults() -> UserDefaults {
        let suite = "pipiui-computer-runtime-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        addTeardownBlock {
            defaults.removePersistentDomain(forName: suite)
        }
        return defaults
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "pipiui-computer-runtime-\(UUID().uuidString)",
                isDirectory: true
            )
        try FileManager.default.createDirectory(
            at: url,
            withIntermediateDirectories: true
        )
        addTeardownBlock {
            try? FileManager.default.removeItem(at: url)
        }
        return url
    }

    func testBundledStrategyIsARealResourceAndSoleTypeScriptAuthority() throws {
        let url = try XCTUnwrap(ComputerUseStrategyResource.bundledURL())
        let source = try ComputerUseStrategyResource.bundledSource()
        XCTAssertEqual(url.lastPathComponent, "computer-use-strategy.ts")
        XCTAssertTrue(source.contains(#"name: "computer""#))
        XCTAssertTrue(source.contains(#"name: "open_application""#))
        XCTAssertTrue(source.contains("export async function negotiateRuntime"))

        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let swiftResolver = try String(
            contentsOf: root.appendingPathComponent(
                "Sources/PipiUI/ComputerUseStrategy.swift"
            ),
            encoding: .utf8
        )
        XCTAssertFalse(swiftResolver.contains("registerTool"))
        XCTAssertFalse(swiftResolver.contains("static let source"))
        XCTAssertFalse(swiftResolver.contains(#"#""""#))
    }

    func testBuiltInAndExternalStrategyResolutionNeverSilentlyFallback() throws {
        let defaults = defaults()
        let directory = try temporaryDirectory()
        let builtIn = directory.appendingPathComponent("built-in.ts")
        try "export default () => {}".write(
            to: builtIn,
            atomically: true,
            encoding: .utf8
        )

        let selectedBuiltIn = try ComputerUseSettings.resolveStrategy(
            builtInPath: builtIn.path,
            defaults: defaults
        )
        XCTAssertEqual(selectedBuiltIn.kind, .builtIn)
        XCTAssertEqual(selectedBuiltIn.extensionPath, builtIn.path)

        ComputerUseSettings.setStrategyKind(.external, defaults: defaults)
        XCTAssertThrowsError(try ComputerUseSettings.resolveStrategy(
            builtInPath: builtIn.path,
            defaults: defaults
        )) {
            XCTAssertEqual(
                $0 as? ComputerUseStrategySelectionError,
                .externalPathMissing
            )
        }

        let missing = directory.appendingPathComponent("missing.ts")
        ComputerUseSettings.setExternalStrategyPath(
            missing.path,
            defaults: defaults
        )
        XCTAssertThrowsError(try ComputerUseSettings.resolveStrategy(
            builtInPath: builtIn.path,
            defaults: defaults
        )) {
            XCTAssertEqual(
                $0 as? ComputerUseStrategySelectionError,
                .externalPathNotFound(missing.path)
            )
        }

        let external = directory.appendingPathComponent("custom-strategy.ts")
        try "export default () => {}".write(
            to: external,
            atomically: true,
            encoding: .utf8
        )
        ComputerUseSettings.setExternalStrategyPath(
            external.path,
            defaults: defaults
        )
        let selectedExternal = try ComputerUseSettings.resolveStrategy(
            builtInPath: builtIn.path,
            defaults: defaults
        )
        XCTAssertEqual(
            selectedExternal,
            ComputerUseStrategySelection(
                kind: .external,
                extensionPath: external.path
            )
        )
        XCTAssertNotEqual(selectedExternal.extensionPath, builtIn.path)
    }

    func testExternalDirectoryRequiresAPiExtensionEntrypoint() throws {
        let defaults = defaults()
        let directory = try temporaryDirectory()
        let extensionDirectory = directory.appendingPathComponent(
            "custom-extension",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: extensionDirectory,
            withIntermediateDirectories: true
        )
        ComputerUseSettings.setStrategyKind(.external, defaults: defaults)
        ComputerUseSettings.setExternalStrategyPath(
            extensionDirectory.path,
            defaults: defaults
        )
        XCTAssertThrowsError(try ComputerUseSettings.resolveStrategy(
            builtInPath: nil,
            defaults: defaults
        )) {
            XCTAssertEqual(
                $0 as? ComputerUseStrategySelectionError,
                .externalDirectoryHasNoEntry(extensionDirectory.path)
            )
        }

        try "export default () => {}".write(
            to: extensionDirectory.appendingPathComponent("index.ts"),
            atomically: true,
            encoding: .utf8
        )
        XCTAssertEqual(
            try ComputerUseSettings.resolveStrategy(
                builtInPath: nil,
                defaults: defaults
            ).extensionPath,
            extensionDirectory.path
        )
    }

    func testApplyingSameExternalPathStillRequestsHotReload() {
        let samePath = "/tmp/custom-computer-strategy.ts"
        let decision = ComputerUseSettings.externalStrategyApplyDecision(
            submittedPath: "  \(samePath)  ",
            currentPath: samePath,
            computerUseEnabled: true,
            strategyKind: .external
        )
        XCTAssertEqual(decision.normalizedPath, samePath)
        XCTAssertFalse(decision.shouldPersist)
        XCTAssertTrue(decision.shouldRestartSessions)

        XCTAssertFalse(
            ComputerUseSettings.externalStrategyApplyDecision(
                submittedPath: samePath,
                currentPath: samePath,
                computerUseEnabled: false,
                strategyKind: .external
            ).shouldRestartSessions
        )
        XCTAssertFalse(
            ComputerUseSettings.externalStrategyApplyDecision(
                submittedPath: samePath,
                currentPath: samePath,
                computerUseEnabled: true,
                strategyKind: .builtIn
            ).shouldRestartSessions
        )
    }

    func testNestedStrategySurfaceUsesOnlyStableReservedToolNames() {
        XCTAssertEqual(
            ComputerUseSettings.requiredNestedStrategyToolNames,
            ["computer", "open_application"]
        )
    }

    func testRuntimeV1HandshakeAndVersionFailureAreStructured() throws {
        let descriptor = ComputerCaptureDescriptor(
            displayID: 7,
            outputSize: ComputerImageSize(width: 1440, height: 900),
            globalBounds: CGRect(x: -100, y: 20, width: 1728, height: 1117)
        )
        let response = ComputerRuntimeContract.capabilities(
            descriptor: descriptor,
            permissions: ComputerPermissionSnapshot(
                screenRecording: true,
                accessibility: false
            )
        )
        let protocolInfo = try XCTUnwrap(response["protocol"] as? [String: Any])
        XCTAssertEqual(
            protocolInfo["name"] as? String,
            "pipiui-computer-runtime"
        )
        XCTAssertEqual(protocolInfo["version"] as? Int, 1)
        XCTAssertTrue(
            (response["operations"] as? [String])?.contains(
                "computer_runtime_capabilities"
            ) == true
        )
        let features = try XCTUnwrap(response["features"] as? [String: Any])
        XCTAssertEqual(features["nativeOpenAIComputerCall"] as? Bool, false)
        let display = try XCTUnwrap(response["display"] as? [String: Any])
        XCTAssertEqual(display["id"] as? Int, 7)
        XCTAssertEqual(display["width"] as? Int, 1440)

        XCTAssertNil(ComputerRuntimeContract.validateVersion(J([
            "protocolVersion": 1,
        ])))
        let missing = try XCTUnwrap(
            ComputerRuntimeContract.validateVersion(J([:]))
        )
        let runtimeError = try XCTUnwrap(
            missing["runtimeError"] as? [String: Any]
        )
        XCTAssertEqual(
            runtimeError["code"] as? String,
            "unsupported_protocol_version"
        )
        XCTAssertEqual(runtimeError["retryable"] as? Bool, false)
    }

    func testLegacyRuntimeFailureGetsStableCompatibilityEnvelope() throws {
        let response = ComputerRuntimeContract.compatibilityEnvelope([
            "ok": false,
            "error": "permission missing",
        ])
        XCTAssertEqual(response["error"] as? String, "permission missing")
        XCTAssertEqual(response["errorCode"] as? String, "runtime_error")
        let runtimeError = try XCTUnwrap(
            response["runtimeError"] as? [String: Any]
        )
        XCTAssertEqual(runtimeError["code"] as? String, "runtime_error")
        XCTAssertEqual(runtimeError["message"] as? String, "permission missing")
    }

    func testKnownLowerLevelRuntimeErrorsGetExplicitSemantics() throws {
        let expectations: [(String, Bool, Bool)] = [
            ("computer_busy", true, false),
            ("computer_cancelled", true, true),
            ("request_cancelled", true, true),
            ("computer_target_missing", false, true),
            ("computer_target_lost", false, true),
            ("computer_outcome_unknown", false, true),
            ("user_handoff_required", true, true),
            ("cua_driver_error", false, true),
            ("invalid_application_target", false, false),
            ("invalid_computer_request", false, false),
        ]

        for (code, retryable, requiresObservation) in expectations {
            let response = ComputerRuntimeContract.compatibilityEnvelope([
                "ok": false,
                "errorCode": code,
                "error": "fixture",
            ])
            let runtimeError = try XCTUnwrap(
                response["runtimeError"] as? [String: Any]
            )
            XCTAssertEqual(
                runtimeError["retryable"] as? Bool,
                retryable,
                code
            )
            XCTAssertEqual(
                runtimeError["requiresObservation"] as? Bool,
                requiresObservation,
                code
            )
        }
    }

    func testOutcomeUnknownNeverAuthorizesBlindRetry() {
        XCTAssertEqual(
            ComputerRuntimeContract.errorSemantics(
                for: "computer_outcome_unknown"
            ),
            ComputerRuntimeErrorSemantics(
                retryable: false,
                requiresObservation: true
            )
        )
    }
}
