import XCTest
import CoreGraphics
import AppKit
@testable import PipiUI

final class ComputerOpenApplicationTests: XCTestCase {
    private final class State: @unchecked Sendable {
        private let lock = NSLock()
        private var currentApplication: ComputerApplicationIdentity?
        private var resolverCallCount = 0
        private var activationCallCount = 0
        private var screenshotCallCount = 0
        private var activationGeneration: UInt64 = 0
        private var runningCodeIdentityOverride:
            ComputerApplicationCodeIdentity?
        private var permissionSnapshotOverride:
            ComputerPermissionSnapshot?
        private var recordedAudits:
            [ComputerApplicationOpenAuditRecord] = []

        var frontmostApplication: ComputerApplicationIdentity? {
            lock.withLock { currentApplication }
        }

        var resolverCalls: Int {
            lock.withLock { resolverCallCount }
        }

        var activationCalls: Int {
            lock.withLock { activationCallCount }
        }

        var screenshotCalls: Int {
            lock.withLock { screenshotCallCount }
        }

        var generation: UInt64 {
            lock.withLock { activationGeneration }
        }

        var runningIdentityOverride: ComputerApplicationCodeIdentity? {
            lock.withLock { runningCodeIdentityOverride }
        }

        var permissionsOverride: ComputerPermissionSnapshot? {
            lock.withLock { permissionSnapshotOverride }
        }

        var auditOutcomes: [ComputerApplicationOpenAuditOutcome] {
            lock.withLock { recordedAudits.map(\.outcome) }
        }

        var auditRecords: [ComputerApplicationOpenAuditRecord] {
            lock.withLock { recordedAudits }
        }

        func setFrontmostApplication(
            _ application: ComputerApplicationIdentity?
        ) {
            lock.withLock { currentApplication = application }
        }

        func recordResolution() {
            lock.withLock { resolverCallCount += 1 }
        }

        func recordActivation() {
            lock.withLock { activationCallCount += 1 }
        }

        @discardableResult
        func recordScreenshot() -> Int {
            lock.withLock {
                screenshotCallCount += 1
                return screenshotCallCount
            }
        }

        func advanceActivationGeneration() {
            lock.withLock { activationGeneration &+= 1 }
        }

        func setRunningIdentityOverride(
            _ identity: ComputerApplicationCodeIdentity?
        ) {
            lock.withLock { runningCodeIdentityOverride = identity }
        }

        func setPermissionsOverride(
            _ snapshot: ComputerPermissionSnapshot?
        ) {
            lock.withLock { permissionSnapshotOverride = snapshot }
        }

        func recordAudit(_ record: ComputerApplicationOpenAuditRecord) {
            lock.withLock {
                recordedAudits.append(record)
            }
        }
    }

    private final class DeferredActivator: @unchecked Sendable {
        private let lock = NSLock()
        private var continuation:
            CheckedContinuation<ComputerActivatedApplication, Never>?

        func activate() async -> ComputerActivatedApplication {
            await withCheckedContinuation { continuation in
                lock.withLock {
                    self.continuation = continuation
                }
            }
        }

        var hasStarted: Bool {
            lock.withLock { continuation != nil }
        }

        func settle(_ result: ComputerActivatedApplication) {
            let pending = lock.withLock {
                let pending = continuation
                continuation = nil
                return pending
            }
            pending?.resume(returning: result)
        }
    }

    private final class DeferredThrowingActivator: @unchecked Sendable {
        private let lock = NSLock()
        private var continuation:
            CheckedContinuation<ComputerActivatedApplication, Error>?

        func activate() async throws -> ComputerActivatedApplication {
            try await withCheckedThrowingContinuation { continuation in
                lock.withLock {
                    self.continuation = continuation
                }
            }
        }

        var hasStarted: Bool {
            lock.withLock { continuation != nil }
        }

        func settle(throwing error: Error) {
            let pending = lock.withLock {
                let pending = continuation
                continuation = nil
                return pending
            }
            pending?.resume(throwing: error)
        }
    }

    private final class DeferredScreenshot: @unchecked Sendable {
        private let lock = NSLock()
        private var continuation:
            CheckedContinuation<ComputerScreenshot, Never>?

        func capture() async -> ComputerScreenshot {
            await withCheckedContinuation { continuation in
                lock.withLock {
                    self.continuation = continuation
                }
            }
        }

        var hasStarted: Bool {
            lock.withLock { continuation != nil }
        }

        func settle(_ screenshot: ComputerScreenshot) {
            let pending = lock.withLock {
                let pending = continuation
                continuation = nil
                return pending
            }
            pending?.resume(returning: screenshot)
        }
    }

    private let descriptor = ComputerCaptureDescriptor(
        displayID: 7,
        outputSize: ComputerImageSize(width: 100, height: 80),
        globalBounds: CGRect(x: 0, y: 0, width: 100, height: 80)
    )

    private func codeIdentity(
        bundleID: String = "com.example.OpenApplicationEditor",
        path: String = "/Applications/Example Editor.app",
        fileIdentifier: UInt64 = 101,
        signingIdentifier: String = "com.example.OpenApplicationEditor",
        teamIdentifier: String? = "EXAMPLETEAM",
        codeDirectoryHash: String = "abcdef0123456789"
    ) -> ComputerApplicationCodeIdentity {
        ComputerApplicationCodeIdentity(
            bundleID: bundleID,
            canonicalBundlePath: path,
            volumeIdentifier: 1,
            fileIdentifier: fileIdentifier,
            designatedRequirement:
                "identifier \"\(signingIdentifier)\" and anchor apple generic",
            signingIdentifier: signingIdentifier,
            teamIdentifier: teamIdentifier,
            codeDirectoryHash: codeDirectoryHash,
            leafCertificateSHA256: "0123456789abcdef"
        )
    }

    private func target(
        bundleID: String = "com.example.OpenApplicationEditor",
        name: String = "Example Editor",
        path: String? = nil,
        codeIdentity explicitIdentity:
            ComputerApplicationCodeIdentity? = nil
    ) -> ComputerResolvedApplication {
        let bundlePath = path ?? "/Applications/\(name).app"
        let identity = explicitIdentity ?? codeIdentity(
            bundleID: bundleID,
            path: bundlePath,
            signingIdentifier: bundleID
        )
        return ComputerResolvedApplication(
            bundleID: bundleID,
            name: name,
            applicationURL: URL(
                fileURLWithPath: bundlePath,
                isDirectory: true
            ),
            codeIdentity: identity
        )
    }

