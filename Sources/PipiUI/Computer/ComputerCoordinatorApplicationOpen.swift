import Foundation

final class ComputerOpenApplicationExecution {
    let requestID: String
    let sessionKey: String
    let target: ComputerResolvedApplication
    let gate = ComputerExecutionGate()
    let reply: ComputerResponseGate
    var timeoutWork: DispatchWorkItem?
    var task: Task<Void, Never>?
    var launchCommitted = false
    var launchCallbackSettled = false
    var sideEffectsSettled = false
    var cancellationRequested = false
    var cancellationReason: String?
    var activatedApplication: ComputerApplicationIdentity?
    var terminalAuditRecorded = false
    var cancellationRequestAuditRecorded = false
    var cancellationSettlementAuditRecorded = false

    init(
        requestID: String,
        sessionKey: String,
        target: ComputerResolvedApplication,
        reply: ComputerResponseGate
    ) {
        self.requestID = requestID
        self.sessionKey = sessionKey
        self.target = target
        self.reply = reply
    }
}

extension ComputerCoordinator {
    func handleOpenApplication(
        request rawRequest: J,
        sessionKey: String,
        respond: @escaping ([String: Any]) -> Void
    ) {
        let reply = ComputerResponseGate(respond)
        guard let requestID = rawRequest["requestID"].string,
              UUID(uuidString: requestID) != nil else {
            rejectOpenApplication(
                reply: reply,
                sessionKey: sessionKey,
                target: nil,
                reason: "open_application request is missing a valid requestID"
            )
            return
        }
        guard guardSessionAuthorization(
            sessionKey: sessionKey,
            reply: reply
        ) else {
            recordOpenApplicationAudit(
                sessionKey: sessionKey,
                target: nil,
                application: nil,
                outcome: .rejected
            )
            return
        }
        if cuaDriver != nil {
            handleCuaOpenApplication(
                request: rawRequest,
                requestID: requestID,
                sessionKey: sessionKey,
                reply: reply
            )
            return
        }
        guard let requestedBundleID =
                rawRequest["bundle_identifier"].string else {
            rejectOpenApplication(
                reply: reply,
                sessionKey: sessionKey,
                target: nil,
                reason: ComputerApplicationLaunchError
                    .invalidBundleIdentifier.localizedDescription
            )
            return
        }
        do {
            try ComputerApplicationResolver.validateBundleIdentifier(
                requestedBundleID
            )
        } catch {
            rejectOpenApplication(
                reply: reply,
                sessionKey: sessionKey,
                target: nil,
                reason: error.localizedDescription
            )
            return
        }

        if let reason = openApplicationBusyReason(
            sessionKey: sessionKey,
            target: nil,
            includePendingApproval: false
        ) {
            rejectOpenApplication(
                reply: reply,
                sessionKey: sessionKey,
                target: nil,
                reason: reason,
                outcome: .busy
            )
            return
        }

        let target: ComputerResolvedApplication
        do {
            target = try applicationResolver(requestedBundleID)
            guard target.bundleID.caseInsensitiveCompare(requestedBundleID)
                    == .orderedSame else {
                throw ComputerApplicationLaunchError.resolvedBundleMismatch(
                    expected: requestedBundleID,
                    actual: target.bundleID
                )
            }
        } catch {
            rejectOpenApplication(
                reply: reply,
                sessionKey: sessionKey,
                target: nil,
                reason: error.localizedDescription
            )
            return
        }

        if let reason = openApplicationBusyReason(
            sessionKey: sessionKey,
            target: target,
            includePendingApproval: true
        ) {
            rejectOpenApplication(
                reply: reply,
                sessionKey: sessionKey,
                target: target,
                reason: reason,
                outcome: .busy
            )
            return
        }
        guard openApplicationPermissionProvider().isReady else {
            statusMessage = "缺少屏幕录制或辅助功能权限。"
            rejectOpenApplication(
                reply: reply,
                sessionKey: sessionKey,
                target: target,
                reason: "Screen Recording and Accessibility permissions are required for open_application"
            )
            return
        }

        let descriptor: ComputerCaptureDescriptor
        do {
            descriptor = try openApplicationDescriptorProvider()
            try descriptor.validateAdvertisement(
                displayID: rawRequest["displayID"].int,
                width: rawRequest["displayWidth"].int,
                height: rawRequest["displayHeight"].int
            )
        } catch {
            rejectOpenApplication(
                reply: reply,
                sessionKey: sessionKey,
                target: target,
                reason: error.localizedDescription
            )
            return
        }

        beginOpenApplication(
            requestID: requestID,
            sessionKey: sessionKey,
            target: target,
            descriptor: descriptor,
            reply: reply
        )
    }

