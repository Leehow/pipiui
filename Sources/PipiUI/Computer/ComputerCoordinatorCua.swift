import Foundation
import AppKit

extension ComputerCoordinator {
    static let cuaMaximumAccessibilityElements = 256
    static let cuaMaximumAccessibilityDepth = 12

    func handleCuaOpenApplication(
        request: J,
        requestID: String,
        sessionKey: String,
        reply: ComputerResponseGate
    ) {
        guard let cuaDriver else { return }
        let bundleIdentifier = request["bundle_identifier"].string?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let applicationName = request["application_name"].string?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard bundleIdentifier?.isEmpty == false
                || applicationName?.isEmpty == false else {
            reply.respond(Self.cuaFailure(
                code: "invalid_application_target",
                message: "open_application requires bundle_identifier or application_name"
            ))
            return
        }
        if let bundleIdentifier {
            let hostMatch = hostSelfProtection.match(
                processID: 0,
                bundleID: bundleIdentifier
            )
            guard !hostMatch.isHost else {
                _ = rejectHostControl(actionKind: .screenshot, match: hostMatch)
                reply.respond(Self.cuaFailure(
                    code: ComputerHostSelfProtectionError.code,
                    message: ComputerHostSelfProtectionError.hostTarget
                        .localizedDescription
                ))
                return
            }
        }
        guard beginCuaOperation(
            requestID: requestID,
            sessionKey: sessionKey,
            reply: reply
        ) else { return }

        let operation = cuaInFlightOperation!
        operation.task = Task { @MainActor [weak self, weak operation] in
            guard let self, let operation else { return }
            do {
                let descriptor = try self.validatedCuaDescriptor(request)
                _ = try await cuaDriver.call(
                    tool: "start_session",
                    arguments: [
                        "session": sessionKey,
                        "capture_scope": "window",
                    ]
                )
                var launchArguments: [String: Any] = [:]
                if let bundleIdentifier, !bundleIdentifier.isEmpty {
                    launchArguments["bundle_id"] = bundleIdentifier
                } else if let applicationName, !applicationName.isEmpty {
                    launchArguments["name"] = applicationName
                }
                let launched = try await cuaDriver.call(
                    tool: "launch_app",
                    arguments: launchArguments
                )
                try Task.checkCancellation()
                let structured = launched.structuredContent
                guard let processID = Self.cuaProcessID(
                    structured["pid"]
                ) else {
                    throw CuaIntegrationError.invalidLaunchResult
                }
                let resolvedBundleID =
                    structured["bundle_id"] as? String
                    ?? bundleIdentifier
                    ?? ""
                if let bundleIdentifier,
                   !bundleIdentifier.isEmpty,
                   resolvedBundleID.caseInsensitiveCompare(bundleIdentifier)
                    != .orderedSame {
                    throw CuaIntegrationError.bundleMismatch(
                        expected: bundleIdentifier,
                        actual: resolvedBundleID
                    )
                }
                let resolvedName =
                    structured["name"] as? String
                    ?? applicationName
                    ?? resolvedBundleID
                guard !resolvedBundleID.isEmpty else {
                    throw CuaIntegrationError.invalidLaunchResult
                }
                let hostMatch = self.hostSelfProtection.match(
                    processID: processID,
                    bundleID: resolvedBundleID
                )
                guard !hostMatch.isHost else {
                    _ = self.rejectHostControl(
                        actionKind: .screenshot,
                        match: hostMatch
                    )
                    throw ComputerHostSelfProtectionError.hostTarget
                }

                var windows = Self.cuaWindows(
                    structured["windows"],
                    processID: processID
                )
                if windows.isEmpty {
                    windows = try await self.listCuaWindows(
                        processID: processID,
                        driver: cuaDriver
                    )
                }
                guard let primary = Self.preferredCuaWindow(in: windows) else {
                    throw CuaIntegrationError.invalidLaunchResult
                }

                _ = try await cuaDriver.call(
                    tool: "bring_to_front",
                    arguments: [
                        "pid": processID,
                        "window_id": primary.windowID,
                    ]
                )
                let stateResult = try await cuaDriver.call(
                    tool: "get_window_state",
                    arguments: [
                        "session": sessionKey,
                        "pid": processID,
                        "window_id": primary.windowID,
                        "max_elements":
                            Self.cuaMaximumAccessibilityElements,
                        "max_depth":
                            Self.cuaMaximumAccessibilityDepth,
                    ]
                )
                let state = try CuaWindowState(result: stateResult)
                let transform = try CuaScreenshotTransform(
                    sourceSize: state.sourceSize,
                    advertisedSize: descriptor.outputSize
                )
                let advertisedPNG = try transform.renderAdvertisedPNG(
                    base64: state.base64
                )
                let target = CuaComputerTarget(
                    id: UUID(),
                    bundleID: resolvedBundleID,
                    name: resolvedName,
                    processID: processID,
                    windowIDs: windows.map(\.windowID),
                    primaryWindowID: primary.windowID,
                    revision: 0,
                    screenshotIdentity: state.screenshotIdentity,
                    elementTokens: state.elementTokens,
                    transform: transform
                )
                guard self.cuaOperationIsCurrent(operation) else { return }
                self.cuaSessionTargets[sessionKey] = target
                self.finishCuaOperation(operation)
                let observedForeground =
                    self.frontmostApplicationProvider()
                let expectedForeground = target.applicationIdentity
                self.statusMessage =
                    "已通过 Cua Driver 打开 \(resolvedName) 并固定精确窗口目标。"
                var openResponse: [String: Any] = [
                    "ok": true,
                    "openedApplication": true,
                    "focusDrift": observedForeground.map {
                        !Self.sameProcess($0, expectedForeground)
                    } ?? true,
                    "foregroundApp": Self.cuaForegroundValue(
                        observedForeground
                    ),
                    "windowTitle":
                        observedForeground?.windowTitle ?? primary.title,
                    "displayID": descriptor.displayID,
                    "width": descriptor.outputSize.width,
                    "height": descriptor.outputSize.height,
                    "target": target.dictionary,
                    "screenshotTarget": target.screenshotDictionary,
                    "accessibility": state.accessibility,
                ]
                ComputerScreenshotMemoryCache.attach(
                    to: &openResponse,
                    base64PNG: advertisedPNG
                )
                reply.respond(openResponse)
            } catch is CancellationError {
                self.finishCancelledCuaOperation(operation)
            } catch {
                self.failCuaOperation(
                    operation,
                    error: error,
                    clearTarget: false
                )
            }
        }
    }

