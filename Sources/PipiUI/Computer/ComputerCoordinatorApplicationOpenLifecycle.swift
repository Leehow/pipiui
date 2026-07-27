import Foundation

extension ComputerCoordinator {
    func scheduleOpenApplicationTimeout(
        _ execution: ComputerOpenApplicationExecution
    ) {
        let timeout = DispatchWorkItem { [weak self, weak execution] in
            guard let self, let execution,
                  self.inFlightApplicationOpen === execution else { return }
            self.abortOpenApplication(
                execution,
                reason: "open_application exceeded its safety deadline",
                respond: true
            )
        }
        execution.timeoutWork = timeout
        DispatchQueue.main.asyncAfter(
            deadline: .now() + openApplicationTimeout,
            execute: timeout
        )
    }

    @MainActor
    func finishOpenApplication(
        _ execution: ComputerOpenApplicationExecution,
        application: ComputerApplicationIdentity,
        screenshot: ComputerScreenshot
    ) {
        guard openApplicationIsCurrent(execution),
              execution.launchCallbackSettled,
              !execution.cancellationRequested else { return }
        // Exact focus, running identity and the target-window screenshot have
        // all been verified by the caller. Launch Services can no longer
        // surprise a later session through this operation.
        execution.sideEffectsSettled = true
        guard clearOpenApplicationExecution(execution) else {
            clearLeasePresentation()
            return
        }
        recordOpenApplicationAudit(
            execution: execution,
            application: application,
            outcome: .launched,
            focusDrift: false,
            cancelled: false
        )
        statusMessage =
            "已打开 \(application.name)，验证目标并释放桌面互斥槽。"
        execution.reply.respond([
            "ok": true,
            "openedApplication": true,
            "foregroundApp": [
                "name": application.name,
                "bundleID": application.bundleID,
                "processID": application.processID,
            ],
            "windowTitle": application.windowTitle ?? "",
            "displayID": screenshot.displayID,
            "width": screenshot.imageSize.width,
            "height": screenshot.imageSize.height,
            "mimeType": "image/png",
            "base64": screenshot.base64,
        ])
    }

    @MainActor
    func settleFailedOpenApplication(
        _ execution: ComputerOpenApplicationExecution,
        reason: String,
        focusDrift: Bool,
        callbackFailed: Bool = false
    ) async {
        guard inFlightApplicationOpen === execution,
              execution.launchCallbackSettled,
              !execution.cancellationRequested else { return }
        if execution.launchCommitted, !execution.sideEffectsSettled {
            _ = await drainOpenApplicationSideEffects(
                execution,
                activated: execution.activatedApplication
            )
        }
        if execution.cancellationRequested {
            await settleCancelledOpenApplication(
                execution,
                activated: execution.activatedApplication,
                callbackFailed: callbackFailed
            )
            return
        }
        failOpenApplication(
            execution,
            reason: reason,
            focusDrift: focusDrift
        )
    }

    @MainActor
    func failOpenApplication(
        _ execution: ComputerOpenApplicationExecution,
        reason: String,
        focusDrift: Bool
    ) {
        guard inFlightApplicationOpen === execution,
              execution.launchCallbackSettled,
              !execution.launchCommitted
                || execution.sideEffectsSettled else { return }
        if execution.launchCommitted {
            clearLeasePresentation()
            inputSynth.releaseAll()
        }
        guard clearOpenApplicationExecution(execution) else { return }
        recordOpenApplicationAudit(
            execution: execution,
            application: execution.activatedApplication,
            outcome: .failed,
            focusDrift: focusDrift,
            cancelled: false
        )
        statusMessage = reason
        execution.reply.respond(Self.failure(reason))
    }