    func openApplicationBusyReason(
        sessionKey: String,
        target: ComputerResolvedApplication?,
        includePendingApproval: Bool
    ) -> String? {
        if let execution = inFlightExecution {
            return execution.sessionKey == sessionKey
                ? "computer busy: this session already has a batch in flight"
                : "computer busy: another PipiUI session owns the desktop"
        }
        if let opening = inFlightApplicationOpen {
            return opening.sessionKey == sessionKey
                ? "computer busy: this session is already opening an application"
                : "computer busy: another PipiUI session is opening an application"
        }
        _ = target
        _ = includePendingApproval
        return nil
    }

    func beginOpenApplication(
        requestID: String,
        sessionKey: String,
        target: ComputerResolvedApplication,
        descriptor: ComputerCaptureDescriptor,
        reply: ComputerResponseGate
    ) {
        do {
            try validateOpenApplicationContext(
                sessionKey: sessionKey,
                target: target,
                descriptor: descriptor
            )
        } catch {
            rejectOpenApplication(
                reply: reply,
                sessionKey: sessionKey,
                target: target,
                reason: error.localizedDescription
            )
            return
        }
        guard inFlightExecution == nil,
              inFlightApplicationOpen == nil else {
            rejectOpenApplication(
                reply: reply,
                sessionKey: sessionKey,
                target: target,
                reason: "computer busy: another desktop operation started",
                outcome: .busy
            )
            return
        }
        // Unrestricted mode uses only the actual in-flight execution object as
        // its mutex. Discard stale compatibility lease state.
        _ = leaseController.release()

        let execution = ComputerOpenApplicationExecution(
            requestID: requestID,
            sessionKey: sessionKey,
            target: target,
            reply: reply
        )
        // A prior batch may still be inside the presentation grace window.
        cancelDesktopPresentationGrace()
        inFlightApplicationOpen = execution
        activeSessionKey = sessionKey
        activeApplication = target.authorizationIdentity
        activeWindowID = nil
        isDesktopOperationActive = true
        remainingActions = nil
        scheduleOpenApplicationTimeout(execution)
        statusMessage = "正在通过 NSWorkspace 打开 \(target.name)。"
        Task { @MainActor in
            ComputerUseWindowPresentation.shared.update(for: self)
        }
        refreshInputMonitoring()

        execution.task = Task { @MainActor [weak self, weak execution] in
            guard let self, let execution,
                  self.openApplicationIsCurrent(execution) else { return }
            execution.launchCommitted = true

            let activated: ComputerActivatedApplication
            do {
                activated = try await self.applicationActivator(target)
            } catch {
                execution.launchCallbackSettled = true
                if execution.cancellationRequested {
                    await self.settleCancelledOpenApplication(
                        execution,
                        activated: nil,
                        callbackFailed: true
                    )
                } else {
                    await self.settleFailedOpenApplication(
                        execution,
                        reason: error.localizedDescription,
                        focusDrift: false,
                        callbackFailed: true
                    )
                }
                return
            }

            execution.launchCallbackSettled = true
            execution.activatedApplication = activated.application
            if execution.cancellationRequested {
                await self.settleCancelledOpenApplication(
                    execution,
                    activated: activated.application
                )
                return
            }

            do {
                let verificationDeadline = Date().addingTimeInterval(
                    self.openApplicationVerificationTimeout
                )
                guard activated.application.processID > 0,
                      activated.application.normalizedBundleID
                        == target.bundleID.lowercased() else {
                    throw ComputerApplicationLaunchError.invalidLaunchedProcess
                }
                try self.validateOpenApplicationContext(
                    sessionKey: sessionKey,
                    target: target,
                    descriptor: descriptor
                )
                let frontmost = try await self.waitForExactFrontmostApplication(
                    activated.application,
                    execution: execution,
                    deadline: verificationDeadline
                )
                try self.verifyRunningApplicationIdentity(
                    frontmost,
                    target: target
                )
                try self.validateOpenApplicationContext(
                    sessionKey: sessionKey,
                    target: target,
                    descriptor: descriptor
                )
                let captureGeneration = self.activationGenerationProvider()
                let (finalApplication, screenshot) =
                    try await self.captureOpenApplicationScreenshotWhenReady(
                        expectedApplication: frontmost,
                        sessionKey: sessionKey,
                        target: target,
                        descriptor: descriptor,
                        execution: execution,
                        deadline: verificationDeadline,
                        activationGeneration: captureGeneration
                    )
                self.finishOpenApplication(
                    execution,
                    application: finalApplication,
                    screenshot: screenshot
                )
            } catch {
                if execution.cancellationRequested {
                    await self.settleCancelledOpenApplication(
                        execution,
                        activated: execution.activatedApplication
                    )
                } else {
                    await self.settleFailedOpenApplication(
                        execution,
                        reason: error.localizedDescription,
                        focusDrift: error is ComputerScreenCaptureError
                    )
                }
            }
        }
    }