    func handleCuaBatch(
        request rawRequest: J,
        requestID: String,
        sessionKey: String,
        reply: ComputerResponseGate
    ) {
        guard let cuaDriver else { return }
        let request: ComputerRequest
        do {
            request = try ComputerRequest.normalize(rawRequest)
        } catch {
            reply.respond(Self.cuaFailure(
                code: "invalid_computer_request",
                message: error.localizedDescription
            ))
            return
        }
        guard guardPermissions(for: request, reply: reply) else { return }
        guard let target = cuaSessionTargets[sessionKey] else {
            reply.respond(Self.cuaFailure(
                code: "computer_target_missing",
                message: CuaIntegrationError.targetMissing.localizedDescription
            ))
            return
        }
        guard beginCuaOperation(
            requestID: requestID,
            sessionKey: sessionKey,
            reply: reply
        ) else { return }

        let operation = cuaInFlightOperation!
        operation.task = Task { @MainActor [weak self, weak operation] in
            guard let self, let operation else { return }
            let foregroundBefore = self.frontmostApplicationProvider()
            var outcomes: [ComputerActionOutcome] = []
            var completedMutation = false
            do {
                let descriptor = try self.validatedCuaDescriptor(rawRequest)
                var currentTarget = try await self.reconcileCuaTarget(
                    target,
                    sessionKey: sessionKey,
                    driver: cuaDriver
                )
                let steps = try CuaActionMapper.steps(
                    actions: request.actions,
                    target: currentTarget,
                    session: sessionKey
                )
                var batchError: String?
                for step in steps {
                    try Task.checkCancellation()
                    if step.sourceIndexes.contains(where: {
                        request.actions[$0].emitsInput
                    }) {
                        try self.ensureCuaNativeInputAllowed(
                            target: currentTarget,
                            sessionKey: sessionKey,
                            actionKind: step.kind
                        )
                    }
                    do {
                        var evidence: [String: Any]?
                        if let tool = step.tool {
                            let result = try await cuaDriver.call(
                                tool: tool,
                                arguments: step.arguments
                            )
                            evidence = Self.cuaOutcomeEvidence(
                                result,
                                overlayOnly: step.kind == .mouseMove
                            )
                        }
                        if let wait = step.waitDuration, wait > 0 {
                            try await Task.sleep(
                                for: .nanoseconds(
                                    Int64((wait * 1_000_000_000).rounded())
                                )
                            )
                        }
                        completedMutation = completedMutation
                            || step.sourceIndexes.contains {
                                request.actions[$0].emitsInput
                            }
                        outcomes.append(contentsOf: step.sourceIndexes.map {
                            ComputerActionOutcome(
                                index: $0,
                                kind: request.actions[$0].kind,
                                ok: true,
                                message: step.kind == .mouseMove
                                    ? "moved Cua agent overlay; macOS hover was not synthesized"
                                    : step.tool ?? "observed",
                                details: evidence
                            )
                        })
                    } catch {
                        batchError = error.localizedDescription
                        let attemptedMutation = step.sourceIndexes.contains {
                            request.actions[$0].emitsInput
                        }
                        outcomes.append(contentsOf: step.sourceIndexes.map {
                            ComputerActionOutcome(
                                index: $0,
                                kind: request.actions[$0].kind,
                                ok: false,
                                message: error.localizedDescription
                            )
                        })
                        if Self.cuaGenerationFatal(error) {
                            self.respondCuaOutcomeUnknown(
                                operation: operation,
                                outcomes: outcomes,
                                error: error,
                                mutationMayHaveOccurred:
                                    completedMutation || attemptedMutation,
                                clearAllTargets: true
                            )
                            return
                        }
                        break
                    }
                }

                try Task.checkCancellation()
                let state: CuaWindowState
                let advertisedPNG: String
                do {
                    currentTarget = try await self.reconcileCuaTarget(
                        currentTarget,
                        sessionKey: sessionKey,
                        driver: cuaDriver
                    )
                    let stateResult = try await cuaDriver.call(
                        tool: "get_window_state",
                        arguments: [
                            "session": sessionKey,
                            "pid": currentTarget.processID,
                            "window_id": currentTarget.primaryWindowID,
                            "max_elements":
                                Self.cuaMaximumAccessibilityElements,
                            "max_depth":
                                Self.cuaMaximumAccessibilityDepth,
                        ]
                    )
                    state = try CuaWindowState(result: stateResult)
                    let transform = try CuaScreenshotTransform(
                        sourceSize: state.sourceSize,
                        advertisedSize: descriptor.outputSize
                    )
                    advertisedPNG = try transform.renderAdvertisedPNG(
                        base64: state.base64
                    )
                    currentTarget.transform = transform
                    currentTarget.screenshotIdentity =
                        state.screenshotIdentity
                    currentTarget.elementTokens = state.elementTokens
                } catch {
                    self.respondCuaOutcomeUnknown(
                        operation: operation,
                        outcomes: outcomes,
                        error: error,
                        mutationMayHaveOccurred: completedMutation,
                        clearAllTargets: Self.cuaGenerationFatal(error)
                    )
                    return
                }
                guard self.cuaOperationIsCurrent(operation) else { return }
                self.cuaSessionTargets[sessionKey] = currentTarget
                self.finishCuaOperation(operation)
                let foregroundAfter = self.frontmostApplicationProvider()
                let focusDrift = Self.cuaFocusDrift(
                    before: foregroundBefore,
                    after: foregroundAfter
                )

                var response: [String: Any] = [
                    "ok": true,
                    "batchOK": batchError == nil,
                    "outcomes": outcomes.map(\.dictionary),
                    "focusDrift": focusDrift,
                    "foregroundApp": Self.cuaForegroundValue(
                        foregroundAfter
                    ),
                    "windowTitle": foregroundAfter?.windowTitle ?? "",
                    "displayID": descriptor.displayID,
                    "width": descriptor.outputSize.width,
                    "height": descriptor.outputSize.height,
                    "target": currentTarget.dictionary,
                    "screenshotTarget": currentTarget.screenshotDictionary,
                    "accessibility": state.accessibility,
                ]
                ComputerScreenshotMemoryCache.attach(
                    to: &response,
                    base64PNG: advertisedPNG
                )
                if let batchError {
                    response["batchError"] = batchError
                }
                reply.respond(response)
            } catch is CancellationError {
                self.finishCancelledCuaOperation(operation)
            } catch {
                if Self.cuaGenerationFatal(error) {
                    self.cuaSessionTargets.removeAll()
                }
                let targetLost = error as? CuaIntegrationError == .targetLost
                self.failCuaOperation(
                    operation,
                    error: error,
                    clearTarget: targetLost || Self.cuaGenerationFatal(error)
                )
            }
        }
    }