    func abortOpenApplication(
        _ execution: ComputerOpenApplicationExecution,
        reason: String,
        respond: Bool
    ) {
        guard inFlightApplicationOpen === execution else { return }
        if !execution.cancellationRequested {
            execution.cancellationRequested = true
            execution.cancellationReason = reason
            execution.gate.cancel()
            execution.timeoutWork?.cancel()
            execution.timeoutWork = nil
            if activeSessionKey == execution.sessionKey {
                clearLeasePresentation()
            }
            inputSynth.releaseAll()
            recordOpenApplicationCancellationRequestAudit(
                execution,
                application: execution.activatedApplication,
                focusDrift: false
            )
        }
        if respond {
            execution.reply.respond(Self.failure(reason))
        }

        if execution.launchCommitted {
            // NSWorkspace has no cancellation API. Callback completion is not
            // equivalent to focus-side-effect completion: polling/capture may
            // still be active and the target can become frontmost late. Never
            // cancel this task or release the process-global slot here.
            statusMessage = execution.launchCallbackSettled
                ? "已请求取消；等待启动后的焦点副作用完成隔离，互斥槽保持占用。"
                : "已请求取消；等待不可撤销的 Launch Services 回调落定，桌面保持隔离。"
            refreshInputMonitoring()
            return
        }

        execution.task?.cancel()
        execution.task = nil
        execution.launchCallbackSettled = true
        execution.sideEffectsSettled = true
        recordOpenApplicationCancellationSettlementAudit(
            execution,
            application: nil,
            callbackFailed: false
        )
        _ = clearOpenApplicationExecution(execution)
        statusMessage = "open_application 已取消，未产生截图；桌面互斥槽已释放。"
    }

    @MainActor
    func settleCancelledOpenApplication(
        _ execution: ComputerOpenApplicationExecution,
        activated: ComputerApplicationIdentity?,
        callbackFailed: Bool = false
    ) async {
        guard inFlightApplicationOpen === execution,
              execution.cancellationRequested,
              execution.launchCallbackSettled else { return }

        let eventualApplication = await drainOpenApplicationSideEffects(
            execution,
            activated: activated
        )
        recordOpenApplicationCancellationSettlementAudit(
            execution,
            application: eventualApplication,
            callbackFailed: callbackFailed
        )
        if activeSessionKey == execution.sessionKey {
            clearLeasePresentation()
        }
        inputSynth.releaseAll()
        execution.task = nil
        _ = clearOpenApplicationExecution(execution)
        statusMessage =
            "Launch Services 回调已落定；取消请求未返回截图或成功，互斥槽已释放。"
    }

    @MainActor
    func drainOpenApplicationSideEffects(
        _ execution: ComputerOpenApplicationExecution,
        activated: ComputerApplicationIdentity?
    ) async -> ComputerApplicationIdentity? {
        guard inFlightApplicationOpen === execution,
              execution.launchCallbackSettled else {
            return nil
        }
        if execution.sideEffectsSettled {
            guard let activated,
                  activated.normalizedBundleID
                    == execution.target.bundleID.lowercased(),
                  targetProcessValidator(activated) else {
                return nil
            }
            return activated
        }

        // Callback completion is only the start of settlement. Activation
        // notifications and frontmost changes can arrive afterward, so retain
        // the global slot for a full bounded drain window and sample the exact
        // running identity throughout it. This path never captures pixels or
        // installs a lease.
        var eventualApplication: ComputerApplicationIdentity?
        var candidate = activated
        let deadline = Date().addingTimeInterval(
            openApplicationQuarantineDelay
        )
        repeat {
            if let frontmost = frontmostApplicationProvider() {
                if let activated, Self.sameProcess(frontmost, activated) {
                    candidate = frontmost
                } else if activated == nil,
                          frontmost.normalizedBundleID
                            == execution.target.bundleID.lowercased() {
                    candidate = frontmost
                }
            }
            if let candidate,
               candidate.normalizedBundleID
                    == execution.target.bundleID.lowercased(),
               targetProcessValidator(candidate) {
                eventualApplication = candidate
            }
            let remaining = deadline.timeIntervalSinceNow
            if remaining <= 0 { break }
            try? await Task.sleep(
                nanoseconds: UInt64(
                    min(openApplicationPollInterval, remaining)
                        * 1_000_000_000
                )
            )
        } while true
        execution.sideEffectsSettled = true
        return eventualApplication
    }