    func validateOpenApplicationContext(
        sessionKey: String,
        target: ComputerResolvedApplication,
        descriptor: ComputerCaptureDescriptor
    ) throws {
        guard computerUseEnabledProvider(),
              !emergencyStopped else {
            throw ComputerRequestError.invalidRequest(
                "computer authorization changed during application launch"
            )
        }
        guard openApplicationPermissionProvider().isReady else {
            throw ComputerRequestError.invalidRequest(
                "Screen Recording or Accessibility permission changed during application launch"
            )
        }
        _ = sessionKey
        _ = target
        guard try openApplicationDescriptorProvider() == descriptor else {
            throw ComputerCaptureDescriptorError.providerDescriptorMismatch
        }
    }

    func isExactLaunchIdentityAllowed(
        _ target: ComputerResolvedApplication,
        sessionKey: String
    ) -> Bool {
        _ = target
        _ = sessionKey
        return true
    }

    func verifyRunningApplicationIdentity(
        _ application: ComputerApplicationIdentity,
        target: ComputerResolvedApplication
    ) throws {
        guard application.processID > 0,
              application.normalizedBundleID
                == target.bundleID.lowercased(),
              targetProcessValidator(application) else {
            throw ComputerApplicationLaunchError.invalidLaunchedProcess
        }
    }

    @MainActor
    func waitForExactFrontmostApplication(
        _ activated: ComputerApplicationIdentity,
        execution: ComputerOpenApplicationExecution,
        deadline: Date
    ) async throws -> ComputerApplicationIdentity {
        while Date() < deadline {
            guard openApplicationIsCurrent(execution),
                  !execution.cancellationRequested else {
                throw ComputerApplicationLaunchError.cancelled
            }
            if let current = frontmostApplicationProvider(),
               Self.sameProcess(current, activated) {
                return current
            }
            try await Task.sleep(
                nanoseconds: UInt64(
                    openApplicationPollInterval * 1_000_000_000
                )
            )
        }
        throw ComputerApplicationLaunchError.frontmostVerificationTimedOut
    }