    private func beginCuaOperation(
        requestID: String,
        sessionKey: String,
        reply: ComputerResponseGate
    ) -> Bool {
        guard cuaInFlightOperation == nil,
              inFlightExecution == nil,
              inFlightApplicationOpen == nil else {
            reply.respond(Self.cuaFailure(
                code: "computer_busy",
                message: "computer busy: another PipiUI session owns the desktop"
            ))
            return false
        }
        let operation = CuaInFlightOperation(
            requestID: requestID,
            sessionKey: sessionKey,
            reply: reply
        )
        // A prior batch may still be inside the presentation grace window.
        cancelDesktopPresentationGrace()
        cuaInFlightOperation = operation
        activeSessionKey = sessionKey
        activeApplication = cuaSessionTargets[sessionKey]?.applicationIdentity
        activeWindowID = cuaSessionTargets[sessionKey]?.primaryWindowID
        isDesktopOperationActive = true
        remainingActions = nil
        let targetName = activeApplication?.name ?? "目标应用"
        statusMessage = "正在操作 \(targetName)…"
        Task { @MainActor in
            ComputerUseWindowPresentation.shared.update(for: self)
        }
        refreshInputMonitoring()
        return true
    }

    private func validatedCuaDescriptor(
        _ request: J
    ) throws -> ComputerCaptureDescriptor {
        let descriptor = try openApplicationDescriptorProvider()
        try descriptor.validateAdvertisement(
            displayID: request["displayID"].int,
            width: request["displayWidth"].int,
            height: request["displayHeight"].int
        )
        return descriptor
    }