    @discardableResult
    func clearOpenApplicationExecution(
        _ execution: ComputerOpenApplicationExecution
    ) -> Bool {
        guard inFlightApplicationOpen === execution,
              !execution.launchCommitted
                || execution.sideEffectsSettled else {
            return false
        }
        execution.timeoutWork?.cancel()
        execution.timeoutWork = nil
        execution.gate.cancel()
        execution.task = nil
        inFlightApplicationOpen = nil
        if activeSessionKey == execution.sessionKey {
            clearLeasePresentation()
        }
        refreshInputMonitoring()
        return true
    }

    func openApplicationIsCurrent(
        _ execution: ComputerOpenApplicationExecution
    ) -> Bool {
        inFlightApplicationOpen === execution
            && !execution.gate.isCancelled
            && !execution.cancellationRequested
    }

    func rejectOpenApplication(
        reply: ComputerResponseGate,
        sessionKey: String,
        target: ComputerResolvedApplication?,
        reason: String,
        outcome: ComputerApplicationOpenAuditOutcome = .rejected
    ) {
        recordOpenApplicationAudit(
            sessionKey: sessionKey,
            target: target,
            application: nil,
            outcome: outcome
        )
        reply.respond(Self.failure(reason))
    }

    func recordOpenApplicationAudit(
        sessionKey: String,
        target: ComputerResolvedApplication?,
        application: ComputerApplicationIdentity?,
        outcome: ComputerApplicationOpenAuditOutcome,
        focusDrift: Bool = false,
        cancelled: Bool = false
    ) {
        let auditID = auditSessionIDs[sessionKey] ?? UUID().uuidString
        auditSessionIDs[sessionKey] = auditID
        openApplicationAuditSink(
            ComputerApplicationOpenAuditRecord(
                timestamp: Date(),
                auditSessionID: auditID,
                target: target,
                processID: application?.processID,
                outcome: outcome,
                focusDrift: focusDrift,
                cancelled: cancelled
            )
        )
    }

    func recordOpenApplicationAudit(
        execution: ComputerOpenApplicationExecution,
        application: ComputerApplicationIdentity?,
        outcome: ComputerApplicationOpenAuditOutcome,
        focusDrift: Bool,
        cancelled: Bool
    ) {
        guard !execution.terminalAuditRecorded else { return }
        execution.terminalAuditRecorded = true
        recordOpenApplicationAudit(
            sessionKey: execution.sessionKey,
            target: execution.target,
            application: application,
            outcome: outcome,
            focusDrift: focusDrift,
            cancelled: cancelled
        )
    }

    func recordOpenApplicationCancellationRequestAudit(
        _ execution: ComputerOpenApplicationExecution,
        application: ComputerApplicationIdentity?,
        focusDrift: Bool
    ) {
        guard !execution.cancellationRequestAuditRecorded else { return }
        execution.cancellationRequestAuditRecorded = true
        recordOpenApplicationAudit(
            sessionKey: execution.sessionKey,
            target: execution.target,
            application: application,
            outcome: .cancellationRequested,
            focusDrift: focusDrift,
            cancelled: true
        )
    }

    func recordOpenApplicationCancellationSettlementAudit(
        _ execution: ComputerOpenApplicationExecution,
        application: ComputerApplicationIdentity?,
        callbackFailed: Bool
    ) {
        guard !execution.cancellationSettlementAuditRecorded else { return }
        execution.cancellationSettlementAuditRecorded = true
        recordOpenApplicationAudit(
            sessionKey: execution.sessionKey,
            target: execution.target,
            application: application,
            outcome: callbackFailed
                ? .cancellationCallbackFailed
                : .cancellationSettled,
            focusDrift: false,
            cancelled: true
        )
    }
}