    private func identity(
        bundleID: String = "com.example.OpenApplicationEditor",
        name: String = "Example Editor",
        processID: Int32 = 42
    ) -> ComputerApplicationIdentity {
        ComputerApplicationIdentity(
            bundleID: bundleID,
            name: name,
            processID: processID,
            windowTitle: "Document"
        )
    }

    private func activated(
        _ application: ComputerApplicationIdentity,
        codeIdentity: ComputerApplicationCodeIdentity
    ) -> ComputerActivatedApplication {
        ComputerActivatedApplication(
            application: application,
            codeIdentity: codeIdentity
        )
    }

    private func request(
        bundleID: String,
        requestID: String = UUID().uuidString
    ) -> J {
        J([
            "requestID": requestID,
            "bundle_identifier": bundleID,
            "displayID": Int(descriptor.displayID),
            "displayWidth": descriptor.outputSize.width,
            "displayHeight": descriptor.outputSize.height,
        ])
    }

    private func coordinator(
        state: State,
        target: ComputerResolvedApplication,
        activatedApplication: ComputerApplicationIdentity,
        screenRecording: Bool = true,
        accessibility: Bool = true,
        enabled: Bool = true,
        setActivatedApplicationFrontmost: Bool = true,
        immediateCodeIdentity:
            ComputerApplicationCodeIdentity? = nil,
        immediateCodeIdentityError:
            ComputerApplicationCodeIdentityError? = nil,
        runningCodeIdentity:
            ComputerApplicationCodeIdentity? = nil,
        runningCodeIdentityError:
            ComputerApplicationCodeIdentityError? = nil,
        returnedCodeIdentity:
            ComputerApplicationCodeIdentity? = nil,
        screenshotWindowIDs: [CGWindowID] = [71],
        screenshotHook: (@Sendable () -> Void)? = nil,
        quarantineDelay: TimeInterval = 0.02,
        verificationTimeout: TimeInterval = 0.04,
        screenshotProviderOverride:
            (@Sendable (
                ComputerCaptureDescriptor,
                ComputerApplicationIdentity
            ) async throws -> ComputerScreenshot)? = nil,
        applicationActivatorOverride:
            (@Sendable (ComputerResolvedApplication) async throws
                -> ComputerActivatedApplication)? = nil
    ) -> ComputerCoordinator {
        ComputerCoordinator(
            supportsInputMonitoring: false,
            frontmostApplicationProvider: {
                state.frontmostApplication
            },
            targetProcessValidator: { application in
                application.processID > 0
            },
            applicationResolver: { requested in
                state.recordResolution()
                guard requested.caseInsensitiveCompare(target.bundleID)
                        == .orderedSame else {
                    throw ComputerApplicationLaunchError
                        .applicationNotFound(requested)
                }
                return target
            },
            applicationActivator: { resolved in
                if let applicationActivatorOverride {
                    return try await applicationActivatorOverride(resolved)
                }
                state.recordActivation()
                if setActivatedApplicationFrontmost {
                    state.setFrontmostApplication(activatedApplication)
                }
                return ComputerActivatedApplication(
                    application: activatedApplication,
                    codeIdentity:
                        returnedCodeIdentity ?? target.codeIdentity
                )
            },
            applicationCodeIdentityResolver: { _ in
                if let immediateCodeIdentityError {
                    throw immediateCodeIdentityError
                }
                return immediateCodeIdentity ?? target.codeIdentity
            },
            runningApplicationCodeIdentityResolver: { _, _ in
                if let runningCodeIdentityError {
                    throw runningCodeIdentityError
                }
                return state.runningIdentityOverride
                    ?? runningCodeIdentity
                    ?? target.codeIdentity
            },
            openApplicationPermissionProvider: {
                state.permissionsOverride ?? ComputerPermissionSnapshot(
                    screenRecording: screenRecording,
                    accessibility: accessibility
                )
            },
            openApplicationDescriptorProvider: { self.descriptor },
            openApplicationScreenshotProvider: {
                descriptor,
                application in
                state.recordScreenshot()
                if let screenshotProviderOverride {
                    return try await screenshotProviderOverride(
                        descriptor,
                        application
                    )
                }
                screenshotHook?()
                return ComputerScreenshot(
                    pngData: Data([0x89, 0x50, 0x4E, 0x47]),
                    imageSize: descriptor.outputSize,
                    displayID: descriptor.displayID,
                    app: application,
                    targetWindowIDs: screenshotWindowIDs
                )
            },
            computerUseEnabledProvider: { enabled },
            activationGenerationProvider: { state.generation },
            openApplicationAuditSink: { state.recordAudit($0) },
            openApplicationTimeout: 0.5,
            openApplicationVerificationTimeout: verificationTimeout,
            openApplicationPollInterval: 0.002,
            openApplicationQuarantineDelay: quarantineDelay
        )
    }

    private func authorize(
        _ target: ComputerResolvedApplication,
        sessionKey: String,
        coordinator: ComputerCoordinator
    ) {
        coordinator.sessionConsents.insert(sessionKey)
        coordinator.sessionAllowedApplicationIdentities[
            sessionKey,
            default: []
        ].insert(target.codeIdentity)
    }

    private func waitUntil(
        timeout: TimeInterval = 1,
        _ predicate: @escaping () -> Bool
    ) {
        let done = expectation(description: "condition became true")
        func poll() {
            if predicate() {
                done.fulfill()
            } else {
                DispatchQueue.main.asyncAfter(
                    deadline: .now() + 0.005,
                    execute: poll
                )
            }
        }
        poll()
        wait(for: [done], timeout: timeout)
    }