    private func listCuaWindows(
        processID: Int32,
        driver: CuaDriverTransport
    ) async throws -> [CuaWindowRecord] {
        let listed = try await driver.call(
            tool: "list_windows",
            arguments: ["pid": processID]
        )
        return Self.cuaWindows(
            listed.structuredContent["windows"],
            processID: processID
        )
    }

    private func ensureCuaNativeInputAllowed(
        target: CuaComputerTarget,
        sessionKey: String,
        actionKind: ComputerActionKind
    ) throws {
        let targetMatch = hostSelfProtection.match(target)
        guard !targetMatch.isHost else {
            cuaSessionTargets.removeValue(forKey: sessionKey)
            throw rejectHostControl(actionKind: actionKind, match: targetMatch)
        }
        guard let foreground = frontmostApplicationProvider() else {
            throw ComputerInputError.targetProcessChanged
        }
        let foregroundMatch = hostSelfProtection.match(foreground)
        guard !foregroundMatch.isHost else {
            cuaSessionTargets.removeValue(forKey: sessionKey)
            throw rejectHostControl(actionKind: actionKind, match: foregroundMatch)
        }
    }

    private func reconcileCuaTarget(
        _ target: CuaComputerTarget,
        sessionKey: String,
        driver: CuaDriverTransport
    ) async throws -> CuaComputerTarget {
        let hostMatch = hostSelfProtection.match(target)
        guard !hostMatch.isHost else {
            cuaSessionTargets.removeValue(forKey: sessionKey)
            throw rejectHostControl(actionKind: .screenshot, match: hostMatch)
        }
        guard cuaTargetValidator(target) else {
            cuaSessionTargets.removeValue(forKey: sessionKey)
            throw CuaIntegrationError.targetLost
        }
        let windows = try await listCuaWindows(
            processID: target.processID,
            driver: driver
        )
        guard !windows.isEmpty else {
            cuaSessionTargets.removeValue(forKey: sessionKey)
            throw CuaIntegrationError.targetLost
        }
        var reconciled = target
        let currentIDs = windows.map(\.windowID)
        guard currentIDs.contains(target.primaryWindowID) else {
            cuaSessionTargets.removeValue(forKey: sessionKey)
            throw CuaIntegrationError.targetLost
        }
        if currentIDs != target.windowIDs {
            reconciled.windowIDs = currentIDs
            reconciled.revision &+= 1
        }
        return reconciled
    }