    @MainActor
    func captureOpenApplicationScreenshotWhenReady(
        expectedApplication: ComputerApplicationIdentity,
        sessionKey: String,
        target: ComputerResolvedApplication,
        descriptor: ComputerCaptureDescriptor,
        execution: ComputerOpenApplicationExecution,
        deadline: Date,
        activationGeneration: UInt64
    ) async throws -> (
        application: ComputerApplicationIdentity,
        screenshot: ComputerScreenshot
    ) {
        while true {
            let current = try validateOpenApplicationCaptureAttempt(
                expectedApplication: expectedApplication,
                sessionKey: sessionKey,
                target: target,
                descriptor: descriptor,
                execution: execution,
                deadline: deadline,
                activationGeneration: activationGeneration
            )
            do {
                let screenshot =
                    try await openApplicationScreenshotProvider(
                        descriptor,
                        current
                    )
                let finalApplication =
                    try validateOpenApplicationCaptureAttempt(
                        expectedApplication: expectedApplication,
                        sessionKey: sessionKey,
                        target: target,
                        descriptor: descriptor,
                        execution: execution,
                        deadline: deadline,
                        activationGeneration: activationGeneration
                    )
                guard Self.sameProcess(screenshot.app, finalApplication),
                      !screenshot.targetWindowIDs.isEmpty else {
                    throw ComputerScreenCaptureError.targetIdentityMismatch
                }
                return (finalApplication, screenshot)
            } catch {
                if execution.cancellationRequested
                    || !openApplicationIsCurrent(execution) {
                    throw ComputerApplicationLaunchError.cancelled
                }
                guard Self.isRetryableOpenApplicationCaptureError(error) else {
                    throw error
                }

                // Revalidate the complete safety context before allowing the
                // transient SCK readiness miss to become a retry.
                _ = try validateOpenApplicationCaptureAttempt(
                    expectedApplication: expectedApplication,
                    sessionKey: sessionKey,
                    target: target,
                    descriptor: descriptor,
                    execution: execution,
                    deadline: deadline,
                    activationGeneration: activationGeneration
                )
                let remaining = deadline.timeIntervalSinceNow
                guard remaining > 0 else {
                    throw ComputerApplicationLaunchError
                        .screenshotReadinessTimedOut
                }
                try await Task.sleep(
                    nanoseconds: UInt64(
                        min(openApplicationPollInterval, remaining)
                            * 1_000_000_000
                    )
                )
            }
        }
    }

    func validateOpenApplicationCaptureAttempt(
        expectedApplication: ComputerApplicationIdentity,
        sessionKey: String,
        target: ComputerResolvedApplication,
        descriptor: ComputerCaptureDescriptor,
        execution: ComputerOpenApplicationExecution,
        deadline: Date,
        activationGeneration: UInt64
    ) throws -> ComputerApplicationIdentity {
        guard Date() < deadline else {
            throw ComputerApplicationLaunchError.screenshotReadinessTimedOut
        }
        guard openApplicationIsCurrent(execution),
              !execution.cancellationRequested else {
            throw ComputerApplicationLaunchError.cancelled
        }
        try validateOpenApplicationContext(
            sessionKey: sessionKey,
            target: target,
            descriptor: descriptor
        )
        guard let current = frontmostApplicationProvider(),
              Self.sameProcess(current, expectedApplication) else {
            throw ComputerApplicationLaunchError
                .frontmostVerificationTimedOut
        }
        try verifyRunningApplicationIdentity(current, target: target)
        guard activationGenerationProvider() == activationGeneration else {
            throw ComputerScreenCaptureError.activationChangedDuringCapture
        }
        return current
    }

    static func isRetryableOpenApplicationCaptureError(
        _ error: Error
    ) -> Bool {
        guard let error = error as? ComputerScreenCaptureError else {
            return false
        }
        switch error {
        case .targetApplicationUnavailable, .targetWindowUnavailable:
            return true
        case .permissionMissing,
             .displayUnavailable,
             .encodingFailed,
             .frontmostApplicationUnavailable,
             .targetIdentityMismatch,
             .targetChangedDuringCapture,
             .activationChangedDuringCapture:
            return false
        }
    }
}