    func testExactBundleIdentifierRejectsPathsCommandsURLsAndNames() {
        XCTAssertNoThrow(
            try ComputerApplicationResolver.validateBundleIdentifier(
                "com.google.Chrome"
            )
        )
        let invalidValues = [
            "/Applications/Google Chrome.app",
            "open -a Google Chrome",
            "https://example.com",
            "Google Chrome",
            "com.google.Chrome ",
            "com..google.Chrome",
        ]
        for value in invalidValues {
            XCTAssertThrowsError(
                try ComputerApplicationResolver.validateBundleIdentifier(value),
                "must reject free-form target: \(value)"
            )
        }

        let state = State()
        let target = target()
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: identity()
        )
        coordinator.sessionConsents.insert("session")
        for value in invalidValues {
            var response: [String: Any] = [:]
            coordinator.handleOpenApplication(
                request: request(bundleID: value),
                sessionKey: "session"
            ) { response = $0 }
            XCTAssertEqual(response["ok"] as? Bool, false)
        }
        XCTAssertEqual(state.resolverCalls, 0)
        XCTAssertEqual(state.activationCalls, 0)
    }

    func testDuplicateLaunchServicesRegistrationsFailClosed() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(
            "pipiui-launch-registration-\(UUID().uuidString)",
            isDirectory: true
        )
        let authorized = root.appendingPathComponent(
            "Authorized.app",
            isDirectory: true
        )
        let collision = root.appendingPathComponent(
            "Collision.app",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: authorized,
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: collision,
            withIntermediateDirectories: true
        )
        defer { try? FileManager.default.removeItem(at: root) }

        XCTAssertThrowsError(
            try ComputerApplicationResolver.selectUnambiguousApplicationURL(
                bundleIdentifier: "com.example.editor",
                selectedURL: authorized,
                registeredURLs: [authorized, collision]
            )
        ) { error in
            guard case ComputerApplicationLaunchError
                    .ambiguousApplicationRegistration =
                    error else {
                return XCTFail("expected ambiguous registration, got \(error)")
            }
        }
        XCTAssertEqual(
            try ComputerApplicationResolver.selectUnambiguousApplicationURL(
                bundleIdentifier: "com.example.editor",
                selectedURL: authorized,
                registeredURLs: [authorized, authorized]
            ),
            authorized.standardizedFileURL.resolvingSymlinksInPath()
        )
    }

    func testSystemApplicationCodeIdentityUsesCanonicalFileAndSignature()
        throws {
        let textEdit = URL(
            fileURLWithPath: "/System/Applications/TextEdit.app",
            isDirectory: true
        )
        guard FileManager.default.fileExists(atPath: textEdit.path) else {
            throw XCTSkip("system TextEdit application is unavailable")
        }

        let resolved = try ComputerApplicationCodeIdentityResolver.resolve(
            bundleURL: textEdit
        )

        XCTAssertEqual(resolved.bundleID, "com.apple.TextEdit")
        XCTAssertEqual(
            resolved.canonicalBundlePath,
            textEdit.standardizedFileURL.resolvingSymlinksInPath().path
        )
        XCTAssertGreaterThan(resolved.fileIdentifier, 0)
        XCTAssertFalse(resolved.designatedRequirement.isEmpty)
        XCTAssertFalse(resolved.signingIdentifier.isEmpty)
        XCTAssertFalse(resolved.codeDirectoryHash.isEmpty)
    }

    func testRunningArchitectureIdentityRejectsDynamicCodeHashThatDiffersFromAuthorizedDiskIdentity()
        throws {
        let authorizedDiskIdentity = codeIdentity(
            codeDirectoryHash: "authorized-native-architecture"
        )
        let actualRunningArchitecture = codeIdentity(
            codeDirectoryHash: "different-running-architecture"
        )

        XCTAssertThrowsError(
            try ComputerApplicationCodeIdentityResolver
                .validateRunningIdentity(
                    expected: authorizedDiskIdentity,
                    actual: actualRunningArchitecture
                )
        ) { error in
            XCTAssertEqual(
                error as? ComputerApplicationCodeIdentityError,
                .runningArchitectureCodeIdentityMismatch
            )
        }
    }

    func testRunningArchitectureIdentityComparatorAcceptsOnlyExactAuthorizedIdentity()
        throws {
        let authorized = codeIdentity()
        XCTAssertEqual(
            try ComputerApplicationCodeIdentityResolver
                .validateRunningIdentity(
                    expected: authorized,
                    actual: authorized
                ),
            authorized
        )
    }

    func testRunningSystemApplicationIdentityComesFromValidatedDynamicCode()
        throws {
        guard let finder = NSRunningApplication.runningApplications(
            withBundleIdentifier: "com.apple.finder"
        ).first,
        let finderURL = finder.bundleURL else {
            throw XCTSkip("running Finder application is unavailable")
        }
        let authorized =
            try ComputerApplicationCodeIdentityResolver.resolve(
                bundleURL: finderURL
            )

        XCTAssertEqual(
            try ComputerApplicationCodeIdentityResolver
                .resolveRunningApplication(
                    processID: finder.processIdentifier,
                    expectedIdentity: authorized
                ),
            authorized
        )
    }

    func testSensitiveExactLaunchExecutesWithoutApproval() {
        let bundleID = "com.apple.Terminal"
        let target = target(bundleID: bundleID, name: "Terminal")
        let activatedApplication = identity(
            bundleID: bundleID,
            name: "Terminal",
            processID: 7
        )
        let state = State()
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: activatedApplication
        )

        let completed = expectation(description: "sensitive application opened")
        var response: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: bundleID),
            sessionKey: "session"
        ) {
            response = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(response["ok"] as? Bool, true)
        XCTAssertEqual(state.activationCalls, 1)
        XCTAssertEqual(state.screenshotCalls, 1)
        XCTAssertNil(coordinator.pendingApproval)
        XCTAssertTrue(coordinator.sessionAllowedApplicationIdentities.isEmpty)
    }

    func testUnknownBundleFailsClosedBeforeActivation() {
        let state = State()
        let coordinator = ComputerCoordinator(
            supportsInputMonitoring: false,
            applicationResolver: { requested in
                state.recordResolution()
                throw ComputerApplicationLaunchError
                    .applicationNotFound(requested)
            },
            applicationActivator: { _ in
                state.recordActivation()
                return self.activated(
                    self.identity(),
                    codeIdentity: self.codeIdentity()
                )
            },
            computerUseEnabledProvider: { true },
            openApplicationAuditSink: { state.recordAudit($0) }
        )
        coordinator.sessionConsents.insert("session")

        var response: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: "com.example.DoesNotExist"),
            sessionKey: "session"
        ) { response = $0 }

        XCTAssertEqual(response["ok"] as? Bool, false)
        XCTAssertTrue(
            (response["error"] as? String)?.contains(
                "no installed macOS application matches"
            ) == true
        )
        XCTAssertEqual(state.resolverCalls, 1)
        XCTAssertEqual(state.activationCalls, 0)
    }

    func testGlobalEnableFirstOrdinaryRequestLaunchesWithoutApprovalAndReleasesMutex()
        throws {
        let state = State()
        let target = target()
        let activatedApplication = identity()
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: activatedApplication
        )
        XCTAssertTrue(coordinator.hasConsent(for: "session"))
        XCTAssertNil(coordinator.pendingApproval)

        let acquired = Date()
        coordinator.leaseController = ComputerLeaseController(
            leaseDuration: 60,
            actionBudget: 10
        )
        let oldLease = try coordinator.leaseController.acquire(
            sessionKey: "session",
            targetBundleID: "com.example.PreviousTarget",
            actionCount: 2,
            now: acquired
        )
        coordinator.activeSessionKey = "session"
        coordinator.activeApplication = identity(
            bundleID: "com.example.PreviousTarget",
            name: "Previous Target",
            processID: 9
        )

        let completed = expectation(description: "application opened")
        var success: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "session"
        ) {
            success = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(success["ok"] as? Bool, true)
        XCTAssertTrue(coordinator.hasConsent(for: "session"))
        XCTAssertNil(coordinator.pendingApproval)
        XCTAssertTrue(
            coordinator.sessionAllowedApplicationIdentities["session"]?
                .isEmpty ?? true
        )
        XCTAssertEqual(success["openedApplication"] as? Bool, true)
        let foreground = success["foregroundApp"] as? [String: Any]
        XCTAssertEqual(foreground?["bundleID"] as? String, target.bundleID)
        XCTAssertEqual(
            foreground?["processID"] as? Int32,
            activatedApplication.processID
        )
        XCTAssertEqual(success["base64"] as? String, "iVBORw==")
        XCTAssertEqual(state.activationCalls, 1)
        XCTAssertEqual(state.screenshotCalls, 1)
        _ = oldLease
        XCTAssertNil(coordinator.leaseController.lease)
        XCTAssertNil(coordinator.activeSessionKey)
        XCTAssertNil(coordinator.activeApplication)
        XCTAssertNil(coordinator.inFlightApplicationOpen)
        XCTAssertEqual(state.auditOutcomes.last, .launched)
    }

    func testOrdinaryLaunchDoesNotCreatePerApplicationApprovalCatalog() {
        let state = State()
        let target = target()
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: identity()
        )
        let completed = expectation(description: "ordinary application opened")
        var response: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "session"
        ) {
            response = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(response["ok"] as? Bool, true)
        XCTAssertEqual(state.activationCalls, 1)
        XCTAssertNil(coordinator.pendingApproval)
        XCTAssertNil(coordinator.sessionAllowedApps["session"])
        XCTAssertNil(
            coordinator.sessionAllowedApplicationIdentities["session"]
        )
    }

    func testInvalidStaticCodeSignatureDoesNotBlockOpenApplication() {
        let state = State()
        let target = target()
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: identity(),
            immediateCodeIdentityError: .unsignedOrInvalidApplication(-67050)
        )
        authorize(target, sessionKey: "session", coordinator: coordinator)

        let completed = expectation(description: "invalid signature ignored")
        var response: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "session"
        ) {
            response = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(response["ok"] as? Bool, true)
        XCTAssertEqual(state.activationCalls, 1)
        XCTAssertEqual(state.screenshotCalls, 1)
        XCTAssertEqual(state.auditOutcomes.last, .launched)
    }

    func testReturnedSignatureMetadataDoesNotBlockExactBundleAndPID() {
        let state = State()
        let target = target()
        let collision = codeIdentity(
            bundleID: target.bundleID,
            path: "/tmp/Collision.app",
            fileIdentifier: 404,
            signingIdentifier: "com.attacker.collision",
            teamIdentifier: "ATTACKER",
            codeDirectoryHash: "collision"
        )
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: identity(),
            returnedCodeIdentity: collision
        )
        authorize(target, sessionKey: "session", coordinator: coordinator)

        let completed = expectation(description: "signature metadata ignored")
        var response: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "session"
        ) {
            response = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(response["ok"] as? Bool, true)
        XCTAssertEqual(state.activationCalls, 1)
        XCTAssertEqual(state.screenshotCalls, 1)
        XCTAssertNil(coordinator.leaseController.lease)
        XCTAssertEqual(state.auditOutcomes.last, .launched)
    }

    func testInvalidRunningCodeSignatureDoesNotBlockExactBundleAndPID() {
        let state = State()
        let target = target()
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: identity(processID: 77),
            runningCodeIdentityError: .runningCodeInvalid(-67050)
        )
        authorize(target, sessionKey: "session", coordinator: coordinator)

        let completed = expectation(description: "running signature ignored")
        var response: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "session"
        ) {
            response = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(response["ok"] as? Bool, true)
        XCTAssertEqual(state.screenshotCalls, 1)
        XCTAssertNil(coordinator.leaseController.lease)
        XCTAssertEqual(state.auditOutcomes.last, .launched)
    }

    func testLegacyAnotherSessionLeaseIsInertAndCleared()
        throws {
        let state = State()
        let target = target()
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: identity()
        )
        authorize(target, sessionKey: "requester", coordinator: coordinator)
        _ = try coordinator.leaseController.acquire(
            sessionKey: "owner",
            targetBundleID: "com.example.Owner",
            actionCount: 1,
            now: Date()
        )

        let completed = expectation(description: "legacy lease ignored")
        var response: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "requester"
        ) {
            response = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(response["ok"] as? Bool, true)
        XCTAssertEqual(state.resolverCalls, 1)
        XCTAssertEqual(state.activationCalls, 1)
        XCTAssertNil(coordinator.leaseController.lease)
    }

    func testLegacyPendingApprovalIsInert() {
        let state = State()
        let target = target()
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: identity()
        )
        authorize(target, sessionKey: "requester", coordinator: coordinator)
        let terminal = identity(
            bundleID: "com.apple.Terminal",
            name: "Terminal",
            processID: 99
        )
        coordinator.pendingApproval = ComputerCoordinator.PendingApproval(
            sessionKey: "owner",
            kind: .application(.init(
                application: terminal,
                codeIdentity: codeIdentity(
                    bundleID: terminal.bundleID,
                    path: "/System/Applications/Utilities/Terminal.app",
                    signingIdentifier: terminal.bundleID
                )
            ))
        )

        let completed = expectation(description: "legacy approval ignored")
        var response: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "requester"
        ) {
            response = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(response["ok"] as? Bool, true)
        XCTAssertEqual(state.activationCalls, 1)
    }

    func testConcurrentRetryIsBusyOnlyWhileLaunchIsActuallyInFlight() {
        let state = State()
        let target = target(
            bundleID: "com.apple.Terminal",
            name: "Terminal"
        )
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: identity(
                bundleID: target.bundleID,
                name: target.name
            )
        )

        let firstCompleted = expectation(description: "first launch completes")
        var first: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "session"
        ) {
            first = $0
            firstCompleted.fulfill()
        }

        var retry: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "session"
        ) { retry = $0 }

        XCTAssertEqual(retry["ok"] as? Bool, false)
        XCTAssertTrue(
            (retry["error"] as? String)?.contains("already opening")
                == true
        )
        wait(for: [firstCompleted], timeout: 1)
        XCTAssertEqual(first["ok"] as? Bool, true)
        XCTAssertNil(coordinator.inFlightApplicationOpen)
        XCTAssertNil(coordinator.activeSessionKey)
        XCTAssertNil(coordinator.pendingApproval)
        XCTAssertEqual(state.activationCalls, 1)
    }

    func testExactFrontmostBundleAndPIDMismatchFailsBeforeScreenshot() {
        let state = State()
        state.setFrontmostApplication(identity(processID: 43))
        let target = target()
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: identity(processID: 42),
            setActivatedApplicationFrontmost: false
        )
        authorize(target, sessionKey: "session", coordinator: coordinator)

        let completed = expectation(description: "focus mismatch")
        var response: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "session"
        ) {
            response = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(response["ok"] as? Bool, false)
        XCTAssertTrue(
            (response["error"] as? String)?.contains(
                "exact frontmost process"
            ) == true
        )
        XCTAssertEqual(state.activationCalls, 1)
        XCTAssertEqual(state.screenshotCalls, 0)
    }

    func testDisabledAndEitherMissingTCCPermissionFailBeforeLaunch() {
        let target = target()

        let disabledState = State()
        let disabled = coordinator(
            state: disabledState,
            target: target,
            activatedApplication: identity(),
            enabled: false
        )
        disabled.sessionConsents.insert("session")
        var disabledResponse: [String: Any] = [:]
        disabled.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "session"
        ) { disabledResponse = $0 }
        XCTAssertEqual(disabledResponse["ok"] as? Bool, false)
        XCTAssertTrue(
            (disabledResponse["error"] as? String)?.contains(
                "disabled globally"
            ) == true
        )
        XCTAssertEqual(disabledState.resolverCalls, 0)

        for permissions in [
            (screenRecording: false, accessibility: true),
            (screenRecording: true, accessibility: false),
        ] {
            let permissionState = State()
            let missingPermission = coordinator(
                state: permissionState,
                target: target,
                activatedApplication: identity(),
                screenRecording: permissions.screenRecording,
                accessibility: permissions.accessibility
            )
            authorize(
                target,
                sessionKey: "session",
                coordinator: missingPermission
            )
            var permissionResponse: [String: Any] = [:]
            missingPermission.handleOpenApplication(
                request: request(bundleID: target.bundleID),
                sessionKey: "session"
            ) { permissionResponse = $0 }
            XCTAssertEqual(permissionResponse["ok"] as? Bool, false)
            XCTAssertTrue(
                (permissionResponse["error"] as? String)?.contains(
                    "Screen Recording and Accessibility permissions"
                ) == true
            )
            XCTAssertEqual(permissionState.activationCalls, 0)
        }
    }

    func testActivationGenerationDriftAwayAndBackRejectsPixelsAndLease() {
        let state = State()
        let target = target()
        let activatedApplication = identity()
        let other = identity(
            bundleID: "com.example.Secret",
            name: "Secret",
            processID: 999
        )
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: activatedApplication,
            screenshotHook: {
                state.setFrontmostApplication(other)
                state.advanceActivationGeneration()
                state.setFrontmostApplication(activatedApplication)
            }
        )
        authorize(target, sessionKey: "session", coordinator: coordinator)

        let completed = expectation(description: "capture drift rejected")
        var response: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "session"
        ) {
            response = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(response["ok"] as? Bool, false)
        XCTAssertTrue(
            (response["error"] as? String)?.contains(
                "activation changed"
            ) == true
        )
        XCTAssertEqual(state.screenshotCalls, 1)
        XCTAssertNil(coordinator.leaseController.lease)
        XCTAssertNil(response["base64"])
    }

    func testScreenshotWithoutExactTargetWindowIsRejected() {
        let state = State()
        let target = target()
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: identity(),
            screenshotWindowIDs: []
        )
        authorize(target, sessionKey: "session", coordinator: coordinator)

        let completed = expectation(description: "window mismatch rejected")
        var response: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "session"
        ) {
            response = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(response["ok"] as? Bool, false)
        XCTAssertEqual(state.screenshotCalls, 1)
        XCTAssertNil(coordinator.leaseController.lease)
        XCTAssertNil(response["base64"])
    }

    func testCaptureReadinessRetriesTransientApplicationAndWindowMissesThenSucceeds() {
        let state = State()
        let target = target()
        let activatedApplication = identity()
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: activatedApplication,
            verificationTimeout: 0.08,
            screenshotProviderOverride: { descriptor, application in
                switch state.screenshotCalls {
                case 1:
                    throw ComputerScreenCaptureError
                        .targetApplicationUnavailable
                case 2:
                    throw ComputerScreenCaptureError
                        .targetWindowUnavailable
                default:
                    return ComputerScreenshot(
                        pngData: Data([0x89, 0x50, 0x4E, 0x47]),
                        imageSize: descriptor.outputSize,
                        displayID: descriptor.displayID,
                        app: application,
                        targetWindowIDs: [71]
                    )
                }
            }
        )
        authorize(target, sessionKey: "session", coordinator: coordinator)

        let completed = expectation(description: "transient capture converged")
        var response: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "session"
        ) {
            response = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(response["ok"] as? Bool, true)
        XCTAssertEqual(state.screenshotCalls, 3)
        XCTAssertEqual(response["base64"] as? String, "iVBORw==")
        XCTAssertNil(coordinator.leaseController.lease)
    }

    func testCaptureReadinessDoesNotRetryNonretryableError() {
        let state = State()
        let target = target()
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: identity(),
            screenshotProviderOverride: { _, _ in
                throw ComputerScreenCaptureError.encodingFailed
            }
        )
        authorize(target, sessionKey: "session", coordinator: coordinator)

        let completed = expectation(description: "capture failed once")
        var response: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "session"
        ) {
            response = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(response["ok"] as? Bool, false)
        XCTAssertTrue(
            (response["error"] as? String)?.contains(
                "failed to encode"
            ) == true
        )
        XCTAssertEqual(state.screenshotCalls, 1)
        XCTAssertNil(coordinator.leaseController.lease)
        XCTAssertNil(response["base64"])
    }

    func testCaptureRetryClassificationExcludesCaptureAndActivationDrift() {
        XCTAssertTrue(
            ComputerCoordinator.isRetryableOpenApplicationCaptureError(
                ComputerScreenCaptureError.targetApplicationUnavailable
            )
        )
        XCTAssertTrue(
            ComputerCoordinator.isRetryableOpenApplicationCaptureError(
                ComputerScreenCaptureError.targetWindowUnavailable
            )
        )
        for error in [
            ComputerScreenCaptureError.targetChangedDuringCapture,
            ComputerScreenCaptureError.activationChangedDuringCapture,
            ComputerScreenCaptureError.targetIdentityMismatch,
            ComputerScreenCaptureError.permissionMissing,
            ComputerScreenCaptureError.displayUnavailable,
            ComputerScreenCaptureError.encodingFailed,
        ] {
            XCTAssertFalse(
                ComputerCoordinator.isRetryableOpenApplicationCaptureError(
                    error
                ),
                "\(error) must fail closed without retry"
            )
        }
        XCTAssertFalse(
            ComputerCoordinator.isRetryableOpenApplicationCaptureError(
                ComputerCaptureDescriptorError.capturedSizeMismatch
            )
        )
    }

    func testCancellationDuringCaptureRetryRemainsGloballyQuarantined() {
        let state = State()
        let target = target()
        let activatedApplication = identity()
        let deferred = DeferredScreenshot()
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: activatedApplication,
            quarantineDelay: 0.06,
            verificationTimeout: 0.12,
            screenshotProviderOverride: { _, _ in
                if state.screenshotCalls == 1 {
                    throw ComputerScreenCaptureError
                        .targetApplicationUnavailable
                }
                return await deferred.capture()
            }
        )
        authorize(target, sessionKey: "first", coordinator: coordinator)
        authorize(target, sessionKey: "second", coordinator: coordinator)
        let requestID = UUID().uuidString
        var firstDidRespond = false
        coordinator.handleOpenApplication(
            request: request(
                bundleID: target.bundleID,
                requestID: requestID
            ),
            sessionKey: "first"
        ) { _ in firstDidRespond = true }
        waitUntil { deferred.hasStarted }

        coordinator.cancelRequest(
            requestID: requestID,
            sessionKey: "first"
        )
        XCTAssertNotNil(coordinator.inFlightApplicationOpen)
        deferred.settle(
            ComputerScreenshot(
                pngData: Data([1]),
                imageSize: descriptor.outputSize,
                displayID: descriptor.displayID,
                app: activatedApplication,
                targetWindowIDs: [71]
            )
        )

        let checkedQuarantine = expectation(
            description: "capture cancellation stayed busy"
        )
        var secondResponse: [String: Any] = [:]
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.01) {
            coordinator.handleOpenApplication(
                request: self.request(bundleID: target.bundleID),
                sessionKey: "second"
            ) { secondResponse = $0 }
            checkedQuarantine.fulfill()
        }
        wait(for: [checkedQuarantine], timeout: 1)

        XCTAssertNotNil(coordinator.inFlightApplicationOpen)
        XCTAssertEqual(secondResponse["ok"] as? Bool, false)
        XCTAssertTrue(
            (secondResponse["error"] as? String)?.contains(
                "another PipiUI session is opening"
            ) == true
        )
        waitUntil {
            coordinator.inFlightApplicationOpen == nil
        }
        XCTAssertFalse(firstDidRespond)
        XCTAssertEqual(state.screenshotCalls, 2)
        XCTAssertNil(coordinator.leaseController.lease)
        XCTAssertNil(coordinator.activeSessionKey)
        XCTAssertTrue(
            state.auditOutcomes.contains(.cancellationRequested)
        )
        XCTAssertTrue(
            state.auditOutcomes.contains(.cancellationSettled)
        )
    }

    func testFocusDriftDuringCaptureRetryFailsClosed() {
        let state = State()
        let target = target()
        let other = identity(
            bundleID: "com.example.Other",
            name: "Other",
            processID: 404
        )
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: identity(),
            screenshotProviderOverride: { _, _ in
                state.setFrontmostApplication(other)
                throw ComputerScreenCaptureError.targetWindowUnavailable
            }
        )
        authorize(target, sessionKey: "session", coordinator: coordinator)

        let completed = expectation(description: "focus drift rejected")
        var response: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "session"
        ) {
            response = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(response["ok"] as? Bool, false)
        XCTAssertTrue(
            (response["error"] as? String)?.contains(
                "exact frontmost process"
            ) == true
        )
        XCTAssertEqual(state.screenshotCalls, 1)
        XCTAssertNil(coordinator.leaseController.lease)
    }

    func testRunningSignatureFailureDuringCaptureRetryDoesNotBlock() {
        let state = State()
        let target = target()
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: identity(),
            runningCodeIdentityError: .runningCodeInvalid(-67050),
            screenshotProviderOverride: { _, _ in
                if state.screenshotCalls == 1 {
                    throw ComputerScreenCaptureError
                        .targetApplicationUnavailable
                }
                return ComputerScreenshot(
                    pngData: Data([0x89, 0x50, 0x4E, 0x47]),
                    imageSize: self.descriptor.outputSize,
                    displayID: self.descriptor.displayID,
                    app: state.frontmostApplication ?? self.identity(),
                    targetWindowIDs: [71]
                )
            }
        )
        authorize(target, sessionKey: "session", coordinator: coordinator)

        let completed = expectation(description: "signature failure ignored")
        var response: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "session"
        ) {
            response = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(response["ok"] as? Bool, true)
        XCTAssertEqual(state.screenshotCalls, 2)
        XCTAssertNil(coordinator.leaseController.lease)
    }

    func testTCCDriftDuringCaptureRetryFailsClosed() {
        let state = State()
        let target = target()
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: identity(),
            screenshotProviderOverride: { _, _ in
                state.setPermissionsOverride(
                    ComputerPermissionSnapshot(
                        screenRecording: false,
                        accessibility: true
                    )
                )
                throw ComputerScreenCaptureError
                    .targetApplicationUnavailable
            }
        )
        authorize(target, sessionKey: "session", coordinator: coordinator)

        let completed = expectation(description: "TCC drift rejected")
        var response: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "session"
        ) {
            response = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(response["ok"] as? Bool, false)
        XCTAssertTrue(
            (response["error"] as? String)?.contains(
                "permission changed"
            ) == true
        )
        XCTAssertEqual(state.screenshotCalls, 1)
        XCTAssertNil(coordinator.leaseController.lease)
    }

    func testCaptureReadinessDeadlineExhaustionFailsClosed() {
        let state = State()
        let target = target()
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: identity(),
            verificationTimeout: 0.025,
            screenshotProviderOverride: { _, _ in
                throw ComputerScreenCaptureError
                    .targetApplicationUnavailable
            }
        )
        authorize(target, sessionKey: "session", coordinator: coordinator)

        let completed = expectation(description: "capture retry expired")
        var response: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "session"
        ) {
            response = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(response["ok"] as? Bool, false)
        XCTAssertTrue(
            (response["error"] as? String)?.contains(
                "verification deadline"
            ) == true
        )
        XCTAssertGreaterThan(state.screenshotCalls, 1)
        XCTAssertNil(coordinator.leaseController.lease)
        XCTAssertNil(response["base64"])
    }

    func testCancelDuringFrontmostPollingKeepsSlotThroughLateFocusActivation() {
        let state = State()
        let target = target()
        let activatedApplication = identity()
        let otherApplication = identity(
            bundleID: "com.example.Other",
            name: "Other",
            processID: 900
        )
        state.setFrontmostApplication(otherApplication)
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: activatedApplication,
            setActivatedApplicationFrontmost: false,
            quarantineDelay: 0.06
        )
        authorize(target, sessionKey: "first", coordinator: coordinator)
        authorize(target, sessionKey: "second", coordinator: coordinator)
        let requestID = UUID().uuidString
        var firstDidRespond = false
        coordinator.handleOpenApplication(
            request: request(
                bundleID: target.bundleID,
                requestID: requestID
            ),
            sessionKey: "first"
        ) { _ in firstDidRespond = true }
        waitUntil {
            coordinator.inFlightApplicationOpen?.launchCallbackSettled
                == true
        }

        coordinator.cancelRequest(
            requestID: requestID,
            sessionKey: "first"
        )
        XCTAssertNotNil(coordinator.inFlightApplicationOpen)

        let checkedLateFocus = expectation(
            description: "late focus remained quarantined"
        )
        var secondResponse: [String: Any] = [:]
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.01) {
            state.setFrontmostApplication(activatedApplication)
            coordinator.handleOpenApplication(
                request: self.request(bundleID: target.bundleID),
                sessionKey: "second"
            ) { secondResponse = $0 }
            checkedLateFocus.fulfill()
        }
        wait(for: [checkedLateFocus], timeout: 1)

        XCTAssertNotNil(coordinator.inFlightApplicationOpen)
        XCTAssertEqual(secondResponse["ok"] as? Bool, false)
        XCTAssertTrue(
            (secondResponse["error"] as? String)?.contains(
                "another PipiUI session is opening"
            ) == true
        )
        waitUntil {
            coordinator.inFlightApplicationOpen == nil
        }

        XCTAssertFalse(firstDidRespond)
        XCTAssertEqual(state.screenshotCalls, 0)
        XCTAssertNil(coordinator.leaseController.lease)
        XCTAssertNil(coordinator.activeSessionKey)
        XCTAssertEqual(
            state.auditOutcomes.filter {
                $0 == .cancellationRequested
            }.count,
            1
        )
        XCTAssertEqual(
            state.auditOutcomes.filter {
                $0 == .cancellationSettled
            }.count,
            1
        )
        let settlement = state.auditRecords.first {
            $0.outcome == .cancellationSettled
        }
        XCTAssertEqual(settlement?.processID, activatedApplication.processID)
    }

    func testNonCancellableLateActivatorKeepsGlobalSlotQuarantined()
        throws {
        let state = State()
        let target = target()
        let activatedApplication = identity()
        let deferred = DeferredActivator()
        let coordinator = ComputerCoordinator(
            supportsInputMonitoring: false,
            frontmostApplicationProvider: {
                state.frontmostApplication
            },
            applicationResolver: { requested in
                state.recordResolution()
                guard requested == target.bundleID else {
                    throw ComputerApplicationLaunchError
                        .applicationNotFound(requested)
                }
                return target
            },
            applicationActivator: { _ in
                state.recordActivation()
                return await deferred.activate()
            },
            applicationCodeIdentityResolver: { _ in
                target.codeIdentity
            },
            runningApplicationCodeIdentityResolver: { _, _ in
                target.codeIdentity
            },
            openApplicationPermissionProvider: {
                ComputerPermissionSnapshot(
                    screenRecording: true,
                    accessibility: true
                )
            },
            openApplicationDescriptorProvider: { self.descriptor },
            openApplicationScreenshotProvider: {
                descriptor,
                application in
                state.recordScreenshot()
                return ComputerScreenshot(
                    pngData: Data([1]),
                    imageSize: descriptor.outputSize,
                    displayID: descriptor.displayID,
                    app: application,
                    targetWindowIDs: [91]
                )
            },
            computerUseEnabledProvider: { true },
            activationGenerationProvider: { state.generation },
            openApplicationAuditSink: { state.recordAudit($0) },
            openApplicationTimeout: 1,
            openApplicationVerificationTimeout: 0.04,
            openApplicationPollInterval: 0.002,
            openApplicationQuarantineDelay: 0.03
        )
        authorize(target, sessionKey: "first", coordinator: coordinator)
        authorize(target, sessionKey: "second", coordinator: coordinator)
        let requestID = UUID().uuidString
        var firstDidRespond = false
        coordinator.handleOpenApplication(
            request: request(
                bundleID: target.bundleID,
                requestID: requestID
            ),
            sessionKey: "first"
        ) { _ in firstDidRespond = true }
        waitUntil { deferred.hasStarted }

        coordinator.cancelRequest(
            requestID: requestID,
            sessionKey: "first"
        )

        XCTAssertNotNil(coordinator.inFlightApplicationOpen)
        XCTAssertTrue(coordinator.pausedSessionKeys.isEmpty)
        XCTAssertNil(coordinator.leaseController.lease)

        var secondResponse: [String: Any] = [:]
        coordinator.handleOpenApplication(
            request: request(bundleID: target.bundleID),
            sessionKey: "second"
        ) { secondResponse = $0 }
        XCTAssertEqual(secondResponse["ok"] as? Bool, false)
        XCTAssertTrue(
            (secondResponse["error"] as? String)?.contains(
                "another PipiUI session is opening"
            ) == true
        )
        XCTAssertEqual(state.activationCalls, 1)

        state.setFrontmostApplication(activatedApplication)
        deferred.settle(
            activated(
                activatedApplication,
                codeIdentity: target.codeIdentity
            )
        )
        waitUntil {
            coordinator.inFlightApplicationOpen == nil
        }

        XCTAssertFalse(firstDidRespond)
        XCTAssertEqual(state.screenshotCalls, 0)
        XCTAssertNil(coordinator.leaseController.lease)
        XCTAssertNil(coordinator.activeSessionKey)
        XCTAssertTrue(coordinator.pausedSessionKeys.isEmpty)
        XCTAssertTrue(
            coordinator.statusMessage?.contains("互斥槽已释放")
                == true
        )
        XCTAssertTrue(
            state.auditOutcomes.contains(.cancellationRequested)
        )
        XCTAssertTrue(
            state.auditOutcomes.contains(.cancellationSettled)
        )
        XCTAssertTrue(state.auditOutcomes.contains(.busy))
    }

    func testCancellationAuditRecordsLateLaunchCallbackErrorSettlement() {
        let state = State()
        let target = target()
        let deferred = DeferredThrowingActivator()
        let coordinator = coordinator(
            state: state,
            target: target,
            activatedApplication: identity(),
            quarantineDelay: 0.04,
            applicationActivatorOverride: { _ in
                state.recordActivation()
                return try await deferred.activate()
            }
        )
        authorize(target, sessionKey: "session", coordinator: coordinator)
        let requestID = UUID().uuidString
        var didRespond = false
        coordinator.handleOpenApplication(
            request: request(
                bundleID: target.bundleID,
                requestID: requestID
            ),
            sessionKey: "session"
        ) { _ in didRespond = true }
        waitUntil { deferred.hasStarted }

        coordinator.cancelRequest(
            requestID: requestID,
            sessionKey: "session"
        )
        XCTAssertEqual(
            state.auditOutcomes.filter {
                $0 == .cancellationRequested
            }.count,
            1
        )
        deferred.settle(
            throwing: ComputerApplicationLaunchError.launchFailed(
                "expected callback failure"
            )
        )
        waitUntil {
            coordinator.inFlightApplicationOpen == nil
        }

        XCTAssertFalse(didRespond)
        XCTAssertEqual(state.screenshotCalls, 0)
        XCTAssertNil(coordinator.leaseController.lease)
        XCTAssertEqual(
            state.auditOutcomes.filter {
                $0 == .cancellationCallbackFailed
            }.count,
            1
        )
        let settlement = state.auditRecords.first {
            $0.outcome == .cancellationCallbackFailed
        }
        XCTAssertNil(settlement?.processID)
    }

    func testOpenApplicationAuditOmitsPathsRequirementsPixelsAndText()
        throws {
        let secretIdentity = codeIdentity(
            path: "/Applications/TOP-SECRET-PATH.app",
            signingIdentifier: "com.example.signing",
            teamIdentifier: "TEAMSECRET",
            codeDirectoryHash: "code-hash-secret"
        )
        let secretTarget = target(
            path: secretIdentity.canonicalBundlePath,
            codeIdentity: ComputerApplicationCodeIdentity(
                bundleID: secretIdentity.bundleID,
                canonicalBundlePath: secretIdentity.canonicalBundlePath,
                volumeIdentifier: secretIdentity.volumeIdentifier,
                fileIdentifier: secretIdentity.fileIdentifier,
                designatedRequirement:
                    "identifier \"RAW-REQUIREMENT-TOKEN\"",
                signingIdentifier: secretIdentity.signingIdentifier,
                teamIdentifier: secretIdentity.teamIdentifier,
                codeDirectoryHash: secretIdentity.codeDirectoryHash,
                leafCertificateSHA256:
                    secretIdentity.leafCertificateSHA256
            )
        )
        let record = ComputerApplicationOpenAuditRecord(
            timestamp: Date(timeIntervalSince1970: 1_000),
            auditSessionID: "random-audit-session",
            target: secretTarget,
            processID: 42,
            outcome: .cancellationSettled,
            focusDrift: true,
            cancelled: true
        )
        let data = try record.encodedData()
        let string = try XCTUnwrap(String(data: data, encoding: .utf8))
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )

        XCTAssertEqual(object["operation"] as? String, "open_application")
        XCTAssertEqual(
            object["outcome"] as? String,
            "cancellation_settled"
        )
        XCTAssertEqual(object["processID"] as? Int, 42)
        XCTAssertNotNil(object["codeIdentity"])
        XCTAssertNil(object["appName"])
        XCTAssertNil(object["canonicalBundlePath"])
        XCTAssertNil(object["designatedRequirement"])
        XCTAssertNil(object["base64"])
        XCTAssertNil(object["text"])
        XCTAssertNil(object["requestID"])
        XCTAssertFalse(string.contains("TOP-SECRET-PATH"))
        XCTAssertFalse(string.contains("RAW-REQUIREMENT-TOKEN"))
        XCTAssertFalse(string.contains("iVBOR"))
    }
}