    func cancelCuaRequest(
        requestID: String,
        sessionKey: String,
        reason: String,
        respond: Bool
    ) -> Bool {
        guard let operation = cuaInFlightOperation,
              operation.requestID == requestID,
              operation.sessionKey == sessionKey else {
            return false
        }
        operation.task?.cancel()
        operation.task = nil
        cuaDriver?.cancelAndStop()
        cuaInFlightOperation = nil
        // Soft cancel: model may retry the next batch. Session release overrides
        // with an immediate clearLeasePresentation() below.
        scheduleDesktopPresentationGrace(statusMessage: reason)
        refreshInputMonitoring()
        if respond {
            operation.reply.respond(Self.cuaFailure(
                code: "computer_cancelled",
                message: reason
            ))
        }
        return true
    }

    func releaseCuaSession(_ sessionKey: String) {
        let hadTarget = cuaSessionTargets.removeValue(forKey: sessionKey) != nil
        if let operation = cuaInFlightOperation,
           operation.sessionKey == sessionKey {
            _ = cancelCuaRequest(
                requestID: operation.requestID,
                sessionKey: sessionKey,
                reason: "computer session was released",
                respond: true
            )
            // Session teardown must not leave mini chrome in the grace window.
            clearLeasePresentation()
            return
        }
        if activeSessionKey == sessionKey {
            clearLeasePresentation()
        }
        guard hadTarget, let cuaDriver else { return }
        Task {
            _ = try? await cuaDriver.call(
                tool: "end_session",
                arguments: ["session": sessionKey]
            )
        }
    }

    func releaseAllCuaSessions() {
        cuaSessionTargets.removeAll()
        if let operation = cuaInFlightOperation {
            operation.task?.cancel()
            operation.reply.respond(Self.cuaFailure(
                code: "computer_cancelled",
                message: "computer control was released"
            ))
        }
        cuaInFlightOperation = nil
        cuaDriver?.cancelAndStop()
    }

    private func finishCuaOperation(_ operation: CuaInFlightOperation) {
        guard cuaInFlightOperation === operation else { return }
        operation.task = nil
        cuaInFlightOperation = nil
        // Keep mini chrome through the model-thinking gap; next begin cancels.
        scheduleDesktopPresentationGrace(
            statusMessage: "桌面操作已完成，等待下一步…"
        )
        refreshInputMonitoring()
    }

    private func finishCancelledCuaOperation(
        _ operation: CuaInFlightOperation
    ) {
        guard cuaInFlightOperation === operation else { return }
        operation.task = nil
        cuaInFlightOperation = nil
        cuaDriver?.cancelAndStop()
        scheduleDesktopPresentationGrace(
            statusMessage: "桌面操作已取消，等待下一步…"
        )
        refreshInputMonitoring()
    }

    private func respondCuaOutcomeUnknown(
        operation: CuaInFlightOperation,
        outcomes: [ComputerActionOutcome],
        error: Error,
        mutationMayHaveOccurred: Bool,
        clearAllTargets: Bool
    ) {
        guard cuaInFlightOperation === operation else { return }
        if clearAllTargets {
            cuaSessionTargets.removeAll()
        } else {
            cuaSessionTargets.removeValue(forKey: operation.sessionKey)
        }
        finishCuaOperation(operation)
        let instruction = mutationMayHaveOccurred
            ? "The mutation outcome is unknown. Do not blindly retry; call "
                + "open_application and observe the target again."
            : "The final observation failed. Call open_application and observe "
                + "the exact target again before continuing."
        operation.reply.respond(Self.cuaFailure(
            code: "computer_outcome_unknown",
            message: "\(error.localizedDescription) \(instruction)",
            extra: [
                "batchOK": false,
                "outcomeUnknown": mutationMayHaveOccurred,
                "outcomes": outcomes.map(\.dictionary),
                "requiresReopen": true,
            ]
        ))
        statusMessage = instruction
    }

    private func failCuaOperation(
        _ operation: CuaInFlightOperation,
        error: Error,
        clearTarget: Bool
    ) {
        guard cuaInFlightOperation === operation else { return }
        if clearTarget {
            cuaSessionTargets.removeValue(forKey: operation.sessionKey)
        }
        finishCuaOperation(operation)
        let message = error.localizedDescription
        if error is ComputerHostSelfProtectionError {
            cuaSessionTargets.removeValue(forKey: operation.sessionKey)
            operation.reply.respond(Self.cuaFailure(
                code: ComputerHostSelfProtectionError.code,
                message: message
            ))
        } else if Self.cuaNeedsUserHandoff(message) {
            operation.reply.respond(Self.cuaFailure(
                code: "user_handoff_required",
                message: "macOS or the target application requires authentication that automation cannot complete. Please finish the prompt manually, then retry.",
                extra: ["userHandoffRequired": true]
            ))
        } else {
            operation.reply.respond(Self.cuaFailure(
                code: clearTarget
                    ? "computer_target_lost"
                    : "cua_driver_error",
                message: message
            ))
        }
        statusMessage = message
    }

    private func cuaOperationIsCurrent(
        _ operation: CuaInFlightOperation
    ) -> Bool {
        cuaInFlightOperation === operation
            && operation.task?.isCancelled != true
    }

    private static func cuaProcessID(_ value: Any?) -> Int32? {
        guard let number = value as? NSNumber,
              number.int64Value > 0,
              number.int64Value <= Int64(Int32.max) else {
            return nil
        }
        return number.int32Value
    }

    private static func cuaGenerationFatal(_ error: Error) -> Bool {
        (error as? CuaDriverError)?.isGenerationFatal == true
    }

    private static func cuaForegroundValue(
        _ application: ComputerApplicationIdentity?
    ) -> Any {
        guard let application else { return NSNull() }
        return [
            "name": application.name,
            "bundleID": application.bundleID,
            "processID": application.processID,
        ] as [String: Any]
    }

    private static func cuaFocusDrift(
        before: ComputerApplicationIdentity?,
        after: ComputerApplicationIdentity?
    ) -> Bool {
        switch (before, after) {
        case (.none, .none):
            return false
        case (.some(let before), .some(let after)):
            return !sameProcess(before, after)
        default:
            return true
        }
    }

    private static func cuaOutcomeEvidence(
        _ result: CuaToolResult,
        overlayOnly: Bool
    ) -> [String: Any]? {
        let retainedKeys = [
            "effect", "verified", "refusal", "suspected_noop",
            "path", "delivery_mode",
        ]
        var evidence: [String: Any] = [:]
        for key in retainedKeys {
            if let value = result.structuredContent[key] {
                evidence[key] = value
            }
        }
        if overlayOnly {
            evidence["cursorSemantics"] = "agent_overlay_only"
            evidence["nativeHover"] = false
        }
        return evidence.isEmpty ? nil : evidence
    }

    private static func cuaWindows(
        _ value: Any?,
        processID: Int32
    ) -> [CuaWindowRecord] {
        let values = value as? [[String: Any]] ?? []
        var seen = Set<UInt32>()
        return values.compactMap(CuaWindowRecord.init).filter {
            $0.processID == processID && seen.insert($0.windowID).inserted
        }
    }

    private static func preferredCuaWindow(
        in windows: [CuaWindowRecord]
    ) -> CuaWindowRecord? {
        windows.dropFirst().reduce(windows.first) { preferred, candidate in
            guard let preferred else { return candidate }
            return candidate.isPreferredPrimary(over: preferred)
                ? candidate
                : preferred
        }
    }

    private static func cuaNeedsUserHandoff(_ message: String) -> Bool {
        let value = message.lowercased()
        return value.contains("authentication")
            || value.contains("authenticate")
            || value.contains("touch id")
            || value.contains("secure input")
            || value.contains("password prompt")
            || value.contains("administrator password")
    }

    static func cuaFailure(
        code: String,
        message: String,
        extra: [String: Any] = [:]
    ) -> [String: Any] {
        var result: [String: Any] = [
            "ok": false,
            "errorCode": code,
            "error": message,
        ]
        for (key, value) in extra {
            result[key] = value
        }
        return result
    }
}
